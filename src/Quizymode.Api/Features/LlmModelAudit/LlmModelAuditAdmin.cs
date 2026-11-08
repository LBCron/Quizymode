using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.LlmModelAudit;

/// <summary>Admin endpoints for the LLM model audit (#480, AC 13): list open findings and run the audit on demand.</summary>
internal static class LlmModelAuditAdmin
{
    public sealed record FindingResponse(Guid Id, string Vendor, string Model, string Kind, DateTime FirstSeenUtc, DateTime LastSeenUtc);

    public sealed record FindingsResponse(List<FindingResponse> Findings);

    public sealed record RunResponse(int NewFindings, int Resolved, bool EmailSent);

    /// <summary>Enforces the minimum gap between manual runs (singleton, per API instance).</summary>
    public sealed class RunCooldown(TimeProvider timeProvider)
    {
        private readonly object _gate = new();
        private DateTime? _lastRunUtc;

        /// <summary>Atomically claims a run; returns false (with the remaining wait) while in cooldown.</summary>
        public bool TryStart(TimeSpan cooldown, out TimeSpan retryAfter)
        {
            DateTime now = timeProvider.GetUtcNow().UtcDateTime;
            lock (_gate)
            {
                if (_lastRunUtc is { } last && now - last < cooldown)
                {
                    retryAfter = cooldown - (now - last);
                    return false;
                }

                _lastRunUtc = now;
                retryAfter = TimeSpan.Zero;
                return true;
            }
        }
    }

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("admin/llm-model-findings", GetFindingsHandler)
                .WithTags("Admin")
                .WithSummary("List open LLM model findings (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<FindingsResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden);

            app.MapPost("admin/llm-model-audit/run", RunHandler)
                .WithTags("Admin")
                .WithSummary("Run the LLM model-list audit now; at most once per cooldown (Admin only)")
                .RequireAuthorization("Admin")
                .Produces<RunResponse>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status401Unauthorized)
                .Produces(StatusCodes.Status403Forbidden)
                .Produces(StatusCodes.Status429TooManyRequests);
        }

        private static async Task<IResult> GetFindingsHandler(ApplicationDbContext db, CancellationToken cancellationToken)
        {
            List<LlmModelFinding> open = await db.LlmModelFindings
                .AsNoTracking()
                .Where(f => f.Status == LlmModelFindingStatus.Open)
                .ToListAsync(cancellationToken);
            return Results.Ok(new FindingsResponse(open
                .OrderBy(f => f.Vendor, StringComparer.Ordinal)
                .ThenBy(f => f.Model, StringComparer.Ordinal)
                .Select(f => new FindingResponse(f.Id, f.Vendor, f.Model, f.Kind.ToString(), f.FirstSeenUtc, f.LastSeenUtc))
                .ToList()));
        }

        private static async Task<IResult> RunHandler(
            LlmModelAuditRunner runner,
            RunCooldown cooldown,
            IOptions<LlmModelAuditOptions> options,
            HttpContext httpContext,
            CancellationToken cancellationToken)
        {
            TimeSpan window = TimeSpan.FromMinutes(Math.Max(1, options.Value.ManualRunCooldownMinutes));
            if (!cooldown.TryStart(window, out TimeSpan retryAfter))
            {
                httpContext.Response.Headers.RetryAfter = ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                return Results.Json(new { error = "The model audit was run recently. Please wait before running it again." }, statusCode: StatusCodes.Status429TooManyRequests);
            }

            LlmModelAuditRunResult result = await runner.RunAsync(cancellationToken);
            return Results.Ok(new RunResponse(result.NewFindings, result.Resolved, result.EmailSent));
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddOptions<LlmModelAuditOptions>().Bind(configuration.GetSection(LlmModelAuditOptions.SectionName));
            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<RunCooldown>();
            services.AddScoped<LlmModelAuditRunner>();
#pragma warning disable EXTEXP0001 // RemoveAllResilienceHandlers is marked experimental; the 15 s HttpClient timeout is the only bound wanted here.
            services.AddHttpClient<ILlmModelCatalogClient, HttpLlmModelCatalogClient>(client => client.Timeout = TimeSpan.FromSeconds(15))
                .RemoveAllResilienceHandlers()
                .RedactLoggedHeaders(["Authorization", "x-goog-api-key"]);
#pragma warning restore EXTEXP0001
            services.AddHostedService<LlmModelAuditService>();
        }
    }
}
