-- What the first QA pass over the running app asked for (D19, D20).
--
-- Three additions, two of them for the driver on the road and one for the
-- coordinator publishing runs. None of them changes a rule; each stores something
-- the docs already allow but nothing was recording.
--
-- 1. A DEFAULT STAFF NOTE ON A ROUTE (D19).
--
--    "Every run on this route needs the same sentence" was being retyped per run,
--    or left off. The obvious shape — a new note field visible to drivers — is NOT
--    what this is, and the difference matters: PRD cap 11 and `domain-modeling.md`
--    (LOCKED) enumerate exactly FOUR note channels and say none of them share
--    storage. A fifth channel would contradict a locked doc.
--
--    So this is a DEFAULT, not a channel. It seeds `shift.staff_note` — channel 2,
--    coordinator→driver — when a run is published on this route, and is editable
--    before the run is saved. Nothing reads it after that: the shift owns its note
--    from creation onward, exactly as `recurrence_pattern.owner_default_id` seeds an
--    owner and then stops mattering. Editing a route never rewrites a published
--    run's note, which is the same independence I25 gives a materialized instance.
--
-- 2. A MAP LINK ON A DONOR (D20).
--
--    NULL is the normal state and means "derive one from `address`", which the
--    client does. The column exists for the case the address does not resolve to
--    the right place — a loading dock round the back, a site with several entrances.
--
-- 3. A PHOTO OF THE STORE (D20).
--
--    Drivers arriving somewhere new at 6am look for a door. A photo answers that
--    faster than an address does.
--
--    Its own table, not a `donor` column, for one reason: every `SELECT` against
--    `donor` in this codebase reads whole rows, and a bytea column would drag image
--    bytes into the board, the route builder, the admin list and the report. A
--    separate table means only the one endpoint that wants an image pays for it.
--
--    Bytes in Postgres rather than on disk, per D5 and D20: a file upload needs a
--    multipart dependency and a mounted volume, and a volume is a second thing to
--    back up beside the database. In the table it is already inside `pg_dump`.
--    The client resizes to ~800px JPEG before sending, so rows are tens of KB.
--
--    The size ceiling is a CHECK — tier 1, per `architecture.md §4.1`. The service
--    refuses oversized uploads with a readable message, but the refusal that cannot
--    be bypassed is this one.

ALTER TABLE route
  ADD COLUMN default_staff_note text;

ALTER TABLE donor
  ADD COLUMN map_url text;

CREATE TABLE donor_photo (
  -- PK, not just FK: one photo per store. Replacing it is an UPSERT, so there is
  -- no way to accumulate orphaned versions of the same door.
  --
  -- RESTRICT, like every other FK in the schema (`data-model.md §0`) — the rule is
  -- universal and the restrict IS the I21 history guard, so a photo is not the
  -- place to make the first exception. CASCADE was tempting here because a photo
  -- is not history and nothing is lost by dropping it with its store; the cost is
  -- that `removeDonor`'s hard-DELETE branch (the escape hatch for a mistaken
  -- create) would then fail for any donor that had one. `services/donor.ts`
  -- clears the photo inside that same transaction instead, which keeps the escape
  -- hatch working without a schema exception nobody would expect to find.
  donor_id   uuid PRIMARY KEY REFERENCES donor(id) ON DELETE RESTRICT,
  bytes      bytea NOT NULL,
  -- Narrow on purpose. The client encodes JPEG; PNG is accepted because a phone
  -- screenshot is a plausible thing to paste in. Anything else is a bug or an
  -- attempt, and neither should be stored.
  mime       text  NOT NULL CHECK (mime IN ('image/jpeg', 'image/png')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- ~400 KB. Comfortably above a resized 800px JPEG (tens of KB) and far below
  -- anything that would make a backup awkward at this scale.
  CONSTRAINT donor_photo_size CHECK (octet_length(bytes) BETWEEN 1 AND 400000)
);
