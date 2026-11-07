using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Question quality (ANALYTICS-009): per item, the share of first-attempt quiz answers that were correct,
/// counting only answers recorded after the item's last edit. Items under the minimum answer count are not listed.
/// </summary>
public static class GetQuestionQualityReport
{
    public const int DefaultMinAnswers = 10;
    public const int MaxItems = 200;

    public sealed record QueryRequest(
        int Days = 30,
        int MinAnswers = DefaultMinAnswers,
        bool IncludeBots = false,
        bool IncludeInternal = false);

    public sealed record Response(
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        int MinAnswers,
        int BotSessions,
        bool BotsExcluded,
        int InternalSessions,
        bool InternalExcluded,
        List<QuestionResponse> Items);

    /// <param name="Answers">First-attempt answers (one per session) recorded since the item's last edit.</param>
    /// <param name="CorrectRatePercent">Share of those answers that were correct.</param>
    /// <param name="RandomGuessPercent">100 divided by the number of options (one correct plus the incorrect answers).</param>
    /// <param name="CheckAnswerKey">True when the correct rate is below the random-guess rate.</param>
    /// <param name="LastEditedUtc">The item's last UpdatedAt; null when never edited. Statistics start after it.</param>
    /// <param name="QuestionImage">The curated question picture, or null when the item has none.</param>
    public sealed record QuestionResponse(
        Guid ItemId,
        string Question,
        string CorrectAnswer,
        string? Category,
        List<string> Collections,
        int Answers,
        double CorrectRatePercent,
        double RandomGuessPercent,
        bool CheckAnswerKey,
        DateTime? LastEditedUtc,
        ItemImageReference? QuestionImage = null);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/analytics/question-quality", Handler)
                .WithTags("Admin")
                .WithSummary("Get question quality report (Admin only)")
                .WithDescription("Returns items with their first-attempt correct rate since the item's last edit, lowest first, listing only items with at least minAnswers answers, and flags items below the random-guess rate. Bot sessions are excluded unless includeBots=true, and internal sessions unless includeInternal=true.")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            int days = 30,
            int minAnswers = DefaultMinAnswers,
            bool includeBots = false,
            bool includeInternal = false,
            ApplicationDbContext db = null!,
            CancellationToken cancellationToken = default)
        {
            Result<Response> result = await HandleAsync(new QueryRequest(days, minAnswers, includeBots, includeInternal), db, cancellationToken);

            return result.Match(
                value => Results.Ok(value),
                _ => CustomResults.Problem(result));
        }
    }

    private sealed record AnswerRow(Guid ItemId, string SessionId, bool IsCorrect, DateTime OccurredUtc);

    public static async Task<Result<Response>> HandleAsync(
        QueryRequest request,
        ApplicationDbContext db,
        CancellationToken cancellationToken)
    {
        if (request.Days is < 1 or > PageViewRetentionService.RetentionDays)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.QuestionQuality.InvalidDays", $"Days must be between 1 and {PageViewRetentionService.RetentionDays}. Engagement data is kept for {PageViewRetentionService.RetentionDays} days; use the daily rollups report for longer ranges."));
        }

        if (request.MinAnswers is < 1 or > 10000)
        {
            return Result.Failure<Response>(
                Error.Validation("Admin.QuestionQuality.InvalidMinAnswers", "MinAnswers must be between 1 and 10000."));
        }

        DateTime windowEndUtc = DateTime.UtcNow;
        DateTime windowStartUtc = windowEndUtc.AddDays(-request.Days);

        IQueryable<AnalyticsEvent> windowQuery = db.AnalyticsEvents
            .AsNoTracking()
            .Where(analyticsEvent =>
                analyticsEvent.EventName == AnalyticsEventCatalog.QuestionAnswered &&
                analyticsEvent.OccurredUtc >= windowStartUtc &&
                analyticsEvent.OccurredUtc <= windowEndUtc);

        int botSessions = await windowQuery
            .Where(analyticsEvent => analyticsEvent.IsBot)
            .Select(analyticsEvent => analyticsEvent.SessionId)
            .Distinct()
            .CountAsync(cancellationToken);

        IQueryable<string> internalSessionIds = InternalTrafficFilter.InternalEventSessionIds(db, windowQuery);
        int internalSessions = await internalSessionIds.CountAsync(cancellationToken);

        IQueryable<AnalyticsEvent> query = request.IncludeBots
            ? windowQuery
            : windowQuery.Where(analyticsEvent => !analyticsEvent.IsBot);
        if (!request.IncludeInternal)
        {
            query = query.Where(analyticsEvent => !internalSessionIds.Contains(analyticsEvent.SessionId));
        }

        List<AnswerRow> answers = await query
            .Where(analyticsEvent => analyticsEvent.ItemId != null && analyticsEvent.IsCorrect != null)
            .Select(analyticsEvent => new AnswerRow(
                analyticsEvent.ItemId!.Value, analyticsEvent.SessionId, analyticsEvent.IsCorrect!.Value, analyticsEvent.OccurredUtc))
            .ToListAsync(cancellationToken);

        List<Guid> itemIds = answers.Select(answer => answer.ItemId).Distinct().ToList();
        Dictionary<Guid, ItemInfo> items = itemIds.Count == 0
            ? []
            : await db.Items.AsNoTracking()
                .Where(item => itemIds.Contains(item.Id))
                .Select(item => new ItemInfo(
                    item.Id,
                    item.Question,
                    item.CorrectAnswer,
                    item.IncorrectAnswers.Count,
                    item.Category == null ? null : item.Category.Name,
                    item.UpdatedAt,
                    item.QuestionImageKey,
                    item.QuestionImageAlt, item.QuestionImageAttribution, item.QuestionImageLongDescription, item.ImageRevision))
                .ToDictionaryAsync(item => item.Id, cancellationToken);

        List<QuestionStats> stats = [];
        foreach (IGrouping<Guid, AnswerRow> group in answers.GroupBy(answer => answer.ItemId))
        {
            if (!items.TryGetValue(group.Key, out ItemInfo? item))
            {
                continue;
            }

            // Editing an item resets its statistics: only answers after the last edit count.
            IEnumerable<AnswerRow> sinceEdit = item.UpdatedAt is null
                ? group
                : group.Where(answer => answer.OccurredUtc > item.UpdatedAt.Value);

            // First attempt: the earliest answer from each session for this item.
            List<AnswerRow> firstAttempts = sinceEdit
                .GroupBy(answer => answer.SessionId)
                .Select(sessionGroup => sessionGroup.OrderBy(answer => answer.OccurredUtc).First())
                .ToList();

            if (firstAttempts.Count < request.MinAnswers)
            {
                continue;
            }

            stats.Add(new QuestionStats(item, firstAttempts.Count, firstAttempts.Count(answer => answer.IsCorrect)));
        }

        List<QuestionStats> top = stats
            .OrderBy(stat => stat.Correct / (double)stat.Answers)
            .ThenByDescending(stat => stat.Answers)
            .ThenBy(stat => stat.Item.Id)
            .Take(MaxItems)
            .ToList();

        List<Guid> topIds = top.Select(stat => stat.Item.Id).ToList();
        ILookup<Guid, string> collectionNames = topIds.Count == 0
            ? Array.Empty<(Guid ItemId, string Name)>().ToLookup(pair => pair.ItemId, pair => pair.Name)
            : (await (from collectionItem in db.CollectionItems.AsNoTracking()
                      join collection in db.Collections.AsNoTracking() on collectionItem.CollectionId equals collection.Id
                      where topIds.Contains(collectionItem.ItemId)
                      select new { collectionItem.ItemId, collection.Name }).ToListAsync(cancellationToken))
                .ToLookup(row => row.ItemId, row => row.Name);

        List<QuestionResponse> responses = top
            .Select(stat =>
            {
                double rate = Math.Round(stat.Correct * 100.0 / stat.Answers, 1);
                double guess = Math.Round(100.0 / (stat.Item.IncorrectCount + 1), 1);
                return new QuestionResponse(
                    stat.Item.Id,
                    stat.Item.Question,
                    stat.Item.CorrectAnswer,
                    stat.Item.Category,
                    collectionNames[stat.Item.Id].OrderBy(name => name, StringComparer.OrdinalIgnoreCase).ToList(),
                    stat.Answers,
                    rate,
                    guess,
                    stat.Correct * 100.0 / stat.Answers < 100.0 / (stat.Item.IncorrectCount + 1),
                    stat.Item.UpdatedAt,
                    ItemImageReferenceHelper.FromColumns(stat.Item.QuestionImageKey, stat.Item.QuestionImageAlt, stat.Item.QuestionImageAttribution, stat.Item.QuestionImageLongDescription, stat.Item.ImageRevision));
            })
            .ToList();

        return Result.Success(new Response(
            windowStartUtc, windowEndUtc, request.MinAnswers, botSessions, !request.IncludeBots, internalSessions, !request.IncludeInternal, responses));
    }

    private sealed record ItemInfo(Guid Id, string Question, string CorrectAnswer, int IncorrectCount, string? Category, DateTime? UpdatedAt, string? QuestionImageKey, string? QuestionImageAlt, string? QuestionImageAttribution, string? QuestionImageLongDescription, int ImageRevision);

    private sealed record QuestionStats(ItemInfo Item, int Answers, int Correct);
}
