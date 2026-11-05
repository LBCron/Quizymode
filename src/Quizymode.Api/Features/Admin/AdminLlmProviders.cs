using System.Text.RegularExpressions;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.StudyGuideDocuments;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.Admin;

/// <summary>
/// Admin: AI providers (AC 5.12). Choose the model per vendor and the ordered vendor fallback route per tier, see whether
/// each vendor's API key is configured (keys themselves come only from configuration and are never returned), the global
/// monthly section budget, and recent vendor attempts.
/// </summary>
public static partial class AdminLlmProviders
{
    public const int MaxAttempts = 200;

    /// <summary><paramref name="CoolingDownUntilUtc"/> is set while the vendor is skipped after an HTTP 429 (in-memory, this API instance).</summary>
    public sealed record VendorResponse(string Vendor, bool KeyConfigured, string Model, DateTime? CoolingDownUntilUtc);

    public sealed record Routes(List<string> Free, List<string> Premium);

    public sealed record Response(List<VendorResponse> Vendors, Routes Routes, int MonthlySectionBudget, int MonthlySectionsUsed);

    public sealed record VendorModel(string Vendor, string Model);

    public sealed record UpdateRequest(List<VendorModel>? Vendors, Routes? Routes);

    public sealed record AttemptResponse(
        DateTime CreatedUtc,
        string Vendor,
        string Model,
        string Outcome,
        int? InputTokens,
        int? OutputTokens,
        int DurationMs,
        int? HttpStatus);

    public sealed record AttemptsResponse(List<AttemptResponse> Attempts);

    public const int DefaultUsageDays = 30;
    public const int MaxUsageDays = 90;
    public const int MaxTopUsers = 20;

    public sealed record UsageRow(
        string Vendor,
        string Model,
        int Attempts,
        int Successes,
        long InputTokens,
        long OutputTokens,
        int AvgDurationMs,
        decimal? EstimatedCostUsd);

    public sealed record TopUser(string UserId, int ChargedSections, long InputTokens, long OutputTokens);

    public sealed record UsageResponse(int Days, DateTime SinceUtc, List<UsageRow> Rows, List<TopUser> TopUsers);

    public sealed class UpdateValidator : AbstractValidator<UpdateRequest>
    {
        public UpdateValidator()
        {
            RuleFor(x => x.Vendors)
                .NotNull()
                .WithMessage("Vendors are required.")
                .Must(vendors => vendors is null ||
                    vendors.Select(vendor => LlmVendors.Normalize(vendor.Vendor)).Distinct().Count() == vendors.Count)
                .WithMessage("Each vendor may appear only once.");

            RuleForEach(x => x.Vendors).ChildRules(vendor =>
            {
                vendor.RuleFor(v => v.Vendor)
                    .Must(name => LlmVendors.Normalize(name) is not null)
                    .WithMessage($"Vendor must be one of: {string.Join(", ", LlmVendors.All)}.");
                vendor.RuleFor(v => v.Model)
                    .NotEmpty()
                    .WithMessage("Model is required.")
                    .MaximumLength(100)
                    .WithMessage("Model must not exceed 100 characters.")
                    .Matches(ModelRegex())
                    .WithMessage("Model may contain only letters, digits, '.', '_', ':', '-', and '/'.");
            });

            RuleFor(x => x.Routes)
                .NotNull()
                .WithMessage("Routes are required.");

            RuleFor(x => x.Routes!.Free)
                .Must(IsValidRoute)
                .WithMessage("The free route must list 1 to 5 distinct known vendors.")
                .When(x => x.Routes is not null);

            RuleFor(x => x.Routes!.Premium)
                .Must(IsValidRoute)
                .WithMessage("The premium route must list 1 to 5 distinct known vendors.")
                .When(x => x.Routes is not null);
        }

        private static bool IsValidRoute(List<string>? route) =>
            route is { Count: >= 1 } && route.Count <= LlmVendors.All.Count &&
            route.All(vendor => LlmVendors.Normalize(vendor) is not null) &&
            route.Select(LlmVendors.Normalize).Distinct().Count() == route.Count;
    }

    [GeneratedRegex(@"^[A-Za-z0-9._:\-/]+$")]
    private static partial Regex ModelRegex();

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/llm-providers", GetHandler)
                .WithTags("Admin")
                .WithSummary("Get LLM vendor models, routes, key status, and the monthly section budget (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);

            app.MapPut("admin/llm-providers", UpdateHandler)
                .WithTags("Admin")
                .WithSummary("Update LLM vendor models and per-tier routes (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<Response>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);

            app.MapGet("admin/llm-providers/attempts", AttemptsHandler)
                .WithTags("Admin")
                .WithSummary("List recent LLM vendor attempts, newest first, at most 200 (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<AttemptsResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);

            app.MapGet("admin/llm-providers/usage", UsageHandler)
                .WithTags("Admin")
                .WithSummary("Summarize LLM vendor calls, tokens, and estimated cost per vendor and model, plus top users (Admin only)")
                .WithDescription("days defaults to 30 and must be 1 to 90 (400 otherwise). Estimated cost uses the optional LlmPricing configuration.")
                .RequireAuthorization("Admin")
                .Produces<UsageResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);
        }

        private static async Task<IResult> UsageHandler(
            int? days,
            ApplicationDbContext db,
            IConfiguration configuration,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            int window = days ?? DefaultUsageDays;
            if (window is < 1 or > MaxUsageDays)
            {
                return Results.BadRequest(new { error = $"days must be between 1 and {MaxUsageDays}." });
            }

            return Results.Ok(await HandleUsageAsync(window, db, configuration, timeProvider.GetUtcNow().UtcDateTime, cancellationToken));
        }

        private static async Task<IResult> GetHandler(
            ApplicationDbContext db,
            ILlmVendorRegistry vendors,
            LlmVendorCooldowns cooldowns,
            IOptions<StudyGuideGenerationOptions> options,
            TimeProvider timeProvider,
            CancellationToken cancellationToken) =>
            Results.Ok(await HandleGetAsync(db, vendors, cooldowns, options.Value, timeProvider.GetUtcNow().UtcDateTime, cancellationToken));

        private static async Task<IResult> UpdateHandler(
            UpdateRequest request,
            IValidator<UpdateRequest> validator,
            ApplicationDbContext db,
            ILlmVendorRegistry vendors,
            LlmVendorCooldowns cooldowns,
            IOptions<StudyGuideGenerationOptions> options,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return Results.BadRequest(validation.Errors);
            }

            return Results.Ok(await HandleUpdateAsync(request, db, vendors, cooldowns, options.Value, timeProvider.GetUtcNow().UtcDateTime, cancellationToken));
        }

        private static async Task<IResult> AttemptsHandler(
            int? days,
            ApplicationDbContext db,
            TimeProvider timeProvider,
            CancellationToken cancellationToken) =>
            Results.Ok(await HandleAttemptsAsync(days, db, timeProvider.GetUtcNow().UtcDateTime, cancellationToken));
    }

    internal static async Task<Response> HandleGetAsync(
        ApplicationDbContext db,
        ILlmVendorRegistry vendors,
        LlmVendorCooldowns cooldowns,
        StudyGuideGenerationOptions options,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(db, cancellationToken);
        int used = await StudyGuideQuota.GlobalMonthlyUsedAsync(db, nowUtc, cancellationToken);
        return ToResponse(settings, vendors, cooldowns, options.MonthlySectionBudget, used);
    }

    internal static async Task<Response> HandleUpdateAsync(
        UpdateRequest request,
        ApplicationDbContext db,
        ILlmVendorRegistry vendors,
        LlmVendorCooldowns cooldowns,
        StudyGuideGenerationOptions options,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        LlmProviderSettings settings = await LlmProviderSettingsStore.GetOrCreateAsync(db, cancellationToken);
        foreach (VendorModel vendor in request.Vendors ?? [])
        {
            string? name = LlmVendors.Normalize(vendor.Vendor);
            if (name is not null)
            {
                LlmProviderSettingsStore.SetModel(settings, name, vendor.Model.Trim());
            }
        }

        if (request.Routes is not null)
        {
            settings.RouteFree = LlmProviderSettingsStore.FormatRoute(LlmProviderSettingsStore.ParseRoute(string.Join(",", request.Routes.Free)));
            settings.RoutePremium = LlmProviderSettingsStore.FormatRoute(LlmProviderSettingsStore.ParseRoute(string.Join(",", request.Routes.Premium)));
        }

        settings.UpdatedUtc = nowUtc;
        await db.SaveChangesAsync(cancellationToken);

        int used = await StudyGuideQuota.GlobalMonthlyUsedAsync(db, nowUtc, cancellationToken);
        return ToResponse(settings, vendors, cooldowns, options.MonthlySectionBudget, used);
    }

    internal static async Task<AttemptsResponse> HandleAttemptsAsync(
        int? days,
        ApplicationDbContext db,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        DateTime since = nowUtc.AddDays(-Math.Clamp(days ?? 7, 1, 90));
        List<LlmAttempt> attempts = await db.LlmAttempts
            .AsNoTracking()
            .Where(attempt => attempt.CreatedUtc >= since)
            .OrderByDescending(attempt => attempt.CreatedUtc)
            .Take(MaxAttempts)
            .ToListAsync(cancellationToken);

        return new AttemptsResponse(attempts
            .Select(attempt => new AttemptResponse(
                attempt.CreatedUtc,
                attempt.Vendor,
                attempt.Model,
                attempt.Outcome.ToString(),
                attempt.InputTokens,
                attempt.OutputTokens,
                attempt.DurationMs,
                attempt.HttpStatus))
            .ToList());
    }

    internal sealed record UsageRowAggregate(
        string Vendor,
        string Model,
        int Attempts,
        int Successes,
        long InputTokens,
        long OutputTokens,
        long DurationSumMs);

    internal sealed record TopUserAggregate(string UserId, int ChargedSections, long InputTokens, long OutputTokens);

    /// <summary>One grouped query: a row per (vendor, model) with sums computed by the database.</summary>
    internal static IQueryable<UsageRowAggregate> BuildRowAggregatesQuery(ApplicationDbContext db, DateTime since) =>
        db.LlmAttempts
            .AsNoTracking()
            .Where(attempt => attempt.CreatedUtc >= since)
            .GroupBy(attempt => new { attempt.Vendor, attempt.Model })
            .Select(group => new UsageRowAggregate(
                group.Key.Vendor,
                group.Key.Model,
                group.Count(),
                group.Count(attempt => attempt.Outcome == LlmAttemptOutcome.Success),
                group.Sum(attempt => (long)(attempt.InputTokens ?? 0)),
                group.Sum(attempt => (long)(attempt.OutputTokens ?? 0)),
                group.Sum(attempt => (long)attempt.DurationMs)));

    /// <summary>
    /// One grouped query: a row per user. Charges have no unique (user, generation), so they are grouped per pair first
    /// (cost adds up, the generation's tokens count once), then left-joined to the generations (a charge without a
    /// generation row counts 0 tokens) and grouped per user.
    /// </summary>
    internal static IQueryable<TopUserAggregate> BuildTopUserAggregatesQuery(ApplicationDbContext db, DateTime since)
    {
        var pairs = db.StudyGuideQuotaCharges
            .AsNoTracking()
            .Where(charge => charge.ChargedUtc >= since)
            .GroupBy(charge => new { charge.UserId, charge.GenerationId })
            .Select(group => new { group.Key.UserId, group.Key.GenerationId, Cost = group.Sum(charge => charge.Cost) });

        return from pair in pairs
               join generation in db.SectionGenerations on pair.GenerationId equals generation.Id into generations
               from generation in generations.DefaultIfEmpty()
               group new
               {
                   pair.Cost,
                   Input = generation == null ? 0L : (long)(generation.InputTokens ?? 0),
                   Output = generation == null ? 0L : (long)(generation.OutputTokens ?? 0)
               } by pair.UserId into user
               select new TopUserAggregate(
                   user.Key,
                   user.Sum(x => x.Cost),
                   user.Sum(x => x.Input),
                   user.Sum(x => x.Output));
    }

    /// <summary>
    /// Per vendor/model totals of the attempts in the window (failed attempts' tokens included) and the top users by
    /// charged sections. Totals are aggregated in the database (two grouped queries, no attempt or charge rows are
    /// loaded); ordering, the top-20 cut, average rounding and pricing are applied in memory so results do not depend
    /// on the database collation and the same code runs on every provider.
    /// </summary>
    internal static async Task<UsageResponse> HandleUsageAsync(
        int days,
        ApplicationDbContext db,
        IConfiguration configuration,
        DateTime nowUtc,
        CancellationToken cancellationToken)
    {
        DateTime since = nowUtc.AddDays(-days);

        List<UsageRowAggregate> aggregates = await BuildRowAggregatesQuery(db, since).ToListAsync(cancellationToken);
        List<UsageRow> rows = aggregates
            .OrderBy(aggregate => aggregate.Vendor, StringComparer.Ordinal)
            .ThenBy(aggregate => aggregate.Model, StringComparer.Ordinal)
            .Select(aggregate => new UsageRow(
                aggregate.Vendor,
                aggregate.Model,
                aggregate.Attempts,
                aggregate.Successes,
                aggregate.InputTokens,
                aggregate.OutputTokens,
                (int)Math.Round((double)aggregate.DurationSumMs / aggregate.Attempts, MidpointRounding.AwayFromZero),
                LlmPricing.EstimateCostUsd(configuration, aggregate.Vendor, aggregate.Model, aggregate.InputTokens, aggregate.OutputTokens)))
            .ToList();

        List<TopUserAggregate> users = await BuildTopUserAggregatesQuery(db, since).ToListAsync(cancellationToken);
        List<TopUser> topUsers = users
            .Select(user => new TopUser(user.UserId, user.ChargedSections, user.InputTokens, user.OutputTokens))
            .OrderByDescending(user => user.ChargedSections)
            .ThenByDescending(user => user.InputTokens + user.OutputTokens)
            .ThenBy(user => user.UserId, StringComparer.Ordinal)
            .Take(MaxTopUsers)
            .ToList();

        return new UsageResponse(days, since, rows, topUsers);
    }

    private static Response ToResponse(LlmProviderSettings settings, ILlmVendorRegistry vendors, LlmVendorCooldowns cooldowns, int budget, int used) =>
        new(
            LlmVendors.All
                .Select(vendor => new VendorResponse(
                    vendor,
                    vendors.IsConfigured(vendor),
                    LlmProviderSettingsStore.ModelFor(settings, vendor),
                    cooldowns.CoolingDownUntil(vendor)?.UtcDateTime))
                .ToList(),
            new Routes(
                LlmProviderSettingsStore.RouteFor(settings, StudyGuideTier.Free),
                LlmProviderSettingsStore.RouteFor(settings, StudyGuideTier.Premium)),
            budget,
            used);

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddScoped<IValidator<UpdateRequest>, UpdateValidator>();
        }
    }
}
