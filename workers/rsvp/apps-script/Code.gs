/**
 * Wedding Site tools for the planning sheet.
 *
 * - pullRSVPs: pulls RSVP responses from the Cloudflare Worker admin export
 *   into the "RSVP Responses" tab (overwritten each run) and writes
 *   attending/declined/pending counts to "RSVP Meta". Runs hourly from a
 *   time-driven trigger that targets it by name, so do not rename it.
 * - Preview push to site / Push guest list to site: sends the "Site Export"
 *   tab to the Worker so the site's guest list matches the sheet. Pushes only
 *   happen from the menu, never on edit or on a timer, so a half-typed name
 *   cannot reach the live site. RSVP responses are never changed by a push.
 *
 * Setup (one-time):
 * 1. In Apps Script: Project Settings (gear icon) → Script Properties → Add script property
 *    Name: RSVP_ADMIN_TOKEN
 *    Value: <your ADMIN_TOKEN from wrangler secret>
 * 2. Add script property:
 *    Name: RSVP_API_BASE
 *    Value: https://thebustos-rsvp.house-gpjb.workers.dev
 *    (no trailing slash)
 * 3. Save.
 * 4. Run pullRSVPs manually once to authorize and confirm it works.
 * 5. Then set up a time-based trigger:
 *    Triggers (clock icon) → Add Trigger
 *      Function: pullRSVPs
 *      Event source: Time-driven
 *      Type: Hour timer (every 1 hour) — or Day timer for daily
 *      Save. Google will ask for permissions again for the trigger.
 */

const RSVP_TAB = 'RSVP Responses';
const RSVP_META_TAB = 'RSVP Meta';
const SITE_EXPORT_TAB = 'Site Export';
const SITE_EXPORT_FIELDS = [
  'household_id',
  'household_label',
  'max_party',
  'guest_full_name',
  'plus_one_of_guest_name',
  'sheet_guest_id',
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Wedding Site')
    .addItem('Pull latest RSVPs', 'pullRSVPs')
    .addItem('Open RSVP Responses tab', 'openRSVPTab')
    .addSeparator()
    .addItem('Preview push to site', 'previewPushToSite')
    .addItem('Push guest list to site', 'pushGuestListToSite')
    .addToUi();
}

function pullRSVPs() {
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('RSVP_ADMIN_TOKEN');
  const apiBase = props.getProperty('RSVP_API_BASE');

  if (!token) {
    throw new Error('Missing script property: RSVP_ADMIN_TOKEN. See setup instructions in Code.gs.');
  }
  if (!apiBase) {
    throw new Error('Missing script property: RSVP_API_BASE. See setup instructions in Code.gs.');
  }

  const url = apiBase.replace(/\/$/, '') + '/api/admin/export';

  let response;
  try {
    response = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
      followRedirects: true,
    });
  } catch (e) {
    throw new Error('Network error fetching RSVPs: ' + e.message);
  }

  const code = response.getResponseCode();
  if (code === 401 || code === 403) {
    throw new Error('Auth failed (' + code + '). Check RSVP_ADMIN_TOKEN script property.');
  }
  if (code !== 200) {
    throw new Error('Unexpected response ' + code + ' from Worker: ' + response.getContentText().substring(0, 500));
  }

  const csv = response.getContentText();

  // Strip comment lines (# Totals, etc) and blank lines BEFORE parsing
  const cleaned = csv
    .split(/\r?\n/)
    .filter(line => line.trim().length > 0 && !line.trim().startsWith('#'))
    .join('\n');

  const rows = parseCSV_(cleaned);

  if (!rows.length) {
    throw new Error('Worker returned an empty CSV.');
  }

  // Parse the totals line separately for the meta tab
  const totalsLine = csv.split(/\r?\n/).find(line => line.trim().startsWith('# Totals'));
  const totals = parseTotalsLine_(totalsLine);

  writeToSheet_(rows);
  writeMetadata_(rows.length - 1, totals);
}

function openRSVPTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(RSVP_TAB);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('RSVP Responses tab does not exist yet. Run "Pull latest RSVPs" first.');
    return;
  }
  ss.setActiveSheet(sheet);
}

// --- Push guest list to site ---

/** Menu: dry run only. Shows what a push would change; writes nothing. */
function previewPushToSite() {
  const result = pushGuestsToSite_(true);
  if (result) showDiff_('Preview push to site (nothing was changed)', result);
}

/** Menu: dry run, confirm with the counts, then the real push and an RSVP pull. */
function pushGuestListToSite() {
  const ui = SpreadsheetApp.getUi();
  const preview = pushGuestsToSite_(true);
  if (!preview) return;
  if (countChanges_(preview) === 0 && preview.orphansWithResponses.length === 0) {
    ui.alert('Push guest list to site', 'The site already matches the Site Export tab. Nothing to push.', ui.ButtonSet.OK);
    return;
  }

  const answer = ui.alert(
    'Push guest list to site?',
    summarize_(preview) + '\n\nRSVP responses are never changed. Push these changes to the live site now?',
    ui.ButtonSet.YES_NO
  );
  if (answer !== ui.Button.YES) return;

  const result = pushGuestsToSite_(false);
  if (!result) return;
  pullRSVPs();
  showDiff_('Pushed to site. RSVP Responses refreshed.', result);
}

/**
 * Reads the Site Export tab by header name and POSTs it to the Worker.
 * Returns the diff, or null after showing an error dialog.
 */
function pushGuestsToSite_(dryRun) {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();
  const token = props.getProperty('RSVP_ADMIN_TOKEN');
  const apiBase = props.getProperty('RSVP_API_BASE');
  if (!token || !apiBase) {
    ui.alert('Missing script property RSVP_ADMIN_TOKEN or RSVP_API_BASE. See setup instructions in Code.gs.');
    return null;
  }

  let rows;
  try {
    rows = readSiteExport_();
  } catch (e) {
    ui.alert('Could not read the Site Export tab', e.message, ui.ButtonSet.OK);
    return null;
  }

  const response = UrlFetchApp.fetch(apiBase.replace(/\/$/, '') + '/api/admin/sync-guests', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify({ dryRun: dryRun, rows: rows }),
    muteHttpExceptions: true,
    followRedirects: true,
  });

  const code = response.getResponseCode();
  let body = null;
  try {
    body = JSON.parse(response.getContentText());
  } catch (e) {
    // Fall through to the generic error below.
  }

  if (code === 401 || code === 403) {
    ui.alert('Auth failed (' + code + '). Check the RSVP_ADMIN_TOKEN script property.');
    return null;
  }
  if (body && body.errors && body.errors.length) {
    showText_(
      'Site Export has problems. Nothing was pushed.',
      'Fix these in the sheet, then try again:\n\n- ' + body.errors.join('\n- ')
    );
    return null;
  }
  if (code !== 200 || !body) {
    ui.alert('Unexpected response ' + code + ' from Worker', response.getContentText().substring(0, 500), ui.ButtonSet.OK);
    return null;
  }
  return body;
}

function readSiteExport_() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SITE_EXPORT_TAB);
  if (!sheet) throw new Error('Tab not found: "' + SITE_EXPORT_TAB + '"');
  // Display values, so IDs and seat counts arrive exactly as shown in the sheet.
  const values = sheet.getDataRange().getDisplayValues();
  const header = values[0].map(h => String(h).trim());
  const index = {};
  SITE_EXPORT_FIELDS.forEach(f => {
    index[f] = header.indexOf(f);
    if (index[f] === -1) throw new Error('Missing column "' + f + '" in row 1 of ' + SITE_EXPORT_TAB);
  });

  return values
    .slice(1)
    .map(r => {
      const row = {};
      // guest_full_name may be blank: that is an unnamed plus-one seat.
      SITE_EXPORT_FIELDS.forEach(f => (row[f] = String(r[index[f]]).trim()));
      return row;
    })
    .filter(row => SITE_EXPORT_FIELDS.some(f => row[f] !== ''));
}

function countChanges_(d) {
  return d.householdsAdded.length + d.householdsUpdated.length + d.householdsRemoved.length +
    d.guestsAdded.length + d.guestsRenamed.length + d.guestsMoved.length + d.guestsRemoved.length;
}

function summarize_(d) {
  return [
    'Households added: ' + d.householdsAdded.length,
    'Households updated: ' + d.householdsUpdated.length,
    'Households removed: ' + d.householdsRemoved.length,
    'Guests added: ' + d.guestsAdded.length,
    'Guests renamed: ' + d.guestsRenamed.length,
    'Guests moved: ' + d.guestsMoved.length,
    'Guests removed: ' + d.guestsRemoved.length,
    'Kept because they already responded: ' + d.orphansWithResponses.length,
  ].join('\n');
}

function showDiff_(title, d) {
  const hh = id => 'HH' + ('00' + id).slice(-3);
  const lines = [summarize_(d)];
  const section = (name, items, fmt) => {
    if (items.length) lines.push('', name + ':', ...items.map(i => '  ' + fmt(i)));
  };
  section('Households added', d.householdsAdded, h => hh(h.id) + ' ' + h.label);
  section('Households updated', d.householdsUpdated, h => hh(h.id) + ' ' + h.label + ': ' + h.changes.join('; '));
  section('Households removed', d.householdsRemoved, h => hh(h.id) + ' ' + h.label);
  section('Guests added', d.guestsAdded, g => g.sheetGuestId + ' ' + g.name + ' (' + hh(g.householdId) + ')');
  section('Guests renamed', d.guestsRenamed, g => g.sheetGuestId + ' "' + g.from + '" -> "' + g.to + '"');
  section('Guests moved', d.guestsMoved, g => g.sheetGuestId + ' ' + g.name + ': ' + hh(g.fromHousehold) + ' -> ' + hh(g.toHousehold));
  section('Guests removed', d.guestsRemoved, g => g.name + ' (' + hh(g.householdId) + ')');
  section(
    'NOT removed because they already responded (still on the site; handle by hand)',
    d.orphansWithResponses,
    g => (g.sheetGuestId || 'no sheet id') + ' ' + g.name + ' (' + hh(g.householdId) + ')'
  );
  showText_(title, lines.join('\n'));
}

function showText_(title, text) {
  const html = HtmlService.createHtmlOutput(
    '<pre style="font:13px/1.45 monospace;white-space:pre-wrap;margin:0">' +
      text.replace(/&/g, '&amp;').replace(/</g, '&lt;') +
      '</pre>'
  ).setWidth(620).setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, title);
}

// --- RSVP pull helpers ---

function writeToSheet_(rows) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RSVP_TAB);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(RSVP_TAB);
  }

  // Normalize: pad every row to match the widest row (usually the header).
  const numCols = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const normalized = rows.map(r => {
    if (r.length === numCols) return r;
    const padded = r.slice();
    while (padded.length < numCols) padded.push('');
    return padded;
  });

  const numRows = normalized.length;
  sheet.getRange(1, 1, numRows, numCols).setValues(normalized);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, numCols).setFontWeight('bold').setBackground('#f0f0f0');
  sheet.autoResizeColumns(1, numCols);

  // Conditional formatting: highlight "Yes" / "No" attending values
  const attendingCol = findColumnIndex_(normalized[0], ['attending', 'is_attending', 'rsvp_status']);
  if (attendingCol !== -1) {
    const rangeA1 = sheet.getRange(2, attendingCol + 1, Math.max(numRows - 1, 1), 1);
    const rules = sheet.getConditionalFormatRules();
    const yesRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('Yes')
      .setBackground('#d9ead3')
      .setRanges([rangeA1])
      .build();
    const noRule = SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo('No')
      .setBackground('#f4cccc')
      .setRanges([rangeA1])
      .build();
    sheet.setConditionalFormatRules(rules.concat([yesRule, noRule]));
  }
}

function writeMetadata_(rowCount, totals) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(RSVP_META_TAB);
  if (!sheet) {
    sheet = ss.insertSheet(RSVP_META_TAB);
  }
  sheet.clear();
  sheet.getRange(1, 1, 1, 2).setValues([['Metric', 'Value']]).setFontWeight('bold').setBackground('#f0f0f0');

  const now = new Date();
  const tz = Session.getScriptTimeZone();
  const stamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd HH:mm:ss z');

  const meta = [
    ['Last synced', stamp],
    ['Guest rows pulled', rowCount],
  ];

  if (totals) {
    if (totals.attending !== undefined) meta.push(['Attending', Number(totals.attending)]);
    if (totals.not_attending !== undefined) meta.push(['Declined', Number(totals.not_attending)]);
    if (totals.no_reply !== undefined) meta.push(['No reply yet', Number(totals.no_reply)]);
  }

  sheet.getRange(2, 1, meta.length, 2).setValues(meta);
  sheet.autoResizeColumns(1, 2);
}

function parseTotalsLine_(line) {
  if (!line) return null;
  // Format: # Totals,attending=6,not_attending=2,no_reply=196
  const parts = line.replace(/^#\s*Totals,?/, '').split(',');
  const totals = {};
  parts.forEach(p => {
    const [k, v] = p.split('=').map(s => s.trim());
    if (k && v !== undefined) totals[k] = v;
  });
  return totals;
}

/**
 * CSV parser that handles quoted fields, escaped quotes, and embedded newlines.
 * More robust than string.split(',') which breaks on commas inside quoted fields.
 */
function parseCSV_(text) {
  const rows = [];
  let field = '';
  let row = [];
  let inQuotes = false;
  let i = 0;

  // Normalize line endings
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < text.length) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        field += c;
        i++;
        continue;
      }
    } else {
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ',') {
        row.push(field);
        field = '';
        i++;
        continue;
      }
      if (c === '\n') {
        row.push(field);
        rows.push(row);
        row = [];
        field = '';
        i++;
        continue;
      }
      field += c;
      i++;
    }
  }

  // Flush last field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop trailing fully-empty rows
  while (rows.length && rows[rows.length - 1].every(v => v === '')) {
    rows.pop();
  }

  return rows;
}

function findColumnIndex_(headerRow, candidates) {
  const lower = headerRow.map(h => String(h).trim().toLowerCase());
  for (const cand of candidates) {
    const idx = lower.indexOf(cand.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}
