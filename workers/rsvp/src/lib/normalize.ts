/**
 * Normalizes a name for matching: NFD-decompose accents away (so combining
 * marks can be stripped via the Unicode "Mark" category), lowercase, strip
 * punctuation, collapse whitespace. Must stay identical between the Worker
 * (lookup matching) and scripts/seed-guests.ts (seeding), since they run in
 * different runtimes and can't share a compiled module.
 */
export function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}
