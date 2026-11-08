using System.Globalization;
using FluentValidation;
using FluentValidation.Results;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Email;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>Admin endpoints for the daily maintainer digest (#509): preview, test send, ad hoc send and run history.</summary>
internal static class DailyDigestAdmin
{
    internal const int PreviewMaxDaysBack = 180;
    internal const int MaxAdHocDays = 31;
    internal static readonly TimeSpan TestSendCooldown = TimeSpan.FromMinutes(5);
    internal static readonly TimeSpan AdHocCooldown = TimeSpan.FromMinutes(1);

    /// <summary>Tolerated client clock skew for "to" in the ad hoc window.</summary>
    internal static readonly TimeSpan FutureTolerance = TimeSpan.FromMinutes(2);

    public sealed record PreviewResponse(DateOnly ReportDate, DateTime WindowStartUtc, DateTime WindowEndUtc, DigestReport Summary, string Subject, string TextBody);

    public sealed record TestSendResponse(string Subject);

    public sealed record SendNowRequest(DateTimeOffset From, DateTimeOffset To);

    public sealed record SendNowResponse(Guid Id, string Status, DateTime WindowStartUtc, DateTime WindowEndUtc);

    public sealed record RunResponse(
        Guid Id,
        string Kind,
        DateOnly ReportDate,
        string Status,
        int Attempts,
        DateTime WindowStartUtc,
        DateTime WindowEndUtc,
        DateTime? SentUtc,
        string? LastError,
        DateTime? NextAttemptUtc,
        DateTime CreatedUtc);

    public sealed record RunsResponse(
        bool Enabled,
        string? DisabledReason,
        bool EmailConfigured,
        string TimeZone,
        DateTime? NextDueUtc,
        DateTime? LastTestSentUtc,
        List<RunResponse> Runs);

    /// <summary>Serializes ad hoc sends, so the one-per-minute limit holds for simultaneous requests.</summary>
    public sealed class AdHocGate
    {
        public SemaphoreSlim Semaphore { get; } = new(1, 1);
    }

    public sealed class SendNowValidator : AbstractValidator<SendNowRequest>
    {
        public SendNowValidator(TimeProvider timeProvider)
        {
            RuleFor(x => x.From)
                .Must((request, from) => from < request.To)
                .WithMessage("From must be before To.");
            RuleFor(x => x.To)
                .Must(to => to.UtcDateTime <= timeProvider.GetUtcNow().UtcDateTime + FutureTolerance)
                .WithMessage("To must not be in the future.");
            RuleFor(x => x)
                .Must(request => request.To - request.From <= TimeSpan.FromDays(MaxAdHocDays))
                .WithMessage($"The window can be at most {MaxAdHocDays} days.");
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/daily-digest/preview", PreviewHandler)
                .WithTags("Admin")
                .WithSummary("Preview the daily digest for a completed local day without sending it (Admin only)")
                .WithDescription("date (yyyy-MM-dd) defaults to yesterday in the digest time zone and must be a completed day within the last 180 days.")
                .RequireAuthorization("Admin")
                .Produces<PreviewResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);

            app.MapPost("admin/daily-digest/test-send", TestSendHandler)
                .WithTags("Admin")
                .WithSummary("Email the preview with a [TEST] prefix to the configured admin address; at most once per 5 minutes (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<TestSendResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status429TooManyRequests)
                .ProducesProblem(StatusCodes.Status502BadGateway)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

            app.MapPost("admin/daily-digest/send-now", SendNowHandler)
                .WithTags("Admin")
                .WithSummary("Email a digest for an explicit UTC window to the configured admin address; at most once per minute (Admin only)")
                .WithDescription("The window is at most 31 days and must end now or earlier. There is no recipient parameter. The send is recorded as an ad hoc run and never changes the scheduled run of any day.")
                .RequireAuthorization("Admin")
                .Produces<SendNowResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status429TooManyRequests)
                .ProducesProblem(StatusCodes.Status502BadGateway)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);

            app.MapGet("admin/daily-digest/runs", RunsHandler)
                .WithTags("Admin")
                .WithSummary("Recent daily digest runs and the digest status (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<RunsResponse>(StatusCodes.Status200OK)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);
        }

        private static async Task<IResult> PreviewHandler(
            string? date,
            DailyDigestService service,
            IOptions<DailyDigestOptions> options,
            TimeProvider timeProvider,
            CancellationToken cancellationToken)
        {
            if (!TryResolveDay(date, options.Value, timeProvider, out TimeZoneInfo? zone, out DateOnly day, out IResult? failure) || zone is null)
            {
                return failure!;
            }

            DigestReport report = await service.PreviewAsync(day, zone, cancellationToken);
            DailyDigestService.Rendered message = service.Render(report);
            return Results.Ok(new PreviewResponse(day, report.StartUtc, report.EndUtc, report, message.Subject, message.Body));
        }

        private static async Task<IResult> TestSendHandler(
            string? date,
            DailyDigestService service,
            IOptions<DailyDigestOptions> options,
            TimeProvider timeProvider,
            ApplicationDbContext db,
            IUserContext userContext,
            IAuditService auditService,
            AdHocGate gate,
            HttpContext httpContext,
            CancellationToken cancellationToken)
        {
            if (!TryResolveDay(date, options.Value, timeProvider, out TimeZoneInfo? zone, out DateOnly day, out IResult? failure) || zone is null)
            {
                return failure!;
            }

            if (!service.EmailConfigured)
            {
                return NotConfigured();
            }

            await gate.Semaphore.WaitAsync(cancellationToken);
            try
            {
                // Restart safe: the cooldown comes from the audit log, not from memory.
                DateTime? last = await LastTestSentAsync(db, cancellationToken);
                DateTime now = timeProvider.GetUtcNow().UtcDateTime;
                if (last is { } sentAt && now - sentAt < TestSendCooldown)
                {
                    return TooMany(httpContext, TestSendCooldown - (now - sentAt), "A test email was sent recently. Please wait before sending another.");
                }

                DigestReport report = await service.PreviewAsync(day, zone, cancellationToken);
                DailyDigestService.Rendered message = service.Render(report, testSend: true);
                if (!await service.SendTestAsync(message, cancellationToken))
                {
                    return Results.Problem(title: "DailyDigest.SendFailed", detail: "The test email could not be sent.", statusCode: StatusCodes.Status502BadGateway);
                }

                Guid? adminId = Guid.TryParse(userContext.UserId, out Guid parsed) ? parsed : null;
                await auditService.LogAsync(
                    AuditAction.DailyDigestTestSent,
                    adminId,
                    null,
                    new Dictionary<string, string> { ["reportDate"] = day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) },
                    cancellationToken);
                return Results.Ok(new TestSendResponse(message.Subject));
            }
            finally
            {
                gate.Semaphore.Release();
            }
        }

        private static async Task<IResult> SendNowHandler(
            SendNowRequest request,
            IValidator<SendNowRequest> validator,
            DailyDigestService service,
            IOptions<DailyDigestOptions> options,
            TimeProvider timeProvider,
            DailyDigestRunStore store,
            IUserContext userContext,
            AdHocGate gate,
            HttpContext httpContext,
            CancellationToken cancellationToken)
        {
            ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
            if (!validation.IsValid)
            {
                return CustomResults.BadRequest(validation.Errors[0].ErrorMessage, "DailyDigest.InvalidWindow");
            }

            TimeZoneInfo? zone = DailyDigestWindow.TryFindZone(options.Value.TimeZone);
            if (zone is null)
            {
                return Results.Problem(title: "DailyDigest.InvalidTimeZone", detail: "The digest time zone is not valid.", statusCode: StatusCodes.Status503ServiceUnavailable);
            }

            await gate.Semaphore.WaitAsync(cancellationToken);
            try
            {
                DateTime now = timeProvider.GetUtcNow().UtcDateTime;
                DateTime? last = await store.LastAdHocCreatedUtcAsync(cancellationToken);
                if (last is { } createdAt && now - createdAt < AdHocCooldown)
                {
                    return TooMany(httpContext, AdHocCooldown - (now - createdAt), "A digest was sent a moment ago. Please wait a minute before sending another.");
                }

                // "to" is clamped to now so a slightly fast client clock never asks for the future.
                DateTime from = request.From.UtcDateTime;
                DateTime to = request.To.UtcDateTime > now ? now : request.To.UtcDateTime;
                Guid? adminId = Guid.TryParse(userContext.UserId, out Guid parsed) ? parsed : null;
                if (from >= to)
                {
                    return CustomResults.BadRequest("From must be before To.", "DailyDigest.InvalidWindow");
                }

                (Guid runId, string status) = await service.SendAdHocAsync(from, to, zone, adminId, cancellationToken);
                if (status == DailyDigestRunStatus.Sent)
                {
                    return Results.Ok(new SendNowResponse(runId, status, from, to));
                }

                return service.EmailConfigured
                    ? Results.Problem(title: "DailyDigest.SendFailed", detail: "The digest could not be sent.", statusCode: StatusCodes.Status502BadGateway)
                    : NotConfigured();
            }
            finally
            {
                gate.Semaphore.Release();
            }
        }

        private static async Task<IResult> RunsHandler(
            ApplicationDbContext db,
            IOptions<DailyDigestOptions> options,
            IEmailSender email,
            TimeProvider timeProvider,
            int days = 14,
            CancellationToken cancellationToken = default)
        {
            if (days is < 1 or > 90)
            {
                return CustomResults.BadRequest("Days must be between 1 and 90.", "DailyDigest.InvalidDays");
            }

            DailyDigestOptions config = options.Value;
            DateTime now = timeProvider.GetUtcNow().UtcDateTime;
            bool scheduleOk = DailyDigestService.TryGetSchedule(config, out DailyDigestService.Schedule? schedule, out string? reason) && schedule is not null;
            bool enabled = config.Enabled && scheduleOk;
            DateTime? nextDue = enabled ? DailyDigestWindow.NextDueUtc(now, schedule!.Zone, schedule.SendAt) : null;

            DateTime since = now.AddDays(-days);
            List<RunResponse> runs = (await db.DailyDigestRuns.AsNoTracking()
                    .Where(run => (run.Kind == DailyDigestRunKind.Scheduled || run.Kind == DailyDigestRunKind.AdHoc) && run.CreatedUtc >= since)
                    .OrderByDescending(run => run.CreatedUtc)
                    .Take(100)
                    .ToListAsync(cancellationToken))
                .Select(run => new RunResponse(
                    run.Id,
                    run.Kind,
                    run.ReportDate,
                    run.Status,
                    run.Attempts,
                    run.WindowStartUtc,
                    run.WindowEndUtc,
                    run.SentUtc,
                    run.LastError,
                    run.NextAttemptUtc,
                    run.CreatedUtc))
                .ToList();

            return Results.Ok(new RunsResponse(
                enabled,
                config.Enabled && !scheduleOk ? reason : null,
                email.IsConfigured,
                config.TimeZone,
                nextDue,
                await LastTestSentAsync(db, cancellationToken),
                runs));
        }

        private static Task<DateTime?> LastTestSentAsync(ApplicationDbContext db, CancellationToken cancellationToken) =>
            db.Audits.AsNoTracking()
                .Where(audit => audit.Action == AuditAction.DailyDigestTestSent)
                .MaxAsync(audit => (DateTime?)audit.CreatedUtc, cancellationToken);

        /// <summary>Parses and checks the requested day: a completed local day within the last 180 days (default yesterday).</summary>
        private static bool TryResolveDay(
            string? date,
            DailyDigestOptions config,
            TimeProvider timeProvider,
            out TimeZoneInfo? zone,
            out DateOnly day,
            out IResult? failure)
        {
            day = default;
            failure = null;
            zone = DailyDigestWindow.TryFindZone(config.TimeZone);
            if (zone is null)
            {
                failure = Results.Problem(title: "DailyDigest.InvalidTimeZone", detail: "The digest time zone is not valid.", statusCode: StatusCodes.Status503ServiceUnavailable);
                return false;
            }

            // "Today" is the configured zone's today, not UTC's.
            DateOnly today = DailyDigestWindow.LocalDate(timeProvider.GetUtcNow().UtcDateTime, zone);
            if (string.IsNullOrWhiteSpace(date))
            {
                day = today.AddDays(-1);
                return true;
            }

            if (!DateOnly.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day))
            {
                failure = CustomResults.BadRequest("date must be formatted yyyy-MM-dd.", "DailyDigest.InvalidDate");
                return false;
            }

            if (day >= today)
            {
                failure = CustomResults.BadRequest("date must be a completed day (before today).", "DailyDigest.InvalidDate");
                return false;
            }

            if (day < today.AddDays(-PreviewMaxDaysBack))
            {
                failure = CustomResults.BadRequest($"date must be within the last {PreviewMaxDaysBack} days.", "DailyDigest.InvalidDate");
                return false;
            }

            return true;
        }

        private static IResult NotConfigured() =>
            Results.Problem(
                title: "DailyDigest.EmailNotConfigured",
                detail: "Email is not configured on the server.",
                statusCode: StatusCodes.Status503ServiceUnavailable);

        private static IResult TooMany(HttpContext httpContext, TimeSpan retryAfter, string message)
        {
            httpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(CultureInfo.InvariantCulture);
            return Results.Json(new { error = message }, statusCode: StatusCodes.Status429TooManyRequests);
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddOptions<DailyDigestOptions>().Bind(configuration.GetSection(DailyDigestOptions.SectionName));
            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<AdHocGate>();
            services.AddScoped<DailyDigestComposer>();
            services.AddScoped<DailyDigestRunStore>();
            services.AddScoped<DailyDigestService>();
            services.AddScoped<IValidator<SendNowRequest>, SendNowValidator>();
            services.AddHostedService<DailyDigestScheduler>();
        }
    }
}
