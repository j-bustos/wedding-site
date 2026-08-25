import type { Env } from '../types';
import { normalizeName } from '../lib/normalize';
import { findMatches, groupByHousehold, type GuestCandidate, type NicknamePair } from '../lib/matching';
import { verifyTurnstile } from '../lib/turnstile';
import { hashIp, checkRateLimit } from '../lib/ratelimit';
import { jsonError, jsonResponse } from '../lib/errors';

interface LookupBody {
  name?: string;
  turnstileToken?: string;
}

export async function handleLookup(request: Request, env: Env, corsHeadersOut: Record<string, string>): Promise<Response> {
  let body: LookupBody;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body', 'BAD_JSON', corsHeadersOut);
  }

  const { name, turnstileToken } = body;
  if (!name || !turnstileToken) {
    return jsonError(400, 'Missing name or turnstileToken', 'MISSING_FIELDS', corsHeadersOut);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);

  const allowed = await checkRateLimit(env.DB, ipHash);
  if (!allowed) {
    return jsonResponse(
      { status: 'rate_limited', message: "You've tried this a lot in the last few minutes — please wait a bit and try again." },
      429,
      corsHeadersOut
    );
  }

  const verified = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!verified) {
    return jsonError(400, 'Verification failed. Please try again.', 'TURNSTILE_FAILED', corsHeadersOut);
  }

  const normalized = normalizeName(name);
  if (!normalized) {
    return jsonResponse({ status: 'not_found' }, 200, corsHeadersOut);
  }

  // A guest row that is itself someone else's plus-one (plus_one_of NOT NULL)
  // isn't independently findable by name search — only the primary invitee is.
  const guestRows = await env.DB.prepare(
    `SELECT id as guestId, household_id as householdId, full_name as fullName, normalized_name as normalizedName
     FROM guests WHERE is_named_guest = 1 AND plus_one_of IS NULL`
  ).all<{ guestId: number; householdId: number; fullName: string; normalizedName: string }>();

  const candidates: GuestCandidate[] = (guestRows.results ?? []).map((r) => ({
    householdId: r.householdId,
    guestId: r.guestId,
    fullName: r.fullName,
    normalizedName: r.normalizedName,
  }));

  const nickRows = await env.DB.prepare('SELECT nickname, formal FROM nicknames').all<NicknamePair>();
  const nicknamePairs = nickRows.results ?? [];

  const matches = findMatches(normalized, candidates, nicknamePairs);
  const grouped = groupByHousehold(matches);

  if (grouped.size === 0) {
    return jsonResponse({ status: 'not_found' }, 200, corsHeadersOut);
  }

  if (grouped.size > 1) {
    // Ambiguous: only ever return matched guest names, never household details.
    return jsonResponse({ status: 'ambiguous', guests: matches.map((m) => m.fullName) }, 200, corsHeadersOut);
  }

  const [householdId] = grouped.keys();
  const household = await env.DB.prepare(
    'SELECT id, label, max_party as maxParty, responded_at as respondedAt FROM households WHERE id = ?'
  )
    .bind(householdId)
    .first<{ id: number; label: string; maxParty: number; respondedAt: string | null }>();

  if (!household) {
    return jsonError(500, 'Household lookup inconsistency', 'HOUSEHOLD_NOT_FOUND', corsHeadersOut);
  }

  const allHouseholdGuests = await env.DB.prepare(
    'SELECT id, full_name as fullName, is_named_guest as isNamedGuest, plus_one_of as plusOneOf FROM guests WHERE household_id = ?'
  )
    .bind(householdId)
    .all<{ id: number; fullName: string; isNamedGuest: number; plusOneOf: number | null }>();

  const rows = allHouseholdGuests.results ?? [];

  // A plus-one row (attributed via plus_one_of) is nested under its sponsor,
  // not listed as its own top-level guest — whether or not a name is known
  // for it yet.
  const plusOneBySponsor = new Map(rows.filter((g) => g.plusOneOf !== null).map((g) => [g.plusOneOf as number, g]));

  const namedGuests = rows
    .filter((g) => g.isNamedGuest === 1 && g.plusOneOf === null)
    .map((g) => {
      const plusOne = plusOneBySponsor.get(g.id);
      return {
        id: g.id,
        name: g.fullName,
        is_named: true,
        has_plus_one: !!plusOne,
        ...(plusOne ? { plus_one: { id: plusOne.id, name: plusOne.fullName, is_named: plusOne.isNamedGuest === 1 } } : {}),
      };
    });

  // Generic seats: unnamed and not attributed to any specific guest.
  const openPlusOneSeats = rows.filter((g) => g.isNamedGuest === 0 && g.plusOneOf === null).length;

  return jsonResponse(
    {
      status: 'found',
      household: {
        id: household.id,
        label: household.label,
        max_party: household.maxParty,
        already_responded: household.respondedAt !== null,
        guests: namedGuests,
        open_plus_one_seats: openPlusOneSeats,
      },
    },
    200,
    corsHeadersOut
  );
}
