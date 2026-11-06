using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.OpenApi;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using Microsoft.Extensions.Primitives;
using Microsoft.Net.Http.Headers;
using Microsoft.OpenApi;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Media.Storage;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Media;

/// <summary>
/// POST /media/images (multipart/form-data, one <c>file</c> part): validates and normalizes a JPEG, PNG or still WebP into a
/// bounded WebP, stores only the normalized bytes in private object storage, and returns the asset metadata (AC 3.24).
/// The original upload and its file name are never stored or logged. The feature is dark until a storage provider is configured.
/// </summary>
public static class UploadImage
{
    public const string RateLimitPolicy = "media-uploads";

    /// <summary>Allowance for multipart boundaries and headers on top of the file bytes.</summary>
    private const int EnvelopeAllowanceBytes = 64 * 1024;

    private const string LoggerCategory = "Quizymode.Api.Features.Media.UploadImage";

    public sealed record Response(
        Guid Id,
        string State,
        int Width,
        int Height,
        int Bytes,
        string Format,
        string Sha256,
        int ProcessingVersion,
        DateTime CreatedAt);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapPost("media/images", Handler)
                .WithTags("Media")
                .WithSummary("Upload a picture; it is normalized to a small WebP and stored privately")
                .WithDescription("multipart/form-data with exactly one file part named \"file\" (JPEG, PNG, or still WebP, at most 2 MiB, " +
                    "at most 16 megapixels). The original is never stored; the response describes the normalized WebP. " +
                    "Answers 503 Media.StorageUnavailable until storage is configured.")
                .RequireAuthorization()
                .RequireRateLimiting(RateLimitPolicy)
                .DisableAntiforgery()
                .WithMetadata(new RequestSizeLimitAttribute(new MediaOptions().MaxSourceBytes + EnvelopeAllowanceBytes))
                .AddOpenApiOperationTransformer(DescribeMultipartBody)
                .Produces<Response>(StatusCodes.Status201Created)
                .ProducesProblem(StatusCodes.Status400BadRequest)
                .Produces(StatusCodes.Status401Unauthorized)
                .ProducesProblem(StatusCodes.Status409Conflict)
                .ProducesProblem(StatusCodes.Status413PayloadTooLarge)
                .Produces(StatusCodes.Status429TooManyRequests)
                .ProducesProblem(StatusCodes.Status503ServiceUnavailable);
        }

        private static async Task<IResult> Handler(
            HttpRequest httpRequest,
            ApplicationDbContext db,
            IUserContext userContext,
            IMediaObjectStore store,
            ImageNormalizer normalizer,
            IOptions<MediaOptions> options,
            TimeProvider timeProvider,
            ILoggerFactory loggerFactory,
            CancellationToken cancellationToken)
        {
            if (!userContext.IsAuthenticated || string.IsNullOrEmpty(userContext.UserId))
            {
                return CustomResults.Unauthorized();
            }

            return await HandleAsync(
                httpRequest,
                db,
                userContext.UserId,
                store,
                normalizer,
                options.Value,
                timeProvider,
                loggerFactory.CreateLogger(LoggerCategory),
                cancellationToken);
        }
    }

    /// <summary>
    /// Documents the multipart body in OpenAPI. The handler reads the body itself (never IFormFile binding), so the
    /// framework cannot infer it, and an Accepts() filter would answer 415 instead of this slice's 400 Media.InvalidRequest.
    /// </summary>
    private static Task DescribeMultipartBody(OpenApiOperation operation, OpenApiOperationTransformerContext context, CancellationToken cancellationToken)
    {
        operation.RequestBody = new OpenApiRequestBody
        {
            Required = true,
            Content = new Dictionary<string, OpenApiMediaType>
            {
                ["multipart/form-data"] = new()
                {
                    Schema = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Object,
                        Properties = new Dictionary<string, IOpenApiSchema>
                        {
                            ["file"] = new OpenApiSchema { Type = JsonSchemaType.String, Format = "binary" }
                        },
                        Required = new HashSet<string> { "file" }
                    }
                }
            }
        };
        return Task.CompletedTask;
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration)
        {
            services.AddOptions<MediaOptions>()
                .Bind(configuration.GetSection(MediaOptions.SectionName))
                .Validate(options => options.Validate().Count == 0, "Media options contain an invalid value.")
                .ValidateOnStart();
            services.TryAddSingleton(TimeProvider.System);
            services.AddSingleton<IMediaObjectStore>(provider => MediaObjectStoreFactory.Create(
                provider.GetRequiredService<IOptions<MediaOptions>>().Value,
                provider.GetRequiredService<IHostEnvironment>(),
                provider.GetRequiredService<ILoggerFactory>().CreateLogger("Quizymode.Api.Features.Media.Storage")));
            services.AddSingleton<ImageNormalizer>();
        }
    }

    internal static async Task<IResult> HandleAsync(
        HttpRequest httpRequest,
        ApplicationDbContext db,
        string userId,
        IMediaObjectStore store,
        ImageNormalizer normalizer,
        MediaOptions options,
        TimeProvider timeProvider,
        ILogger logger,
        CancellationToken cancellationToken)
    {
        if (!store.IsAvailable)
        {
            return MediaErrors.StorageUnavailable.ToResult();
        }

        if (!options.UploadsEnabled)
        {
            return MediaErrors.Disabled.ToResult();
        }

        MediaProblem? quotaProblem = await MediaQuota.CheckBeforeUploadAsync(
            db, userId, options, timeProvider.GetUtcNow().UtcDateTime, cancellationToken);
        if (quotaProblem is not null)
        {
            logger.LogInformation("Media upload refused: Code={Code}", quotaProblem.Code);
            return quotaProblem.ToResult();
        }

        Stopwatch clock = Stopwatch.StartNew();
        (byte[]? source, MediaProblem? readProblem) = await ReadSourceAsync(httpRequest, options.MaxSourceBytes, cancellationToken);
        if (readProblem is not null)
        {
            logger.LogInformation("Media upload refused: Code={Code}", readProblem.Code);
            return readProblem.ToResult();
        }

        NormalizeResult normalized = await normalizer.NormalizeAsync(source!, cancellationToken);
        if (normalized.Problem is not null)
        {
            logger.LogInformation(
                "Media upload refused: Code={Code}, SourceBytes={SourceBytes}, ElapsedMs={ElapsedMs}",
                normalized.Problem.Code,
                source!.Length,
                clock.ElapsedMilliseconds);
            return normalized.Problem.ToResult();
        }

        NormalizedImage image = normalized.Image!;
        DateTime createdAt = timeProvider.GetUtcNow().UtcDateTime;
        MediaAsset asset = new()
        {
            Id = Guid.NewGuid(),
            OwnerUserId = userId,
            State = MediaAssetState.Processing,
            Sha256 = image.Sha256,
            Width = image.Width,
            Height = image.Height,
            Bytes = image.Bytes.Length,
            Format = "webp",
            SourceFormat = image.SourceFormat,
            SourceBytes = image.SourceBytes,
            ProcessingVersion = image.ProcessingVersion,
            CreatedAt = createdAt,
            UpdatedAt = createdAt
        };
        db.MediaAssets.Add(asset);
        await db.SaveChangesAsync(cancellationToken);

        MediaProblem? raceProblem = await MediaQuota.CheckAfterInsertAsync(db, asset, options, CancellationToken.None);
        if (raceProblem is not null)
        {
            await db.MediaAssets.Where(x => x.Id == asset.Id).ExecuteDeleteAsync(CancellationToken.None);
            logger.LogInformation("Media upload refused after insert: Code={Code}", raceProblem.Code);
            return raceProblem.ToResult();
        }

        // From here the row exists, so the outcome (Ready or Failed) is always recorded, even if the client disconnects.
        string key = MediaObjectKey.Build(asset.Id, image.Sha256);
        try
        {
            using CancellationTokenSource writeTimeout = new(options.StorageWriteTimeout);
            await store.PutIfAbsentAsync(key, image.Bytes, MediaObjectKey.ContentType, writeTimeout.Token);
        }
        catch (Exception ex)
        {
            DateTime failedAt = timeProvider.GetUtcNow().UtcDateTime;
            logger.LogError(ex, "Media storage write failed: AssetId={AssetId}", asset.Id);
            await db.MediaAssets
                .Where(x => x.Id == asset.Id && x.State == MediaAssetState.Processing && x.DeletedAt == null)
                .ExecuteUpdateAsync(
                    setters => setters
                        .SetProperty(x => x.State, MediaAssetState.Failed)
                        .SetProperty(x => x.FailureCode, MediaErrors.StorageFailed.Code)
                        .SetProperty(x => x.UpdatedAt, failedAt),
                    CancellationToken.None);
            return MediaErrors.StorageFailed.ToResult();
        }

        DateTime readyAt = timeProvider.GetUtcNow().UtcDateTime;
        int updated = await db.MediaAssets
            .Where(x => x.Id == asset.Id && x.State == MediaAssetState.Processing && x.DeletedAt == null)
            .ExecuteUpdateAsync(
                setters => setters
                    .SetProperty(x => x.State, MediaAssetState.Ready)
                    .SetProperty(x => x.ObjectKey, key)
                    .SetProperty(x => x.UpdatedAt, readyAt),
                CancellationToken.None);
        if (updated == 0)
        {
            logger.LogWarning("Media asset was withdrawn before completion: AssetId={AssetId}", asset.Id);
            return MediaErrors.Withdrawn.ToResult();
        }

        logger.LogInformation(
            "Media asset ready: AssetId={AssetId}, SourceBytes={SourceBytes}, Bytes={Bytes}, Width={Width}, Height={Height}, ElapsedMs={ElapsedMs}",
            asset.Id,
            image.SourceBytes,
            image.Bytes.Length,
            image.Width,
            image.Height,
            clock.ElapsedMilliseconds);

        Response response = new(
            asset.Id,
            MediaAssetState.Ready.ToString(),
            image.Width,
            image.Height,
            image.Bytes.Length,
            "webp",
            image.Sha256,
            image.ProcessingVersion,
            asset.CreatedAt);
        return Results.Created($"/media/images/{asset.Id}/content", response);
    }

    /// <summary>
    /// Reads the single <c>file</c> part into memory, never past <paramref name="maxBytes"/> + 1 bytes and never to disk.
    /// A body over the limit (by Content-Length, by counted bytes, or by Kestrel's own limit) is Media.TooLarge.
    /// </summary>
    internal static async Task<(byte[]? Bytes, MediaProblem? Problem)> ReadSourceAsync(
        HttpRequest request,
        int maxBytes,
        CancellationToken cancellationToken)
    {
        if (!MediaTypeHeaderValue.TryParse(request.ContentType, out MediaTypeHeaderValue? contentType)
            || !contentType.MediaType.Equals("multipart/form-data", StringComparison.OrdinalIgnoreCase)
            || StringSegment.IsNullOrEmpty(contentType.Boundary))
        {
            return (null, MediaErrors.InvalidRequest);
        }

        if (request.ContentLength > (long)maxBytes + EnvelopeAllowanceBytes)
        {
            return (null, MediaErrors.TooLarge(maxBytes));
        }

        string boundary = HeaderUtilities.RemoveQuotes(contentType.Boundary).Value!;
        MultipartReader reader = new(boundary, request.Body);
        byte[]? file = null;
        try
        {
            MultipartSection? section;
            while ((section = await reader.ReadNextSectionAsync(cancellationToken)) is not null)
            {
                if (!ContentDispositionHeaderValue.TryParse(section.ContentDisposition, out ContentDispositionHeaderValue? disposition)
                    || !HeaderUtilities.RemoveQuotes(disposition.Name).Equals("file", StringComparison.Ordinal))
                {
                    continue;
                }

                if (file is not null)
                {
                    return (null, MediaErrors.InvalidRequest);
                }

                using MemoryStream buffer = new();
                byte[] chunk = new byte[16 * 1024];
                int read;
                while ((read = await section.Body.ReadAsync(chunk, cancellationToken)) > 0)
                {
                    if (buffer.Length + read > maxBytes)
                    {
                        return (null, MediaErrors.TooLarge(maxBytes));
                    }

                    buffer.Write(chunk, 0, read);
                }

                file = buffer.ToArray();
            }
        }
        catch (BadHttpRequestException ex) when (ex.StatusCode == StatusCodes.Status413PayloadTooLarge)
        {
            return (null, MediaErrors.TooLarge(maxBytes));
        }
        catch (Exception ex) when (ex is InvalidDataException or BadHttpRequestException)
        {
            return (null, MediaErrors.InvalidRequest);
        }

        return file is null ? (null, MediaErrors.InvalidRequest) : (file, null);
    }
}
