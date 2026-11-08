using Microsoft.Extensions.Options;

namespace Quizymode.Api.Features.Admin.DailyDigest;

/// <summary>
/// Polls every 10 minutes and sends the due digest (#509). Polling instead of a 24 h delay means a restart at 07:59 or
/// 08:30 still sends. Does nothing unless <c>DailyDigest:Enabled</c> is true; with an unusable time zone it logs one error
/// and never sends. The database claim protects against a second instance during a deploy overlap.
/// </summary>
internal sealed class DailyDigestScheduler(
    IServiceScopeFactory scopeFactory,
    IOptions<DailyDigestOptions> options,
    TimeProvider timeProvider,
    ILogger<DailyDigestScheduler> logger) : BackgroundService
{
    internal static readonly TimeSpan StartupDelay = TimeSpan.FromMinutes(2);
    internal static readonly TimeSpan Interval = TimeSpan.FromMinutes(10);

    private readonly SemaphoreSlim _gate = new(1, 1);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        DailyDigestOptions config = options.Value;
        if (!config.Enabled)
        {
            // After the startup delay so migrations have been applied; records the "off" period for missed-day logic.
            try
            {
                await Task.Delay(StartupDelay, timeProvider, stoppingToken);
                await TickAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Shutting down.
            }

            return;
        }

        if (!DailyDigestService.TryGetSchedule(config, out DailyDigestService.Schedule? schedule, out string? reason) || schedule is null)
        {
            logger.LogError("DailyDigest: disabled, {Reason} (check DailyDigest:TimeZone and DailyDigest:SendAtLocalTime)", reason);
            return;
        }

        logger.LogInformation(
            "DailyDigest: enabled, timezone {Tz}, next due {NextDueUtc:O}",
            schedule.Zone.Id,
            DailyDigestWindow.NextDueUtc(timeProvider.GetUtcNow().UtcDateTime, schedule.Zone, schedule.SendAt));

        try
        {
            await Task.Delay(StartupDelay, timeProvider, stoppingToken);
            using PeriodicTimer timer = new(Interval, timeProvider);
            do
            {
                await TickAsync(stoppingToken);
            }
            while (await timer.WaitForNextTickAsync(stoppingToken));
        }
        catch (OperationCanceledException)
        {
            // Shutting down.
        }
    }

    /// <summary>One guarded tick; never throws, so the loop survives a database outage.</summary>
    internal async Task TickAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            using IServiceScope scope = scopeFactory.CreateScope();
            await scope.ServiceProvider.GetRequiredService<DailyDigestService>().TickAsync(cancellationToken);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            logger.LogError("DailyDigest: tick failed ({ErrorType})", ex.GetType().Name);
        }
        finally
        {
            _gate.Release();
        }
    }
}
