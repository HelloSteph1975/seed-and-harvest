# Seed & Harvest Stage 4: Greenhouses and Microgreens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen for Stage 1 and kept) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Microgreens on short repeating cycles, for people and for animals.
- A tray records:
  - the crop and the rack it sits on
  - how many trays, and how much seed
  - the date it was sown and the expected harvest date
  - who it's for: people, or one of the owner's animals
  - a status
- "Sow again" starts the next tray of the same crop. A repeat setting (every N days) keeps a steady supply, and Today says when to sow the next one.
- The owner keeps a list of their animals. Goats and chickens use the library's safety ratings, and any other kind of animal gets its own ratings in the plant form.
- Choosing an animal warns when the crop is marked "avoid" for it, and gives a gentler note for "small amounts".
- Each greenhouse gets its own notes for each season, and its page shows the current season's note first.

**Architecture:**
- New versioned, soft-deleted tables: `animals`, `plant_animal_safety` (ratings for the owner's other animals) and `trays`.
- Repeats are a chain: every tray in a series shares `series_id`, the newest tray carries `repeat_days`, and the next sowing date is worked out from it when read. Nothing is stored ahead of time.
- Greenhouse season notes are four new columns on `spaces`, kept only for greenhouses, just as other space fields are kept only for their own kinds.
- Today and the calendar gain tray lines from one new endpoint.

**Tech Stack:** As Stages 1 to 3. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`, sections "Greenhouses and microgreens", "Growing spaces" (greenhouse season notes), "Plant library" (animal safety, "Users can add their own animal kinds") and "Today and Calendar" (trays ready to harvest). Earlier plans: `docs/superpowers/plans/`.

## Global Constraints

- Everything in the Stage 1 to 3 Global Constraints still holds:
  - Ports 4215, demo 4217, browser tests 4219.
  - Saving rules: `version`, 409 with `current`, the Trash, and `useResource` / `useRecordForm` only.
  - Dates are stored as `YYYY-MM-DD`. "Today" means the place's own date.
  - Seed amounts are stored in grams; the screen converts.
  - No personal details in the public repo (tests use Springfield; demo animals have generic names).
  - Plain text with no em dashes, and run `/unslop` on human-facing text.
- Animal safety stays conservative:
  - Every warning tells the reader to check with a vet.
  - An animal with no rating for a crop is treated as "not rated": the form says so and suggests asking a vet. It is never treated as safe.
- Microgreen harvests are recorded in Stage 6. In this stage, a tray's "harvested" status and date are all that's kept.
- Never write to The Apothecary or Hearth & Larder.

## Review Focus

1. **Choosing an animal for a crop marked "avoid", "small amounts", or not rated** → the form warns plainly before saving, and the tray page and Today show the warning again. A rating changed later in the library shows up on existing trays. Tests in Tasks 1 and 3.
2. **Repeats** → "Sow again" on the newest tray of a series moves the next-sowing date forward, and sowing again on an older tray goes to the end of the chain. Stopping the repeat removes the "sow next" line. Deleting the newest tray hands the repeat back to the tray before it, and restoring brings it back. Tests in Task 2.
3. **A rack that's full** → the form warns when the active trays on a rack would go over its tray count, but still saves (racks get crowded in real life). Trays on a deleted rack go to the Trash with it and come back with it. Tests in Tasks 2 and 3.
4. **Season notes across hemispheres** → a greenhouse page shows the right season first for a southern place, using the same months as Today. Notes on a space that stops being a greenhouse are cleared, the same as other kind-only fields. Tests in Task 5.
5. **Spanish screen** → crop names, animal ratings and the new labels come from the packs. Animal names show exactly as typed. Tests in Tasks 3 and 4.

---

### Task 1: Animals and their safety ratings

**Files:** `server/db/migrations.js` (migration 9), `server/db/repos.js`, `server/services/animals.js`, `server/routes/animals.js`, `server/routes/index.js`, `server/services/plants.js` (ratings for other animals saved with the plant), `server/services/trash.js`, `tests/server/animals.test.js`

Migration 9 (shared with Tasks 2 and 5):
```sql
CREATE TABLE animals (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('goat', 'chicken', 'other')), notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
CREATE TABLE plant_animal_safety (plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE,
  animal_id INTEGER NOT NULL REFERENCES animals(id) ON DELETE CASCADE,
  safety TEXT NOT NULL CHECK (safety IN ('safe', 'small', 'avoid')), PRIMARY KEY (plant_id, animal_id));
CREATE TABLE trays (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id INTEGER NOT NULL REFERENCES plants(id),
  space_id INTEGER NOT NULL REFERENCES spaces(id), animal_id INTEGER REFERENCES animals(id),
  tray_count INTEGER NOT NULL DEFAULT 1, seed_g REAL, sown_on TEXT NOT NULL, harvest_on TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'growing' CHECK (status IN ('planned', 'growing', 'harvested', 'discarded')),
  harvested_on TEXT, series_id INTEGER, repeat_days INTEGER, notes TEXT, ${TS});
CREATE INDEX idx_trays_space ON trays(space_id);
CREATE INDEX idx_trays_series ON trays(series_id);
ALTER TABLE spaces ADD COLUMN notes_spring TEXT;
ALTER TABLE spaces ADD COLUMN notes_summer TEXT;
ALTER TABLE spaces ADD COLUMN notes_fall TEXT;
ALTER TABLE spaces ADD COLUMN notes_winter TEXT;
```

**Interfaces:**
- Produces: `safetyFor(db, plant, animal) → 'safe' | 'small' | 'avoid' | null`.
  - Goats read `plant.safety_goats`, chickens read `plant.safety_chickens`, and other animals read `plant_animal_safety`.
  - `null` means not rated.
- Produces: `GET/POST /api/animals`, `GET/PATCH/DELETE /api/animals/:id`, `POST /api/animals/:id/restore`.
- Produces: the plant API gains `animal_safety: [{ animal_id, safety }]` on read and on save, for animals of kind `other` only. Like `preserves`, the list is replaced whole on save, and it is kept only for microgreens.

Rules:
- Name: 1 to 60 characters. Notes: up to 2000.
- Deleting an animal sends it to the Trash. Its trays keep their link and show "(in the Trash)".
- Purging an animal sets `trays.animal_id` to null and deletes its safety rows.
- Trash type `animal`; it can be restored at any time.

- [ ] Tests (names):
  - `an animal saves, lists in order and a stale save is 409`
  - `goats and chickens read the plant's ratings, other animals read their own`
  - `a plant saves ratings for other animals and replaces them whole`
  - `ratings for goats or chickens can't be saved as other-animal ratings`
  - `deleting an animal forever unlinks its trays and drops its ratings`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 2: Trays and repeats

**Files:** `server/services/trays.js`, `server/routes/trays.js`, `server/routes/index.js`, `server/services/spaces.js` and `places.js` (cascades), `server/services/plants.js` (a plant with live trays can't be deleted, like plantings), `server/services/trash.js`, `server/services/photos.js` (`PHOTO_OWNERS.tray`), `tests/server/trays.test.js`

**Interfaces:**
- Produces: `GET /api/trays?place_id=&status=&space_id=` returns trays with:
  - `plant` {id, name, starter_key, is_starter, seed_g_per_tray, days_min, days_max, soak_hours}
  - `space` {id, name, tray_count}
  - `animal` {id, name, kind, deleted}
  - `safety` (from `safetyFor`)
  - `next_sow_on` (only on the newest tray of a series that has `repeat_days`)
- Produces: `GET /api/trays/:id`, POST, PATCH, DELETE and restore.
- Produces: `POST /api/trays/:id/sow-again` with body `{ sown_on }`, which returns the new tray.
- Produces: `GET /api/trays/due?place_id=&from=&to=` returns `{ ready, sow }`, where `ready` is growing trays whose `harvest_on <= to` and `sow` is series whose `next_sow_on <= to`, each with plant, space, animal and safety.

Rules:
- `plant_id` must be a live microgreen (400 `not_microgreen`).
- `space_id` must be a live space of any kind. The form suggests racks first.
- `harvest_on` defaults to `sown_on + days_min`, or + 7 when the plant has no days. It must not be before `sown_on` (400 `range_order`).
- `seed_g` defaults to `tray_count × seed_g_per_tray`.
- `repeat_days` is 1 to 60, or null.
- A new tray starts its own series (`series_id = id`).
- Setting `status: 'harvested'` without `harvested_on` stamps it with the date the client sends.
- The form sends `status: 'planned'` when the sown date is after the place's today, and the tray page has a Sown today button that sets it growing. `due.ready` only counts growing trays, and a planned tray's sowing shows in `due.sow` on its date.
- **Sow again:**
  - Copies the plant, space, animal, tray count, seed and notes, and sets `harvest_on` from the new sowing date.
  - Joins the same series. `repeat_days` moves from the series' newest tray to the new one, so only the newest tray carries it.
  - Sowing again from an older tray still joins the end of the chain.
- `next_sow_on` is the newest tray's `sown_on + repeat_days`.
- Stopping a repeat means PATCH `repeat_days: null` on the newest tray.
- Deleting the newest tray of a series hands its `repeat_days` to the next newest live tray. Restoring it takes the repeat back when it is newer again.
- Trays go to the Trash with their space or place, sharing the same stamp, and come back with it. A tray can't be restored while its space or plant is in the Trash (409 `parent_in_trash`).
- Purge order: photo, log, task, tray, planting, ...

- [ ] Tests (names):
  - `a tray defaults its harvest date and seed amount from the plant`
  - `a crop that isn't a microgreen is refused`
  - `sow again joins the series and moves the repeat to the new tray`
  - `sow again from an older tray goes to the end of the chain`
  - `stopping the repeat clears the next sowing`
  - `deleting the newest tray hands the repeat back, restore takes it again`
  - `trays go to the Trash with their rack and come back with it`
  - `due lists trays ready to cut and series due to sow in the range`
  - `a plant with live trays can't be deleted`
  - `harvested without a date takes the date sent`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 3: Microgreens screens

**Files:**
- New: `client/src/screens/microgreens/Microgreens.jsx`, `TrayForm.jsx`, `TrayPage.jsx`, `Animals.jsx`, `AnimalDialog.jsx`
- New: `client/src/lib/safety.js` (`safetyNote(safety, animal, t)`)
- Changed: `client/src/App.jsx`, `client/src/components/Sidebar.jsx` (Microgreens after Spaces, as the design orders it), `client/src/screens/library/PlantForm.jsx` (a "Your other animals" rating per animal in the microgreen section), `client/src/screens/library/PlantPage.jsx` (other animals' ratings in Facts), `client/src/screens/Trash.jsx`, `client/src/i18n/en.json`
- Test: `tests/client/microgreens.test.jsx`

Screens:
- **Microgreens** (`/microgreens?place=`):
  - Growing trays grouped by rack. Each shows days to go or "Ready to cut", and who it's for, with a warning tag when the crop isn't safe for that animal.
  - A "Sow next" list for series that are due.
  - Buttons: Sow a tray, and Animals.
  - Recent harvested trays, last 30 days.
- **Tray form** (`/microgreens/trays/new?plant=&space=`, and edit):
  - Fields: place, rack (racks first, then other spaces), crop (microgreens only, by shown name), tray count, sown date (default today), expected harvest (filled from the crop's days until the owner changes it), seed (in the chosen units, filled from the crop), for (People or each animal), repeat every N days (optional), notes.
  - The crop's soak hours show under the crop as a reminder.
  - Warnings, shown live:
    - "avoid": "Not safe for {animal}. Check with your vet before feeding any new crop."
    - "small": "Only small amounts for {animal}."
    - Not rated: "Not rated for {animal} yet. Ask your vet first."
    - Rack full: "{rack} holds {n} trays and would have {m}."
- **Tray page:**
  - The crop (with a link to its microgreens guide), rack, dates, for whom with the safety note, status.
  - Buttons: Harvested today, Discard, Sow again, Stop repeating, Edit, Delete.
  - A photo gallery.
- **Animals** (`/microgreens/animals`):
  - Add, edit and delete animals: name, kind (Goat, Chicken, Other) and notes. Reordering is not needed.
  - An intro line says goats and chickens use the library's ratings, and other animals are rated on each microgreen's page.

- [ ] Tests (names):
  - `the form fills harvest date and seed from the crop and keeps an owner's change`
  - `choosing goats for mustard warns it isn't safe`
  - `an animal with no rating says to ask a vet first`
  - `a full rack warns but still saves`
  - `sow again from the tray page posts today's date and opens the new tray`
  - `the list shows Ready to cut and the sow-next line`
  - `the plant form saves a rating for another animal`
  - `Spanish: crop names and rating words come from the packs`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 4: Today and the calendar

**Files:** `client/src/screens/today/Today.jsx`, `client/src/screens/today/TrayList.jsx`, `client/src/screens/calendar/items.js`, `Calendar.jsx`, `DayPanel.jsx`, `client/src/i18n/en.json`, `tests/client/today.test.jsx`, `tests/client/calendar.test.jsx`

- **Today:** a "Microgreens" section, read from `GET /api/trays/due` for the current week:
  - "Ready to cut" lists trays ready today or overdue. Each line has a Harvested button that sends the place's today.
  - "Sow next" lists series due today or overdue, with a Sow now button. The coming week's sowings and cuttings show under This week.
  - Warning tags show here too.
- **Calendar:**
  - A tray's harvest date shows as "Cut {crop}".
  - A series' next sowing shows as "Sow {crop}".
  - Each opens the tray.

- [ ] Tests (names):
  - `Today lists trays ready to cut and a series due to sow, with Harvested and Sow now`
  - `a tray for goats with an avoid crop shows its warning on Today`
  - `the calendar shows tray cuttings and next sowings on their days`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 5: Greenhouse season notes

**Files:** `server/services/spaces.js` (`KIND_FIELDS.greenhouse` gains the four note fields), `server/db/repos.js` (`SPACE_COLUMNS`), `client/src/screens/spaces/SpaceForm.jsx`, `client/src/screens/spaces/SpacePage.jsx`, `client/src/lib/seasons.js` (`seasonOf(monthNumber, hemisphere) → 'spring' | 'summer' | 'fall' | 'winter'`), `client/src/i18n/en.json`, `tests/server/spaces.test.js`, `tests/client/spaces.test.jsx`

Seasons by month:
- North: Mar to May spring, Jun to Aug summer, Sep to Nov fall, Dec to Feb winter.
- South: shifted by six months.

The greenhouse page shows "This season ({season})" first, then the other three notes. Empty notes are left out. When none are written, it shows a hint to add what grows there in each season.

- [ ] Tests (names):
  - `greenhouse season notes save and are cleared when the space becomes a bed`
  - `a southern greenhouse in July shows the winter note first`
  - `a greenhouse with no season notes shows the hint`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 6: Search, demo, docs and browser tests

**Files:** `server/services/search.js` (trays by crop name and notes, animals by name), `client/src/screens/search/Search.jsx`, `server/demo/seed.js`, `README.md` (a Microgreens and animals section, and greenhouse season notes), `e2e/microgreens.spec.js`, `tests/server/search.test.js`, `tests/server/demo.test.js`

- The demo adds:
  - Two generic animals: "The goats" (goat) and "The hens" (chicken).
  - A pea shoot series for the goats repeating every 5 days, with one tray ready today.
  - A radish tray for people.
  - Season notes on the big greenhouse.

- [ ] Tests (names):
  - `search finds a tray by its crop's Spanish name and an animal by name`
  - `the demo has animals, a repeating series and a tray ready to cut`
- [ ] Browser tests (names):
  - `sow a tray for the goats, see the warning for an avoid crop, sow again and the next sowing moves`
  - `Today shows a tray ready to cut and Harvested moves it out`
  - `deleting a rack takes its trays to the Trash and restore brings them back`
- [ ] Run everything → commit.

### Task 7: Ship

- [ ] Whole-branch review on the most capable model, then one fix pass with each fix written test-first.
- [ ] Evidence, before and after shots:
  - Today with microgreens
  - Microgreens list
  - Tray form showing a warning
  - Tray page
  - Animals
  - Greenhouse page with season notes
  - Today on a phone
- [ ] Shipping:
  - Push to the private repo.
  - Make one clean public commit and open the PR.
  - Run greploop with `@greptile-apps review` until 5/5.
- [ ] Merge, install and add the Spanish keys only on her OK.
