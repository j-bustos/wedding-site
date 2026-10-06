-- Stable key from the planning sheet's Site Export tab: the sheet Guest ID
-- ("193") for a named guest, host ID + "-P" ("193-P") for a plus-one seat.
-- POST /api/admin/sync-guests upserts on it. NULL until backfilled; SQLite
-- unique indexes allow any number of NULLs.
ALTER TABLE guests ADD COLUMN sheet_guest_id TEXT;

CREATE UNIQUE INDEX idx_guests_sheet_guest_id ON guests(sheet_guest_id);
