using System.Globalization;

namespace Quizymode.Api.Features.Media;

/// <summary>A refusal with the HTTP status it maps to. <see cref="Code"/> is returned as the ProblemDetails title.</summary>
internal sealed record MediaProblem(string Code, string Detail, int StatusCode, int? RetryAfterSeconds = null)
{
    public IResult ToResult() => new MediaProblemResult(this);
}

internal static class MediaErrors
{
    public static MediaProblem TooLarge(long maxBytes) => new(
        "Media.TooLarge",
        $"Pictures must be {maxBytes / 1024} KB or smaller.",
        StatusCodes.Status413PayloadTooLarge);

    public static readonly MediaProblem InvalidRequest = new(
        "Media.InvalidRequest",
        "Send multipart/form-data with exactly one file part named \"file\".",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem UnsupportedFormat = new(
        "Media.UnsupportedFormat",
        "Only JPEG, PNG, and WebP pictures are supported.",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem Unreadable = new(
        "Media.Unreadable",
        "This picture could not be read. It may be damaged or truncated.",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem TooManyPixels = new(
        "Media.TooManyPixels",
        "This picture has too many pixels. Use a smaller image.",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem Animated = new(
        "Media.Animated",
        "Animated pictures are not supported. Use a still image.",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem CannotOptimize = new(
        "Media.CannotOptimize",
        "This picture cannot be reduced to an acceptable size. Use a simpler or smaller image.",
        StatusCodes.Status400BadRequest);

    public static readonly MediaProblem Busy = new(
        "Media.Busy",
        "Picture processing is busy. Try again shortly.",
        StatusCodes.Status503ServiceUnavailable,
        RetryAfterSeconds: 5);

    public static readonly MediaProblem ProcessingTimeout = new(
        "Media.ProcessingTimeout",
        "Processing this picture took too long. Try a smaller image.",
        StatusCodes.Status503ServiceUnavailable);

    public static readonly MediaProblem StorageUnavailable = new(
        "Media.StorageUnavailable",
        "Picture storage is not available.",
        StatusCodes.Status503ServiceUnavailable);

    public static readonly MediaProblem StorageFailed = new(
        "Media.StorageFailed",
        "The picture could not be stored. Try again later.",
        StatusCodes.Status503ServiceUnavailable);

    public static MediaProblem QuotaExceeded(string what, long limit, string unit = "") => new(
        "Media.QuotaExceeded",
        $"You reached your {what} ({limit}{(unit.Length > 0 ? " " + unit : string.Empty)}). Remove unused pictures or try again later.",
        StatusCodes.Status429TooManyRequests,
        RetryAfterSeconds: 3600);

    public static readonly MediaProblem GlobalCeiling = new(
        "Media.CapacityReached",
        "Picture uploads are temporarily at capacity. Try again later.",
        StatusCodes.Status429TooManyRequests,
        RetryAfterSeconds: 3600);

    public static readonly MediaProblem Disabled = new(
        "Media.Disabled",
        "Picture uploads are temporarily turned off.",
        StatusCodes.Status503ServiceUnavailable);

    public static readonly MediaProblem Withdrawn = new(
        "Media.Withdrawn",
        "This picture was removed while it was being processed.",
        StatusCodes.Status409Conflict);
}

internal sealed class MediaProblemResult(MediaProblem problem) : IResult
{
    public Task ExecuteAsync(HttpContext httpContext)
    {
        if (problem.RetryAfterSeconds is int seconds)
        {
            httpContext.Response.Headers.RetryAfter = seconds.ToString(CultureInfo.InvariantCulture);
        }

        return Results.Problem(title: problem.Code, detail: problem.Detail, statusCode: problem.StatusCode)
            .ExecuteAsync(httpContext);
    }
}
