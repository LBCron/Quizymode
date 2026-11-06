using Quizymode.Api.Shared.Http;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments.Extraction;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>GET /study-guides/documents/{id}: owner-only document with sections, generation status, and candidates.</summary>
public static class GetStudyGuideDocument
{
    public const int PreviewLength = 240;

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("study-guides/documents/{id:guid}", Handler)
                .WithTags("StudyGuideDocuments")
                .WithSummary("Get a study guide document with its sections, generation status, and generated questions")
                .WithDescription("Owner only; other users get 404. Poll while any section is Queued or Processing.")
                .RequireAuthorization()
                .Produces<StudyGuideDocumentContracts.Document>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> Handler(
            Guid id,
            ApplicationDbContext db,
            IUserContext userContext,
            IOptions<StudyGuideGenerationOptions> options,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            StudyGuideDocumentContracts.Document? response = await HandleAsync(
                id,
                db,
                userContext.UserId,
                options.Value,
                timeProvider.GetUtcNow().UtcDateTime,
                cancellationToken);
            return response is null ? Results.NotFound() : Results.Ok(response);
        }
    }

    internal static async Task<StudyGuideDocumentContracts.Document?> HandleAsync(
        Guid id,
        ApplicationDbContext db,
        string userId,
        StudyGuideGenerationOptions options,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        StudyGuideDocument? document = await db.StudyGuideDocuments
            .AsNoTracking()
            .FirstOrDefaultAsync(d => d.Id == id && d.UserId == userId, cancellationToken);
        if (document is null)
        {
            return null;
        }

        StudyGuideQuotaSnapshot quota = await StudyGuideQuota.GetAsync(db, userId, options, nowUtc, cancellationToken);
        return await BuildAsync(db, document, quota, isDuplicate: false, cancellationToken);
    }

    internal static async Task<StudyGuideDocumentContracts.Document> BuildAsync(
        ApplicationDbContext db,
        StudyGuideDocument document,
        StudyGuideQuotaSnapshot quota,
        bool isDuplicate,
        CancellationToken cancellationToken)
    {
        List<StudyGuideSection> sections = await db.StudyGuideSections
            .AsNoTracking()
            .Where(section => section.DocumentId == document.Id)
            .OrderBy(section => section.Index)
            .ToListAsync(cancellationToken);

        List<Guid> generationIds = sections
            .Where(section => section.GenerationId.HasValue)
            .Select(section => section.GenerationId!.Value)
            .Distinct()
            .ToList();

        Dictionary<Guid, SectionGeneration> generations = await db.SectionGenerations
            .AsNoTracking()
            .Where(generation => generationIds.Contains(generation.Id))
            .ToDictionaryAsync(generation => generation.Id, cancellationToken);

        List<Guid> completedIds = generations.Values
            .Where(generation => generation.Status == SectionGenerationStatus.Completed)
            .Select(generation => generation.Id)
            .ToList();

        Dictionary<Guid, List<GenerationCandidate>> candidates = (await db.GenerationCandidates
                .AsNoTracking()
                .Where(candidate => completedIds.Contains(candidate.GenerationId))
                .ToListAsync(cancellationToken))
            .GroupBy(candidate => candidate.GenerationId)
            .ToDictionary(group => group.Key, group => group.OrderBy(candidate => candidate.Index).ToList());

        // Joined to Items so a saved question whose item was later deleted still shows as Saved, without an edit link.
        Dictionary<Guid, Guid?> acceptedItems = (await db.StudyGuideAcceptedCandidates
                .AsNoTracking()
                .Where(accepted => accepted.DocumentId == document.Id)
                .GroupJoin(
                    db.Items.AsNoTracking(),
                    accepted => accepted.ItemId,
                    item => item.Id,
                    (accepted, items) => new { accepted.CandidateId, Items = items })
                .SelectMany(
                    row => row.Items.DefaultIfEmpty(),
                    (row, item) => new { row.CandidateId, ItemId = item == null ? (Guid?)null : item.Id })
                .ToListAsync(cancellationToken))
            .ToDictionary(row => row.CandidateId, row => row.ItemId);

        List<Guid> sectionIds = sections.Select(section => section.Id).ToList();
        HashSet<Guid> chargedSectionIds = (await db.StudyGuideQuotaCharges
                .AsNoTracking()
                .Where(charge => charge.UserId == document.UserId && sectionIds.Contains(charge.SectionId) && charge.Cost > 0)
                .Select(charge => charge.SectionId)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        List<StudyGuideDocumentContracts.Section> sectionResponses = sections
            .Select(section => ToSection(
                section,
                section.GenerationId.HasValue ? generations.GetValueOrDefault(section.GenerationId.Value) : null,
                candidates,
                acceptedItems,
                chargedSectionIds.Contains(section.Id)))
            .ToList();

        return new StudyGuideDocumentContracts.Document(
            document.Id.ToString(),
            document.Title,
            document.FileType,
            document.PageCount,
            document.CategoryName,
            document.NavigationKeyword1,
            document.NavigationKeyword2,
            ReadKeywords(document),
            document.CollectionId?.ToString(),
            document.CreatedUtc,
            document.ExpiresUtc,
            isDuplicate,
            quota.ToResponse(),
            sectionResponses,
            document.IsPrimarySource);
    }

    private static StudyGuideDocumentContracts.Section ToSection(
        StudyGuideSection section,
        SectionGeneration? generation,
        Dictionary<Guid, List<GenerationCandidate>> candidates,
        Dictionary<Guid, Guid?> acceptedItems,
        bool charged)
    {
        string status = StatusOf(generation);
        bool generated = generation?.Status == SectionGenerationStatus.Completed;
        List<StudyGuideDocumentContracts.Candidate> candidateResponses = generated
            ? candidates.GetValueOrDefault(generation!.Id, [])
                .Select(candidate => new StudyGuideDocumentContracts.Candidate(
                    candidate.Id.ToString(),
                    candidate.Index,
                    candidate.Question,
                    candidate.CorrectAnswer,
                    ReadAnswers(candidate.IncorrectAnswersJson),
                    candidate.Explanation,
                    candidate.SourceQuote,
                    candidate.Page,
                    acceptedItems.ContainsKey(candidate.Id),
                    acceptedItems.GetValueOrDefault(candidate.Id)?.ToString()))
                .ToList()
            : [];

        return new StudyGuideDocumentContracts.Section(
            section.Id.ToString(),
            section.Index,
            section.Label,
            section.PageStart,
            section.PageEnd,
            Preview(section.Text),
            section.SizeBytes,
            section.Text is null,
            status,
            generated && !charged,
            generation?.Status == SectionGenerationStatus.Pending ? generation.NotBeforeUtc : null,
            generation?.Status == SectionGenerationStatus.Failed ? generation.Error : null,
            generated ? generation!.DroppedCount : 0,
            candidateResponses,
            section.AutoSave?.ToString());
    }

    internal static string StatusOf(SectionGeneration? generation) =>
        generation?.Status switch
        {
            null => "New",
            SectionGenerationStatus.Pending => "Queued",
            SectionGenerationStatus.Processing => "Processing",
            SectionGenerationStatus.Completed => "Generated",
            _ => "Failed"
        };

    internal static string Preview(string? text)
    {
        if (string.IsNullOrEmpty(text))
        {
            return string.Empty;
        }

        string stripped = StudyGuideSectioner.StripPageMarkers(text).Trim();
        return stripped.Length <= PreviewLength ? stripped : stripped[..PreviewLength];
    }

    internal static List<string> ReadKeywords(StudyGuideDocument document) =>
        string.IsNullOrEmpty(document.KeywordsJson)
            ? []
            : JsonSerializer.Deserialize<List<string>>(document.KeywordsJson) ?? [];

    internal static List<string> ReadAnswers(string json) =>
        string.IsNullOrEmpty(json) ? [] : JsonSerializer.Deserialize<List<string>>(json) ?? [];
}
