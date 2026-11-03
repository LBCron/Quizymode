using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Keywords;

/// <summary>
/// Distinct item-level keyword names (ItemKeywords) visible to the caller for a category.
/// Used for create/edit item autocomplete; clients typically cache per category.
/// </summary>
public static class GetItemTagKeywords
{
    public sealed record Response(List<string> Names);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("keywords/item-tags", Handler)
                .WithTags("Keywords")
                .WithSummary("List item tag keyword names for a category")
                .WithDescription(
                    "Returns sorted distinct names of keywords attached to items in the category (extras via ItemKeywords), " +
                    "respecting item and keyword visibility for the current user.")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            string category,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(category))
            {
                return Results.BadRequest("Category is required");
            }

            Result<Response> result = await HandleAsync(category.Trim(), db, userContext, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                failure => failure.Error.Type == ErrorType.NotFound
                    ? Results.NotFound()
                    : CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        string categoryName,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        Guid? categoryId = await ResolveCategoryIdAsync(categoryName, db, userContext, cancellationToken);
        if (!categoryId.HasValue)
        {
            return Result.Failure<Response>(
                Error.NotFound("Keywords.CategoryNotFound", $"Category '{categoryName}' not found"));
        }

        bool authed = userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId);
        string uid = userContext.UserId ?? string.Empty;

        IQueryable<string> nameQuery;
        if (!authed)
        {
            nameQuery =
                from ik in db.ItemKeywords
                join i in db.Items on ik.ItemId equals i.Id
                join k in db.Keywords on ik.KeywordId equals k.Id
                where i.CategoryId == categoryId.Value && !i.IsPrivate && !k.IsPrivate
                    && (i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved)
                select k.Name;
        }
        else
        {
            nameQuery =
                from ik in db.ItemKeywords
                join i in db.Items on ik.ItemId equals i.Id
                join k in db.Keywords on ik.KeywordId equals k.Id
                where i.CategoryId == categoryId.Value
                    && ((!i.IsPrivate && (i.ImageReviewState == null || i.ImageReviewState == ItemImageReviewState.Approved)) || i.CreatedBy == uid)
                    && (!k.IsPrivate || k.CreatedBy == uid)
                select k.Name;
        }

        List<string> names = await nameQuery.Distinct().ToListAsync(cancellationToken);

        names.Sort(StringComparer.OrdinalIgnoreCase);

        return Result.Success(new Response(names));
    }

    private static async Task<Guid?> ResolveCategoryIdAsync(
        string categoryName,
        ApplicationDbContext db,
        IUserContext userContext,
        CancellationToken cancellationToken)
    {
        Category? globalCategory = await db.Categories
            .FirstOrDefaultAsync(c => !c.IsPrivate && c.Name.ToLower() == categoryName.ToLower(), cancellationToken);
        if (globalCategory is not null)
        {
            return globalCategory.Id;
        }

        if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
        {
            Category? privateCategory = await db.Categories
                .FirstOrDefaultAsync(
                    c => c.IsPrivate
                        && c.CreatedBy == userContext.UserId
                        && c.Name.ToLower() == categoryName.ToLower(),
                    cancellationToken);
            if (privateCategory is not null)
            {
                return privateCategory.Id;
            }
        }

        return null;
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
        }
    }
}
