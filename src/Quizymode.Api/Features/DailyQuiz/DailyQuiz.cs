using Quizymode.Api.Shared.Helpers;
using System.Buffers.Binary;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.DailyQuiz;

/// <summary>
/// DAILY-001 (#119): one global daily quiz per UTC date. The set is chosen deterministically from the date seed the
/// first time the day is read and then stored, so every visitor gets the same items and an admin can replace one.
/// </summary>
public static class DailyQuiz
{
    public const int SetSize = 5;
    public const int RepeatWindowDays = 30;
    public const int MaxAdminDaysAhead = 7;
    private const int MaxStreakLookbackDays = 400;

    public sealed record CompletionDto(int Correct, int Total, DateTime CompletedAt, int Skipped = 0);

    /// <param name="Date">The UTC calendar date of the set, yyyy-MM-dd.</param>
    /// <param name="Items">The day's active items in slot order.</param>
    /// <param name="Completion">The caller's completion for this date; always null for anonymous callers.</param>
    /// <param name="Streak">Consecutive UTC days with a completion; null for anonymous callers (they keep it in the browser).</param>
    public sealed record DailyQuizResponse(
        string Date,
        List<GetItems.ItemResponse> Items,
        CompletionDto? Completion,
        int? Streak);

    // Skipped: questions skipped because their picture was unavailable (#403); they are not scored. Defaults to 0.
    public sealed record CompleteRequest(string Date, int Correct, int Total, int Skipped = 0);

    public sealed record CompleteResponse(bool Created, int Streak, CompletionDto Completion);

    public sealed record AdminItemDto(Guid ItemId, int Position, string Question, string? Category, bool Excluded, DateTime? ExcludedAt, ItemImageReference? QuestionImage = null);

    public sealed record AdminDayResponse(string Date, List<AdminItemDto> Items);

    public sealed class CompleteValidator : AbstractValidator<CompleteRequest>
    {
        public CompleteValidator()
        {
            RuleFor(x => x.Date).Must(d => TryParseDate(d, out _)).WithMessage("Date must be yyyy-MM-dd");
            RuleFor(x => x.Total).InclusiveBetween(1, SetSize);
            RuleFor(x => x.Skipped).GreaterThanOrEqualTo(0).LessThanOrEqualTo(x => x.Total);
            RuleFor(x => x.Correct).GreaterThanOrEqualTo(0).LessThanOrEqualTo(x => x.Total - x.Skipped);
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("daily-quiz", GetHandler)
                .WithTags("DailyQuiz")
                .WithSummary("Get today's daily quiz")
                .WithDescription("Today's (UTC) global set of up to 5 public items. Signed-in callers also get their completion for the day and streak.")
                .AllowAnonymous()
                .Produces<DailyQuizResponse>(StatusCodes.Status200OK);

            app.MapPost("daily-quiz/completions", CompleteHandler)
                .WithTags("DailyQuiz")
                .WithSummary("Record the current user's daily quiz completion")
                .WithDescription("Date must be today or yesterday (UTC) so a run that crosses midnight still counts. First write wins. Requires authentication.")
                .RequireAuthorization()
                .Produces<CompleteResponse>(StatusCodes.Status200OK)
                .Produces<CompleteResponse>(StatusCodes.Status201Created)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized);

            app.MapGet("admin/daily-quiz", AdminGetHandler)
                .WithTags("Admin")
                .WithSummary("Get a day's daily quiz set (Admin only)")
                .WithDescription("date is yyyy-MM-dd from today to 7 days ahead (UTC), default today; the set is created if missing. Lists active and excluded items.")
                .RequireAuthorization("Admin")
                .Produces<AdminDayResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest);

            app.MapPost("admin/daily-quiz/{date}/items/{itemId:guid}/exclude", AdminExcludeHandler)
                .WithTags("Admin")
                .WithSummary("Remove an item from a day's daily quiz (Admin only)")
                .WithDescription("Marks the item excluded for that date and fills its slot with the next eligible item in seed order. Completions already recorded keep their streak credit.")
                .RequireAuthorization("Admin")
                .Produces<AdminDayResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status404NotFound)
                .Produces(StatusCodes.Status409Conflict);
        }

        private static async Task<IResult> GetHandler(
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            return Results.Ok(await GetAsync(db, userContext, DateTime.UtcNow, cancellationToken));
        }

        private static async Task<IResult> CompleteHandler(
            CompleteRequest request,
            IValidator<CompleteRequest> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            var validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return CustomResults.BadRequest(string.Join("; ", validation.Errors.Select(e => e.ErrorMessage)), "Validation failed");
            }

            Result<CompleteResponse> result = await CompleteAsync(request, db, userContext.UserId, DateTime.UtcNow, cancellationToken);
            return result.Match(
                value => value.Created ? Results.Created("/api/daily-quiz", value) : Results.Ok(value),
                _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> AdminGetHandler(
            string? date,
            ApplicationDbContext db,
            CancellationToken cancellationToken)
        {
            Result<AdminDayResponse> result = await AdminGetAsync(date, db, DateTime.UtcNow, cancellationToken);
            return result.Match(Results.Ok, _ => CustomResults.Problem(result));
        }

        private static async Task<IResult> AdminExcludeHandler(
            string date,
            Guid itemId,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            Result<AdminDayResponse> result = await ExcludeAsync(date, itemId, db, userContext.UserId ?? "admin", DateTime.UtcNow, cancellationToken);
            return result.Match(Results.Ok, _ => CustomResults.Problem(result));
        }
    }

    public static async Task<DailyQuizResponse> GetAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        DateOnly today = DateOnly.FromDateTime(nowUtc);
        List<DailyQuizItem> set = await EnsureSetAsync(db, today, cancellationToken);
        List<Guid> ids = set.Where(s => s.ExcludedAt is null).OrderBy(s => s.Position).Select(s => s.ItemId).ToList();

        Dictionary<Guid, Item> items = await db.Items.AsNoTracking()
            .Include(i => i.Category)
            .Include(i => i.ItemKeywords).ThenInclude(ik => ik.Keyword)
            .Where(i => ids.Contains(i.Id) && !i.IsPrivate)
            .ToDictionaryAsync(i => i.Id, cancellationToken);
        ItemResponseMapper mapper = new(userContext);
        List<GetItems.ItemResponse> responses = ids
            .Where(items.ContainsKey)
            .Select(id => mapper.MapToResponse(items[id], new List<GetItems.CollectionResponse>()))
            .ToList();

        CompletionDto? completion = null;
        int? streak = null;
        if (userContext.IsAuthenticated && !string.IsNullOrEmpty(userContext.UserId))
        {
            List<DailyQuizCompletion> recent = await LoadRecentCompletionsAsync(db, userContext.UserId, today, cancellationToken);
            DailyQuizCompletion? todays = recent.FirstOrDefault(c => c.Date == today);
            completion = todays is null ? null : ToDto(todays);
            streak = ComputeStreak(recent.Select(c => c.Date), today);
        }

        return new DailyQuizResponse(FormatDate(today), responses, completion, streak);
    }

    public static async Task<Result<CompleteResponse>> CompleteAsync(
        CompleteRequest request,
        ApplicationDbContext db,
        string userId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        DateOnly today = DateOnly.FromDateTime(nowUtc);
        if (!TryParseDate(request.Date, out DateOnly date) || date > today || date < today.AddDays(-1))
        {
            return Result.Failure<CompleteResponse>(
                Error.Validation("DailyQuiz.InvalidDate", "Only today's or yesterday's daily quiz (UTC) can be completed."));
        }

        int activeItems = await db.DailyQuizItems.AsNoTracking()
            .CountAsync(d => d.Date == date && d.ExcludedAt == null, cancellationToken);
        if (activeItems == 0 || request.Total != activeItems)
        {
            return Result.Failure<CompleteResponse>(
                Error.Validation("DailyQuiz.TotalMismatch", "Total must equal the number of questions in that day's daily quiz."));
        }

        bool created = false;
        DailyQuizCompletion? existing = await db.DailyQuizCompletions.AsNoTracking()
            .FirstOrDefaultAsync(c => c.UserId == userId && c.Date == date, cancellationToken);
        if (existing is null)
        {
            DailyQuizCompletion entity = new()
            {
                UserId = userId,
                Date = date,
                Correct = request.Correct,
                Total = request.Total,
                Skipped = request.Skipped,
                CompletedAt = nowUtc,
            };
            db.DailyQuizCompletions.Add(entity);
            try
            {
                await db.SaveChangesAsync(cancellationToken);
                existing = entity;
                created = true;
            }
            catch (DbUpdateException)
            {
                // A concurrent submit for the same day won; the first stored result stands.
                db.ChangeTracker.Clear();
                existing = await db.DailyQuizCompletions.AsNoTracking()
                    .FirstAsync(c => c.UserId == userId && c.Date == date, cancellationToken);
            }
        }

        List<DailyQuizCompletion> recent = await LoadRecentCompletionsAsync(db, userId, today, cancellationToken);
        return Result.Success(new CompleteResponse(created, ComputeStreak(recent.Select(c => c.Date), today), ToDto(existing)));
    }

    public static async Task<Result<AdminDayResponse>> AdminGetAsync(
        string? date,
        ApplicationDbContext db,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        Result<DateOnly> parsed = ParseAdminDate(date, nowUtc);
        if (parsed.IsFailure) return Result.Failure<AdminDayResponse>(parsed.Error);

        List<DailyQuizItem> set = await EnsureSetAsync(db, parsed.Value, cancellationToken);
        return Result.Success(await ToAdminResponseAsync(db, parsed.Value, set, cancellationToken));
    }

    public static async Task<Result<AdminDayResponse>> ExcludeAsync(
        string date,
        Guid itemId,
        ApplicationDbContext db,
        string adminUserId,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        Result<DateOnly> parsed = ParseAdminDate(date, nowUtc);
        if (parsed.IsFailure) return Result.Failure<AdminDayResponse>(parsed.Error);
        DateOnly day = parsed.Value;

        await EnsureSetAsync(db, day, cancellationToken);
        DailyQuizItem? row = await db.DailyQuizItems.FirstOrDefaultAsync(d => d.Date == day && d.ItemId == itemId, cancellationToken);
        if (row is null || row.ExcludedAt is not null)
        {
            return Result.Failure<AdminDayResponse>(
                Error.NotFound("DailyQuiz.ItemNotInSet", "That item is not an active part of this day's daily quiz."));
        }

        row.ExcludedAt = nowUtc;
        row.ExcludedBy = adminUserId;

        List<DailyQuizItem> dayRows = await db.DailyQuizItems.Where(d => d.Date == day).ToListAsync(cancellationToken);
        HashSet<Guid> taken = dayRows.Select(d => d.ItemId).ToHashSet();
        List<Guid> candidates = await RankCandidatesAsync(db, day, taken, cancellationToken);
        if (candidates.Count > 0)
        {
            db.DailyQuizItems.Add(new DailyQuizItem
            {
                Date = day,
                ItemId = candidates[0],
                Position = row.Position,
                CreatedAt = nowUtc,
            });
        }
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // Another admin changed this day at the same moment (same item removed or same replacement chosen).
            db.ChangeTracker.Clear();
            return Result.Failure<AdminDayResponse>(
                Error.Conflict("DailyQuiz.ConcurrentChange", "This day's set was changed at the same time. Reload and try again."));
        }

        List<DailyQuizItem> updated = await db.DailyQuizItems.AsNoTracking().Where(d => d.Date == day).ToListAsync(cancellationToken);
        return Result.Success(await ToAdminResponseAsync(db, day, updated, cancellationToken));
    }

    /// <summary>
    /// Returns the stored set for the date, creating it from the date seed on first use. The header row and items are
    /// saved together, so concurrent creators conflict on the header and the loser reads the winner's set.
    /// </summary>
    internal static async Task<List<DailyQuizItem>> EnsureSetAsync(ApplicationDbContext db, DateOnly date, CancellationToken cancellationToken)
    {
        if (await db.DailyQuizSets.AsNoTracking().AnyAsync(s => s.Date == date, cancellationToken))
        {
            return await db.DailyQuizItems.AsNoTracking().Where(d => d.Date == date).ToListAsync(cancellationToken);
        }

        List<Guid> picked = (await RankCandidatesAsync(db, date, new HashSet<Guid>(), cancellationToken)).Take(SetSize).ToList();
        DateTime now = DateTime.UtcNow;
        List<DailyQuizItem> rows = picked
            .Select((id, index) => new DailyQuizItem { Date = date, ItemId = id, Position = index, CreatedAt = now })
            .ToList();
        // A day with nothing eligible still gets a header, so later reads do not recompute eligibility.
        db.DailyQuizSets.Add(new DailyQuizSet { Date = date, CreatedAt = now });
        db.DailyQuizItems.AddRange(rows);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
            db.ChangeTracker.Clear();
            return rows;
        }
        catch (DbUpdateException)
        {
            db.ChangeTracker.Clear();
            return await db.DailyQuizItems.AsNoTracking().Where(d => d.Date == date).ToListAsync(cancellationToken);
        }
    }

    /// <summary>
    /// Eligible items in seed order for the date: public, in a public category, with at least one playable wrong answer (#250: non-blank, not a duplicate, not equal to the correct answer), not flagged
    /// by the question quality report (#129), not in any other stored set within 30 days either side of the date (admins
    /// can create sets up to 7 days ahead), and not already taken for this date.
    /// </summary>
    internal static async Task<List<Guid>> RankCandidatesAsync(
        ApplicationDbContext db,
        DateOnly date,
        HashSet<Guid> taken,
        CancellationToken cancellationToken)
    {
        // IncorrectAnswers is a value-converted JSON column, so the playable check runs after projection.
        var rows = await db.Items.AsNoTracking()
            .Where(i => !i.IsPrivate && i.Category != null && !i.Category.IsPrivate)
            .Select(i => new { i.Id, i.CorrectAnswer, i.IncorrectAnswers })
            .ToListAsync(cancellationToken);

        DateOnly windowStart = date.AddDays(-RepeatWindowDays);
        DateOnly windowEnd = date.AddDays(RepeatWindowDays);
        HashSet<Guid> recent = (await db.DailyQuizItems.AsNoTracking()
                .Where(d => d.Date >= windowStart && d.Date <= windowEnd && d.Date != date)
                .Select(d => d.ItemId)
                .ToListAsync(cancellationToken))
            .ToHashSet();

        HashSet<Guid> flagged = await LoadQualityFlaggedAsync(db, cancellationToken);
        string seed = FormatDate(date);
        return rows
            .Where(r => QuizPlayability.IsPlayable(r.CorrectAnswer, r.IncorrectAnswers) && !recent.Contains(r.Id) && !flagged.Contains(r.Id) && !taken.Contains(r.Id))
            .Select(r => r.Id)
            .OrderBy(id => SeedRank(seed, id))
            .ThenBy(id => id)
            .ToList();
    }

    private static async Task<HashSet<Guid>> LoadQualityFlaggedAsync(ApplicationDbContext db, CancellationToken cancellationToken)
    {
        Result<GetQuestionQualityReport.Response> report = await GetQuestionQualityReport.HandleAsync(
            new GetQuestionQualityReport.QueryRequest(), db, cancellationToken);
        return report.IsSuccess
            ? report.Value.Items.Where(i => i.CheckAnswerKey).Select(i => i.ItemId).ToHashSet()
            : new HashSet<Guid>();
    }

    /// <summary>Stable across processes and platforms: first 8 bytes of SHA-256("yyyy-MM-dd:" + item id).</summary>
    internal static ulong SeedRank(string seed, Guid itemId)
    {
        byte[] hash = SHA256.HashData(Encoding.UTF8.GetBytes($"{seed}:{itemId:D}"));
        return BinaryPrimitives.ReadUInt64BigEndian(hash);
    }

    /// <summary>Consecutive days ending today, or ending yesterday when today is not completed yet.</summary>
    internal static int ComputeStreak(IEnumerable<DateOnly> completedDates, DateOnly today)
    {
        HashSet<DateOnly> days = completedDates.ToHashSet();
        DateOnly cursor = days.Contains(today) ? today : today.AddDays(-1);
        int streak = 0;
        while (days.Contains(cursor))
        {
            streak++;
            cursor = cursor.AddDays(-1);
        }
        return streak;
    }

    private static Task<List<DailyQuizCompletion>> LoadRecentCompletionsAsync(
        ApplicationDbContext db, string userId, DateOnly today, CancellationToken cancellationToken)
    {
        DateOnly since = today.AddDays(-MaxStreakLookbackDays);
        return db.DailyQuizCompletions.AsNoTracking()
            .Where(c => c.UserId == userId && c.Date >= since)
            .ToListAsync(cancellationToken);
    }

    private static async Task<AdminDayResponse> ToAdminResponseAsync(
        ApplicationDbContext db, DateOnly day, List<DailyQuizItem> set, CancellationToken cancellationToken)
    {
        List<Guid> ids = set.Select(s => s.ItemId).ToList();
        var items = await db.Items.AsNoTracking()
            .Where(i => ids.Contains(i.Id))
            .Select(i => new { i.Id, i.Question, Category = i.Category == null ? null : i.Category.Name, i.QuestionImageKey, i.QuestionImageAlt })
            .ToDictionaryAsync(i => i.Id, cancellationToken);
        List<AdminItemDto> rows = set
            .OrderBy(s => s.Position).ThenBy(s => s.ExcludedAt is null ? 1 : 0).ThenBy(s => s.ExcludedAt)
            .Select(s => new AdminItemDto(
                s.ItemId,
                s.Position,
                items.TryGetValue(s.ItemId, out var item) ? item.Question : "(item no longer exists)",
                items.TryGetValue(s.ItemId, out var meta) ? meta.Category : null,
                s.ExcludedAt is not null,
                s.ExcludedAt is null ? null : DateTime.SpecifyKind(s.ExcludedAt.Value, DateTimeKind.Utc),
                items.TryGetValue(s.ItemId, out var pic) ? ItemImageReferenceHelper.FromColumns(pic.QuestionImageKey, pic.QuestionImageAlt) : null))
            .ToList();
        return new AdminDayResponse(FormatDate(day), rows);
    }

    private static Result<DateOnly> ParseAdminDate(string? date, DateTime nowUtc)
    {
        DateOnly today = DateOnly.FromDateTime(nowUtc);
        if (string.IsNullOrWhiteSpace(date)) return Result.Success(today);
        if (!TryParseDate(date, out DateOnly day) || day < today || day > today.AddDays(MaxAdminDaysAhead))
        {
            return Result.Failure<DateOnly>(
                Error.Validation("DailyQuiz.InvalidDate", $"Date must be yyyy-MM-dd between today and {MaxAdminDaysAhead} days ahead (UTC)."));
        }
        return Result.Success(day);
    }

    internal static bool TryParseDate(string? value, out DateOnly date) =>
        DateOnly.TryParseExact(value, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out date);

    internal static string FormatDate(DateOnly date) => date.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static CompletionDto ToDto(DailyQuizCompletion c) =>
        new(c.Correct, c.Total, DateTime.SpecifyKind(c.CompletedAt, DateTimeKind.Utc), c.Skipped);

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<CompleteRequest>, CompleteValidator>();
        }
    }
}
