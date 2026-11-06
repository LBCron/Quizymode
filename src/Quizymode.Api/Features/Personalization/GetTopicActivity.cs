using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Personalization;

/// <summary>
/// #385: the signed-in user's completed category runs of the last 30 days, rolled up to L1 topic paths
/// (<c>category</c> or <c>category/l1</c>). Same rule as the SPA's topicSuggestions.ts; private to the caller.
/// </summary>
public static class GetTopicActivity
{
    public const int WindowDays = 30;
    public const int MinRuns = 2;
    public const int MaxTopics = 10;

    public sealed record TopicDto(string Path, int Runs, DateTime LastCompletedAt);

    public sealed record Response(int WindowDays, List<TopicDto> Topics);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("users/me/topic-activity", Handler)
                .WithTags("Users")
                .WithSummary("Get the current user's recent topic activity")
                .WithDescription("Category runs (Quiz and Learn) completed in the last 30 days, rolled up to category[/l1] paths with at least 2 runs, ordered by run count, most recent run, then path (top 10). Collection, global, Daily and Review runs are not attributable. Private to the caller. Requires authentication.")
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
            return Results.Ok(await GetAsync(db, userContext.UserId, DateTime.UtcNow, cancellationToken));
        }
    }

    public static async Task<Response> GetAsync(ApplicationDbContext db, string userId, DateTime nowUtc, CancellationToken cancellationToken)
    {
        DateTime since = nowUtc.AddDays(-WindowDays);
        var rows = await db.StudySessions.AsNoTracking()
            .Where(s => s.UserId == userId && s.SourceKind == "category" && s.CompletedAt >= since && s.CompletedAt <= nowUtc)
            .Select(s => new { s.SourceCategorySlug, s.NavigationKeywords, s.CompletedAt })
            .ToListAsync(cancellationToken);

        List<TopicDto> topics = rows
            .Select(r => new { Path = RollUp(r.SourceCategorySlug, r.NavigationKeywords), r.CompletedAt })
            .Where(r => r.Path is not null)
            .GroupBy(r => r.Path!, StringComparer.Ordinal)
            .Select(g => new TopicDto(g.Key, g.Count(), DateTime.SpecifyKind(g.Max(r => r.CompletedAt), DateTimeKind.Utc)))
            .Where(t => t.Runs >= MinRuns)
            .OrderByDescending(t => t.Runs)
            .ThenByDescending(t => t.LastCompletedAt)
            .ThenBy(t => t.Path, StringComparer.Ordinal)
            .Take(MaxTopics)
            .ToList();
        return new Response(WindowDays, topics);
    }

    private static string? RollUp(string? categorySlug, string navigationKeywords)
    {
        if (string.IsNullOrWhiteSpace(categorySlug)) return null;
        string? l1 = navigationKeywords.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries).FirstOrDefault();
        return l1 is null ? categorySlug : $"{categorySlug}/{l1}";
    }
}
