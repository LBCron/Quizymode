using Microsoft.Extensions.Options;

namespace Quizymode.Api.Features.LlmModelAudit;

/// <summary>
/// Daily LLM model-list audit (#480). Waits 24 h after boot before the first run (so restarts and deploys do not fan out
/// vendor calls), then runs every 24 h. Does nothing unless <c>Llm:ModelAudit:Enabled</c> is true.
/// </summary>
internal sealed class LlmModelAuditService(
    IServiceScopeFactory scopeFactory,
    IOptions<LlmModelAuditOptions> options,
    ILogger<LlmModelAuditService> logger) : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromHours(24);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!options.Value.Enabled)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            await Task.Delay(Interval, stoppingToken);
            await RunOnceAsync(stoppingToken);
        }
    }

    internal async Task RunOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using AsyncServiceScope scope = scopeFactory.CreateAsyncScope();
            LlmModelAuditRunner runner = scope.ServiceProvider.GetRequiredService<LlmModelAuditRunner>();
            LlmModelAuditRunResult result = await runner.RunAsync(cancellationToken);
            logger.LogInformation(
                "LlmModelAudit: run finished, {New} new finding(s), {Resolved} resolved, email sent {EmailSent}",
                result.NewFindings, result.Resolved, result.EmailSent);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            // Shutting down.
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "LlmModelAudit: run failed");
        }
    }
}
