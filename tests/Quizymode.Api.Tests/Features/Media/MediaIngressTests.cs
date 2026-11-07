using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.DependencyInjection;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

public sealed class MediaIngressTests : DatabaseTestFixture
{
    [Fact]
    public async Task InvalidBodiesSpendDurableRequestsAndByteAllowanceBeforeDecodeAcrossRestart()
    {
        MediaOptions options = new() { MaxUploadsPerHour = 2, MaxUploadsPerDay = 2 };
        FakeMediaObjectStore store = new();
        async Task<IResult> InvalidAsync()
        {
            await using var db = CreateDbContext();
            DefaultHttpContext context = new(); context.Request.ContentType = await db.MediaIngressAttempts.AnyAsync() ? "multipart/form-data; boundary=" + new string('x', 200) : "invalid";
            using ImageNormalizer normalizer = new(options, NullLogger<ImageNormalizer>.Instance, null);
            return await UploadImage.HandleAsync(context.Request, db, "owner", store, normalizer, options, TimeProvider.System, NullLogger.Instance, CancellationToken.None);
        }
        (await StatusAsync(await InvalidAsync())).Should().Be(400);
        (await StatusAsync(await InvalidAsync())).Should().Be(400);
        (await StatusAsync(await InvalidAsync())).Should().Be(429);
        await using var restarted = CreateDbContext();
        (await restarted.MediaIngressAttempts.CountAsync()).Should().Be(2);
        (await restarted.MediaIngressAttempts.SumAsync(x => x.ReservedBytes)).Should().Be(2L * (options.MaxSourceBytes + 64 * 1024));
        (await restarted.MediaIngressAttempts.AllAsync(x => x.CompletedAt != null && x.ReceivedBytes == 0)).Should().BeTrue();
        (await restarted.MediaUploadAttempts.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task GlobalReadLeaseSurvivesRestartAndByteBudgetDoesNotDependOnDecodeClaims()
    {
        MediaOptions options = new() { MaxGlobalIngress = 1, MaxIngressBytesPerDay = 2L * 1024 * 1024 + 64 * 1024 };
        DateTime now = DateTime.UtcNow;
        var first = await MediaIngress.ReserveAsync(DbContext, "one", options, now, CancellationToken.None);
        first.Attempt.Should().NotBeNull();
        await using var restarted = CreateDbContext();
        ((IStatusCodeHttpResult)(await MediaIngress.ReserveAsync(restarted, "two", options, now, CancellationToken.None)).Error!).StatusCode.Should().Be(429);
        await MediaIngress.FinishAsync(restarted, first.Attempt!.Id, 23, now);
        ((IStatusCodeHttpResult)(await MediaIngress.ReserveAsync(restarted, "one", options, now, CancellationToken.None)).Error!).StatusCode.Should().Be(429, "spent bytes survive completion/restart");
        (await MediaIngress.ReserveAsync(restarted, "two", options, now, CancellationToken.None)).Attempt.Should().NotBeNull();
        (await restarted.MediaUploadClaims.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task PartialMultipartReadTimesOutAndPersistsCountWithoutHoldingGlobalLease()
    {
        MediaOptions options = new() { IngressReadTimeout = TimeSpan.FromMilliseconds(50) };
        DefaultHttpContext context = new(); context.Request.ContentType = "multipart/form-data; boundary=fixture";
        context.Request.Body = new PartialStream();
        using ImageNormalizer normalizer = new(options, NullLogger<ImageNormalizer>.Instance, null);
        IResult result = await UploadImage.HandleAsync(context.Request, DbContext, "owner", new FakeMediaObjectStore(), normalizer, options, TimeProvider.System, NullLogger.Instance, CancellationToken.None);
        (await StatusAsync(result)).Should().Be(400);
        await using var restarted = CreateDbContext();
        var attempt = await restarted.MediaIngressAttempts.SingleAsync(); attempt.CompletedAt.Should().NotBeNull(); attempt.ReceivedBytes.Should().BeGreaterThan(0); attempt.ReservedBytes.Should().BeGreaterThan(attempt.ReceivedBytes);
        (await restarted.MediaUploadAttempts.CountAsync()).Should().Be(0);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(21)]
    public void IngressConfigurationRejectsUnboundedConcurrency(int value) => new MediaOptions { MaxGlobalIngress = value }.Validate().Should().Contain(x => x.Contains(nameof(MediaOptions.MaxGlobalIngress)));

    private static async Task<int> StatusAsync(IResult result)
    {
        using var services = new ServiceCollection().AddLogging().BuildServiceProvider();
        DefaultHttpContext context = new() { RequestServices = services }; context.Response.Body = new MemoryStream();
        await result.ExecuteAsync(context); return context.Response.StatusCode;
    }

    private sealed class PartialStream : MemoryStream
    {
        private bool sent;
        public override async ValueTask<int> ReadAsync(Memory<byte> buffer, CancellationToken ct = default)
        {
            if (!sent) { sent = true; byte[] prefix = System.Text.Encoding.ASCII.GetBytes("--fixture\r\nContent-Disposition: form-data; name=\"file\"; filename=\"fixture\"\r\n\r\npartial"); prefix.CopyTo(buffer); return prefix.Length; }
            await Task.Delay(Timeout.Infinite, ct); return 0;
        }
    }
}
