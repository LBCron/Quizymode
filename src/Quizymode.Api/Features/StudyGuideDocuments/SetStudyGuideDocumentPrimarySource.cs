using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>PUT /study-guides/documents/{id}/primary-source: owner-only toggle marking a document as the primary source (#372).</summary>
public static class SetStudyGuideDocumentPrimarySource
{
    public sealed record Request(bool? IsPrimarySource);

    public sealed record Response(string Id, bool IsPrimarySource);

    public sealed class Validator : AbstractValidator<Request>
    {
        public Validator()
        {
            RuleFor(request => request.IsPrimarySource).NotNull().WithMessage("isPrimarySource is required.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPut("study-guides/documents/{id:guid}/primary-source", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Mark or unmark a study guide document as my primary source")
                .WithDescription("Owner only; other users get 404. Does not extend the document's retention.")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            Guid id,
            Request request,
            IValidator<Request> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            Response? response = await HandleAsync(id, request.IsPrimarySource!.Value, db, userContext.UserId, cancellationToken);
            return response is null ? Results.NotFound() : Results.Ok(response);
        }
    }

    internal static async Task<Response?> HandleAsync(
        Guid id,
        bool isPrimarySource,
        ApplicationDbContext db,
        string userId,
        CancellationToken cancellationToken)
    {
        StudyGuideDocument? document = await db.StudyGuideDocuments
            .FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, cancellationToken);
        if (document is null)
        {
            return null;
        }

        document.IsPrimarySource = isPrimarySource;
        await db.SaveChangesAsync(cancellationToken);
        return new Response(document.Id.ToString(), document.IsPrimarySource);
    }
}
