import { apiClient } from "./client";

/** Study guide documents v2 (AC 6.6, epic #203). Types mirror the API contract exactly. */

export type StudyGuideTier = "Free" | "Premium";

export type StudyGuideFileType = "pdf" | "docx" | "pptx" | "txt";

export type StudyGuideSectionStatus = "New" | "Queued" | "Processing" | "Generated" | "Failed";

/** Set only on sections queued by "Make a quiz" (#363): the server saves their questions for you. */
export type StudyGuideSectionAutoSave = "Pending" | "Saved" | "Failed";

export type StudyGuideQuickOutcome = "Generating" | "Ready" | "NeedsChoice" | "OverAllowance" | "Unavailable";

export interface StudyGuideQuota {
  tier: StudyGuideTier;
  dailyLimit: number;
  dailyUsed: number;
  monthlyLimit: number;
  monthlyUsed: number;
  /** min(daily left, monthly left) */
  remainingToday: number;
}

export interface StudyGuideDocumentsConfig {
  enabled: boolean;
  maxFileBytes: number;
  maxPages: number;
  maxTextBytes: number;
  acceptedExtensions: string[];
  freeTierDelayMinutes: number;
  quota: StudyGuideQuota;
  /** "Make a quiz" generates and saves a document only when at most this many sections still need questions. */
  quickPathMaxSections?: number;
}

export interface StudyGuideDocumentSummary {
  id: string;
  title: string;
  fileType: StudyGuideFileType | string;
  sectionCount: number;
  generatedSectionCount: number;
  acceptedCount: number;
  collectionId?: string | null;
  createdUtc: string;
  lastActivityUtc: string;
  expiresUtc: string;
  /** The owner marked this guide as their primary source (#372). */
  isPrimarySource?: boolean;
}

export interface StudyGuideCandidate {
  id: string;
  index: number;
  question: string;
  correctAnswer: string;
  incorrectAnswers: string[];
  explanation: string;
  sourceQuote: string;
  page?: number | null;
  accepted: boolean;
  /** The saved item's id; only when accepted and the item still exists. */
  itemId?: string | null;
}

export interface StudyGuideSection {
  id: string;
  index: number;
  label: string;
  pageStart?: number | null;
  pageEnd?: number | null;
  /** First 240 characters of the section text, or "" when the text expired. */
  preview: string;
  sizeBytes: number;
  textExpired: boolean;
  status: StudyGuideSectionStatus;
  /** True when Generated and this caller was not charged for it. */
  cached: boolean;
  notBeforeUtc?: string | null;
  error?: string | null;
  droppedCount: number;
  /** Only populated when status is Generated. */
  candidates: StudyGuideCandidate[];
  /** null = manual review; otherwise the "Make a quiz" auto-save state. */
  autoSave?: StudyGuideSectionAutoSave | null;
}

export interface StudyGuideDocument {
  id: string;
  title: string;
  fileType: StudyGuideFileType | string;
  pageCount?: number | null;
  category: string;
  navigationKeyword1: string;
  navigationKeyword2: string;
  keywords: string[];
  collectionId?: string | null;
  createdUtc: string;
  expiresUtc: string;
  isDuplicate: boolean;
  quota: StudyGuideQuota;
  sections: StudyGuideSection[];
  /** The owner marked this guide as their primary source (#372). */
  isPrimarySource?: boolean;
}

export interface CreateStudyGuideDocumentRequest {
  file?: File | null;
  text?: string | null;
  title?: string | null;
  category: string;
  navigationKeyword1: string;
  navigationKeyword2: string;
  keywords?: string[];
}

export interface StudyGuideQuickResponse {
  document: StudyGuideDocument;
  outcome: StudyGuideQuickOutcome;
  /** The one short line to show for the outcome. */
  message: string;
  queuedCount: number;
  cachedCount: number;
  chargedSections: number;
  /** The saved collection's name (Ready / once something is saved). */
  collectionName?: string | null;
}

export interface GenerateStudyGuideSectionsResponse {
  queuedCount: number;
  cachedCount: number;
  chargedSections: number;
  quota: StudyGuideQuota;
}

export interface AcceptStudyGuideCandidate {
  id: string;
  question?: string;
  correctAnswer?: string;
  incorrectAnswers?: string[];
  explanation?: string;
}

export interface AcceptStudyGuideCandidatesResponse {
  collectionId: string;
  createdCount: number;
  duplicateCount: number;
  failedCount: number;
  itemIds: string[];
}

/** Builds the multipart body for POST /study-guides/documents. Exported for tests. */
export function buildCreateDocumentFormData(request: CreateStudyGuideDocumentRequest): FormData {
  const form = new FormData();
  if (request.file) {
    form.append("file", request.file, request.file.name);
  }
  if (request.text != null && request.text !== "") {
    form.append("text", request.text);
  }
  if (request.title != null && request.title.trim() !== "") {
    form.append("title", request.title.trim());
  }
  form.append("category", request.category);
  form.append("navigationKeyword1", request.navigationKeyword1);
  form.append("navigationKeyword2", request.navigationKeyword2);
  for (const keyword of request.keywords ?? []) {
    form.append("keywords", keyword);
  }
  return form;
}

const documentPath = (id: string) => `/study-guides/documents/${encodeURIComponent(id)}`;

export const studyGuideDocumentsApi = {
  getConfig: async (): Promise<StudyGuideDocumentsConfig> => {
    const response = await apiClient.get<StudyGuideDocumentsConfig>("/study-guides/documents/config");
    return response.data;
  },

  create: async (request: CreateStudyGuideDocumentRequest): Promise<StudyGuideDocument> => {
    // The browser sets the multipart boundary; overriding the JSON default stops axios from
    // serialising the FormData to JSON.
    const response = await apiClient.post<StudyGuideDocument>(
      "/study-guides/documents",
      buildCreateDocumentFormData(request),
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return response.data;
  },

  /** "Make a quiz": create the document and auto-generate and auto-save a short one (POST /study-guides/documents/quick). */
  quick: async (request: CreateStudyGuideDocumentRequest): Promise<StudyGuideQuickResponse> => {
    const response = await apiClient.post<StudyGuideQuickResponse>(
      "/study-guides/documents/quick",
      buildCreateDocumentFormData(request),
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return response.data;
  },

  list: async (): Promise<{ documents: StudyGuideDocumentSummary[] }> => {
    const response = await apiClient.get<{ documents: StudyGuideDocumentSummary[] }>(
      "/study-guides/documents"
    );
    return response.data;
  },

  get: async (id: string): Promise<StudyGuideDocument> => {
    const response = await apiClient.get<StudyGuideDocument>(documentPath(id));
    return response.data;
  },

  generate: async (
    id: string,
    sectionIds: string[],
    questionStyle?: "Recall" | "ClinicalScenario"
  ): Promise<GenerateStudyGuideSectionsResponse> => {
    const body = questionStyle ? { sectionIds, questionStyle } : { sectionIds };
    const response = await apiClient.post<GenerateStudyGuideSectionsResponse>(
      `${documentPath(id)}/generate`,
      body
    );
    return response.data;
  },

  /** Mark or unmark a guide as my primary source (PUT /study-guides/documents/{id}/primary-source). */
  setPrimarySource: async (id: string, isPrimarySource: boolean): Promise<{ id: string; isPrimarySource: boolean }> => {
    const response = await apiClient.put<{ id: string; isPrimarySource: boolean }>(
      `${documentPath(id)}/primary-source`,
      { isPrimarySource }
    );
    return response.data;
  },

  accept: async (
    id: string,
    candidates: AcceptStudyGuideCandidate[],
    collectionName?: string,
    /** Admin only: save as public items (the collection stays private). Sent only when true. */
    publish?: boolean
  ): Promise<AcceptStudyGuideCandidatesResponse> => {
    const response = await apiClient.post<AcceptStudyGuideCandidatesResponse>(
      `${documentPath(id)}/accept`,
      {
        candidates,
        ...(collectionName ? { collectionName } : {}),
        ...(publish ? { publish: true } : {}),
      }
    );
    return response.data;
  },
};
