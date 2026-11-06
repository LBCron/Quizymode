import { Helmet } from "react-helmet-async";

interface SEOProps {
  title?: string;
  description?: string;
  canonical?: string;
  ogImage?: string;
  ogImageAlt?: string;
  ogType?: string;
  noindex?: boolean;
  structuredData?: object;
}

const DEFAULT_TITLE = "Quizymode – Smart Flashcards & Learning Quizzes";
const DEFAULT_DESCRIPTION =
  "Quizymode is a smart learning platform with flashcards and quizzes for exams, AWS, Spanish, and more.";
const DEFAULT_URL = "https://www.quizymode.com";
// Link-preview crawlers do not render SVG, so the shared default must be a raster image.
export const DEFAULT_OG_IMAGE = "https://www.quizymode.com/og-card.png";
const DEFAULT_OG_IMAGE_WIDTH = 1200;
const DEFAULT_OG_IMAGE_HEIGHT = 630;
const DEFAULT_OG_IMAGE_ALT = "Quizymode – Smart Flashcards & Learning Quizzes";

export const SEO = ({
  title,
  description,
  canonical,
  ogImage,
  ogImageAlt,
  ogType = "website",
  noindex = false,
  structuredData,
}: SEOProps) => {
  const pageTitle = title
    ? `${title} | Quizymode`
    : DEFAULT_TITLE;
  const pageDescription = description || DEFAULT_DESCRIPTION;
  const pageUrl = canonical || DEFAULT_URL;
  const imageUrl = ogImage || DEFAULT_OG_IMAGE;
  const isDefaultImage = imageUrl === DEFAULT_OG_IMAGE;
  const imageAlt = ogImageAlt || DEFAULT_OG_IMAGE_ALT;

  return (
    <Helmet>
      {/* Primary Meta Tags */}
      <title>{pageTitle}</title>
      <meta name="title" content={pageTitle} />
      <meta name="description" content={pageDescription} />
      <link rel="canonical" href={pageUrl} key="canonical" />
      {noindex && <meta name="robots" content="noindex, nofollow" />}

      {/* Open Graph / Facebook */}
      <meta property="og:type" content={ogType} />
      <meta property="og:url" content={pageUrl} />
      <meta property="og:site_name" content="Quizymode" />
      <meta property="og:title" content={pageTitle} />
      <meta property="og:description" content={pageDescription} />
      <meta property="og:image" content={imageUrl} />
      {isDefaultImage && <meta property="og:image:type" content="image/png" />}
      {isDefaultImage && (
        <meta property="og:image:width" content={String(DEFAULT_OG_IMAGE_WIDTH)} />
      )}
      {isDefaultImage && (
        <meta property="og:image:height" content={String(DEFAULT_OG_IMAGE_HEIGHT)} />
      )}
      <meta property="og:image:alt" content={imageAlt} />

      {/* Twitter */}
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:url" content={pageUrl} />
      <meta name="twitter:title" content={pageTitle} />
      <meta name="twitter:description" content={pageDescription} />
      <meta name="twitter:image" content={imageUrl} />
      <meta name="twitter:image:alt" content={imageAlt} />

      {/* Structured Data */}
      {structuredData && (
        <script type="application/ld+json">
          {JSON.stringify(structuredData)}
        </script>
      )}
    </Helmet>
  );
};
