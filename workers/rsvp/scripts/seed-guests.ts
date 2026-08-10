import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { normalizeName } from '../src/lib/normalize';

interface CsvRow {
  householdLabel: string;
  maxParty: number;
  guestFullName: string;
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
    };
  });
}

function sqlEscape(value: string): string {
  return value.replace(/'/g, "''");
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

  const households = new Map<string, { maxParty: number; guests: string[] }>();
  for (const row of rows) {
    if (!row.householdLabel || Number.isNaN(row.maxParty) || !row.guestFullName) {
      console.error(`Skipping malformed row: ${JSON.stringify(row)}`);
      continue;
    }
    const existing = households.get(row.householdLabel);
    if (existing) {
      existing.guests.push(row.guestFullName);
    } else {
      households.set(row.householdLabel, { maxParty: row.maxParty, guests: [row.guestFullName] });
    }
  }

  const statements: string[] = [];
  let householdId = 1;
  let guestId = 1;

  for (const [label, { maxParty, guests }] of households) {
    statements.push(
      `INSERT INTO households (id, label, max_party) VALUES (${householdId}, '${sqlEscape(label)}', ${maxParty});`
    );

    for (const fullName of guests) {
      const normalized = normalizeName(fullName);
      statements.push(
        `INSERT INTO guests (id, household_id, full_name, normalized_name, is_named_guest) VALUES ` +
          `(${guestId}, ${householdId}, '${sqlEscape(fullName)}', '${sqlEscape(normalized)}', 1);`
      );
      guestId++;
    }

    const openSeats = maxParty - guests.length;
    if (openSeats < 0) {
      console.warn(`Household "${label}" has more named guests (${guests.length}) than max_party (${maxParty})`);
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
