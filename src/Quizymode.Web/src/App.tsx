import { Routes, Route, useLocation } from "react-router-dom";
import Layout from "./components/Layout";
import HomePage from "./features/home/pages/HomePage";
import CategoriesPage from "./features/categories/pages/CategoriesPage";
import ItemsPage from "./features/items/pages/ItemsPage";
import ExploreModePage from "./features/items/pages/ExploreModePage";
import QuizModePage from "./features/items/pages/QuizModePage";
import LearnModePage from "./features/items/pages/LearnModePage";
import LoginPage from "./features/auth/pages/LoginPage";
import SignUpPage from "./features/auth/pages/SignUpPage";
import AuthCallbackPage from "./features/auth/pages/AuthCallbackPage";
import ItemDetailPage from "./features/items/pages/ItemDetailPage";
import CollectionsPage from "./features/collections/pages/CollectionsPage";
import CollectionDetailPage from "./features/collections/pages/CollectionDetailPage";
import ItemCommentsPage from "./features/items/pages/ItemCommentsPage";
import PageViewTracker from "./features/analytics/PageViewTracker";
import RequireAuthRoute from "./components/RequireAuthRoute";
import RedirectWithSearch from "./components/RedirectWithSearch";
import { LazyRoute } from "./components/LazyRoute";
import { lazyPage } from "./utils/lazyPage";
import FeaturedPage from "./features/featured/pages/FeaturedPage";
import DailyQuizPage from "./features/learningLoop/pages/DailyQuizPage";
import StarterQuizPage from "./features/starter/StarterQuizPage";

// Route-level code splitting (PERF-001): anonymous landing/study pages stay eager; admin, authoring,
// study guide, community and legal pages load on demand. Keep this list in sync with docs/AC.md.
const CreateItemPage = lazyPage(() => import("./features/items/pages/CreateItemPage"));
const AdminDashboardPage = lazyPage(() => import("./features/admin/pages/AdminDashboardPage"));
const ReviewBoardPage = lazyPage(() => import("./features/admin/pages/ReviewBoardPage"));
const DatabaseSizePage = lazyPage(() => import("./features/admin/pages/DatabaseSizePage"));
const AuditLogsPage = lazyPage(() => import("./features/admin/pages/AuditLogsPage"));
const AdminKeywordsPage = lazyPage(() => import("./features/admin/pages/AdminKeywordsPage"));
const AdminKeywordReviewPage = lazyPage(() => import("./features/admin/pages/AdminKeywordReviewPage"));
const AdminCategoriesPage = lazyPage(() => import("./features/admin/pages/AdminCategoriesPage"));
const AdminUserSettingsPage = lazyPage(() => import("./features/admin/pages/AdminUserSettingsPage"));
const AdminSeedSyncPage = lazyPage(() => import("./features/admin/pages/AdminSeedSyncPage"));
const PageViewAnalyticsPage = lazyPage(() => import("./features/admin/pages/PageViewAnalyticsPage"));
const AdminClientErrorsPage = lazyPage(() => import("./features/admin/pages/AdminClientErrorsPage"));
const CreateHubPage = lazyPage(() => import("./features/create/pages/CreateHubPage"));
const CreateImportPage = lazyPage(() => import("./features/items/pages/CreateImportPage"));
const EditItemPage = lazyPage(() => import("./features/items/pages/EditItemPage"));
const AboutPage = lazyPage(() => import("./features/about/pages/AboutPage"));
const RoadmapPage = lazyPage(() => import("./features/roadmap/pages/RoadmapPage"));
const FeedbackPage = lazyPage(() => import("./features/feedback/pages/FeedbackPage"));
const IdeasPage = lazyPage(() => import("./features/ideas/pages/IdeasPage"));
const StudyGuideUploadPage = lazyPage(() => import("./features/studyGuide/pages/StudyGuideUploadPage"));
const StudyGuideDocumentsPage = lazyPage(() => import("./features/studyGuide/pages/StudyGuideDocumentsPage"));
const StudyGuideDocumentPage = lazyPage(() => import("./features/studyGuide/pages/StudyGuideDocumentPage"));
const PrivacyPolicyPage = lazyPage(() => import("./features/legal/pages/PrivacyPolicyPage"));
const TermsOfServicePage = lazyPage(() => import("./features/legal/pages/TermsOfServicePage"));
const AdminFeedbackPage = lazyPage(() => import("./features/admin/pages/AdminFeedbackPage"));
const AdminIdeasPage = lazyPage(() => import("./features/admin/pages/AdminIdeasPage"));
const AdminFeaturedPage = lazyPage(() => import("./features/admin/pages/AdminFeaturedPage"));
const AdminAiProvidersPage = lazyPage(() => import("./features/admin/pages/AdminAiProvidersPage"));
const AdminDailyQuizPage = lazyPage(() => import("./features/admin/pages/AdminDailyQuizPage"));
const AdminImportPage = lazyPage(() => import("./features/admin/pages/AdminImportPage"));
const ReviewQueuePage = lazyPage(() => import("./features/learningLoop/pages/ReviewQueuePage"));
const ProgressPage = lazyPage(() => import("./features/progress/ProgressPage"));
const SearchPage = lazyPage(() => import("./features/search/pages/SearchPage"));
const GamesHubPage = lazyPage(() => import("./features/games/pages/GamesHubPage"));
const MatchRacePage = lazyPage(() => import("./features/games/pages/MatchRacePage"));
const SwipeBlitzPage = lazyPage(() => import("./features/games/pages/SwipeBlitzPage"));
const SurvivalPage = lazyPage(() => import("./features/games/pages/SurvivalPage"));
const BucketDropPage = lazyPage(() => import("./features/games/pages/BucketDropPage"));
const SortItPage = lazyPage(() => import("./features/games/pages/SortItPage"));

function App() {
  const location = useLocation();
  return (
    <Layout>
      <PageViewTracker />
      <LazyRoute resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route
          path="/categories/:category/:kw1/:kw2"
          element={<CategoriesPage />}
        />
        <Route path="/categories/:category/:kw1" element={<CategoriesPage />} />
        <Route path="/categories/:category" element={<CategoriesPage />} />
        <Route path="/categories" element={<CategoriesPage />} />
        <Route path="/items" element={<ItemsPage />} />
        <Route path="/explore/item/:itemId" element={<ExploreModePage />} />
        <Route
          path="/explore/:category/item/:itemId"
          element={<ExploreModePage />}
        />
        <Route
          path="/explore/collections/:collectionId/:slug/item/:itemId"
          element={<ExploreModePage />}
        />
        <Route
          path="/explore/collections/:collectionId/item/:itemId"
          element={<ExploreModePage />}
        />
        <Route
          path="/explore/collections/:collectionId/:slug"
          element={<ExploreModePage />}
        />
        <Route
          path="/explore/collections/:collectionId"
          element={<ExploreModePage />}
        />
        <Route path="/explore/:category?" element={<ExploreModePage />} />
        <Route path="/quiz/item/:itemId" element={<QuizModePage />} />
        <Route path="/quiz/:category/item/:itemId" element={<QuizModePage />} />
        <Route
          path="/quiz/collections/:collectionId/:slug/item/:itemId"
          element={<QuizModePage />}
        />
        <Route
          path="/quiz/collections/:collectionId/item/:itemId"
          element={<QuizModePage />}
        />
        <Route
          path="/quiz/collections/:collectionId/:slug"
          element={<QuizModePage />}
        />
        <Route
          path="/quiz/collections/:collectionId"
          element={<QuizModePage />}
        />
        <Route path="/quiz/:category?" element={<QuizModePage />} />
        <Route
          path="/learn/collections/:collectionId/:slug?"
          element={<LearnModePage />}
        />
        <Route path="/learn/:category?" element={<LearnModePage />} />
        <Route path="/games/collections/:collectionId/:slug?" element={<GamesHubPage />} />
        <Route path="/games/match-race/collections/:collectionId/:slug?" element={<MatchRacePage />} />
        <Route path="/games/match-race/:category?" element={<MatchRacePage />} />
        <Route path="/games/swipe-blitz/collections/:collectionId/:slug?" element={<SwipeBlitzPage />} />
        <Route path="/games/swipe-blitz/:category?" element={<SwipeBlitzPage />} />
        <Route path="/games/survival/collections/:collectionId/:slug?" element={<SurvivalPage />} />
        <Route path="/games/survival/:category?" element={<SurvivalPage />} />
        <Route path="/games/bucket-drop/collections/:collectionId/:slug?" element={<BucketDropPage />} />
        <Route path="/games/bucket-drop/:category?" element={<BucketDropPage />} />
        <Route path="/games/sort-it/collections/:collectionId/:slug?" element={<SortItPage />} />
        <Route path="/games/sort-it/:category?" element={<SortItPage />} />
        <Route path="/games/:category?" element={<GamesHubPage />} />
        <Route path="/daily" element={<DailyQuizPage />} />
        <Route path="/start" element={<StarterQuizPage />} />
        <Route path="/progress" element={<ProgressPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignUpPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />
        <Route path="/create" element={<CreateHubPage />} />
        {/* Legacy create URLs (AC 2.2.5): outside RequireAuthRoute so anonymous return-to uses the new path. */}
        <Route path="/items/add" element={<RedirectWithSearch to="/create" />} />
        <Route path="/add-new-item" element={<RedirectWithSearch to="/create/question" />} />
        <Route path="/items/create" element={<RedirectWithSearch to="/create/question" />} />
        <Route path="/study-guide/upload" element={<RedirectWithSearch to="/create/notes" />} />
        <Route path="/study-guide" element={<RedirectWithSearch to="/create/notes" />} />
        <Route path="/study-guide/import" element={<RedirectWithSearch to="/create/notes" />} />
        <Route path="/items/upload" element={<RedirectWithSearch to="/create/import" />} />
        <Route path="/items/bulk-create" element={<RedirectWithSearch to="/create/import" />} />
        <Route element={<RequireAuthRoute />}>
          <Route path="/create/notes" element={<StudyGuideUploadPage />} />
          <Route path="/create/question" element={<CreateItemPage />} />
          <Route path="/create/import" element={<CreateImportPage />} />
          <Route path="/items/:id/edit" element={<EditItemPage />} />
          <Route path="/study-guides/documents" element={<StudyGuideDocumentsPage />} />
          <Route path="/study-guides/documents/:id" element={<StudyGuideDocumentPage />} />
          <Route path="/review" element={<ReviewQueuePage />} />
        </Route>
        <Route path="/items/:id/comments" element={<ItemCommentsPage />} />
        <Route path="/items/:id" element={<ItemDetailPage />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/featured" element={<FeaturedPage />} />
        <Route path="/collections" element={<CollectionsPage />} />
        <Route path="/collections/:id/:slug" element={<CollectionDetailPage />} />
        <Route path="/collections/:id" element={<CollectionDetailPage />} />
        <Route element={<RequireAuthRoute requireAdmin />}>
          <Route path="/admin" element={<AdminDashboardPage />} />
          <Route path="/admin/review-board" element={<ReviewBoardPage />} />
          <Route path="/admin/database-size" element={<DatabaseSizePage />} />
          <Route path="/admin/audit-logs" element={<AuditLogsPage />} />
          <Route path="/admin/keywords" element={<AdminKeywordsPage />} />
          <Route path="/admin/keyword-review" element={<AdminKeywordReviewPage />} />
          <Route path="/admin/categories" element={<AdminCategoriesPage />} />
          <Route path="/admin/user-settings" element={<AdminUserSettingsPage />} />
          <Route path="/admin/seed-sync" element={<AdminSeedSyncPage />} />
          <Route path="/admin/page-views" element={<PageViewAnalyticsPage />} />
          <Route path="/admin/client-errors" element={<AdminClientErrorsPage />} />
          <Route path="/admin/feedback" element={<AdminFeedbackPage />} />
          <Route path="/admin/ideas" element={<AdminIdeasPage />} />
          <Route path="/admin/featured" element={<AdminFeaturedPage />} />
          <Route path="/admin/ai-providers" element={<AdminAiProvidersPage />} />
          <Route path="/admin/daily-quiz" element={<AdminDailyQuizPage />} />
          <Route path="/admin/import" element={<AdminImportPage />} />
        </Route>
        <Route path="/about" element={<AboutPage />} />
        <Route path="/ideas" element={<IdeasPage />} />
        <Route path="/roadmap" element={<RoadmapPage />} />
        <Route path="/feedback" element={<FeedbackPage />} />
        <Route path="/privacy" element={<PrivacyPolicyPage />} />
        <Route path="/privacy-policy" element={<PrivacyPolicyPage />} />
        <Route path="/terms" element={<TermsOfServicePage />} />
        <Route path="/terms-of-service" element={<TermsOfServicePage />} />
      </Routes>
      </LazyRoute>
    </Layout>
  );
}

export default App;
