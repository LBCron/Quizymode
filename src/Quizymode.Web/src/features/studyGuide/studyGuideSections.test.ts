import { describe, expect, it } from "vitest";
import type { StudyGuideDocument, StudyGuideSection } from "@/api/studyGuideDocuments";
import {
  buildQuickNotice,
  computePreselection,
  countAcceptedQuestions,
  describeQuickProgress,
  getQuickProgress,
  getQuickSectionStatus,
  hasActiveGeneration,
  isSectionActive,
} from "./studyGuideSections";

function section(index: number, overrides: Partial<StudyGuideSection> = {}): StudyGuideSection {
  return {
    id: `s${index}`,
    index,
    label: `Section ${index}`,
    preview: "",
    sizeBytes: 100,
    textExpired: false,
    status: "New",
    cached: false,
    droppedCount: 0,
    candidates: [],
    ...overrides,
  };
}

function documentOf(sections: StudyGuideSection[], remainingToday = 10): StudyGuideDocument {
  return {
    id: "doc-1",
    title: "Doc",
    fileType: "txt",
    category: "science",
    navigationKeyword1: "biology",
    navigationKeyword2: "cells",
    keywords: [],
    createdUtc: "2026-11-01T00:00:00Z",
    expiresUtc: "2026-12-01T00:00:00Z",
    isDuplicate: false,
    quota: { tier: "Free", dailyLimit: 10, dailyUsed: 0, monthlyLimit: 60, monthlyUsed: 0, remainingToday },
    sections,
  };
}

describe("quick-path section state (#363)", () => {
  it("counts Queued, Processing and Generated-with-pending-auto-save as still active", () => {
    expect(isSectionActive(section(0, { status: "Queued" }))).toBe(true);
    expect(isSectionActive(section(0, { status: "Processing" }))).toBe(true);
    expect(isSectionActive(section(0, { status: "Generated", autoSave: "Pending" }))).toBe(true);
  });

  it("treats a failed generation, a Saved or Failed auto-save, a manual Generated section and New as terminal", () => {
    expect(isSectionActive(section(0, { status: "Failed", autoSave: "Pending" }))).toBe(false);
    expect(isSectionActive(section(0, { status: "Generated", autoSave: "Saved" }))).toBe(false);
    expect(isSectionActive(section(0, { status: "Generated", autoSave: "Failed" }))).toBe(false);
    expect(isSectionActive(section(0, { status: "Generated", autoSave: null }))).toBe(false);
    expect(isSectionActive(section(0, { status: "New" }))).toBe(false);
  });

  it("keeps polling while any section is active", () => {
    expect(hasActiveGeneration(undefined)).toBe(false);
    expect(hasActiveGeneration(documentOf([section(0, { status: "Generated", autoSave: "Saved" })]))).toBe(false);
    expect(hasActiveGeneration(documentOf([section(0, { status: "Generated", autoSave: "Pending" })]))).toBe(true);
  });

  it("describes each quick section for the progress list", () => {
    expect(getQuickSectionStatus(section(0, { status: "Queued", autoSave: "Pending" }))).toBe("waiting");
    expect(getQuickSectionStatus(section(0, { status: "Processing", autoSave: "Pending" }))).toBe("making");
    expect(getQuickSectionStatus(section(0, { status: "Generated", autoSave: "Pending" }))).toBe("saving");
    expect(getQuickSectionStatus(section(0, { status: "Generated", autoSave: "Saved" }))).toBe("saved");
    expect(getQuickSectionStatus(section(0, { status: "Failed", autoSave: "Pending" }))).toBe("failed");
    expect(getQuickSectionStatus(section(0, { status: "Generated", autoSave: "Failed" }))).toBe("saveFailed");
  });

  it("counts only quick sections and picks the status line by precedence", () => {
    const manual = section(0, { status: "Generated" });
    const waiting = documentOf([manual, section(1, { status: "Queued", autoSave: "Pending" })]);
    const midway = documentOf([
      section(0, { status: "Generated", autoSave: "Pending" }),
      section(1, { status: "Processing", autoSave: "Pending" }),
    ]);
    const saving = documentOf([section(0, { status: "Generated", autoSave: "Pending" })]);

    expect(getQuickProgress(waiting)).toMatchObject({ total: 1, ready: 0, failed: 0, allQueued: true });
    expect(describeQuickProgress(getQuickProgress(waiting))).toBe("Your quiz is in line.");
    expect(describeQuickProgress(getQuickProgress(midway))).toBe("Making your quiz: 1 of 2 sections ready.");
    expect(describeQuickProgress(getQuickProgress(saving))).toBe("Saving your questions…");
  });

  it("words the Learn notice for one or several failed sections", () => {
    expect(buildQuickNotice({ total: 3, ready: 2, failed: 1, saveFailed: 0, allQueued: false, allGenerated: false })).toBe(
      "2 of 3 sections were made. 1 section couldn't be made and wasn't counted against your limit. Retry from your study guide."
    );
    expect(buildQuickNotice({ total: 3, ready: 1, failed: 2, saveFailed: 0, allQueued: false, allGenerated: false })).toBe(
      "1 of 3 sections were made. 2 sections couldn't be made and weren't counted against your limit. Retry from your study guide."
    );
  });

  it("never says a section that was made but not saved was not charged", () => {
    const notice = buildQuickNotice({ total: 3, ready: 2, failed: 0, saveFailed: 2, allQueued: false, allGenerated: false });

    expect(notice).toBe(
      "1 of 3 sections were made. 2 sections couldn't be saved automatically. Open your study guide to save them."
    );
    expect(notice).not.toMatch(/counted against|charged/);
    expect(
      buildQuickNotice({ total: 3, ready: 1, failed: 1, saveFailed: 1, allQueued: false, allGenerated: false })
    ).toBe(
      "1 of 3 sections were made. 1 section couldn't be made and wasn't counted against your limit. 1 section couldn't be saved automatically. Open your study guide to save it. Retry from your study guide."
    );
  });

  it("counts accepted questions across sections", () => {
    const candidate = (accepted: boolean) =>
      ({ id: crypto.randomUUID(), accepted }) as unknown as StudyGuideSection["candidates"][number];
    const doc = documentOf([
      section(0, { candidates: [candidate(true), candidate(false)] }),
      section(1, { candidates: [candidate(true)] }),
    ]);

    expect(countAcceptedQuestions(doc)).toBe(2);
  });

  it("limits the preselection to the cap as well as the sections left today", () => {
    const doc = documentOf([0, 1, 2, 3, 4].map((index) => section(index)), 4);

    expect([...computePreselection(doc)]).toHaveLength(4);
    expect([...computePreselection(doc, 3)]).toEqual(["s0", "s1", "s2"]);
    expect([...computePreselection(documentOf([section(0), section(1)], 1), 3)]).toEqual(["s0"]);
  });
});
