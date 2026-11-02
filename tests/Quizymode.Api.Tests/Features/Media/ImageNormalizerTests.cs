using System.Diagnostics;
using FluentAssertions;
using Microsoft.Extensions.Logging.Abstractions;
using Quizymode.Api.Features.Media;
using SkiaSharp;
using Xunit;
using Xunit.Abstractions;

namespace Quizymode.Api.Tests.Features.Media;

public sealed class ImageNormalizerTests(ITestOutputHelper output)
{
    private static ImageNormalizer Create(MediaOptions? options = null, Action<NormalizeStage>? observer = null) =>
        new(options ?? new MediaOptions(), NullLogger<ImageNormalizer>.Instance, observer);

    private static async Task<NormalizedImage> NormalizeOkAsync(byte[] source, MediaOptions? options = null)
    {
        using ImageNormalizer normalizer = Create(options);
        NormalizeResult result = await normalizer.NormalizeAsync(source, CancellationToken.None);
        result.Problem.Should().BeNull();
        return result.Image!;
    }

    private static async Task<MediaProblem> NormalizeFailsAsync(byte[] source, MediaOptions? options = null)
    {
        using ImageNormalizer normalizer = Create(options);
        NormalizeResult result = await normalizer.NormalizeAsync(source, CancellationToken.None);
        result.Image.Should().BeNull();
        return result.Problem!;
    }

    [Fact]
    public async Task Jpeg_WithExifOrientationAndGps_IsRotatedAndMetadataStripped()
    {
        using SKBitmap source = MediaTestImages.TwoColor(40, 20);
        byte[] jpeg = MediaTestImages.WithExif(MediaTestImages.Encode(source, SKEncodedImageFormat.Jpeg, 95), orientation: 6);
        System.Text.Encoding.ASCII.GetString(jpeg).Should().Contain("Exif");

        NormalizedImage image = await NormalizeOkAsync(jpeg);

        // Orientation 6 means rotate 90 degrees clockwise to display: 40x20 becomes 20x40, left half (red) becomes the top.
        image.Width.Should().Be(20);
        image.Height.Should().Be(40);
        image.SourceFormat.Should().Be("jpeg");
        using SKBitmap decoded = SKBitmap.Decode(image.Bytes);
        decoded.GetPixel(10, 5).Red.Should().BeGreaterThan(200);
        decoded.GetPixel(10, 5).Blue.Should().BeLessThan(80);
        decoded.GetPixel(10, 35).Blue.Should().BeGreaterThan(200);
        MediaTestImages.WebPChunks(image.Bytes).Should().OnlyContain(chunk => chunk == "VP8 ");
        System.Text.Encoding.ASCII.GetString(image.Bytes).Should().NotContain("Exif").And.NotContain("GPS");
    }

    [Fact]
    public async Task Jpeg_WithDisplayP3Profile_IsAcceptedAndOutputCarriesNoIccp()
    {
        using SKBitmap bitmap = new(new SKImageInfo(64, 64, SKColorType.Rgba8888, SKAlphaType.Opaque, SKColorSpace.CreateRgb(SKColorSpaceTransferFn.Srgb, SKColorSpaceXyz.DisplayP3)));
        bitmap.Erase(new SKColor(200, 30, 30));
        byte[] jpeg = MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Jpeg, 90);
        System.Text.Encoding.ASCII.GetString(jpeg).Should().Contain("ICC_PROFILE", "the fixture must really carry a profile");

        NormalizedImage image = await NormalizeOkAsync(jpeg);

        IReadOnlyList<string> chunks = MediaTestImages.WebPChunks(image.Bytes);
        chunks.Should().NotContain(["ICCP", "EXIF", "XMP "]);
        ImageNormalizer.IsCleanWebP(image.Bytes).Should().BeTrue();
    }

    [Fact]
    public async Task Png_WithTransparency_KeepsAlpha()
    {
        using SKBitmap bitmap = new(64, 64);
        bitmap.Erase(SKColors.Transparent);
        using (SKCanvas canvas = new(bitmap))
        using (SKPaint paint = new() { Color = SKColors.Green })
        {
            canvas.DrawRect(0, 0, 32, 64, paint);
        }

        NormalizedImage image = await NormalizeOkAsync(MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Png, 100));

        using SKBitmap decoded = SKBitmap.Decode(image.Bytes);
        decoded.GetPixel(48, 32).Alpha.Should().Be(0);
        decoded.GetPixel(8, 32).Alpha.Should().Be(255);
        ImageNormalizer.IsCleanWebP(image.Bytes).Should().BeTrue();
    }

    [Fact]
    public async Task Png_WithLongestSideOver1280_IsDownscaledWithoutUpscalingSmallImages()
    {
        NormalizedImage large = await NormalizeOkAsync(MediaTestImages.Png(2560, 1280, SKColors.Navy));
        large.Width.Should().Be(1280);
        large.Height.Should().Be(640);

        NormalizedImage small = await NormalizeOkAsync(MediaTestImages.Png(100, 50, SKColors.Navy));
        small.Width.Should().Be(100);
        small.Height.Should().Be(50);
    }

    [Fact]
    public async Task WebP_StillImage_IsAccepted()
    {
        using SKBitmap bitmap = MediaTestImages.TwoColor(64, 32);
        byte[] webp = MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Webp, 90);

        NormalizedImage image = await NormalizeOkAsync(webp);

        image.SourceFormat.Should().Be("webp");
        image.Sha256.Should().MatchRegex("^[0-9a-f]{64}$");
        image.ProcessingVersion.Should().Be(1);
    }

    [Fact]
    public async Task PolyglotPng_IsReencodedWithoutTrailingPayloadAndHashDiffers()
    {
        const string payload = "<script>alert(1)</script>";
        byte[] png = MediaTestImages.PolyglotPng(MediaTestImages.Png(32, 32, SKColors.Orange), payload);

        NormalizedImage image = await NormalizeOkAsync(png);

        System.Text.Encoding.ASCII.GetString(image.Bytes).Should().NotContain("script").And.NotContain("Comment");
        image.Sha256.Should().NotBe(Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(png)).ToLowerInvariant());
        ImageNormalizer.IsCleanWebP(image.Bytes).Should().BeTrue();
    }

    [Fact]
    public async Task Png_DeclaredAsJpegMagic_IsDecidedByMagicBytesOnly()
    {
        // The normalizer never sees a file name or MIME type; a JPEG is a JPEG whatever it was called.
        using SKBitmap bitmap = MediaTestImages.TwoColor(32, 32);
        NormalizedImage image = await NormalizeOkAsync(MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Jpeg));
        image.SourceFormat.Should().Be("jpeg");
    }

    [Theory]
    [InlineData("GIF89a\x01\x00\x01\x00\x00\x00\x00;")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"><script>alert(1)</script></svg>")]
    [InlineData("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n")]
    [InlineData("<!doctype html><html><body>hi</body></html>")]
    [InlineData("")]
    public async Task UnsupportedContent_IsRejectedByMagicBytes(string content)
    {
        MediaProblem problem = await NormalizeFailsAsync(System.Text.Encoding.Latin1.GetBytes(content));
        problem.Code.Should().Be("Media.UnsupportedFormat");
        problem.StatusCode.Should().Be(400);
    }

    [Fact]
    public async Task TruncatedJpeg_IsUnreadable()
    {
        using SKBitmap bitmap = MediaTestImages.TwoColor(256, 256);
        byte[] jpeg = MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Jpeg);

        MediaProblem problem = await NormalizeFailsAsync(jpeg[..(jpeg.Length / 2)]);

        problem.Code.Should().Be("Media.Unreadable");
    }

    [Fact]
    public async Task PngMagicWithGarbageBody_IsUnreadable()
    {
        byte[] bytes = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        (await NormalizeFailsAsync(bytes)).Code.Should().Be("Media.Unreadable");
    }

    [Fact]
    public async Task Apng_IsRejectedAsAnimated()
    {
        byte[] apng = MediaTestImages.ToApng(MediaTestImages.Png(16, 16, SKColors.Red));
        (await NormalizeFailsAsync(apng)).Code.Should().Be("Media.Animated");
    }

    [Fact]
    public async Task AnimatedWebP_IsRejectedAsAnimated()
    {
        (await NormalizeFailsAsync(MediaTestImages.AnimatedWebP())).Code.Should().Be("Media.Animated");
    }

    [Fact]
    public async Task HugeDeclaredDimensions_AreRefusedFromTheHeaderBeforeAnyDecode()
    {
        List<NormalizeStage> stages = [];
        using ImageNormalizer normalizer = Create(observer: stages.Add);

        NormalizeResult result = await normalizer.NormalizeAsync(MediaTestImages.HeaderOnlyPng(100_000, 100_000), CancellationToken.None);

        result.Problem!.Code.Should().Be("Media.TooManyPixels");
        stages.Should().NotContain(NormalizeStage.Decoded);
        stages.Should().NotContain(NormalizeStage.Encoded);
    }

    [Fact]
    public async Task ExtremeAspectRatio_PastTheSideLimitIsRefused()
    {
        MediaProblem problem = await NormalizeFailsAsync(MediaTestImages.Png(8193, 1, SKColors.Black));
        problem.Code.Should().Be("Media.TooManyPixels");
    }

    [Fact]
    public async Task PixelCountLimit_IsAnOption()
    {
        MediaProblem problem = await NormalizeFailsAsync(
            MediaTestImages.Png(100, 100, SKColors.Black),
            new MediaOptions { MaxPixels = 9_999 });
        problem.Code.Should().Be("Media.TooManyPixels");
    }

    [Fact]
    public async Task NoisyPhoto_ThatCannotFitTheCap_IsCannotOptimize()
    {
        MediaProblem problem = await NormalizeFailsAsync(
            MediaTestImages.NoisyJpeg(1280, 960),
            new MediaOptions { MaxOutputBytes = 20_000 });
        problem.Code.Should().Be("Media.CannotOptimize");
    }

    [Fact]
    public async Task Output_NeverExceedsTheConfiguredCap()
    {
        NormalizedImage image = await NormalizeOkAsync(MediaTestImages.NoisyJpeg(640, 480), new MediaOptions { MaxOutputBytes = 200_000 });
        image.Bytes.Length.Should().BeLessThanOrEqualTo(200_000);
    }

    [Fact]
    public async Task ProcessingBudget_OverrunIsATimeout()
    {
        MediaOptions options = new() { ProcessingBudget = TimeSpan.FromMilliseconds(1) };
        using ImageNormalizer normalizer = Create(options, stage =>
        {
            if (stage == NormalizeStage.Decoded)
            {
                Thread.Sleep(50);
            }
        });

        NormalizeResult result = await normalizer.NormalizeAsync(MediaTestImages.Png(32, 32, SKColors.Red), CancellationToken.None);

        result.Problem!.Code.Should().Be("Media.ProcessingTimeout");
        result.Problem.StatusCode.Should().Be(503);
    }

    [Fact]
    public async Task SecondRequest_WithNoWaiterRoom_IsBusyImmediately_AndSlotIsReleasedAfterwards()
    {
        using ManualResetEventSlim reachedDecode = new();
        using ManualResetEventSlim release = new();
        MediaOptions options = new() { MaxConcurrentDecodes = 1, MaxWaiters = 0 };
        using ImageNormalizer normalizer = Create(options, stage =>
        {
            if (stage == NormalizeStage.Decoded)
            {
                reachedDecode.Set();
                release.Wait(TimeSpan.FromSeconds(10));
            }
        });
        byte[] png = MediaTestImages.Png(16, 16, SKColors.Red);

        Task<NormalizeResult> first = normalizer.NormalizeAsync(png, CancellationToken.None);
        reachedDecode.Wait(TimeSpan.FromSeconds(10)).Should().BeTrue();

        NormalizeResult second = await normalizer.NormalizeAsync(png, CancellationToken.None);
        second.Problem!.Code.Should().Be("Media.Busy");
        second.Problem.RetryAfterSeconds.Should().BePositive();

        release.Set();
        (await first).Problem.Should().BeNull();
        (await normalizer.NormalizeAsync(png, CancellationToken.None)).Problem.Should().BeNull();
    }

    [Fact]
    public async Task Waiter_ThatTimesOutWaitingForASlot_IsBusy()
    {
        using ManualResetEventSlim reachedDecode = new();
        using ManualResetEventSlim release = new();
        MediaOptions options = new() { MaxConcurrentDecodes = 1, MaxWaiters = 2, SemaphoreWaitTimeout = TimeSpan.FromMilliseconds(100) };
        using ImageNormalizer normalizer = Create(options, stage =>
        {
            if (stage == NormalizeStage.Decoded)
            {
                reachedDecode.Set();
                release.Wait(TimeSpan.FromSeconds(10));
            }
        });
        byte[] png = MediaTestImages.Png(16, 16, SKColors.Red);

        Task<NormalizeResult> first = normalizer.NormalizeAsync(png, CancellationToken.None);
        reachedDecode.Wait(TimeSpan.FromSeconds(10)).Should().BeTrue();

        NormalizeResult second = await normalizer.NormalizeAsync(png, CancellationToken.None);

        second.Problem!.Code.Should().Be("Media.Busy");
        release.Set();
        await first;
    }

    [Fact]
    public async Task CancellationDuringProcessing_Throws_AndReleasesTheSlot()
    {
        using CancellationTokenSource cts = new();
        MediaOptions options = new() { MaxConcurrentDecodes = 1, MaxWaiters = 0 };
        using ImageNormalizer normalizer = Create(options, stage =>
        {
            if (stage == NormalizeStage.Decoded)
            {
                cts.Cancel();
            }
        });
        byte[] png = MediaTestImages.Png(16, 16, SKColors.Red);

        Func<Task> act = () => normalizer.NormalizeAsync(png, cts.Token);
        await act.Should().ThrowAsync<OperationCanceledException>();

        // The slot was released: another request is not Busy even with no waiter room.
        using ImageNormalizer healthy = Create(options);
        (await healthy.NormalizeAsync(png, CancellationToken.None)).Problem.Should().BeNull();
        (await normalizer.NormalizeAsync(png, CancellationToken.None)).Problem.Should().BeNull();
    }

    [Fact]
    public async Task Fixtures_FlagGraphAndSchema_FitTheCap_AndMeasurements_AreLogged()
    {
        (string Name, byte[] Png)[] fixtures =
        [
            ("flag", MediaTestImages.FlagPng()),
            ("graph", MediaTestImages.GraphPng()),
            ("schema", MediaTestImages.SchemaPng())
        ];
        string? samplesDirectory = Environment.GetEnvironmentVariable("QM_MEDIA_SAMPLES_DIR");

        foreach ((string name, byte[] png) in fixtures)
        {
            Stopwatch clock = Stopwatch.StartNew();
            NormalizedImage image = await NormalizeOkAsync(png);
            clock.Stop();

            output.WriteLine($"{name}: source {png.Length} B PNG -> {image.Bytes.Length} B WebP {image.Width}x{image.Height} in {clock.ElapsedMilliseconds} ms");
            image.Bytes.Length.Should().BeLessThanOrEqualTo(102_400);
            ImageNormalizer.IsCleanWebP(image.Bytes).Should().BeTrue();

            if (!string.IsNullOrEmpty(samplesDirectory))
            {
                Directory.CreateDirectory(samplesDirectory);
                await File.WriteAllBytesAsync(Path.Combine(samplesDirectory, $"{name}.webp"), image.Bytes);
                await File.WriteAllBytesAsync(Path.Combine(samplesDirectory, $"{name}-source.png"), png);
            }
        }
    }

    [Fact]
    public async Task LosslessEncodeTime_OfA1280GraphIsMeasured()
    {
        byte[] png = MediaTestImages.GraphPng(1280, 800);
        using ImageNormalizer warmup = Create();
        await warmup.NormalizeAsync(MediaTestImages.Png(16, 16, SKColors.Red), CancellationToken.None);

        Stopwatch clock = Stopwatch.StartNew();
        NormalizedImage image = await NormalizeOkAsync(png);
        clock.Stop();

        output.WriteLine($"graph 1280x800 full normalization: {clock.ElapsedMilliseconds} ms, {image.Bytes.Length} B");
        clock.Elapsed.Should().BeLessThan(TimeSpan.FromSeconds(20), "the default processing budget is 20 s");
    }

    [Fact]
    public async Task PngWithDeflatedZerosOver32KiB_IsRefusedBeforeAnyCodecIsCreated()
    {
        List<NormalizeStage> stages = [];
        using ImageNormalizer normalizer = Create(observer: stages.Add);
        byte[] png = MediaTestImages.WithChunksBeforeIdat(MediaTestImages.Png(16, 16, SKColors.Red), "zTXt", DeflatedZerosChunk(40 * 1024 * 1024), 1);

        NormalizeResult result = await normalizer.NormalizeAsync(png, CancellationToken.None);

        result.Problem!.Code.Should().Be("Media.Unreadable");
        stages.Should().NotContain(NormalizeStage.CodecCreated);
    }

    [Fact]
    public async Task PngWithTooManyAncillaryChunks_IsRefusedBeforeAnyCodecIsCreated()
    {
        List<NormalizeStage> stages = [];
        using ImageNormalizer normalizer = Create(observer: stages.Add);
        byte[] png = MediaTestImages.WithChunksBeforeIdat(MediaTestImages.Png(16, 16, SKColors.Red), "tEXt", "a\0b"u8.ToArray(), 65);

        NormalizeResult result = await normalizer.NormalizeAsync(png, CancellationToken.None);

        result.Problem!.Code.Should().Be("Media.Unreadable");
        stages.Should().NotContain(NormalizeStage.CodecCreated);
    }

    private static byte[] DeflatedZerosChunk(int inflatedBytes)
    {
        using MemoryStream stream = new();
        stream.Write("k\0\0"u8);
        using (System.IO.Compression.ZLibStream zlib = new(stream, System.IO.Compression.CompressionLevel.SmallestSize, leaveOpen: true))
        {
            byte[] zeros = new byte[1024 * 1024];
            for (int written = 0; written < inflatedBytes; written += zeros.Length)
            {
                zlib.Write(zeros);
            }
        }

        return stream.ToArray();
    }

    [Fact]
    public void DeflatedZerosFixture_IsJustOver32KiBCompressed_ButInflatesToTensOfMegabytes()
    {
        DeflatedZerosChunk(40 * 1024 * 1024).Length.Should().BeInRange(32 * 1024 + 1, 64 * 1024);
    }

    [Fact]
    public async Task PngWithARealisticSmallIccpChunk_StillPasses()
    {
        using MemoryStream chunk = new();
        chunk.Write("icc\0\0"u8);
        using (System.IO.Compression.ZLibStream zlib = new(chunk, System.IO.Compression.CompressionLevel.Optimal, leaveOpen: true))
        {
            byte[] profile = new byte[3000];
            new Random(7).NextBytes(profile);
            zlib.Write(profile);
        }

        byte[] png = MediaTestImages.WithChunksBeforeIdat(MediaTestImages.Png(16, 16, SKColors.Red), "iCCP", chunk.ToArray(), 1);

        NormalizedImage image = await NormalizeOkAsync(png);

        image.SourceFormat.Should().Be("png");
    }

    [Fact]
    public async Task PngWithOneSmallTextChunk_StillPasses()
    {
        byte[] png = MediaTestImages.WithChunksBeforeIdat(MediaTestImages.Png(16, 16, SKColors.Red), "tEXt", "Comment\0hello"u8.ToArray(), 1);

        NormalizedImage image = await NormalizeOkAsync(png);

        image.SourceFormat.Should().Be("png");
    }

    [Fact]
    public async Task UnexpectedEncoderFailure_IsMappedToUnreadable_NotAnException()
    {
        using ImageNormalizer normalizer = Create(observer: stage =>
        {
            if (stage == NormalizeStage.Resized)
            {
                throw new InvalidOperationException("simulated Skia failure");
            }
        });

        NormalizeResult result = await normalizer.NormalizeAsync(MediaTestImages.Png(16, 16, SKColors.Red), CancellationToken.None);

        result.Problem!.Code.Should().Be("Media.Unreadable");
    }

    [Fact]
    public void Options_RejectLimitsBeyondTheCodeAndDatabaseCaps()
    {
        new MediaOptions { MaxOutputBytes = 102_401 }.Validate().Should().HaveCount(1);
        new MediaOptions { MaxSourceBytes = 2 * 1024 * 1024 + 1 }.Validate().Should().HaveCount(1);
        new MediaOptions { MaxOutputBytes = 102_400, MaxSourceBytes = 2 * 1024 * 1024 }.Validate().Should().BeEmpty();
    }

    [Fact]
    public void Options_RejectNonPositiveLimits()
    {
        new MediaOptions().Validate().Should().BeEmpty();
        new MediaOptions { MaxConcurrentDecodes = 0, ProcessingBudget = TimeSpan.Zero }.Validate().Should().HaveCount(2);
    }
}
