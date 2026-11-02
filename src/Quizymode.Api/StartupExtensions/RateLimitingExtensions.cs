using System.Security.Claims;
using System.Text.RegularExpressions;
using System.Threading.RateLimiting;
using Microsoft.AspNetCore.RateLimiting;

namespace Quizymode.Api.StartupExtensions;

internal static partial class StartupExtensions
{
    public static WebApplicationBuilder AddRateLimitingServices(this WebApplicationBuilder builder)
    {
        builder.Services.AddRateLimiter(options =>
        {
            options.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
            options.OnRejected = static async (context, cancellationToken) =>
            {
                if (!context.HttpContext.Response.HasStarted)
                {
                    if (context.Lease.TryGetMetadata(MetadataName.RetryAfter, out TimeSpan retryAfter))
                    {
                        context.HttpContext.Response.Headers.RetryAfter =
                            ((int)Math.Ceiling(retryAfter.TotalSeconds)).ToString(System.Globalization.CultureInfo.InvariantCulture);
                    }

                    string detail = GetRejectionDetail(context.HttpContext.Request.Path);
                    context.HttpContext.Response.StatusCode = StatusCodes.Status429TooManyRequests;
                    await Results.Problem(
                            title: "Too Many Requests",
                            detail: detail,
                            type: "https://tools.ietf.org/html/rfc6585#section-4",
                            statusCode: StatusCodes.Status429TooManyRequests)
                        .ExecuteAsync(context.HttpContext);
                }
            };

            // Generous enough for a full study run plus signup flow; batches of up to 25 events count once.
            options.AddPolicy("analytics-events", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 120,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Front-end error reports (OBS-001). The SPA sends at most 10 per tab session, so this only
            // bites when an error loop or a script floods the endpoint.
            options.AddPolicy("client-errors", httpContext =>
            {
                // Keyed on the server-trusted client IP, never on a client-sent X-Forwarded-For value
                // or session id, so rotating either cannot buy a fresh budget.
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 30,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Global search (#320): anonymous and cheap, but each call can run three GIN queries. Keyed on the
            // server-trusted client IP (never a client-sent X-Forwarded-For), so rotating headers cannot buy a fresh
            // budget. A fixed window (not sliding) so the rejection carries Retry-After.
            options.AddPolicy("search", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 120,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Topic suggestion (#322): authenticated, in-memory scoring, but the SPA calls it as the user types, so it is
            // capped per user. A fixed window so the rejection carries Retry-After.
            options.AddPolicy("taxonomy-suggest", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            options.AddPolicy("feedback-submissions", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 5,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Study guide document uploads (AC 6.6): extraction is CPU-bound, so creates are capped per user.
            options.AddPolicy("study-guide-documents", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 20,
                        Window = TimeSpan.FromHours(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Picture uploads (AC 3.24): decoding is CPU- and memory-bound, so uploads are capped per user. In-memory per
            // instance; durable per-account quotas are #405.
            options.AddPolicy("media-uploads", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 20,
                        Window = TimeSpan.FromHours(1),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            // Flashcard "Still learning" grades queue one item per call (#251); generous for a long deck, strict for floods.
            options.AddPolicy("review-queue-enqueue", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrTrustedIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 300,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            options.AddPolicy("ideas-create", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 2,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            options.AddPolicy("ideas-comments", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 10,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });

            options.AddPolicy("ideas-ratings", httpContext =>
            {
                string partitionKey = GetAuthenticatedOrIpPartitionKey(httpContext);
                return RateLimitPartition.GetFixedWindowLimiter(
                    partitionKey,
                    static _ => new FixedWindowRateLimiterOptions
                    {
                        PermitLimit = 60,
                        Window = TimeSpan.FromMinutes(10),
                        QueueLimit = 0,
                        AutoReplenishment = true
                    });
            });
        });

        return builder;
    }

    private static string GetAuthenticatedOrIpPartitionKey(HttpContext httpContext)
    {
        ClaimsPrincipal user = httpContext.User;
        if (user.Identity?.IsAuthenticated == true)
        {
            string? subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(subject))
            {
                return $"user:{subject}";
            }
        }

        string? forwardedFor = httpContext.Request.Headers["X-Forwarded-For"].FirstOrDefault();
        if (!string.IsNullOrWhiteSpace(forwardedFor))
        {
            string[] ips = forwardedFor.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            if (ips.Length > 0)
            {
                return $"ip:{ips[0]}";
            }
        }

        string ipAddress = httpContext.Connection.RemoteIpAddress?.ToString() ?? "anonymous";
        return $"ip:{ipAddress}";
    }

    /// <summary>
    /// The user subject when authenticated, otherwise <see cref="ConnectionInfo.RemoteIpAddress"/>, which
    /// <c>UseForwardedHeaders</c> sets from X-Forwarded-For only for hops appended by configured trusted proxies.
    /// </summary>
    internal static string GetAuthenticatedOrTrustedIpPartitionKey(HttpContext httpContext)
    {
        ClaimsPrincipal user = httpContext.User;
        if (user.Identity?.IsAuthenticated == true)
        {
            string? subject = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!string.IsNullOrWhiteSpace(subject))
            {
                return $"user:{subject}";
            }
        }

        return $"ip:{httpContext.Connection.RemoteIpAddress?.ToString() ?? "unknown"}";
    }

    internal static string GetRejectionDetail(PathString requestPath)
    {
        string path = requestPath.Value ?? string.Empty;
        if (ReviewQueueEnqueuePath().IsMatch(path))
        {
            return "Too many Review queue updates. Please slow down.";
        }

        if (path.EndsWith("/analytics/events", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many analytics events. Please slow down.";
        }

        if (path.EndsWith("/taxonomy/suggest", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many topic suggestions. Please wait a moment and try again.";
        }

        if (path.EndsWith("/search", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many searches. Please wait a moment and try again.";
        }

        if (path.EndsWith("/client-errors", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many error reports. Please slow down.";
        }

        if (path.EndsWith("/study-guides/documents", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many study guide uploads. Please wait a while and try again.";
        }

        if (path.Contains("/ideas/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/comments", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many idea comments. Please wait a few minutes and try again.";
        }

        if (path.Contains("/ideas/", StringComparison.OrdinalIgnoreCase) && path.EndsWith("/rating", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many idea ratings. Please slow down and try again shortly.";
        }

        if (path.EndsWith("/ideas", StringComparison.OrdinalIgnoreCase))
        {
            return "Too many idea submissions. Please wait a few minutes and try again.";
        }

        return "Too many feedback submissions. Please wait a few minutes and try again.";
    }

    [GeneratedRegex("/review-queue/[0-9a-fA-F-]{36}$", RegexOptions.IgnoreCase)]
    private static partial Regex ReviewQueueEnqueuePath();
}
