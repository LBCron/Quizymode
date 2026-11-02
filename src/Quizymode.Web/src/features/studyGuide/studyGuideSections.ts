import type { StudyGuideCandidate, StudyGuideDocument, StudyGuideSection } from "@/api/studyGuideDocuments";

/** Poll interval while any section is queued or generating. */
export const STUDY_GUIDE_POLL_INTERVAL_MS = 3000;
/** API limit for one generate call. */
export const MAX_SECTIONS_PER_GENERATE = 50;
/** API limit for one accept call. */
export const MAX_CANDIDATES_PER_ACCEPT = 200;

export type SectionChipKind = "new" | "free" | "queued" | "generating" | "done" | "failed" | "expired";

export interface SectionChip {
  kind: SectionChipKind;
  label: string;
  className: string;
}

const CHIP_STYLES: Record<SectionChipKind, string> = {
  new: "border-slate-300 bg-white text-slate-700",
  free: "border-emerald-300 bg-emerald-50 text-emerald-800",
  queued: "border-amber-300 bg-amber-50 text-amber-800",
  generating: "border-indigo-300 bg-indigo-50 text-indigo-800",
  done: "border-green-300 bg-green-50 text-green-800",
  failed: "border-red-300 bg-red-50 text-red-800",
  expired: "border-gray-300 bg-gray-100 text-gray-600",
};

const CHIP_LABELS: Record<SectionChipKind, string> = {
  new: "New",
  free: "Ready, free",
  queued: "Queued",
  generating: "Generating",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
};

export function getSectionChipKind(section: StudyGuideSection): SectionChipKind {
  switch (section.status) {
    case "Generated":
      return section.cached ? "free" : "done";
    case "Queued":
      return "queued";
    case "Processing":
      return "generating";
    case "Failed":
      return section.textExpired ? "expired" : "failed";
    default:
      return section.textExpired ? "expired" : "new";
  }
}

export function getSectionChip(section: StudyGuideSection): SectionChip {
  const kind = getSectionChipKind(section);
  return { kind, label: CHIP_LABELS[kind], className: CHIP_STYLES[kind] };
}

/** A section can be (re)submitted for generation when it is new or failed and its text is still kept. */
export function isSectionSelectable(section: StudyGuideSection): boolean {
  return !section.textExpired && (section.status === "New" || section.status === "Failed");
}

/**
 * Still moving: queued or generating, or generated for "Make a quiz" but not saved yet. Terminal is a failed
 * generation, a Failed or Saved auto-save, a manual Generated section, or New.
 */
export function isSectionActive(section: StudyGuideSection): boolean {
  return (
    section.status === "Queued" ||
    section.status === "Processing" ||
    (section.status === "Generated" && section.autoSave === "Pending")
  );
}

export function hasActiveGeneration(document: StudyGuideDocument | undefined): boolean {
  return !!document?.sections.some(isSectionActive);
}

/** Sections the "Make a quiz" request queued (the server marks them with an auto-save state). */
export function getQuickSections(document: StudyGuideDocument): StudyGuideSection[] {
  return document.sections.filter((section) => section.autoSave != null);
}

export function hasActiveQuickSection(document: StudyGuideDocument | undefined): boolean {
  return !!document?.sections.some((section) => section.autoSave != null && isSectionActive(section));
}

/** Generation failed: nothing was charged (the charge is refunded). */
export function isQuickSectionFailed(section: StudyGuideSection): boolean {
  return section.autoSave != null && section.status === "Failed";
}

/** Generated and charged, but the automatic save gave up: the questions wait for a manual Save. */
export function isQuickSectionSaveFailed(section: StudyGuideSection): boolean {
  return section.autoSave === "Failed" && section.status !== "Failed";
}

export type QuickSectionStatus = "waiting" | "making" | "saving" | "saved" | "failed" | "saveFailed";

export function getQuickSectionStatus(section: StudyGuideSection): QuickSectionStatus {
  if (isQuickSectionFailed(section)) return "failed";
  if (isQuickSectionSaveFailed(section)) return "saveFailed";
  if (section.autoSave === "Saved") return "saved";
  if (section.status === "Generated") return "saving";
  return section.status === "Processing" ? "making" : "waiting";
}

export const QUICK_SECTION_STATUS_LABELS: Record<QuickSectionStatus, string> = {
  waiting: "Waiting",
  making: "Making questions",
  saving: "Saving",
  saved: "Saved",
  failed: "Couldn't be made",
  saveFailed: "Couldn't be saved",
};

export interface QuickProgress {
  total: number;
  /** Generated, saving or saved. */
  ready: number;
  /** Generation failed (not charged). */
  failed: number;
  /** Generated but the automatic save failed (charged; save manually). */
  saveFailed: number;
  allQueued: boolean;
  allGenerated: boolean;
}

export function getQuickProgress(document: StudyGuideDocument): QuickProgress {
  const quick = getQuickSections(document);
  const failed = quick.filter(isQuickSectionFailed).length;
  const saveFailed = quick.filter(isQuickSectionSaveFailed).length;
  const working = quick.filter((section) => !isQuickSectionFailed(section) && !isQuickSectionSaveFailed(section));
  return {
    total: quick.length,
    ready: working.filter((section) => section.status === "Generated").length,
    failed,
    saveFailed,
    allQueued: working.length > 0 && working.every((section) => section.status === "Queued"),
    allGenerated: working.length > 0 && working.every((section) => section.status === "Generated"),
  };
}

/** The one live-region line for the progress panel, by precedence. */
export function describeQuickProgress(progress: QuickProgress): string {
  if (progress.allQueued) return "Your quiz is in line.";
  if (progress.allGenerated) return "Saving your questions…";
  return `Making your quiz: ${progress.ready} of ${progress.total} sections ready.`;
}

export function countAcceptedQuestions(document: StudyGuideDocument): number {
  return document.sections.reduce(
    (sum, section) => sum + section.candidates.filter((candidate) => candidate.accepted).length,
    0
  );
}

/**
 * D7: the one-line Learn notice when some "Make a quiz" sections did not end up saved. Only sections whose generation
 * failed were refunded; sections that were made but not saved were charged and say to save them from the study guide.
 */
export function buildQuickNotice(progress: QuickProgress): string {
  const made = progress.total - progress.failed - progress.saveFailed;
  const parts = [`${made} of ${progress.total} sections were made.`];
  if (progress.failed > 0) {
    parts.push(
      progress.failed === 1
        ? "1 section couldn't be made and wasn't counted against your limit."
        : `${progress.failed} sections couldn't be made and weren't counted against your limit.`
    );
  }
  if (progress.saveFailed > 0) {
    parts.push(
      progress.saveFailed === 1
        ? "1 section couldn't be saved automatically. Open your study guide to save it."
        : `${progress.saveFailed} sections couldn't be saved automatically. Open your study guide to save them.`
    );
  }
  if (progress.failed > 0) parts.push("Retry from your study guide.");
  return parts.join(" ");
}

/**
 * Initial picker selection: the first sections that were never processed, in document order,
 * up to the sections left today. Generated (including cached) sections are never selected, so
 * they never count against the quota.
 */
export function computePreselection(document: StudyGuideDocument, maxCount?: number): Set<string> {
  const limit = Math.max(
    0,
    Math.min(document.quota.remainingToday, MAX_SECTIONS_PER_GENERATE, maxCount ?? MAX_SECTIONS_PER_GENERATE)
  );
  const ids = [...document.sections]
    .sort((a, b) => a.index - b.index)
    .filter((section) => !section.textExpired && section.status === "New")
    .slice(0, limit)
    .map((section) => section.id);
  return new Set(ids);
}

/** Keeps only ids that are still selectable (statuses change while polling). */
export function pruneSelection(document: StudyGuideDocument, selection: Set<string>): Set<string> {
  const selectable = new Set(document.sections.filter(isSectionSelectable).map((section) => section.id));
  return new Set([...selection].filter((id) => selectable.has(id)));
}

export function countGeneratedSections(document: StudyGuideDocument): number {
  return document.sections.filter((section) => section.status === "Generated").length;
}

/**
 * Whole minutes until the latest queued free-tier job may start, relative to `nowMs`;
 * null when nothing is waiting.
 */
export function getFreeTierWaitMinutes(document: StudyGuideDocument, nowMs: number): number | null {
  if (document.quota.tier !== "Free") return null;
  const waits = document.sections
    .filter((section) => section.status === "Queued" && section.notBeforeUtc)
    .map((section) => Date.parse(section.notBeforeUtc as string) - nowMs)
    .filter((ms) => Number.isFinite(ms) && ms > 0);
  if (waits.length === 0) return null;
  return Math.max(1, Math.ceil(Math.max(...waits) / 60_000));
}

export function describeSectionPages(section: StudyGuideSection): string | null {
  if (section.pageStart == null) return null;
  if (section.pageEnd == null || section.pageEnd === section.pageStart) return `p. ${section.pageStart}`;
  return `pp. ${section.pageStart}–${section.pageEnd}`;
}

export function chunk<T>(values: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleDateString();
}

export function formatSourceLocation(candidate: StudyGuideCandidate, sectionLabel: string): string {
  return candidate.page != null ? `p. ${candidate.page}` : sectionLabel;
}
