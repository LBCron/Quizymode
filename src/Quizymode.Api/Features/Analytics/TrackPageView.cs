using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Analytics;

public static class TrackPageView
{
    /// <param name="InternalBrowser">
    /// Client-asserted internal-browser marker (set by an admin on their own devices and by E2E runs).
    /// Trusting it is safe because it can only remove the sender's own traffic from reports.
    /// </param>
    /// <param name="VisitorId">
    /// Client-generated id persisted in the visitor's browser (localStorage), used to recognize a
    /// returning visitor across sessions (TRAFFIC-122). Must be a syntactically valid UUID; an
    /// invalid value is ignored (treated as absent) rather than rejecting the hit.
    /// </param>
    /// <param name="Referrer">Raw referrer URL reported by the client for the first hit of a session.</param>
    public sealed record Request(
        string Path,
        string? QueryString,
        string SessionId,
        bool? InternalBrowser = null,
        string? VisitorId = null,
        string? Referrer = null,
        string? UtmSource = null,
        string? UtmMedium = null,
        string? UtmCampaign = null,
        string? UtmContent = null,
        string? UtmTerm = null,
        string? Gclid = null,
        string? Gbraid = null,
        string? Wbraid = null,
        string? Msclkid = null,
        string? Ttclid = null,
        string? AppVersion = null);

    public sealed record Response(string Id, DateTime CreatedUtc);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("analytics/page-views", Handler)
                .WithTags("Analytics")
                .WithSummary("Track a SPA page view")
                .WithDescription("Stores a page-view event for an anonymous or authenticated SPA route hit. The hit is flagged internal when the caller is an admin, is a user flagged internal, or sends internalBrowser=true. Each hit is classified by feature area and content scope. The first hit of a session also creates an attribution snapshot (channel, referrer host, UTM tags, device class, country).")
                .AllowAnonymous()
                .Produces<Response>(StatusCodes.Status201Created)
                .ProducesProblem(StatusCodes.Status400BadRequest);
        }

        private static async Task<IResult> Handler(
            Request request,
            HttpContext httpContext,
            ApplicationDbContext db,
            IUserContext userContext,
            IAttributionClassifier classifier,
            IIpGeolocationService geoService,
            CancellationToken cancellationToken)
        {
            Result<Response> result = await HandleAsync(
                request, httpContext, db, userContext, classifier, geoService, cancellationToken);

            return result.Match(
                value => Results.Created($"/analytics/page-views/{value.Id}", value),
                error => CustomResults.Problem(result));
        }
    }

    public static async Task<Result<Response>> HandleAsync(
        Request request,
        HttpContext httpContext,
        ApplicationDbContext db,
        IUserContext userContext,
        IAttributionClassifier classifier,
        IIpGeolocationService geoService,
        CancellationToken cancellationToken)
    {
        string normalizedPath = NormalizePath(request.Path);
        if (string.IsNullOrWhiteSpace(normalizedPath) || !normalizedPath.StartsWith("/", StringComparison.Ordinal))
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.InvalidPath", "Path must be a non-empty app-relative URL path that starts with '/'."));
        }

        string normalizedSessionId = request.SessionId.Trim();
        if (string.IsNullOrWhiteSpace(normalizedSessionId))
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.InvalidSessionId", "SessionId is required."));
        }

        if (normalizedPath.Length > 2048)
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.PathTooLong", "Path must be 2048 characters or fewer."));
        }

        if (normalizedSessionId.Length > 128)
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.SessionIdTooLong", "SessionId must be 128 characters or fewer."));
        }

        string normalizedQueryString = NormalizeQueryString(request.QueryString);
        if (IsSearchPath(normalizedPath))
        {
            // The search text is user input (#324): never store it, whichever field the client put it in.
            normalizedQueryString = string.Empty;
        }
        if (normalizedQueryString.Length > 2048)
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.QueryStringTooLong", "QueryString must be 2048 characters or fewer."));
        }

        string url = $"{normalizedPath}{normalizedQueryString}";
        if (url.Length > 4096)
        {
            return Result.Failure<Response>(
                Error.Validation("Analytics.UrlTooLong", "The combined URL must be 4096 characters or fewer."));
        }

        Guid? userId = null;
        if (Guid.TryParse(userContext.UserId, out Guid parsedUserId))
        {
            userId = parsedUserId;
        }

        // A syntactically invalid visitor id is dropped rather than rejecting the hit.
        string? visitorId = Guid.TryParse(request.VisitorId, out Guid _) ? request.VisitorId!.Trim() : null;

        string? userAgent = RequestMetadataHelper.GetUserAgent(httpContext);

        bool isInternal = userContext.IsAdmin || request.InternalBrowser == true;
        if (!isInternal && userId.HasValue)
        {
            isInternal = await db.Users
                .AsNoTracking()
                .AnyAsync(user => user.Id == userId.Value && user.IsInternal, cancellationToken);
        }

        PageHitClassifier.Classification classification = PageHitClassifier.Classify(normalizedPath, normalizedQueryString);

        PageView pageView = new()
        {
            Id = Guid.NewGuid(),
            UserId = userId,
            IsAuthenticated = userContext.IsAuthenticated,
            SessionId = normalizedSessionId,
            IpAddress = RequestMetadataHelper.GetClientIpAddress(httpContext),
            Path = normalizedPath,
            QueryString = normalizedQueryString,
            Url = url,
            UserAgent = userAgent,
            IsBot = BotUserAgentDetector.IsBot(userAgent),
            IsInternal = isInternal,
            CreatedUtc = DateTime.UtcNow
        };

        PageViewClassificationBackfill.Apply(pageView, classification);

        db.PageViews.Add(pageView);
        await db.SaveChangesAsync(CancellationToken.None);

        await EnsureAnalyticsSessionAsync(
            db,
            userContext,
            classifier,
            geoService,
            httpContext,
            normalizedSessionId,
            normalizedPath,
            normalizedQueryString,
            visitorId,
            userId,
            userAgent,
            request,
            pageView.CreatedUtc,
            pageView.IpAddress,
            CancellationToken.None);

        return Result.Success(new Response(pageView.Id.ToString(), pageView.CreatedUtc));
    }

    /// <summary>
    /// Creates the session's first-hit attribution snapshot the first time its SessionId is seen.
    /// Later hits for the same session never modify it. Country resolution is best-effort and never
    /// allowed to delay or fail the page-view response.
    /// </summary>
    private static async Task EnsureAnalyticsSessionAsync(
        ApplicationDbContext db,
        IUserContext userContext,
        IAttributionClassifier classifier,
        IIpGeolocationService geoService,
        HttpContext httpContext,
        string sessionId,
        string landingPath,
        string landingQuery,
        string? visitorId,
        Guid? userId,
        string? userAgent,
        Request request,
        DateTime firstSeenUtc,
        string ipAddress,
        CancellationToken cancellationToken)
    {
        AnalyticsSession? existing = await db.AnalyticsSessions
            .FirstOrDefaultAsync(session => session.SessionId == sessionId, cancellationToken);

        if (existing is not null)
        {
            // Attribution is first-hit only, but identity links are filled in once: a session that
            // started anonymous links to the user when they sign in (so pre-signup visits connect to
            // the account), and a missing visitor id is filled from a later hit (ANALYTICS-003).
            bool changed = false;
            if (existing.UserId is null && userId is not null)
            {
                existing.UserId = userId;
                changed = true;
            }

            if (existing.VisitorId is null && visitorId is not null)
            {
                existing.VisitorId = visitorId;
                changed = true;
            }

            if (changed)
            {
                await db.SaveChangesAsync(cancellationToken);
            }

            return;
        }

        AttributionResult attribution = classifier.Classify(new AttributionRequest(
            ReferrerUrl: request.Referrer,
            RequestHost: httpContext.Request.Host.Host,
            UtmSource: request.UtmSource,
            UtmMedium: request.UtmMedium,
            UtmCampaign: request.UtmCampaign,
            UtmContent: request.UtmContent,
            UtmTerm: request.UtmTerm,
            Gclid: request.Gclid,
            Gbraid: request.Gbraid,
            Wbraid: request.Wbraid,
            Msclkid: request.Msclkid,
            Ttclid: request.Ttclid));

        IpLocation? location = await ResolveLocationBestEffortAsync(geoService, ipAddress, cancellationToken);
        string? country = location?.Country;

        AnalyticsSession analyticsSession = new()
        {
            Id = Guid.NewGuid(),
            SessionId = sessionId,
            VisitorId = visitorId,
            UserId = userId,
            FirstSeenUtc = firstSeenUtc,
            LandingPath = landingPath,
            LandingQuery = landingQuery,
            ReferrerHost = attribution.ReferrerHost,
            UtmSource = attribution.UtmSource,
            UtmMedium = attribution.UtmMedium,
            UtmCampaign = attribution.UtmCampaign,
            UtmContent = attribution.UtmContent,
            UtmTerm = attribution.UtmTerm,
            ClickIdPlatform = attribution.ClickIdPlatform,
            Channel = attribution.Channel,
            DeviceClass = classifier.ClassifyDeviceClass(userAgent),
            Country = country,
            Region = location?.Region,
            City = location?.City,
            AppVersion = NormalizeAppVersion(request.AppVersion),
            CreatedUtc = DateTime.UtcNow
        };

        if (db.Database.IsNpgsql())
        {
            // A concurrent request for the same brand-new session may win the unique-SessionId race; its snapshot wins.
            // ON CONFLICT avoids the unique violation that EF would log at Error before the catch below (#350).
            await db.Database.ExecuteSqlInterpolatedAsync(
                $"""
                INSERT INTO "AnalyticsSessions" ("Id", "SessionId", "VisitorId", "UserId", "FirstSeenUtc", "LandingPath",
                    "LandingQuery", "ReferrerHost", "UtmSource", "UtmMedium", "UtmCampaign", "UtmContent", "UtmTerm",
                    "ClickIdPlatform", "Channel", "DeviceClass", "Country", "Region", "City", "AppVersion", "CreatedUtc")
                VALUES ({analyticsSession.Id}, {analyticsSession.SessionId}, {analyticsSession.VisitorId}, {analyticsSession.UserId}, {analyticsSession.FirstSeenUtc}, {analyticsSession.LandingPath},
                    {analyticsSession.LandingQuery}, {analyticsSession.ReferrerHost}, {analyticsSession.UtmSource}, {analyticsSession.UtmMedium}, {analyticsSession.UtmCampaign}, {analyticsSession.UtmContent}, {analyticsSession.UtmTerm},
                    {analyticsSession.ClickIdPlatform}, {analyticsSession.Channel}, {analyticsSession.DeviceClass}, {analyticsSession.Country}, {analyticsSession.Region}, {analyticsSession.City}, {analyticsSession.AppVersion}, {analyticsSession.CreatedUtc})
                ON CONFLICT ("SessionId") DO NOTHING
                """,
                cancellationToken);
            return;
        }

        db.AnalyticsSessions.Add(analyticsSession);
        try
        {
            await db.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateException)
        {
            // A concurrent request for the same brand-new session won the unique-SessionId race.
            // The other request's snapshot wins; this one is discarded rather than overwriting it.
            db.ChangeTracker.Clear();
        }
    }

    /// <summary>Resolves the hit's location with a strict time budget; never throws, never delays the response.</summary>
    private static async Task<IpLocation?> ResolveLocationBestEffortAsync(
        IIpGeolocationService geoService,
        string ipAddress,
        CancellationToken cancellationToken)
    {
        try
        {
            using CancellationTokenSource timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromSeconds(2));
            IpLocation? location = await geoService.GetLocationAsync(ipAddress, timeoutCts.Token);
            if (location is not null)
            {
                return location;
            }

            string? country = await geoService.GetCountryAsync(ipAddress, timeoutCts.Token);
            return country is null ? null : new IpLocation(country, null, null);
        }
        catch
        {
            // Geolocation is a nice-to-have; any failure (timeout, network, parsing) must not
            // affect page-view ingestion.
            return null;
        }
    }

    private static string? NormalizeAppVersion(string? appVersion)
    {
        if (string.IsNullOrWhiteSpace(appVersion))
        {
            return null;
        }

        string trimmed = appVersion.Trim();
        return trimmed.Length > 32 ? trimmed[..32] : trimmed;
    }

    private static string NormalizePath(string? path)
    {
        string trimmed = (path ?? string.Empty).Trim();
        if (IsSearchPath(trimmed))
        {
            int separator = trimmed.IndexOfAny(['?', '#']);
            return separator >= 0 ? trimmed[..separator] : trimmed;
        }

        return trimmed;
    }

    /// <summary>True for <c>/search</c> and <c>/search/</c>, with or without a query string or fragment.</summary>
    internal static bool IsSearchPath(string path)
    {
        int separator = path.IndexOfAny(['?', '#']);
        string pathOnly = (separator >= 0 ? path[..separator] : path).TrimEnd('/');
        return string.Equals(pathOnly, "/search", StringComparison.OrdinalIgnoreCase);
    }

    private static string NormalizeQueryString(string? queryString)
    {
        string value = (queryString ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        return value.StartsWith("?", StringComparison.Ordinal) ? value : $"?{value}";
    }
}
