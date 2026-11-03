import { categoryThemes, getCategoryThemeBySlug } from "@/features/categories/categoryThemes";

export const HOME_SAMPLE_COLLECTION_ID = "8f9b8c14-8d30-4d94-9b20-4c7bb7f7f511";
export const HOME_SAMPLE_COLLECTION_NAME = "Fun Trivia Facts";

export interface HomeCategoryCard {
  slug: string;
  name: string;
  description: string;
  image: string;
}

const categoryDescriptions = new Map<string, string>([
  ["exams", "Certification prep, standardized tests, and professional exam drills."],
  ["tech", "Programming, cloud, security, systems, and modern engineering topics."],
  ["business", "Finance, marketing, strategy, operations, and management frameworks."],
  ["science", "Astronomy, biology, chemistry, math, statistics, and lab skills."],
  ["history", "Ancient worlds, modern eras, wars, timelines, and major turning points."],
  ["geography", "Countries, capitals, regions, travel landmarks, and map-based study."],
  ["languages", "Spanish, French, grammar, ESL, travel phrases, and vocabulary review."],
  ["humanities", "Literature, philosophy, music, film, visual art, and culture."],
  ["civics", "Government, law, rights, institutions, citizenship, and public policy."],
  ["sports", "Rules, champions, events, teams, player roles, and competitive trivia."],
  ["nature", "Wildlife, ecosystems, camping, navigation, and survival knowledge."],
  ["trivia", "Movies, music, pop culture, brands, games, and high-energy fun facts."],
]);

/**
 * Order in which categories are shown in the home page carousel.
 * The first four are always fully visible on a full-screen desktop layout.
 * Add or reorder slugs here to change the home page category presentation.
 */
const HOME_CATEGORY_ORDER = [
  "exams",
  "languages",
  "history",
  "geography",
  "trivia",
  // remaining categories follow in their natural order
];

const allCategorySlugs = categoryThemes.map((t) => t.slug);
const orderedSlugs = [
  ...HOME_CATEGORY_ORDER,
  ...allCategorySlugs.filter((s) => !HOME_CATEGORY_ORDER.includes(s)),
];

export const homeCategoryCards: HomeCategoryCard[] = orderedSlugs
  .map((slug) => {
    const theme = getCategoryThemeBySlug(slug);
    if (!theme) return null;
    return {
      slug: theme.slug,
      name: theme.name,
      description: categoryDescriptions.get(theme.slug) ?? "",
      image: theme.image,
    };
  })
  .filter((c): c is HomeCategoryCard => c !== null);
