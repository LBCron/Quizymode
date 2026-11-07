#!/usr/bin/env node

import fs from "fs";
import path from "path";
import {
  gatherAvailableScreenshots,
  getDescription,
  label,
  projectRoot,
  resolveGuideConfig,
  sections,
} from "./generate-user-guide.js";
import { readCaptureReport, screenshotRoot, shotStatus } from "./user-guide-capture-report.js";

function parseArgs(argv) {
  const options = {
    baseUrl:
      process.env.USER_GUIDE_BASE_URL ??
      process.env.PLAYWRIGHT_BASE_URL ??
      "https://www.quizymode.com/",
    outputDir:
      process.env.USER_GUIDE_SITE_OUTPUT_DIR ??
      path.join(projectRoot, ".artifacts", "user-guide-pages"),
    deployedBuildVersion:
      process.env.USER_GUIDE_DEPLOYED_BUILD_VERSION ?? "",
    generatedAt:
      process.env.USER_GUIDE_GENERATED_AT ?? new Date().toISOString(),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--base-url" && argv[index + 1]) {
      options.baseUrl = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--output-dir" && argv[index + 1]) {
      options.outputDir = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--deployed-build-version" && argv[index + 1]) {
      options.deployedBuildVersion = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--generated-at" && argv[index + 1]) {
      options.generatedAt = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
      continue;
    }

    if (arg.startsWith("--output-dir=")) {
      options.outputDir = arg.slice("--output-dir=".length);
      continue;
    }

    if (arg.startsWith("--deployed-build-version=")) {
      options.deployedBuildVersion = arg.slice("--deployed-build-version=".length);
      continue;
    }

    if (arg.startsWith("--generated-at=")) {
      options.generatedAt = arg.slice("--generated-at=".length);
    }
  }

  return {
    ...options,
    outputDir: path.resolve(options.outputDir),
    baseUrl: options.baseUrl.endsWith("/") ? options.baseUrl : `${options.baseUrl}/`,
  };
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function emptyDir(dirPath) {
  fs.rmSync(dirPath, { recursive: true, force: true });
  ensureDir(dirPath);
}

function copyPngs(sourceDir, targetDir) {
  ensureDir(targetDir);

  if (!fs.existsSync(sourceDir)) {
    return [];
  }

  const files = fs
    .readdirSync(sourceDir)
    .filter((file) => file.endsWith(".png"))
    .sort();

  for (const file of files) {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
  }

  return files;
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderInlineMarkup(value) {
  return escapeHtml(value)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
    .replace(/(^|[\s(])((https?:\/\/)[^\s<)"]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
}

function toAnchor(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildManifest(report) {
  const desktopConfig = resolveGuideConfig("desktop");
  const mobileConfig = resolveGuideConfig("mobile");
  const desktopShots = gatherAvailableScreenshots(desktopConfig.screenshotDir);
  const mobileShots = gatherAvailableScreenshots(mobileConfig.screenshotDir);
  const failed = (viewport, slug) => shotStatus(report, viewport, slug) === "failed";

  return sections
    .map((section) => ({
      title: section.title,
      anchor: toAnchor(section.title),
      steps: section.slugs
        // A step stays in the guide when it has an image or a failed shot, so the "unavailable" card can show.
        .filter((slug) =>
          desktopShots.has(slug) || mobileShots.has(slug) || failed("desktop", slug) || failed("mobile", slug)
        )
        .map((slug) => ({
          slug,
          title: label(slug),
          descriptions: {
            desktop: getDescription("desktop", slug),
            mobile: getDescription("mobile", slug),
          },
          images: {
            desktop: desktopShots.has(slug) ? `assets/desktop/${desktopShots.get(slug)}` : "",
            mobile: mobileShots.has(slug) ? `assets/mobile/${mobileShots.get(slug)}` : "",
          },
          failed: {
            desktop: failed("desktop", slug),
            mobile: failed("mobile", slug),
          },
        })),
    }))
    .filter((section) => section.steps.length > 0);
}

function buildHeaderMeta(options) {
  const url = escapeHtml(options.baseUrl);
  const meta = [
    `Source site: <a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`,
    `Generated: ${escapeHtml(new Date(options.generatedAt).toLocaleString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }))}`,
  ];

  if (options.deployedBuildVersion) {
    meta.push(`Live build: ${escapeHtml(options.deployedBuildVersion)}`);
  }

  return meta;
}

function buildIndexHtml(manifest, options) {
  const headerMeta = buildHeaderMeta(options)
    .map((item) => `<li>${item}</li>`)
    .join("\n");
  const toc = manifest
    .map(
      (section) =>
        `<li><a href="#${section.anchor}">${escapeHtml(section.title)}</a></li>`
    )
    .join("\n");

  const sectionsHtml = manifest
    .map((section) => {
      const stepsHtml = section.steps
        .map((step) => {
          const initialSrc = step.images.desktop || step.images.mobile;
          const initialDescription =
            step.descriptions.desktop || step.descriptions.mobile || "";

          return `
            <article class="guide-step" id="${escapeHtml(step.slug)}">
              <header class="guide-step__header">
                <span class="guide-step__step-number" data-step></span>
                <h3>${escapeHtml(step.title)}</h3>
                <p
                  class="guide-step__description"
                  data-desktop-description="${escapeHtml(step.descriptions.desktop)}"
                  data-mobile-description="${escapeHtml(step.descriptions.mobile)}"
                >
                  ${renderInlineMarkup(initialDescription)}
                </p>
              </header>
              <figure class="guide-step__figure">
                <img
                  alt="${escapeHtml(step.title)} screenshot"
                  class="guide-step__image"
                  data-desktop-failed="${step.failed.desktop ? "true" : "false"}"
                  data-desktop-src="${escapeHtml(step.images.desktop)}"
                  data-mobile-failed="${step.failed.mobile ? "true" : "false"}"
                  data-mobile-src="${escapeHtml(step.images.mobile)}"
                  loading="lazy"
                  src="${escapeHtml(initialSrc)}"
                />
                <p class="guide-step__unavailable" hidden>Screenshot unavailable in this build</p>
                <figcaption class="guide-step__meta">
                  <span class="guide-step__slug">${escapeHtml(step.slug)}</span>
                  <span class="guide-step__availability" hidden></span>
                </figcaption>
              </figure>
            </article>
          `.trim();
        })
        .join("\n");

      return `
        <section class="guide-section" id="${section.anchor}" aria-labelledby="${section.anchor}-title">
          <div class="guide-section__heading">
            <h2 id="${section.anchor}-title">${escapeHtml(section.title)}</h2>
          </div>
          <div class="guide-step-grid">
            ${stepsHtml}
          </div>
        </section>
      `.trim();
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content="Quizymode user guide with a switchable desktop and mobile walkthrough sourced from the live production site." />
    <title>Quizymode User Guide</title>
    <link rel="stylesheet" href="assets/site.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="page-header">
        <div class="page-header__copy">
          <p class="eyebrow">Quizymode User Guide</p>
          <h1>Learn, quiz, and organise — all in one place</h1>
          <p class="app-intro">
            Quizymode is a study and quiz application for learning from structured question banks. Browse items by subject area and topic, practise with flashcards or multiple-choice quizzes, and organise content into personal or shared collections. Items can be created manually, imported in bulk, or generated with AI assistance — all anchored to a subject-area taxonomy that keeps study sessions focused.
          </p>
          <p class="lede">
            This guide walks through every major feature available to signed-in users. Screenshots are captured automatically from the live production site after each deployment. Use the Desktop / Mobile switch to compare the same scenario at each viewport.
          </p>
        </div>
        <div class="page-header__controls">
          <div class="mode-switch" role="group" aria-label="Guide viewport mode">
            <button type="button" class="mode-switch__button" data-mode="desktop">Desktop</button>
            <button type="button" class="mode-switch__button" data-mode="mobile">Mobile</button>
          </div>
          <p class="mode-switch__status" aria-live="polite">
            Showing <strong id="current-mode-label">Desktop</strong> screenshots
          </p>
          <ul class="guide-meta">
            ${headerMeta}
          </ul>
        </div>
      </header>

      <nav class="toc" aria-label="Guide sections">
        <h2>Sections</h2>
        <ul>
          ${toc}
        </ul>
      </nav>

      <main class="guide-content">
        ${sectionsHtml}
      </main>
    </div>

    <script src="assets/site.js"></script>
  </body>
</html>`;
}

const siteCss = `:root {
  --bg: #f1f5f9;
  --panel: #ffffff;
  --panel-strong: #f8fafc;
  --text: #0f172a;
  --muted: #64748b;
  --accent: #4f46e5;
  --accent-soft: rgba(79, 70, 229, 0.08);
  --line: rgba(100, 116, 139, 0.18);
  --shadow: 0 2px 16px rgba(15, 23, 42, 0.07);
  --radius: 16px;
}

* {
  box-sizing: border-box;
}

[hidden] {
  display: none !important;
}

html {
  scroll-behavior: smooth;
}

body {
  margin: 0;
  font-family: "Segoe UI", system-ui, -apple-system, sans-serif;
  color: var(--text);
  background: linear-gradient(160deg, #eff6ff 0%, #f1f5f9 55%, #eef2ff 100%);
  min-height: 100vh;
}

a {
  color: inherit;
}

.guide-step__description a,
.guide-meta a {
  color: var(--accent);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

.guide-step__description a:hover,
.guide-meta a:hover {
  opacity: 0.75;
}

.page-shell {
  width: min(1200px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0 56px;
}

.page-header,
.toc,
.guide-section {
  background: var(--panel);
  border: 1px solid var(--line);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.page-header {
  display: grid;
  gap: 32px;
  grid-template-columns: 1.4fr 1fr;
  padding: 32px;
}

.eyebrow {
  margin: 0 0 10px;
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--accent);
}

.page-header h1,
.toc h2,
.guide-section h2,
.guide-step h3 {
  margin: 0;
  line-height: 1.1;
}

.page-header h1 {
  font-size: clamp(1.6rem, 2.6vw, 2.4rem);
  color: var(--text);
}

.app-intro {
  margin: 14px 0 0;
  font-size: 0.97rem;
  line-height: 1.7;
  color: var(--text);
}

.lede {
  margin: 12px 0 0;
  color: var(--muted);
  font-size: 0.92rem;
  line-height: 1.65;
}

.page-header__controls {
  display: grid;
  gap: 14px;
  align-content: start;
  padding-top: 4px;
}

.mode-switch {
  display: inline-flex;
  width: fit-content;
  padding: 4px;
  border-radius: 999px;
  background: var(--accent-soft);
  border: 1px solid rgba(79, 70, 229, 0.2);
}

.mode-switch__button {
  border: 0;
  background: transparent;
  border-radius: 999px;
  color: var(--muted);
  cursor: pointer;
  font: inherit;
  font-weight: 600;
  font-size: 0.9rem;
  padding: 8px 16px;
  transition: background 0.15s, color 0.15s;
}

.mode-switch__button[aria-pressed="true"] {
  background: var(--accent);
  color: #fff;
}

.mode-switch__status,
.guide-meta,
.guide-step__description,
.guide-step__meta {
  color: var(--muted);
}

.mode-switch__status,
.guide-meta {
  margin: 0;
  font-size: 0.88rem;
}

.guide-meta {
  padding-left: 16px;
  display: grid;
  gap: 4px;
}

.toc {
  margin-top: 16px;
  padding: 16px 24px;
}

.toc h2 {
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.toc ul {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 10px 0 0;
  padding: 0;
}

.toc a {
  text-decoration: none;
  font-weight: 600;
  font-size: 0.9rem;
  color: var(--accent);
}

.toc a:hover {
  text-decoration: underline;
}

.guide-content {
  display: grid;
  gap: 16px;
  margin-top: 16px;
  counter-reset: guide-step;
}

.guide-section {
  padding: 24px;
}

.guide-section__heading {
  margin-bottom: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--line);
}

.guide-section h2 {
  font-size: clamp(1.1rem, 1.6vw, 1.4rem);
  color: var(--text);
}

.guide-step-grid {
  display: grid;
  gap: 16px;
}

.guide-step {
  display: grid;
  gap: 12px;
  padding: 16px;
  border-radius: 12px;
  background: var(--panel-strong);
  border: 1px solid var(--line);
  counter-increment: guide-step;
}

.guide-step__header {
  display: grid;
  gap: 2px;
}

.guide-step__step-number {
  font-size: 0.7rem;
  font-weight: 700;
  letter-spacing: 0.1em;
  color: var(--accent);
  text-transform: uppercase;
}

.guide-step h3 {
  font-size: 1.05rem;
  color: var(--text);
}

.guide-step__description {
  margin: 6px 0 0;
  line-height: 1.65;
  font-size: 0.92rem;
}

.guide-step__figure {
  margin: 0;
}

.guide-step__image {
  display: block;
  width: 100%;
  height: auto;
  border-radius: 10px;
  border: 1px solid var(--line);
  background: #fff;
}

.guide-step__meta {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 0.82rem;
}

.guide-step__slug {
  font-family: Consolas, "Courier New", monospace;
  color: var(--muted);
}

.guide-step__availability:not([hidden]) {
  color: var(--accent);
  font-weight: 600;
}

.guide-step__unavailable {
  margin: 0;
  padding: 36px 16px;
  border: 1px dashed var(--line);
  border-radius: 10px;
  background: #fff;
  color: var(--muted);
  font-size: 0.92rem;
  text-align: center;
}

@media (min-width: 900px) {
  .guide-step-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 899px) {
  .page-header {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .page-shell {
    width: min(100% - 20px, 1200px);
    padding-top: 20px;
  }

  .page-header,
  .guide-section,
  .toc {
    padding: 16px;
  }

  .mode-switch {
    width: 100%;
  }

  .mode-switch__button {
    flex: 1;
    text-align: center;
  }

  .guide-step {
    padding: 12px;
  }

  .guide-step__meta {
    flex-direction: column;
  }
}`;

const siteJs = `(() => {
  const storageKey = "quizymode-user-guide-mode";
  const modeButtons = Array.from(document.querySelectorAll("[data-mode]"));
  const modeLabel = document.getElementById("current-mode-label");
  const mobileQuery = window.matchMedia("(max-width: 767px)");
  const articles = Array.from(document.querySelectorAll(".guide-step"));

  function renderInlineMarkup(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;")
      .replace(/\\*\\*(.+?)\\*\\*/g, "<strong>$1</strong>")
      .replace(/\\[([^\\]]+)\\]\\((https?:\\/\\/[^)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
      .replace(/(^|[\\s(])((https?:\\/\\/)[^\\s<)"]+)/g, '$1<a href="$2" target="_blank" rel="noopener noreferrer">$2</a>');
  }

  function getPreferredMode() {
    const stored = window.localStorage.getItem(storageKey);
    if (stored === "desktop" || stored === "mobile") {
      return stored;
    }

    return mobileQuery.matches ? "mobile" : "desktop";
  }

  function setMode(mode, persist) {
    document.documentElement.dataset.mode = mode;

    if (modeLabel) {
      modeLabel.textContent = mode === "mobile" ? "Mobile" : "Desktop";
    }

    for (const button of modeButtons) {
      button.setAttribute(
        "aria-pressed",
        button.dataset.mode === mode ? "true" : "false"
      );
    }

    for (const article of articles) {
      const image = article.querySelector(".guide-step__image");
      const description = article.querySelector(".guide-step__description");
      const availability = article.querySelector(".guide-step__availability");

      if (!image || !description || !availability) {
        continue;
      }

      const preferredSrc =
        mode === "mobile"
          ? image.dataset.mobileSrc || image.dataset.desktopSrc || ""
          : image.dataset.desktopSrc || image.dataset.mobileSrc || "";
      const fallbackUsed =
        mode === "mobile"
          ? !image.dataset.mobileSrc && Boolean(image.dataset.desktopSrc)
          : !image.dataset.desktopSrc && Boolean(image.dataset.mobileSrc);
      const preferredDescription =
        mode === "mobile"
          ? description.dataset.mobileDescription || description.dataset.desktopDescription || ""
          : description.dataset.desktopDescription || description.dataset.mobileDescription || "";

      // A failed shot in this viewport shows the card, not the other viewport's image (AC 7.1.7).
      const ownFailed =
        mode === "mobile" ? image.dataset.mobileFailed === "true" : image.dataset.desktopFailed === "true";
      const showCard = ownFailed || !preferredSrc;
      const unavailable = article.querySelector(".guide-step__unavailable");

      image.hidden = showCard;
      if (showCard) {
        image.removeAttribute("src");
      } else {
        image.src = preferredSrc;
      }
      if (unavailable) {
        unavailable.hidden = !showCard;
      }
      description.innerHTML = renderInlineMarkup(preferredDescription);

      if (fallbackUsed && !showCard) {
        availability.hidden = false;
        availability.textContent =
          mode === "mobile"
            ? "Showing desktop image until a mobile capture is available"
            : "Showing mobile image until a desktop capture is available";
      } else {
        availability.hidden = true;
        availability.textContent = "";
      }
    }

    if (persist) {
      window.localStorage.setItem(storageKey, mode);
    }
  }

  for (const button of modeButtons) {
    button.addEventListener("click", () => {
      const nextMode = button.dataset.mode === "mobile" ? "mobile" : "desktop";
      setMode(nextMode, true);
    });
  }

  setMode(getPreferredMode(), false);

  // Number steps sequentially across all sections
  const stepNumbers = Array.from(document.querySelectorAll("[data-step]"));
  stepNumbers.forEach((el, index) => {
    const n = index + 1;
    el.textContent = n < 10 ? "0" + n + "." : n + ".";
  });
})();`;

function writeSiteFiles(outputDir, manifest, options) {
  const assetsDir = path.join(outputDir, "assets");
  ensureDir(assetsDir);

  fs.writeFileSync(path.join(outputDir, "index.html"), buildIndexHtml(manifest, options), "utf8");
  fs.writeFileSync(path.join(assetsDir, "site.css"), siteCss, "utf8");
  fs.writeFileSync(path.join(assetsDir, "site.js"), siteJs, "utf8");
  fs.writeFileSync(path.join(outputDir, ".nojekyll"), "", "utf8");
}

const options = parseArgs(process.argv.slice(2));
const manifest = buildManifest(readCaptureReport(screenshotRoot()));

if (manifest.length === 0) {
  console.error("No user-guide screenshots were found. Capture screenshots before building the site.");
  process.exit(1);
}

emptyDir(options.outputDir);

const desktopConfig = resolveGuideConfig("desktop");
const mobileConfig = resolveGuideConfig("mobile");
copyPngs(desktopConfig.screenshotDir, path.join(options.outputDir, "assets", "desktop"));
copyPngs(mobileConfig.screenshotDir, path.join(options.outputDir, "assets", "mobile"));
writeSiteFiles(options.outputDir, manifest, options);

console.log(`User guide site written to ${options.outputDir}`);
