# RSVP Worker

Cloudflare Worker + D1 backend for thebustos2026.com's RSVP flow: fuzzy guest
lookup (handles accents, nicknames, typos), per-guest attend/decline with
plus-one seats, dietary/song requests, and an admin CSV export.

Independent npm project — not part of the Astro build. Run all commands from
this directory (`workers/rsvp/`).

## One-time setup

```bash
npm install
npx wrangler login          # opens a browser to authenticate with your Cloudflare account
npx wrangler d1 create thebustos-rsvp
```

Copy the `database_id` printed by `d1 create` into **both** `[[d1_databases]]`
blocks in `wrangler.toml` (the top-level one and the one under `[env.dev]`) in
place of `REPLACE_WITH_D1_DATABASE_ID`.

Run the migrations (creates all tables + seeds the nickname table):

```bash
npx wrangler d1 migrations apply thebustos-rsvp --local    # for local `wrangler dev`
npx wrangler d1 migrations apply thebustos-rsvp --remote   # for the deployed Worker
```

## Turnstile setup

1. In the Cloudflare dashboard, go to **Turnstile** → **Add site**, add
   `thebustos2026.com` (and `localhost` for dev).
2. Put the **site key** into the Astro site's `src/site.config.ts`
   (`turnstileSiteKey` — this one is public, safe to commit).
3. Set the **secret key** as a Worker secret (never commit it):
   ```bash
   npx wrangler secret put TURNSTILE_SECRET_KEY
   ```

## Other secrets

```bash
npx wrangler secret put ADMIN_TOKEN       # long random string; used as `Authorization: Bearer <token>` for /api/admin/export
npx wrangler secret put IP_HASH_SALT      # long random string; salts the IP hashing used for rate limiting + audit logging
```

For local `wrangler dev`, copy `.dev.vars.example` to `.dev.vars` (gitignored)
and fill in dev-only values — `wrangler dev` reads secrets from that file
instead of the Cloudflare secret store.

## Seeding the guest list

The real guest list (`guest-list.csv`) is never committed — it's gitignored.
Format (one row per **named** guest; repeat the household row for each
member):

```csv
household_label,max_party,guest_full_name
The Garza Family,4,Jose Garza
The Garza Family,4,Maria Garza
```

`max_party` is the total seats for the household including named guests —
any excess becomes an unnamed plus-one seat, filled in later when that
household RSVPs.

```bash
cp guest-list.example.csv guest-list.csv   # then replace with the real list
npm run seed                               # writes seed-output.sql
npx wrangler d1 execute thebustos-rsvp --local  --file=seed-output.sql
npx wrangler d1 execute thebustos-rsvp --remote --file=seed-output.sql   # production — double check first!
```

Re-running the seed script/migrations against a database that already has
data will fail on the primary-key inserts — this is meant to run once against
a fresh D1 database per environment.

## Local development

```bash
npm run dev            # wrangler dev, binds to the local D1 + .dev.vars
```

Point the Astro dev server's `RSVP_API_BASE` (in `src/site.config.ts`) at the
printed `http://127.0.0.1:8787` URL while iterating locally.

## Testing

```bash
npm test         # vitest — pure unit tests for the name-matching logic
npm run typecheck
```

`test/matching.test.ts` covers: accented vs. unaccented input, nickname input
(both directions), a one-typo input, a married-name mismatch (correctly
returns no match), and two same-named guests in different households
(correctly returns the ambiguous path). These are pure-function tests and
don't need a live D1/Workers runtime.

## Deploying

```bash
npx wrangler deploy
```

This deploys to the free `<worker-name>.<your-subdomain>.workers.dev` URL by
default (printed after deploy). Put that URL into the Astro site's
`RSVP_API_BASE` (`src/site.config.ts`) and rebuild/redeploy the static site.

If thebustos2026.com's DNS is ever moved onto Cloudflare, you can instead
route a subdomain (e.g. `api.thebustos2026.com`) straight to this Worker —
see the commented-out `[[routes]]` block in `wrangler.toml`.

## Direct SQL access

For ad-hoc queries against production data:

```bash
# Everyone who hasn't responded yet
npx wrangler d1 execute thebustos-rsvp --remote --command \
  "SELECT h.label, g.full_name FROM guests g JOIN households h ON h.id = g.household_id WHERE g.attending IS NULL AND g.is_named_guest = 1;"

# Attending headcount
npx wrangler d1 execute thebustos-rsvp --remote --command \
  "SELECT COUNT(*) AS attending FROM guests WHERE attending = 1;"

# All dietary notes
npx wrangler d1 execute thebustos-rsvp --remote --command \
  "SELECT full_name, dietary_notes FROM guests WHERE dietary_notes IS NOT NULL AND dietary_notes != '';"

# Full households + responses (same data as the CSV export, raw)
npx wrangler d1 execute thebustos-rsvp --remote --command \
  "SELECT h.label, h.max_party, h.responded_at, h.message FROM households h;"
```

Or hit the export endpoint directly for a ready-made CSV:

```bash
curl -H "Authorization: Bearer <ADMIN_TOKEN>" https://<worker-url>/api/admin/export -o rsvps.csv
```

## API summary

- `POST /api/lookup` — `{ name, turnstileToken }` → `{status: "found"|"ambiguous"|"not_found"|"rate_limited", ...}`
- `POST /api/rsvp` — `{ turnstileToken, householdId, responses[], plusOnes[], message? }` → `{status: "ok"|"closed", ...}`
- `GET /api/admin/export` — `Authorization: Bearer <ADMIN_TOKEN>` → CSV

CORS is locked to `ALLOWED_ORIGIN` (`https://thebustos2026.com` in production,
`http://localhost:4321` in `[env.dev]`) — requests from any other origin get
no `Access-Control-Allow-Origin` header and are rejected by the browser.

## Known deviations from the original spec

- `nicknames` uses a composite primary key `(nickname, formal)` instead of a
  single-column PK on `nickname`, because the seed data has genuine
  one-to-many mappings (e.g. "beto" → alberto/roberto/humberto) that a
  single-column PK can't store without collisions.
- One additional table, `rate_limit_lookup`, backs the 10-requests/10-minutes
  lookup rate limit — additive, doesn't change the four originally specified
  tables.
