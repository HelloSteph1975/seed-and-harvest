# Seed & Harvest Stage 5: Food Forest and Containers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen for Stage 1 and kept) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Help the owner build a small food forest from plants that already produce, many of them in pots that move with her.
- **Purchase details.** Perennial plantings record where the plant was bought, the price, its age or size, the purchase date, and when it should start bearing.
- **Containers.** A planting can be marked as being in a container. A container planting can move to another space or another place. Its history, photos and future harvests come with it, and the move goes in its log.
- **Care calendar.** Each perennial gets care tasks worked out from the place's season and zone: pruning, feeding, mulching, winter protection, and checking the pot.
- **Food Forest screen.** It lists perennial plantings by place, each with its countdown to bearing and its next care task.
- **What to buy.** The library can filter and sort fruit trees, shrubs and vines by fit for any place's zone, by whether they suit a container, and by how fast they produce.

**Architecture:**
- **Migration 10:**
  - Adds purchase and container columns to `plantings`.
  - Rebuilds `tasks` and `planting_log` so their kind lists include the care and move kinds. SQLite can't change a CHECK constraint in place. The rebuild runs inside the migration's transaction, with `PRAGMA defer_foreign_keys = ON`, and keeps every row id.
- **Care rules.** A pure module, `server/services/careRules.js`. It produces dated care events for a perennial at a place over a date range.
- **Saving care tasks.** `topUpCare` saves care tasks as ordinary auto tasks, through 12 months ahead. It runs when a planting is created, when a planting moves, and once each time the app starts (the app starts every morning). It never makes a second task for the same care in the same season, and it never brings back one the owner deleted.
- **Moves.** A move changes the planting's space. When the place changes, the untouched future care tasks are redone for the new place.

**Tech Stack:** Same as Stages 1 to 4. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`, sections "Food forest and containers" and "Places and climate" ("When a container plant moves to another place, its finished history stays as it was and its future tasks are worked out again for the new place"; zone warnings "unless it's in a container that comes indoors or into the greenhouse"). Earlier plans: `docs/superpowers/plans/`.

## Global Constraints

- Everything in the Stage 1 to 4 Global Constraints still holds:
  - Ports: 4215, demo 4217, browser tests 4219.
  - Saving rules: `version`, 409 with `current`, the Trash, and `useResource` / `useRecordForm` only.
  - Dates are stored as `YYYY-MM-DD`. "Today" means the place's own date.
  - Money is stored as a plain number (`price`). The screen shows it without a currency symbol, labelled "Price paid".
  - No personal details in the public repo. Tests use Springfield.
  - Plain text with no em dashes, and `/unslop` on human-facing text.
- Care advice is labelled as a rule of thumb, and each care task links to the plant's own care guide or a basics guide.
- Harvests come in Stage 6. "Its harvests come with it" holds automatically, because harvests will hang off the planting.
- Never write to The Apothecary or Hearth & Larder.

## Review Focus

1. **Moving a container plant to another place.**
   - Its finished tasks, log entries and photos stay exactly as they were.
   - The move itself goes in the log.
   - Untouched future care tasks are redone for the new place's frost dates or months. Tasks the owner edited or added stay.
   - A planting in the ground can't be moved (409 `not_in_container`).
   - Tests in Task 4.
2. **Care at a frost-free place, a southern place, and for a tender plant in a pot.**
   - Frost-free places get no winter-protection task, and their months come from the place's hemisphere and wet season.
   - Southern places get their winter in June to August.
   - A pot whose plant is less hardy than the place's zone gets "Move it to shelter" before the first fall frost.
   - Tests in Task 3.
3. **The rebuild in migration 10.**
   - Every task and log row survives with its id and links.
   - `PRAGMA foreign_key_check` comes back empty.
   - A pre-migrate backup is written first, as for every migration.
   - A database at version 9 with data upgrades cleanly.
   - Tests in Task 1.
4. **Restarting every morning.**
   - Topping up never duplicates a care task.
   - It never recreates one the owner deleted. A deleted care task counts as covering its season.
   - It skips plantings that are done, in the Trash, or not perennial.
   - Tests in Task 3.
5. **Choosing what to buy for a future place.**
   - Fit uses the chosen place's zone.
   - A plant too tender for that zone but good in a pot shows "In a pot you bring inside" rather than being hidden, when "Good in a pot" is on.
   - "Fastest to produce" puts the fewest years to fruit first, with ties broken by name.
   - Tests in Task 5.

---

### Task 1: Migration 10

**Files:** `server/db/migrations.js`, `server/db/repos.js` (`PLANTING_COLUMNS`), `server/services/tasks.js` (`TASK_KINDS`), `server/services/plantingLog.js` (`LOG_KINDS`), `tests/server/migration10.test.js`

Migration 10:
```sql
PRAGMA defer_foreign_keys = ON;
ALTER TABLE plantings ADD COLUMN in_container INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plantings ADD COLUMN bought_from TEXT;
ALTER TABLE plantings ADD COLUMN bought_on TEXT;
ALTER TABLE plantings ADD COLUMN price REAL;
ALTER TABLE plantings ADD COLUMN size_when_bought TEXT;   -- "3 years old, 15 gal pot"
ALTER TABLE plantings ADD COLUMN bears_on TEXT;           -- when it should start bearing
UPDATE plantings SET in_container = 1 WHERE space_id IN (SELECT id FROM spaces WHERE kind = 'container');
CREATE TABLE tasks_new (... same columns as tasks plus season_key TEXT, kind CHECK adds 'prune', 'mulch', 'protect', 'check_pot' ...);
INSERT INTO tasks_new (<every tasks column, named>) SELECT <the same columns> FROM tasks;
DROP TABLE tasks;
ALTER TABLE tasks_new RENAME TO tasks;
CREATE INDEX idx_tasks_planting ON tasks(planting_id);
CREATE INDEX idx_tasks_due ON tasks(due_on);
CREATE TABLE planting_log_new (... same columns, kind CHECK adds 'mulched', 'protected', 'moved', 'repotted' ...);
INSERT INTO planting_log_new SELECT * FROM planting_log;
DROP TABLE planting_log;
ALTER TABLE planting_log_new RENAME TO planting_log;
CREATE INDEX idx_log_planting ON planting_log(planting_id);
```
Copy the column definitions from migration 8. Name the columns in each `INSERT ... SELECT` rather than relying on `*`.

- [ ] Tests (names):
  - `a version 9 database with tasks and log entries upgrades with every row, id and link kept`: build a database at version 9 by running migrations 1 to 9, add rows, then run 10.
  - `foreign_key_check is empty after the upgrade`
  - `the new task and log kinds save, and an unknown kind is still refused`
  - `plantings in container spaces start marked as in a container`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 2: Purchases and containers on plantings

**Files:** `server/services/plantings.js`, `tests/server/plantings.test.js`

Rules:
- `PLANTING_SCHEMA` gains these fields:
  - `in_container`: bool.
  - `bought_from`: up to 120 characters.
  - `bought_on`: a date.
  - `price`: 0 to 1,000,000.
  - `size_when_bought`: up to 120 characters.
  - `bears_on`: a date.
- On create, `in_container` defaults to 1 when the space's kind is `container`.
- `bears_on` must not be before `bought_on` or `start_on` (400 `range_order`).
- Purchase fields are kept for every planting. The form only shows them for perennials and for nursery starts.
- `GET /api/plantings` and `GET /api/plantings/:id` return the new fields.
- The list also accepts `?perennial=1`, which filters to plantings whose plant is perennial.

- [ ] Tests (names):
  - `a planting saves its purchase details and comes back with them`
  - `a planting in a container space starts in a container`
  - `bearing can't be before it was bought or planted`
  - `the list filters to perennials`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 3: The care calendar

**Files:** `server/services/careRules.js`, `server/services/care.js` (`topUpCare(db, plantingId, todayISO)`, `topUpAllCare(ctx, todayFor)`), `server/services/plantings.js` (create calls `topUpCare`), `server/context.js` (startup top-up, after migrations and starter seeding; errors are logged, never fatal), `server/services/taskRules.js` (`TASK_STAGE` for the new kinds), `tests/server/careRules.test.js`, `tests/server/care.test.js`

**Interfaces:**
- Produces: `careEvents(plant, place, inContainer, fromISO, toISO) → [{ kind, due_on, season_key }]`
  - Pure, sorted by date.
  - `season_key` is `'<kind>:<year>'` for once-a-year care, or `'<kind>:<year>:<n>'` when a kind happens more than once a year.
- Produces: `topUpCare` saves events from `max(today, start_on)` to `today + 365` as auto tasks. It skips any whose `season_key` is already on a task for this planting. That includes tasks in the Trash and tasks marked done, so nothing the owner deleted comes back.
  - Uses the `season_key` column added to tasks in migration 10.

Care rules apply only to perennial plants (`plant.perennial = 1`) on plantings that are not done.

**Places with frost** use frost dates, written as weeks from the last spring frost (L) or the first fall frost (F):

| Task | When | Applies to |
| --- | --- | --- |
| prune | L − 4 weeks (late winter, still dormant) | fruit trees, shrubs and vines |
| feed | L + 2 weeks | every perennial |
| feed (second) | L + 10 weeks | containers only |
| mulch | L + 4 weeks | in the ground |
| protect | F − 1 week | a pot whose plant's `zone_min` is above the place's zone number minus 1, or any pot when the plant has no zones; also in the ground when the place's zone is below `zone_min` |
| check_pot | L − 6 weeks | containers |

**Frost-free places** use months. The coolest month is January in the north and July in the south.

| Task | When |
| --- | --- |
| prune | the 15th of the coolest month |
| feed | the 1st of the first wet month, or March 1 (north) / September 1 (south) when there are no wet months |
| mulch | the 1st of the month after the wet season ends, or the feed date + 4 weeks |
| check_pot | the coolest month, for containers |
| protect | never |

**A place missing a frost date** gets no care events that depend on that date. The planting page shows the existing "add the frost date" note.

**Guides:**
- prune, feed and mulch use the plant's `care` guide, or else a basics `care` guide.
- protect and check_pot use `guide.basics.container-fruit` for containers, or `guide.basics.greenhouse` otherwise.

**Log entries for finished care tasks:**
- prune → pruned
- mulch → mulched
- protect → protected
- check_pot → a note showing the task's name, as other unnamed tasks already do. The owner can log "repotted" by hand.

- [ ] Tests (names):
  - `a fig in the ground at a frost place gets prune, feed and mulch on the right days`
  - `a lemon in a pot gets two feeds, a pot check and a move to shelter before the first frost`
  - `a hardy apple in the ground gets no winter protection`
  - `a southern place gets its winter care in its own winter`
  - `a frost-free place uses its coolest and wet months and never protects`
  - `a place with no frost dates gets no frost-based care`
  - `topping up twice makes no duplicates`
  - `a care task the owner deleted is not made again`
  - `finished, done and non-perennial plantings get no care`
  - `annuals get none`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 4: Moving a container plant

**Files:** `server/services/plantings.js` (`movePlanting(db, id, { space_id, moved_on, version })`), `server/routes/plantings.js` (`POST /api/plantings/:id/move`), `server/services/care.js` (`redoCare(db, planting, fromISO)`), `tests/server/move.test.js`

Rules:
- The planting must be live and `in_container` (409 `not_in_container`).
- The target space must be live and different from the current one.
- `version` is checked (409 with `current`).
- A move:
  - changes `space_id`
  - writes a `moved` log entry dated `moved_on`, with the note "From {old space} ({old place}) to {new space} ({new place})" built from the names
  - when the place changed, deletes the untouched future care tasks (auto, not edited, not done, `due_on >= moved_on`) and then runs `topUpCare` for the new place from `moved_on`
- It returns the full planting.
- The plant's own non-care tasks (sow, harvest and so on) never move.

- [ ] Tests (names):
  - `moving a pot to another space logs the move and keeps its tasks`
  - `moving a pot to another place redoes its untouched future care for the new place`
  - `edited, added and finished care tasks stay through a move`
  - `a planting in the ground can't be moved`
  - `a stale move is 409`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 5: Screens

**Files:** `client/src/screens/foodforest/FoodForest.jsx`, `client/src/screens/plantings/MoveDialog.jsx`, `client/src/screens/plantings/PlantingForm.jsx`, `client/src/screens/plantings/PlantingPage.jsx`, `client/src/screens/library/Library.jsx`, `client/src/lib/tasks.js` (new kinds), `client/src/App.jsx`, `client/src/components/Sidebar.jsx` (Food Forest after Microgreens, as the design orders it), `client/src/i18n/en.json`, `tests/client/foodforest.test.jsx`, `tests/client/library.test.jsx`, `tests/client/plantings.test.jsx`

**Planting form:**
- An "In a container" checkbox, ticked by default when the space is a pot.
- For perennials and nursery starts, a "Purchase" section with these fields:
  - Bought from
  - Date bought
  - Price paid
  - Size or age when bought
  - Should start bearing, with a "Use the library's estimate" button. The estimate is `start_on` plus `years_min` years, or plus one year when "A plant that already produces" is chosen.
- The zone warning for a plant too tender for the place changes when the planting is in a container. It reads "In a pot you can bring inside or into a greenhouse before hard frost", instead of the too-cold warning.

**Planting page:**
- A Purchase block, when any of its fields are set.
- "Starts bearing in about N months" or "Bearing since …".
- A Move button for container plantings. It opens a dialog with the place, the space and the date (default today). After a move, a toast says "Moved to {space}".

**Food Forest** (`/food-forest?place=`):
- Perennial plantings at the place, grouped by space.
- Each one shows a "Pot" tag, its time to bearing, and its next care task.
- Buttons: Plan a perennial (the planting form, with a perennial plant picker) and What to buy.

**Library filters in the address:** `?kinds=fruit_tree,shrub,vine&pot=1&fit=1&place=&sort=fast`, so "What to buy" opens the library already filtered.
- "Sort by" is a new choice: Name, or Fastest to produce. Fastest puts perennials first by `years_min`, then annuals by `days_min`, with ties broken by the shown name.
- When "Good in a pot" and "Survives the winters" are both on, a pot-friendly plant that's too tender stays in the list with the tag "In a pot you bring inside".

**Tests (names):**
- [ ] `the form marks a pot planting as in a container and asks for purchase details for a perennial`
- [ ] `Use the library's estimate fills the bearing date`
- [ ] `a tender plant in a pot gets the bring-it-inside note instead of the too-cold warning`
- [ ] `the move dialog sends the space and date and shows the move in the log`
- [ ] `Food Forest lists perennials by space with bearing time and next care`
- [ ] `What to buy opens the library filtered and sorted fastest first`
- [ ] `a tender pot plant stays in the fit list with the bring-inside tag`
- [ ] `Spanish: care task names come from the pack`
- [ ] Run (fail) → implement → run (pass) → commit.

### Task 6: Search, demo, docs and browser tests

**Files:** `server/services/search.js` (plantings also match `bought_from` and `size_when_bought`), `server/demo/seed.js`, `README.md` ("Food forest and containers" section), `e2e/foodforest.spec.js`, `tests/server/search.test.js`, `tests/server/demo.test.js`

**Demo changes:**
- The dwarf fig gets purchase details from a generic "Valley Nursery".
- A dwarf apple goes in the orchard corner, in the ground, with purchase details.
- Care is topped up for both.

**Tests (names):**
- [ ] `search finds a planting by where it was bought`
- [ ] `the demo has perennials with purchase details and care tasks`

**Browser tests (names):**
- [ ] `plan a potted lemon with purchase details, see its care tasks, move it to another place and its care moves too`
- [ ] `What to buy for a colder place keeps a potted fig with the bring-inside tag`
- [ ] Run everything → commit.

### Task 7: Ship

- [ ] Whole-branch review on the most capable model, then one fix pass. Write each fix test-first.
- [ ] Evidence, with before and after shots of:
  - Food Forest
  - the planting form's purchase section
  - a potted plant's page with care tasks and the Move dialog
  - the library sorted fastest first with the pot tag
  - Today showing care tasks
  - a phone view
- [ ] Rebuild the client before taking screenshots.
- [ ] Push the private history, make one clean public commit, open the PR, then run greploop with `@greptile-apps review` until it reaches 5/5.
- [ ] Merge, install and add the Spanish keys only after her OK.
