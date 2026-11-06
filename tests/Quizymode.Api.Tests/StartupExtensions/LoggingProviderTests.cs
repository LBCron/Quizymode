using FluentAssertions;
using Microsoft.AspNetCore.Builder;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Quizymode.Api.StartupExtensions;
using Xunit;

namespace Quizymode.Api.Tests.StartupExtensions;

/// <summary>
/// #490 owner decision 4: UseSerilog replaces the Microsoft logging pipeline. The ILoggerFactory the app resolves
/// must be Serilog's, so Logging:LogLevel and the ServiceDefaults OpenTelemetry provider do not receive app logs.
/// Keep this test in sync with LoggingExtensions.AddLoggingServices.
/// </summary>
public sealed class LoggingProviderTests
{
    [Fact]
    public void AfterStartup_ResolvedLoggerFactoryIsSerilog()
    {
        WebApplicationBuilder builder = WebApplication.CreateBuilder();
        builder.AddServiceDefaults();
        builder.AddLoggingServices();

        using WebApplication app = builder.Build();
        ILoggerFactory factory = app.Services.GetRequiredService<ILoggerFactory>();

        factory.GetType().FullName.Should().Contain("Serilog",
            "UseSerilog must replace the logger factory so Microsoft logging providers do not receive app logs");
    }
}
