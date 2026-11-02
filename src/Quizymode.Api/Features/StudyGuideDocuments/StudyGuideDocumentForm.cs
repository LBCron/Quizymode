using FluentValidation;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Options;

namespace Quizymode.Api.Features.StudyGuideDocuments;

/// <summary>Reads and validates the multipart form shared by <c>POST /study-guides/documents</c> and <c>/quick</c>.</summary>
internal static class StudyGuideDocumentForm
{
    /// <summary>Either a ready request (with the buffered upload, if any) or the rejection to return as-is.</summary>
    internal sealed record Parsed(
        CreateStudyGuideDocument.Request? Request,
        CreateStudyGuideDocument.UploadedFile? Upload,
        IResult? Rejection);

    internal static async Task<Parsed> ReadAsync(
        IFormFile? file,
        string? text,
        string? title,
        string? category,
        string? navigationKeyword1,
        string? navigationKeyword2,
        string? keywords,
        HttpRequest httpRequest,
        IValidator<CreateStudyGuideDocument.Request> validator,
        StudyGuideDocumentOptions documentOptions,
        CancellationToken cancellationToken)
    {
        CreateStudyGuideDocument.Request request = new(
            NullIfEmpty(text),
            NullIfEmpty(title),
            NullIfEmpty(category),
            NullIfEmpty(navigationKeyword1),
            NullIfEmpty(navigationKeyword2),
            // keywords may be repeated or comma-separated; the bound value holds only the first occurrence.
            SplitKeywords(httpRequest.HasFormContentType ? httpRequest.Form["keywords"] : new Microsoft.Extensions.Primitives.StringValues(keywords)));

        FluentValidation.Results.ValidationResult validation = await validator.ValidateAsync(request, cancellationToken);
        if (!validation.IsValid)
        {
            return new Parsed(null, null, Results.BadRequest(validation.Errors));
        }

        CreateStudyGuideDocument.UploadedFile? upload = null;
        if (file is not null)
        {
            if (file.Length > documentOptions.MaxFileBytes)
            {
                return new Parsed(null, null, StudyGuideDocumentResults.Problem(
                    Result.Failure(StudyGuideDocumentErrors.FileTooLarge(documentOptions.MaxFileBytes))));
            }

            using MemoryStream buffer = new((int)file.Length);
            await file.CopyToAsync(buffer, cancellationToken);
            upload = new CreateStudyGuideDocument.UploadedFile(buffer.ToArray(), file.FileName);
        }

        return new Parsed(request, upload, null);
    }

    internal static List<string>? SplitKeywords(IEnumerable<string?> values)
    {
        List<string> keywords = values
            .SelectMany(value => (value ?? string.Empty).Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
            .Where(value => value.Length > 0)
            .ToList();
        return keywords.Count == 0 ? null : keywords;
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;
}
