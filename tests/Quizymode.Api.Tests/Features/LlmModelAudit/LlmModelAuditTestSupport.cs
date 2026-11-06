using Microsoft.Extensions.Configuration;
using Quizymode.Api.Features.LlmModelAudit;
using Quizymode.Api.Features.StudyGuideDocuments.Generation;

namespace Quizymode.Api.Tests.Features.LlmModelAudit;

internal sealed class FakeCatalogClient : ILlmModelCatalogClient
{
    private readonly Dictionary<string, LlmCatalogResult> _results = new(StringComparer.OrdinalIgnoreCase);

    public List<string> Calls { get; } = [];

    public void SetModels(string vendor, params string[] models) =>
        _results[vendor] = new LlmCatalogResult(LlmCatalogOutcome.Ok, models.ToHashSet(StringComparer.Ordinal));

    public void SetFailed(string vendor) =>
        _results[vendor] = new LlmCatalogResult(LlmCatalogOutcome.Failed, new HashSet<string>());

    public Task<LlmCatalogResult> ListModelsAsync(LlmVendorEndpoint endpoint, CancellationToken cancellationToken)
    {
        lock (Calls)
        {
            Calls.Add(endpoint.Vendor);
        }

        return Task.FromResult(_results[endpoint.Vendor]);
    }
}

internal sealed class CountingEmailSender : IEmailSender
{
    private int _sent;

    public bool Configured { get; set; } = true;

    public int Sent => _sent;

    public List<string> Bodies { get; } = [];

    public Task<bool> SendToAdminAsync(string subject, string body, CancellationToken cancellationToken)
    {
        if (!Configured)
        {
            return Task.FromResult(false);
        }

        Interlocked.Increment(ref _sent);
        lock (Bodies)
        {
            Bodies.Add(body);
        }

        return Task.FromResult(true);
    }
}

internal static class LlmModelAuditTestSupport
{
    /// <summary>A registry where only the named vendors have a (fake) key.</summary>
    public static ILlmVendorRegistry Registry(params string[] keyedVendors)
    {
        Dictionary<string, string?> values = [];
        foreach (string vendor in keyedVendors)
        {
            values[$"{vendor}:ApiKey"] = "test-key";
        }

        return new LlmVendorRegistry(new ConfigurationBuilder().AddInMemoryCollection(values).Build());
    }
}
