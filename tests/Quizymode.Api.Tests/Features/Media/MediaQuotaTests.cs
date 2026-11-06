using System.Net;
using System.Net.Http.Headers;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Shared.Models;
using Quizymode.Api.Tests.TestFixtures;
using SkiaSharp;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

/// <summary>Durable upload quotas, global ceilings and the kill switch (AC 3.28).</summary>
public sealed class MediaQuotaTests : DatabaseTestFixture
{
    private async Task<JwtHttpTestHost> StartAsync(MediaOptions options) =>
        await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddSingleton(Options.Create(options));
                services.AddSingleton<IMediaObjectStore>(new FakeMediaObjectStore());
                services.AddSingleton(new ImageNormalizer(options, NullLogger<ImageNormalizer>.Instance, null));
                services.AddSingleton(TimeProvider.System);
            },
            app => new UploadImage.Endpoint().MapEndpoint(app));

    private static HttpRequestMessage Upload(string token)
    {
        MultipartFormDataContent form = new();
        ByteArrayContent part = new(MediaTestImages.Png(16, 16, SKColors.Red));
        part.Headers.ContentType = new MediaTypeHeaderValue("image/png");
        form.Add(part, "file", "a.png");
        return JwtHttpTestHost.Request(HttpMethod.Post, "/media/images", token, form);
    }

    /// <summary>Makes the API create the user row for <paramref name="subject"/> (with uploads switched off) and returns its id.</summary>
    private async Task<string> OwnerIdAsync(JwtHttpTestHost host, MediaOptions options, string subject)
    {
        bool before = options.UploadsEnabled;
        options.UploadsEnabled = false;
        using HttpResponseMessage warmUp = await host.Client.SendAsync(Upload(host.CreateToken(subject, subject + "@example.com")));
        options.UploadsEnabled = before;
        await using ApplicationDbContext db = CreateDbContext();
        return (await db.Users.SingleAsync(u => u.Subject == subject)).Id.ToString();
    }

    private async Task SeedAssetsAsync(string owner, int count, int bytes = 10, MediaAssetState state = MediaAssetState.Ready)
    {
        await using ApplicationDbContext db = CreateDbContext();
        for (int i = 0; i < count; i++)
        {
            Guid id = Guid.NewGuid();
            db.MediaAssets.Add(new MediaAsset
            {
                Id = id,
                OwnerUserId = owner,
                State = state,
                ObjectKey = state == MediaAssetState.Ready ? MediaObjectKey.Build(id, new string('a', 64)) : null,
                FailureCode = state == MediaAssetState.Failed ? "Media.StorageFailed" : null,
                Sha256 = new string('a', 64),
                Width = state == MediaAssetState.Ready ? 1 : 0,
                Height = state == MediaAssetState.Ready ? 1 : 0,
                Bytes = state == MediaAssetState.Ready ? bytes : 1,
                SourceFormat = "png",
                ProcessingVersion = 1,
                CreatedAt = DateTime.UtcNow.AddMinutes(-5),
                UpdatedAt = DateTime.UtcNow.AddMinutes(-5)
            });
        }

        await db.SaveChangesAsync();
    }

    [Fact]
    public async Task Upload_AtDailyLimit_Returns429WithRetryAfter_AndCreatesNoRow()
    {
        MediaOptions options = new() { MaxUploadsPerUserPerDay = 3 };
        await using JwtHttpTestHost host = await StartAsync(options);
        await SeedAssetsAsync(await OwnerIdAsync(host, options, "owner"), 3, state: MediaAssetState.Failed);

        using HttpResponseMessage response = await host.Client.SendAsync(Upload(host.CreateToken("owner", "o@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        response.Headers.RetryAfter.Should().NotBeNull();
        (await response.Content.ReadAsStringAsync()).Should().Contain("Media.QuotaExceeded");
        await using ApplicationDbContext db = CreateDbContext();
        (await db.MediaAssets.CountAsync()).Should().Be(3);
    }

    [Fact]
    public async Task Upload_DailyLimitIsPerAccount_AndOldAttemptsAgeOut()
    {
        MediaOptions options = new() { MaxUploadsPerUserPerDay = 1 };
        await using JwtHttpTestHost host = await StartAsync(options);
        await SeedAssetsAsync(await OwnerIdAsync(host, options, "owner"), 1, state: MediaAssetState.Failed);
        await using (ApplicationDbContext db = CreateDbContext())
        {
            await db.MediaAssets.ExecuteUpdateAsync(s => s.SetProperty(x => x.CreatedAt, DateTime.UtcNow.AddHours(-25)));
        }

        using HttpResponseMessage aged = await host.Client.SendAsync(Upload(host.CreateToken("owner", "o@example.com")));
        using HttpResponseMessage other = await host.Client.SendAsync(Upload(host.CreateToken("other", "x@example.com")));
        using HttpResponseMessage again = await host.Client.SendAsync(Upload(host.CreateToken("owner", "o@example.com")));

        aged.StatusCode.Should().Be(HttpStatusCode.Created);
        other.StatusCode.Should().Be(HttpStatusCode.Created);
        again.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Upload_AtRetainedBytesLimit_Returns429_ButWithdrawnAndFailedBytesDoNotCount()
    {
        MediaOptions options = new() { MaxRetainedBytesPerUser = 1000 };
        await using JwtHttpTestHost host = await StartAsync(options);
        await SeedAssetsAsync(await OwnerIdAsync(host, options, "owner"), 1, bytes: 1000);
        string token = host.CreateToken("owner", "o@example.com");

        using HttpResponseMessage full = await host.Client.SendAsync(Upload(token));
        await using (ApplicationDbContext db = CreateDbContext())
        {
            await db.MediaAssets.ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTime.UtcNow));
        }

        using HttpResponseMessage freed = await host.Client.SendAsync(Upload(token));

        full.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        freed.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Fact]
    public async Task Upload_AtPendingReviewLimit_Returns429()
    {
        MediaOptions options = new() { MaxPendingReviewsPerUser = 1 };
        await using JwtHttpTestHost host = await StartAsync(options);
        string ownerId = await OwnerIdAsync(host, options, "owner");
        await using (ApplicationDbContext db = CreateDbContext())
        {
            Category category = new() { Id = Guid.NewGuid(), Name = "geography", IsPrivate = false, CreatedBy = ownerId };
            db.Categories.Add(category);
            MediaAsset asset = PictureSeed.AddAsset(db, ownerId);
            asset.CreatedAt = DateTime.UtcNow.AddDays(-2);
            PictureSeed.AddPictureItem(db, category, ownerId, true, ItemImageReviewState.PendingReview, asset);
            await db.SaveChangesAsync();
        }

        using HttpResponseMessage response = await host.Client.SendAsync(Upload(host.CreateToken("owner", "o@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
    }

    [Fact]
    public async Task Upload_GlobalDailyCeiling_Returns429CapacityReached()
    {
        MediaOptions options = new() { MaxUploadsGlobalPerDay = 2 };
        await using JwtHttpTestHost host = await StartAsync(options);
        await SeedAssetsAsync("a", 1);
        await SeedAssetsAsync("b", 1);

        using HttpResponseMessage response = await host.Client.SendAsync(Upload(host.CreateToken("c", "c@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        (await response.Content.ReadAsStringAsync()).Should().Contain("Media.CapacityReached");
    }

    [Fact]
    public async Task Upload_KillSwitchOff_Returns503Disabled()
    {
        MediaOptions options = new() { UploadsEnabled = false };
        await using JwtHttpTestHost host = await StartAsync(options);

        using HttpResponseMessage response = await host.Client.SendAsync(Upload(host.CreateToken("owner", "o@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        (await response.Content.ReadAsStringAsync()).Should().Contain("Media.Disabled");
    }

    [Fact]
    public async Task Upload_ConcurrentRequests_NeverAdmitMoreThanTheDailyLimit()
    {
        MediaOptions options = new() { MaxUploadsPerUserPerDay = 2 };
        await using JwtHttpTestHost host = await StartAsync(options);
        string token = host.CreateToken("owner", "o@example.com");

        HttpResponseMessage[] responses = await Task.WhenAll(
            Enumerable.Range(0, 6).Select(_ => host.Client.SendAsync(Upload(token))));

        responses.Count(r => r.StatusCode == HttpStatusCode.Created).Should().BeLessThanOrEqualTo(2);
        await using ApplicationDbContext db = CreateDbContext();
        (await db.MediaAssets.CountAsync(x => x.OwnerUserId == "owner")).Should().BeLessThanOrEqualTo(2);
        foreach (HttpResponseMessage response in responses)
        {
            response.Dispose();
        }
    }
}
