using Microsoft.AspNetCore.OpenApi;
using Serilog;
using Serilog.Events;

namespace Quizymode.Api.StartupExtensions;

internal static partial class StartupExtensions
{
    public static WebApplicationBuilder ConfigureServices(this WebApplicationBuilder builder)
    {
        StartupLogger();
        builder.Configuration.AddEnvironmentVariables(prefix: "APP_");

        builder.AddServiceDefaults();
        builder.AddLoggingServices();
        builder.AddOpenApiServices();
        builder.AddHealthCheckServices();
        builder.AddCorsServices();
        builder.AddPostgreSqlServices();
        builder.AddRateLimitingServices();

        // Configure forwarded headers for proxy scenarios (Cloudflare in production, Aspire in development)
        builder.Services.Configure<ForwardedHeadersOptions>(options =>
        {
            options.ForwardedHeaders = Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedFor 
                | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedProto 
                | Microsoft.AspNetCore.HttpOverrides.ForwardedHeaders.XForwardedHost;
            
            if (builder.Environment.IsDevelopment())
            {
                // In development, trust localhost and loopback addresses for Aspire proxy
                options.KnownProxies.Clear();
                options.KnownProxies.Add(System.Net.IPAddress.Loopback);
                options.KnownProxies.Add(System.Net.IPAddress.IPv6Loopback);
            }
            else
            {
                // In production, only trust Cloudflare's IP ranges
                // Cloudflare IPs should be configured via KnownNetworks
            }

            // Proxies in front of the API (for example the load balancer's private range) are trusted only when
            // configured: ForwardedHeaders:KnownNetworks is a comma-separated CIDR list. Only then does
            // Connection.RemoteIpAddress take the hop such a proxy appended to X-Forwarded-For; a value the
            // client sent itself is never trusted, so per-IP rate limits cannot be dodged by spoofing it.
            string? knownNetworks = builder.Configuration["ForwardedHeaders:KnownNetworks"];
            if (!string.IsNullOrWhiteSpace(knownNetworks))
            {
                foreach (string cidr in knownNetworks.Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    options.KnownIPNetworks.Add(System.Net.IPNetwork.Parse(cidr));
                }
            }
        });

        // Add authentication before custom services so middleware and IUserContext work
        builder.AddAuthenticationServices();

        builder.AddCustomServices();
        
        // Auto-discover and register all features
        builder.AddFeatureRegistrations();

        return builder;
    }

    public static WebApplication ConfigurePipeline(this WebApplication app)
    {
        // CRITICAL: UseForwardedHeaders must be called FIRST, before any other middleware
        // that might inspect the request scheme. This ensures that Cloudflare's forwarded
        // headers (X-Forwarded-Proto, X-Forwarded-For) are processed and the request
        // scheme is correctly identified as HTTPS even though Cloudflare forwards it as HTTP.
        app.UseForwardedHeaders();

        // #490: one access line per request (replaces the Hosting.Diagnostics start/finish pair).
        // Health probes are Verbose so the minimum level drops them. Query strings are never logged.
        app.UseSerilogRequestLogging(options =>
        {
            options.GetLevel = static (httpContext, _, exception) =>
            {
                string path = httpContext.Request.Path.Value ?? string.Empty;
                if (path is "/health" or "/alive")
                {
                    return LogEventLevel.Verbose;
                }

                if (exception is not null || httpContext.Response.StatusCode >= StatusCodes.Status500InternalServerError)
                {
                    return LogEventLevel.Error;
                }

                // Successful requests are Debug so the Information volume stays near the app's own lifecycle lines (#490).
                return httpContext.Response.StatusCode >= StatusCodes.Status400BadRequest
                    ? LogEventLevel.Warning
                    : LogEventLevel.Debug;
            };
        });

        if (app.Environment.IsDevelopment())
        {
            // Enable detailed exception pages in development for better debugging experience
            app.UseDeveloperExceptionPage();
            // Must be registered AFTER UseDeveloperExceptionPage so it sits inner (catches first).
            // Silently absorbs client-disconnect cancellations before DeveloperExceptionPage logs them.
            app.Use(async (ctx, next) =>
            {
                try { await next(ctx); }
                catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
                { ctx.Response.StatusCode = 499; }
            });
            
            app.MapOpenApi("/openapi/{documentName}.json");
            app.MapOpenApi("/openapi/{documentName}.yaml");
            app.UseSwaggerUI(c =>
            {
                c.SwaggerEndpoint("/openapi/v1.json", "Quizymode API v1");
                c.RoutePrefix = "swagger";
                c.DisplayRequestDuration();
                c.EnableTryItOutByDefault();
            });
        }
        else
        {
            // Silently absorb client-disconnect cancellations in production.
            app.Use(async (ctx, next) =>
            {
                try { await next(ctx); }
                catch (OperationCanceledException) when (ctx.RequestAborted.IsCancellationRequested)
                { ctx.Response.StatusCode = 499; }
            });
        }

        app.UseHttpsRedirection();
        app.UseCors("AllowAll");

        // Authentication & Authorization
        app.UseAuthentication();
        app.UseRateLimiter();
        app.UseAuthorization();

        // Upsert user record on authenticated requests
        app.UseMiddleware<Services.UserUpsertMiddleware>();

        app.MapDefaultEndpoints();
        //app.MapHealthChecks("/health");
        
        // Auto-discover and map all feature endpoints
        app.MapFeatureEndpoints();

        return app;
    }
}
