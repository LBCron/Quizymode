using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Features.Collections;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.StudyPlans;

/// <summary>
/// #364: a signed-in user's test date for a collection. The client derives the daily step; the server stores one row per
/// (user, collection) and reports the user's Learn/Quiz activity on that collection as two timestamps.
/// </summary>
public static class StudyPlans
{
    public const int MaxPlans = 5;
    public const int MaxDaysAhead = 30;
    public const int ActivityLookbackDays = 14;
    internal const int PruneAfterDays = 2;
    internal const string LimitReachedCode = "StudyPlans.LimitReached";
    internal const string InvalidDateCode = "StudyPlans.InvalidDate";

    public sealed record UpsertRequest(string? TestDate);

    /// <param name="CollectionId">The planned collection.</param>
    /// <param name="Available">False when the collection is gone or no longer visible to the user.</param>
    /// <param name="CollectionName">Null when unavailable (no name leak).</param>
    /// <param name="ItemCount">Items in the collection; 0 when unavailable.</param>
    /// <param name="TestDate">yyyy-MM-dd, a calendar day without a time zone.</param>
    /// <param name="CreatedAt">When the plan was first created, UTC.</param>
    /// <param name="FirstLearnAt">Earliest Learn run of this collection on or after (plan created minus 14 days), UTC.</param>
    /// <param name="LastActivityAt">Latest Learn or Quiz run of this collection in the same window, UTC.</param>
    public sealed record StudyPlanDto(
        Guid CollectionId,
        bool Available,
        string? CollectionName,
        int ItemCount,
        string TestDate,
        DateTime CreatedAt,
        DateTime? FirstLearnAt,
        DateTime? LastActivityAt);

    public sealed record ListResponse(List<StudyPlanDto> Plans);

    public sealed class UpsertValidator : AbstractValidator<UpsertRequest>
    {
        public UpsertValidator() : this(TimeProvider.System)
        {
        }

        public UpsertValidator(TimeProvider timeProvider)
        {
            RuleFor(x => x.TestDate)
                .Must(value => DailyQuiz.DailyQuiz.TryParseDate(value, out _))
                .WithMessage("Test date must be a valid yyyy-MM-dd date.")
                .Must(value =>
                {
                    DailyQuiz.DailyQuiz.TryParseDate(value, out DateOnly day);
                    DateOnly today = UtcToday(timeProvider.GetUtcNow().UtcDateTime);
                    return day >= today.AddDays(-1) && day <= today.AddDays(MaxDaysAhead + 1);
                })
                .WithMessage($"Test date must be within {MaxDaysAhead} days from today.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("study-plans", ListEndpoint)
                .WithTags("StudyPlans")
                .WithSummary("List the current user's test-date plans")
                .WithDescription("Ordered by test date. Plans whose test date passed more than 2 days ago are removed. Each plan reports the user's first Learn and latest Learn/Quiz activity on the collection (within 14 days before the plan was created, or later); a collection that is no longer visible to the user is reported unavailable without its name. Requires authentication.")
                .RequireAuthorization()
                .Produces<ListResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized);

            app.MapPut("study-plans/{collectionId:guid}", UpsertEndpoint)
                .WithTags("StudyPlans")
                .WithSummary("Create or change the test date for a collection")
                .WithDescription("testDate is yyyy-MM-dd, from yesterday (UTC) to 31 days ahead. At most 5 upcoming plans per user (StudyPlans.LimitReached); changing an existing plan is always allowed. 404 with an empty body when the collection does not exist or is not visible to the user. Requires authentication.")
                .RequireAuthorization()
                .Produces<StudyPlanDto>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status404NotFound);

            app.MapDelete("study-plans/{collectionId:guid}", DeleteEndpoint)
                .WithTags("StudyPlans")
                .WithSummary("Remove the current user's test-date plan for a collection")
                .WithDescription("Idempotent: 204 whether or not a plan existed. Only the caller's own plan can be removed. Requires authentication.")
                .RequireAuthorization()
                .Produces(StatusCodes.Status204NoContent)
                .Produces(StatusCodes.Status401Unauthorized);
        }

        private static async Task<IResult> ListEndpoint(
            ApplicationDbContext db,
            IUserContext userContext,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            return Results.Ok(await ListAsync(db, userContext, timeProvider.GetUtcNow().UtcDateTime, cancellationToken));
        }

        private static async Task<IResult> UpsertEndpoint(
            Guid collectionId,
            UpsertRequest request,
            IValidator<UpsertRequest> validator,
            ApplicationDbContext db,
            IUserContext userContext,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            Result<StudyPlanDto> result = await UpsertAsync(
                collectionId, request, validator, db, userContext, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
            return result.Match(
                Results.Ok,
                failure => failure.Error.Type == ErrorType.NotFound ? Results.NotFound() : CustomResults.Problem(result));
        }

        private static async Task<IResult> DeleteEndpoint(
            Guid collectionId,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }
            await DeleteAsync(collectionId, db, userContext.UserId, cancellationToken);
            return Results.NoContent();
        }
    }

    internal static DateOnly UtcToday(DateTime nowUtc) => DateOnly.FromDateTime(nowUtc);

    public static async Task<ListResponse> ListAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        string userId = userContext.UserId!;
        await PruneAsync(db, userId, nowUtc, cancellationToken);

        List<StudyPlan> plans = await db.StudyPlans.AsNoTracking()
            .Where(p => p.UserId == userId)
            .ToListAsync(cancellationToken);
        plans = plans.OrderBy(p => p.TestDate).ThenBy(p => p.CreatedAt).ThenBy(p => p.CollectionId).ToList();
        return new ListResponse(await ToDtosAsync(db, userContext, plans, cancellationToken));
    }

    public static async Task<Result<StudyPlanDto>> UpsertAsync(
        Guid collectionId,
        UpsertRequest request,
        IValidator<UpsertRequest> validator,
        ApplicationDbContext db,
        IUserContext userContext,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        string userId = userContext.UserId!;
        FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            return Result.Failure<StudyPlanDto>(Error.Validation(
                InvalidDateCode, string.Join("; ", validation.Errors.Select(e => e.ErrorMessage))));
        }
        DailyQuiz.DailyQuiz.TryParseDate(request.TestDate, out DateOnly testDate);

        // Identical empty 404 for "missing" and "not visible" so a private collection's existence is not revealed.
        Collection? collection = await db.Collections.AsNoTracking().FirstOrDefaultAsync(c => c.Id == collectionId, cancellationToken);
        if (collection is null || !GetCollectionById.CanAccess(collection, userContext))
        {
            return Result.Failure<StudyPlanDto>(Error.NotFound("StudyPlans.CollectionNotFound", "Collection not found"));
        }

        StudyPlan? saved = null;
        for (int attempt = 0; saved is null; attempt++)
        {
            try
            {
                await PruneAsync(db, userId, nowUtc, cancellationToken);
                StudyPlan? existing = await db.StudyPlans.FirstOrDefaultAsync(
                    p => p.UserId == userId && p.CollectionId == collectionId, cancellationToken);
                if (existing is null)
                {
                    DateOnly today = UtcToday(nowUtc);
                    int upcoming = await db.StudyPlans.CountAsync(p => p.UserId == userId && p.TestDate >= today, cancellationToken);
                    if (upcoming >= MaxPlans)
                    {
                        return Result.Failure<StudyPlanDto>(Error.Validation(
                            LimitReachedCode, $"You can plan up to {MaxPlans} tests at a time."));
                    }
                    existing = new StudyPlan { UserId = userId, CollectionId = collectionId, CreatedAt = nowUtc };
                    db.StudyPlans.Add(existing);
                }
                existing.TestDate = testDate;
                existing.UpdatedAt = nowUtc;
                await db.SaveChangesAsync(cancellationToken);
                saved = existing;
            }
            catch (DbUpdateException) when (attempt == 0)
            {
                // A concurrent request created the same plan; re-read and update it instead.
                db.ChangeTracker.Clear();
            }
        }

        List<StudyPlanDto> dtos = await ToDtosAsync(db, userContext, [saved], cancellationToken);
        return Result.Success(dtos[0]);
    }

    public static async Task DeleteAsync(Guid collectionId, ApplicationDbContext db, string userId, CancellationToken cancellationToken)
    {
        await db.StudyPlans
            .Where(p => p.UserId == userId && p.CollectionId == collectionId)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static async Task PruneAsync(ApplicationDbContext db, string userId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        DateOnly cutoff = UtcToday(nowUtc).AddDays(-PruneAfterDays);
        await db.StudyPlans
            .Where(p => p.UserId == userId && p.TestDate < cutoff)
            .ExecuteDeleteAsync(cancellationToken);
    }

    private static async Task<List<StudyPlanDto>> ToDtosAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        List<StudyPlan> plans,
        CancellationToken cancellationToken)
    {
        if (plans.Count == 0) return [];
        string userId = userContext.UserId!;
        List<Guid> ids = plans.Select(p => p.CollectionId).ToList();

        Dictionary<Guid, Collection> collections = await db.Collections.AsNoTracking()
            .Where(c => ids.Contains(c.Id))
            .ToDictionaryAsync(c => c.Id, cancellationToken);
        HashSet<Guid> availableIds = collections.Values
            .Where(c => GetCollectionById.CanAccess(c, userContext))
            .Select(c => c.Id)
            .ToHashSet();
        List<Guid> availableList = availableIds.ToList();

        Dictionary<Guid, int> counts = availableList.Count == 0
            ? []
            : await ItemVisibility.EligibleCollectionItems(db, userId).AsNoTracking()
                .Where(ci => availableList.Contains(ci.CollectionId))
                .GroupBy(ci => ci.CollectionId)
                .Select(g => new { CollectionId = g.Key, Count = g.Count() })
                .ToDictionaryAsync(x => x.CollectionId, x => x.Count, cancellationToken);

        DateTime earliest = plans.Min(p => p.CreatedAt).AddDays(-ActivityLookbackDays);
        var sessions = await db.StudySessions.AsNoTracking()
            .Where(s => s.UserId == userId
                && s.SourceKind == "collection"
                && s.SourceCollectionId != null
                && ids.Contains(s.SourceCollectionId.Value)
                && s.CompletedAt >= earliest)
            .Select(s => new { CollectionId = s.SourceCollectionId!.Value, s.Mode, s.CompletedAt })
            .ToListAsync(cancellationToken);

        return plans.Select(plan =>
        {
            bool available = availableIds.Contains(plan.CollectionId);
            DateTime? firstLearn = null;
            DateTime? last = null;
            if (available)
            {
                DateTime from = plan.CreatedAt.AddDays(-ActivityLookbackDays);
                var inWindow = sessions.Where(s => s.CollectionId == plan.CollectionId && s.CompletedAt >= from).ToList();
                if (inWindow.Count > 0)
                {
                    last = inWindow.Max(s => s.CompletedAt);
                    List<DateTime> learns = inWindow.Where(s => s.Mode == StudySessionModes.Learn).Select(s => s.CompletedAt).ToList();
                    if (learns.Count > 0) firstLearn = learns.Min();
                }
            }

            return new StudyPlanDto(
                plan.CollectionId,
                available,
                available ? collections[plan.CollectionId].Name : null,
                available ? counts.GetValueOrDefault(plan.CollectionId) : 0,
                DailyQuiz.DailyQuiz.FormatDate(plan.TestDate),
                Utc(plan.CreatedAt),
                firstLearn is null ? null : Utc(firstLearn.Value),
                last is null ? null : Utc(last.Value));
        }).ToList();
    }

    private static DateTime Utc(DateTime value) => DateTime.SpecifyKind(value, DateTimeKind.Utc);

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.TryAddSingleton(TimeProvider.System);
            services.AddScoped<IValidator<UpsertRequest>, UpsertValidator>();
        }
    }
}
