import type { Env, RsvpSubmission } from '../types';
import { verifyTurnstile } from '../lib/turnstile';
import { hashIp } from '../lib/ratelimit';
import { jsonError, jsonResponse } from '../lib/errors';
import { normalizeName } from '../lib/normalize';

export async function handleRsvp(request: Request, env: Env, corsHeadersOut: Record<string, string>): Promise<Response> {
  let body: RsvpSubmission;
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body', 'BAD_JSON', corsHeadersOut);
  }

  const { turnstileToken, householdId, responses, plusOnes, message } = body;
  if (!turnstileToken || !householdId || !Array.isArray(responses)) {
    return jsonError(400, 'Missing required fields', 'MISSING_FIELDS', corsHeadersOut);
  }

  const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown';
  const verified = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET_KEY, ip);
  if (!verified) {
    return jsonError(400, 'Verification failed. Please try again.', 'TURNSTILE_FAILED', corsHeadersOut);
  }

  const deadlineMs = new Date(env.RSVP_DEADLINE).getTime();
  if (Date.now() > deadlineMs) {
    return jsonResponse({ status: 'closed' }, 403, corsHeadersOut);
  }

  const household = await env.DB.prepare('SELECT id, max_party as maxParty FROM households WHERE id = ?')
    .bind(householdId)
    .first<{ id: number; maxParty: number }>();
  if (!household) {
    return jsonError(404, 'Household not found', 'HOUSEHOLD_NOT_FOUND', corsHeadersOut);
  }

  const guestRows = await env.DB.prepare('SELECT id, is_named_guest as isNamedGuest FROM guests WHERE household_id = ?')
    .bind(householdId)
    .all<{ id: number; isNamedGuest: number }>();
  const householdGuests = guestRows.results ?? [];
  const validGuestIds = new Set(householdGuests.map((g) => g.id));

  for (const r of responses) {
    if (!validGuestIds.has(r.guestId)) {
      return jsonError(400, `Guest ${r.guestId} does not belong to this household`, 'INVALID_GUEST', corsHeadersOut);
    }
  }

  const unnamedSeats = householdGuests.filter((g) => g.isNamedGuest === 0);
  const plusOnesArr = Array.isArray(plusOnes) ? plusOnes : [];
  if (plusOnesArr.length > unnamedSeats.length) {
    return jsonError(400, 'More plus-ones submitted than available seats', 'OVER_CAPACITY', corsHeadersOut);
  }

  const namedAttendingCount = responses.filter((r) => r.attending).length;
  const plusOneAttendingCount = plusOnesArr.filter((p) => p.attending).length;
  if (namedAttendingCount + plusOneAttendingCount > household.maxParty) {
    return jsonError(400, 'Attending count exceeds party size', 'OVER_CAPACITY', corsHeadersOut);
  }

  const statements = [];
  for (const r of responses) {
    statements.push(
      env.DB.prepare('UPDATE guests SET attending = ?, dietary_notes = ?, song_request = ? WHERE id = ?').bind(
        r.attending ? 1 : 0,
        r.dietaryNotes ?? null,
        r.songRequest ?? null,
        r.guestId
      )
    );
  }
  for (let i = 0; i < plusOnesArr.length; i++) {
    const seat = unnamedSeats[i];
    const plusOne = plusOnesArr[i];
    const plusOneName = plusOne.name.trim();
    statements.push(
      env.DB.prepare(
        'UPDATE guests SET full_name = ?, normalized_name = ?, attending = 1, dietary_notes = ? WHERE id = ?'
      ).bind(plusOneName, normalizeName(plusOneName), plusOne.dietaryNotes ?? null, seat.id)
    );
  }

  const nowIso = new Date().toISOString();
  const ipHash = await hashIp(ip, env.IP_HASH_SALT);
  statements.push(
    env.DB.prepare('UPDATE households SET responded_at = ?, message = ? WHERE id = ?').bind(
      nowIso,
      message ?? null,
      householdId
    )
  );
  statements.push(
    env.DB.prepare('INSERT INTO rsvp_log (household_id, payload, ip_hash, created_at) VALUES (?, ?, ?, ?)').bind(
      householdId,
      JSON.stringify(body),
      ipHash,
      nowIso
    )
  );

  await env.DB.batch(statements);

  return jsonResponse(
    {
      status: 'ok',
      summary: {
        householdId,
        totalAttending: namedAttendingCount + plusOneAttendingCount,
      },
    },
    200,
    corsHeadersOut
  );
}
