import { useEffect, useMemo, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeftIcon } from "@heroicons/react/24/outline";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import { itemsApi } from "@/api/items";
import { collectionsApi } from "@/api/collections";
import { useAuth } from "@/contexts/AuthContext";
import { useActiveCollection } from "@/hooks/useActiveCollection";
import { ItemForm, type ItemFormValues } from "@/components/items/ItemForm";
import { type TopicScopeFieldsHandle } from "@/components/items/ItemTopicScopeFields";
import { isTopicComplete, TOPIC_REQUIRED_MESSAGE } from "@/features/topics/topicScope";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import { useTopicSuggestionAnalytics } from "@/features/topics/topicSuggestionAnalytics";
import type { CreateItemRequest } from "@/types/api";
import { validateNavigationKeywordName } from "@/utils/navigationKeywordRules";
import { getIncorrectAnswerConflict } from "@/utils/incorrectAnswerRules";
import { useExtraKeywordAutocompleteSource } from "@/hooks/useExtraKeywordAutocompleteSource";
import { parseKeywordsParam } from "@/utils/addItemsScopeUrl";
import LoadingSpinner from "@/components/LoadingSpinner";
import ContentComplianceNotice from "@/features/legal/components/ContentComplianceNotice";
import { ActiveCollectionNotice } from "@/components/items/ActiveCollectionNotice";
import {
  normalizeSpeechSupportInput,
  compactIncorrectAnswersWithSpeech,
  compactIncorrectAnswerRationale,
} from "@/utils/itemSpeech";

interface ApiValidationError {
  errorMessage?: string;
  message?: string;
}

interface ApiProblemDetails {
  title?: string;
  detail?: string;
}

type CreateItemErrorResponse = ApiValidationError[] | string | ApiProblemDetails;

type SaveAction = "study" | "another";

const SAVED_ADD_NEXT_MESSAGE = "Saved. Add the next question.";

function buildInitialFormData(
  category: string,
  rank1: string,
  rank2: string,
  extraKeywords: string[],
  taxonomyAllSlugs: readonly string[]
): ItemFormValues {
  const publicSet = new Set(
    taxonomyAllSlugs.map((s) => s.trim().toLowerCase()).filter(Boolean)
  );
  return {
    category,
    isPrivate: true,
    navigationRank1: rank1,
    navigationRank2: rank2,
    question: "",
    correctAnswer: "",
    incorrectAnswers: ["", "", ""],
    explanation: "",
    keywords: extraKeywords.map((name) => {
      const n = name.trim().toLowerCase();
      return { name: n, isPrivate: !publicSet.has(n) };
    }),
    source: "",
    groupLabel: "",
    readyForReview: false,
    questionSpeech: {},
    correctAnswerSpeech: {},
    incorrectAnswerSpeech: {},
  };
}

function getSubmitErrorMessage(error: unknown): string {
  if (!isAxiosError<CreateItemErrorResponse>(error)) {
    return error instanceof Error ? error.message : "Failed to create item.";
  }

  const data = error.response?.data;
  if (!data) return error.message ?? "Failed to create item.";
  if (Array.isArray(data)) {
    return data
      .map((entry) => entry.errorMessage ?? entry.message ?? JSON.stringify(entry))
      .join(", ");
  }
  if (typeof data === "string") return data;
  return data.detail ?? data.title ?? error.message ?? "Failed to create item.";
}

function CreateItemEditor({
  initialValues,
  isAdmin,
  isAuthenticated,
}: {
  initialValues: ItemFormValues;
  isAdmin: boolean;
  isAuthenticated: boolean;
}) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [formSession, setFormSession] = useState(0);
  const saveIdentity = useRef({ signature: "", id: crypto.randomUUID() });
  const [formData, setFormData] = useState(initialValues);
  const [validationError, setValidationError] = useState("");
  const [topicBlocked, setTopicBlocked] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const topicScopeRef = useRef<TopicScopeFieldsHandle>(null);
  const questionRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (formSession > 0) questionRef.current?.focus(); }, [formSession]);
  const topicAnalytics = useTopicSuggestionAnalytics();
  const { activeCollectionId } = useActiveCollection();

  const { data: taxonomyData } = useTaxonomy();

  const selectedCategory = useMemo(
    () => taxonomyData?.categories.find((category) => category.slug === formData.category),
    [taxonomyData, formData.category]
  );

  const taxonomyExtraSlugs = useMemo(() => {
    const rank1 = formData.navigationRank1.trim().toLowerCase();
    const rank2 = formData.navigationRank2.trim().toLowerCase();
    return (selectedCategory?.allKeywordSlugs ?? []).filter(
      (slug) => slug.toLowerCase() !== rank1 && slug.toLowerCase() !== rank2
    );
  }, [selectedCategory, formData.navigationRank1, formData.navigationRank2]);

  const { extraKeywordAutocompleteSource, itemTagKeywordsLoading } =
    useExtraKeywordAutocompleteSource(formData.category, taxonomyExtraSlugs, isAuthenticated);

  const createMutation = useMutation({
    mutationFn: async ({ data }: { data: CreateItemRequest; action: SaveAction }) =>
      itemsApi.create(data),
    onSuccess: async (data, { data: variables, action }) => {
      queryClient.invalidateQueries({ queryKey: ["categoryItems"] });
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      const category = variables.category.trim();
      if (category) {
        queryClient.invalidateQueries({ queryKey: ["itemTagKeywords", category] });
      }
      topicAnalytics.onSaved({
        category: variables.category,
        rank1: variables.navigationKeyword1,
        rank2: variables.navigationKeyword2,
        isPrivate: variables.isPrivate !== false,
      });
      const createdItemId = typeof data?.id === "string" ? data.id : "";
      // A failure to add to the active collection never blocks the save or the navigation.
      const addToCollection =
        activeCollectionId && createdItemId
          ? collectionsApi.addItem(activeCollectionId, { itemId: createdItemId }).catch(() => {})
          : Promise.resolve();

      if (action === "another") {
        saveIdentity.current = { signature: "", id: crypto.randomUUID() };
        setFormSession(value => value + 1);
        setStatusMessage(SAVED_ADD_NEXT_MESSAGE);
        setFormData((current) => ({
          ...current,
          question: "",
          questionSpeech: {},
          correctAnswer: "",
          correctAnswerSpeech: {},
          incorrectAnswers: ["", "", ""],
          incorrectAnswerSpeech: {},
          explanation: "",
          questionImage: undefined,
          explanationImage: undefined,
        }));
        questionRef.current?.focus();
        return;
      }

      // Study opens the collection route, so wait until the item has been added to it.
      await addToCollection;
      if (activeCollectionId && createdItemId) {
        navigate(`/explore/collections/${activeCollectionId}/item/${createdItemId}`);
        return;
      }
      navigate(createdItemId ? `/items/${createdItemId}` : "/categories");
    },
    onError: (error: unknown) => {
      console.error("Failed to create item:", error);
      if (isAxiosError<CreateItemErrorResponse>(error) && error.response?.data) {
        console.error("API Error Details:", error.response.data);
      }
    },
  });

  const save = (action: SaveAction) => {
    if (createMutation.isPending) return;
    setValidationError("");
    setStatusMessage("");
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

    const rank1 = formData.navigationRank1.trim().toLowerCase();
    const rank2 = formData.navigationRank2.trim().toLowerCase();
    const otherKeywords = formData.keywords.filter((keyword) => {
      const name = keyword.name.toLowerCase();
      return name !== rank1 && name !== rank2;
    });

    const data: CreateItemRequest = {
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
      questionImage: formData.questionImage?.remove ? undefined : formData.questionImage,
      explanationImage: formData.explanationImage?.remove ? undefined : formData.explanationImage,
      keywords: otherKeywords.length > 0 ? otherKeywords : undefined,
      source: formData.source.trim() || undefined,
      groupLabel: formData.groupLabel.trim() || undefined,
      readyForReview: formData.readyForReview,
    };

    const signature = JSON.stringify(data);
    if (saveIdentity.current.signature !== signature) saveIdentity.current = { signature, id: crypto.randomUUID() };
    data.createRequestId = saveIdentity.current.id;
    createMutation.mutate({ data, action });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Both create buttons submit the form so native validation runs; the button says which one.
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    save(submitter?.getAttribute("data-action") === "another" ? "another" : "study");
  };

  return (
    <ItemForm
      key={formSession}
      mode="create"
      values={formData}
      onChange={setFormData}
      onSubmit={handleSubmit}
      statusMessage={statusMessage}
      questionRef={questionRef}
      onCancel={() => navigate("/categories")}
      isAdmin={isAdmin}
      isPending={createMutation.isPending}
      validationError={validationError}
      submitError={createMutation.isError ? getSubmitErrorMessage(createMutation.error) : undefined}
      onDismissSubmitError={() => createMutation.reset()}
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
      onTopicSuggestionsShown={topicAnalytics.onSuggestionsShown}
    />
  );
}

const CreateItemPage = () => {
  const { isAuthenticated, isAdmin } = useAuth();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const categoryFromUrl = searchParams.get("category") || "";
  const keywordsParam = searchParams.get("keywords");

  const { data: taxonomyBootstrap, isLoading: isTaxonomyBootstrapLoading } = useTaxonomy(isAuthenticated);

  const taxonomyAllSlugsForCategory = useMemo(() => {
    const cat = taxonomyBootstrap?.categories.find((c) => c.slug === categoryFromUrl);
    return cat?.allKeywordSlugs ?? [];
  }, [taxonomyBootstrap, categoryFromUrl]);
  const { rank1: rank1FromUrl, rank2: rank2FromUrl, extrasJoined } = useMemo(
    () => parseKeywordsParam(keywordsParam),
    [keywordsParam]
  );
  const extraKeywordsFromUrl = useMemo(
    () =>
      extrasJoined
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
    [extrasJoined]
  );

  const initialFormData = useMemo(
    () =>
      buildInitialFormData(
        categoryFromUrl,
        rank1FromUrl,
        rank2FromUrl,
        extraKeywordsFromUrl,
        taxonomyAllSlugsForCategory
      ),
    [
      categoryFromUrl,
      rank1FromUrl,
      rank2FromUrl,
      extraKeywordsFromUrl,
      taxonomyAllSlugsForCategory,
    ]
  );

  const scopeKey = useMemo(
    () => [categoryFromUrl, rank1FromUrl, rank2FromUrl, extraKeywordsFromUrl.join(",")].join("|"),
    [categoryFromUrl, rank1FromUrl, rank2FromUrl, extraKeywordsFromUrl]
  );

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (isTaxonomyBootstrapLoading) {
    return <LoadingSpinner />;
  }

  const addItemsBackTo = `/create${location.search}`;

  return (
    <div className="px-4 py-6 sm:px-0">
      <div className="max-w-2xl mx-auto">
        <div className="mb-4">
          <Link
            to={addItemsBackTo}
            className="inline-flex items-center gap-2 text-sm font-medium text-indigo-ink hover:text-indigo-ink"
          >
            <ArrowLeftIcon className="h-4 w-4 shrink-0" aria-hidden />
            Back to Create
          </Link>
        </div>
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Create New Item
        </h1>
        <p className="text-gray-600 text-sm mb-6">
          Create a new quiz item with a question, correct answer, incorrect answer options, and
          optional explanation. Regular users can create private items; admins can create public
          items visible to everyone.
        </p>

        <ContentComplianceNotice />
        <ActiveCollectionNotice />

        <CreateItemEditor
          key={scopeKey}
          initialValues={initialFormData}
          isAdmin={!!isAdmin}
          isAuthenticated={isAuthenticated}
        />
      </div>
    </div>
  );
};

export default CreateItemPage;
