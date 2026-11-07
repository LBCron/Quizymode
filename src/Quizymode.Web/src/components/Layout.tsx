import type { ReactNode } from "react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { TopicEditorProvider } from "@/features/interests/TopicEditorProvider";
import { TOPIC_RETURN_FOCUS_ATTRIBUTE } from "@/features/interests/TopicPicker";
import { GuestProgressClaim } from "@/features/guestHistory/GuestProgressClaim";
import { PolicyAcceptancePrompt } from "@/features/legal/PolicyAcceptancePrompt";
import { usersApi } from "@/api/users";
import LlmFindingsBanner from "@/components/LlmFindingsBanner";
import { getUserGuideUrl } from "@/utils/userGuideLink";
import { SEO } from "@/components/SEO";
import FeedbackDialog from "@/features/feedback/components/FeedbackDialog";
import GlobalSearch from "@/features/search/GlobalSearch";
import UserProfileModal from "./UserProfileModal";
import { useApplyTheme } from "@/theme/useApplyTheme";
import { Bars3Icon, XMarkIcon } from "@heroicons/react/24/outline";

interface LayoutProps {
  children: ReactNode;
}

function getFallbackTitle(pathname: string): string | undefined {
  if (pathname === "/") {
    return "Quizymode";
  }

  if (pathname === "/login") {
    return "Sign In";
  }

  if (pathname === "/signup") {
    return "Sign Up";
  }

  if (pathname === "/categories" || pathname.startsWith("/categories/")) {
    return "Categories";
  }

  if (pathname === "/featured") {
    return "Featured";
  }

  if (pathname === "/collections" || pathname.startsWith("/collections/")) {
    return "Collections";
  }

  if (pathname.startsWith("/explore/collections/")) {
    return "Explore Collection";
  }

  if (pathname === "/explore" || pathname.startsWith("/explore/")) {
    return "Explore";
  }

  if (pathname.startsWith("/quiz/collections/")) {
    return "Quiz Collection";
  }

  if (pathname === "/quiz" || pathname.startsWith("/quiz/")) {
    return "Quiz";
  }

  if (pathname === "/items") {
    return "Items";
  }

  if (pathname === "/create") {
    return "Create";
  }

  if (pathname === "/create/notes") {
    return "Turn notes into a quiz";
  }

  if (pathname === "/create/question" || pathname === "/items/create" || pathname === "/add-new-item") {
    return "Add Items";
  }

  if (pathname === "/create/import") {
    return "Import Questions";
  }

  if (pathname === "/items/upload") {
    return "Upload to Collection";
  }

  if (pathname.endsWith("/edit")) {
    return "Edit Item";
  }

  if (pathname.includes("/comments")) {
    return "Item Comments";
  }

  if (pathname.startsWith("/items/")) {
    return "Item Details";
  }

  if (pathname === "/search") {
    return "Search";
  }

  if (pathname === "/study-guides/documents" || pathname.startsWith("/study-guides/documents/")) {
    return "My Study Guides";
  }

  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    return "Admin";
  }

  if (pathname === "/about") {
    return "About";
  }

  if (pathname === "/ideas") {
    return "Ideas";
  }

  if (pathname === "/roadmap") {
    return "Roadmap";
  }

  if (pathname === "/feedback") {
    return "Feedback";
  }

  if (pathname === "/privacy" || pathname === "/privacy-policy") {
    return "Privacy Policy";
  }

  if (pathname === "/terms" || pathname === "/terms-of-service") {
    return "Terms of Service";
  }

  return undefined;
}

const LayoutContent = ({ children }: LayoutProps) => {
  const { isAuthenticated, logout, username, email, isAdmin } = useAuth();
  useApplyTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showFeedbackDialog, setShowFeedbackDialog] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userGuideUrl = getUserGuideUrl(window.navigator.userAgent);

  // Fetch user data when authenticated to get full profile info
  const { data: user } = useQuery({
    queryKey: ["currentUser"],
    queryFn: () => usersApi.getCurrent(),
    enabled: isAuthenticated, // Fetch when authenticated
    retry: false, // Don't retry on 401 errors
    // Silently handle 401 errors - they're expected if token is expired
    // The interceptor will handle redirects for protected routes
  });

  const handleLogout = async () => {
    await logout();
    navigate("/");
  };

  // Use user data from API if available, otherwise fall back to AuthContext values
  const displayName = user?.name || user?.email || username || email || "User";
  const headerDisplayName = displayName.slice(0, 10);
  const userIsAdmin = user?.isAdmin ?? isAdmin;
  const role = userIsAdmin ? "Admin" : "User";

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  const fallbackTitle = getFallbackTitle(location.pathname);

  const isHomePage = location.pathname === "/";
  /** Pages that render their own full-bleed dark container (no white wrapper from Layout). */
  const isFullBleedPage =
    isHomePage ||
    location.pathname === "/categories" ||
    location.pathname === "/collections" ||
    location.pathname === "/featured" ||
    location.pathname === "/create" ||
    location.pathname === "/ideas";

  const isPathActive = (basePath: string) => {
    const path = location.pathname;
    if (path === basePath) return true;
    if (path.startsWith(`${basePath}/`)) return true;
    // Create covers its sub-pages plus the legacy create/study guide routes. /items/* legacy paths match
    // exactly so /items and item detail pages do not light up Create.
    if (basePath === "/create") {
      return (
        path === "/items/add" ||
        path === "/items/create" ||
        path === "/items/bulk-create" ||
        path === "/items/upload" ||
        path === "/add-new-item" ||
        path.startsWith("/study-guides/")
      );
    }
    // Treat explore/quiz collection routes as part of Collections
    if (
      basePath === "/collections" &&
      (path.startsWith("/explore/collections/") || path.startsWith("/quiz/collections/"))
    ) {
      return true;
    }
    return false;
  };

  const desktopNavLinkClass = (active: boolean) =>
    `inline-flex items-center px-1 pt-1 text-sm font-medium ${
      active ? "text-indigo-ink" : "text-gray-900 hover:text-indigo-ink"
    }`;

  const mobileNavLinkClass = (active: boolean) =>
    `block px-3 py-2 text-base font-medium ${
      active ? "text-indigo-ink bg-gray-50" : "text-gray-900 hover:text-indigo-ink hover:bg-gray-50"
    }`;

  return (
    <div className="flex min-h-screen flex-col bg-[radial-gradient(circle_at_top,var(--qm-shell-a)_0%,var(--qm-shell-b)_34%,var(--qm-shell-c)_100%)] print:bg-none print:bg-surface">
      {fallbackTitle && <SEO title={fallbackTitle} noindex={location.pathname === "/login" || location.pathname === "/signup"} />}
      <nav className="relative z-40 border-b border-slate-200/70 bg-surface/95 shadow-sm backdrop-blur print:hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-14">
            <div className="flex">
              <Link
                to="/"
                className={`flex items-center px-2 py-2 text-xl font-bold text-indigo-ink hover:text-indigo-ink border-b-2 -mb-px ${
                  isPathActive("/") ? "border-indigo-600" : "border-transparent"
                }`}
                onClick={closeMobileMenu}
                aria-current={isPathActive("/") ? "page" : undefined}
              >
                Quizymode
              </Link>
              <div className="hidden lg:ml-6 lg:flex lg:space-x-5 xl:space-x-8">
                <Link
                  to="/categories"
                  className={desktopNavLinkClass(isPathActive("/categories"))}
                >
                  Categories
                </Link>
                <Link
                  to="/featured"
                  className={desktopNavLinkClass(isPathActive("/featured"))}
                >
                  Featured
                </Link>
                <Link
                  to="/collections"
                  className={desktopNavLinkClass(isPathActive("/collections"))}
                >
                  Collections
                </Link>
                {isAuthenticated && (
                  <>
                    <Link
                      to="/create"
                      className={desktopNavLinkClass(isPathActive("/create"))}
                    >
                      Create
                    </Link>
                    <Link
                      to="/progress"
                      className={desktopNavLinkClass(isPathActive("/progress"))}
                    >
                      My Progress
                    </Link>
                    {userIsAdmin && (
                      <Link
                        to="/admin"
                        className={desktopNavLinkClass(isPathActive("/admin"))}
                      >
                        Admin
                      </Link>
                    )}
                  </>
                )}
              </div>
            </div>
            <div className="flex items-center">
              {/* Search: inline input at xl, icon + full-screen overlay below xl */}
              <GlobalSearch onOpen={closeMobileMenu} />

              {/* Mobile menu button */}
              <button
                type="button"
                {...{ [TOPIC_RETURN_FOCUS_ATTRIBUTE]: "" }}
                className="lg:hidden inline-flex items-center justify-center p-1.5 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-indigo-500"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                aria-expanded={mobileMenuOpen}
              >
                <span className="sr-only">Open main menu</span>
                {mobileMenuOpen ? (
                  <XMarkIcon className="block h-6 w-6" aria-hidden="true" />
                ) : (
                  <Bars3Icon className="block h-6 w-6" aria-hidden="true" />
                )}
              </button>

              {/* Desktop menu */}
              <div className="hidden lg:flex lg:items-center lg:gap-3">
                {isAuthenticated ? (
                  <div className="flex items-center space-x-4">
                    <button
                      {...{ [TOPIC_RETURN_FOCUS_ATTRIBUTE]: "" }}
                      onClick={() => setShowProfileModal(true)}
                      className="max-w-[12rem] text-right hover:bg-gray-50 px-2 py-1 rounded-md transition-colors"
                    >
                      <div className="truncate text-sm font-medium text-gray-900">
                        {headerDisplayName}
                      </div>
                      <div className="text-xs text-gray-500">{role}</div>
                    </button>
                    <button
                      onClick={handleLogout}
                      className="ml-4 px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <>
                    <Link
                      to="/login"
                      className="ml-4 px-4 py-2 text-sm font-medium text-gray-700 bg-surface border border-gray-300 rounded-md hover:bg-gray-50"
                    >
                      Sign In
                    </Link>
                    <Link
                      to="/signup"
                      className="ml-4 px-4 py-2 text-sm font-medium text-white bg-indigo-600 rounded-md hover:bg-indigo-700"
                    >
                      Sign Up
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden">
            <div className="pt-2 pb-3 space-y-1">
              <Link
                to="/categories"
                className={mobileNavLinkClass(isPathActive("/categories"))}
                onClick={closeMobileMenu}
              >
                Categories
              </Link>
              <Link
                to="/featured"
                className={mobileNavLinkClass(isPathActive("/featured"))}
                onClick={closeMobileMenu}
              >
                Featured
              </Link>
              <Link
                to="/collections"
                className={mobileNavLinkClass(isPathActive("/collections"))}
                onClick={closeMobileMenu}
              >
                Collections
              </Link>
              {isAuthenticated && (
                <>
                  <Link
                    to="/create"
                    className={mobileNavLinkClass(isPathActive("/create"))}
                    onClick={closeMobileMenu}
                  >
                    Create
                  </Link>
                  <Link
                    to="/progress"
                    className={mobileNavLinkClass(isPathActive("/progress"))}
                    onClick={closeMobileMenu}
                  >
                    My Progress
                  </Link>
                  {userIsAdmin && (
                    <Link
                      to="/admin"
                      className={mobileNavLinkClass(isPathActive("/admin"))}
                      onClick={closeMobileMenu}
                    >
                      Admin
                    </Link>
                  )}
                </>
              )}
            </div>
            <div className="pt-4 pb-3 border-t border-gray-200">
              {isAuthenticated ? (
                <>
                  <div className="px-4 mb-3">
                    <div className="text-base font-medium text-gray-900">
                      {headerDisplayName}
                    </div>
                    <div className="text-sm text-gray-500">{role}</div>
                  </div>
                  <div className="space-y-1">
                    <button
                      onClick={() => {
                        setShowProfileModal(true);
                        closeMobileMenu();
                      }}
                      className="block w-full text-left px-4 py-2 text-base font-medium text-gray-900 hover:text-indigo-ink hover:bg-gray-50"
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => {
                        handleLogout();
                        closeMobileMenu();
                      }}
                      className="block w-full text-left px-4 py-2 text-base font-medium text-gray-900 hover:text-indigo-ink hover:bg-gray-50"
                    >
                      Sign Out
                    </button>
                  </div>
                </>
              ) : (
                <div className="space-y-1">
                  <Link
                    to="/login"
                    className="block px-4 py-2 text-base font-medium text-gray-900 hover:text-indigo-ink hover:bg-gray-50"
                    onClick={closeMobileMenu}
                  >
                    Sign In
                  </Link>
                  <Link
                    to="/signup"
                    className="block px-4 py-2 text-base font-medium text-white bg-indigo-600 hover:bg-indigo-700 mx-3 rounded-md text-center"
                    onClick={closeMobileMenu}
                  >
                    Sign Up
                  </Link>
                </div>
              )}
            </div>
          </div>
        )}
      </nav>
      <div className="print:hidden">
        <GuestProgressClaim />
        <PolicyAcceptancePrompt />
        <LlmFindingsBanner isAdmin={isAuthenticated && userIsAdmin} />
      </div>
      <main
        className={
          isFullBleedPage
            ? "flex-1 py-0"
            : "mx-auto flex-1 w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8"
        }
      >
        {isFullBleedPage ? (
          children
        ) : (
          <div className="rounded-[32px] border border-white/45 bg-[linear-gradient(180deg,var(--qm-stage-a)_0%,var(--qm-stage-b)_100%)] p-2 text-gray-900 shadow-2xl shadow-slate-950/20 backdrop-blur sm:p-6 lg:p-8 print:rounded-none print:border-0 print:bg-none print:bg-surface print:p-0 print:shadow-none">
            {children}
          </div>
        )}
      </main>
      <footer className="mx-auto w-full max-w-7xl px-3 pb-3 pt-1 sm:px-6 lg:px-8 print:hidden">
        <div className="rounded-[20px] border border-on-panel/10 bg-panel/80 px-3 py-2.5 text-on-panel shadow-xl shadow-slate-950/20 backdrop-blur sm:flex sm:items-center sm:justify-between sm:gap-4">
          <div className="hidden sm:block shrink-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-on-panel-muted">
              Browse, Support &amp; Legal
            </div>
          </div>

          <div className="grid grid-cols-3 gap-1.5 sm:flex sm:flex-wrap sm:gap-2">
            <Link
              to="/about"
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              About
            </Link>
            <a
              href={userGuideUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              User Guide
            </a>
            <button
              type="button"
              onClick={() => setShowFeedbackDialog(true)}
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              Feedback
            </button>
            <Link
              to="/ideas"
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              Ideas
            </Link>
            <Link
              to="/privacy"
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              Privacy
            </Link>
            <Link
              to="/terms"
              className="inline-flex items-center justify-center rounded-md border border-on-panel/12 bg-on-panel/8 px-2.5 py-1.5 text-sm font-medium text-on-panel transition hover:border-sky-300/35 hover:bg-on-panel/12 hover:text-on-panel"
            >
              Terms
            </Link>
          </div>
        </div>
      </footer>
      <UserProfileModal
        isOpen={showProfileModal}
        onClose={() => setShowProfileModal(false)}
      />
      <FeedbackDialog
        isOpen={showFeedbackDialog}
        onClose={() => setShowFeedbackDialog(false)}
        defaultEmail={user?.email || email}
      />
    </div>
  );
};

// The My topics editor is opened from Home, the Games hub and the profile dialog, all of which Layout renders (#382).
const Layout = ({ children }: LayoutProps) => (
  <TopicEditorProvider>
    <LayoutContent>{children}</LayoutContent>
  </TopicEditorProvider>
);

export default Layout;
