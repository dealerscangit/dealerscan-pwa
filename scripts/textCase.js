// scripts/textCase.js
// Small text-formatting helpers used across screens.

/**
 * Title-case a customer name string for display + storage.
 *
 * Rules (with examples):
 *   "smith family" → "Smith Family"
 *   "JOHN SMITH"   → "John Smith"
 *   "mary-kate"    → "Mary-Kate"     (hyphen is a word boundary)
 *   "o'brien"      → "O'Brien"       (apostrophe is a word boundary)
 *   "  spaces  "   → "Spaces"        (trim + collapse internal whitespace)
 *   ""             → ""
 *
 * NOT smart about Mc/Mac/O' compound names — "mcdonald" becomes "Mcdonald",
 * not "McDonald". Trying to be cleverer creates more wrong cases than right
 * ones (e.g. "Mcafee", "Mclean" all have different conventions). Salespeople
 * can correct edge cases by typing the casing they want — we only fix the
 * common "all-lowercase" and "ALL-CAPS" mistakes.
 *
 * Implemented without regex lookbehind for Safari compatibility — iOS Safari
 * lookbehind support is patchy across versions and PWA standalone mode.
 */
export function titleCaseName(input) {
  if (!input) return "";
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";

  // Walk char by char. Capitalize letters that are either at index 0 or
  // come after a word-boundary character (space, hyphen, apostrophe).
  // Everything else gets lowercased.
  const boundaries = new Set([" ", "-", "'"]);
  let result = "";
  let atBoundary = true;
  for (const ch of trimmed) {
    if (boundaries.has(ch)) {
      result += ch;
      atBoundary = true;
    } else if (atBoundary) {
      result += ch.toUpperCase();
      atBoundary = false;
    } else {
      result += ch.toLowerCase();
    }
  }
  return result;
}
