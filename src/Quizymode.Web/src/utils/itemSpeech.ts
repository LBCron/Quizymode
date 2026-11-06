import type { ItemSpeechSupport } from "@/types/api";

export interface SpeakableText {
  text: string;
  pronunciation?: string | null;
  languageCode?: string | null;
}

export function toSpeakableText(
  text: string,
  speech?: ItemSpeechSupport | null
): SpeakableText {
  return {
    text,
    pronunciation: speech?.pronunciation ?? null,
    languageCode: speech?.languageCode ?? null,
  };
}

export function getPronunciationHint(
  text: string,
  speech?: ItemSpeechSupport | null
): string | null {
  const normalizedText = text.trim().toLowerCase();
  const pronunciation = speech?.pronunciation?.trim();

  if (!pronunciation) {
    return null;
  }

  return pronunciation.toLowerCase() === normalizedText ? null : pronunciation;
}

export function getIndexedSpeech(
  speechByIndex?: Record<number, ItemSpeechSupport> | null,
  index?: number
): ItemSpeechSupport | null {
  if (speechByIndex == null || index == null) {
    return null;
  }

  return speechByIndex[index] ?? null;
}

export function normalizeSpeechSupportInput(
  speech?: ItemSpeechSupport | null
): ItemSpeechSupport | undefined {
  const pronunciation = speech?.pronunciation?.trim() ?? "";
  const languageCode = speech?.languageCode?.trim() ?? "";

  if (!pronunciation && !languageCode) {
    return undefined;
  }

  return {
    ...(pronunciation ? { pronunciation } : {}),
    ...(languageCode ? { languageCode } : {}),
  };
}

export function compactIncorrectAnswersWithSpeech(
  answers: string[],
  speechByIndex?: Record<number, ItemSpeechSupport> | null
): {
  incorrectAnswers: string[];
  incorrectAnswerSpeech: Record<number, ItemSpeechSupport> | undefined;
} {
  const incorrectAnswers: string[] = [];
  const speechMap: Record<number, ItemSpeechSupport> = {};

  answers.forEach((answer, originalIndex) => {
    if (answer.trim() === "") {
      return;
    }

    const newIndex = incorrectAnswers.length;
    incorrectAnswers.push(answer);

    const speech = normalizeSpeechSupportInput(speechByIndex?.[originalIndex]);
    if (speech) {
      speechMap[newIndex] = speech;
    }
  });

  return {
    incorrectAnswers,
    incorrectAnswerSpeech: Object.keys(speechMap).length > 0 ? speechMap : undefined,
  };
}

/** Max length of a per-answer rationale (#367); matches the API. */
export const INCORRECT_ANSWER_RATIONALE_MAX = 200;

/**
 * Drops blank answers and keeps each rationale attached to its answer, re-indexed the same way as
 * {@link compactIncorrectAnswersWithSpeech}. Blank rationales are dropped.
 */
/**
 * Upload JSON may key "incorrectAnswerRationale" by answer text (the shape the study-guide generator returns, #485).
 * Returns the index-keyed map for the final answer list; unmatched keys and non-string values are ignored.
 */
export function rationaleByAnswerText(raw: unknown, answers: string[]): Record<number, string> | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const result: Record<number, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value !== "string") {
      continue;
    }
    const index = answers.findIndex((answer) => answer.trim().toLowerCase() === key.trim().toLowerCase());
    if (index >= 0) {
      result[index] = value;
    }
  }
  return result;
}

export function compactIncorrectAnswerRationale(
  answers: string[],
  rationaleByIndex?: Record<number, string> | null
): Record<number, string> | undefined {
  const rationaleMap: Record<number, string> = {};
  let newIndex = 0;

  answers.forEach((answer, originalIndex) => {
    if (answer.trim() === "") {
      return;
    }

    const text = (rationaleByIndex?.[originalIndex] ?? "").trim();
    if (text !== "") {
      rationaleMap[newIndex] = text.slice(0, INCORRECT_ANSWER_RATIONALE_MAX);
    }
    newIndex += 1;
  });

  return Object.keys(rationaleMap).length > 0 ? rationaleMap : undefined;
}

/** The rationale for one answer, or undefined when it is the correct answer, not an incorrect option, or has none. */
export function getOptionRationale(
  incorrectAnswers: string[],
  rationaleByIndex: Record<number, string> | null | undefined,
  answer: string | null | undefined
): string | undefined {
  if (answer == null) {
    return undefined;
  }
  const index = incorrectAnswers.findIndex((candidate) => candidate === answer);
  return index >= 0 ? rationaleByIndex?.[index] || undefined : undefined;
}
