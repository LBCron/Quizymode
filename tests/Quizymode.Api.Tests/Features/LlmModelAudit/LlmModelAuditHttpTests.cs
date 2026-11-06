using System.Net;
using System.Text.Json;
using FluentAssertions;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Features.LlmModelAudit;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.LlmModelAudit;

/// <summary>#480 over real HTTP with the production JWT/Admin policy: 401 anonymous, 403 non-admin, 200 admin, run cooldown.</summary>
public sealed class LlmModelAuditHttpTests : DatabaseTestFixture, IAsyncLifetime
{
    private static readonly string[] AdminGroups = ["Admins"];

    private JwtHttpTestHost _host = null!;

    public async Task InitializeAsync()
    {
        IConfiguration configuration = new ConfigurationBuilder().Build();
        FakeCatalogClient catalog = new();
        _host = await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                new LlmModelAuditAdmin.FeatureRegistration().AddToServiceCollection(services, configuration);
                services.AddSingleton(LlmModelAuditTestSupport.Registry());
                services.AddSingleton<ILlmModelCatalogClient>(catalog);
                services.AddSingleton<IEmailSender>(new CountingEmailSender());
                ServiceDescriptor worker = services.Single(d => d.ImplementationType == typeof(LlmModelAuditService));
                services.Remove(worker);
            },
            app => new LlmModelAuditAdmin.Endpoint().MapEndpoint(app));
    }

    public async Task DisposeAsync() => await _host.DisposeAsync();

    private async Task<HttpResponseMessage> SendAsync(HttpMethod method, string path, string? token)
    {
        using HttpRequestMessage request = JwtHttpTestHost.Request(method, path, token, null);
        return await _host.Client.SendAsync(request);
    }

    [Fact]
    public async Task GetFindings_Is401Anonymous_403NonAdmin_200Admin()
    {
        using HttpResponseMessage anonymous = await SendAsync(HttpMethod.Get, "/admin/llm-model-findings", null);
        using HttpResponseMessage member = await SendAsync(HttpMethod.Get, "/admin/llm-model-findings", _host.CreateToken("member", "member@example.com"));
        using HttpResponseMessage admin = await SendAsync(HttpMethod.Get, "/admin/llm-model-findings", _host.CreateToken("admin-subject", "admin@example.com", AdminGroups));

        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        admin.StatusCode.Should().Be(HttpStatusCode.OK);
        using JsonDocument body = JsonDocument.Parse(await admin.Content.ReadAsStringAsync());
        body.RootElement.GetProperty("findings").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task Run_Is401Anonymous_403NonAdmin_ThenCooldown429()
    {
        string admin = _host.CreateToken("admin-subject", "admin@example.com", AdminGroups);

        using HttpResponseMessage anonymous = await SendAsync(HttpMethod.Post, "/admin/llm-model-audit/run", null);
        using HttpResponseMessage member = await SendAsync(HttpMethod.Post, "/admin/llm-model-audit/run", _host.CreateToken("member", "member@example.com"));
        using HttpResponseMessage first = await SendAsync(HttpMethod.Post, "/admin/llm-model-audit/run", admin);
        using HttpResponseMessage second = await SendAsync(HttpMethod.Post, "/admin/llm-model-audit/run", admin);

        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
        member.StatusCode.Should().Be(HttpStatusCode.Forbidden);
        first.StatusCode.Should().Be(HttpStatusCode.OK);
        second.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        second.Headers.RetryAfter.Should().NotBeNull();
    }
}
