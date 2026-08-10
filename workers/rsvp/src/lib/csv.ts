export interface ExportRow {
  householdLabel: string;
  maxParty: number;
  fullName: string;
  isNamedGuest: number;
  attending: number | null;
  dietaryNotes: string | null;
  songRequest: string | null;
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Builds the full admin export: per-guest rows, then a totals/dietary summary. */
export function buildExportCsv(rows: ExportRow[]): string {
  const header = [
    'household',
    'max_party',
    'guest_name',
    'is_named_guest',
    'attending',
    'dietary_notes',
    'song_request',
  ];
  const lines = [header.join(',')];

  for (const r of rows) {
    lines.push(
      [
        csvEscape(r.householdLabel),
        String(r.maxParty),
        csvEscape(r.fullName),
        r.isNamedGuest ? '1' : '0',
        r.attending === null ? '' : String(r.attending),
        csvEscape(r.dietaryNotes ?? ''),
        csvEscape(r.songRequest ?? ''),
      ].join(',')
    );
  }

  const attendingCount = rows.filter((r) => r.attending === 1).length;
  const notAttendingCount = rows.filter((r) => r.attending === 0).length;
  const noReplyCount = rows.filter((r) => r.attending === null).length;
  const dietaryNotes = rows.filter((r) => r.dietaryNotes);

  lines.push('');
  lines.push(`# Totals,attending=${attendingCount},not_attending=${notAttendingCount},no_reply=${noReplyCount}`);

  if (dietaryNotes.length > 0) {
    lines.push('');
    lines.push('# Dietary notes');
    for (const r of dietaryNotes) {
      lines.push(`${csvEscape(r.fullName)},${csvEscape(r.dietaryNotes ?? '')}`);
    }
  }

  return lines.join('\n') + '\n';
}
