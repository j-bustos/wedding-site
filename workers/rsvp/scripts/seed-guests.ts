import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeName } from '../src/lib/normalize';

interface CsvRow {
  householdLabel: string;
  maxParty: number;
  guestFullName: string;
  /** Sponsor's full name if this row IS a plus-one seat; '' otherwise. */
  plusOneOfGuestName: string;
}

function parseCsv(content: string): CsvRow[] {
  const lines = content.trim().split(/\r?\n/);
  const [headerLine, ...rest] = lines;
  const columns = headerLine.split(',').map((c) => c.trim());

  return rest.filter(Boolean).map((line) => {
    const cells = line.split(',');
    const record: Record<string, string> = {};
    columns.forEach((col, i) => {
      record[col] = (cells[i] ?? '').trim();
    });
    return {
      householdLabel: record.household_label,
      maxParty: Number(record.max_party),
      guestFullName: record.guest_full_name,
      // Optional column — a sheet export that predates plus-one attribution
      // simply won't have it, and every row parses as a regular named guest.
      plusOneOfGuestName: record.plus_one_of_guest_name ?? '',
    };
  });
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
}

interface HouseholdGroup {
  maxParty: number;
  primaryRows: CsvRow[];
  plusOneRows: CsvRow[];
}

function main() {
  const csvPath = process.argv[2] ?? 'guest-list.csv';
  const outPath = process.argv[3] ?? 'seed-output.sql';

  if (!existsSync(csvPath)) {
    console.error(
      `CSV not found at "${csvPath}".\n` +
        `Copy guest-list.example.csv to guest-list.csv (gitignored) with real data, ` +
        `or pass a path: npm run seed -- path/to/list.csv output.sql`
    );
    process.exit(1);
  }

  const rows = parseCsv(readFileSync(csvPath, 'utf-8'));
  if (rows.length === 0) {
    console.error('CSV parsed to zero rows — check the header matches household_label,max_party,guest_full_name');
    process.exit(1);
  }

  const households = new Map<string, HouseholdGroup>();
  for (const row of rows) {
    if (!row.householdLabel || Number.isNaN(row.maxParty)) {
      console.error(`Skipping malformed row: ${JSON.stringify(row)}`);
      continue;
    }
    // A plus-one row is allowed a blank guest_full_name (name not yet known);
    // a regular named-guest row is not.
    if (!row.plusOneOfGuestName && !row.guestFullName) {
      console.error(`Skipping malformed row: ${JSON.stringify(row)}`);
      continue;
    }
    const existing = households.get(row.householdLabel);
    const bucket = existing ?? { maxParty: row.maxParty, primaryRows: [], plusOneRows: [] };
    if (row.plusOneOfGuestName) {
      bucket.plusOneRows.push(row);
    } else {
      bucket.primaryRows.push(row);
    }
    if (!existing) households.set(row.householdLabel, bucket);
  }

  const statements: string[] = [];
  let householdId = 1;
  let guestId = 1;

  for (const [label, { maxParty, primaryRows, plusOneRows }] of households) {
    statements.push(
      `INSERT INTO households (id, label, max_party) VALUES (${householdId}, '${sqlEscape(label)}', ${maxParty});`
    );

    // Pass 1: named guests, so plus-one rows below can resolve their sponsor
    // by name regardless of CSV row order.
    const nameToId = new Map<string, number>();
    for (const row of primaryRows) {
      const normalized = normalizeName(row.guestFullName);
      statements.push(
        `INSERT INTO guests (id, household_id, full_name, normalized_name, is_named_guest) VALUES ` +
          `(${guestId}, ${householdId}, '${sqlEscape(row.guestFullName)}', '${sqlEscape(normalized)}', 1);`
      );
      nameToId.set(normalized, guestId);
      guestId++;
    }

    // Pass 2: plus-one seats, attributed to their sponsor's just-assigned id.
    let attributedCount = 0;
    for (const row of plusOneRows) {
      const sponsorId = nameToId.get(normalizeName(row.plusOneOfGuestName));
      if (sponsorId === undefined) {
        console.warn(
          `Household "${label}": plus-one row references unknown sponsor "${row.plusOneOfGuestName}" — skipping this seat. ` +
            `Check the sponsor's name matches their guest_full_name exactly.`
        );
        continue;
      }
      const isNamed = row.guestFullName ? 1 : 0;
      const normalized = row.guestFullName ? normalizeName(row.guestFullName) : '';
      statements.push(
        `INSERT INTO guests (id, household_id, full_name, normalized_name, is_named_guest, plus_one_of) VALUES ` +
          `(${guestId}, ${householdId}, '${sqlEscape(row.guestFullName)}', '${sqlEscape(normalized)}', ${isNamed}, ${sponsorId});`
      );
      guestId++;
      attributedCount++;
    }

    // Reserved-seats accounting: named guests + attributed plus-ones should
    // already equal max_party for households where every extra seat is
    // attributed; any remainder becomes a generic, unattributed seat.
    const openSeats = maxParty - primaryRows.length - attributedCount;
    if (openSeats < 0) {
      console.warn(
        `Household "${label}" has more named guests + plus-ones (${primaryRows.length + attributedCount}) than max_party (${maxParty})`
      );
    } else {
      console.log(
        `Household "${label}": ${primaryRows.length} named + ${attributedCount} plus-one` +
          `${openSeats > 0 ? ` + ${openSeats} unattributed` : ''} = ${primaryRows.length + attributedCount + openSeats} seats (max_party ${maxParty})`
      );
    }
    for (let i = 0; i < Math.max(0, openSeats); i++) {
      statements.push(
        `INSERT INTO guests (id, household_id, full_name, normalized_name, is_named_guest) VALUES ` +
          `(${guestId}, ${householdId}, '', '', 0);`
      );
      guestId++;
    }

    householdId++;
  }

  writeFileSync(outPath, statements.join('\n') + '\n');
  console.log(`Wrote ${statements.length} statements for ${households.size} households to ${outPath}`);
  console.log('');
  console.log('Apply locally:');
  console.log(`  wrangler d1 execute thebustos-rsvp --local --file=${outPath}`);
  console.log('Apply to production (careful — this is real data):');
  console.log(`  wrangler d1 execute thebustos-rsvp --remote --file=${outPath}`);
}

main();
