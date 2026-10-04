/**
 * Normalizes a name for matching: NFD-decompose accents away (so combining
 * marks can be stripped via the Unicode "Mark" category), lowercase, strip
 * punctuation, collapse whitespace, then drop any leading honorific
 * ("Dr. Kelsey Medina" -> "kelsey medina"). Must stay identical between the
 * Worker (lookup matching) and scripts/seed-guests.ts (seeding), since they
 * run in different runtimes and can't share a compiled module.
 */
const HONORIFICS = new Set(['dr', 'mr', 'mrs', 'ms', 'miss', 'sr', 'sra', 'srta']);

export function normalizeName(input: string): string {
  const tokens = input
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ');
  while (tokens.length > 2 && HONORIFICS.has(tokens[0])) tokens.shift();
  return tokens.join(' ');
}
