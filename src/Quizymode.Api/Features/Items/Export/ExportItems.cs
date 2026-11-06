using Microsoft.EntityFrameworkCore;
using Quizymode.Api.Data;
using Quizymode.Api.Features.Items.Get;
using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Http;
using Quizymode.Api.Shared.Kernel;
using Quizymode.Api.Shared.Models;
using System.Text.Json.Serialization;

namespace Quizymode.Api.Features.Items.Export;

public static class ExportItems
{
    public sealed record SeedItemDto(
        [property: JsonPropertyName("itemId")] string ItemId,
        [property: JsonPropertyName("category")] string Category,
        [property: JsonPropertyName("navigationKeyword1")] string? NavigationKeyword1,
        [property: JsonPropertyName("navigationKeyword2")] string? NavigationKeyword2,
        [property: JsonPropertyName("question")] string Question,
        [property: JsonPropertyName("correctAnswer")] string CorrectAnswer,
        [property: JsonPropertyName("incorrectAnswers")] List<string> IncorrectAnswers,
        [property: JsonPropertyName("explanation")] string Explanation,
        [property: JsonPropertyName("keywords")] List<string> Keywords,
        [property: JsonPropertyName("source")] string? Source,
        [property: JsonPropertyName("questionImage")] ItemImageReference? QuestionImage = null,
        [property: JsonPropertyName("explanationImage")] ItemImageReference? ExplanationImage = null,
        [property: JsonPropertyName("starterWorld")] string? StarterWorld = null,
        [property: JsonPropertyName("wowLine")] string? WowLine = null,
        [property: JsonPropertyName("incorrectAnswerRationale")] Dictionary<int, string>? IncorrectAnswerRationale = null);

    public sealed class Endpoint : IEndpoint
    {
        public void MapEndpoint(IEndpointRouteBuilder app)
        {
            app.MapGet("items/export", Handler)
                .WithTags("Items")
                .WithSummary("Export items in seed JSON format")
                .Produces<List<SeedItemDto>>(StatusCodes.Status200OK)
                .Produces(StatusCodes.Status400BadRequest)
                .RequireAuthorization();
        }

        private static async Task<IResult> Handler(
            string? category,
            string? nav,
            ApplicationDbContext db,
            IUserContext userContext,
            CancellationToken cancellationToken)
        {
            if (string.IsNullOrWhiteSpace(category))
                return CustomResults.BadRequest("Category is required");

            List<string>? navigationKeywords = null;
            if (!string.IsNullOrEmpty(nav))
            {
                navigationKeywords = nav
                    .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
                    .Where(k => !string.IsNullOrWhiteSpace(k))
                    .ToList();

                if (navigationKeywords.Count > 2)
                    return CustomResults.BadRequest("Navigation path supports at most two keywords");
            }

            var request = new GetItems.QueryRequest(
                category, null, null, null, null, 1, 10, navigationKeywords);

            ItemQueryBuilder queryBuilder = new(db, userContext, cancellationToken);
            Result<IQueryable<Item>> queryResult = await queryBuilder.BuildQueryAsync(request);

            if (queryResult.IsFailure)
                return CustomResults.Problem(Result.Failure<GetItems.Response>(queryResult.Error!));

            List<Item> items = await queryResult.Value
                .AsNoTracking()
                .Include(i => i.ItemKeywords).ThenInclude(ik => ik.Keyword)
                .Include(i => i.Category)
                .Include(i => i.NavigationKeyword1)
                .Include(i => i.NavigationKeyword2)
                .ToListAsync(cancellationToken);

            List<SeedItemDto> result = items.Select(item =>
            {
                List<string> tagKeywords = item.ItemKeywords
                    .Where(ik => !ik.Keyword.IsPrivate || ik.Keyword.CreatedBy == userContext.UserId)
                    .Select(ik => ik.Keyword.Name)
                    .Distinct()
                    .ToList();

                return new SeedItemDto(
                    item.Id.ToString(),
                    item.Category?.Name?.ToLowerInvariant() ?? category.ToLowerInvariant(),
                    item.NavigationKeyword1?.Name?.ToLowerInvariant(),
                    item.NavigationKeyword2?.Name?.ToLowerInvariant(),
                    item.Question,
                    item.CorrectAnswer,
                    item.IncorrectAnswers,
                    item.Explanation,
                    tagKeywords,
                    item.Source,
                    // Uploaded pictures are never exported (AC 3.25.8); the export carries curated pictures only.
                    item.QuestionImageAssetId is null ? ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt) : null,
                    item.ExplanationImageAssetId is null ? ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt) : null,
                    item.StarterWorld,
                    item.WowLine,
                    item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);
            }).ToList();

            return Results.Ok(result);
        }
    }

    public sealed class FeatureRegistration : IFeatureRegistration
    {
        public void AddToServiceCollection(IServiceCollection services, IConfiguration configuration) { }
    }
}
