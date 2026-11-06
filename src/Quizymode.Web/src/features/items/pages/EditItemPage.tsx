import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { itemsApi } from "@/api/items";
import { QuestionImage } from "@/components/study/QuestionImage";
import { useAuth } from "@/contexts/AuthContext";
import { useCurrentUserIdState } from "@/hooks/useCurrentUserId";
import { Navigate } from "react-router-dom";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { ItemForm, type ItemFormValues } from "@/components/items/ItemForm";
import { type TopicScopeFieldsHandle } from "@/components/items/ItemTopicScopeFields";
import { isTopicComplete, TOPIC_REQUIRED_MESSAGE } from "@/features/topics/topicScope";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import type { KeywordRequest } from "@/types/api";
import { validateNavigationKeywordName } from "@/utils/navigationKeywordRules";
import { getIncorrectAnswerConflict } from "@/utils/incorrectAnswerRules";
import { useExtraKeywordAutocompleteSource } from "@/hooks/useExtraKeywordAutocompleteSource";
import {
  normalizeSpeechSupportInput,
  compactIncorrectAnswersWithSpeech,
  compactIncorrectAnswerRationale,
} from "@/utils/itemSpeech";

const MIN_INCORRECT_ANSWER_FIELDS = 3;

function padIncorrectAnswers(answers: readonly string[]): string[] {
  const padded = [...answers];
  while (padded.length < MIN_INCORRECT_ANSWER_FIELDS) padded.push("");
  return padded;
}

const EditItemPage = () => {
  const { id } = useParams<{ id: string }>();
  const { isAuthenticated, isAdmin } = useAuth();
  const { userId: currentUserId, isLoading: isLoadingUserId } = useCurrentUserIdState();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formData, setFormData] = useState<ItemFormValues>({
    category: "",
    isPrivate: true,
    navigationRank1: "",
    navigationRank2: "",
    question: "",
    questionSpeech: {},
    correctAnswer: "",
    correctAnswerSpeech: {},
    incorrectAnswers: ["", "", ""],
    incorrectAnswerSpeech: {},
    incorrectAnswerRationale: {},
    explanation: "",
    keywords: [] as KeywordRequest[],
    source: "",
    groupLabel: "",
    readyForReview: false,
  });

  const { data: taxonomyData } = useTaxonomy();

  const selectedCategory = useMemo(
    () => taxonomyData?.categories.find((c) => c.slug === formData.category),
    [taxonomyData, formData.category]
  );

  const taxonomyExtraSlugs = useMemo(() => {
    const r1 = formData.navigationRank1.trim().toLowerCase();
    const r2 = formData.navigationRank2.trim().toLowerCase();
    return (selectedCategory?.allKeywordSlugs ?? []).filter(
      (s) => s.toLowerCase() !== r1 && s.toLowerCase() !== r2
    );
  }, [selectedCategory, formData.navigationRank1, formData.navigationRank2]);

  const { extraKeywordAutocompleteSource, itemTagKeywordsLoading } =
    useExtraKeywordAutocompleteSource(formData.category, taxonomyExtraSlugs, isAuthenticated);

  const {
    data: itemData,
    isLoading: isLoadingItem,
    error: itemError,
  } = useQuery({
    queryKey: ["item", id],
    queryFn: () => itemsApi.getById(id!),
    enabled: !!id && isAuthenticated,
  });

  const [validationError, setValidationError] = useState<string>("");
  const [topicBlocked, setTopicBlocked] = useState(false);
  const topicScopeRef = useRef<TopicScopeFieldsHandle>(null);
  const [savedAsPrivate, setSavedAsPrivate] = useState(false);
  // #290: the server sends a non-admin owner's edit of a public item back to private (re-review).
  const willBecomePrivate = !isAdmin && itemData?.isPrivate === false;

  useEffect(() => {
    if (itemData) {
      const breadcrumb = itemData.navigationBreadcrumb ?? [];
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormData({
        category: itemData.category || "",
        isPrivate: itemData.isPrivate || false,
        navigationRank1: breadcrumb[0] ?? "",
        navigationRank2: breadcrumb[1] ?? "",
        question: itemData.question || "",
        questionSpeech: itemData.questionSpeech ?? {},
        correctAnswer: itemData.correctAnswer || "",
        correctAnswerSpeech: itemData.correctAnswerSpeech ?? {},
        incorrectAnswers: padIncorrectAnswers(itemData.incorrectAnswers ?? []),
        incorrectAnswerSpeech: itemData.incorrectAnswerSpeech ?? {},
        incorrectAnswerRationale: itemData.incorrectAnswerRationale ?? {},
        explanation: itemData.explanation || "",
        keywords: itemData.keywords
          ? itemData.keywords
              .filter(
                (k) =>
                  breadcrumb[0]?.toLowerCase() !== k.name.toLowerCase() &&
                  breadcrumb[1]?.toLowerCase() !== k.name.toLowerCase()
              )
              .map((k) => ({ name: k.name, isPrivate: k.isPrivate }))
          : [],
        source: itemData.source || "",
        groupLabel: itemData.groupLabel || "",
        readyForReview: false,
      });
    }
  }, [itemData]);

  const updateMutation = useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    mutationFn: (data: any) => itemsApi.update(id!, data),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ["categoryItems"] });
      queryClient.invalidateQueries({ queryKey: ["item", id] });
      queryClient.invalidateQueries({ queryKey: ["gameRoster"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      const cat =
        typeof variables?.category === "string" ? variables.category.trim() : "";
      if (cat) {
        queryClient.invalidateQueries({ queryKey: ["itemTagKeywords", cat] });
      }
      if (willBecomePrivate) {
        setSavedAsPrivate(true);
        return;
      }
      navigate("/categories");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      console.error("Failed to update item:", error);
      if (error?.response?.data) {
        console.error("API Error Details:", error.response.data);
      }
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError("");
    setTopicBlocked(false);

    const compacted = compactIncorrectAnswersWithSpeech(
      formData.incorrectAnswers,
      formData.incorrectAnswerSpeech
    );
    if (compacted.incorrectAnswers.length === 0) {
      setValidationError("Please provide at least one incorrect answer");
      return;
    }
    const conflict = getIncorrectAnswerConflict(formData.correctAnswer, compacted.incorrectAnswers);
    if (conflict) {
      setValidationError(conflict);
      return;
    }
    if (
      !isTopicComplete({
        category: formData.category,
        rank1: formData.navigationRank1,
        rank2: formData.navigationRank2,
      })
    ) {
      setTopicBlocked(true);
      topicScopeRef.current?.focus();
      return;
    }
    const navFormatError =
      validateNavigationKeywordName(formData.navigationRank1) ??
      validateNavigationKeywordName(formData.navigationRank2);
    if (navFormatError) {
      setValidationError(navFormatError);
      return;
    }

    const r1 = formData.navigationRank1.trim().toLowerCase();
    const r2 = formData.navigationRank2.trim().toLowerCase();
    const otherKeywords = formData.keywords.filter(
      (k) => k.name.toLowerCase() !== r1 && k.name.toLowerCase() !== r2
    );

    const data = {
      category: formData.category.trim(),
      navigationKeyword1: formData.navigationRank1.trim(),
      navigationKeyword2: formData.navigationRank2.trim(),
      isPrivate: formData.isPrivate,
      question: formData.question.trim(),
      questionSpeech: normalizeSpeechSupportInput(formData.questionSpeech),
      correctAnswer: formData.correctAnswer.trim(),
      correctAnswerSpeech: normalizeSpeechSupportInput(formData.correctAnswerSpeech),
      incorrectAnswers: compacted.incorrectAnswers,
      incorrectAnswerSpeech: compacted.incorrectAnswerSpeech,
      incorrectAnswerRationale: compactIncorrectAnswerRationale(formData.incorrectAnswers, formData.incorrectAnswerRationale),
      explanation: formData.explanation.trim(),
      keywords: otherKeywords,
      source: formData.source.trim() || undefined,
      // A blank value clears the stored label; an omitted one would keep it.
      groupLabel: formData.groupLabel.trim(),
      readyForReview: formData.readyForReview,
    };

    updateMutation.mutate(data);
  };

  const getSubmitError = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = updateMutation.error as any;
    const status = err?.response?.status;
    if (status === 401) return "Your session has expired. Please sign in again.";
    if (status === 403) return "You can only edit your own items.";
    if (status === 404) return "This item no longer exists or you don't have access to it.";
    if (!err?.response?.data) return err?.message ?? "Failed to update item.";
    const data = err.response.data;
    if (Array.isArray(data))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return data.map((e: any) => e.errorMessage ?? e.message ?? JSON.stringify(e)).join(", ");
    if (typeof data === "string") return data;
    if (data.title === "Item.Duplicate") {
      return data.detail ?? "An item with the same question already exists in this category.";
    }
    return data.title ?? data.detail ?? "Failed to update item.";
  };

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isLoadingItem || (!isAdmin && isLoadingUserId)) {
    return <LoadingSpinner />;
  }

  if (itemError || !itemData) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <ErrorMessage
          message="Failed to load item. It may not exist or you may not have permission to edit it."
          onRetry={() => navigate("/categories")}
        />
      </div>
    );
  }

  // Server enforces owner-or-admin (#286); this only avoids showing a form that cannot save.
  if (!isAdmin && currentUserId && itemData.createdBy !== currentUserId) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <ErrorMessage
          message="You can only edit your own items."
          onRetry={() => navigate("/categories")}
        />
      </div>
    );
  }

  if (savedAsPrivate) {
    return (
      <div className="px-4 py-6 sm:px-0">
        <div className="max-w-2xl mx-auto space-y-4">
          <div
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            Your changes were saved. This item is now private again until an administrator approves it.
          </div>
          <button
            type="button"
            onClick={() => navigate("/categories")}
            className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            Back to categories
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Edit Item</h1>
        <p className="text-gray-600 text-sm mb-6">
          Update the quiz item details. You can edit your own items; admins can edit any item.
        </p>

        {willBecomePrivate && (
          <div
            role="note"
            className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900"
          >
            Saving changes will make this item private again until an administrator approves it.
          </div>
        )}

        {itemData.questionImage && (
          <div className="mb-6" data-testid="edit-item-picture">
            <p className="mb-2 text-sm font-medium text-gray-700">Picture</p>
            <QuestionImage image={itemData.questionImage} />
            <p className="mt-2 text-center text-xs text-gray-500">Picture comes from seed data; saving keeps it.</p>
          </div>
        )}

        {itemData.explanationImage && (
          <div className="mb-6" data-testid="edit-item-explanation-picture">
            <p className="mb-2 text-sm font-medium text-gray-700">Explanation picture (read-only)</p>
            <QuestionImage image={itemData.explanationImage} slot="explanation" />
            <p className="mt-2 text-center text-xs text-gray-500">
              Picture comes from seed data; saving keeps it. The explanation can&apos;t be emptied while it is set.
            </p>
          </div>
        )}

        <ItemForm
          mode="edit"
          values={formData}
          onChange={setFormData}
          onSubmit={handleSubmit}
          onCancel={() => navigate("/categories")}
          isAdmin={!!isAdmin}
          isPending={updateMutation.isPending}
          validationError={validationError}
          submitError={updateMutation.isError ? getSubmitError() : undefined}
          onDismissSubmitError={() => updateMutation.reset()}
          extraKeywordAutocompleteSource={extraKeywordAutocompleteSource}
          extraKeywordAutocompleteLoading={itemTagKeywordsLoading}
          taxonomyPublicSlugs={selectedCategory?.allKeywordSlugs ?? []}
          topicError={
            topicBlocked &&
            !isTopicComplete({
              category: formData.category,
              rank1: formData.navigationRank1,
              rank2: formData.navigationRank2,
            })
              ? TOPIC_REQUIRED_MESSAGE
              : undefined
          }
          topicScopeRef={topicScopeRef}
        />
      </div>
    </div>
  );
};

export default EditItemPage;
