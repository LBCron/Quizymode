// API Response Types

export interface CategoryResponse {
  category: string;
  description: string | null;
  shortDescription: string | null;
  count: number;
  id: string;
  isPrivate: boolean;
  averageStars: number | null;
}

export interface CategoriesResponse {
  categories: CategoryResponse[];
}

/** Navigation keyword (rank-1/rank-2) with aggregates from GET /keywords */
export interface NavKeywordResponse {
  name: string;
  itemCount: number;
  averageRating: number | null;
  navigationRank: number;
  description?: string | null;
  /** When > 0, show a "Private" badge (e.g. yellow) on the keyword set. */
  privateItemCount?: number;
}

export interface KeywordsResponse {
  keywords: NavKeywordResponse[];
}

export interface KeywordResponse {
  id: string;
  name: string;
  isPrivate: boolean;
}

/** Curated question picture (#407): key resolved by the web build into a bundled image, plus alt text. */
export interface ItemImageReference {
  revision?: number;
  longDescription?: string | null;
  key: string;
  altText: string;
  /** Credit line for an uploaded picture (#400), when the author supplied one. */
  attribution?: string | null;
}

export type ImageReviewState = "PendingReview" | "Approved" | "Rejected" | "Withdrawn" | "Processing" | "Failed";

/** Picture review state of an item (AC 3.25.2, 3.26.5); returned to the creator and admins only. */
export interface ItemImageReviewInfo {
  state: ImageReviewState;
  revision: number;
  /** Why the pictures were rejected; only while state is Rejected. */
  reason?: string | null;
}

export interface ItemSpeechSupport {
  pronunciation?: string | null;
  languageCode?: string | null;
}

export interface ItemCollectionResponse {
  id: string;
  name: string;
  createdAt: string;
}

export interface ItemResponse {
  id: string;
  category: string;
  isPrivate: boolean;
  question: string;
  questionSpeech?: ItemSpeechSupport | null;
  correctAnswer: string;
  correctAnswerSpeech?: ItemSpeechSupport | null;
  incorrectAnswers: string[];
  incorrectAnswerSpeech?: Record<number, ItemSpeechSupport> | null;
  /** Optional short "why wrong" text per incorrect answer index, max 200 chars (#367). */
  incorrectAnswerRationale?: Record<number, string> | null;
  explanation: string;
  createdAt: string;
  createdBy?: string | null;
  keywords: KeywordResponse[];
  collections: ItemCollectionResponse[];
  source?: string | null;
  /** Optional short group label (max 30) used by Sort It. */
  groupLabel?: string | null;
  /** Curated question picture (#407); set by seed sync only. */
  questionImage?: ItemImageReference | null;
  /** Curated explanation picture (#403), shown only after the answer is revealed; set by seed sync only. */
  explanationImage?: ItemImageReference | null;
  /** Navigation path for breadcrumbs, e.g. [rank1, rank2] or ["other"]. Use "other" in URLs; display as "Others". */
  navigationBreadcrumb?: string[];
  /** Picture review state (#401); present for the creator and admins only. */
  imageReview?: ItemImageReviewInfo | null;
}

export interface ItemsResponse {
  items: ItemResponse[];
  totalCount: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface RandomItemsResponse {
  items: ItemResponse[];
}

/** One requested scope of GET /games/roster; "empty" means no eligible item was returned for it. */
export interface GameRosterScope {
  scope: string;
  available: number;
  returned: number;
  status: "ok" | "empty";
  /** Visible picture questions in this scope that no game can use (#403). */
  excludedPictures?: number;
}

export interface GameRosterResponse {
  items: ItemResponse[];
  scopes: GameRosterScope[];
}

export interface CollectionResponse {
  id: string;
  name: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  itemCount: number;
  /** Anyone with the link can view (AC 1.4). */
  isPublic?: boolean;
  /** Listed in Discover; only meaningful when isPublic (AC 1.9). */
  isDiscoverable?: boolean;
}

export interface CollectionsResponse {
  collections: CollectionResponse[];
}

/** Discover (public) collections - item includes bookmark state */
export interface CollectionDiscoverItem {
  id: string;
  name: string;
  description?: string | null;
  createdBy: string;
  createdAt: string;
  itemCount: number;
  isBookmarked: boolean;
}

export interface DiscoverCollectionsResponse {
  items: CollectionDiscoverItem[];
  totalCount: number;
}

export interface BookmarkItem {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  itemCount: number;
}

/** Collection rating: stats and current user's rating */
export interface CollectionRatingResponse {
  count: number;
  averageStars: number | null;
  myStars: number | null;
}

/** User who bookmarked a collection (owner view) */
export interface CollectionBookmarkerItem {
  userId: string;
  name: string | null;
  bookmarkedAt: string;
}

export interface CollectionBookmarkedByResponse {
  bookmarkedBy: CollectionBookmarkerItem[];
}

export interface ReviewResponse {
  id: string;
  itemId: string;
  reaction: string;
  comment: string;
  createdBy: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ReviewsResponse {
  reviews: ReviewResponse[];
}

export interface RequestResponse {
  id: string;
  categoryId: string;
  description: string;
  createdBy: string;
  createdAt: string;
  status: string;
}

// Request Types

export interface KeywordRequest {
  name: string;
  isPrivate: boolean;
}

export interface CreateItemRequest {
  createRequestId?: string;
  questionImage?: import("@/api/media").ImageSlotInput;
  explanationImage?: import("@/api/media").ImageSlotInput;
  category: string;
  navigationKeyword1: string;
  navigationKeyword2: string;
  isPrivate: boolean;
  question: string;
  questionSpeech?: ItemSpeechSupport | null;
  correctAnswer: string;
  correctAnswerSpeech?: ItemSpeechSupport | null;
  incorrectAnswers: string[];
  incorrectAnswerSpeech?: Record<number, ItemSpeechSupport> | null;
  /** Optional short "why wrong" text per incorrect answer index, max 200 chars (#367). */
  incorrectAnswerRationale?: Record<number, string> | null;
  explanation: string;
  keywords?: KeywordRequest[];
  source?: string;
  groupLabel?: string;
  uploadId?: string | null;
  readyForReview?: boolean | null;
}

export interface UpdateItemRequest {
  expectedImageRevision?: number;
  questionImage?: import("@/api/media").ImageSlotInput;
  explanationImage?: import("@/api/media").ImageSlotInput;
  category?: string;
  navigationKeyword1?: string;
  navigationKeyword2?: string;
  isPrivate?: boolean;
  question?: string;
  questionSpeech?: ItemSpeechSupport | null;
  correctAnswer?: string;
  correctAnswerSpeech?: ItemSpeechSupport | null;
  incorrectAnswers?: string[];
  incorrectAnswerSpeech?: Record<number, ItemSpeechSupport> | null;
  incorrectAnswerRationale?: Record<number, string> | null;
  explanation?: string;
  keywords?: KeywordRequest[];
  source?: string;
  /** Omitted keeps the stored label; a blank value clears it. */
  groupLabel?: string;
  readyForReview?: boolean | null;
}

export interface CreateCollectionRequest {
  name: string;
  description?: string | null;
  isPublic?: boolean;
  isDiscoverable?: boolean;
}

export interface UpdateCollectionRequest {
  name?: string;
  description?: string | null;
  isPublic?: boolean;
  isDiscoverable?: boolean;
}

export interface AddItemToCollectionRequest {
  itemId: string;
}

export interface BulkAddItemsToCollectionRequest {
  itemIds: string[];
}

export interface BulkAddItemsToCollectionResponse {
  addedCount: number;
  skippedCount: number;
  addedItemIds: string[];
}

export interface CreateReviewRequest {
  itemId: string;
  reaction: "like" | "dislike" | "neutral";
  comment: string;
}

export interface UpdateReviewRequest {
  reaction?: "like" | "dislike" | "neutral";
  comment?: string;
}

export interface CreateRequestRequest {
  categoryId: string;
  description: string;
}

export type FeedbackType = "reportIssue" | "requestItems" | "generalFeedback";

export interface CreateFeedbackSubmissionRequest {
  type: FeedbackType;
  currentUrl: string;
  details: string;
  email?: string | null;
  additionalKeywords?: string | null;
  /** Current analytics session id so admins can see the journey behind a report. */
  sessionId?: string | null;
}

export interface FeedbackSubmissionResponse {
  id: string;
  type: FeedbackType;
  currentUrl: string;
  details: string;
  email: string | null;
  additionalKeywords: string | null;
  userId: string | null;
  createdAt: string;
}

export interface UserResponse {
  id: string;
  name: string | null;
  email: string | null;
  isAdmin: boolean;
  createdAt: string;
  lastLogin: string;
}

export interface UpdateUserNameRequest {
  name: string;
}

export interface CheckUserAvailabilityRequest {
  username?: string;
  email?: string;
}

export interface CheckUserAvailabilityResponse {
  isUsernameAvailable: boolean;
  isEmailAvailable: boolean;
  usernameError?: string | null;
  emailError?: string | null;
}
