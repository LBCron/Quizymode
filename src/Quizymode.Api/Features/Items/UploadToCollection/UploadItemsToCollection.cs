using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Data;
using Quizymode.Api.Features;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Features.Items.AddBulk;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Services;
using Quizymode.Api.Services.Taxonomy;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.UploadToCollection;

public static class UploadItemsToCollection
{
    /// <summary>InputText is the raw upload content (e.g. JSON string) used to compute a hash for duplicate detection. Category, Keyword1, Keyword2 define navigation; Keywords are additional default keywords for all items.</summary>
    public sealed record Request(
        string Category,
        string Keyword1,
        string Keyword2,
        List<AddItemsBulk.KeywordRequest> Keywords,
        List<AddItemsBulk.ItemRequest> Items,
        string InputText,
        string? CollectionName = null);

    public const int MaxCollectionNameLength = 200;

    public sealed record Response(
        string CollectionId,
        string Name,
        int ItemCount);

    public sealed class Validator : AbstractValidator<Request>
    {
        private readonly IUserContext _userContext;

        public Validator(IUserContext userContext)
        {
            _userContext = userContext;
            int maxItems = _userContext.IsAdmin ? 1000 : 100;
            RuleFor(x => x.Category)
                .NotEmpty()
                .WithMessage("Category is required");
            RuleFor(x => x.Keyword1)
                .NotEmpty()
                .WithMessage("Keyword1 (primary topic) is required");
            RuleFor(x => x.Keyword2)
                .NotEmpty()
                .WithMessage("Keyword2 (subtopic) is required");
            RuleFor(x => x.Keywords)
                .NotNull()
                .WithMessage("Keywords is required");
            RuleFor(x => x.Items)
                .NotNull()
                .WithMessage("Items is required")
                .Must(items => items is null || items.Count > 0)
                .WithMessage("At least one item is required")
                .Must(items => items is null || items.Count <= maxItems)
                .WithMessage($"Cannot upload more than {maxItems} items at once");
            RuleForEach(x => x.Items)
                .SetValidator(new AddItemsBulk.ItemRequestValidator());
            RuleFor(x => x.InputText)
                .NotNull()
                .WithMessage("InputText is required for duplicate detection");
            // The name is trimmed before use, so measure the trimmed value.
            RuleFor(x => x.CollectionName)
                .Must(name => name!.Trim().Length <= MaxCollectionNameLength)
                .WithMessage($"Collection name must not exceed {MaxCollectionNameLength} characters.")
                .When(x => x.CollectionName is not null && x.CollectionName.Trim().Length > 0);
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("items/upload-to-collection", Handler)
                .WithTags("Items")
                .WithSummary("Upload JSON items into a new collection")
                .WithDescription("Creates items (private for non-admin) and a new collection (optional collectionName, otherwise a unique GUID name), adds items to it. Returns collection ID to navigate. URL is shareable.")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status201Created)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status429TooManyRequests);
        }

        private static async Task<IResult> Handler(
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            ISimHashService simHashService,
            IUserContext userContext,
            ITaxonomyItemCategoryResolver itemCategoryResolver,
            ITaxonomyRegistry taxonomyRegistry,
            IAuditService auditService,
            ITextModerationService moderation,
            ILogger<Endpoint> logger,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            var validationResult = await validator.ValidateAsync(request, cancellationToken);
            if (!validationResult.IsValid)
            {
                return Results.BadRequest(validationResult.Errors);
            }

            Result<Response> result = await HandleAsync(
                request,
                db,
                simHashService,
                userContext,
                itemCategoryResolver,
                taxonomyRegistry,
                auditService,
                moderation,
                cancellationToken,
                logger);

            return result.Match(
                value => Results.Created($"/api/collections/{value.CollectionId}", value),
                failure => CustomResults.Problem(result));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<Request>, Validator>();
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        Request request,
        ApplicationDbContext db,
        ISimHashService simHashService,
        IUserContext userContext,
        ITaxonomyItemCategoryResolver itemCategoryResolver,
        ITaxonomyRegistry taxonomyRegistry,
        IAuditService auditService,
        ITextModerationService moderation,
        CancellationToken cancellationToken,
        ILogger? logger = null)
    {
        if (string.IsNullOrEmpty(userContext.UserId) || !Guid.TryParse(userContext.UserId, out Guid userIdGuid))
        {
            return Result.Failure<Response>(
                Error.Validation("Upload.InvalidUser", "User ID is required and must be a valid GUID."));
        }

        string? requestedName = string.IsNullOrWhiteSpace(request.CollectionName) ? null : request.CollectionName.Trim();
        if (requestedName is not null && moderation.Evaluate(requestedName).Outcome == TextModerationOutcome.Blocked)
        {
            return Result.Failure<Response>(
                Error.Validation("Upload.CollectionNameBlocked", "The collection name contains blocked language. Edit it and try again."));
        }

        await using var mediaTransaction = await ItemImageSubmission.BeginAsync(db, cancellationToken);
        Error? mediaError = await ItemImageImport.ValidateAsync(db, userContext.UserId, request.Items, cancellationToken);
        if (mediaError is not null) return Result.Failure<Response>(mediaError);
        byte[] hashBytes = SHA256.HashData(Encoding.UTF8.GetBytes(request.InputText));
        string hash = Convert.ToHexString(hashBytes).ToLowerInvariant();

        bool duplicateExists = await db.Uploads
            .AnyAsync(u => u.UserId == userIdGuid && u.Hash == hash, cancellationToken);
        if (duplicateExists)
        {
            return Result.Failure<Response>(
                Error.Conflict("Upload.Duplicate", "This content has already been uploaded. Duplicate uploads are not allowed."));
        }

        Upload upload = new()
        {
            Id = Guid.NewGuid(),
            InputText = request.InputText,
            UserId = userIdGuid,
            CreatedAt = DateTime.UtcNow,
            Hash = hash
        };
        db.Uploads.Add(upload);
        await db.SaveChangesAsync(cancellationToken);

        bool isPrivate = !userContext.IsAdmin;
        AddItemsBulk.Request bulkRequest = new(
            IsPrivate: isPrivate,
            Category: request.Category,
            Keyword1: request.Keyword1,
            Keyword2: request.Keyword2,
            Keywords: request.Keywords,
            Items: request.Items,
            UploadId: upload.Id);

        Result<AddItemsBulk.Response> bulkResult = await AddItemsBulkHandler.HandleAsync(
            bulkRequest,
            db,
            simHashService,
            userContext,
            itemCategoryResolver,
            taxonomyRegistry,
            auditService,
            logger ?? NullLogger.Instance,
            cancellationToken);

        if (bulkResult.IsFailure)
        {
            return Result.Failure<Response>(bulkResult.Error!);
        }

        AddItemsBulk.Response bulkResponse = bulkResult.Value!;
        List<Guid>? createdIds = bulkResponse.CreatedItemIds;
        if (createdIds is null || createdIds.Count == 0)
        {
            return Result.Failure<Response>(
                Error.Validation("Upload.NoItemsCreated", "No items were created. Check for duplicates or validation errors."));
        }

        string collectionName = requestedName ?? Guid.NewGuid().ToString("N");
        Collection collection = new()
        {
            Id = Guid.NewGuid(),
            Name = collectionName,
            CreatedBy = userContext.UserId!,
            CreatedAt = DateTime.UtcNow
        };
        db.Collections.Add(collection);
        await db.SaveChangesAsync(cancellationToken);

        Result<CollectionItems.BulkAddResponse> addResult = await CollectionItems.HandleBulkAddAsync(
            collection.Id,
            new CollectionItems.BulkAddRequest(createdIds),
            db,
            userContext,
            cancellationToken);

        if (addResult.IsFailure)
        {
            return Result.Failure<Response>(addResult.Error!);
        }

        if (mediaTransaction is not null) await mediaTransaction.CommitAsync(cancellationToken);
        return Result.Success(new Response(
            collection.Id.ToString(),
            collection.Name,
            createdIds.Count));
    }
}
