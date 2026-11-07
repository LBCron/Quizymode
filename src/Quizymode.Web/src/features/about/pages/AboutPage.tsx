import { SEO } from "@/components/SEO";
import { USER_GUIDE_URL } from "@/utils/userGuideLink";

const AboutPage = () => {
  return (
    <>
      <SEO
        title="About Quizymode"
        description="QuizyMode is a place to study, review, and quiz yourself using public question banks and personal collections."
        canonical="https://www.quizymode.com/about"
      />
      <div className="mx-auto max-w-2xl px-2 py-4 sm:px-4">
        <h1 className="mb-4 text-2xl font-bold text-slate-900">
          About QuizyMode
        </h1>

        {/* Markdown content from docs/about.md */}
        <div
          className="max-w-none text-sm text-slate-600
            [&_h2]:mt-5 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-slate-800
            [&_p]:my-2 [&_p]:leading-relaxed
            [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5
            [&_li]:my-0.5
            [&_strong]:font-semibold [&_strong]:text-slate-700"
          dangerouslySetInnerHTML={{ __html: __ABOUT_HTML__ }}
        />

        <p className="mt-6 text-sm text-slate-600">
          New to Quizymode?{" "}
          <a
            href={USER_GUIDE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-ink underline underline-offset-2 hover:text-indigo-ink"
          >
            Open the User Guide
          </a>{" "}
          for a desktop or mobile walkthrough with a built-in view switcher.
        </p>

        <p className="mt-4 text-sm text-slate-600">
          Read more about the story behind Quizymode:{" "}
          <a
            href="https://medium.com/@yanis.krumins/quizymode-today-a-study-app-a-content-tool-and-a-useful-engineering-sandbox-f7aeb25e6683"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-indigo-ink underline underline-offset-2 hover:text-indigo-ink"
          >
            Quizymode today — a study app, a content tool, and a useful engineering sandbox
          </a>
        </p>

        <p className="mt-2 text-xs text-slate-400">
          Version {__APP_VERSION__} &middot; Build {__BUILD_LABEL__} &middot; Deployed{" "}
          {new Date(`${__BUILD_TIME__}T00:00:00`).toLocaleDateString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </p>
      </div>
    </>
  );
};

export default AboutPage;
