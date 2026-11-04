using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Admin;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Starter;

/// <summary>
/// STARTER-001 (#462): the curated, caller-independent pool the home "Play a 5-question quiz" run draws from.
/// Membership is seed-managed (Item.StarterWorld + Item.WowLine); the client composes the run.
/// </summary>
public static class StarterPool
{
    internal const string CacheKey = "starter:pool";
    internal const int CacheSeconds = 300;
    private static readonly TimeSpan CacheDuration = TimeSpan.FromSeconds(CacheSeconds);

    /// <param name="Item">The public item, mapped as an anonymous caller (no private keywords).</param>
    /// <param name="World">One of flags, genai, space, animals, food, time, body, places.</param>
    /// <param name="WowLine">One-line fact shown after the answer (max 140 characters).</param>
    public sealed record StarterItemResponse(GetItems.ItemResponse Item, string World, string WowLine);

    /// <param name="Version">Short content hash of the pool; changes whenever membership or a wow line changes.</param>
    /// <param name="Items">The starter items in a stable order.</param>
    public sealed record StarterPoolResponse(string Version, List<StarterItemResponse> Items);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("starter-pool", Handler)
                .WithTags("Starter")
                .WithSummary("Get the curated starter quiz pool")
                .WithDescription("Public, repo-managed, playable items that carry a starter world and a one-line wow line, excluding items flagged by the question-quality report. Identical for every caller (private keywords are never included). Cached for 5 minutes.")
                .AllowAnonymous()
                .Produces<StarterPoolResponse>(StatusCodes.Status200OK);
        }

        private static async Task<IResult> Handler(
            HttpContext httpContext,
            ApplicationDbContext db,
            IMemoryCache cache,
            CancellationToken cancellationToken)
        {
            StarterPoolResponse response = await GetAsync(db, cache, cancellationToken);
            httpContext.Response.Headers.CacheControl = $"public, max-age={CacheSeconds}";
            return Results.Ok(response);
        }
    }

    internal static async Task<StarterPoolResponse> GetAsync(
        ApplicationDbContext db,
        IMemoryCache cache,
        CancellationToken cancellationToken)
    {
        if (cache.TryGetValue(CacheKey, out StarterPoolResponse? cached) && cached is not null)
        {
            return cached;
        }

        List<Item> candidates = await db.Items.AsNoTracking()
            .Include(i => i.Category)
            .Include(i => i.ItemKeywords).ThenInclude(ik => ik.Keyword)
            .Where(ItemVisibility.PublicEligible)
            .Where(i => i.IsRepoManaged && i.StarterWorld != null && i.WowLine != null)
            .OrderBy(i => i.Id)
            .ToListAsync(cancellationToken);

        HashSet<Guid> flagged = [];
        if (candidates.Count > 0)
        {
            Result<GetQuestionQualityReport.Response> report = await GetQuestionQualityReport.HandleAsync(
                new GetQuestionQualityReport.QueryRequest(), db, cancellationToken);
            if (report.IsSuccess)
            {
                HashSet<Guid> starterIds = candidates.Select(i => i.Id).ToHashSet();
                flagged = report.Value.Items
                    .Where(i => i.CheckAnswerKey && starterIds.Contains(i.ItemId))
                    .Select(i => i.ItemId)
                    .ToHashSet();
            }
        }

        // Never read IUserContext: the response is cached and shared, so it is always mapped as an anonymous caller.
        ItemResponseMapper mapper = new(AnonymousUserContext.Instance);
        List<StarterItemResponse> items = candidates
            .Where(i => StarterWorlds.IsValid(i.StarterWorld)
                && QuizPlayability.IsPlayable(i.CorrectAnswer, i.IncorrectAnswers)
                && !flagged.Contains(i.Id))
            .Select(i => new StarterItemResponse(
                mapper.MapToResponse(i, new List<GetItems.CollectionResponse>()),
                i.StarterWorld!,
                i.WowLine!))
            .ToList();

        StarterPoolResponse response = new(ComputeVersion(items), items);
        cache.Set(CacheKey, response, CacheDuration);
        return response;
    }

    private static string ComputeVersion(List<StarterItemResponse> items)
    {
        StringBuilder builder = new();
        foreach (StarterItemResponse entry in items)
        {
            builder.Append(entry.Item.Id).Append('|').Append(entry.World).Append('|').Append(entry.WowLine).Append('\n');
        }

        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(builder.ToString())))[..12].ToLowerInvariant();
    }

    private sealed class AnonymousUserContext : IUserContext
    {
        public static readonly AnonymousUserContext Instance = new();

        public bool IsAuthenticated => false;

        public string? UserId => null;

        public bool IsAdmin => false;
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddMemoryCache();
        }
    }
}
