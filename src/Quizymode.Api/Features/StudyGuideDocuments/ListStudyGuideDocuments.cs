using Quizymode.Api.Shared.Http;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>GET /study-guides/documents: the caller's study guide documents, newest first.</summary>
public static class ListStudyGuideDocuments
{
    public sealed record Response(List<StudyGuideDocumentContracts.DocumentSummary> Documents);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("study-guides/documents", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("List my study guide documents (newest first)")
                .RequireAuthorization()
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized);
        }

        private static async Task<IResult> Handler(
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            return Results.Ok(await HandleAsync(db, userContext.UserId, cancellationToken));
        }
    }

    internal static async Task<Response> HandleAsync(ApplicationDbContext db, string userId, CancellationToken cancellationToken)
    {
        List<StudyGuideDocument> documents = await db.StudyGuideDocuments
            .AsNoTracking()
            .Where(document => document.UserId == userId)
            .OrderByDescending(document => document.CreatedUtc)
            .ToListAsync(cancellationToken);

        List<Guid> documentIds = documents.Select(document => document.Id).ToList();
        var sections = await db.StudyGuideSections
            .AsNoTracking()
            .Where(section => documentIds.Contains(section.DocumentId))
            .Select(section => new { section.DocumentId, section.GenerationId })
            .ToListAsync(cancellationToken);

        List<Guid> generationIds = sections
            .Where(section => section.GenerationId.HasValue)
            .Select(section => section.GenerationId!.Value)
            .Distinct()
            .ToList();
        HashSet<Guid> completed = (await db.SectionGenerations
                .AsNoTracking()
                .Where(generation => generationIds.Contains(generation.Id) && generation.Status == SectionGenerationStatus.Completed)
                .Select(generation => generation.Id)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        Dictionary<Guid, int> acceptedCounts = (await db.StudyGuideAcceptedCandidates
                .AsNoTracking()
                .Where(accepted => documentIds.Contains(accepted.DocumentId))
                .Select(accepted => accepted.DocumentId)
                .ToListAsync(cancellationToken))
            .GroupBy(documentId => documentId)
            .ToDictionary(group => group.Key, group => group.Count());

        List<StudyGuideDocumentContracts.DocumentSummary> summaries = documents
            .Select(document =>
            {
                var documentSections = sections.Where(section => section.DocumentId == document.Id).ToList();
                return new StudyGuideDocumentContracts.DocumentSummary(
                    document.Id.ToString(),
                    document.Title,
                    document.FileType,
                    documentSections.Count,
                    documentSections.Count(section => section.GenerationId.HasValue && completed.Contains(section.GenerationId.Value)),
                    acceptedCounts.GetValueOrDefault(document.Id),
                    document.CollectionId?.ToString(),
                    document.CreatedUtc,
                    document.LastActivityUtc,
                    document.ExpiresUtc,
                    document.IsPrimarySource);
            })
            .ToList();

        return new Response(summaries);
    }
}
