using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Media;

/// <summary>Separate transport accounting, before parsing/buffering. All admitted bodies, including replays and invalid bodies,
/// spend one request and their full bounded-byte reservation for the rolling day. Decode accounting remains independent.</summary>
internal static class MediaIngress
{
    internal static async Task<(MediaIngressAttempt? Attempt, IResult? Error)> ReserveAsync(ApplicationDbContext db, string owner, MediaOptions options, DateTime now, CancellationToken ct)
    {
        await using var transaction = await ItemImageSubmission.BeginAsync(db, ct);
        if (await db.MediaControls.AnyAsync(x => x.Id == 1 && !x.UploadsEnabled, ct)) return (null, MediaErrors.StorageUnavailable.ToResult());
        int hourly = await db.MediaIngressAttempts.CountAsync(x => x.OwnerUserId == owner && x.CreatedAt > now.AddHours(-1), ct);
        int daily = await db.MediaIngressAttempts.CountAsync(x => x.OwnerUserId == owner && x.CreatedAt > now.AddDays(-1), ct);
        long reserved = await db.MediaIngressAttempts.Where(x => x.OwnerUserId == owner && x.CreatedAt > now.AddDays(-1)).SumAsync(x => x.ReservedBytes, ct);
        long bytes = (long)options.MaxSourceBytes + 64 * 1024;
        if (hourly >= options.MaxUploadsPerHour || daily >= options.MaxUploadsPerDay || reserved + bytes > options.MaxIngressBytesPerDay)
            return (null, Results.Problem(statusCode: 429, title: "Media.UploadQuota", detail: "Transport allowance reached. Wait for the upload window to reset."));
        if (await db.MediaIngressAttempts.CountAsync(x => x.CompletedAt == null && x.LeaseUntil > now, ct) >= options.MaxGlobalIngress)
            return (null, Results.Problem(statusCode: 429, title: "Media.GlobalBusy", detail: "Picture transport is busy. Retry shortly."));
        MediaIngressAttempt attempt = new() { Id = Guid.NewGuid(), OwnerUserId = owner, CreatedAt = now, LeaseUntil = now.Add(options.IngressReadTimeout).AddSeconds(30), ReservedBytes = bytes };
        db.MediaIngressAttempts.Add(attempt);
        await db.SaveChangesAsync(ct); if (transaction is not null) await transaction.CommitAsync(ct);
        return (attempt, null);
    }

    internal static Task FinishAsync(ApplicationDbContext db, Guid id, long received, DateTime now) =>
        db.MediaIngressAttempts.Where(x => x.Id == id).ExecuteUpdateAsync(s => s.SetProperty(x => x.ReceivedBytes, received).SetProperty(x => x.CompletedAt, now), CancellationToken.None);
}

/// <summary>Bounds the entire multipart envelope, including ignored and duplicate parts, without buffering it.</summary>
internal sealed class BoundedIngressStream(Stream source, long maximum) : Stream
{
    internal long ReceivedBytes { get; private set; }
    public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken cancellationToken = default)
    {
        int allowed = (int)Math.Min(buffer.Length, maximum - ReceivedBytes + 1);
        if (allowed <= 0) throw new MediaIngressLimitException();
        int count = await source.ReadAsync(buffer[..allowed], cancellationToken);
        ReceivedBytes += count;
        if (ReceivedBytes > maximum) throw new MediaIngressLimitException();
        return count;
    }
    public override Task<int> ReadAsync(byte[] buffer, int offset, int count, CancellationToken ct) => ReadAsync(buffer.AsMemory(offset, count), ct).AsTask();
    public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
    public override bool CanRead => true;
    public override bool CanSeek => false;
    public override bool CanWrite => false;
    public override long Length => throw new NotSupportedException();
    public override long Position { get => ReceivedBytes; set => throw new NotSupportedException(); }
    public override void Flush() => throw new NotSupportedException();
    public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
    public override void SetLength(long value) => throw new NotSupportedException();
    public override void Write(byte[] buffer, int offset, int count) => throw new NotSupportedException();
}

internal sealed class MediaIngressLimitException : IOException;
