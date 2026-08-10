import type { Env } from '../types';
import { buildExportCsv, type ExportRow } from '../lib/csv';
import { jsonError } from '../lib/errors';

/** Constant-time string compare — avoids leaking token length/prefix via timing. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

export async function handleAdminExport(request: Request, env: Env): Promise<Response> {
  const auth = request.headers.get('Authorization') ?? '';
  if (!timingSafeEqual(auth, `Bearer ${env.ADMIN_TOKEN}`)) {
    return jsonError(401, 'Unauthorized');
  }

  const result = await env.DB.prepare(
    `SELECT h.label as householdLabel, h.max_party as maxParty, g.full_name as fullName,
            g.is_named_guest as isNamedGuest, g.attending as attending,
            g.dietary_notes as dietaryNotes, g.song_request as songRequest
     FROM guests g
     JOIN households h ON h.id = g.household_id
     ORDER BY h.label, g.is_named_guest DESC, g.full_name`
  ).all<ExportRow>();

  const csv = buildExportCsv(result.results ?? []);

  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="rsvp-export.csv"',
    },
  });
}
