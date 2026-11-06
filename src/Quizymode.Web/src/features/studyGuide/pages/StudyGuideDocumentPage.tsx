import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  studyGuideDocumentsApi,
  type AcceptStudyGuideCandidate,
  type AcceptStudyGuideCandidatesResponse,
  type GenerateStudyGuideSectionsResponse,
  type StudyGuideDocument,
  type StudyGuideSection,
} from "@/api/studyGuideDocuments";
import { useAuth } from "@/contexts/AuthContext";
import LoadingSpinner from "@/components/LoadingSpinner";
import ErrorMessage from "@/components/ErrorMessage";
import { buildCollectionPath, buildCollectionStudyPath } from "@/utils/collectionPath";
import type { CandidateEdit } from "../studyGuideDocumentSchema";
import { readApiError } from "../studyGuideApiErrors";
import {
  MAX_CANDIDATES_PER_ACCEPT,
  MAX_SECTIONS_PER_GENERATE,
  QUICK_SECTION_STATUS_LABELS,
  STUDY_GUIDE_POLL_INTERVAL_MS,
  buildQuickNotice,
  chunk,
  computePreselection,
  countAcceptedQuestions,
  countGeneratedSections,
  describeQuickProgress,
  formatDate,
  getFreeTierWaitMinutes,
  getQuickProgress,
  getQuickSectionStatus,
  getQuickSections,
  hasActiveGeneration,
  hasActiveQuickSection,
  isSectionSelectable,
  pruneSelection,
} from "../studyGuideSections";
import { StudyGuideSectionPicker, type QuestionStyle } from "../components/StudyGuideSectionPicker";
import { StudyGuideCandidateCard } from "../components/StudyGuideCandidateCard";
import { StudyGuideSteps } from "../components/StudyGuideSteps";

const FILE_TYPE_LABELS: Record<string, string> = {
  pdf: "PDF",
  docx: "Word",
  pptx: "PowerPoint",
  txt: "Text",
};

function getGenerateErrorMessage(error: unknown): string {
  const info = readApiError(error);
  if (info.status === 429) {
    return info.message !== "Something went wrong."
      ? info.message
      : "You have reached your section limit. Try again tomorrow or select fewer sections.";
  }
  if (info.status === 503) {
    if (info.code === "StudyGuideDocument.BudgetReached") {
      return "Question generation is paused for the rest of this month. Please try again next month.";
    }
    return "AI question generation is unavailable right now. Please try again later.";
  }
  return info.message;
}

/** What the upload page passes when it opens the document after "Make a quiz". */
interface QuickLocationState {
  /** The request is still being made: show progress and open Learn when it is saved. */
  quick?: boolean;
  /** One server-authored line for NeedsChoice, OverAllowance and Unavailable. */
  quickMessage?: string;
  isDuplicate?: boolean;
}

/** After this long without finishing, the progress panel adds a reassurance line. */
const QUICK_SLOW_MS = 5 * 60 * 1000;

const ALL_FAILED_MESSAGE =
  "We couldn't make questions from this guide. You weren't charged. Please try again in a bit.";
const SAVE_FAILED_MESSAGE = "We couldn't save your questions automatically. Review them below and press Save.";
const NO_QUESTIONS_MESSAGE =
  "We couldn't make any questions from these notes. Try a longer or more detailed section.";

interface AcceptSummary {
  published: boolean;
  collectionId: string;
  createdCount: number;
  duplicateCount: number;
  failedCount: number;
}

const StudyGuideDocumentPage = () => {
  const { id = "" } = useParams<{ id: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { isAdmin } = useAuth();
  const locationState = location.state as QuickLocationState | null;
  const isDuplicate = !!locationState?.isDuplicate;
  const openLearnWhenDone = !!locationState?.quick;
  const quickMessage = locationState?.quickMessage;
  const fromQuickPath = openLearnWhenDone || !!quickMessage;

  const [selection, setSelection] = React.useState<Set<string> | null>(null);
  const [excluded, setExcluded] = React.useState<Set<string>>(new Set());
  const [edits, setEdits] = React.useState<Record<string, CandidateEdit>>({});
  const [generateError, setGenerateError] = React.useState<string | null>(null);
  const [generateResult, setGenerateResult] = React.useState<GenerateStudyGuideSectionsResponse | null>(null);
  const [acceptError, setAcceptError] = React.useState<string | null>(null);
  const [acceptSummary, setAcceptSummary] = React.useState<AcceptSummary | null>(null);
  const [collectionNameInput, setCollectionNameInput] = React.useState<string | null>(null);
  const [publish, setPublish] = React.useState(false);
  const [learnTarget, setLearnTarget] = React.useState<{ path: string; notice?: string } | null>(null);
  const [quickSlow, setQuickSlow] = React.useState(false);
  const pickerRef = React.useRef<HTMLDivElement>(null);
  const progressRef = React.useRef<HTMLElement>(null);
  const quickFailureRef = React.useRef<HTMLDivElement>(null);
  const quickHandledRef = React.useRef(false);

  const queryKey = ["studyGuideDocuments", id];
  const {
    data: document,
    isLoading,
    error,
    refetch,
    dataUpdatedAt,
  } = useQuery<StudyGuideDocument>({
    queryKey,
    queryFn: () => studyGuideDocumentsApi.get(id),
    enabled: !!id,
    refetchInterval: (query) => (hasActiveGeneration(query.state.data) ? STUDY_GUIDE_POLL_INTERVAL_MS : false),
  });

  // The section cap only shapes the preselection when the quick path handed over to the picker.
  const { data: config } = useQuery({
    queryKey: ["studyGuideDocuments", "config"],
    queryFn: () => studyGuideDocumentsApi.getConfig(),
    enabled: !!quickMessage,
  });

  const quickActive = hasActiveQuickSection(document);
  const quickOutcome = React.useMemo(() => {
    if (!document || !openLearnWhenDone || quickActive) return null;
    const progress = getQuickProgress(document);
    if (progress.total === 0) return null;
    const saved = countAcceptedQuestions(document);
    if (saved > 0 && document.collectionId) {
      return { kind: "learn" as const, progress, collectionId: document.collectionId, title: document.title };
    }
    if (progress.saveFailed > 0) return { kind: "saveFailed" as const, progress };
    return { kind: progress.failed === progress.total ? ("allFailed" as const) : ("none" as const), progress };
  }, [document, openLearnWhenDone, quickActive]);

  // Opens Learn once, after a request made with "Make a quiz" is saved; a revisit never redirects.
  React.useEffect(() => {
    if (quickHandledRef.current || !quickOutcome) return;
    quickHandledRef.current = true;
    if (quickOutcome.kind === "learn") {
      setLearnTarget({
        path: buildCollectionStudyPath("learn", quickOutcome.collectionId, quickOutcome.title),
        notice:
          quickOutcome.progress.failed + quickOutcome.progress.saveFailed > 0
            ? buildQuickNotice(quickOutcome.progress)
            : undefined,
      });
    }
  }, [quickOutcome]);

  React.useEffect(() => {
    if (!learnTarget) return;
    navigate(learnTarget.path, {
      replace: true,
      state: learnTarget.notice ? { quickNotice: learnTarget.notice, documentId: id } : undefined,
    });
  }, [learnTarget, navigate, id]);

  React.useEffect(() => {
    if (!quickActive) return undefined;
    const timer = window.setTimeout(() => setQuickSlow(true), QUICK_SLOW_MS);
    return () => window.clearTimeout(timer);
  }, [quickActive]);

  React.useEffect(() => {
    if (quickActive && openLearnWhenDone) progressRef.current?.focus();
  }, [quickActive, openLearnWhenDone]);

  const showQuickFailure = !!quickOutcome && quickOutcome.kind !== "learn";
  // Stays mounted after the last section is saved so "Opening Learn…" is announced before the page is replaced.
  const openingLearn = !!learnTarget || quickOutcome?.kind === "learn";
  const showPanel = quickActive || openingLearn;
  React.useEffect(() => {
    if (showQuickFailure) quickFailureRef.current?.focus();
  }, [showQuickFailure]);

  const generateMutation = useMutation({
    mutationFn: ({ sectionIds, questionStyle }: { sectionIds: string[]; questionStyle: QuestionStyle }) =>
      studyGuideDocumentsApi.generate(id, sectionIds, questionStyle),
    onSuccess: (response) => {
      setGenerateResult(response);
      setGenerateError(null);
      setSelection(new Set());
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["studyGuideDocuments", "list"] });
    },
    onError: (mutationError) => {
      setGenerateResult(null);
      setGenerateError(getGenerateErrorMessage(mutationError));
    },
  });

  const acceptMutation = useMutation({
    mutationFn: async ({
      candidates,
      collectionName,
      publish: publishItems,
    }: {
      candidates: AcceptStudyGuideCandidate[];
      collectionName?: string;
      publish?: boolean;
    }) => {
      const responses: AcceptStudyGuideCandidatesResponse[] = [];
      for (const batch of chunk(candidates, MAX_CANDIDATES_PER_ACCEPT)) {
        // Only the first batch can create the collection; later batches reuse it.
        responses.push(
          await studyGuideDocumentsApi.accept(
            id,
            batch,
            responses.length === 0 ? collectionName : undefined,
            publishItems ? true : undefined // every batch carries it, not just the first
          )
        );
      }
      return responses;
    },
    onSuccess: (responses, variables) => {
      const last = responses[responses.length - 1];
      setAcceptSummary({
        published: !!variables.publish,
        collectionId: last.collectionId,
        createdCount: responses.reduce((sum, response) => sum + response.createdCount, 0),
        duplicateCount: responses.reduce((sum, response) => sum + response.duplicateCount, 0),
        failedCount: responses.reduce((sum, response) => sum + response.failedCount, 0),
      });
      setAcceptError(null);
      void queryClient.invalidateQueries({ queryKey });
      void queryClient.invalidateQueries({ queryKey: ["studyGuideDocuments", "list"] });
      void queryClient.invalidateQueries({ queryKey: ["collections"] });
    },
    onError: (mutationError) => {
      setAcceptError(readApiError(mutationError).message);
      // An earlier batch may have created the collection, so refresh the document to hide the name input.
      void queryClient.invalidateQueries({ queryKey });
    },
  });

  if (isLoading) return <LoadingSpinner />;
  if (!document) {
    const notFound = readApiError(error).status === 404;
    return (
      <div className="px-4 py-6 sm:px-0 max-w-3xl mx-auto space-y-3">
        <ErrorMessage
          message={notFound ? "This study guide could not be found. It may have expired." : "Failed to load this study guide."}
          onRetry={notFound ? undefined : () => void refetch()}
        />
        <Link to="/study-guides/documents" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
          Back to my study guides
        </Link>
      </div>
    );
  }

  const sections = [...document.sections].sort((a, b) => a.index - b.index);
  const defaultSelection =
    quickOutcome?.kind === "allFailed"
      ? new Set(
          sections
            .filter(isSectionSelectable)
            .slice(0, Math.max(0, Math.min(document.quota.remainingToday, MAX_SECTIONS_PER_GENERATE)))
            .map((section) => section.id)
        )
      : computePreselection(document, quickMessage ? config?.quickPathMaxSections : undefined);
  const effectiveSelection = pruneSelection(document, selection ?? defaultSelection);
  const generatedSections = sections.filter((section) => section.status === "Generated");
  const generatedCount = countGeneratedSections(document);
  const active = hasActiveGeneration(document);
  const freeTierWait = getFreeTierWaitMinutes(document, dataUpdatedAt);
  const collectionId = acceptSummary?.collectionId ?? document.collectionId ?? null;

  // Sections the quick path is still saving are not for review; saved ones stay hidden until the progress panel is gone.
  const reviewSections = generatedSections.filter(
    (section) => section.autoSave !== "Pending" && !(showPanel && section.autoSave === "Saved")
  );
  const isQuickDocument = getQuickSections(document).length > 0;
  const hasManualCandidates = reviewSections.some(
    (section) => section.autoSave !== "Saved" && section.candidates.some((candidate) => !candidate.accepted)
  );
  const allQuestionsSaved = isQuickDocument && !hasManualCandidates && !acceptSummary;
  const showSaveControls = !isQuickDocument || hasManualCandidates;
  const acceptedTotal = countAcceptedQuestions(document);

  const needsCollectionName = !collectionId;
  const collectionNameValue = (collectionNameInput ?? document.title).slice(0, 200);
  const currentStep = generatedCount > 0 ? "review" : "coverage";
  const quickProgress = getQuickProgress(document);
  const progressLine = openingLearn
    ? "Your quiz is ready. Opening Learn…"
    : error
      ? "Can't check progress right now. Trying again…"
      : describeQuickProgress(quickProgress);

  const focusPicker = () => {
    const picker = pickerRef.current;
    if (!picker) return;
    picker.scrollIntoView?.({ behavior: "smooth", block: "start" });
    picker.focus();
  };

  const toggleSection = (sectionId: string) => {
    const next = new Set(effectiveSelection);
    if (next.has(sectionId)) next.delete(sectionId);
    else next.add(sectionId);
    setSelection(next);
    setGenerateError(null);
  };

  const toggleCandidate = (candidateId: string) => {
    setExcluded((current) => {
      const next = new Set(current);
      if (next.has(candidateId)) next.delete(candidateId);
      else next.add(candidateId);
      return next;
    });
  };

  const saveEdit = (candidateId: string, edit: CandidateEdit) => {
    setEdits((current) => ({ ...current, [candidateId]: edit }));
  };

  const pendingCandidates = reviewSections
    .filter((section) => section.autoSave !== "Saved")
    .flatMap((section) => section.candidates.filter((candidate) => !candidate.accepted && !excluded.has(candidate.id)));
  const acceptPayload: AcceptStudyGuideCandidate[] = pendingCandidates.map((candidate) => {
    const edit = edits[candidate.id];
    return edit
      ? {
          id: candidate.id,
          question: edit.question,
          correctAnswer: edit.correctAnswer,
          incorrectAnswers: edit.incorrectAnswers,
          explanation: edit.explanation,
        }
      : { id: candidate.id };
  });

  const questionNumbers = new Map<string, number>();
  reviewSections
    .flatMap((section) => [...section.candidates].sort((a, b) => a.index - b.index))
    .forEach((candidate, index) => questionNumbers.set(candidate.id, index + 1));

  return (
    <div className="px-4 py-6 sm:px-0 max-w-3xl mx-auto space-y-5">
      <Link to="/study-guides/documents" className="text-sm font-medium text-indigo-600 hover:text-indigo-800">
        ← My study guides
      </Link>

      {!showPanel && <StudyGuideSteps current={currentStep} />}

      <header className="space-y-1">
        <h1 className="text-2xl font-bold text-gray-900 break-words">{document.title}</h1>
        <p className="text-sm text-gray-600">
          {FILE_TYPE_LABELS[document.fileType] ?? document.fileType}
          {document.pageCount != null ? ` · ${document.pageCount} page${document.pageCount === 1 ? "" : "s"}` : ""}
          {" · "}
          {generatedCount} of {sections.length} section{sections.length === 1 ? "" : "s"} generated
          {" · "}
          {document.category} / {document.navigationKeyword1} / {document.navigationKeyword2}
        </p>
        <p className="text-xs text-gray-500">
          Text kept until {formatDate(document.expiresUtc)}. Saved questions stay in your collection after that.
        </p>
        {collectionId && (
          <div className="flex flex-wrap gap-2">
            {acceptedTotal > 0 && (
              <Link
                to={buildCollectionStudyPath("learn", collectionId, document.title)}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-md bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700 sm:flex-none"
              >
                Learn
              </Link>
            )}
            <Link
              to={buildCollectionStudyPath("explore", collectionId)}
              className={
                acceptedTotal > 0
                  ? "inline-flex min-h-11 flex-1 items-center justify-center rounded-md border border-gray-300 bg-white px-4 text-sm font-medium text-gray-700 hover:bg-gray-50 sm:flex-none"
                  : "inline-flex min-h-11 items-center text-sm font-medium text-indigo-600 hover:text-indigo-800"
              }
            >
              Open collection
            </Link>
          </div>
        )}
      </header>

      {isDuplicate && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800" role="status">
          You already uploaded this study guide, so here is your existing copy.
          {fromQuickPath ? " Using the topic from your earlier upload." : ""}
        </div>
      )}

      {quickMessage && !showPanel && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800" role="status">
          {quickMessage}
        </div>
      )}

      {showQuickFailure && (
        <div ref={quickFailureRef} tabIndex={-1} role="alert" className="focus:outline-none">
          <ErrorMessage
            message={
              quickOutcome?.kind === "allFailed"
                ? ALL_FAILED_MESSAGE
                : quickOutcome?.kind === "saveFailed"
                  ? SAVE_FAILED_MESSAGE
                  : NO_QUESTIONS_MESSAGE
            }
          />
        </div>
      )}

      {showPanel && (
        <section
          ref={progressRef}
          aria-labelledby="quick-progress-heading"
          tabIndex={-1}
          className="space-y-2 rounded-lg border border-indigo-200 bg-indigo-50 p-4 focus:outline-none"
        >
          <h2 id="quick-progress-heading" className="text-base font-semibold text-indigo-900">
            Making your quiz
          </h2>
          <p role="status" className="text-sm text-indigo-900">
            {progressLine}
          </p>
          <div className="h-2 rounded-full bg-indigo-100" aria-hidden="true">
            <div
              className="h-2 rounded-full bg-indigo-600 transition-[width] motion-reduce:transition-none"
              style={{ width: `${quickProgress.total === 0 ? 0 : Math.round((quickProgress.ready / quickProgress.total) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-indigo-800">
            Questions save automatically, so you can leave this page. Find them later in My study guides.
          </p>
          {quickSlow && (
            <p className="text-xs text-indigo-800">
              This is taking longer than usual. Your questions will still save when they&apos;re ready.
            </p>
          )}
          <ul className="space-y-1">
            {getQuickSections(document).map((section: StudyGuideSection) => (
              <li key={section.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-indigo-950">
                <span className="min-w-0 break-words">{section.label}</span>
                <span className="text-xs font-medium">{QUICK_SECTION_STATUS_LABELS[getQuickSectionStatus(section)]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active && !showPanel && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900" role="status">
          {freeTierWait != null
            ? `Free plan: generation starts within about ${freeTierWait} minute${freeTierWait === 1 ? "" : "s"}. You can leave this page and come back.`
            : "Generating questions… This page updates automatically."}
        </div>
      )}

      {generateResult && (
        <div className="rounded-md bg-green-50 p-3 text-sm text-green-800" role="status">
          Queued {generateResult.queuedCount} section{generateResult.queuedCount === 1 ? "" : "s"}
          {generateResult.cachedCount > 0 ? ` (${generateResult.cachedCount} ready for free)` : ""}. Used{" "}
          {generateResult.chargedSections} of your sections.
        </div>
      )}

      {generateError && <ErrorMessage message={generateError} onRetry={() => setGenerateError(null)} />}

      {!showPanel && (
        <div ref={pickerRef} tabIndex={-1} className="focus:outline-none">
          <StudyGuideSectionPicker
            sections={sections}
            quota={document.quota}
            selection={effectiveSelection}
            onToggle={toggleSection}
            onGenerate={(questionStyle) =>
              generateMutation.mutate({ sectionIds: [...effectiveSelection], questionStyle })
            }
            isGenerating={generateMutation.isPending}
          />
        </div>
      )}

      {reviewSections.length > 0 && (
        <section aria-labelledby="study-guide-review-heading" className="space-y-4">
          <div>
            <h2 id="study-guide-review-heading" className="text-lg font-semibold text-gray-900">
              {allQuestionsSaved ? "Your questions" : "Review questions"}
            </h2>
            <p className="text-sm text-gray-600">
              {allQuestionsSaved
                ? "Saved to your private collection. Use Edit to change one."
                : "Every question quotes the part of your guide it came from. Uncheck or edit questions, then save them to your collection."}
            </p>
          </div>

          {acceptSummary && (
            <div className="rounded-md bg-green-50 p-4 text-sm text-green-800">
              <p role="status">
                {acceptSummary.published ? "Published" : "Saved"} {acceptSummary.createdCount} question
                {acceptSummary.createdCount === 1 ? "" : "s"}{" to your collection"}
                {acceptSummary.duplicateCount > 0 ? ` (${acceptSummary.duplicateCount} already saved)` : ""}
                {acceptSummary.failedCount > 0 ? ` · ${acceptSummary.failedCount} could not be saved` : ""}.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  to={buildCollectionStudyPath("learn", acceptSummary.collectionId, document.title)}
                  className="inline-flex min-h-11 items-center rounded-md bg-indigo-600 px-3 font-medium text-white hover:bg-indigo-700"
                >
                  Learn
                </Link>
                <Link
                  to={buildCollectionStudyPath("quiz", acceptSummary.collectionId)}
                  className="inline-flex min-h-11 items-center rounded-md border border-green-300 bg-white px-3 font-medium text-green-900 hover:bg-green-100"
                >
                  Start quiz
                </Link>
                <Link
                  to={buildCollectionStudyPath("explore", acceptSummary.collectionId)}
                  className="inline-flex min-h-11 items-center rounded-md border border-green-300 bg-white px-3 font-medium text-green-900 hover:bg-green-100"
                >
                  Study flashcards
                </Link>
                <button
                  type="button"
                  onClick={focusPicker}
                  className="inline-flex min-h-11 items-center rounded-md border border-green-300 bg-white px-3 font-medium text-green-900 hover:bg-green-100"
                >
                  Add more
                </button>
                <Link
                  to={buildCollectionPath(acceptSummary.collectionId)}
                  className="inline-flex min-h-11 items-center rounded-md border border-green-300 bg-white px-3 font-medium text-green-900 hover:bg-green-100"
                >
                  Open collection
                </Link>
              </div>
            </div>
          )}
          {acceptError && <ErrorMessage message={acceptError} onRetry={() => setAcceptError(null)} />}

          {reviewSections.map((section) => (
            <div key={section.id} className="space-y-2">
              <h3 className="text-sm font-semibold text-gray-800">
                {section.label}
                {section.cached && <span className="ml-2 text-xs font-normal text-emerald-700">(ready, free)</span>}
              </h3>
              {section.droppedCount > 0 && (
                <p className="text-xs text-gray-500">
                  {section.droppedCount} question{section.droppedCount === 1 ? "" : "s"} dropped: not found in your
                  guide.
                </p>
              )}
              {section.candidates.length === 0 ? (
                <p className="text-sm text-gray-600">No questions could be made from this section.</p>
              ) : (
                <ol className="space-y-3">
                  {[...section.candidates]
                    .sort((a, b) => a.index - b.index)
                    .map((candidate) => (
                      <StudyGuideCandidateCard
                        key={candidate.id}
                        candidate={candidate}
                        number={questionNumbers.get(candidate.id) ?? 0}
                        sectionLabel={section.label}
                        included={!excluded.has(candidate.id)}
                        edit={edits[candidate.id]}
                        onToggle={toggleCandidate}
                        onSaveEdit={saveEdit}
                        disabled={acceptMutation.isPending}
                        alreadyHandled={section.autoSave === "Saved" && !candidate.accepted}
                      />
                    ))}
                </ol>
              )}
            </div>
          ))}

          {showSaveControls && needsCollectionName && (
            <div className="space-y-1">
              <label htmlFor="study-guide-collection-name" className="block text-sm font-medium text-gray-800">
                Collection name
              </label>
              <input
                id="study-guide-collection-name"
                type="text"
                maxLength={200}
                value={collectionNameValue}
                onChange={(event) => setCollectionNameInput(event.target.value)}
                disabled={acceptMutation.isPending}
                className="block w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-gray-500">
                Your saved questions go into a new private collection with this name.
              </p>
            </div>
          )}

          {showSaveControls && isAdmin && (
            <fieldset className="space-y-1">
              <legend className="block text-sm font-medium text-gray-800">Save as</legend>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="study-guide-save-as"
                  checked={!publish}
                  onChange={() => setPublish(false)}
                  disabled={acceptMutation.isPending}
                />
                Private (only me)
              </label>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="radio"
                  name="study-guide-save-as"
                  checked={publish}
                  onChange={() => setPublish(true)}
                  disabled={acceptMutation.isPending}
                />
                Publish to the library (public)
              </label>
              <p className="text-xs text-gray-500">
                Published questions become public items. The collection itself stays private to you, and the
                document title is not added to the explanations.
              </p>
            </fieldset>
          )}

          {showSaveControls && (
          <div className="sticky bottom-0 flex flex-wrap items-center gap-3 border-t border-gray-200 bg-white/95 py-3">
            <button
              type="button"
              disabled={acceptPayload.length === 0 || acceptMutation.isPending}
              onClick={() =>
                acceptMutation.mutate({
                  candidates: acceptPayload,
                  collectionName: needsCollectionName ? collectionNameValue.trim() || undefined : undefined,
                  publish: isAdmin && publish,
                })
              }
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {acceptMutation.isPending ? "Saving…" : `Save ${acceptPayload.length} selected`}
            </button>
            <span className="text-xs text-gray-500">
              {isAdmin && publish ? "Questions are published as public items." : "Questions are saved as your private items."}
            </span>
          </div>
          )}
        </section>
      )}
    </div>
  );
};

export default StudyGuideDocumentPage;
