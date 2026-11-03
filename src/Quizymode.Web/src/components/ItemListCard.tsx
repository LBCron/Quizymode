import { StarIcon as StarIconSolid } from "@heroicons/react/24/solid";
import { ratingsApi } from "@/api/ratings";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import type { ItemResponse, KeywordResponse, ItemCollectionResponse } from "@/types/api";
import ItemRatingsComments from "./ItemRatingsComments";
import { SpeakButton } from "@/components/SpeakButton";
import { useSpeech } from "@/hooks/useSpeech";
import { PronunciationHint } from "@/components/items/PronunciationHint";
import { QuestionImage } from "@/components/study/QuestionImage";
import { ImageReviewStatus } from "@/components/items/ImageReviewStatus";
import { ForeignPhraseText } from "@/components/ForeignPhraseText";

interface ItemListCardProps {
  item: ItemResponse;
  onKeywordClick?: (keywordName: string, item?: ItemResponse) => void;
  selectedKeywords?: string[];
  actions?: React.ReactNode;
  /** When true, shows full ratings (set stars) and comments link */
  showRatingsAndComments?: boolean;
  returnUrl?: string;
  /**
   * Controls answer visibility. When false the answer is hidden; when true it is
   * revealed with a green highlight (like a correct answer in quiz mode). When
   * undefined the answer is shown without any highlight (legacy/default behaviour).
   */
  showAnswer?: boolean;
}

const ItemListCard = ({
  item,
  onKeywordClick,
  selectedKeywords,
  actions,
  showRatingsAndComments,
  returnUrl,
  showAnswer,
}: ItemListCardProps) => {
  const { isSupported } = useSpeech();

  return (
    <div className="bg-white shadow rounded-lg p-6">
      <div className="space-y-3">
        <div className="flex items-start gap-3">
          <QuestionImage image={item.questionImage} size="sm" />
          <div className="flex-1">
            <h3 className="text-lg font-medium text-gray-900"><ForeignPhraseText text={item.question} /></h3>
            <PronunciationHint text={item.question} speech={item.questionSpeech} />
          </div>
          <SpeakButton
            text={item.question}
            speech={item.questionSpeech}
            isSupported={isSupported}
            label="Read question aloud"
          />
        </div>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-gray-500">
              {item.category}{item.isPrivate ? " (p)" : ""}
            </p>
            <ImageReviewStatus itemId={item.id} imageReview={item.imageReview} />
            <ItemAverageStars itemId={item.id} />
          </div>
          {actions && <div className="flex flex-wrap items-center justify-end gap-1 sm:gap-2">{actions}</div>}
        </div>
        {showAnswer !== false && (
          <div className="flex items-start gap-2">
            <div
              className={`flex-1 text-sm ${
                showAnswer === true
                  ? "rounded-md bg-green-100 px-2 py-1 text-green-900"
                  : "text-gray-700"
              }`}
            >
              <p>
                <strong>Answer:</strong> <ForeignPhraseText text={item.correctAnswer} />
              </p>
              <PronunciationHint
                text={item.correctAnswer}
                speech={item.correctAnswerSpeech}
                className="mt-1 text-sm text-gray-500 italic"
              />
              {(item.explanation?.trim() || item.explanationImage) && (
                <div className="mt-2 flex items-start gap-3 border-t border-green-200 pt-2 text-gray-800">
                  <QuestionImage image={item.explanationImage} slot="explanation" size="sm" />
                  {item.explanation?.trim() && (
                    <p className="min-w-0">
                      <strong>Explanation:</strong>{" "}
                      <ForeignPhraseText text={item.explanation} linkify />
                    </p>
                  )}
                </div>
              )}
            </div>
            <SpeakButton
              text={item.correctAnswer}
              speech={item.correctAnswerSpeech}
              isSupported={isSupported}
              label="Read answer aloud"
            />
          </div>
        )}

        <KeywordsAndCollectionsSection
          keywords={item.keywords}
          collections={item.collections}
          onKeywordClick={onKeywordClick ? (kw) => onKeywordClick(kw, item) : undefined}
          selectedKeywords={selectedKeywords}
        />
        {showRatingsAndComments && (
          <ItemRatingsComments
            itemId={item.id}
            returnUrl={returnUrl}
            presentation="list-card"
          />
        )}
      </div>
    </div>
  );
};

const ItemAverageStars = ({ itemId }: { itemId: string }) => {
  const { data: ratingStats } = useQuery({
    queryKey: ["ratingStats", itemId],
    queryFn: () => ratingsApi.getStats(itemId),
    enabled: true,
  });

  const averageStars = ratingStats?.averageStars;
  const ratingCount = ratingStats?.count ?? 0;

  if (averageStars === null || averageStars === undefined) {
    return null;
  }

  return (
    <div className="mt-1 flex items-center space-x-1 text-sm text-gray-600">
      <StarIconSolid className="h-4 w-4 text-yellow-400" />
      <span className="font-medium">{averageStars.toFixed(1)}</span>
      <span className="text-gray-500">({ratingCount})</span>
    </div>
  );
};

const KeywordsAndCollectionsSection = ({
  keywords,
  collections,
  onKeywordClick,
  selectedKeywords,
}: {
  keywords?: KeywordResponse[];
  collections?: ItemCollectionResponse[];
  onKeywordClick?: (keywordName: string) => void;
  selectedKeywords?: string[];
}) => {
  const hasKeywords = keywords && keywords.length > 0;
  const hasCollections = collections && collections.length > 0;

  if (!hasKeywords && !hasCollections) {
    return null;
  }

  return (
    <div className="mt-3 flex flex-wrap gap-2 items-center">
      {hasKeywords && (
        <>
          {keywords.map((keyword) => (
            <KeywordChip
              key={keyword.id}
              keyword={keyword}
              onClick={onKeywordClick}
              isSelected={selectedKeywords?.includes(keyword.name) ?? false}
            />
          ))}
        </>
      )}
      {hasCollections && (
        <>
          {collections!.map((collection: ItemCollectionResponse) => (
            <CollectionChip key={collection.id} collection={collection} />
          ))}
        </>
      )}
    </div>
  );
};


const CollectionChip = ({
  collection,
}: {
  collection: ItemCollectionResponse;
}) => {
  const navigate = useNavigate();

  return (
    <button
      onClick={() => navigate(`/collections?selected=${collection.id}`)}
      className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-emerald-100 text-emerald-800 hover:bg-emerald-200 transition-colors"
      title={`Collection: ${collection.name} (click to view)`}
    >
      {collection.name}
    </button>
  );
};

const KeywordChip = ({
  keyword,
  onClick,
  isSelected,
}: {
  keyword: KeywordResponse;
  onClick?: (keywordName: string) => void;
  isSelected: boolean;
}) => {
  const baseClass =
    "inline-flex items-center px-2 py-1 rounded text-xs font-medium transition-colors";

  if (onClick) {
    return (
      <button
        onClick={() => onClick(keyword.name)}
        className={`${baseClass} ${
          isSelected
            ? "bg-indigo-600 text-white"
            : keyword.isPrivate
            ? "bg-purple-100 text-purple-800 hover:bg-purple-200"
            : "bg-blue-100 text-blue-800 hover:bg-blue-200"
        }`}
        title={
          keyword.isPrivate
            ? "Private keyword (click to filter)"
            : "Public keyword (click to filter)"
        }
      >
        {keyword.name}
        {keyword.isPrivate && <span className="ml-1 text-[10px]">🔒</span>}
      </button>
    );
  }

  return (
    <span
      className={`${baseClass} ${
        keyword.isPrivate
          ? "bg-purple-100 text-purple-800"
          : "bg-blue-100 text-blue-800"
      }`}
      title={keyword.isPrivate ? "Private keyword" : "Public keyword"}
    >
      {keyword.name}
      {keyword.isPrivate && <span className="ml-1 text-[10px]">🔒</span>}
    </span>
  );
};

export default ItemListCard;
