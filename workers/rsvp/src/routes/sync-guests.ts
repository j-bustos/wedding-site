import type { Env } from '../types';
import { jsonError, jsonResponse } from '../lib/errors';
import { planSync, type DbGuest, type DbHousehold, type SheetRow } from '../lib/sync';
import { isAdmin } from './admin-export';

/**
 * POST /api/admin/sync-guests — makes D1's guest list match the sheet's Site
 * Export tab without touching any RSVP response. Body: { dryRun, rows }.
 */
export async function handleSyncGuests(request: Request, env: Env): Promise<Response> {
  if (!isAdmin(request, env)) return jsonError(401, 'Unauthorized');

  let body: { dryRun?: unknown; rows?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonError(400, 'Invalid JSON body', 'BAD_JSON');
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) return jsonError(400, 'rows must be a non-empty array', 'MISSING_FIELDS');
  // Anything but an explicit false is a dry run, so a malformed call can't write.
  const dryRun = body.dryRun !== false;

  const [households, guests] = await Promise.all([
    env.DB.prepare('SELECT id, label, max_party FROM households').all<DbHousehold>(),
    env.DB.prepare(
      'SELECT id, household_id, full_name, is_named_guest, plus_one_of, sheet_guest_id, attending, dietary_notes, song_request FROM guests'
    ).all<DbGuest>(),
  ]);
  const { diff, statements } = planSync(body.rows as SheetRow[], households.results ?? [], guests.results ?? []);
  if (diff.errors.length) return jsonResponse({ status: 'error', dryRun, ...diff }, 400);

  if (!dryRun) {
    const summary = Object.fromEntries(Object.entries(diff).map(([k, v]) => [k, v.length]));
    const db = env.DB;
    await db.batch([
      ...statements.map((s) => db.prepare(s.sql).bind(...s.params)),
      // household_id 0 marks an admin sync entry rather than a guest submission.
      db.prepare('INSERT INTO rsvp_log (household_id, payload, created_at) VALUES (0, ?, ?)').bind(
        JSON.stringify({ type: 'sync-guests', rows: body.rows.length, summary, diff }),
        new Date().toISOString()
      ),
    ]);
  }

  return jsonResponse({ status: 'ok', dryRun, statements: statements.length, ...diff });
}
