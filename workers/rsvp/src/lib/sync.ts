import { normalizeName } from './normalize';

/** One row of the sheet's Site Export tab: one seat that should exist on the site. */
export interface SheetRow {
  household_id: string;
  household_label: string;
  max_party: number | string;
  guest_full_name: string;
  plus_one_of_guest_name: string;
  sheet_guest_id: string;
}

export interface DbHousehold {
  id: number;
  label: string;
  max_party: number;
}

export interface DbGuest {
  id: number;
  household_id: number;
  full_name: string;
  is_named_guest: number;
  plus_one_of: number | null;
  sheet_guest_id: string | null;
  attending: number | null;
  dietary_notes: string | null;
  song_request: string | null;
}

export interface Statement {
  sql: string;
  params: (string | number | null)[];
}

export interface SyncDiff {
  householdsAdded: { id: number; label: string }[];
  householdsUpdated: { id: number; label: string; changes: string[] }[];
  householdsRemoved: { id: number; label: string }[];
  guestsAdded: { sheetGuestId: string; name: string; householdId: number }[];
  guestsRenamed: { sheetGuestId: string; from: string; to: string }[];
  guestsMoved: { sheetGuestId: string; name: string; fromHousehold: number; toHousehold: number }[];
  guestsRemoved: { id: number; name: string; householdId: number }[];
  orphansWithResponses: { id: number; name: string; householdId: number; sheetGuestId: string | null }[];
  errors: string[];
}

const hasResponse = (g: DbGuest) => g.attending !== null || g.dietary_notes !== null || g.song_request !== null;
const clean = (s: unknown) => String(s ?? '').replace(/\s+/g, ' ').trim();

interface Seat {
  householdId: number;
  label: string;
  maxParty: number;
  name: string;
  hostName: string;
  sid: string;
}

/** Validates the whole payload; returns every problem found, empty when clean. */
export function validateRows(rows: SheetRow[]): { errors: string[]; seats: Seat[] } {
  const errors: string[] = [];
  const seats: Seat[] = rows.map((r) => ({
    householdId: /^HH\d+$/.test(clean(r.household_id)) ? Number(clean(r.household_id).slice(2)) : NaN,
    label: clean(r.household_label),
    maxParty: Number(r.max_party),
    name: clean(r.guest_full_name),
    hostName: clean(r.plus_one_of_guest_name),
    sid: clean(r.sheet_guest_id),
  }));

  const byHousehold = new Map<number, Seat[]>();
  const sids = new Set<string>();
  seats.forEach((s, i) => {
    const where = `row ${i + 2} (${clean(rows[i].household_id) || '?'} ${s.name || s.sid || ''})`.trim();
    if (Number.isNaN(s.householdId)) errors.push(`${where}: household_id must look like HH067`);
    if (!s.label) errors.push(`${where}: household_label is blank`);
    if (!Number.isInteger(s.maxParty) || s.maxParty < 1) errors.push(`${where}: max_party is not a positive whole number`);
    if (!s.sid) errors.push(`${where}: sheet_guest_id is blank`);
    else if (sids.has(s.sid)) errors.push(`${where}: duplicate sheet_guest_id ${s.sid}`);
    sids.add(s.sid);
    if (!s.hostName && !s.name) errors.push(`${where}: named guest has a blank guest_full_name`);
    if (s.hostName && s.sid && !s.sid.endsWith('-P')) errors.push(`${where}: plus-one sheet_guest_id ${s.sid} should end in -P`);
    if (!s.hostName && s.sid.endsWith('-P')) errors.push(`${where}: ${s.sid} looks like a plus-one but plus_one_of_guest_name is blank`);
    if (!Number.isNaN(s.householdId)) byHousehold.set(s.householdId, [...(byHousehold.get(s.householdId) ?? []), s]);
  });

  for (const [hh, list] of byHousehold) {
    const tag = `HH${String(hh).padStart(3, '0')}`;
    if (new Set(list.map((s) => s.label)).size > 1) errors.push(`${tag}: rows disagree on household_label`);
    if (new Set(list.map((s) => s.maxParty)).size > 1) errors.push(`${tag}: rows disagree on max_party`);
    if (list.length !== list[0].maxParty) errors.push(`${tag}: ${list.length} rows but max_party is ${list[0].maxParty}`);
    const named = list.filter((s) => !s.hostName);
    const hostsSeen = new Set<string>();
    for (const p of list.filter((s) => s.hostName)) {
      const host = named.find((n) => n.sid === p.sid.replace(/-P$/, ''));
      if (!host || normalizeName(host.name) !== normalizeName(p.hostName)) {
        errors.push(`${tag}: plus-one ${p.sid} host "${p.hostName}" is not a named guest in this household`);
      }
      const key = normalizeName(p.hostName);
      if (hostsSeen.has(key)) errors.push(`${tag}: "${p.hostName}" has more than one plus-one`);
      hostsSeen.add(key);
    }
  }

  // Same searchable name in two households would make lookup ambiguous.
  const nameHome = new Map<string, number>();
  for (const s of seats.filter((s) => !s.hostName && s.name)) {
    const key = normalizeName(s.name);
    const other = nameHome.get(key);
    if (other !== undefined && other !== s.householdId) {
      errors.push(`"${s.name}" is searchable in both HH${String(other).padStart(3, '0')} and HH${String(s.householdId).padStart(3, '0')}`);
    }
    nameHome.set(key, s.householdId);
  }

  return { errors, seats };
}

/**
 * Plans the sync keyed on sheet_guest_id. Pure: returns the diff and the SQL
 * to run as one batch. Never writes attending/dietary_notes/song_request,
 * households.responded_at or households.message.
 */
export function planSync(rows: SheetRow[], households: DbHousehold[], guests: DbGuest[]): { diff: SyncDiff; statements: Statement[] } {
  const diff: SyncDiff = {
    householdsAdded: [], householdsUpdated: [], householdsRemoved: [],
    guestsAdded: [], guestsRenamed: [], guestsMoved: [], guestsRemoved: [],
    orphansWithResponses: [], errors: [],
  };
  const { errors, seats } = validateRows(rows);
  if (errors.length) return { diff: { ...diff, errors }, statements: [] };

  const statements: Statement[] = [];
  const dbHouseholds = new Map(households.map((h) => [h.id, h]));
  const dbBySid = new Map(guests.filter((g) => g.sheet_guest_id).map((g) => [g.sheet_guest_id as string, g]));

  // 1. Households: upsert label + max_party.
  const payloadHouseholds = new Map(seats.map((s) => [s.householdId, s]));
  for (const [id, s] of payloadHouseholds) {
    const existing = dbHouseholds.get(id);
    if (!existing) diff.householdsAdded.push({ id, label: s.label });
    else {
      const changes = [
        ...(existing.label !== s.label ? [`label "${existing.label}" -> "${s.label}"`] : []),
        ...(existing.max_party !== s.maxParty ? [`max_party ${existing.max_party} -> ${s.maxParty}`] : []),
      ];
      if (!changes.length) continue;
      diff.householdsUpdated.push({ id, label: s.label, changes });
    }
    statements.push({
      sql: 'INSERT INTO households (id, label, max_party) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET label = excluded.label, max_party = excluded.max_party',
      params: [id, s.label, s.maxParty],
    });
  }

  // 2. Guests: named guests first so plus-ones can reference their host's id.
  let nextId = Math.max(0, ...guests.map((g) => g.id)) + 1;
  const idBySid = new Map<string, number>();
  const ordered = [...seats.filter((s) => !s.hostName), ...seats.filter((s) => s.hostName)];
  for (const s of ordered) {
    const existing = dbBySid.get(s.sid);
    const plusOneOf = s.hostName ? (idBySid.get(s.sid.replace(/-P$/, '')) as number) : null;
    // A plus-one name typed in by the guest on the RSVP form is response data:
    // a blank sheet cell never erases it.
    const name = !s.name && s.hostName && existing && hasResponse(existing) ? existing.full_name : s.name;
    const isNamed = s.hostName ? (name ? 1 : 0) : 1;

    if (!existing) {
      const id = nextId++;
      idBySid.set(s.sid, id);
      diff.guestsAdded.push({ sheetGuestId: s.sid, name: name || `(plus-one of ${s.hostName})`, householdId: s.householdId });
      statements.push({
        sql: 'INSERT INTO guests (id, household_id, full_name, normalized_name, is_named_guest, plus_one_of, sheet_guest_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        params: [id, s.householdId, name, name ? normalizeName(name) : '', isNamed, plusOneOf, s.sid],
      });
      continue;
    }
    idBySid.set(s.sid, existing.id);
    if (existing.full_name !== name) diff.guestsRenamed.push({ sheetGuestId: s.sid, from: existing.full_name, to: name });
    if (existing.household_id !== s.householdId) {
      diff.guestsMoved.push({ sheetGuestId: s.sid, name, fromHousehold: existing.household_id, toHousehold: s.householdId });
    }
    if (existing.full_name === name && existing.household_id === s.householdId && existing.is_named_guest === isNamed && existing.plus_one_of === plusOneOf) {
      continue;
    }
    statements.push({
      sql: 'UPDATE guests SET full_name = ?, normalized_name = ?, household_id = ?, is_named_guest = ?, plus_one_of = ? WHERE id = ?',
      params: [name, name ? normalizeName(name) : '', s.householdId, isNamed, plusOneOf, existing.id],
    });
  }

  // 3. Guests only in D1: delete unless they (or a plus-one they host) hold a response.
  const keptIds = new Set(idBySid.values());
  const stale = guests.filter((g) => !keptIds.has(g.id));
  const keep = new Set(stale.filter(hasResponse).map((g) => g.id));
  for (const g of stale) if (keep.has(g.id) && g.plus_one_of !== null && !keptIds.has(g.plus_one_of)) keep.add(g.plus_one_of);
  // Plus-ones before hosts, so no row is left pointing at a deleted host.
  for (const g of [...stale].sort((a, b) => Number(b.plus_one_of !== null) - Number(a.plus_one_of !== null))) {
    if (keep.has(g.id)) {
      diff.orphansWithResponses.push({ id: g.id, name: g.full_name, householdId: g.household_id, sheetGuestId: g.sheet_guest_id });
    } else {
      diff.guestsRemoved.push({ id: g.id, name: g.full_name, householdId: g.household_id });
      statements.push({ sql: 'DELETE FROM guests WHERE id = ?', params: [g.id] });
    }
  }

  // 4. Households only in D1: delete once no guest row remains in them.
  const occupied = new Set([...seats.map((s) => s.householdId), ...stale.filter((g) => keep.has(g.id)).map((g) => g.household_id)]);
  for (const h of households) {
    if (occupied.has(h.id)) continue;
    diff.householdsRemoved.push({ id: h.id, label: h.label });
    statements.push({ sql: 'DELETE FROM households WHERE id = ?', params: [h.id] });
  }

  return { diff, statements };
}
