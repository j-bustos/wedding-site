export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  RSVP_DEADLINE: string;
  TURNSTILE_SECRET_KEY: string;
  ADMIN_TOKEN: string;
  IP_HASH_SALT: string;
}

/** A response's attributed plus-one, nested under the sponsoring guest. */
export interface AttributedPlusOneInput {
  attending: boolean;
  name?: string;
  dietaryNotes?: string;
}

export interface GuestResponseInput {
  guestId: number;
  attending: boolean;
  dietaryNotes?: string;
  songRequest?: string;
  /** Only meaningful when this guest has an attributed plus-one seat. */
  plusOne?: AttributedPlusOneInput;
}

/** A generic, unattributed household plus-one seat (not tied to a named guest). */
export interface PlusOneInput {
  name: string;
  attending: true;
  dietaryNotes?: string;
}

export interface RsvpSubmission {
  turnstileToken: string;
  householdId: number;
  responses: GuestResponseInput[];
  plusOnes?: PlusOneInput[];
  message?: string;
}
