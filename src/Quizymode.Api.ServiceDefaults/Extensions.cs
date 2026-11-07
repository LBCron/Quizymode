using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using Microsoft.Extensions.Logging;
using Grafana.OpenTelemetry;
using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

namespace Microsoft.Extensions.Hosting;

// Adds common .NET Aspire services: service discovery, resilience, health checks, and OpenTelemetry.
// This project should be referenced by each service project in your solution.
// To learn more about using this project, see https://aka.ms/dotnet/aspire/service-defaults
public static class Extensions
{
    private const string HealthEndpointPath = "/health";
    private const string AlivenessEndpointPath = "/alive";

    public static TBuilder AddServiceDefaults<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder
    {
        builder.ConfigureOpenTelemetry();

        builder.AddDefaultHealthChecks();

        builder.Services.AddServiceDiscovery();

        builder.Services.ConfigureHttpClientDefaults(http =>
        {
            // Turn on resilience by default
            http.AddStandardResilienceHandler();

            // Turn on service discovery by default
            http.AddServiceDiscovery();
        });

        // Uncomment the following to restrict the allowed schemes for service discovery.
        // builder.Services.Configure<ServiceDiscoveryOptions>(options =>
        // {
        //     options.AllowedSchemes = ["https"];
        // });

        return builder;
    }

    public static TBuilder ConfigureOpenTelemetry<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder
    {
        // Configure Grafana Cloud OTLP endpoint and headers from configuration if GrafanaCloud is enabled
        // The Grafana SDK will automatically use OTEL_EXPORTER_OTLP_ENDPOINT and OTEL_EXPORTER_OTLP_HEADERS environment variables
        var grafanaCloudEnabled = builder.Configuration.GetValue<bool>("GrafanaCloud:Enabled", false);
        
        if (grafanaCloudEnabled)
        {
            var grafanaCloudOtlpEndpoint = builder.Configuration["GrafanaCloud:OtlpEndpoint"];
            var otlpInstanceId = builder.Configuration["GrafanaCloud:OtlpInstanceId"] ?? string.Empty;
            var apiKey = builder.Configuration["GrafanaCloud:ApiKey"] ?? string.Empty;
            
            // Set environment variables for Grafana SDK to pick up
            // See https://grafana.com/docs/opentelemetry/instrument/grafana-dotnet/ for required environment variables
            if (!string.IsNullOrWhiteSpace(grafanaCloudOtlpEndpoint))
            {
                Environment.SetEnvironmentVariable("OTEL_EXPORTER_OTLP_ENDPOINT", grafanaCloudOtlpEndpoint);
            }
            
            // Set OTLP protocol to http/protobuf as required by Grafana Cloud
            Environment.SetEnvironmentVariable("OTEL_EXPORTER_OTLP_PROTOCOL", "http/protobuf");
            
            // Construct Basic auth header if credentials are provided
            if (!string.IsNullOrWhiteSpace(otlpInstanceId) && !string.IsNullOrWhiteSpace(apiKey))
            {
                var credentials = System.Text.Encoding.UTF8.GetBytes($"{otlpInstanceId}:{apiKey}");
                var base64Credentials = Convert.ToBase64String(credentials);
                Environment.SetEnvironmentVariable("OTEL_EXPORTER_OTLP_HEADERS", $"Authorization=Basic {base64Credentials}");
            }
        }

        builder.Logging.AddOpenTelemetry(logging =>
        {
            logging.IncludeFormattedMessage = true;
            logging.IncludeScopes = true;
            logging.UseGrafana();
        });

        builder.Services.AddOpenTelemetry()
            .WithMetrics(metrics =>
            {
                metrics.UseGrafana()
                    .AddAspNetCoreInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddRuntimeInstrumentation()
                    // Npgsql pool metrics (busy/idle connections, pending requests) (#350).
                    .AddMeter("Npgsql", "Quizymode.Media");
            })
            .WithTracing(tracing =>
            {
                tracing.UseGrafana()
                    .AddSource(builder.Environment.ApplicationName)
                    .AddAspNetCoreInstrumentation(tracing =>
                        // Exclude health check requests from tracing
                        tracing.Filter = context =>
                            !context.Request.Path.StartsWithSegments(HealthEndpointPath)
                            && !context.Request.Path.StartsWithSegments(AlivenessEndpointPath)
                    )
                    // Uncomment the following line to enable gRPC instrumentation (requires the OpenTelemetry.Instrumentation.GrpcNetClient package)
                    //.AddGrpcClientInstrumentation()
                    .AddHttpClientInstrumentation()
                    .AddEntityFrameworkCoreInstrumentation(options =>
                    {
                        // Instrument EF Core database operations
                        options.EnrichWithIDbCommand = (activity, command) =>
                        {
                            activity.SetTag("db.system", "postgresql");
                        };
                    });
            });

        return builder;
    }

    public static TBuilder AddDefaultHealthChecks<TBuilder>(this TBuilder builder) where TBuilder : IHostApplicationBuilder
    {
        builder.Services.AddHealthChecks()
            // Add a default liveness check to ensure app is responsive
            .AddCheck("self", () => HealthCheckResult.Healthy(), ["live"]);

        return builder;
    }

    public static WebApplication MapDefaultEndpoints(this WebApplication app)
    {
        // /health is required by the LightSail container service health check in all environments.
        app.MapHealthChecks(HealthEndpointPath);

        if (app.Environment.IsDevelopment())
        {
            // Only health checks tagged with the "live" tag must pass for app to be considered alive
            app.MapHealthChecks(AlivenessEndpointPath, new HealthCheckOptions
            {
                Predicate = r => r.Tags.Contains("live")
            });
        }

        return app;
    }
}
