-- Attributes an unnamed plus-one seat (or a named-but-not-yet-known plus-one)
-- to the specific guest it belongs to, instead of it floating as a generic
-- household seat. NULL for every guest who isn't someone else's plus-one.
ALTER TABLE guests ADD COLUMN plus_one_of INTEGER REFERENCES guests(id);

CREATE INDEX idx_guests_plus_one_of ON guests(plus_one_of);
