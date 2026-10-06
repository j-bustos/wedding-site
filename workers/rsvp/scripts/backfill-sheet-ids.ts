/**
 * One-time backfill of guests.sheet_guest_id (migration 0005).
 *
 *   npx wrangler d1 execute thebustos-rsvp --local --json --command "SELECT id, household_id, full_name, plus_one_of FROM guests" > guests.json
 *   npx tsx scripts/backfill-sheet-ids.ts site-export.csv guests.json backfill.sql
 *
 * Named guests match on household_id + normalizeName(full_name); plus-one
 * seats match on their host's D1 id. Writes UPDATEs only (sheet_guest_id,
 * nothing else), and lists every row it could not match instead of guessing.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { normalizeName } from '../src/lib/normalize';

interface Guest { id: number; household_id: number; full_name: string; plus_one_of: number | null }

function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = '', row: string[] = [], quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field.replace(/\r$/, '')); records.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) records.push([...row, field]);
  const [header, ...rest] = records;
  return rest.filter((r) => r.some(Boolean)).map((r) => Object.fromEntries(header.map((h, i) => [h.trim(), (r[i] ?? '').trim()])));
}

const [csvPath, guestsPath, outPath = 'backfill.sql'] = process.argv.slice(2);
const rows = parseCsv(readFileSync(csvPath, 'utf-8').replace(/^﻿/, ''));
const parsed = JSON.parse(readFileSync(guestsPath, 'utf-8'));
// Wrangler 3's local --json prints SQL NULL as the string "null".
const guests: Guest[] = (Array.isArray(parsed) ? (parsed[0].results ?? parsed) : parsed.results).map((g: Guest) => ({
  ...g,
  plus_one_of: g.plus_one_of === null || String(g.plus_one_of) === 'null' ? null : Number(g.plus_one_of),
}));

const taken = new Set<number>();
const idBySid = new Map<string, number>();
const sql: string[] = [];
const unmatched: string[] = [];

const named = rows.filter((r) => !r.plus_one_of_guest_name);
const plusOnes = rows.filter((r) => r.plus_one_of_guest_name);
for (const r of [...named, ...plusOnes]) {
  const hh = Number(r.household_id.replace(/^HH/, ''));
  const hostId = r.plus_one_of_guest_name ? idBySid.get(r.sheet_guest_id.replace(/-P$/, '')) : undefined;
  const hits = guests.filter((g) =>
    !taken.has(g.id) && g.household_id === hh &&
    (r.plus_one_of_guest_name
      ? hostId !== undefined && g.plus_one_of === hostId
      : g.plus_one_of === null && normalizeName(g.full_name) === normalizeName(r.guest_full_name))
  );
  if (hits.length !== 1) {
    unmatched.push(`${r.sheet_guest_id}\t${r.household_id}\t${r.guest_full_name || '(plus-one of ' + r.plus_one_of_guest_name + ')'}\t${hits.length} candidates`);
    continue;
  }
  taken.add(hits[0].id);
  idBySid.set(r.sheet_guest_id, hits[0].id);
  sql.push(`UPDATE guests SET sheet_guest_id = '${r.sheet_guest_id.replace(/'/g, "''")}' WHERE id = ${hits[0].id} AND sheet_guest_id IS NULL;`);
}

writeFileSync(outPath, `-- Backfill guests.sheet_guest_id. Writes no other column.\n${sql.join('\n')}\n`);
console.log(`Matched ${sql.length} of ${rows.length} sheet rows -> ${outPath}`);
console.log(`\nSheet rows with no D1 match (${unmatched.length}):\n${unmatched.join('\n') || '  none'}`);
const left = guests.filter((g) => !taken.has(g.id));
console.log(`\nD1 guests with no sheet match (${left.length}):\n${left.map((g) => `id ${g.id}\tHH${String(g.household_id).padStart(3, '0')}\t${g.full_name || '(blank)'}${g.plus_one_of ? '\tplus-one of ' + g.plus_one_of : ''}`).join('\n') || '  none'}`);
