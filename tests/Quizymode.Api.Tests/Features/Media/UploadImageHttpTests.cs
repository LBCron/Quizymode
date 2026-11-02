using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Http;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
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

/// <summary>Picture upload and content endpoints over real HTTP (Kestrel, production JWT configuration) with a fake object store (AC 3.24).</summary>
public sealed class UploadImageHttpTests : DatabaseTestFixture
{
    private static readonly string[] AdminGroups = ["Admins"];

    private static MediaOptions DefaultOptions() => new();

    private async Task<JwtHttpTestHost> StartAsync(FakeMediaObjectStore store, MediaOptions? options = null, bool useRateLimiting = false)
    {
        MediaOptions resolved = options ?? DefaultOptions();
        return await JwtHttpTestHost.StartAsync(
            CreateDbContext,
            services =>
            {
                services.AddSingleton(Options.Create(resolved));
                services.AddSingleton<IMediaObjectStore>(store);
                services.AddSingleton(new ImageNormalizer(resolved, NullLogger<ImageNormalizer>.Instance, null));
                services.AddSingleton(TimeProvider.System);
            },
            app =>
            {
                new UploadImage.Endpoint().MapEndpoint(app);
                new GetImageContent.Endpoint().MapEndpoint(app);
            },
            useRateLimiting: useRateLimiting);
    }

    private static HttpRequestMessage Upload(string? token, byte[] file, bool chunked = false, string fileName = "photo.png", string mime = "image/png")
    {
        MultipartFormDataContent form = new();
        ByteArrayContent part = new(file);
        part.Headers.ContentType = new MediaTypeHeaderValue(mime);
        form.Add(part, "file", fileName);
        HttpContent content = chunked ? new ChunkedContent(form) : form;
        return JwtHttpTestHost.Request(HttpMethod.Post, "/media/images", token, content);
    }

    private static byte[] PngPaddedTo(int length)
    {
        byte[] png = MediaTestImages.Png(32, 32, SKColors.Teal);
        png.Length.Should().BeLessThan(length);
        byte[] padded = new byte[length];
        png.CopyTo(padded, 0);
        return padded;
    }

    private static async Task<JsonElement> ReadJsonAsync(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    private static string TitleOf(JsonElement problem) => problem.GetProperty("title").GetString()!;

    // ---- Upload ------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Upload_RequiresAuthentication()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore());

        using HttpResponseMessage response = await host.Client.SendAsync(Upload(null, MediaTestImages.Png(16, 16, SKColors.Red)));

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Upload_ValidPng_Returns201_StoresOnlyTheNormalizedObject_AndRecordsReadyRow()
    {
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store);
        byte[] png = MediaTestImages.GraphPng(1600, 900);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), png, fileName: "secret-name.png"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        JsonElement body = await ReadJsonAsync(response);
        body.GetProperty("state").GetString().Should().Be("Ready");
        body.GetProperty("format").GetString().Should().Be("webp");
        body.GetProperty("width").GetInt32().Should().Be(1280);
        body.GetProperty("height").GetInt32().Should().Be(720);
        body.GetProperty("processingVersion").GetInt32().Should().Be(1);
        body.GetProperty("sha256").GetString().Should().MatchRegex("^[0-9a-f]{64}$");
        response.Headers.Location!.ToString().Should().Be($"/media/images/{body.GetProperty("id").GetGuid()}/content");
        (await response.Content.ReadAsStringAsync()).Should().NotContain("secret-name");

        store.Objects.Should().ContainSingle();
        KeyValuePair<string, byte[]> stored = store.Objects.Single();
        stored.Value.Length.Should().Be(body.GetProperty("bytes").GetInt32()).And.BeLessThanOrEqualTo(102_400);
        stored.Value.Length.Should().BeLessThan(png.Length * 2);
        ImageNormalizer.IsCleanWebP(stored.Value).Should().BeTrue();

        using ApplicationDbContext verify = CreateDbContext();
        MediaAsset row = await verify.MediaAssets.SingleAsync();
        row.State.Should().Be(MediaAssetState.Ready);
        row.ObjectKey.Should().Be(stored.Key);
        row.Id.Should().Be(body.GetProperty("id").GetGuid());
        body.GetProperty("createdAt").GetDateTimeOffset().UtcDateTime.Should().Be(DateTime.SpecifyKind(row.CreatedAt, DateTimeKind.Utc));
        row.SourceFormat.Should().Be("png");
        row.SourceBytes.Should().Be(png.Length);
        row.Sha256.Should().Be(body.GetProperty("sha256").GetString());
        row.FailureCode.Should().BeNull();
        row.DeletedAt.Should().BeNull();
    }

    [Fact]
    public async Task Upload_JpegDeclaredAsPng_IsAcceptedByMagicBytes()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore());
        using SKBitmap bitmap = MediaTestImages.TwoColor(64, 64);
        byte[] jpeg = MediaTestImages.Encode(bitmap, SKEncodedImageFormat.Jpeg);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), jpeg, fileName: "x.png", mime: "image/png"));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        (await ReadJsonAsync(response)).GetProperty("state").GetString().Should().Be("Ready");
    }

    [Fact]
    public async Task Upload_ExactlyTheMaximumSize_IsAccepted()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore());

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), PngPaddedTo(2_097_152)));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    [Theory]
    [InlineData(2_097_153, false)]
    [InlineData(2_097_153, true)]
    [InlineData(3_000_000, true)]
    public async Task Upload_OverTheMaximumSize_Returns413ProblemDetails(int length, bool chunked)
    {
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), PngPaddedTo(length), chunked));

        response.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        TitleOf(await ReadJsonAsync(response)).Should().Be("Media.TooLarge");
        store.Objects.Should().BeEmpty();
        using ApplicationDbContext verify = CreateDbContext();
        (await verify.MediaAssets.CountAsync()).Should().Be(0, "a refused upload creates no row");
    }

    [Fact]
    public async Task Upload_SourceLimit_IsAnOption()
    {
        byte[] png = MediaTestImages.Png(16, 16, SKColors.Red);
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store, new MediaOptions { MaxSourceBytes = png.Length });
        string token = host.CreateToken("owner", "owner@example.com");

        using HttpResponseMessage exact = await host.Client.SendAsync(Upload(token, png));
        using HttpResponseMessage over = await host.Client.SendAsync(Upload(token, [.. png, 0]));
        using HttpResponseMessage overChunked = await host.Client.SendAsync(Upload(token, [.. png, 0], chunked: true));

        exact.StatusCode.Should().Be(HttpStatusCode.Created);
        over.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
        overChunked.StatusCode.Should().Be(HttpStatusCode.RequestEntityTooLarge);
    }

    [Fact]
    public async Task Upload_BadRequestShapes_Return400()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore());
        string token = host.CreateToken("owner", "owner@example.com");
        byte[] png = MediaTestImages.Png(16, 16, SKColors.Red);

        using HttpResponseMessage notMultipart = await host.Client.SendAsync(
            JwtHttpTestHost.Request(HttpMethod.Post, "/media/images", token, JsonContent.Create(new { file = "x" })));
        MultipartFormDataContent noFile = new() { { new StringContent("hello"), "caption" } };
        using HttpResponseMessage missingFile = await host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Post, "/media/images", token, noFile));
        MultipartFormDataContent twoFiles = new()
        {
            { new ByteArrayContent(png), "file", "a.png" },
            { new ByteArrayContent(png), "file", "b.png" }
        };
        using HttpResponseMessage manyFiles = await host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Post, "/media/images", token, twoFiles));

        foreach (HttpResponseMessage response in new[] { notMultipart, missingFile, manyFiles })
        {
            response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
            TitleOf(await ReadJsonAsync(response)).Should().Be("Media.InvalidRequest");
        }
    }

    [Theory]
    [InlineData("GIF89a\x01\x00\x01\x00\x00\x00\x00;", "Media.UnsupportedFormat")]
    [InlineData("<svg xmlns=\"http://www.w3.org/2000/svg\"/>", "Media.UnsupportedFormat")]
    public async Task Upload_UnsupportedContent_Returns400WithCode(string content, string code)
    {
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), System.Text.Encoding.Latin1.GetBytes(content), fileName: "x.png"));

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        TitleOf(await ReadJsonAsync(response)).Should().Be(code);
        store.Objects.Should().BeEmpty();
    }

    [Fact]
    public async Task Upload_WithNoStorageConfigured_FailsClosedWith503_AndWritesNothing()
    {
        FakeMediaObjectStore store = new() { Available = false };
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), MediaTestImages.Png(16, 16, SKColors.Red)));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        TitleOf(await ReadJsonAsync(response)).Should().Be("Media.StorageUnavailable");
        using ApplicationDbContext verify = CreateDbContext();
        (await verify.MediaAssets.CountAsync()).Should().Be(0);
    }

    [Fact]
    public async Task Upload_WhenTheStoreThrows_Returns503_AndMarksTheRowFailed()
    {
        FakeMediaObjectStore store = new() { PutFailure = new MediaStorageException("boom") };
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), MediaTestImages.Png(16, 16, SKColors.Red)));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
        TitleOf(await ReadJsonAsync(response)).Should().Be("Media.StorageFailed");
        using ApplicationDbContext verify = CreateDbContext();
        MediaAsset row = await verify.MediaAssets.SingleAsync();
        row.State.Should().Be(MediaAssetState.Failed);
        row.FailureCode.Should().Be("Media.StorageFailed");
        row.ObjectKey.Should().BeNull();
    }

    [Fact]
    public async Task Upload_WhenTheKeyAlreadyExists_IsIdempotentSuccess_AndNeverOverwrites()
    {
        FakeMediaObjectStore store = new();
        byte[] existing = [9, 9, 9];
        store.OnPut = key =>
        {
            store.Objects[key] = existing;
            return Task.CompletedTask;
        };
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), MediaTestImages.Png(16, 16, SKColors.Red)));

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        store.Objects.Single().Value.Should().BeSameAs(existing);
        using ApplicationDbContext verify = CreateDbContext();
        (await verify.MediaAssets.SingleAsync()).State.Should().Be(MediaAssetState.Ready);
    }

    [Fact]
    public async Task Upload_CompletionAfterWithdrawal_StaysDeleted_AndAnswers409()
    {
        FakeMediaObjectStore store = new();
        store.OnPut = async _ =>
        {
            using ApplicationDbContext other = CreateDbContext();
            await other.MediaAssets.ExecuteUpdateAsync(s => s.SetProperty(x => x.DeletedAt, DateTime.UtcNow));
        };
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            Upload(host.CreateToken("owner", "owner@example.com"), MediaTestImages.Png(16, 16, SKColors.Red)));

        response.StatusCode.Should().Be(HttpStatusCode.Conflict);
        TitleOf(await ReadJsonAsync(response)).Should().Be("Media.Withdrawn");
        using ApplicationDbContext verify = CreateDbContext();
        MediaAsset row = await verify.MediaAssets.SingleAsync();
        row.DeletedAt.Should().NotBeNull();
        row.State.Should().Be(MediaAssetState.Processing, "the conditional update must not resurrect a withdrawn asset");
        row.ObjectKey.Should().BeNull();
    }

    [Fact]
    public async Task Upload_IsRateLimitedPerUser()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore(), useRateLimiting: true);
        string token = host.CreateToken("owner", "owner@example.com");
        byte[] tiny = MediaTestImages.Png(8, 8, SKColors.Red);

        for (int i = 0; i < 20; i++)
        {
            using HttpResponseMessage ok = await host.Client.SendAsync(Upload(token, tiny));
            ok.StatusCode.Should().Be(HttpStatusCode.Created);
        }

        using HttpResponseMessage limited = await host.Client.SendAsync(Upload(token, tiny));
        limited.StatusCode.Should().Be(HttpStatusCode.TooManyRequests);
        limited.Headers.RetryAfter.Should().NotBeNull();

        using HttpResponseMessage otherUser = await host.Client.SendAsync(Upload(host.CreateToken("other", "other@example.com"), tiny));
        otherUser.StatusCode.Should().Be(HttpStatusCode.Created);
    }

    // ---- Content ------------------------------------------------------------------------------------------------------

    [Fact]
    public async Task Content_Authorization_OwnerAndAdminSucceed_OthersGetIdentical404_AnonymousGets401()
    {
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store);
        string owner = host.CreateToken("owner", "owner@example.com");
        string other = host.CreateToken("other", "other@example.com");
        string admin = host.CreateToken("admin", "admin@example.com", AdminGroups);

        using HttpResponseMessage created = await host.Client.SendAsync(Upload(owner, MediaTestImages.FlagPng()));
        Guid id = (await ReadJsonAsync(created)).GetProperty("id").GetGuid();
        byte[] expected = store.Objects.Single().Value;

        // Not-Ready assets owned by the owner: a Failed and a Processing row.
        string ownerId;
        Guid failedId = Guid.NewGuid();
        Guid processingId = Guid.NewGuid();
        Guid withdrawnId = Guid.NewGuid();
        store.Objects[MediaObjectKey.Build(withdrawnId, new string((char)97, 64))] = store.Objects.Single().Value;
        using (ApplicationDbContext seed = CreateDbContext())
        {
            ownerId = (await seed.Users.SingleAsync(user => user.Subject == "owner")).Id.ToString();
            seed.MediaAssets.AddRange(
                NewRow(failedId, ownerId, MediaAssetState.Failed, "Media.StorageFailed"),
                NewRow(processingId, ownerId, MediaAssetState.Processing, null),
                WithdrawnReady(withdrawnId, ownerId, MediaObjectKey.Build(withdrawnId, new string((char)97, 64))));
            await seed.SaveChangesAsync();
        }

        async Task<HttpResponseMessage> Get(Guid assetId, string? token) =>
            await host.Client.SendAsync(JwtHttpTestHost.Request(HttpMethod.Get, $"/media/images/{assetId}/content", token));

        using HttpResponseMessage ownerResponse = await Get(id, owner);
        ownerResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await ownerResponse.Content.ReadAsByteArrayAsync()).Should().Equal(expected);
        ownerResponse.Content.Headers.ContentType!.MediaType.Should().Be("image/webp");
        ownerResponse.Headers.NonValidated["Cache-Control"].ToString().Should().Be("private, no-store, no-transform");
        ownerResponse.Headers.GetValues("X-Content-Type-Options").Should().Equal("nosniff");
        ownerResponse.Headers.GetValues("Content-Security-Policy").Should().Equal("default-src 'none'; sandbox");
        ownerResponse.Headers.GetValues("Cross-Origin-Resource-Policy").Should().Equal("same-site");
        ownerResponse.Content.Headers.ContentLength.Should().Be(expected.Length);

        using HttpResponseMessage adminResponse = await Get(id, admin);
        adminResponse.StatusCode.Should().Be(HttpStatusCode.OK);
        (await adminResponse.Content.ReadAsByteArrayAsync()).Should().Equal(expected);

        using HttpResponseMessage anonymous = await Get(id, null);
        anonymous.StatusCode.Should().Be(HttpStatusCode.Unauthorized);

        using HttpResponseMessage otherUser = await Get(id, other);
        using HttpResponseMessage unknown = await Get(Guid.NewGuid(), other);
        using HttpResponseMessage failed = await Get(failedId, owner);
        using HttpResponseMessage processing = await Get(processingId, owner);
        using HttpResponseMessage withdrawn = await Get(withdrawnId, owner);
        using HttpResponseMessage adminFailed = await Get(failedId, admin);

        HttpResponseMessage[] notFound = [otherUser, unknown, failed, processing, adminFailed, withdrawn];
        foreach (HttpResponseMessage response in notFound)
        {
            response.StatusCode.Should().Be(HttpStatusCode.NotFound);
        }

        string unknownBody = await unknown.Content.ReadAsStringAsync();
        foreach (HttpResponseMessage response in notFound)
        {
            (await response.Content.ReadAsStringAsync()).Should().Be(unknownBody);
            response.Content.Headers.ContentType?.ToString().Should().Be(unknown.Content.Headers.ContentType?.ToString());
        }
    }

    [Fact]
    public async Task Content_WhenTheObjectIsMissingOrDenied_Returns404()
    {
        FakeMediaObjectStore store = new();
        await using JwtHttpTestHost host = await StartAsync(store);
        string owner = host.CreateToken("owner", "owner@example.com");
        using HttpResponseMessage created = await host.Client.SendAsync(Upload(owner, MediaTestImages.Png(16, 16, SKColors.Red)));
        Guid id = (await ReadJsonAsync(created)).GetProperty("id").GetGuid();
        store.ReadReturnsNull = true;

        using HttpResponseMessage response = await host.Client.SendAsync(
            JwtHttpTestHost.Request(HttpMethod.Get, $"/media/images/{id}/content", owner));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task Content_WithNoStorageConfigured_Returns503()
    {
        FakeMediaObjectStore store = new() { Available = false };
        await using JwtHttpTestHost host = await StartAsync(store);

        using HttpResponseMessage response = await host.Client.SendAsync(
            JwtHttpTestHost.Request(HttpMethod.Get, $"/media/images/{Guid.NewGuid()}/content", host.CreateToken("owner", "owner@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.ServiceUnavailable);
    }

    [Fact]
    public async Task Content_NonGuidRoute_IsNotRouted()
    {
        await using JwtHttpTestHost host = await StartAsync(new FakeMediaObjectStore());

        using HttpResponseMessage response = await host.Client.SendAsync(
            JwtHttpTestHost.Request(HttpMethod.Get, "/media/images/not-a-guid/content", host.CreateToken("owner", "owner@example.com")));

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ---- Handler-level: cancellation, reading, headers ---------------------------------------------------------------

    private static DefaultHttpContext RequestWith(byte[] file, int? contentLength = null, bool declareLength = true)
    {
        (byte[] body, string contentType) = MediaTestImages.Multipart(("file", file));
        DefaultHttpContext context = new();
        context.Request.ContentType = contentType;
        context.Request.Body = new MemoryStream(body);
        if (declareLength)
        {
            context.Request.ContentLength = contentLength ?? body.Length;
        }

        context.RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider();
        return context;
    }

    private static async Task<int> ExecuteAsync(IResult result)
    {
        DefaultHttpContext context = new() { RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider() };
        context.Response.Body = new MemoryStream();
        await result.ExecuteAsync(context);
        return context.Response.StatusCode;
    }

    [Fact]
    public async Task CancelledRequest_AfterTheRowExists_StillEndsReady()
    {
        using CancellationTokenSource cts = new();
        FakeMediaObjectStore store = new() { OnPut = _ =>
        {
            cts.Cancel();
            return Task.CompletedTask;
        } };
        MediaOptions options = DefaultOptions();
        using ImageNormalizer normalizer = new(options, NullLogger<ImageNormalizer>.Instance, null);
        DefaultHttpContext context = RequestWith(MediaTestImages.Png(16, 16, SKColors.Red));

        IResult result = await UploadImage.HandleAsync(
            context.Request, DbContext, "user-1", store, normalizer, options, TimeProvider.System, NullLogger.Instance, cts.Token);

        (await ExecuteAsync(result)).Should().Be(StatusCodes.Status201Created);
        using ApplicationDbContext verify = CreateDbContext();
        (await verify.MediaAssets.SingleAsync()).State.Should().Be(MediaAssetState.Ready);
    }

    [Fact]
    public async Task CancelledRequest_WhenTheStoreFails_StillEndsFailed()
    {
        using CancellationTokenSource cts = new();
        FakeMediaObjectStore store = new()
        {
            PutFailure = new MediaStorageException("boom"),
            OnPut = _ =>
            {
                cts.Cancel();
                return Task.CompletedTask;
            }
        };
        MediaOptions options = DefaultOptions();
        using ImageNormalizer normalizer = new(options, NullLogger<ImageNormalizer>.Instance, null);
        DefaultHttpContext context = RequestWith(MediaTestImages.Png(16, 16, SKColors.Red));

        IResult result = await UploadImage.HandleAsync(
            context.Request, DbContext, "user-1", store, normalizer, options, TimeProvider.System, NullLogger.Instance, cts.Token);

        (await ExecuteAsync(result)).Should().Be(StatusCodes.Status503ServiceUnavailable);
        using ApplicationDbContext verify = CreateDbContext();
        (await verify.MediaAssets.SingleAsync()).State.Should().Be(MediaAssetState.Failed);
    }

    [Fact]
    public async Task ReadSource_BoundaryAtMaxBytes()
    {
        byte[] atLimit = new byte[1000];
        byte[] overLimit = new byte[1001];

        (byte[]? bytes, MediaProblem? problem) exact = await UploadImage.ReadSourceAsync(RequestWith(atLimit).Request, 1000, CancellationToken.None);
        (byte[]? bytes, MediaProblem? problem) over = await UploadImage.ReadSourceAsync(RequestWith(overLimit).Request, 1000, CancellationToken.None);
        (byte[]? bytes, MediaProblem? problem) overNoLength = await UploadImage.ReadSourceAsync(
            RequestWith(overLimit, declareLength: false).Request, 1000, CancellationToken.None);

        exact.problem.Should().BeNull();
        exact.bytes!.Length.Should().Be(1000);
        over.problem!.Code.Should().Be("Media.TooLarge");
        overNoLength.problem!.Code.Should().Be("Media.TooLarge");
    }

    [Fact]
    public async Task ReadSource_ContentLengthBeyondTheEnvelopeAllowance_IsRefusedWithoutReading()
    {
        DefaultHttpContext context = RequestWith(new byte[10], contentLength: 1000 + 64 * 1024 + 1);

        (byte[]? bytes, MediaProblem? problem) result = await UploadImage.ReadSourceAsync(context.Request, 1000, CancellationToken.None);

        result.problem!.Code.Should().Be("Media.TooLarge");
        ((MemoryStream)context.Request.Body).Position.Should().Be(0);
    }

    [Fact]
    public async Task BusyProblem_CarriesRetryAfter()
    {
        DefaultHttpContext context = new() { RequestServices = new ServiceCollection().AddLogging().BuildServiceProvider() };
        context.Response.Body = new MemoryStream();

        await MediaErrors.Busy.ToResult().ExecuteAsync(context);

        context.Response.StatusCode.Should().Be(StatusCodes.Status503ServiceUnavailable);
        context.Response.Headers.RetryAfter.ToString().Should().Be("5");
    }

    private static MediaAsset WithdrawnReady(Guid id, string ownerId, string objectKey)
    {
        MediaAsset row = NewRow(id, ownerId, MediaAssetState.Ready, null);
        row.ObjectKey = objectKey;
        row.DeletedAt = DateTime.UtcNow;
        return row;
    }

    private static MediaAsset NewRow(Guid id, string ownerId, MediaAssetState state, string? failureCode) => new()
    {
        Id = id,
        OwnerUserId = ownerId,
        State = state,
        Sha256 = new string('a', 64),
        Width = 10,
        Height = 10,
        Bytes = 100,
        Format = "webp",
        SourceFormat = "png",
        SourceBytes = 200,
        ProcessingVersion = 1,
        FailureCode = failureCode,
        CreatedAt = DateTime.UtcNow,
        UpdatedAt = DateTime.UtcNow
    };

    /// <summary>Sends the inner content without a Content-Length so the request goes out chunked.</summary>
    private sealed class ChunkedContent : HttpContent
    {
        private readonly HttpContent _inner;

        public ChunkedContent(HttpContent inner)
        {
            _inner = inner;
            foreach (KeyValuePair<string, IEnumerable<string>> header in inner.Headers)
            {
                if (!header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase))
                {
                    Headers.TryAddWithoutValidation(header.Key, header.Value);
                }
            }
        }

        protected override Task SerializeToStreamAsync(Stream stream, TransportContext? context) => _inner.CopyToAsync(stream, context);

        protected override bool TryComputeLength(out long length)
        {
            length = 0;
            return false;
        }
    }
}
