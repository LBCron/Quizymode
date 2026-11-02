using Microsoft.Extensions.Options;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments.Generation;

/// <summary>
/// In-API polling worker for the study guide generation queue (AC 6.6). Every <c>PollIntervalSeconds</c> (default 15 s) it
/// claims up to <c>ClaimBatchSize</c> (default 2) due jobs and processes them, each in its own DI scope. A crash mid-job
/// leaves the job Processing until its lease expires, after which it is claimed again (up to <c>MaxAttempts</c>), so no
/// startup recovery is needed. Does nothing when no LLM vendor API key is configured.
/// </summary>
internal sealed class StudyGuideGenerationWorker(
    IServiceScopeFactory scopeFactory,
    ILlmVendorRegistry vendors,
    IOptions<StudyGuideGenerationOptions> options,
    ILogger<StudyGuideGenerationWorker> logger) : BackgroundService
{
    private readonly IServiceScopeFactory _scopeFactory = scopeFactory;
    private readonly ILlmVendorRegistry _vendors = vendors;
    private readonly StudyGuideGenerationOptions _options = options.Value;
    private readonly ILogger<StudyGuideGenerationWorker> _logger = logger;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_vendors.AnyConfigured)
        {
            _logger.LogInformation("StudyGuideGeneration: worker disabled (no LLM vendor API key configured).");
            return;
        }

        // Build-time OpenAPI generation (dotnet-getdocument) boots the host; never call vendors from a build.
        if (string.Equals(System.Reflection.Assembly.GetEntryAssembly()?.GetName().Name, "GetDocument.Insider", StringComparison.Ordinal))
        {
            return;
        }

        using PeriodicTimer timer = new(TimeSpan.FromSeconds(Math.Clamp(_options.PollIntervalSeconds, 1, 3600)));
        try
        {
            do
            {
                await RunOnceAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
        {
        }
    }

    /// <summary>Claims and processes one batch of due jobs, then saves finished "Make a quiz" sections; returns how many jobs were claimed.</summary>
    internal async Task<int> RunOnceAsync(CancellationToken cancellationToken)
    {
        List<Guid> claimed = [];
        try
        {
            await using AsyncServiceScope scope = _scopeFactory.CreateAsyncScope();
            StudyGuideGenerationQueue queue = scope.ServiceProvider.GetRequiredService<StudyGuideGenerationQueue>();
            claimed = await queue.ClaimDueAsync(Math.Clamp(_options.ClaimBatchSize, 1, 10), cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "StudyGuideGeneration: failed to claim due jobs.");
        }

        await Task.WhenAll(claimed.Select(id => ProcessOneAsync(id, cancellationToken)));
        await AutoSaveAsync(cancellationToken);
        return claimed.Count;
    }

    /// <summary>The safety net that also catches work finished by another instance or before a crash; never throws.</summary>
    private async Task AutoSaveAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using AsyncServiceScope scope = _scopeFactory.CreateAsyncScope();
            await scope.ServiceProvider.GetRequiredService<StudyGuideAutoSaver>().SweepAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogError(ex, "StudyGuideAutoSave: sweep failed.");
        }
    }

    private async Task ProcessOneAsync(Guid generationId, CancellationToken cancellationToken)
    {
        try
        {
            await using AsyncServiceScope scope = _scopeFactory.CreateAsyncScope();
            SectionGenerationProcessor processor = scope.ServiceProvider.GetRequiredService<SectionGenerationProcessor>();
            await processor.ProcessAsync(generationId, cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            // The job stays Processing; it is retried when its lease expires (bounded by MaxAttempts).
            _logger.LogError(ex, "StudyGuideGeneration: unexpected error processing {GenerationId}.", generationId);
        }
    }
}
