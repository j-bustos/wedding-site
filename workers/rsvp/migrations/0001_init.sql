CREATE TABLE households (
  id INTEGER PRIMARY KEY,
  label TEXT NOT NULL,              -- "The Garza Family"
  max_party INTEGER NOT NULL,       -- total seats incl. named guests
  responded_at TEXT,                -- ISO timestamp of latest submission
  message TEXT                      -- optional note to the couple
);

CREATE TABLE guests (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL REFERENCES households(id),
  full_name TEXT NOT NULL,          -- canonical, as invited
  normalized_name TEXT NOT NULL,    -- lowercased, accent-stripped, punctuation-stripped
  is_named_guest INTEGER NOT NULL DEFAULT 1,  -- 0 = unnamed plus-one seat
  attending INTEGER,                -- NULL = no response, 1/0
  dietary_notes TEXT,
  song_request TEXT
);

CREATE INDEX idx_guests_norm ON guests(normalized_name);

-- NOTE: deviates from a single-column PRIMARY KEY on `nickname` because the
-- seed data below has one-to-many mappings (e.g. "beto" -> alberto/roberto/
-- humberto), which a single-column PK can't store. Lookups still key off
-- `nickname` (see idx_nicknames_nickname); this composite PK just allows more
-- than one formal name per nickname.
CREATE TABLE nicknames (
  nickname TEXT NOT NULL,
  formal TEXT NOT NULL,
  PRIMARY KEY (nickname, formal)
);
CREATE INDEX idx_nicknames_nickname ON nicknames(nickname);
CREATE INDEX idx_nicknames_formal ON nicknames(formal);

CREATE TABLE rsvp_log (
  id INTEGER PRIMARY KEY,
  household_id INTEGER NOT NULL,
  payload TEXT NOT NULL,            -- full submission JSON
  ip_hash TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
