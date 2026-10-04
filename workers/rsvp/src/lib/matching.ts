export interface GuestCandidate {
  householdId: number;
  guestId: number;
  fullName: string;
  normalizedName: string;
}

export interface NicknamePair {
  nickname: string;
  formal: string;
}

/** Standard single-row Levenshtein edit distance DP. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const dp = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;

  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = temp;
    }
  }
  return dp[n];
}

/**
 * Given a normalized search string, swap its first token through the
 * nicknames table (checked in both directions — nickname->formal and
 * formal->nickname) and return alternate normalized strings to also try.
 */
export function expandWithNicknames(normalized: string, nicknamePairs: NicknamePair[]): string[] {
  const tokens = normalized.split(' ').filter(Boolean);
  if (tokens.length === 0) return [];
  const [first, ...restTokens] = tokens;
  const rest = restTokens.join(' ');

  const alternates = new Set<string>();
  for (const pair of nicknamePairs) {
    if (pair.nickname === first) alternates.add(pair.formal);
    if (pair.formal === first) alternates.add(pair.nickname);
  }

  return [...alternates].map((alt) => (rest ? `${alt} ${rest}` : alt));
}

function firstInitialLastNameMatch(inputNormalized: string, candidateNormalized: string): boolean {
  const inputTokens = inputNormalized.split(' ').filter(Boolean);
  const candTokens = candidateNormalized.split(' ').filter(Boolean);
  if (inputTokens.length === 0 || candTokens.length === 0) return false;

  const inputFirst = inputTokens[0];
  const inputLast = inputTokens[inputTokens.length - 1];
  const candFirst = candTokens[0];
  const candLast = candTokens[candTokens.length - 1];

  return inputLast === candLast && inputFirst[0] === candFirst[0];
}

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv']);

/** Splits a normalized name into given-name tokens and a last name, ignoring a trailing generational suffix. */
function splitName(normalized: string): { given: string[]; last: string } | null {
  const tokens = normalized.split(' ').filter(Boolean);
  while (tokens.length > 1 && SUFFIXES.has(tokens[tokens.length - 1])) tokens.pop();
  if (tokens.length < 2) return null;
  return { given: tokens.slice(0, -1), last: tokens[tokens.length - 1] };
}

/**
 * Same last name, and every given name typed appears among the candidate's
 * given names. Lets "Conrado Alvarado" find "Conrado Alvarado Jr." and
 * "Elliot Guajardo" find "John Elliot Guajardo".
 */
function givenNameMatch(inputNormalized: string, candidateNormalized: string): boolean {
  const input = splitName(inputNormalized);
  const cand = splitName(candidateNormalized);
  if (!input || !cand) return false;
  if (input.last !== cand.last) return false;
  return input.given.every((g) => cand.given.includes(g));
}

/**
 * Match order: exact normalized match -> nickname expansion (retry exact) ->
 * given-name match (suffix-insensitive, any given name + last name) ->
 * fuzzy (Levenshtein <=2 on the full normalized string, or first-initial +
 * exact last name). Stops at the first stage that produces any match.
 */
export function findMatches(
  inputNormalized: string,
  candidates: GuestCandidate[],
  nicknamePairs: NicknamePair[]
): GuestCandidate[] {
  if (!inputNormalized) return [];

  const exact = candidates.filter((c) => c.normalizedName === inputNormalized);
  if (exact.length > 0) return exact;

  for (const alt of expandWithNicknames(inputNormalized, nicknamePairs)) {
    const nicknameMatches = candidates.filter((c) => c.normalizedName === alt);
    if (nicknameMatches.length > 0) return nicknameMatches;
  }

  const givenMatches = candidates.filter((c) => givenNameMatch(inputNormalized, c.normalizedName));
  if (givenMatches.length > 0) return givenMatches;

  return candidates.filter(
    (c) =>
      levenshtein(c.normalizedName, inputNormalized) <= 2 ||
      firstInitialLastNameMatch(inputNormalized, c.normalizedName)
  );
}

export function groupByHousehold(matches: GuestCandidate[]): Map<number, GuestCandidate[]> {
  const map = new Map<number, GuestCandidate[]>();
  for (const match of matches) {
    const bucket = map.get(match.householdId);
    if (bucket) {
      bucket.push(match);
    } else {
      map.set(match.householdId, [match]);
    }
  }
  return map;
}
