using System.Buffers.Binary;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Text;
using Microsoft.Extensions.Options;
using SkiaSharp;

namespace Quizymode.Api.Features.Media;

internal sealed record NormalizedImage(
    byte[] Bytes,
    int Width,
    int Height,
    string Sha256,
    string SourceFormat,
    int SourceBytes,
    int ProcessingVersion);

internal sealed record NormalizeResult(NormalizedImage? Image, MediaProblem? Problem)
{
    public static NormalizeResult Success(NormalizedImage image) => new(image, null);

    public static NormalizeResult Failure(MediaProblem problem) => new(null, problem);
}

/// <summary>Pipeline stages, reported to an optional observer so tests can assert ordering (for example, no decode before the pixel check).</summary>
internal enum NormalizeStage
{
    CodecCreated,
    Inspected,
    Decoded,
    Resized,
    Encoded
}

/// <summary>
/// Turns an untrusted JPEG, PNG or still WebP into a bounded, metadata-free WebP (AC 3.24). The original bytes are only
/// ever held in memory: format is decided from magic bytes, size limits are checked from the header before any decode,
/// animation is refused, the decode runs behind a bounded gate, orientation is applied, EXIF/XMP/ICC are dropped,
/// and the result is re-encoded until it fits the byte cap.
/// </summary>
internal sealed class ImageNormalizer : IDisposable
{
    public const int CurrentProcessingVersion = 1;

    private static readonly int[] LossyQualities = [82, 72, 62, 52];
    private static readonly int[] FallbackSides = [1024, 800];

    private readonly MediaOptions _options;
    private readonly ILogger<ImageNormalizer> _logger;
    private readonly Action<NormalizeStage>? _observer;
    private readonly SemaphoreSlim _gate;
    private int _waiters;

    public ImageNormalizer(IOptions<MediaOptions> options, ILogger<ImageNormalizer> logger)
        : this(options.Value, logger, null)
    {
    }

    internal ImageNormalizer(MediaOptions options, ILogger<ImageNormalizer> logger, Action<NormalizeStage>? observer)
    {
        _options = options;
        _logger = logger;
        _observer = observer;
        _gate = new SemaphoreSlim(options.MaxConcurrentDecodes, options.MaxConcurrentDecodes);
    }

    public async Task<NormalizeResult> NormalizeAsync(byte[] source, CancellationToken cancellationToken)
    {
        Stopwatch clock = Stopwatch.StartNew();

        // Everything that needs no decode happens before taking a decode slot.
        InspectionResult inspection;
        try
        {
            inspection = Inspect(source);
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not OutOfMemoryException)
        {
            _logger.LogError(ex, "Unexpected failure while inspecting a picture.");
            return NormalizeResult.Failure(MediaErrors.Unreadable);
        }
        if (inspection.Problem is not null)
        {
            return NormalizeResult.Failure(inspection.Problem);
        }

        _observer?.Invoke(NormalizeStage.Inspected);

        if (Interlocked.Increment(ref _waiters) > _options.MaxConcurrentDecodes + _options.MaxWaiters)
        {
            Interlocked.Decrement(ref _waiters);
            return NormalizeResult.Failure(MediaErrors.Busy);
        }

        bool acquired = false;
        try
        {
            acquired = await _gate.WaitAsync(_options.SemaphoreWaitTimeout, cancellationToken);
            if (!acquired)
            {
                return NormalizeResult.Failure(MediaErrors.Busy);
            }

            // The slot is held until the work really finishes, even when the caller stops waiting.
            return await Task.Run(() => Process(source, inspection, clock, cancellationToken), CancellationToken.None);
        }
        finally
        {
            if (acquired)
            {
                _gate.Release();
            }

            Interlocked.Decrement(ref _waiters);
        }
    }

    public void Dispose() => _gate.Dispose();

    private NormalizeResult Process(byte[] source, InspectionResult inspection, Stopwatch clock, CancellationToken cancellationToken)
    {
        try
        {
            _observer?.Invoke(NormalizeStage.CodecCreated);
            SKMemoryStream stream = new(source);
            using SKCodec? codec = SKCodec.Create(stream, out SKCodecResult created);
            if (codec is null || created != SKCodecResult.Success)
            {
                return NormalizeResult.Failure(MediaErrors.Unreadable);
            }

            Checkpoint(clock, cancellationToken);
            using SKBitmap? decoded = Decode(codec, inspection);
            if (decoded is null)
            {
                return NormalizeResult.Failure(MediaErrors.Unreadable);
            }

            _observer?.Invoke(NormalizeStage.Decoded);
            Checkpoint(clock, cancellationToken);

            bool hasAlpha = decoded.AlphaType != SKAlphaType.Opaque;
            SKEncodedOrigin origin = codec.EncodedOrigin;
            (int orientedWidth, int orientedHeight) = IsTransposed(origin)
                ? (decoded.Height, decoded.Width)
                : (decoded.Width, decoded.Height);
            double scale = Math.Min(1d, (double)_options.MaxOutputSide / Math.Max(orientedWidth, orientedHeight));
            int width = Math.Max(1, (int)Math.Round(orientedWidth * scale));
            int height = Math.Max(1, (int)Math.Round(orientedHeight * scale));

            using SKBitmap working = Render(decoded, origin, width, height, hasAlpha);
            _observer?.Invoke(NormalizeStage.Resized);
            Checkpoint(clock, cancellationToken);

            byte[]? best = null;
            int bestWidth = width;
            int bestHeight = height;

            if (inspection.Format == "png")
            {
                byte[] lossless = Encode(working, lossless: true, quality: 100);
                _observer?.Invoke(NormalizeStage.Encoded);
                Checkpoint(clock, cancellationToken);
                if (lossless.Length <= _options.LosslessKeepBytes && lossless.Length <= _options.MaxOutputBytes)
                {
                    best = lossless;
                }
            }

            if (best is null)
            {
                foreach (int side in new[] { Math.Max(width, height) }.Concat(FallbackSides.Where(s => s < Math.Max(width, height))))
                {
                    SKBitmap candidateBitmap = working;
                    bool ownsCandidate = false;
                    int candidateWidth = width;
                    int candidateHeight = height;
                    if (side < Math.Max(width, height))
                    {
                        double ratio = (double)side / Math.Max(width, height);
                        candidateWidth = Math.Max(1, (int)Math.Round(width * ratio));
                        candidateHeight = Math.Max(1, (int)Math.Round(height * ratio));
                        candidateBitmap = Render(working, SKEncodedOrigin.TopLeft, candidateWidth, candidateHeight, hasAlpha);
                        ownsCandidate = true;
                        Checkpoint(clock, cancellationToken);
                    }

                    try
                    {
                        foreach (int quality in LossyQualities)
                        {
                            byte[] lossy = Encode(candidateBitmap, lossless: false, quality);
                            _observer?.Invoke(NormalizeStage.Encoded);
                            Checkpoint(clock, cancellationToken);
                            if (lossy.Length <= _options.MaxOutputBytes)
                            {
                                best = lossy;
                                bestWidth = candidateWidth;
                                bestHeight = candidateHeight;
                                break;
                            }
                        }
                    }
                    finally
                    {
                        if (ownsCandidate)
                        {
                            candidateBitmap.Dispose();
                        }
                    }

                    if (best is not null)
                    {
                        break;
                    }
                }
            }

            if (best is null)
            {
                return NormalizeResult.Failure(MediaErrors.CannotOptimize);
            }

            if (!IsCleanWebP(best))
            {
                // Defense in depth: never store output that carries metadata or an unexpected chunk.
                _logger.LogError("Normalized picture failed the output check; refusing to store it.");
                return NormalizeResult.Failure(MediaErrors.CannotOptimize);
            }

            string sha256 = Convert.ToHexString(SHA256.HashData(best)).ToLowerInvariant();
            return NormalizeResult.Success(new NormalizedImage(
                best,
                bestWidth,
                bestHeight,
                sha256,
                inspection.Format,
                source.Length,
                CurrentProcessingVersion));
        }
        catch (Exception ex) when (ex is not OperationCanceledException and not OutOfMemoryException and not ProcessingBudgetExceededException)
        {
            _logger.LogError(ex, "Unexpected failure while normalizing a picture.");
            return NormalizeResult.Failure(MediaErrors.Unreadable);
        }
        catch (ProcessingBudgetExceededException)
        {
            return NormalizeResult.Failure(MediaErrors.ProcessingTimeout);
        }
    }

    private void Checkpoint(Stopwatch clock, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (clock.Elapsed > _options.ProcessingBudget)
        {
            throw new ProcessingBudgetExceededException();
        }
    }

    // ---- Inspection (no decode) ------------------------------------------------------------------------------------

    private sealed record InspectionResult(string Format, int Width, int Height, MediaProblem? Problem)
    {
        public static InspectionResult Fail(MediaProblem problem) => new(string.Empty, 0, 0, problem);
    }

    private InspectionResult Inspect(byte[] source)
    {
        string? format = SniffFormat(source);
        if (format is null)
        {
            return InspectionResult.Fail(MediaErrors.UnsupportedFormat);
        }

        if (format == "png" && HasOversizedAncillaryChunks(source))
        {
            return InspectionResult.Fail(MediaErrors.Unreadable);
        }

        if (format == "png" && HasAnimationChunk(source))
        {
            return InspectionResult.Fail(MediaErrors.Animated);
        }

        if (format == "webp" && IsAnimatedWebP(source))
        {
            return InspectionResult.Fail(MediaErrors.Animated);
        }

        _observer?.Invoke(NormalizeStage.CodecCreated);
        SKMemoryStream stream = new(source);
        using SKCodec? codec = SKCodec.Create(stream, out SKCodecResult result);
        if (codec is null || result != SKCodecResult.Success)
        {
            return InspectionResult.Fail(MediaErrors.Unreadable);
        }

        SKEncodedImageFormat expected = format switch
        {
            "jpeg" => SKEncodedImageFormat.Jpeg,
            "png" => SKEncodedImageFormat.Png,
            _ => SKEncodedImageFormat.Webp
        };
        if (codec.EncodedFormat != expected)
        {
            return InspectionResult.Fail(MediaErrors.Unreadable);
        }

        SKImageInfo info = codec.Info;
        if (info.Width <= 0 || info.Height <= 0)
        {
            return InspectionResult.Fail(MediaErrors.Unreadable);
        }

        if (info.Width > _options.MaxSide || info.Height > _options.MaxSide || (long)info.Width * info.Height > _options.MaxPixels)
        {
            return InspectionResult.Fail(MediaErrors.TooManyPixels);
        }

        if (codec.FrameCount > 1)
        {
            return InspectionResult.Fail(MediaErrors.Animated);
        }

        return new InspectionResult(format, info.Width, info.Height, null);
    }

    /// <summary>Format from magic bytes only; the declared MIME type and file name are ignored.</summary>
    internal static string? SniffFormat(ReadOnlySpan<byte> bytes)
    {
        if (bytes.Length >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF)
        {
            return "jpeg";
        }

        if (bytes.Length >= 8 && bytes[..8].SequenceEqual(new byte[] { 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A }))
        {
            return "png";
        }

        if (bytes.Length >= 12 && bytes[..4].SequenceEqual("RIFF"u8) && bytes.Slice(8, 4).SequenceEqual("WEBP"u8))
        {
            return "webp";
        }

        return null;
    }

    /// <summary>
    /// libpng inflates zTXt, iTXt and iCCP chunks while reading the header, before any size gate can run, so a PNG whose
    /// compressed text and profile chunks before IDAT total over 32 KiB, or that has more than 64 ancillary chunks
    /// before IDAT, is refused without creating a codec.
    /// </summary>
    private static bool HasOversizedAncillaryChunks(byte[] png)
    {
        const long MaxInflatingBytes = 32 * 1024;
        const int MaxAncillaryChunks = 64;
        long inflating = 0;
        int ancillary = 0;
        int offset = 8;
        while (offset + 8 <= png.Length)
        {
            uint length = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(offset, 4));
            ReadOnlySpan<byte> type = png.AsSpan(offset + 4, 4);
            if (type.SequenceEqual("IDAT"u8) || type.SequenceEqual("IEND"u8))
            {
                return false;
            }

            if (type.SequenceEqual("zTXt"u8) || type.SequenceEqual("iTXt"u8) || type.SequenceEqual("iCCP"u8))
            {
                inflating += length;
            }

            // Bit 5 of the first type byte set (lowercase) marks an ancillary chunk.
            if ((type[0] & 0x20) != 0)
            {
                ancillary++;
            }

            if (inflating > MaxInflatingBytes || ancillary > MaxAncillaryChunks)
            {
                return true;
            }

            long next = (long)offset + 12 + length;
            if (next > png.Length)
            {
                return false;
            }

            offset = (int)next;
        }

        return false;
    }

    /// <summary>APNG: an acTL chunk before the first IDAT.</summary>
    private static bool HasAnimationChunk(byte[] png)
    {
        int offset = 8;
        while (offset + 8 <= png.Length)
        {
            uint length = BinaryPrimitives.ReadUInt32BigEndian(png.AsSpan(offset, 4));
            ReadOnlySpan<byte> type = png.AsSpan(offset + 4, 4);
            if (type.SequenceEqual("acTL"u8))
            {
                return true;
            }

            if (type.SequenceEqual("IDAT"u8) || type.SequenceEqual("IEND"u8))
            {
                return false;
            }

            long next = (long)offset + 12 + length;
            if (next > png.Length)
            {
                return false;
            }

            offset = (int)next;
        }

        return false;
    }

    /// <summary>Animated WebP: the VP8X animation flag, or an ANIM/ANMF chunk.</summary>
    private static bool IsAnimatedWebP(byte[] webp)
    {
        int offset = 12;
        while (offset + 8 <= webp.Length)
        {
            uint length = BinaryPrimitives.ReadUInt32LittleEndian(webp.AsSpan(offset + 4, 4));
            ReadOnlySpan<byte> type = webp.AsSpan(offset, 4);
            if (type.SequenceEqual("VP8X"u8) && offset + 9 <= webp.Length && (webp[offset + 8] & 0x02) != 0)
            {
                return true;
            }

            if (type.SequenceEqual("ANIM"u8) || type.SequenceEqual("ANMF"u8))
            {
                return true;
            }

            long next = (long)offset + 8 + length + (length & 1);
            if (next > webp.Length)
            {
                return false;
            }

            offset = (int)next;
        }

        return false;
    }

    // ---- Decode, orientation and resize ------------------------------------------------------------------------------

    private SKBitmap? Decode(SKCodec codec, InspectionResult inspection)
    {
        SKImageInfo source = codec.Info;
        SKSizeI size = new(source.Width, source.Height);
        if (inspection.Format == "jpeg")
        {
            // JPEG can decode at 1/2, 1/4 or 1/8 size, which keeps the working set small for large photos.
            double desired = Math.Min(1d, (double)_options.MaxOutputSide / Math.Max(source.Width, source.Height));
            SKSizeI scaled = codec.GetScaledDimensions((float)desired);
            if (scaled.Width > 0 && scaled.Height > 0 && Math.Max(scaled.Width, scaled.Height) >= Math.Min(_options.MaxOutputSide, Math.Max(source.Width, source.Height)))
            {
                size = scaled;
            }
        }

        SKAlphaType alpha = source.AlphaType == SKAlphaType.Opaque ? SKAlphaType.Opaque : SKAlphaType.Premul;
        SKImageInfo target = new(size.Width, size.Height, SKColorType.Rgba8888, alpha, SKColorSpace.CreateSrgb());
        SKBitmap bitmap = new(target);
        SKCodecResult result = codec.GetPixels(target, bitmap.GetPixels());
        if (result != SKCodecResult.Success)
        {
            bitmap.Dispose();
            return null;
        }

        return bitmap;
    }

    private static bool IsTransposed(SKEncodedOrigin origin) =>
        origin is SKEncodedOrigin.LeftTop or SKEncodedOrigin.RightTop or SKEncodedOrigin.RightBottom or SKEncodedOrigin.LeftBottom;

    /// <summary>Draws <paramref name="source"/> (applying <paramref name="origin"/>) into a new bitmap of the given oriented size. The result has no colour space, so the encoder writes no ICC profile.</summary>
    private static SKBitmap Render(SKBitmap source, SKEncodedOrigin origin, int width, int height, bool hasAlpha)
    {
        int sw = source.Width;
        int sh = source.Height;
        (double a, double b, double tx, double c, double d, double ty) = origin switch
        {
            SKEncodedOrigin.TopRight => (-1d, 0d, (double)sw, 0d, 1d, 0d),
            SKEncodedOrigin.BottomRight => (-1d, 0d, (double)sw, 0d, -1d, (double)sh),
            SKEncodedOrigin.BottomLeft => (1d, 0d, 0d, 0d, -1d, (double)sh),
            SKEncodedOrigin.LeftTop => (0d, 1d, 0d, 1d, 0d, 0d),
            SKEncodedOrigin.RightTop => (0d, -1d, (double)sh, 1d, 0d, 0d),
            SKEncodedOrigin.RightBottom => (0d, -1d, (double)sh, -1d, 0d, (double)sw),
            SKEncodedOrigin.LeftBottom => (0d, 1d, 0d, -1d, 0d, (double)sw),
            _ => (1d, 0d, 0d, 0d, 1d, 0d)
        };

        int orientedWidth = IsTransposed(origin) ? sh : sw;
        int orientedHeight = IsTransposed(origin) ? sw : sh;
        float sx = (float)width / orientedWidth;
        float sy = (float)height / orientedHeight;

        SKMatrix matrix = new()
        {
            ScaleX = (float)(a * sx),
            SkewX = (float)(b * sx),
            TransX = (float)(tx * sx),
            SkewY = (float)(c * sy),
            ScaleY = (float)(d * sy),
            TransY = (float)(ty * sy),
            Persp2 = 1f
        };

        SKImageInfo info = new(width, height, SKColorType.Rgba8888, hasAlpha ? SKAlphaType.Premul : SKAlphaType.Opaque);
        SKBitmap result = new(info);
        using (SKCanvas canvas = new(result))
        using (SKImage image = SKImage.FromBitmap(source))
        using (SKPaint paint = new() { IsAntialias = false })
        {
            canvas.Clear(hasAlpha ? SKColors.Transparent : SKColors.White);
            canvas.SetMatrix(matrix);
            canvas.DrawImage(image, 0, 0, new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear), paint);
        }

        return result;
    }

    private static byte[] Encode(SKBitmap bitmap, bool lossless, int quality)
    {
        using SKPixmap pixmap = bitmap.PeekPixels();
        SKWebpEncoderOptions options = new(lossless ? SKWebpEncoderCompression.Lossless : SKWebpEncoderCompression.Lossy, quality);
        using SKData? encoded = pixmap.Encode(options);
        if (encoded is null)
        {
            throw new InvalidOperationException("WebP encoding failed.");
        }

        return encoded.ToArray();
    }

    // ---- Output verification -------------------------------------------------------------------------------------------

    /// <summary>True for a RIFF/WEBP made only of VP8, VP8L, VP8X (no ICC, EXIF, XMP or animation flag) and ALPH chunks.</summary>
    internal static bool IsCleanWebP(byte[] webp)
    {
        if (webp.Length < 20 || SniffFormat(webp) != "webp")
        {
            return false;
        }

        if (BinaryPrimitives.ReadUInt32LittleEndian(webp.AsSpan(4, 4)) != webp.Length - 8)
        {
            return false;
        }

        int offset = 12;
        bool hasImage = false;
        while (offset + 8 <= webp.Length)
        {
            string type = Encoding.ASCII.GetString(webp, offset, 4);
            uint length = BinaryPrimitives.ReadUInt32LittleEndian(webp.AsSpan(offset + 4, 4));
            long next = (long)offset + 8 + length + (length & 1);
            if (next > webp.Length)
            {
                return false;
            }

            switch (type)
            {
                case "VP8X":
                    // Allowed flag bits: alpha (0x10) only. ICC 0x20, EXIF 0x08, XMP 0x04 and animation 0x02 are refused.
                    if (length < 10 || (webp[offset + 8] & ~0x10) != 0)
                    {
                        return false;
                    }

                    break;
                case "VP8 " or "VP8L":
                    hasImage = true;
                    break;
                case "ALPH":
                    break;
                default:
                    return false;
            }

            offset = (int)next;
        }

        return hasImage && offset == webp.Length;
    }

    private sealed class ProcessingBudgetExceededException : Exception;
}
