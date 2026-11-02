using Amazon.S3;
using FluentAssertions;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using Moq;
using Quizymode.Api.Features.Media;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Tests.TestFixtures;
using Xunit;

namespace Quizymode.Api.Tests.Features.Media;

public sealed class MediaStorageTests : IDisposable
{
    private const string ValidSha = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    private readonly string _root = Path.Combine(Path.GetTempPath(), "qm-media-tests-" + Guid.NewGuid().ToString("N"));
    private readonly CapturingLoggerProvider _logs = new();

    public void Dispose()
    {
        if (Directory.Exists(_root))
        {
            Directory.Delete(_root, recursive: true);
        }
    }

    private ILogger Logger() => _logs.CreateLogger("test");

    private static TestHostEnvironment Environment(string name) => new() { EnvironmentName = name };

    // ---- Provider selection fails closed ------------------------------------------------------------------------------

    [Fact]
    public void Default_Provider_IsNone_AndStoreIsUnavailable()
    {
        MediaOptions options = new();

        options.Storage.Provider.Should().Be("None");
        MediaObjectStoreFactory.Create(options, Environment(Environments.Production), Logger()).IsAvailable.Should().BeFalse();
    }

    [Fact]
    public void S3_WithoutBucket_FallsBackToNone_AndLogsAnError()
    {
        MediaOptions options = new() { Storage = { Provider = "S3" } };

        MediaObjectStoreFactory.ResolveProvider(options, Environment(Environments.Production), Logger()).Should().Be("None");

        _logs.Entries.Should().ContainSingle(entry => entry.Level == LogLevel.Error && entry.Message.Contains("BucketName"));
    }

    [Theory]
    [InlineData("quizymode-web")]
    [InlineData("QuizyMode-Web")]
    [InlineData("  quizymode-web ")]
    public void S3_WithTheWebsiteBucket_FallsBackToNone_AndLogsAnError(string bucket)
    {
        MediaOptions options = new() { Storage = { Provider = "S3" }, S3 = { BucketName = bucket } };

        IMediaObjectStore store = MediaObjectStoreFactory.Create(options, Environment(Environments.Production), Logger());

        store.IsAvailable.Should().BeFalse();
        store.Should().BeOfType<UnavailableMediaObjectStore>("no S3 client may exist for the website bucket");
        _logs.Entries.Should().Contain(entry => entry.Level == LogLevel.Error && entry.Message.Contains("website bucket"));
    }

    [Fact]
    public void S3_WithAPrivateBucket_IsSelected_AndCredentialsAreNeverLogged()
    {
        MediaOptions options = new()
        {
            Storage = { Provider = "s3" },
            S3 = { BucketName = "quizymode-media-prod", AccessKeyId = "AKIAEXAMPLEEXAMPLE", SecretAccessKey = "secret-example-value" }
        };

        using S3MediaObjectStore store = (S3MediaObjectStore)MediaObjectStoreFactory.Create(options, Environment(Environments.Production), Logger());

        store.IsAvailable.Should().BeTrue();
        _logs.Entries.Should().NotContain(entry => entry.Message.Contains("secret-example-value") || entry.Message.Contains("AKIAEXAMPLE"));
    }

    [Theory]
    [InlineData("Production")]
    [InlineData("Staging")]
    public void FileSystem_OutsideDevelopmentAndTesting_FallsBackToNone_AndLogsAnError(string environment)
    {
        MediaOptions options = new() { Storage = { Provider = "FileSystem" } };

        IMediaObjectStore store = MediaObjectStoreFactory.Create(options, Environment(environment), Logger());

        store.IsAvailable.Should().BeFalse();
        _logs.Entries.Should().Contain(entry => entry.Level == LogLevel.Error && entry.Message.Contains("FileSystem"));
    }

    [Theory]
    [InlineData("Development")]
    [InlineData("Testing")]
    public void FileSystem_InDevelopmentAndTesting_IsAllowed(string environment)
    {
        MediaOptions options = new() { Storage = { Provider = "FileSystem" } };
        TestHostEnvironment host = Environment(environment);
        host.ContentRootPath = _root;

        MediaObjectStoreFactory.Create(options, host, Logger()).Should().BeOfType<FileSystemMediaObjectStore>();
    }

    [Fact]
    public void UnknownProvider_FallsBackToNone()
    {
        MediaOptions options = new() { Storage = { Provider = "Azure" } };

        MediaObjectStoreFactory.ResolveProvider(options, Environment(Environments.Development), Logger()).Should().Be("None");
        _logs.Entries.Should().Contain(entry => entry.Level == LogLevel.Error);
    }

    [Fact]
    public async Task UnavailableStore_NeverWrites()
    {
        UnavailableMediaObjectStore store = new();

        Func<Task> put = () => store.PutIfAbsentAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), [1], "image/webp", CancellationToken.None);

        await put.Should().ThrowAsync<MediaStorageException>();
    }

    // ---- Key validation ------------------------------------------------------------------------------------------------

    [Fact]
    public void Key_HasTheDocumentedShape()
    {
        Guid id = Guid.Parse("11111111-2222-3333-4444-555555555555");

        MediaObjectKey.Build(id, ValidSha).Should().Be($"normalized/v1/11111111222233334444555555555555/{ValidSha}.webp");
        MediaObjectKey.IsValid(MediaObjectKey.Build(id, ValidSha)).Should().BeTrue();
    }

    [Theory]
    [InlineData("")]
    [InlineData("quizymode-web/index.html")]
    [InlineData("normalized/v1/../../etc/passwd")]
    [InlineData("normalized/v1/11111111222233334444555555555555/0123.webp")]
    [InlineData("normalized/v2/11111111222233334444555555555555/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp")]
    [InlineData("normalized/v1/11111111222233334444555555555555/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp\n")]
    [InlineData("normalized/v1/11111111-2222-3333-4444-555555555555/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp")]
    [InlineData("/normalized/v1/11111111222233334444555555555555/0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef.webp")]
    public async Task InvalidKeys_AreRefusedByBothStores(string key)
    {
        MediaObjectKey.IsValid(key).Should().BeFalse();

        FileSystemMediaObjectStore fileStore = new(_root);
        (await FluentActions.Awaiting(() => fileStore.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None))
            .Should().ThrowAsync<MediaStorageException>()).Which.Should().NotBeNull();
        await FluentActions.Awaiting(() => fileStore.OpenReadAsync(key, CancellationToken.None)).Should().ThrowAsync<MediaStorageException>();

        using S3MediaObjectStore s3Store = new(new AmazonS3Client(new Amazon.Runtime.AnonymousAWSCredentials(), Amazon.RegionEndpoint.USEast1), "quizymode-media-prod");
        await FluentActions.Awaiting(() => s3Store.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None)).Should().ThrowAsync<MediaStorageException>();
        await FluentActions.Awaiting(() => s3Store.OpenReadAsync(key, CancellationToken.None)).Should().ThrowAsync<MediaStorageException>();
    }

    // ---- File system store -------------------------------------------------------------------------------------------

    [Fact]
    public async Task FileSystemStore_PutIfAbsent_DoesNotOverwrite_AndReadsBack()
    {
        FileSystemMediaObjectStore store = new(_root);
        string key = MediaObjectKey.Build(Guid.NewGuid(), ValidSha);

        (await store.PutIfAbsentAsync(key, [1, 2, 3], "image/webp", CancellationToken.None)).Should().Be(PutOutcome.Created);
        (await store.PutIfAbsentAsync(key, [9, 9, 9, 9], "image/webp", CancellationToken.None)).Should().Be(PutOutcome.AlreadyExists);

        using MediaObjectContent? content = await store.OpenReadAsync(key, CancellationToken.None);
        content.Should().NotBeNull();
        content!.Length.Should().Be(3);
        using MemoryStream copy = new();
        await content.Stream.CopyToAsync(copy);
        copy.ToArray().Should().Equal(1, 2, 3);
    }

    [Fact]
    public async Task FileSystemStore_MissingObject_ReadsAsNull()
    {
        FileSystemMediaObjectStore store = new(_root);

        (await store.OpenReadAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), CancellationToken.None)).Should().BeNull();
    }

    [Fact]
    public async Task FakeStore_PutIfAbsent_HasConditionalWriteSemantics()
    {
        FakeMediaObjectStore store = new();
        string key = MediaObjectKey.Build(Guid.NewGuid(), ValidSha);

        (await store.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None)).Should().Be(PutOutcome.Created);
        (await store.PutIfAbsentAsync(key, [2], "image/webp", CancellationToken.None)).Should().Be(PutOutcome.AlreadyExists);

        store.Objects[key].Should().Equal(1);
    }

    // ---- S3 error semantics (kept honest by a stubbed client) --------------------------------------------------------

    [Fact]
    public async Task S3Store_PutIfAbsent_MapsPreconditionAndConflictStatuses()
    {
        string key = MediaObjectKey.Build(Guid.NewGuid(), ValidSha);

        using (S3MediaObjectStore exists = StubS3(System.Net.HttpStatusCode.PreconditionFailed, "PreconditionFailed"))
        {
            (await exists.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None)).Should().Be(PutOutcome.AlreadyExists);
        }

        using (S3MediaObjectStore conflict = StubS3(System.Net.HttpStatusCode.Conflict, "ConditionalRequestConflict"))
        {
            await FluentActions.Awaiting(() => conflict.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None))
                .Should().ThrowAsync<MediaStorageException>();
        }

        using (S3MediaObjectStore denied = StubS3(System.Net.HttpStatusCode.Forbidden, "AccessDenied"))
        {
            await FluentActions.Awaiting(() => denied.PutIfAbsentAsync(key, [1], "image/webp", CancellationToken.None))
                .Should().ThrowAsync<MediaStorageException>("a denied write is a storage failure, never success");
        }
    }

    [Theory]
    [InlineData(System.Net.HttpStatusCode.Forbidden, "AccessDenied")]
    [InlineData(System.Net.HttpStatusCode.NotFound, "NoSuchKey")]
    public async Task S3Store_Get_MissingOrDenied_IsNull(System.Net.HttpStatusCode status, string code)
    {
        using S3MediaObjectStore store = StubS3(status, code);

        (await store.OpenReadAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), CancellationToken.None)).Should().BeNull();
    }

    [Theory]
    [InlineData("InvalidAccessKeyId")]
    [InlineData("SignatureDoesNotMatch")]
    public async Task S3Store_Get_CredentialForbidden_IsAStorageFailure_NotMissing(string code)
    {
        using S3MediaObjectStore store = StubS3(System.Net.HttpStatusCode.Forbidden, code);

        (await FluentActions.Awaiting(() => store.OpenReadAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), CancellationToken.None))
            .Should().ThrowAsync<MediaStorageException>()).Which.Message.Should().Contain(code);
    }

    [Fact]
    public async Task S3Store_Get_ClientSideFailure_IsAStorageFailure()
    {
        Mock<IAmazonS3> client = new();
        client.Setup(c => c.GetObjectAsync(It.IsAny<Amazon.S3.Model.GetObjectRequest>(), It.IsAny<CancellationToken>()))
            .ThrowsAsync(new Amazon.Runtime.AmazonClientException("network"));
        using S3MediaObjectStore store = new(client.Object, "quizymode-media-prod");

        await FluentActions.Awaiting(() => store.OpenReadAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), CancellationToken.None))
            .Should().ThrowAsync<MediaStorageException>();
    }

    [Fact]
    public async Task S3Store_Get_OtherFailure_Throws()
    {
        using S3MediaObjectStore store = StubS3(System.Net.HttpStatusCode.InternalServerError, "InternalError");

        await FluentActions.Awaiting(() => store.OpenReadAsync(MediaObjectKey.Build(Guid.NewGuid(), ValidSha), CancellationToken.None))
            .Should().ThrowAsync<MediaStorageException>();
    }

    private static S3MediaObjectStore StubS3(System.Net.HttpStatusCode status, string errorCode)
    {
        Moq.Mock<IAmazonS3> client = new();
        AmazonS3Exception exception = new("stub", Amazon.Runtime.ErrorType.Unknown, errorCode, "request", status);
        client.Setup(c => c.PutObjectAsync(Moq.It.IsAny<Amazon.S3.Model.PutObjectRequest>(), Moq.It.IsAny<CancellationToken>())).ThrowsAsync(exception);
        client.Setup(c => c.GetObjectAsync(Moq.It.IsAny<Amazon.S3.Model.GetObjectRequest>(), Moq.It.IsAny<CancellationToken>())).ThrowsAsync(exception);
        return new S3MediaObjectStore(client.Object, "quizymode-media-prod");
    }
}
