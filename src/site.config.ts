// Single source of truth for dates, venues, and contact/config values used
// across the site (both in .astro frontmatter and, via literal interpolation
// or JSON, in client-side scripts).

// The homepage Gallery section (#gallery, src/pages/index.astro + the shared
// lightbox in src/layouts/BaseLayout.astro) is an intentional, permanent
// part of this build — reconfirmed by the owner 2026-08-15 after it was
// mistakenly dropped from an earlier cleanup pass. Do not remove it in a
// future cleanup without explicit owner sign-off.

export const WEDDING_DATE_ISO = '2026-12-18T15:00:00-06:00';
export const RSVP_DEADLINE_ISO = '2026-11-18T23:59:59-06:00';

export const CEREMONY = {
  name: 'Holy Spirit Catholic Church',
  address: '2201 Martin Ave, McAllen, TX 78504',
  startIso: '2026-12-18T15:00:00-06:00',
  endIso: '2026-12-18T16:00:00-06:00',
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Holy+Spirit+Catholic+Church,+2201+Martin+Ave,+McAllen,+TX+78504',
};

export const RECEPTION = {
  name: 'Los Encinos Event Center',
  address: '17256 La Blanca Road, Donna, TX 78537',
  doorsIso: '2026-12-18T17:00:00-06:00', // happy hour
  startIso: '2026-12-18T18:00:00-06:00', // reception proper
  endIso: '2026-12-19T00:00:00-06:00', // last dance
  mapsUrl:
    'https://www.google.com/maps/search/?api=1&query=Los+Encinos+Event+Center,+17256+La+Blanca+Road,+Donna,+TX+78537',
};

// Fixed absolute instants (not viewer-local) bounding "wedding day" for the
// lifecycle hero's day-of state.
export const WEDDING_DAY_START_ISO = '2026-12-18T00:00:00-06:00';
export const WEDDING_DAY_END_ISO = '2026-12-19T00:00:00-06:00';

export const CONTACT_EMAIL = 'thebustos2026@gmail.com';

// TODO(owner): no phone number exists anywhere in the repo. The RSVP flow's
// "can't find your name" / "RSVPs closed" fallbacks are written to prefer a
// phone number and fall back to email when this is null. Fill in once you
// have one you're comfortable publishing on the site.
export const CONTACT_PHONE: string | null = null;

// TODO(owner): no shared photo album exists yet. The post-wedding "thank you"
// hero state links here only when non-null.
export const PHOTO_SHARE_URL: string | null = null;

// This is a gift link (CashApp), not a formal registry — the FAQ/Gifts
// copy is worded accordingly.
export const REGISTRY_URL = 'https://cash.app/$JamalAndGabbie';
export const REGISTRY_HANDLE = '$JamalAndGabbie';

export const RSVP_API_BASE = 'https://thebustos-rsvp.house-gpjb.workers.dev';

// Turnstile site key (public/safe to commit — the secret key lives only as
// a Worker secret, set via `wrangler secret put TURNSTILE_SECRET_KEY`).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAERGidth-dx22h4B';
