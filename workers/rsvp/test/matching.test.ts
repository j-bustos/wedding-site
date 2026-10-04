import { describe, it, expect } from 'vitest';
import { normalizeName } from '../src/lib/normalize';
import { findMatches, groupByHousehold, levenshtein, type GuestCandidate, type NicknamePair } from '../src/lib/matching';

const nicknamePairs: NicknamePair[] = [
  { nickname: 'pepe', formal: 'jose' },
  { nickname: 'chepe', formal: 'jose' },
  { nickname: 'beto', formal: 'alberto' },
  { nickname: 'beto', formal: 'roberto' },
];

function candidate(householdId: number, guestId: number, fullName: string): GuestCandidate {
  return { householdId, guestId, fullName, normalizedName: normalizeName(fullName) };
}

describe('normalizeName', () => {
  it('strips accents, case, and punctuation the same way regardless of input form', () => {
    expect(normalizeName('José García')).toBe('jose garcia');
    expect(normalizeName('  Jose   Garcia! ')).toBe('jose garcia');
    expect(normalizeName('José García')).toBe(normalizeName('Jose Garcia'));
  });

  it('drops a leading honorific', () => {
    expect(normalizeName('Dr. Kelsey Medina')).toBe('kelsey medina');
  });
});

describe('findMatches', () => {
  it('matches accented input against an unaccented candidate (and vice versa)', () => {
    const candidates = [candidate(1, 1, 'Jose Garcia')];
    const matches = findMatches(normalizeName('José García'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].fullName).toBe('Jose Garcia');
  });

  it('matches a nickname against a candidate invited under the formal name', () => {
    const candidates = [candidate(1, 1, 'Jose Garcia')];
    const matches = findMatches(normalizeName('Pepe Garcia'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].fullName).toBe('Jose Garcia');
  });

  it('matches the reverse direction — formal input against a candidate invited under a nickname', () => {
    const candidates = [candidate(1, 1, 'Beto Salinas')];
    const matches = findMatches(normalizeName('Alberto Salinas'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].fullName).toBe('Beto Salinas');
  });

  it('matches input with a single typo via fuzzy (Levenshtein <= 2) fallback', () => {
    const candidates = [candidate(1, 1, 'Anthony Huerta')];
    const matches = findMatches(normalizeName('Anthny Huerta'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].fullName).toBe('Anthony Huerta');
  });

  it('returns no match for a married-name mismatch (different last name entirely)', () => {
    const candidates = [candidate(1, 1, 'Jane Doe')];
    const matches = findMatches(normalizeName('Jane Smith'), candidates, nicknamePairs);
    expect(matches).toHaveLength(0);
  });

  it('returns matches from two different households when the same name exists in both (ambiguous)', () => {
    const candidates = [candidate(1, 1, 'Chris Lee'), candidate(2, 2, 'Chris Lee')];
    const matches = findMatches(normalizeName('Chris Lee'), candidates, nicknamePairs);
    const grouped = groupByHousehold(matches);
    expect(grouped.size).toBe(2);
  });

  it('never returns candidates from unrelated households when exactly one matches', () => {
    const candidates = [candidate(1, 1, 'Jose Garcia'), candidate(2, 2, 'Maria Lopez')];
    const matches = findMatches(normalizeName('Jose Garcia'), candidates, nicknamePairs);
    expect(matches.every((m) => m.householdId === 1)).toBe(true);
  });

  it('strips an honorific from the input before matching against an unrelated namesake in another household', () => {
    const candidates = [candidate(66, 1, 'Kelsey Medina'), candidate(70, 2, 'Diego Medina')];
    const matches = findMatches(normalizeName('Dr. Kelsey Medina'), candidates, nicknamePairs);
    const grouped = groupByHousehold(matches);
    expect([...grouped.keys()]).toEqual([66]);
  });

  it('matches input without a generational suffix against a candidate invited with one', () => {
    const candidates = [candidate(37, 1, 'Conrado Alvarado Jr.')];
    const matches = findMatches(normalizeName('Conrado Alvarado'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].householdId).toBe(37);
  });

  it('matches a middle given name against a candidate invited under a different given name plus that middle name', () => {
    const candidates = [candidate(26, 1, 'John Elliot Guajardo')];
    const matches = findMatches(normalizeName('Elliot Guajardo'), candidates, nicknamePairs);
    expect(matches).toHaveLength(1);
    expect(matches[0].householdId).toBe(26);
  });

  it('keeps a generational suffix distinguishing two otherwise identical names in separate households', () => {
    const candidates = [candidate(18, 1, 'Raul Sanchez'), candidate(100, 2, 'Raul Sanchez Jr.')];

    const plainMatches = findMatches(normalizeName('Raul Sanchez'), candidates, nicknamePairs);
    expect(plainMatches).toHaveLength(1);
    expect(plainMatches[0].householdId).toBe(18);

    const suffixedMatches = findMatches(normalizeName('Raul Sanchez Jr.'), candidates, nicknamePairs);
    expect(suffixedMatches).toHaveLength(1);
    expect(suffixedMatches[0].householdId).toBe(100);
  });
});

describe('levenshtein', () => {
  it('computes edit distance correctly', () => {
    expect(levenshtein('jose garcia', 'jose garcia')).toBe(0);
    expect(levenshtein('jon garcia', 'jose garcia')).toBeLessThanOrEqual(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});
