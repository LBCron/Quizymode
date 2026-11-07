import { getIncorrectAnswerConflict } from "@/utils/incorrectAnswerRules";
import * as React from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { itemsApi, type UploadToCollectionResponse } from "@/api/items";
import ErrorMessage from "@/components/ErrorMessage";
import { ItemTopicScopeFields, type TopicScopeFieldsHandle } from "@/components/items/ItemTopicScopeFields";
import { applyTopicScopePatch, isTopicComplete, TOPIC_REQUIRED_MESSAGE } from "@/features/topics/topicScope";
import {
  composeImportSuggestionText,
  composeJsonSuggestionText,
} from "@/features/topics/suggestionText";
import { useTaxonomy } from "@/features/topics/useTaxonomy";
import { useTopicSuggestionAnalytics } from "@/features/topics/topicSuggestionAnalytics";
import { DocumentArrowUpIcon, ClipboardDocumentIcon } from "@heroicons/react/24/outline";
import ContentComplianceNotice from "@/features/legal/components/ContentComplianceNotice";
import PasteTextImport from "@/features/collections/components/PasteTextImport";
import { findPictureImportError } from "@/features/items/utils/pictureImport";
import { ADMIN_ITEM_LIMIT, NON_ADMIN_ITEM_LIMIT, type ImportItem } from "@/features/collections/utils/importParser";
import { compactIncorrectAnswerRationale, rationaleByAnswerText } from "@/utils/itemSpeech";

type UploadTab = "json" | "paste";

const EXAMPLE_PROMPT = (topic: string, uploadId: string) => `You are creating study flashcards for an app called Quizymode.

Create up to 30 quiz items about ${topic}. Attach Study Guide (optional).

Each item must be a JSON object with this exact shape:

{
  "category": "Category Name",
  "question": "Question text?",
  "correctAnswer": "Correct answer",
  "incorrectAnswers": ["Wrong answer 1", "Wrong answer 2", "Wrong answer 3"],
  "explanation": "Short explanation of why the correct answer is right (optional but recommended)",
  "incorrectAnswerRationale": { "Wrong answer 1": "Why wrong answer 1 is wrong (optional, max 200 characters)" },
  "source": "ChatGPT",
  "groupLabel": "Short group name (optional, max 30 characters, no line breaks)",
  "uploadId" : "${uploadId}"
}

Requirements:
- Return a single JSON array of items: [ { ... }, { ... }, ... ].
- Do NOT include any explanations, prose, comments, Markdown, or code fences. Output raw JSON only.
- Every item must have:
  - "category" (max 50 characters)
  - a non-empty "question" (max 1,000 characters)
  - a non-empty "correctAnswer" (max 200 characters)
  - 1–4 "incorrectAnswers" (each max 200 characters)
  - "incorrectAnswerRationale" (optional object): keys are incorrect answer texts copied exactly; values are max 200 characters on why that option is wrong
  - "source" (optional, max 1000 characters - e.g., a direct reference URL)
  - "groupLabel" (optional, max 30 characters, no line breaks - used by the Sort It game, e.g., "Mammals")
- All strings must be plain text (no HTML, no LaTeX).

Now generate the JSON array only.`;

interface UploadToCollectionPageProps {
  /** Tab shown first; /create/import opens on Paste text. */
  initialTab?: UploadTab;
  heading?: string;
}

const UploadToCollectionPage = ({
  initialTab = "json",
  heading = "Upload items to collection",
}: UploadToCollectionPageProps) => {
  const { isAuthenticated, isAdmin } = useAuth();
  const [activeTab, setActiveTab] = React.useState<UploadTab>(initialTab);
  // JSON import is an admin tool; everyone else only gets Paste text (the upload endpoint itself stays open).
  const tabs: UploadTab[] = isAdmin ? ["json", "paste"] : ["paste"];
  const effectiveTab: UploadTab = isAdmin ? activeTab : "paste";
  const [collectionName, setCollectionName] = React.useState("");
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const categoryParam = searchParams.get("category") ?? "";
  const keywordsParam = searchParams.get("keywords");
  const keywordsFromUrl = keywordsParam ? keywordsParam.split(",").map((k) => k.trim()).filter(Boolean) : [];

  const [categoryName, setCategoryName] = React.useState(categoryParam);
  const [rank1Name, setRank1Name] = React.useState(keywordsFromUrl[0] ?? "");
  const [rank2Name, setRank2Name] = React.useState(keywordsFromUrl[1] ?? "");
  const [jsonText, setJsonText] = React.useState("");
  const [parseError, setParseError] = React.useState<string | null>(null);
  // True while the error is the picture rejection (#403): Upload stays off until the JSON is edited.
  const [picturesRejected, setPicturesRejected] = React.useState(false);
  const [uploadId] = React.useState(() => crypto.randomUUID());
  const [copiedPrompt, setCopiedPrompt] = React.useState(false);

  const { data: taxonomyData } = useTaxonomy(!!isAuthenticated);
  const [topicBlocked, setTopicBlocked] = React.useState(false);
  const [pasteItems, setPasteItems] = React.useState<ImportItem[]>([]);
  const topicScopeRef = React.useRef<TopicScopeFieldsHandle>(null);
  const topicAnalytics = useTopicSuggestionAnalytics();

  const selectedTaxonomyCategory = React.useMemo(
    () => taxonomyData?.categories.find((c) => c.slug === categoryName),
    [taxonomyData, categoryName]
  );

  const rank1Slugs = React.useMemo(
    () => selectedTaxonomyCategory?.groups.map((g) => g.slug) ?? [],
    [selectedTaxonomyCategory]
  );

  const rank2Slugs = React.useMemo(() => {
    const g = selectedTaxonomyCategory?.groups.find((x) => x.slug === rank1Name);
    return g?.keywords.map((k) => k.slug) ?? [];
  }, [selectedTaxonomyCategory, rank1Name]);

  // Initial values come from the URL via useState; re-apply only when the URL itself changes,
  // so "Remove topic" can clear a URL-prefilled topic.
  const appliedUrlRef = React.useRef(`${categoryParam}|${keywordsParam ?? ""}`);
  React.useEffect(() => {
    const key = `${categoryParam}|${keywordsParam ?? ""}`;
    if (appliedUrlRef.current === key) return;
    appliedUrlRef.current = key;
    const kws = keywordsParam ? keywordsParam.split(",").map((k) => k.trim()).filter(Boolean) : [];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCategoryName(categoryParam);
    setRank1Name(kws[0] ?? "");
    setRank2Name(kws[1] ?? "");
  }, [categoryParam, keywordsParam]);
  // Clear rank1/rank2 when they are invalid for the current category's options
  React.useEffect(() => {
    if (rank1Name && rank1Slugs.length > 0 && !rank1Slugs.includes(rank1Name)) {
      setRank1Name("");
      setRank2Name("");
    }
  }, [rank1Name, rank1Slugs]);
  React.useEffect(() => {
    if (rank2Name && rank2Slugs.length > 0 && !rank2Slugs.includes(rank2Name)) {
      setRank2Name("");
    }
  }, [rank2Name, rank2Slugs]);

  const topicName = [categoryName, rank1Name, rank2Name].filter(Boolean).join(" / ") || "your chosen topic";
  const examplePrompt = EXAMPLE_PROMPT(topicName, uploadId);

  const uploadMutation = useMutation({
    mutationFn: (payload: Parameters<typeof itemsApi.uploadToCollection>[0]) =>
      itemsApi.uploadToCollection(payload),
    onSuccess: (data: UploadToCollectionResponse, payload) => {
      // Non-admin imports are always private, so their chosen path is not reported (AC 5.4.12).
      topicAnalytics.onSaved({
        category: payload.category,
        rank1: payload.keyword1 ?? "",
        rank2: payload.keyword2 ?? "",
        isPrivate: !isAdmin,
      });
      navigate(`/explore/collections/${data.collectionId}`);
    },
  });

  /** The JS replacement for the old `required` selects: blocks the submit and focuses the topic group. */
  const checkTopic = (): boolean => {
    setTopicBlocked(false);
    if (isTopicComplete({ category: categoryName, rank1: rank1Name, rank2: rank2Name })) return true;
    setTopicBlocked(true);
    topicScopeRef.current?.focus();
    return false;
  };

  const suggestionText = React.useMemo(
    () =>
      effectiveTab === "json" ? composeJsonSuggestionText(jsonText) : composeImportSuggestionText(pasteItems),
    [effectiveTab, jsonText, pasteItems]
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      setJsonText(text);
      setParseError(null);
      setPicturesRejected(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /** collectionName is sent only when filled in; an omitted name keeps the generated default. */
  const collectionNamePayload = (): { collectionName?: string } => {
    const trimmed = collectionName.trim();
    return trimmed ? { collectionName: trimmed } : {};
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (effectiveTab !== "json") return; // Enter inside the Paste text fields must not run the JSON upload
    setParseError(null);
    if (!checkTopic()) return;
    let items: unknown;
    try {
      items = JSON.parse(jsonText);
    } catch {
      setParseError("Invalid JSON. Paste a JSON array of items.");
      return;
    }
    if (!Array.isArray(items) || items.length === 0) {
      setParseError("JSON must be a non-empty array of items.");
      return;
    }
    const pictureError = findPictureImportError(items);
    if (pictureError) {
      setParseError(pictureError);
      setPicturesRejected(true);
      return;
    }
    const mapped = items.map((row: Record<string, unknown>) => ({
      isPrivate: true,
      question: String(row.question ?? ""),
      correctAnswer: String(row.correctAnswer ?? ""),
      incorrectAnswers: Array.isArray(row.incorrectAnswers)
        ? row.incorrectAnswers
            .map((a: unknown) => String(a ?? "").trim())
            .filter(Boolean)
            .slice(0, 4)
        : [],
      explanation: String(row.explanation ?? ""),
      questionImage: row.questionImage as import("@/api/media").ImageSlotInput | undefined,
      explanationImage: row.explanationImage as import("@/api/media").ImageSlotInput | undefined,
      keywords: Array.isArray(row.keywords)
        ? row.keywords.map((k: string | { name?: string }) =>
            typeof k === "string"
              ? { name: k, isPrivate: true }
              : { name: String(k.name ?? ""), isPrivate: true }
          )
        : undefined,
      source: row.source != null ? String(row.source) : undefined,
      groupLabel: row.groupLabel != null ? String(row.groupLabel).trim() || undefined : undefined,
    })).map((item, index) => ({
      ...item,
      // "Why this is wrong" (#485): keys may be the answer texts the study-guide generator returns.
      incorrectAnswerRationale: compactIncorrectAnswerRationale(
        item.incorrectAnswers,
        rationaleByAnswerText(
          (items[index] as Record<string, unknown>).incorrectAnswerRationale,
          item.incorrectAnswers
        )
      ),
    }));
    const groupLabelRows = mapped
      .map((row, index) =>
        row.groupLabel !== undefined && (row.groupLabel.length > 30 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(row.groupLabel))
          ? index + 1
          : 0
      )
      .filter((n) => n > 0);
    if (groupLabelRows.length > 0) {
      setParseError(
        `Item${groupLabelRows.length > 1 ? "s" : ""} ${groupLabelRows.join(", ")}: group label must be 30 characters or fewer, with no line breaks.`
      );
      return;
    }
    const missingRows = mapped
      .map((row, index) => (row.incorrectAnswers.length === 0 ? index + 1 : 0))
      .filter((n) => n > 0);
    if (missingRows.length > 0) {
      setParseError(
        `Item${missingRows.length > 1 ? "s" : ""} ${missingRows.join(", ")}: provide at least one non-blank incorrect answer (1-4).`
      );
      return;
    }
    const conflictRows = mapped
      .map((row, index) => (getIncorrectAnswerConflict(row.correctAnswer, row.incorrectAnswers) ? index + 1 : 0))
      .filter((n) => n > 0);
    if (conflictRows.length > 0) {
      setParseError(
        `Item${conflictRows.length > 1 ? "s" : ""} ${conflictRows.join(", ")}: incorrect answers must be different from each other and from the correct answer.`
      );
      return;
    }
    uploadMutation.mutate({
      category: categoryName.trim(),
      keyword1: rank1Name.trim(),
      keyword2: rank2Name.trim(),
      keywords: [],
      items: mapped,
      inputText: jsonText,
      ...collectionNamePayload(),
    });
  };

  const handlePasteImport = (items: ImportItem[], inputText: string) => {
    setParseError(null);
    if (!checkTopic()) return;
    uploadMutation.mutate({
      category: categoryName.trim(),
      keyword1: rank1Name.trim(),
      keyword2: rank2Name.trim(),
      keywords: [],
      items: items.map((item) => ({ isPrivate: true, ...item })),
      inputText,
      ...collectionNamePayload(),
    });
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const current = tabs.indexOf(effectiveTab);
    let next = current;
    if (e.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (current + tabs.length - 1) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActiveTab(tabs[next]);
    document.getElementById(`upload-tab-${tabs[next]}`)?.focus();
  };

  const copyPrompt = () => {
    navigator.clipboard.writeText(examplePrompt);
    setCopiedPrompt(true);
    setTimeout(() => setCopiedPrompt(false), 2000);
  };

  if (!isAuthenticated) {
    return (
      <div className="px-4 py-6 sm:px-0 max-w-2xl mx-auto">
        <p className="text-gray-600 mb-4">Sign in to upload items to a new collection.</p>
        <Link to="/login" className="text-indigo-ink hover:text-indigo-ink">
          Log in
        </Link>
      </div>
    );
  }

  return (
    <div className="px-4 py-6 sm:px-0 max-w-3xl mx-auto">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">{heading}</h1>
      <p className="text-gray-600 text-sm mb-6">
        {effectiveTab === "json"
          ? "Choose a topic (required), then paste a JSON array of items or upload a JSON file. Items are added to a new collection. Duplicate uploads (same content) are rejected."
          : "Choose a topic (required), then paste your questions or upload a file. Items are added to a new collection. Duplicate uploads (same content) are rejected."}
      </p>

      <ContentComplianceNotice />

      {tabs.length > 1 && (
      <div role="tablist" aria-label="Import source" className="mb-4 flex gap-2 border-b border-gray-200">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`upload-tab-${tab}`}
            aria-selected={effectiveTab === tab}
            aria-controls="upload-tabpanel"
            tabIndex={effectiveTab === tab ? 0 : -1}
            onClick={() => setActiveTab(tab)}
            onKeyDown={handleTabKeyDown}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              effectiveTab === tab
                ? "border-indigo-600 text-indigo-ink"
                : "border-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            {tab === "json" ? "JSON" : "Paste text"}
          </button>
        ))}
      </div>
      )}

      <form
        onSubmit={handleSubmit}
        className="space-y-4"
        {...(tabs.length > 1
          ? { role: "tabpanel", id: "upload-tabpanel", "aria-labelledby": `upload-tab-${effectiveTab}` }
          : {})}
      >
        <ItemTopicScopeFields
          idPrefix="upload-topic-scope"
          ref={topicScopeRef}
          category={categoryName}
          rank1={rank1Name}
          rank2={rank2Name}
          onScopeChange={(patch) => {
            const next = applyTopicScopePatch(
              { category: categoryName, rank1: rank1Name, rank2: rank2Name },
              patch
            );
            setCategoryName(next.category);
            setRank1Name(next.rank1);
            setRank2Name(next.rank2);
          }}
          disabled={uploadMutation.isPending}
          suggestionText={suggestionText}
          onSuggestionsShown={topicAnalytics.onSuggestionsShown}
          error={
            topicBlocked && !isTopicComplete({ category: categoryName, rank1: rank1Name, rank2: rank2Name })
              ? TOPIC_REQUIRED_MESSAGE
              : undefined
          }
        />

        <div>
          <label htmlFor="upload-collection-name" className="block text-sm font-medium text-gray-700 mb-1">
            Collection name (optional)
          </label>
          <input
            id="upload-collection-name"
            type="text"
            maxLength={200}
            value={collectionName}
            onChange={(e) => setCollectionName(e.target.value)}
            disabled={uploadMutation.isPending}
            placeholder="Leave blank for an automatic name"
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm"
          />
        </div>

        {effectiveTab === "paste" && (
          <PasteTextImport
            maxItems={isAdmin ? ADMIN_ITEM_LIMIT : NON_ADMIN_ITEM_LIMIT}
            isPending={uploadMutation.isPending}
            onImport={handlePasteImport}
            onPreviewChange={setPasteItems}
          />
        )}

        {effectiveTab === "json" && (
        <>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Example prompt for AI</label>
          <p className="text-xs text-gray-500 mb-1">
            Copy this prompt and use it with ChatGPT/Claude to generate the JSON. Then paste the result below.
          </p>
          <div className="relative">
            <pre className="block w-full rounded-md border border-gray-300 bg-gray-50 p-3 text-xs overflow-x-auto max-h-64 overflow-y-auto whitespace-pre-wrap">
              {examplePrompt}
            </pre>
            <button
              type="button"
              onClick={copyPrompt}
              className="absolute top-2 right-2 inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium text-gray-700 bg-surface border border-gray-300 hover:bg-gray-50"
            >
              <ClipboardDocumentIcon className="h-4 w-4" />
              {copiedPrompt ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <label htmlFor="json" className="block text-sm font-medium text-gray-700 mb-1">
            JSON array of items
          </label>
          <textarea
            id="json"
            rows={14}
            value={jsonText}
            onChange={(e) => {
              setJsonText(e.target.value);
              setParseError(null);
              setPicturesRejected(false);
            }}
            className="block w-full rounded-md border-gray-300 shadow-sm focus:border-indigo-500 focus:ring-indigo-500 sm:text-sm font-mono text-sm"
            placeholder={[
              '[',
              '  { "category": "Category Name", "question": "...", "correctAnswer": "...", "incorrectAnswers": ["...", "..."], "explanation": "...", "source": "ChatGPT", "groupLabel": "Mammals", "uploadId": "' + uploadId + '" },',
              '  ...',
              ']',
            ].join("\n")}
          />
        </div>

        <div className="flex items-center gap-4">
          <input
            type="file"
            accept=".json,application/json"
            onChange={handleFileChange}
            className="hidden"
            id="file-upload"
          />
          <label
            htmlFor="file-upload"
            className="inline-flex items-center gap-2 px-4 py-2 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-surface hover:bg-gray-50 cursor-pointer"
          >
            <DocumentArrowUpIcon className="h-5 w-5" />
            Choose JSON file
          </label>
          <button
            type="submit"
            disabled={uploadMutation.isPending || !jsonText.trim() || picturesRejected}
            className="inline-flex items-center px-4 py-2 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {uploadMutation.isPending ? "Uploading…" : "Upload and open collection"}
          </button>
        </div>
        </>
        )}
      </form>

      {(parseError || uploadMutation.error) && (
        <div className="mt-4">
          <ErrorMessage
            message={parseError ?? (uploadMutation.error as Error)?.message ?? "Upload failed"}
            onRetry={uploadMutation.error ? () => uploadMutation.reset() : undefined}
          />
        </div>
      )}
    </div>
  );
};

export default UploadToCollectionPage;
