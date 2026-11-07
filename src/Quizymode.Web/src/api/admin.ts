import { apiClient } from "./client";
import type { ItemImageReference, ItemSpeechSupport } from "@/types/api";

interface ReviewBoardItemResponse {
  id: string;
  category: string;
  isPrivate: boolean;
  question: string;
  questionSpeech?: ItemSpeechSupport | null;
  correctAnswer: string;
  correctAnswerSpeech?: ItemSpeechSupport | null;
  incorrectAnswers: string[];
  incorrectAnswerSpeech?: Record<number, ItemSpeechSupport> | null;
  explanation: string;
  createdBy: string;
  createdAt: string;
  factualRisk?: number | null;
  reviewComments?: string | null;
  groupLabel?: string | null;
  questionImage?: ItemImageReference | null;
  explanationImage?: ItemImageReference | null;
}

interface ReviewBoardResponse {
  items: ReviewBoardItemResponse[];
}

export interface PendingKeywordResponse {
  id: string;
  name: string;
  slug?: string | null;
  isPrivate: boolean;
  createdBy: string;
  createdAt: string;
  usageCount: number;
}

export interface PendingKeywordsResponse {
  keywords: PendingKeywordResponse[];
}

export interface KeywordReviewResponse {
  id: string;
  name: string;
  slug?: string | null;
  isPrivate: boolean;
  isReviewPending: boolean;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
}

export interface DatabaseSizeTableResponse {
  tableName: string;
  sizeBytes: number;
  sizeMegabytes: number;
  sizeGigabytes: number;
}

export interface DatabaseSizeResponse {
  sizeBytes: number;
  sizeMegabytes: number;
  sizeGigabytes: number;
  freeTierLimitMegabytes: number;
  usagePercentage: number;
  itemCount: number;
  keywordCount: number;
  topTables: DatabaseSizeTableResponse[];
}

interface AuditLogResponse {
  id: string;
  userEmail: string | null;
  ipAddress: string;
  country?: string | null;
  action: string | number; // Can be string or number depending on serialization
  entityId: string | null;
  createdUtc: string;
  metadata: Record<string, string>;
}

interface AuditLogsResponse {
  logs: AuditLogResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export type PageViewVisitorType = "all" | "authenticated" | "anonymous";

export interface PageViewAnalyticsSummary {
  windowStartUtc: string;
  windowEndUtc: string;
  totalPageViews: number;
  uniquePages: number;
  uniqueSessions: number;
  authenticatedPageViews: number;
  anonymousPageViews: number;
  authenticatedSessions: number;
  anonymousSessions: number;
  botSessions: number;
  botsExcluded: boolean;
  /** Sessions with any internal hit or an internal user; counted even when excluded. */
  internalSessions: number;
  internalExcluded: boolean;
}

export interface TopPageAnalyticsResponse {
  path: string;
  totalViews: number;
  uniqueSessions: number;
  authenticatedViews: number;
  anonymousViews: number;
  lastVisitedUtc: string;
}

export interface RecentPageViewResponse {
  id: string;
  url: string;
  path: string;
  queryString: string;
  sessionId: string;
  ipAddress: string;
  country?: string | null;
  isAuthenticated: boolean;
  userEmail: string | null;
  createdUtc: string;
}

/** Feature area assigned to each page hit by the server-side classifier (ANALYTICS-004). */
export type PageHitArea =
  | "home"
  | "browse"
  | "quiz"
  | "flashcards"
  | "collections"
  | "featured"
  | "item-detail"
  | "create"
  | "study-guide"
  | "search"
  | "auth"
  | "community"
  | "info"
  | "admin"
  | "other";

export type PageHitScopeType = "category" | "collection" | "item";

export interface FeatureAreaRow {
  area: PageHitArea | string;
  /** Hits across all areas add up to the summary's total page hits. */
  hits: number;
  sessions: number;
  /** A session can touch several areas, so shares can sum past 100%. */
  sessionSharePercent: number;
  /** Quiz/Flashcards question views (item-step hits). */
  itemSteps: number;
}

export interface ContentScopeRow {
  /** Category slug, navigation path (category/kw1/kw2), or collection id. */
  key: string;
  /** Resolved collection name; null for categories, nav paths, and deleted collections. */
  name: string | null;
  sessions: number;
  hits: number;
  itemSteps: number;
  avgItemStepsPerSession: number;
}

export interface ContentScopesResponse {
  topCategories: ContentScopeRow[];
  topNavPaths: ContentScopeRow[];
  topCollections: ContentScopeRow[];
}

export interface PageViewAnalyticsResponse {
  summary: PageViewAnalyticsSummary;
  topPages: TopPageAnalyticsResponse[];
  recentPageViews: RecentPageViewResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  featureAreas: FeatureAreaRow[];
  contentScopes: ContentScopesResponse;
}

/** Long-range trends read from daily rollups (ANALYTICS-011); bots and internal traffic excluded. */
export interface PageViewRollupsResponse {
  windowStartDay: string;
  windowEndDay: string;
  /** Raw page hits are kept this many days; older traffic exists only as rollups. */
  retentionDays: number;
  latestRolledDay: string | null;
  totalHits: number;
  /** Sum of each day's distinct sessions; a session spanning midnight counts once per day. */
  totalSessionDays: number;
  totalBouncedSessionDays: number;
  totalItemSteps: number;
  daily: Array<{ day: string; sessions: number; hits: number; itemSteps: number }>;
  areas: Array<{ area: string; hits: number; sessionDays: number; itemSteps: number }>;
  channels: PageViewRollupDimensionRow[];
  deviceClasses: PageViewRollupDimensionRow[];
  outcomes: PageViewRollupDimensionRow[];
  visitorTypes: PageViewRollupDimensionRow[];
  topScopes: Array<{ scopeType: string; scopeKey: string; hits: number; itemSteps: number }>;
}

export interface PageViewRollupDimensionRow {
  value: string;
  sessionDays: number;
  hits: number;
}

/** Admin overview KPIs for a window (ANALYTICS-005); visitor fields are null when unavailable. */
export interface AnalyticsOverviewKpis {
  humanSessions: number;
  engagedSessions: number;
  studySessions: number;
  convertedSessions: number;
  newSignups: number;
  activeRegisteredUsers: number;
  newVisitors: number | null;
  returningVisitors: number | null;
}

export interface AnalyticsOverviewDailyPoint {
  day: string;
  humanSessions: number;
  engagedSessions: number;
  studySessions: number;
  convertedSessions: number;
  newSignups: number;
  activeRegisteredUsers: number;
}

export interface AnalyticsOverviewResponse {
  days: number;
  windowStartDay: string;
  windowEndDay: string;
  current: AnalyticsOverviewKpis;
  previous: AnalyticsOverviewKpis;
  daily: AnalyticsOverviewDailyPoint[];
  releaseMarkers: Array<{ version: string; day: string }>;
  workQueue: {
    itemsAwaitingReview: number;
    pendingPrivateKeywords: number;
    ideasAwaitingModeration: number;
    /** Front-end error groups first seen in the window (OBS-001). */
    newClientErrorGroups: number;
    /** Items whose uploaded pictures await a decision (#401). */
    picturesAwaitingReview: number;
    /** When the oldest pending picture submission was made; null when none. */
    oldestPictureSubmittedAt?: string | null;
  };
}

export type ImageReviewQueueState = "PendingReview" | "Approved" | "Rejected" | "Withdrawn";

export interface ImageReviewQueueReview {
  state: ImageReviewQueueState;
  revision: number;
  submittedBy?: string | null;
  submittedByDisplay?: string | null;
  submittedAt?: string | null;
  decidedBy?: string | null;
  decidedAt?: string | null;
  reason?: string | null;
}

export interface ImageReviewQueueItem {
  id: string;
  category: string;
  isPrivate: boolean;
  readyForReview: boolean;
  question: string;
  correctAnswer: string;
  incorrectAnswers: string[];
  explanation: string;
  createdBy: string;
  questionImage?: ItemImageReference | null;
  explanationImage?: ItemImageReference | null;
  imageReview: ImageReviewQueueReview;
  ageSeconds?: number | null;
  incorrectAnswerRationale?: Record<number, string> | null;
}

export interface ImageReviewQueueResponse {
  items: ImageReviewQueueItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  oldestSubmittedAt?: string | null;
}

export interface SetImageReviewRequest {
  decision: "approve" | "reject";
  expectedRevision: number;
  reason?: string;
}

/** POST /admin/items/image-review/bulk (AC 3.26.4): up to 25 items, each with the revision the reviewer saw. */
export interface BulkImageReviewRequest {
  decision: "approve" | "reject";
  items: { id: string; expectedRevision: number }[];
  reason?: string;
}

export interface BulkImageReviewOutcome {
  id: string;
  applied: boolean;
  state?: string | null;
  revision?: number | null;
  errorCode?: string | null;
}

export interface BulkImageReviewResponse {
  applied: number;
  failed: number;
  results: BulkImageReviewOutcome[];
}

/**
 * A session's outcome is decided by its FIRST hit, so the three values are
 * mutually exclusive: "converted" means it started anonymous and then signed in.
 */
export type SessionOutcome = "anonymous" | "converted" | "authenticated";

export type SessionOutcomeFilter = "all" | SessionOutcome;

export type SessionSortBy = "recent" | "pages" | "duration";

export interface SessionOutcomeStats {
  outcome: SessionOutcome;
  sessions: number;
  bouncedSessions: number;
  bounceRatePercent: number;
  engagedSessions: number;
  avgPagesPerSession: number;
}

export interface PageViewSessionsSummary {
  windowStartUtc: string;
  windowEndUtc: string;
  totalSessions: number;
  totalPageHits: number;
  bouncedSessions: number;
  bounceRatePercent: number;
  engagedSessions: number;
  avgPagesPerSession: number;
  /** Averaged over non-bounce sessions only; bounces always have zero duration. */
  avgDurationSecondsEngaged: number;
  medianDurationSecondsEngaged: number;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  byOutcome: SessionOutcomeStats[];
  /** Sessions with at least one Quiz or Flashcards question view. */
  studySessions: number;
  /** Average questions viewed per study session. */
  avgItemStepsPerStudySession: number;
}

export interface SessionDepthBucket {
  label: string;
  totalSessions: number;
  anonymousSessions: number;
  convertedSessions: number;
  authenticatedSessions: number;
}

/** Landing sessions grouped by the entry hit's feature area and content scope. */
export interface LandingPageResponse {
  /** Most common entry path in the group, as an example. */
  path: string;
  sessions: number;
  bouncedSessions: number;
  bounceRatePercent: number;
  avgPagesPerSession: number;
  area: PageHitArea | string;
  scopeType: PageHitScopeType | null;
  scopeKey: string | null;
}

export interface PageViewSessionResponse {
  sessionId: string;
  outcome: SessionOutcome;
  startedUtc: string;
  endedUtc: string;
  pageHits: number;
  distinctPages: number;
  durationSeconds: number;
  isBounce: boolean;
  entryPath: string;
  exitPath: string;
  ipAddress: string;
  country?: string | null;
  userEmail: string | null;
  /** Null for hits recorded before user-agent capture existed. */
  userAgent: string | null;
  isBot: boolean;
  isInternal: boolean;
  entryArea: PageHitArea | string;
  /** Quiz/Flashcards questions viewed in this session. */
  itemSteps: number;
  /** Opaque visitor id from the first-hit snapshot; null for Global Privacy Control or no storage. */
  visitorId?: string | null;
  visitorType?: SessionVisitorType;
  /** Retained sessions from the same visitor (0 when the visitor is unknown). */
  sessionsFromVisitor?: number;
  channel?: string | null;
  /** Approximate area from the first hit's IP address (stored per session). */
  region?: string | null;
  city?: string | null;
  gamesPlayed?: number;
  gamesCompleted?: number;
  /** Quiz and flashcard runs started in this session. */
  quizRuns?: number;
  quizzesCompleted?: number;
}

export type SessionVisitorType = "new" | "returning" | "unknown";

export type SessionActivityKind = "game" | "quiz" | "flashcards";

/** One game, quiz or flashcards run of a session, built from engagement events by run id. */
export interface SessionActivity {
  kind: SessionActivityKind;
  runId: string;
  contextType: string | null;
  contextId: string | null;
  startedUtc: string;
  completedUtc: string | null;
  score: number | null;
  total: number | null;
}

export interface PageViewSessionsResponse {
  summary: PageViewSessionsSummary;
  depthBuckets: SessionDepthBucket[];
  landingPages: LandingPageResponse[];
  sessions: PageViewSessionResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
  visitors: VisitorCohortSummary;
}

/** 7-day return rate for first-time visitors, by their first session's channel and campaign (ANALYTICS-003). */
export interface VisitorReturnRateRow {
  channel: string;
  utmCampaign: string | null;
  firstTimeVisitors: number;
  returnedWithin7Days: number;
  returnRatePercent: number;
}

/** Returning-visitor metrics shared by the Sessions and Acquisition reports (ANALYTICS-003). */
export interface VisitorCohortSummary {
  newVisitorSessions: number;
  returningVisitorSessions: number;
  /** Sessions with no visitor id (Global Privacy Control, no storage, or older history). */
  unidentifiedSessions: number;
  newVisitors: number;
  returningVisitors: number;
  returnWithin7Days: VisitorReturnRateRow[];
  signupsWithVisitorHistory: number;
  avgPreSignupSessions: number | null;
  medianPreSignupSessions: number | null;
  avgDaysToSignup: number | null;
  medianDaysToSignup: number | null;
}

export interface AcquisitionSourceRow {
  utmSource: string | null;
  utmCampaign: string | null;
  sessions: number;
  bounceRatePercent: number;
  engagedRatePercent: number;
  convertedCount: number;
  conversionRatePercent: number;
}

export interface AcquisitionChannelRow {
  channel: string;
  sessions: number;
  bounceRatePercent: number;
  engagedRatePercent: number;
  convertedCount: number;
  conversionRatePercent: number;
  sourceBreakdown: AcquisitionSourceRow[];
}

export interface AcquisitionReportResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  totalSessions: number;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  channels: AcquisitionChannelRow[];
  deviceBreakdown: Array<{ deviceClass: string; sessions: number }>;
  countryBreakdown: Array<{ country: string | null; sessions: number }>;
  visitors: VisitorCohortSummary;
}

export interface SessionJourneyStep {
  stepNumber: number;
  path: string;
  queryString: string;
  url: string;
  isAuthenticated: boolean;
  createdUtc: string;
  /** Null on the final step: no exit event is recorded, so dwell time is unknown. */
  dwellSeconds: number | null;
  area: PageHitArea | string;
  isItemStep: boolean;
}

export interface PageViewSessionDetailResponse {
  sessionId: string;
  outcome: SessionOutcome;
  startedUtc: string;
  endedUtc: string;
  pageHits: number;
  distinctPages: number;
  durationSeconds: number;
  isBounce: boolean;
  ipAddress: string;
  country?: string | null;
  userEmail: string | null;
  userAgent: string | null;
  isBot: boolean;
  isInternal: boolean;
  steps: SessionJourneyStep[];
  visitorId?: string | null;
  visitorType?: SessionVisitorType;
  sessionsFromVisitor?: number;
  channel?: string | null;
  region?: string | null;
  city?: string | null;
  activities?: SessionActivity[];
}

export type FeedbackStatus = "New" | "Reviewed" | "Archived";

/** Admin feedback inbox row (ANALYTICS-006). Contact emails are admin-only. */
export interface AdminFeedbackItem {
  id: string;
  type: string;
  status: FeedbackStatus;
  details: string;
  pageUrl: string;
  additionalKeywords: string | null;
  userEmail: string | null;
  contactEmail: string | null;
  userAgent: string | null;
  sessionId: string | null;
  createdAt: string;
}

export interface AdminFeedbackListResponse {
  items: AdminFeedbackItem[];
  totalCount: number;
  page: number;
  pageSize: number;
  newCount: number;
}

export interface AdminFeedbackQuery {
  page?: number;
  pageSize?: number;
  type?: string;
  status?: string;
  from?: string;
  to?: string;
  search?: string;
}

export interface ConversionFunnelStep {
  eventName: string;
  sessions: number;
  events: number;
  /** Null for the first step or when the previous step had no sessions. */
  conversionFromPreviousPercent: number | null;
  conversionFromFirstPercent: number | null;
}

export interface ConversionFunnelResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  sessionsWithEvents: number;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  steps: ConversionFunnelStep[];
}

export interface LearningScopeResponse {
  mode: string;
  contextType: string | null;
  contextId: string | null;
  runsStarted: number;
  /** Null for flashcards, which have no completion. */
  runsCompleted: number | null;
  completionRatePercent: number | null;
  averageScorePercent: number | null;
  averageItemsReached: number;
}

export interface LearningDropOffPointResponse {
  position: number;
  runsReached: number;
  sharePercent: number;
  runsAbandonedHere: number;
}

export interface LearningReportResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  scopes: LearningScopeResponse[];
  quizRunsAbandonedBeforeFirstAnswer: number;
  quizDropOff: LearningDropOffPointResponse[];
}

export interface ContentRowResponse {
  key: string;
  name: string | null;
  sessions: number;
  studySessions: number;
  itemSteps: number;
  ratingsCount: number;
  averageStars: number | null;
  comments: number;
  bookmarks: number | null;
  shares: number | null;
  completions: number | null;
  averageScorePercent: number | null;
}

export interface ContentFeaturedRowResponse {
  id: string;
  type: string;
  displayName: string;
  sessionsSeen: number;
  sessionsOpened: number;
  clickThroughPercent: number | null;
}

export interface ContentUntouchedResponse {
  key: string;
  name: string;
}

export interface ContentUserCreatedWeekResponse {
  weekStartUtc: string;
  privateItems: number;
  publicItems: number;
  collections: number;
}

export interface ContentReportResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  categories: ContentRowResponse[];
  navigationSets: ContentRowResponse[];
  collections: ContentRowResponse[];
  featured: ContentFeaturedRowResponse[];
  untouchedCategories: ContentUntouchedResponse[];
  untouchedCollections: ContentUntouchedResponse[];
  userCreated: ContentUserCreatedWeekResponse[];
}

export interface QuestionQualityItemResponse {
  itemId: string;
  question: string;
  correctAnswer: string;
  category: string | null;
  collections: string[];
  answers: number;
  correctRatePercent: number;
  randomGuessPercent: number;
  checkAnswerKey: boolean;
  lastEditedUtc: string | null;
  questionImage?: ItemImageReference | null;
}

export interface QuestionQualityReportResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  minAnswers: number;
  botSessions: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  items: QuestionQualityItemResponse[];
}

export interface LifecycleCohortResponse {
  weekStartUtc: string;
  signups: number;
  activated7Days: number;
  activatedEligible: number;
  activeWeek1: number;
  eligibleWeek1: number;
  activeWeek2: number;
  eligibleWeek2: number;
  activeWeek4: number;
  eligibleWeek4: number;
}

export interface LifecycleSourceResponse {
  channel: string;
  campaign: string | null;
  signups: number;
  activated7Days: number;
  activatedEligible: number;
  activeWeek1: number;
  eligibleWeek1: number;
}

export interface LifecycleReportResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  totalSignups: number;
  cohorts: LifecycleCohortResponse[];
  sources: LifecycleSourceResponse[];
}

export type AdminUserSortBy =
  | "lastActive"
  | "sessions"
  | "studySessions"
  | "collections"
  | "items"
  | "ratings"
  | "comments"
  | "channel"
  | "registered";

export type AdminUserActivityFilter =
  | "all"
  | "with-activity"
  | "without-activity"
  | "dormant";

export interface AdminUsersSummaryResponse {
  activityWindowStartUtc: string;
  activityWindowEndUtc: string;
  totalRegisteredUsers: number;
  filteredUsers: number;
  usersWithActivityInWindow: number;
  usersWithoutActivityInWindow: number;
  internalUsers: number;
  internalSessions: number;
  internalExcluded: boolean;
}

export interface AdminUserOverviewResponse {
  id: string;
  name?: string | null;
  email?: string | null;
  createdAt: string;
  lastLogin: string;
  uniqueUrlsInWindow: number;
  totalPageViewsInWindow: number;
  lastOpenedUtc?: string | null;
  lastKnownCountry?: string | null;
  isInternal: boolean;
  sessionsInWindow: number;
  studySessionsInWindow: number;
  collectionsCreated: number;
  itemsCreated: number;
  ratings: number;
  comments: number;
  signupChannel: string;
}

export interface AdminUsersResponse {
  summary: AdminUsersSummaryResponse;
  users: AdminUserOverviewResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminUserActivitySummaryResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  totalViews: number;
  uniqueUrls: number;
  lastOpenedUtc?: string | null;
  internalSessions: number;
  internalExcluded: boolean;
}

export interface AdminUserUrlHistoryResponse {
  url: string;
  path: string;
  queryString: string;
  openCount: number;
  firstOpenedUtc: string;
  lastOpenedUtc: string;
}

export interface AdminUserDetailResponse {
  id: string;
  name?: string | null;
  email?: string | null;
  createdAt: string;
  lastLogin: string;
  isInternal: boolean;
}

export interface AdminUserActivityResponse {
  user: AdminUserDetailResponse;
  summary: AdminUserActivitySummaryResponse;
  urlHistory: AdminUserUrlHistoryResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AdminUserSettingsResponse {
  settings: Record<string, string>;
}

export interface AdminUserSettingUpdateResponse {
  key: string;
  value: string;
  updatedAt: string;
}

export interface SeedSyncRequest {
  schemaVersion: number;
  repositoryOwner: string;
  repositoryName: string;
  gitRef: string;
  deltaPreviewLimit?: number;
  sinceCommitSha?: string | null;
  fileOffset?: number;
  fileBatchSize?: number;
}

export interface LocalSeedSyncRequest {
  deltaPreviewLimit?: number;
}

export interface SeedSyncChangeResponse {
  itemId: string;
  action: string;
  category: string;
  navigationKeyword1: string;
  navigationKeyword2: string;
  question: string;
  changedFields: string[];
}

export interface SeedSyncPreviewResponse {
  repositoryOwner: string;
  repositoryName: string;
  gitRef: string;
  resolvedCommitSha: string;
  itemsPath: string;
  sourceFileCount: number;
  collectionsPath: string;
  collectionSourceFileCount: number;
  seedSet: string;
  totalItemsInPayload: number;
  existingItemCount: number;
  affectedItemCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  totalCollectionsInPayload: number;
  existingCollectionCount: number;
  affectedCollectionCount: number;
  collectionCreatedCount: number;
  collectionUpdatedCount: number;
  collectionDeletedCount: number;
  collectionUnchangedCount: number;
  totalFiles: number;
  processedFiles: number;
  nextFileOffset: number;
  isComplete: boolean;
  durationMs: number;
  hasMoreChanges: boolean;
  changes: SeedSyncChangeResponse[];
}

export interface SeedSyncApplyResponse {
  repositoryOwner: string;
  repositoryName: string;
  gitRef: string;
  resolvedCommitSha: string;
  itemsPath: string;
  sourceFileCount: number;
  collectionsPath: string;
  collectionSourceFileCount: number;
  seedSet: string;
  totalItemsInPayload: number;
  existingItemCount: number;
  affectedItemCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  totalCollectionsInPayload: number;
  existingCollectionCount: number;
  affectedCollectionCount: number;
  collectionCreatedCount: number;
  collectionUpdatedCount: number;
  collectionDeletedCount: number;
  collectionUnchangedCount: number;
  totalFiles: number;
  processedFiles: number;
  nextFileOffset: number;
  isComplete: boolean;
  durationMs: number;
  historyRunId?: string | null;
  historyRecordedUtc?: string | null;
  hasMoreChanges: boolean;
  changes: SeedSyncChangeResponse[];
}

export interface SeedSyncHistoryItemResponse {
  itemId: string;
  action: string;
  category: string;
  navigationKeyword1: string;
  navigationKeyword2: string;
  question: string;
  changedFields: string[];
}

export interface SeedSyncHistoryRunResponse {
  runId: string;
  createdUtc: string;
  triggeredByUserId?: string | null;
  repositoryOwner: string;
  repositoryName: string;
  gitRef: string;
  resolvedCommitSha: string;
  itemsPath: string;
  seedSet: string;
  sourceFileCount: number;
  totalItemsInPayload: number;
  existingItemCount: number;
  affectedItemCount: number;
  createdCount: number;
  updatedCount: number;
  deletedCount: number;
  unchangedCount: number;
  hasMoreChanges: boolean;
  changes: SeedSyncHistoryItemResponse[];
}

export interface SeedSyncHistoryResponse {
  runs: SeedSyncHistoryRunResponse[];
}

export interface ClientErrorValueCount {
  value: string;
  count: number;
}

export interface ClientErrorGroup {
  fingerprint: string;
  errorName: string;
  message: string;
  source: "boundary" | "window" | "promise" | string;
  count: number;
  sessions: number;
  firstSeenUtc: string;
  lastSeenUtc: string;
  /** First report ever (within retention) falls inside the window. */
  isNew: boolean;
  latestAppVersion: string | null;
  topPaths: ClientErrorValueCount[];
  browsers: ClientErrorValueCount[];
  devices: ClientErrorValueCount[];
  sampleStack: string | null;
  sampleComponentStack: string | null;
  sampleSessionId: string;
}

export interface ClientErrorsResponse {
  windowStartUtc: string;
  windowEndUtc: string;
  totalReports: number;
  totalGroups: number;
  newGroups: number;
  botReports: number;
  botsExcluded: boolean;
  internalSessions: number;
  internalExcluded: boolean;
  truncated: boolean;
  appVersions: string[];
  groups: ClientErrorGroup[];
}

export const adminApi = {
  getImageReviewQueue: async (
    state: ImageReviewQueueState = "PendingReview",
    page: number = 1,
    pageSize: number = 25
  ): Promise<ImageReviewQueueResponse> => {
    const response = await apiClient.get<ImageReviewQueueResponse>(
      "/admin/items/image-review",
      { params: { state, page, pageSize } }
    );
    return response.data;
  },

  setImageReview: async (
    id: string,
    request: SetImageReviewRequest
  ): Promise<{ id: string; imageReview: ImageReviewQueueReview }> => {
    const response = await apiClient.put<{ id: string; imageReview: ImageReviewQueueReview }>(
      `/admin/items/${id}/image-review`,
      request
    );
    return response.data;
  },

  setImageReviewBulk: async (request: BulkImageReviewRequest): Promise<BulkImageReviewResponse> => {
    const response = await apiClient.post<BulkImageReviewResponse>("/admin/items/image-review/bulk", request);
    return response.data;
  },

  /** Fetches an uploaded picture with the admin bearer token (an <img> tag cannot send it). */
  fetchItemImageBlob: async (id: string, slot: "question" | "explanation", expectedRevision: number): Promise<Blob> => {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision <= 0) throw new Error("Picture revision unavailable");
    const response = await apiClient.get<Blob>(`/items/${id}/images/${slot}`, {
      responseType: "blob", params: { expectedRevision },
    });
    return response.data;
  },

  getReviewBoardItems: async (): Promise<ReviewBoardResponse> => {
    const response = await apiClient.get<ReviewBoardResponse>(
      "/admin/items/review-board"
    );
    return response.data;
  },

  approveItem: async (id: string): Promise<ReviewBoardItemResponse> => {
    const response = await apiClient.put<ReviewBoardItemResponse>(
      `/admin/items/${id}/approval`
    );
    return response.data;
  },

  rejectItem: async (
    id: string,
    reason?: string
  ): Promise<ReviewBoardItemResponse> => {
    const response = await apiClient.put<ReviewBoardItemResponse>(
      `/admin/items/${id}/rejection`,
      { reason }
    );
    return response.data;
  },

  getDatabaseSize: async (): Promise<DatabaseSizeResponse> => {
    const response = await apiClient.get<DatabaseSizeResponse>(
      "/admin/database/size"
    );
    return response.data;
  },

  getAuditLogs: async (
    actionTypes?: string[],
    userEmail?: string,
    page: number = 1,
    pageSize: number = 50
  ): Promise<AuditLogsResponse> => {
    const params: Record<string, string | number> = {
      page,
      pageSize,
    };
    if (actionTypes && actionTypes.length > 0) {
      params.actionTypes = actionTypes.join(",");
    }
    if (userEmail && userEmail.trim().length > 0) {
      params.userEmail = userEmail.trim();
    }
    const response = await apiClient.get<AuditLogsResponse>(
      "/admin/audit-logs",
      { params }
    );
    return response.data;
  },

  getPageViewAnalytics: async (
    days: number = 7,
    visitorType: PageViewVisitorType = "all",
    pathContains?: string,
    page: number = 1,
    pageSize: number = 25,
    topPagesLimit: number = 10,
    includeBots: boolean = false,
    includeInternal: boolean = false
  ): Promise<PageViewAnalyticsResponse> => {
    const params: Record<string, string | number | boolean> = {
      days,
      visitorType,
      page,
      pageSize,
      topPagesLimit,
      includeBots,
    };
    if (pathContains && pathContains.trim().length > 0) {
      params.pathContains = pathContains.trim();
    }
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<PageViewAnalyticsResponse>(
      "/admin/page-view-analytics",
      { params }
    );
    return response.data;
  },

  getPageViewSessions: async (
    days: number = 7,
    outcome: SessionOutcomeFilter = "all",
    minPages?: number,
    includeBots: boolean = false,
    sortBy: SessionSortBy = "recent",
    page: number = 1,
    pageSize: number = 25,
    landingPagesLimit: number = 10,
    includeInternal: boolean = false,
    userId?: string,
    sessionId?: string,
    visitorId?: string
  ): Promise<PageViewSessionsResponse> => {
    const params: Record<string, string | number | boolean> = {
      days,
      outcome,
      includeBots,
      sortBy,
      page,
      pageSize,
      landingPagesLimit,
    };
    if (minPages && minPages > 1) {
      params.minPages = minPages;
    }
    if (userId) {
      params.userId = userId;
    }
    if (sessionId) {
      params.sessionId = sessionId;
    }
    if (visitorId) {
      params.visitorId = visitorId;
    }
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<PageViewSessionsResponse>(
      "/admin/page-view-sessions",
      { params }
    );
    return response.data;
  },

  getPageViewRollups: async (days: number = 365): Promise<PageViewRollupsResponse> => {
    const response = await apiClient.get<PageViewRollupsResponse>(
      "/admin/page-view-rollups",
      { params: { days } }
    );
    return response.data;
  },

  getAnalyticsOverview: async (days: 7 | 30 | 90 = 7): Promise<AnalyticsOverviewResponse> => {
    const response = await apiClient.get<AnalyticsOverviewResponse>(
      "/admin/analytics/overview",
      { params: { days } }
    );
    return response.data;
  },

  getPageViewSessionDetail: async (
    sessionId: string,
    includeInternal: boolean = false
  ): Promise<PageViewSessionDetailResponse> => {
    const url = `/admin/page-view-sessions/${encodeURIComponent(sessionId)}`;
    const response = includeInternal
      ? await apiClient.get<PageViewSessionDetailResponse>(url, {
          params: { includeInternal: true },
        })
      : await apiClient.get<PageViewSessionDetailResponse>(url);
    return response.data;
  },

  getAdminFeedback: async (
    query: AdminFeedbackQuery = {}
  ): Promise<AdminFeedbackListResponse> => {
    const params = Object.fromEntries(
      Object.entries(query).filter(([, value]) => value !== undefined && value !== "")
    );
    const response = await apiClient.get<AdminFeedbackListResponse>("/admin/feedback", { params });
    return response.data;
  },

  updateFeedbackStatus: async (
    id: string,
    status: FeedbackStatus
  ): Promise<AdminFeedbackItem> => {
    const response = await apiClient.put<AdminFeedbackItem>(
      `/admin/feedback/${encodeURIComponent(id)}/status`,
      { status }
    );
    return response.data;
  },

  getClientErrors: async (
    days: number = 7,
    appVersion: string = "",
    includeBots: boolean = false,
    includeInternal: boolean = false
  ): Promise<ClientErrorsResponse> => {
    const params: Record<string, number | boolean | string> = { days };
    if (appVersion) {
      params.appVersion = appVersion;
    }
    if (includeBots) {
      params.includeBots = true;
    }
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<ClientErrorsResponse>("/admin/client-errors", { params });
    return response.data;
  },

  getConversionFunnel: async (
    days: number = 7,
    includeBots: boolean = false,
    includeInternal: boolean = false
  ): Promise<ConversionFunnelResponse> => {
    const params: Record<string, number | boolean> = { days, includeBots };
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<ConversionFunnelResponse>(
      "/admin/analytics/funnel",
      { params }
    );
    return response.data;
  },

  getAcquisitionReport: async (
    days: number = 7,
    includeBots: boolean = false,
    includeInternal: boolean = false,
    deviceClass?: string,
    country?: string
  ): Promise<AcquisitionReportResponse> => {
    const params: Record<string, number | boolean | string> = { days, includeBots };
    if (includeInternal) {
      params.includeInternal = true;
    }
    if (deviceClass) {
      params.deviceClass = deviceClass;
    }
    if (country) {
      params.country = country;
    }

    const response = await apiClient.get<AcquisitionReportResponse>(
      "/admin/analytics/acquisition",
      { params }
    );
    return response.data;
  },

  getLearningReport: async (
    days: number = 7,
    includeBots: boolean = false,
    includeInternal: boolean = false,
    channel?: string,
    visitorType?: string
  ): Promise<LearningReportResponse> => {
    const params: Record<string, number | boolean | string> = { days, includeBots };
    if (includeInternal) {
      params.includeInternal = true;
    }
    if (channel) {
      params.channel = channel;
    }
    if (visitorType) {
      params.visitorType = visitorType;
    }

    const response = await apiClient.get<LearningReportResponse>(
      "/admin/analytics/learning",
      { params }
    );
    return response.data;
  },

  getContentReport: async (
    days: number = 30,
    includeBots: boolean = false,
    includeInternal: boolean = false
  ): Promise<ContentReportResponse> => {
    const params: Record<string, number | boolean> = { days, includeBots };
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<ContentReportResponse>(
      "/admin/analytics/content",
      { params }
    );
    return response.data;
  },

  getQuestionQualityReport: async (
    days: number = 30,
    minAnswers: number = 10,
    includeBots: boolean = false,
    includeInternal: boolean = false
  ): Promise<QuestionQualityReportResponse> => {
    const params: Record<string, number | boolean> = { days, minAnswers, includeBots };
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<QuestionQualityReportResponse>(
      "/admin/analytics/question-quality",
      { params }
    );
    return response.data;
  },

  getLifecycleReport: async (weeks: number = 12): Promise<LifecycleReportResponse> => {
    const response = await apiClient.get<LifecycleReportResponse>(
      "/admin/analytics/lifecycle",
      { params: { weeks } }
    );
    return response.data;
  },

  getUsers: async (
    search?: string,
    activityDays: number = 30,
    activityFilter: AdminUserActivityFilter = "all",
    page: number = 1,
    pageSize: number = 25,
    includeInternal: boolean = false,
    sortBy: AdminUserSortBy = "lastActive",
    sortDir: "asc" | "desc" = "desc"
  ): Promise<AdminUsersResponse> => {
    const params: Record<string, string | number | boolean> = {
      activityDays,
      activityFilter,
      page,
      pageSize,
      sortBy,
      sortDir,
    };
    if (search && search.trim().length > 0) {
      params.search = search.trim();
    }
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<AdminUsersResponse>("/admin/users", {
      params,
    });
    return response.data;
  },

  getUserActivity: async (
    userId: string,
    days: number = 30,
    urlContains?: string,
    page: number = 1,
    pageSize: number = 25,
    includeInternal: boolean = false
  ): Promise<AdminUserActivityResponse> => {
    const params: Record<string, string | number | boolean> = {
      days,
      page,
      pageSize,
    };
    if (urlContains && urlContains.trim().length > 0) {
      params.urlContains = urlContains.trim();
    }
    if (includeInternal) {
      params.includeInternal = true;
    }

    const response = await apiClient.get<AdminUserActivityResponse>(
      `/admin/users/${userId}/page-view-history`,
      { params }
    );
    return response.data;
  },

  setUserInternal: async (
    userId: string,
    isInternal: boolean
  ): Promise<{ id: string; isInternal: boolean }> => {
    const response = await apiClient.put<{ id: string; isInternal: boolean }>(
      `/admin/users/${userId}/internal`,
      { isInternal }
    );
    return response.data;
  },

  getUserSettings: async (
    userId: string
  ): Promise<AdminUserSettingsResponse> => {
    const response = await apiClient.get<AdminUserSettingsResponse>(
      `/admin/users/${userId}/settings`
    );
    return response.data;
  },

  updateUserSetting: async (
    userId: string,
    key: string,
    value: string
  ): Promise<AdminUserSettingUpdateResponse> => {
    const response = await apiClient.put<AdminUserSettingUpdateResponse>(
      `/admin/users/${userId}/settings`,
      { key, value }
    );
    return response.data;
  },

  getCategoryKeywords: async (
    category?: string | null,
    rank?: number | null
  ): Promise<CategoryKeywordsAdminResponse> => {
    const params: Record<string, string | number> = {};
    if (category) params.category = category;
    if (rank != null) params.rank = rank;
    const response = await apiClient.get<CategoryKeywordsAdminResponse>(
      "/admin/keywords",
      { params }
    );
    return response.data;
  },

  updateCategoryKeyword: async (
    id: string,
    data: UpdateCategoryKeywordRequest
  ): Promise<CategoryKeywordAdminResponse> => {
    const response = await apiClient.put<CategoryKeywordAdminResponse>(
      `/admin/category-keywords/${id}`,
      data
    );
    return response.data;
  },

  createCategoryKeyword: async (
    data: CreateCategoryKeywordRequest
  ): Promise<CategoryKeywordAdminResponse> => {
    const response = await apiClient.post<CategoryKeywordAdminResponse>(
      "/admin/category-keywords",
      data
    );
    return response.data;
  },

  deleteCategoryKeyword: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/category-keywords/${id}`);
  },

  getAvailableKeywordsForCategory: async (
    categoryId: string
  ): Promise<AvailableKeywordsResponse> => {
    const response = await apiClient.get<AvailableKeywordsResponse>(
      `/admin/categories/${categoryId}/keywords-available`
    );
    return response.data;
  },

  createKeyword: async (name: string): Promise<KeywordOption> => {
    const response = await apiClient.post<{ id: string; name: string; slug: string | null }>(
      "/admin/keywords",
      { name }
    );
    return { id: response.data.id, name: response.data.name };
  },

  updateKeyword: async (id: string, name: string): Promise<KeywordOption> => {
    const response = await apiClient.put<{ id: string; name: string; slug: string | null }>(
      `/admin/keywords/${id}`,
      { name }
    );
    return { id: response.data.id, name: response.data.name };
  },

  updateCategory: async (
    id: string,
    data: UpdateCategoryRequest
  ): Promise<UpdateCategoryResponse> => {
    const response = await apiClient.put<UpdateCategoryResponse>(
      `/admin/categories/${id}`,
      data
    );
    return response.data;
  },

  createCategory: async (
    data: CreateCategoryRequest
  ): Promise<CreateCategoryResponse> => {
    const response = await apiClient.post<CreateCategoryResponse>(
      "/admin/categories",
      data
    );
    return response.data;
  },

  deleteCategory: async (id: string): Promise<void> => {
    await apiClient.delete(`/admin/categories/${id}`);
  },

  getPendingKeywords: async (): Promise<PendingKeywordsResponse> => {
    const response = await apiClient.get<PendingKeywordsResponse>(
      "/admin/keywords/pending"
    );
    return response.data;
  },

  approveKeyword: async (id: string): Promise<KeywordReviewResponse> => {
    const response = await apiClient.post<KeywordReviewResponse>(
      `/admin/keywords/${id}/approve`
    );
    return response.data;
  },

  rejectKeyword: async (id: string): Promise<KeywordReviewResponse> => {
    const response = await apiClient.post<KeywordReviewResponse>(
      `/admin/keywords/${id}/reject`
    );
    return response.data;
  },

  previewSeedSync: async (
    data: SeedSyncRequest
  ): Promise<SeedSyncPreviewResponse> => {
    const response = await apiClient.post<SeedSyncPreviewResponse>(
      "/admin/seed-sync/preview",
      data
    );
    return response.data;
  },

  applySeedSync: async (
    data: SeedSyncRequest
  ): Promise<SeedSyncApplyResponse> => {
    const response = await apiClient.post<SeedSyncApplyResponse>(
      "/admin/seed-sync/apply",
      data
    );
    return response.data;
  },

  previewLocalSeedSync: async (
    data: LocalSeedSyncRequest
  ): Promise<SeedSyncPreviewResponse> => {
    const response = await apiClient.post<SeedSyncPreviewResponse>(
      "/admin/seed-sync/local/preview",
      data
    );
    return response.data;
  },

  applyLocalSeedSync: async (
    data: LocalSeedSyncRequest
  ): Promise<SeedSyncApplyResponse> => {
    const response = await apiClient.post<SeedSyncApplyResponse>(
      "/admin/seed-sync/local/apply",
      data
    );
    return response.data;
  },

  getSeedSyncHistory: async (
    take: number = 5,
    changesPerRun: number = 10
  ): Promise<SeedSyncHistoryResponse> => {
    const response = await apiClient.get<SeedSyncHistoryResponse>(
      "/admin/seed-sync/history",
      {
        params: { take, changesPerRun },
      }
    );
    return response.data;
  },
};

export interface CreateCategoryRequest {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
}

export interface CreateCategoryResponse {
  id: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
}

export interface UpdateCategoryRequest {
  name: string;
  description?: string | null;
  shortDescription?: string | null;
}

export interface UpdateCategoryResponse {
  id: string;
  name: string;
  description?: string | null;
  shortDescription?: string | null;
}

export interface CategoryKeywordAdminResponse {
  id: string;
  categoryId: string;
  categoryName: string;
  keywordId: string;
  keywordName: string;
  navigationRank: number | null;
  parentName: string | null;
  sortRank: number;
  description?: string | null;
}

export interface CreateCategoryKeywordRequest {
  categoryId: string;
  parentKeywordId?: string | null;
  childKeywordId: string;
  sortRank?: number;
  description?: string | null;
}

export interface KeywordOption {
  id: string;
  name: string;
}

export interface AvailableKeywordsResponse {
  keywords: KeywordOption[];
}

export interface CategoryKeywordsAdminResponse {
  keywords: CategoryKeywordAdminResponse[];
}

export interface UpdateCategoryKeywordRequest {
  parentKeywordId?: string | null;
  sortRank?: number | null;
  description?: string | null;
}
