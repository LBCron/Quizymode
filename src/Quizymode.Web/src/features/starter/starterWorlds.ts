import { buildGuestPracticePath } from "@/features/guestHistory/guestHistoryLinks";

/** One starter "world" (#462): the explore-next card shown on the end screen for questions from that world. */
export interface StarterWorld {
  id: string;
  label: string;
  emoji: string;
  copy: string;
  cta: string;
  /** Quiz URL (category/topic scope plus the deep-link `size`). */
  target: string;
}

function target(categorySlug: string, nav: [string, string], size: number): string {
  const base = buildGuestPracticePath({
    kind: "category",
    categorySlug,
    navigationKeywords: nav,
    filterKeywords: [],
  });
  return `${base}&size=${size}`;
}

/**
 * Mirrors the API allowlist in StarterWorlds.cs. A world the web app does not know is skipped when composing a run, so
 * a newer pool never breaks an older client. The card order is the preference order when a run has more than 3 worlds.
 */
export const STARTER_WORLDS: Record<string, StarterWorld> = {
  flags: {
    id: "flags",
    label: "Flags",
    emoji: "🚩",
    copy: "How many can you name?",
    cta: "Guess 10 more flags",
    target: target("geography", ["flags", "countries"], 10),
  },
  genai: {
    id: "genai",
    label: "Gen AI",
    emoji: "🤖",
    copy: "How AI chatbots actually work.",
    cta: "Explore 5 AI questions",
    target: target("tech", ["ai-ml", "llms"], 5),
  },
  space: {
    id: "space",
    label: "Space",
    emoji: "🪐",
    copy: "Planets, moons and the Sun.",
    cta: "Explore 5 space questions",
    target: target("science", ["astronomy", "solar-system"], 5),
  },
  animals: {
    id: "animals",
    label: "Animals",
    emoji: "🐙",
    copy: "Weird and wonderful creatures.",
    cta: "Meet 5 odd animals",
    target: target("trivia", ["animals", "weird"], 5),
  },
  food: {
    id: "food",
    label: "Food",
    emoji: "🍜",
    copy: "What is in your kitchen?",
    cta: "Taste 5 food facts",
    target: target("trivia", ["food-drink", "ingredients"], 5),
  },
  time: {
    id: "time",
    label: "History",
    emoji: "⏳",
    copy: "Ancient history, short and surprising.",
    cta: "Time-travel in 5",
    target: target("history", ["ancient", "egypt"], 5),
  },
  body: {
    id: "body",
    label: "Body",
    emoji: "🫀",
    copy: "Your heart, in five questions.",
    cta: "Explore the body",
    target: target("science", ["anatomy", "cardio"], 5),
  },
  places: {
    id: "places",
    label: "Places",
    emoji: "🌍",
    copy: "Tiny countries and big surprises.",
    cta: "Explore 5 places",
    target: target("geography", ["countries", "smallest"], 5),
  },
};

export function getStarterWorld(id: string): StarterWorld | undefined {
  return Object.prototype.hasOwnProperty.call(STARTER_WORLDS, id) ? STARTER_WORLDS[id] : undefined;
}
