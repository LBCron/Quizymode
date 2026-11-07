/**
 * Import rejects pictures (#403): curated pictures are added through seed data, never through upload. A missing field
 * or JSON null is accepted (an exported file carries nulls); any other value is a problem the server would also reject.
 */
const PICTURE_FIELDS = ["questionImage", "explanationImage"] as const;
type PictureField = (typeof PICTURE_FIELDS)[number];

const FIX_HINT =
  "Only your own uploaded asset references can be imported. Curated keys, URLs, bytes and other authors' pictures cannot be imported.";

function quoted(field: PictureField): string {
  return `"${field}"`;
}

function formatItemNumbers(numbers: readonly number[]): string {
  if (numbers.length <= 3) {
    return numbers.length === 1
      ? String(numbers[0])
      : `${numbers.slice(0, -1).join(", ")} and ${numbers[numbers.length - 1]}`;
  }
  return `${numbers.slice(0, 3).join(", ")} and ${numbers.length - 3} more`;
}

/** Returns the message to show for an upload that carries pictures, or null when none is present. */
export function findPictureImportError(rows: readonly unknown[]): string | null {
  const offenders: { itemNumber: number; fields: PictureField[] }[] = [];
  rows.forEach((row, index) => {
    if (typeof row !== "object" || row === null) return;
    const record = row as Record<string, unknown>;
    const fields = PICTURE_FIELDS.filter((field) => record[field] !== undefined && record[field] !== null && !isUploadedReference(record[field]));
    if (fields.length > 0) offenders.push({ itemNumber: index + 1, fields });
  });
  if (offenders.length === 0) return null;

  if (offenders.length === 1) {
    const [{ itemNumber, fields }] = offenders;
    return `Item ${itemNumber} has ${fields.map(quoted).join(" and ")}. ${FIX_HINT}`;
  }

  const found = new Set(offenders.flatMap((offender) => offender.fields));
  const fieldText = PICTURE_FIELDS.filter((field) => found.has(field)).map(quoted).join(" or ");
  return `Items ${formatItemNumbers(offenders.map((offender) => offender.itemNumber))} have ${fieldText}. ${FIX_HINT}`;
}

function isUploadedReference(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const slot = value as Record<string, unknown>;
  return Object.keys(slot).every(key => ["assetId", "altText", "attribution", "longDescription", "remove"].includes(key)) && typeof slot.assetId === "string" && /^[0-9a-f-]{32,36}$/i.test(slot.assetId) && typeof slot.altText === "string" && slot.altText.trim().length > 0 && slot.altText.length <= 300 && !slot.remove;
}
