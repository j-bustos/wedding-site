export interface Env {
  DB: D1Database;
  ALLOWED_ORIGIN: string;
  RSVP_DEADLINE: string;
  TURNSTILE_SECRET_KEY: string;
  ADMIN_TOKEN: string;
  IP_HASH_SALT: string;
}

export interface GuestResponseInput {
  guestId: number;
  attending: boolean;
  dietaryNotes?: string;
  songRequest?: string;
}

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
