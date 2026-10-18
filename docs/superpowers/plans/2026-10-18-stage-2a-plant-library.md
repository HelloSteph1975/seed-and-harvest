# Seed & Harvest Stage 2A: Plant Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen for Stage 1 and kept) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A plant library that teaches: plants with their timing, size, sun and yield facts, varieties, step-by-step guides (shared basics guides plus short plant-specific steps with supply lists), each plant's planting dates worked out for a chosen place, search across the library, and the first batch of original starter content (10 basics guides and 30 food plants). Stage 2B adds the rest of the plants.

**Architecture:** New `plants`, `plant_varieties`, `plant_preserves`, `guides`, `guide_steps` and `guide_supplies` tables, versioned like everything else. Starter content lives in `server/content/` as JSON with `starter_key` and `content_version`, seeded the way The Grimoire seeds its correspondences (never re-adding what the owner deleted forever, updating only untouched starter rows). Planting windows are pure functions shared by screens. Translations of starter text come from the data folder's `content.json`, as in The Grimoire.

**Tech Stack:** As Stage 1. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`, section "Plant library (teaching)". Stage 1 plan: `docs/superpowers/plans/2026-10-17-stage-1-foundation-and-places.md`.

## Global Constraints

- Everything in Stage 1's Global Constraints still holds (ports, names, saving rules, metric storage, no personal details in the public repo, plain text with no em dashes, `/unslop` on human-facing text).
- All starter text is original, written for this app. Timing, spacing and yield figures are common horticultural rules of thumb and are labeled as such on screen ("Rule of thumb"). No invented sources.
- Starter keys: `plant.<slug>` (e.g. `plant.tomato`), `guide.basics.<slug>`, `guide.<plant-slug>.<stage>`. Content keys in `content.json`: `<starter_key>.<field>`, guide steps as `<starter_key>.step.<n>`, supplies as `<starter_key>.supply.<n>.name` and `.amount` (n from 1).
- Stored units: spacing in centimeters, pot size in liters, yield in kilograms, seed per tray in grams. The screen converts (inches, gallons, pounds, ounces in US units).
- Timing is stored in weeks relative to frost dates; frost-free places use month lists.

## Review Focus

1. **A place with only one frost date, or none, or frost-free** → the plant page shows the windows it can work out and says plainly which date it needs for the rest, never an empty or wrong date. Tests in Task 4.
2. **Windows that cross the new year or come before today** (fall sowing in the south, starting seeds in December) → dates land in the right year and the next upcoming window is shown first. Tests in Task 4.
3. **The owner edits or deletes a starter plant, then the app updates its starter content** → edits are never overwritten, deleted-forever plants never return, deleting a plant takes its own guides and varieties to the Trash and restore brings them back. Tests in Tasks 1 to 3.
4. **Spanish screen with starter content** → names, summaries, guide titles, steps and supplies show in Spanish when the pack has them, the owner's edited text shows as typed, and search finds a plant by its Spanish name. Tests in Tasks 3 and 6.
5. **US units on small numbers** (spacing 46 cm shows 18 in; 3 g of seed shows 0.1 oz) → sensible rounding, and an untouched field saves back exactly as stored. Tests in Tasks 5 and 7.

---

### Task 1: Plants and varieties

**Files:** `server/db/migrations.js` (migration 6), `server/db/repos.js`, `server/services/plants.js`, `server/routes/plants.js`, `server/routes/index.js`, `server/services/trash.js`, `server/services/photos.js` (`PHOTO_OWNERS.plant = 'plants'`), `tests/server/plants.test.js`

Migration 6:
```sql
CREATE TABLE plants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, latin_name TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('vegetable','herb','microgreen','fruit_tree','shrub','vine')),
  family TEXT, summary TEXT,
  sun TEXT CHECK (sun IS NULL OR sun IN ('full','part','shade')),
  water TEXT CHECK (water IS NULL OR water IN ('low','medium','high')),
  spacing_cm REAL, container_liters REAL, container_ok INTEGER NOT NULL DEFAULT 0, greenhouse_notes TEXT,
  zone_min INTEGER, zone_max INTEGER, perennial INTEGER NOT NULL DEFAULT 0,
  start_indoors_min INTEGER, start_indoors_max INTEGER,   -- weeks before last frost
  transplant_min INTEGER, transplant_max INTEGER,         -- weeks after last frost (negative = before)
  sow_min INTEGER, sow_max INTEGER,                       -- weeks after last frost (negative = before)
  fall_sow_min INTEGER, fall_sow_max INTEGER,             -- weeks before first frost
  frost_free_months TEXT NOT NULL DEFAULT '[]',           -- planting months for frost-free places
  days_min INTEGER, days_max INTEGER, years_min INTEGER, years_max INTEGER,
  yield_kg REAL, yield_per TEXT CHECK (yield_per IS NULL OR yield_per IN ('plant','meter')),
  companions TEXT NOT NULL DEFAULT '[]', avoid TEXT NOT NULL DEFAULT '[]',
  problems TEXT, notes TEXT,
  soak_hours REAL, seed_g_per_tray REAL,
  safety_goats TEXT CHECK (safety_goats IS NULL OR safety_goats IN ('safe','small','avoid')),
  safety_chickens TEXT CHECK (safety_chickens IS NULL OR safety_chickens IN ('safe','small','avoid')),
  starter_key TEXT UNIQUE, is_starter INTEGER NOT NULL DEFAULT 0, content_version INTEGER NOT NULL DEFAULT 1, ${TS});
CREATE TABLE plant_varieties (id INTEGER PRIMARY KEY AUTOINCREMENT, plant_id INTEGER NOT NULL REFERENCES plants(id),
  name TEXT NOT NULL, days INTEGER, notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
CREATE TABLE plant_preserves (plant_id INTEGER NOT NULL REFERENCES plants(id) ON DELETE CASCADE, position INTEGER NOT NULL,
  form TEXT NOT NULL, unit TEXT NOT NULL, raw_kg REAL NOT NULL, PRIMARY KEY (plant_id, position));
CREATE INDEX idx_varieties_plant ON plant_varieties(plant_id);
```
`companions` and `avoid` are lists of plant starter keys or free names; `frost_free_months` is a month list (1-12), parsed on the way out like `wet_months`.

Rules: each min ≤ its max when both are set (else 400 `range_order`); weeks within −26..26, days 1..730, years 0..30, zones 1..13 with `zone_min ≤ zone_max`; microgreen fields kept only for `kind = 'microgreen'` (cleared otherwise, as space fields are); `preserves` is a list of `{ form, unit, raw_kg }` (max 10) replaced whole on save, sent with the plant. `starter: true` behaviour: a save that changes anything drops `is_starter`.

API: `GET /api/plants?kind=&q=` (list: id, name, latin_name, kind, summary, container_ok, zone_min, zone_max, perennial, starter_key, is_starter, cover photo filename), `GET /api/plants/:id` (full row plus `preserves`, `varieties`, `guides` [id, title, stage, starter_key, is_starter]), POST, PATCH, DELETE, restore; `POST /api/plants/:id/varieties`, `PATCH/DELETE /api/varieties/:id`, `POST /api/varieties/:id/restore`.

Trash: `variety` (parentOf plant), `plant` (deleting a plant takes its varieties, its plant guides and their photos with the same stamp; restore brings them back; purge removes children first). Deleting forever a starter plant records its key in `starter_removed`.

- [ ] Tests (names): `a plant saves with its timing and comes back with lists parsed`; `min after max is refused`; `microgreen fields are cleared for other kinds`; `preserves are replaced whole and come back in order`; `editing a starter plant drops the Starter tag, a no-change save keeps it`; `deleting a plant takes its varieties and guides to the Trash and restore brings them back`; `a variety can't be restored while its plant is in the Trash`; `deleting a starter plant forever keeps it from being seeded again`; `stale save 409`; `list filters by kind and by words in name, latin name or summary`.
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 2: Guides

**Files:** migration 7, `server/db/repos.js`, `server/services/guides.js`, `server/routes/guides.js`, `server/services/trash.js`, `tests/server/guides.test.js`

```sql
CREATE TABLE guides (id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT NOT NULL, summary TEXT,
  plant_id INTEGER REFERENCES plants(id), basics_id INTEGER REFERENCES guides(id) ON DELETE SET NULL,
  stage TEXT NOT NULL CHECK (stage IN ('start_indoors','transplant','sow_outdoors','container','greenhouse','care','harvest','preserve','microgreens','general')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  starter_key TEXT UNIQUE, is_starter INTEGER NOT NULL DEFAULT 0, content_version INTEGER NOT NULL DEFAULT 1, ${TS});
CREATE TABLE guide_steps (guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position INTEGER NOT NULL, text TEXT NOT NULL, PRIMARY KEY (guide_id, position));
CREATE TABLE guide_supplies (guide_id INTEGER NOT NULL REFERENCES guides(id) ON DELETE CASCADE, position INTEGER NOT NULL, name TEXT NOT NULL, amount TEXT, PRIMARY KEY (guide_id, position));
CREATE INDEX idx_guides_plant ON guides(plant_id);
```
A basics guide has `plant_id` null; a plant guide has `plant_id` and may link `basics_id` to a live basics guide (not to a plant guide, not to itself). Steps (max 40, each ≤ 1000 chars) and supplies (max 30) are replaced whole on save, in order.

API: `GET /api/guides?basics=1` (basics list), `GET /api/guides/:id` (with steps, supplies, plant {id,name}, basics {id,title,live}), POST, PATCH, DELETE, restore. Trash: `guide` (parentOf plant when plant_id set). A basics guide in the Trash shows as "in the Trash" on plant guides that link to it; purging it nulls the link.

- [ ] Tests: `a basics guide saves with steps and supplies in order`; `a plant guide links to a basics guide`; `a link to a plant guide or to itself is refused`; `steps over the limit are refused`; `a basics guide in the Trash shows as not live on linked guides, and purging it clears the link`; `restoring a plant guide whose plant is in the Trash says to restore the plant first`; `stale save 409`.
- [ ] Run → implement → run → commit.

### Task 3: Starter content loader

**Files:** `server/services/starter.js`, `server/content/plants/*.json`, `server/content/guides/*.json`, `scripts/check-pack.js`, `tests/server/starter.test.js`, `tests/server/content.test.js`, `tests/fixtures/base-content/` (two plants, two guides), `tests/server/check-pack.test.js`

File shapes:
```json
// server/content/plants/vegetables.json
[{ "starter_key": "plant.tomato", "content_version": 1, "name": "Tomato", "latin_name": "Solanum lycopersicum", "kind": "vegetable",
   "family": "Nightshade", "summary": "...", "sun": "full", "water": "medium", "spacing_cm": 60, "container_liters": 38, "container_ok": true,
   "start_indoors": [6, 8], "transplant": [1, 2], "frost_free_months": [2, 3, 8, 9], "days": [60, 85],
   "yield_kg": 4.5, "yield_per": "plant", "companions": ["plant.basil"], "avoid": ["plant.fennel"],
   "preserves": [{ "form": "Quart of sauce", "unit": "quart", "raw_kg": 4.5 }], "problems": "...", "notes": "...", "greenhouse_notes": "..." }]
// server/content/guides/basics.json and guides/<group>.json
[{ "starter_key": "guide.basics.start-indoors", "content_version": 1, "title": "...", "summary": "...", "stage": "start_indoors",
   "plant": null, "basics": null, "steps": ["...", "..."], "supplies": [{ "name": "...", "amount": "..." }] }]
```
Seeding order: plants, then basics guides, then plant guides (link by key). Same rules as The Grimoire: skip keys that exist or are in `starter_removed`; insert children with the row; an entry whose parent plant is in the Trash goes in with the plant's deleted time; untouched starter rows (`is_starter = 1`, not in the Trash) with a lower `content_version` are updated, children replaced. `check-pack.js` expects plant fields `name, summary, problems, notes, greenhouse_notes` (when set), preserve forms as `<key>.preserve.<n>`, guide fields `title, summary`, `step.<n>`, `supply.<n>.name`, `supply.<n>.amount` (when set).

- [ ] Tests: `seeds plants, basics guides and plant guides with their links`; `never re-adds an edited, trashed or deleted-forever starter row`; `updates an untouched starter row whose content_version went up, children included`; `a plant guide whose plant is in the Trash is seeded into the Trash with it`; content test: every real file parses, keys are unique and well formed, every link (companions, avoid, guide plant, guide basics) names an existing key or is free text without the `plant.`/`guide.` prefix, ranges are ordered, months 1-12, and every plant has at least one guide; check-pack lists the new content keys.
- [ ] Run → implement → run → commit.

### Task 4: Planting windows

**Files:** `client/src/lib/windows.js`, `tests/client/windows.test.js`

Produces `plantingWindows(plant, place, todayISO) -> { windows: Array<{ kind: 'start_indoors'|'transplant'|'sow'|'fall_sow'|'frost_free', from: 'YYYY-MM-DD', to: 'YYYY-MM-DD' }>, needs: Array<'last_frost'|'first_frost'|'place'> }` and `zoneFit(plant, place) -> 'fits'|'too_cold'|'too_warm'|'unknown'`.

Rules: with a last frost date, `start_indoors` = last frost − max weeks .. − min weeks; `transplant` and `sow` = last frost + min .. + max weeks; with a first frost date, `fall_sow` = first frost − max .. − min weeks; a frost-free place gives one `frost_free` window per run of consecutive months in `frost_free_months` (December to January runs join across the year). Each window uses the next occurrence whose end is today or later (this year or next), so a window already over shows next year's. Missing dates go in `needs`; no place gives `needs: ['place']`. Sorted by `from`. Zone fit only for perennials with zones and a place zone (number part).

- [ ] Tests: north place (03-20 / 11-10) and tomato (indoors 6-8, transplant 1-2) on 2027-01-10 → indoors 2027-01-23..2027-02-06, transplant 2027-03-27..2027-04-03; same on 2027-05-01 → both in 2028; fall sow lettuce (8-10 before 11-10) → 2027-09-01..2027-09-15; only last frost → fall sow in `needs: ['first_frost']`; frost-free months [11, 12, 1, 2] → one window 11-01..02-28 (or 02-29 in a leap year) across the new year; frost-free place and a plant with no months → no windows and no needs; no place → `needs: ['place']`; zone fit 6..9 in zone 7b fits, in 5a too cold, in 10b too warm, annual → unknown.
- [ ] Run → implement → run → commit.

### Task 5: Units for small sizes and weights

**Files:** `client/src/lib/units.js`, `tests/client/units.test.js`

Add kinds `spacing` (cm ↔ in, 2.54 exactly; shows whole inches when ≥ 3 in, one decimal below) and `weight` (kg ↔ lb with 0.45359237 exactly) and `seed` (g ↔ oz with 28.349523125; one decimal, at least `0.1`); fix the feet factor to the exact `0.3048` (Stage 1 deferred minor). Labels: in/cm, lb/kg, oz/g.

- [ ] Tests: `toDisplay('spacing', 45.72, 'us') === '18'`, `toDisplay('spacing', 5, 'us') === '2'`, `toDisplay('spacing', 2.54, 'us') === '1'`, `toDisplay('weight', 4.5359237, 'us') === '10'`, `toDisplay('seed', 3, 'us') === '0.1'`, `toMetric('length', '10', 'us') === 3.048` exactly, `keepOrConvert` unchanged behaviour for the new kinds.
- [ ] Run → implement → run → commit.

### Task 6: Search

**Files:** `server/services/search.js`, `server/routes/search.js`, `server/services/locales.js` (read the active pack), `client/src/components/SearchBox.jsx`, `client/src/screens/search/Search.jsx`, `client/src/components/Sidebar.jsx`, tests `tests/server/search.test.js`, `tests/client/search.test.jsx`

`GET /api/search?q=` (2-200 chars after trimming; else 400 with `too_short`/`too_long`) → `{ q, groups: { plants: {total, items}, guides: {total, items}, places: {total, items}, spaces: {total, items} } }`. Matching is accent- and case-insensitive (`fold`, copied from The Grimoire) over plant name, latin name, summary, notes; guide title, summary and steps; place name, location, notes; space name and notes. For starter rows still tagged Starter, the active language pack's text for the same fields is searched too. Side bar search box as in The Grimoire; results page with one section per group, 20 items each and the total.

- [ ] Tests: `finds a plant by a word in its summary, ignoring accents and case`; `finds a starter plant by its Spanish name when Spanish is on`; `finds a guide by a word in a step`; `a one-letter search is refused`; client: `submitting the box opens the results page`; `shows a section per group with counts`.
- [ ] Run → implement → run → commit.

### Task 7: Library screens

**Files:** `client/src/screens/library/Library.jsx`, `PlantPage.jsx`, `PlantForm.jsx`, `VarietyDialog.jsx`, `client/src/lib/starter.js` (`starterText`), `client/src/App.jsx`, `client/src/components/Sidebar.jsx` (Library between Spaces and Places), `client/src/i18n/en.json`, `tests/client/library.test.jsx`, `tests/client/plantForm.test.jsx`

- **Library** (`/library`): tabs Plants and Guides. Plants: kind filter (toggle group), "Good in a pot" and "Fits <place>" switches (place picker defaults to the current place), plant cards with name (translated for starter rows), summary, kind and a Starter tag. Guides tab: basics guides list. Add a plant / Add a guide.
- **Plant page** (`/library/plants/:id`): name, latin name, summary; a "When to plant at <place>" box with the windows from Task 4 for the chosen place (picker, current by default), and what's missing when `needs` isn't empty, with a link to edit the place; facts (sun, water, spacing, pot size, days to harvest or years to fruit, zone range with fit, yield per plant or per meter, preserving amounts) with "Rule of thumb" beside figures from starter content; companions and plants to keep apart (links when they name a plant); problems; greenhouse notes; guides in stage order (each links to its guide page); varieties (add, edit, delete with a small dialog); photos. Edit and Delete (confirm counts guides and varieties going with it).
- **Plant form** (`/library/plants/new`, `/:id/edit`): all fields grouped (Basics, When to plant, Size and care, Harvest and yield, Companions, Microgreens [only for that kind], Notes), week ranges as two small number boxes with words ("6 to 8 weeks before the last frost"), months as toggles, sizes through `keepOrConvert`.

- [ ] Tests: library `filters by kind`; `Good in a pot hides plants that aren't`; `Fits the current place hides perennials outside its zone`; `shows Spanish names for starter plants when the pack has them, and the owner's text for edited ones`; plant page `shows the planting windows for the current place`; `says which frost date is missing`; `lists guides in stage order`; `adds a variety`; form `shows microgreen fields only for microgreens`; `an untouched spacing saves back exactly`; `refuses min after max with the field message`.
- [ ] Run → implement → run → commit.

### Task 8: Guide screens

**Files:** `client/src/screens/library/GuidePage.jsx`, `GuideForm.jsx`, `client/src/App.jsx`, `en.json`, `tests/client/guides.test.jsx`

- **Guide page** (`/library/guides/:id`): title, summary, numbered steps, "You'll need" supplies list, a link to its basics guide ("How to start seeds indoors, step by step") or to its plant, Edit, Delete. Starter text translated.
- **Guide form**: title, summary, stage, plant (optional; empty means a basics guide), basics guide link (only for plant guides; lists live basics guides), steps and supplies with the Stage 1 `ListEditor` (reorder by drag and up/down).

- [ ] Tests: `shows numbered steps and supplies`; `a plant guide links to its basics guide`; `a basics guide in the Trash shows as unavailable`; form `saves steps in the order shown after a move`; `basics link only for plant guides`.
- [ ] Run → implement → run → commit.

### Task 9: Starter content, batch 1 (English)

**Files:** `server/content/guides/basics.json`, `server/content/plants/{vegetables,herbs}.json`, `server/content/guides/{vegetables,herbs}.json`

Basics guides (10): starting seeds indoors; hardening off seedlings; transplanting; sowing outdoors; soil and compost; watering; raised beds; growing in containers; running a greenhouse through the seasons; harvesting and storing.

Plants (30), chosen for a beginner filling a pantry and doing well in most US zones: tomato, sweet pepper, hot pepper, eggplant, potato, sweet potato, onion, garlic, carrot, beet, radish, lettuce, spinach, kale, cabbage, broccoli, green bean, pea, cucumber, zucchini, winter squash, pumpkin, sweet corn, okra, cowpea (black-eyed pea), basil, cilantro, dill, parsley, oregano. Each gets: all plant fields that apply (frost-relative weeks, frost-free months for highland subtropical climates, spacing, pot size where it suits a pot, days to harvest, rough yield, common preserving forms for the pantry crops), and 2 to 4 short plant guides (the stages that apply) linking to the basics guides, each 3 to 7 steps with the plant-specific numbers (depth, soil temperature, spacing, signs of readiness) and a supply list.

- [ ] Content test passes on the real files (Task 3 test) → commit in batches of about 10 plants.

### Task 10: Demo, docs, browser tests, ship

**Files:** `server/demo/seed.js` (a variety, a plant photo-free edit, one custom plant), `e2e/library.spec.js`, README, AGENTS.md (content keys for packs), CLAUDE.md, docs copies (scrubbed), evidence.

- [ ] Browser tests: `a plant shows its planting dates for the current place and they change with the place picker`; `edit a starter plant, restart, the edit stays and the Starter tag is gone`; `delete a plant, restore it from the Trash with its guides`; `search finds a plant and a guide`; `a new guide with reordered steps survives a restart`.
- [ ] Whole-branch review, fix pass, evidence (demo only), full history to `private`, one clean commit, PR, greploop with `@greptile-apps review`, merge on her OK, install, and write the Spanish `content.json` for batch 1 plus the new `ui.json` keys in her data folder (`npm run check-pack -- es` shows nothing missing).
- [ ] Also: `en.json` `notfound.body` → "That page isn't here." (Stage 1 leftover).
