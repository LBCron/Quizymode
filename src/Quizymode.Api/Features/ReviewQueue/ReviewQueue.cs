using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.ReviewQueue;

/// <summary>
/// REVIEW-001 (#117): a fixed-interval review queue of items the signed-in user missed in quiz runs.
/// A miss is due the next day; a correct review advances one interval (1, 3, 7, 14, 30 days) and a correct review
/// at 30 days graduates the item out of the queue; an incorrect review resets to one day.
/// </summary>
public static class ReviewQueue
{
    public static readonly int[] IntervalDays = [1, 3, 7, 14, 30];
    public const int MaxItemsPerSession = 20;
    private const int ScanBatchSize = 50;

    public sealed record QueueResponse(
        List<GetItems.ItemResponse> Items,
        int DueCount,
        int TotalCount,
        DateTime? NextDueAt);

    public sealed record SummaryResponse(int DueCount, int TotalCount, DateTime? NextDueAt);

    public sealed record AnswerRequest(bool IsCorrect);

    /// <param name="ItemId">The queued item.</param>
    /// <param name="IntervalDays">Days until the item is due (always the first interval).</param>
    /// <param name="DueAt">When the item is due (UTC).</param>
    public sealed record EnqueueResponse(Guid ItemId, int IntervalDays, DateTime DueAt);

    /// <param name="ItemId">The answered item.</param>
    /// <param name="Applied">False when the entry was not due (for example a repeated submit); nothing changed.</param>
    /// <param name="Graduated">True when a correct review at the last interval removed the item from the queue.</param>
    /// <param name="IntervalDays">Days until the item is due again; null once graduated.</param>
    /// <param name="DueAt">When the item is due again (UTC); null once graduated.</param>
    public sealed record AnswerResponse(Guid ItemId, bool Applied, bool Graduated, int? IntervalDays, DateTime? DueAt);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("review-queue", QueueHandler)
                .WithTags("ReviewQueue")
                .WithSummary("Get the current user's due review items")
                .WithDescription("Up to 20 due items, oldest due first. Items that were deleted or made private are dropped silently; items edited since they were queued are re-surfaced at the first interval. Requires authentication.")
                .RequireAuthorization()
                .Produces<QueueResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized);

            app.MapGet("review-queue/summary", SummaryHandler)
                .WithTags("ReviewQueue")
                .WithSummary("Counts for the current user's review queue")
                .WithDescription("Due and total counts of available queued items and the next due time. Requires authentication.")
                .RequireAuthorization()
                .Produces<SummaryResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized);

            app.MapPost("review-queue/{itemId:guid}", EnqueueHandler)
                .WithTags("ReviewQueue")
                .WithSummary("Add an item to the current user's review queue")
                .WithDescription("Queues a public item, or the caller's own private item, at the first interval, due one day from now; an item already queued is reset to the first interval. Repeat calls keep one entry. A missing item, another user's private item and an item that cannot be played as a quiz question all return the same 404. Requires authentication.")
                .RequireAuthorization()
                .RequireRateLimiting("review-queue-enqueue")
                .Produces<EnqueueResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status429TooManyRequests);

            app.MapPost("review-queue/{itemId:guid}/answers", AnswerHandler)
                .WithTags("ReviewQueue")
                .WithSummary("Record a review answer for a queued item")
                .WithDescription("Correct advances one interval (graduating after 30 days); incorrect resets to one day. An entry that is not due is left unchanged (applied=false). Requires authentication.")
                .RequireAuthorization()
                .Produces<AnswerResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound);
        }

        private static async Task<IResult> QueueHandler(
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            return Results.Ok(await GetQueueAsync(db, userContext, DateTime.UtcNow, cancellationToken));
        }

        private static async Task<IResult> SummaryHandler(
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            return Results.Ok(await GetSummaryAsync(db, userContext.UserId, DateTime.UtcNow, cancellationToken));
        }

        private static async Task<IResult> EnqueueHandler(
            Guid itemId,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            EnqueueResponse? response = await EnqueueOneAsync(db, userContext.UserId, itemId, DateTime.UtcNow, cancellationToken);
            return response is null
                ? CustomResults.NotFound("This item can't be added to your review queue.", "Review item not found")
                : Results.Ok(response);
        }

        private static async Task<IResult> AnswerHandler(
            Guid itemId,
            AnswerRequest request,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            AnswerResponse? response = await AnswerAsync(db, userContext.UserId, itemId, request.IsCorrect, DateTime.UtcNow, cancellationToken);
            return response is null
                ? CustomResults.NotFound("This item is not in your review queue.", "Review item not found")
                : Results.Ok(response);
        }
    }

    /// <summary>
    /// Queues missed items from a newly recorded live quiz run: each existing item is (re)scheduled at the first
    /// interval, due one day from now (server time). Saves; a concurrent insert of the same entry is retried once.
    /// </summary>
    public static async Task EnqueueMissesAsync(
        ApplicationDbContext db,
        string userId,
        IReadOnlyCollection<Guid> missedItemIds,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        if (missedItemIds.Count == 0) return;
        List<Guid> ids = missedItemIds.Distinct().ToList();
        for (int attempt = 0; ; attempt++)
        {
            try
            {
                await UpsertMissesAsync(db, userId, ids, nowUtc, cancellationToken);
                await db.SaveChangesAsync(cancellationToken);
                return;
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // Another run of this user queued one of these items at the same moment; re-read and update instead.
                db.ChangeTracker.Clear();
            }
        }
    }

    /// <summary>
    /// Queues one item the caller can see and play (#251). Returns null for a missing, not-visible or unplayable
    /// item, without creating an entry.
    /// </summary>
    internal static async Task<EnqueueResponse?> EnqueueOneAsync(
        ApplicationDbContext db,
        string userId,
        Guid itemId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        Item? item = await db.Items.AsNoTracking()
            .FirstOrDefaultAsync(i => i.Id == itemId, cancellationToken);
        if (item is null
            || !ItemVisibility.IsVisibleTo(item, userId)
            || !QuizPlayability.IsPlayable(item.CorrectAnswer, item.IncorrectAnswers))
        {
            return null;
        }

        await EnqueueMissesAsync(db, userId, [itemId], nowUtc, cancellationToken);
        ReviewQueueEntry? entry = await db.ReviewQueueEntries.AsNoTracking()
            .FirstOrDefaultAsync(e => e.UserId == userId && e.ItemId == itemId, cancellationToken);
        return entry is null
            ? null
            : new EnqueueResponse(itemId, IntervalDays[entry.IntervalIndex], DateTime.SpecifyKind(entry.DueAt, DateTimeKind.Utc));
    }

    private static async Task UpsertMissesAsync(
        ApplicationDbContext db,
        string userId,
        List<Guid> ids,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var versions = await db.Items.AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .Select(i => new { i.Id, i.UpdatedAt, i.CreatedAt, i.CorrectAnswer, i.IncorrectAnswers })
            .ToListAsync(cancellationToken);
        // #251: unplayable legacy items (no usable distractor) are never queued.
        versions = versions.Where(v => QuizPlayability.IsPlayable(v.CorrectAnswer, v.IncorrectAnswers)).ToList();
        Dictionary<Guid, ReviewQueueEntry> existing = await db.ReviewQueueEntries
            .Where(e => e.UserId == userId && ids.Contains(e.ItemId))
            .ToDictionaryAsync(e => e.ItemId, cancellationToken);

        DateTime dueAt = nowUtc.AddDays(IntervalDays[0]);
        foreach (var version in versions)
        {
            DateTime itemVersion = version.UpdatedAt ?? version.CreatedAt;
            if (existing.TryGetValue(version.Id, out ReviewQueueEntry? entry))
            {
                entry.IntervalIndex = 0;
                entry.DueAt = dueAt;
                entry.ItemVersionAt = itemVersion;
                entry.UpdatedAt = nowUtc;
            }
            else
            {
                db.ReviewQueueEntries.Add(new ReviewQueueEntry
                {
                    UserId = userId,
                    ItemId = version.Id,
                    IntervalIndex = 0,
                    DueAt = dueAt,
                    ItemVersionAt = itemVersion,
                    CreatedAt = nowUtc,
                    UpdatedAt = nowUtc,
                });
            }
        }
    }

    public static async Task<QueueResponse> GetQueueAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        string userId = userContext.UserId!;
        await ResurfaceChangedAsync(db, userId, nowUtc, cancellationToken);

        List<Item> available = new();
        int scanned = 0;
        while (available.Count < MaxItemsPerSession)
        {
            // Removals are saved after the loop, so offsets stay stable while scanning.
            List<ReviewQueueEntry> batch = await db.ReviewQueueEntries
                .Where(e => e.UserId == userId && e.DueAt <= nowUtc)
                .OrderBy(e => e.DueAt).ThenBy(e => e.ItemId)
                .Skip(scanned)
                .Take(ScanBatchSize)
                .ToListAsync(cancellationToken);
            if (batch.Count == 0) break;
            scanned += batch.Count;

            List<Guid> batchIds = batch.Select(e => e.ItemId).ToList();
            Dictionary<Guid, Item> items = await db.Items.AsNoTracking()
                .Include(i => i.Category)
                .Include(i => i.ItemKeywords).ThenInclude(ik => ik.Keyword)
                .Where(i => batchIds.Contains(i.Id))
                .ToDictionaryAsync(i => i.Id, cancellationToken);

            foreach (ReviewQueueEntry entry in batch)
            {
                if (items.TryGetValue(entry.ItemId, out Item? item) && ItemVisibility.IsVisibleTo(item, userId) && QuizPlayability.IsPlayable(item.CorrectAnswer, item.IncorrectAnswers))
                {
                    if (available.Count < MaxItemsPerSession) available.Add(item);
                }
                else
                {
                    // Deleted, private to someone else, or otherwise unavailable: dropped silently (decision record #117).
                    db.ReviewQueueEntries.Remove(entry);
                }
            }

            if (batch.Count < ScanBatchSize) break;
        }
        await SaveTolerantAsync(db, cancellationToken);

        SummaryResponse summary = await GetSummaryAsync(db, userId, nowUtc, cancellationToken);
        ItemResponseMapper mapper = new(userContext);
        List<GetItems.ItemResponse> responses = available
            .Select(item => mapper.MapToResponse(item, new List<GetItems.CollectionResponse>()))
            .ToList();
        return new QueueResponse(responses, summary.DueCount, summary.TotalCount, summary.NextDueAt);
    }

    public static async Task<SummaryResponse> GetSummaryAsync(
        ApplicationDbContext db,
        string userId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        var rows = await (from entry in db.ReviewQueueEntries.AsNoTracking()
                          join item in db.Items.AsNoTracking() on entry.ItemId equals item.Id
                          where entry.UserId == userId
                                && ((!item.IsPrivate && (item.ImageReviewState == null || item.ImageReviewState == ItemImageReviewState.Approved)) || item.CreatedBy == userId)
                          select new { entry.DueAt, item.CorrectAnswer, item.IncorrectAnswers })
            .ToListAsync(cancellationToken);
        // #250: unplayable legacy items (no usable distractor) are never counted or served.
        rows = rows.Where(r => QuizPlayability.IsPlayable(r.CorrectAnswer, r.IncorrectAnswers)).ToList();
        int dueCount = rows.Count(r => r.DueAt <= nowUtc);
        DateTime? nextDue = rows.Where(r => r.DueAt > nowUtc).Select(r => (DateTime?)r.DueAt).Min();
        return new SummaryResponse(dueCount, rows.Count, nextDue is null ? null : DateTime.SpecifyKind(nextDue.Value, DateTimeKind.Utc));
    }

    public static async Task<AnswerResponse?> AnswerAsync(
        ApplicationDbContext db,
        string userId,
        Guid itemId,
        bool isCorrect,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        ReviewQueueEntry? entry = await db.ReviewQueueEntries
            .FirstOrDefaultAsync(e => e.UserId == userId && e.ItemId == itemId, cancellationToken);
        if (entry is null) return null;

        if (entry.DueAt > nowUtc)
        {
            return new AnswerResponse(itemId, false, false, IntervalDays[entry.IntervalIndex], DateTime.SpecifyKind(entry.DueAt, DateTimeKind.Utc));
        }

        if (isCorrect && entry.IntervalIndex >= IntervalDays.Length - 1)
        {
            db.ReviewQueueEntries.Remove(entry);
            bool removed = await SaveTolerantAsync(db, cancellationToken);
            return new AnswerResponse(itemId, removed, removed, null, null);
        }

        entry.IntervalIndex = isCorrect ? entry.IntervalIndex + 1 : 0;
        entry.DueAt = nowUtc.AddDays(IntervalDays[entry.IntervalIndex]);
        entry.LastReviewedAt = nowUtc;
        entry.UpdatedAt = nowUtc;
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            // A concurrent answer graduated or removed the entry first; treat this one as not applied.
            return new AnswerResponse(itemId, false, false, null, null);
        }
        return new AnswerResponse(itemId, true, false, IntervalDays[entry.IntervalIndex], DateTime.SpecifyKind(entry.DueAt, DateTimeKind.Utc));
    }

    /// <summary>
    /// Items changed after they were queued are treated as a fresh miss: first interval, due one day from now.
    /// Item.UpdatedAt is the change signal, so admin moderation or recategorization also counts as a change.
    /// </summary>
    private static async Task ResurfaceChangedAsync(ApplicationDbContext db, string userId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        // No AsNoTracking here: it would apply to the whole query and the entry updates would never be saved.
        var changed = await (from entry in db.ReviewQueueEntries
                             join item in db.Items on entry.ItemId equals item.Id
                             where entry.UserId == userId && item.UpdatedAt != null && item.UpdatedAt > entry.ItemVersionAt
                             select new { entry, item.UpdatedAt })
            .ToListAsync(cancellationToken);
        foreach (var row in changed)
        {
            row.entry.IntervalIndex = 0;
            row.entry.ItemVersionAt = row.UpdatedAt!.Value;
            row.entry.DueAt = nowUtc.AddDays(IntervalDays[0]);
            row.entry.UpdatedAt = nowUtc;
        }
        // Saved before the due scan, so a re-surfaced entry that was due is no longer returned as due.
        if (changed.Count > 0) await SaveTolerantAsync(db, cancellationToken);
    }

    /// <summary>Overlapping requests may remove or update the same entry; the other request's result stands.</summary>
    private static async Task<bool> SaveTolerantAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            return true;
        }
        catch (DbUpdateConcurrencyException)
        {
            db.ChangeTracker.Clear();
            return false;
        }
    }
}
