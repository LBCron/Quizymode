using System.Diagnostics.Metrics;
namespace Quizymode.Api.Features.Media;
internal static class MediaMetrics
{
    private static readonly Meter Meter = new("Quizymode.Media", "1.0");
    private static long pending; private static double oldestSeconds; private static long retainedBytes; private static long retries;
    private static readonly ObservableGauge<long> Pending = Meter.CreateObservableGauge("quizymode.media.pending", () => Interlocked.Read(ref pending));
    private static readonly ObservableGauge<double> Oldest = Meter.CreateObservableGauge("quizymode.media.oldest_pending_seconds", () => Volatile.Read(ref oldestSeconds));
    private static readonly ObservableGauge<long> Retained = Meter.CreateObservableGauge("quizymode.media.retained_bytes", () => Interlocked.Read(ref retainedBytes));
    private static readonly ObservableGauge<long> RetryBacklog = Meter.CreateObservableGauge("quizymode.media.delete_retries", () => Interlocked.Read(ref retries));
    internal static void Snapshot(long count, double age, long bytes, long retryCount) { Interlocked.Exchange(ref pending, count); Volatile.Write(ref oldestSeconds, age); Interlocked.Exchange(ref retainedBytes, bytes); Interlocked.Exchange(ref retries, retryCount); }
    internal static readonly Counter<long> Uploads = Meter.CreateCounter<long>("quizymode.media.uploads");
    internal static readonly Counter<long> Reports = Meter.CreateCounter<long>("quizymode.media.reports");
    internal static readonly Counter<long> Withdrawals = Meter.CreateCounter<long>("quizymode.media.withdrawals");
    internal static readonly Counter<long> Cleanup = Meter.CreateCounter<long>("quizymode.media.cleanup");
    internal static readonly Counter<double> AdvisoryReservedUsd = Meter.CreateCounter<double>("quizymode.media.advisory_reserved_usd");
    internal static readonly Counter<double> AdvisoryEstimatedUsd = Meter.CreateCounter<double>("quizymode.media.advisory_estimated_usd");
    internal static readonly Counter<long> Advisory = Meter.CreateCounter<long>("quizymode.media.advisory");
}
