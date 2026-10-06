import { describe, it, expect } from 'vitest';
import { planSync, type DbGuest, type SheetRow } from '../src/lib/sync';

const row = (hh: string, label: string, max: number, name: string, host: string, sid: string): SheetRow => ({
  household_id: hh, household_label: label, max_party: max, guest_full_name: name, plus_one_of_guest_name: host, sheet_guest_id: sid,
});
const guest = (g: Partial<DbGuest> & Pick<DbGuest, 'id' | 'household_id' | 'full_name'>): DbGuest => ({
  is_named_guest: 1, plus_one_of: null, sheet_guest_id: null, attending: null, dietary_notes: null, song_request: null, ...g,
});

describe('planSync', () => {
  it('renames, adds a seat, removes unanswered rows and keeps answered ones', () => {
    const rows = [
      row('HH078', 'Dominique Bujanos', 2, 'Dominique Bujanos', '', '150'),
      row('HH078', 'Dominique Bujanos', 2, 'Derrick Bujanos', 'Dominique Bujanos', '150-P'),
      row('HH008', 'Gordy Philbrick', 2, 'Gordy Philbrick', '', '17'),
      row('HH008', 'Gordy Philbrick', 2, '', 'Gordy Philbrick', '17-P'),
    ];
    const households = [
      { id: 78, label: 'Dominique Rey', max_party: 2 },
      { id: 8, label: 'Gordy Philbrick', max_party: 1 },
      { id: 9, label: 'Gone Family', max_party: 1 },
      { id: 10, label: 'Answered Family', max_party: 1 },
    ];
    const guests = [
      guest({ id: 154, household_id: 78, full_name: 'Dominique Rey', sheet_guest_id: '150' }),
      guest({ id: 155, household_id: 78, full_name: 'Derrick B', plus_one_of: 154, sheet_guest_id: '150-P' }),
      guest({ id: 17, household_id: 8, full_name: 'Gordy Philbrick', sheet_guest_id: '17' }),
      guest({ id: 20, household_id: 9, full_name: 'Gone Guest', sheet_guest_id: '20' }),
      guest({ id: 21, household_id: 10, full_name: 'Answered Guest', sheet_guest_id: '21', attending: 0 }),
    ];
    const { diff, statements } = planSync(rows, households, guests);
    expect(diff.errors).toEqual([]);
    expect(diff.guestsRenamed.map((r) => r.to)).toEqual(['Dominique Bujanos', 'Derrick Bujanos']);
    expect(diff.guestsAdded).toEqual([{ sheetGuestId: '17-P', name: '(plus-one of Gordy Philbrick)', householdId: 8 }]);
    expect(diff.householdsUpdated.map((h) => h.id)).toEqual([78, 8]);
    expect(diff.guestsRemoved.map((g) => g.id)).toEqual([20]);
    expect(diff.householdsRemoved.map((h) => h.id)).toEqual([9]);
    expect(diff.orphansWithResponses.map((g) => g.id)).toEqual([21]);
    expect(statements.some((s) => /attending|song_request|dietary_notes|responded_at/.test(s.sql))).toBe(false);
  });

  it('keeps a plus-one name the guest typed when the sheet cell is blank', () => {
    const rows = [row('HH001', 'A', 2, 'Ann Lee', '', '1'), row('HH001', 'A', 2, '', 'Ann Lee', '1-P')];
    const guests = [
      guest({ id: 1, household_id: 1, full_name: 'Ann Lee', sheet_guest_id: '1', attending: 1 }),
      guest({ id: 2, household_id: 1, full_name: 'Bob Ray', plus_one_of: 1, sheet_guest_id: '1-P', attending: 1 }),
    ];
    const { diff, statements } = planSync(rows, [{ id: 1, label: 'A', max_party: 2 }], guests);
    expect(diff.guestsRenamed).toEqual([]);
    expect(statements).toEqual([]);
  });

  it('rejects the whole payload on any validation failure', () => {
    const { diff, statements } = planSync(
      [
        row('67', 'A', 1, 'Ann Lee', '', '1'),
        row('HH002', 'B', 2, 'Ann  Lee', '', '2'),
        row('HH003', 'C', 1, 'Cy Doe', '', '2'),
        row('HH004', 'D', 2, 'Di Fox', '', '4'),
        row('HH004', 'D', 2, '', 'Nobody', '4-P'),
      ],
      [],
      []
    );
    expect(statements).toEqual([]);
    expect(diff.errors.join('\n')).toMatch(/HH067/);
    expect(diff.errors.join('\n')).toMatch(/1 rows but max_party is 2/);
    expect(diff.errors.join('\n')).toMatch(/duplicate sheet_guest_id 2/);
    expect(diff.errors.join('\n')).toMatch(/host "Nobody"/);
  });

  it('flags the same searchable name in two households, honorific dropped', () => {
    const { diff } = planSync([row('HH001', 'A', 1, 'Dr. Kelsey Medina', '', '1'), row('HH002', 'B', 1, 'Kelsey Medina', '', '2')], [], []);
    expect(diff.errors).toEqual(['"Kelsey Medina" is searchable in both HH001 and HH002']);
  });
});
