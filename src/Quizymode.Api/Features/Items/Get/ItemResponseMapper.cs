using Quizymode.Api.Services;
using Quizymode.Api.Shared.Helpers;
using Quizymode.Api.Shared.Models;

namespace Quizymode.Api.Features.Items.Get;

internal sealed class ItemResponseMapper
{
    private readonly IUserContext _userContext;

    public ItemResponseMapper(IUserContext userContext)
    {
        _userContext = userContext;
    }

    public GetItems.ItemResponse MapToResponse(
        Item item,
        List<GetItems.CollectionResponse> collections,
        ItemImageReviewInfo? imageReview = null)
    {
        List<GetItems.KeywordResponse> visibleKeywords = FilterVisibleKeywords(item);
        string categoryName = item.Category?.Name ?? string.Empty;

        return new GetItems.ItemResponse(
            item.Id.ToString(),
            categoryName,
            item.IsPrivate,
            item.Question,
            item.CorrectAnswer,
            item.IncorrectAnswers,
            item.Explanation,
            item.CreatedAt,
            visibleKeywords,
            collections,
            item.Source,
            item.UploadId?.ToString(),
            item.FactualRisk,
            item.ReviewComments,
            item.QuestionSpeech,
            item.CorrectAnswerSpeech,
            item.IncorrectAnswerSpeech.Count > 0 ? item.IncorrectAnswerSpeech : null,
            item.GroupLabel,
            ItemImageReferenceHelper.FromColumns(item.QuestionImageKey, item.QuestionImageAlt, item.QuestionImageAttribution, item.QuestionImageLongDescription, item.ImageRevision),
            ItemImageReferenceHelper.FromColumns(item.ExplanationImageKey, item.ExplanationImageAlt, item.ExplanationImageAttribution, item.ExplanationImageLongDescription, item.ImageRevision),
            imageReview,
                        item.IncorrectAnswerRationale.Count > 0 ? item.IncorrectAnswerRationale : null);
    }

    private List<GetItems.KeywordResponse> FilterVisibleKeywords(Item item)
    {
        List<GetItems.KeywordResponse> visibleKeywords = new();

        foreach (ItemKeyword itemKeyword in item.ItemKeywords)
        {
            Keyword keyword = itemKeyword.Keyword;

            bool isVisible = false;
            if (!keyword.IsPrivate)
            {
                isVisible = true;
            }
            else if (_userContext.IsAuthenticated && !string.IsNullOrEmpty(_userContext.UserId))
            {
                isVisible = keyword.CreatedBy == _userContext.UserId;
            }

            if (isVisible)
            {
                visibleKeywords.Add(new GetItems.KeywordResponse(
                    keyword.Id.ToString(),
                    keyword.Name,
                    keyword.IsPrivate));
            }
        }

        return visibleKeywords;
    }
}
