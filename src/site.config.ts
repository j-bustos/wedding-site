// Single source of truth for dates, venues, and contact/config values used
// across the site (both in .astro frontmatter and, via literal interpolation
// or JSON, in client-side scripts).

export const WEDDING_DATE_ISO = '2026-12-18T15:00:00-06:00';
export const RSVP_DEADLINE_ISO = '2026-11-18T23:59:59-06:00';

export const CEREMONY = {
  name: 'Holy Spirit Catholic Church',
  address: '2201 Martin Ave, McAllen, TX 78504',
  startIso: '2026-12-18T15:00:00-06:00',
  endIso: '2026-12-18T16:30:00-06:00',
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

// Reusing the existing CashApp gift link as the site's registry/gift link.
export const REGISTRY_URL = 'https://cash.app/$JamalAndGabbie';
export const REGISTRY_HANDLE = '$JamalAndGabbie';

// TODO(owner): deploy workers/rsvp (see workers/rsvp/README.md) and paste the
// printed *.workers.dev URL here.
export const RSVP_API_BASE = 'https://thebustos-rsvp.YOUR-SUBDOMAIN.workers.dev';

// TODO(owner): create a Turnstile site (see workers/rsvp/README.md) and paste
// the public site key here. This value is public/safe to commit — the secret
// key lives only as a Worker secret. Left blank, the RSVP form skips
// rendering the Turnstile widget so local development still works end-to-end
// against the Worker's test secret key.
export const TURNSTILE_SITE_KEY = '';
