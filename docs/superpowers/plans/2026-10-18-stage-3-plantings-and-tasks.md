# Seed & Harvest Stage 3: Plantings, Tasks, Today and Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (chosen for Stage 1 and kept) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plan what grows where, and have the app tell a beginner what to do and when. A planting puts a plant in a space. From the place's frost dates (or months, where there is no frost) and the plant's timing, the app works out its tasks (start seeds, pot up, harden off, transplant or plant, sow, thin, feed, check for pests, harvest window). Each task links to its guide and lists its supplies. Today shows what's overdue, due today and due this week. A Calendar shows a month grid and a list. A supplies list collects what the next few weeks need. Each planting keeps a dated log with photos.

**Architecture:** New `plantings`, `tasks` and `planting_log` tables, versioned and soft-deleted like everything else. Tasks are worked out once, when a planting is created or its timing changes, by a pure rules module on the server (`server/services/taskRules.js`), and then saved as ordinary rows the owner can edit. Tasks the owner edited or finished are never regenerated. A preview endpoint runs the same rules without saving, so the form shows the tasks before the owner commits. The client's month grid follows The Grimoire's Stage 4 calendar, copied and adapted, not shared.

**Tech Stack:** As Stages 1 and 2. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`, sections "Plantings and tasks" and "Today and Calendar". Earlier plans: `docs/superpowers/plans/`.

## Global Constraints

- Everything in the Stage 1 and 2 Global Constraints still holds: ports (4215, demo 4217, browser tests 4219), saving rules (`version`, 409 with `current`, soft delete with the Trash, `useResource` and `useRecordForm` only), metric storage, no personal details in the public repo (tests use Springfield), plain text with no em dashes, `/unslop` on human-facing text.
- Dates are stored as `YYYY-MM-DD` text, with no time and no time zone. "Today" is always the place's own date (`useToday(place.time_zone || settings.time_zone)`), and the client sends it when it marks a task done.
- Microgreen trays and repeats are Stage 4, and perennial care calendars and moving container plants are Stage 5. This stage plants perennials (one "Plant" task) and microgreens (sow and harvest) through the same rules, with nothing more.
- Never write to The Apothecary or Hearth & Larder.

## Review Focus

1. **Changing a planting's start date, how it started, or its plant** → the tasks the app made and the owner hasn't touched move to match; tasks the owner edited, added or finished stay exactly as they were. Tests in Task 2.
2. **A place missing its last frost date, or frost-free** → the form suggests a start date from the planting windows when it can, says which frost date to add when it can't, and always lets the owner type a date. Tasks still come out right from a typed date. Tests in Tasks 2 and 4.
3. **Deleting a space, place, plant, variety or guide that plantings use** → a space or place takes its plantings (with their tasks, log entries and photos) to the Trash, and restore brings them back. A plant with live plantings can't be deleted (409 `plant_in_use` with the count). A deleted variety just stops showing. A guide deleted forever leaves its tasks without a link. Tests in Tasks 1 and 3.
4. **Today around midnight and across time zones** → overdue means due before the place's own today and not done. A task finished today moves to "Done today" and stays visible until midnight. The lists roll over at midnight without a reload. Tests in Task 5.
5. **The supplies list** → the same supply from several tasks shows once, matched without regard to case or accents, with each task's amount listed under it. Finished tasks, tasks outside the chosen weeks, and tasks without a guide are left out. Tests in Task 3.

---

### Task 1: Plantings, tasks and log: tables and plantings API

**Files:** `server/db/migrations.js` (migration 8), `server/db/repos.js`, `server/services/plantings.js`, `server/routes/plantings.js`, `server/routes/index.js`, `server/services/trash.js`, `server/services/photos.js`, `server/services/spaces.js`, `server/services/places.js`, `server/services/plants.js`, `tests/server/plantings.test.js`

Migration 8:
```sql
CREATE TABLE plantings (id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id), plant_id INTEGER NOT NULL REFERENCES plants(id),
  variety_id INTEGER REFERENCES plant_varieties(id), count INTEGER, row_m REAL,
  how_started TEXT NOT NULL CHECK (how_started IN ('seed_indoors','seed_outdoors','start','mature')),
  start_on TEXT NOT NULL,                       -- the first action's date (sow, start seeds, or plant)
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','started','growing','harvesting','done')),
  notes TEXT, ${TS});
CREATE TABLE tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
  kind TEXT NOT NULL CHECK (kind IN ('start_seeds','pot_up','harden_off','transplant','plant','sow','thin','feed','pests','harvest','other')),
  title TEXT,                                   -- null: the screen shows the kind's translated name
  due_on TEXT NOT NULL, end_on TEXT,            -- end_on only for windows (harvest)
  done_on TEXT, guide_id INTEGER REFERENCES guides(id), notes TEXT,
  auto INTEGER NOT NULL DEFAULT 0,              -- made by the rules
  edited INTEGER NOT NULL DEFAULT 0,            -- the owner changed its date, title or notes
  ${TS});
CREATE TABLE planting_log (id INTEGER PRIMARY KEY AUTOINCREMENT, planting_id INTEGER NOT NULL REFERENCES plantings(id),
  on_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('sowed','transplanted','planted','thinned','fed','pruned','watered','problem','harvested','note')),
  note TEXT, task_id INTEGER REFERENCES tasks(id), ${TS});
CREATE INDEX idx_plantings_space ON plantings(space_id);
CREATE INDEX idx_tasks_planting ON tasks(planting_id);
CREATE INDEX idx_tasks_due ON tasks(due_on);
CREATE INDEX idx_log_planting ON planting_log(planting_id);
```

Rules: `space_id` and `plant_id` must be live (400 `space_gone` / `plant_gone`); `variety_id` must belong to the plant (400 `wrong_variety`); `count` 1..100000; `row_m` 0..10000; `start_on` a real date (400 `bad_date`); `notes` up to 2000 characters. `how_started: 'mature'` is allowed only for perennials, and `'seed_indoors'` only for plants with `start_indoors` timing or for microgreens (400 `wrong_start`).

API: `GET /api/plantings?place_id=&space_id=&status=&plant_id=` returns a list with `plant` {id, name, kind, starter_key, is_starter}, `variety` {id, name} (null when the variety is in the Trash), `space` {id, name, kind, place_id}, `next_task` {id, kind, title, due_on} and a `cover` photo. `GET /api/plantings/:id` returns the full row plus `tasks` (ordered by due_on, then id) and `log` (newest first). Also POST, PATCH, DELETE and restore.

Trash and cascades:
- Types `planting` (parent `space:<id>`), `task` (parent `planting:<id>`) and `log` (parent `planting:<id>`).
- Deleting a planting takes its tasks, log entries and photos with the same stamp.
- Deleting a space takes its plantings, and a place takes its spaces' plantings, all with the same stamp. Restore brings them back together.
- A task or log entry can't be restored while its planting is in the Trash (409 `parent_in_trash`); a planting can't be restored while its space is.
- Purge order: photo, log, task, planting, variety, guide, plant, space, place.
- Purging a guide nulls `tasks.guide_id`; purging a variety nulls `plantings.variety_id`.
- `deletePlant` refuses while live plantings use the plant: 409 `plant_in_use` with `count`.
- `PHOTO_OWNERS` gains `planting: 'plantings'` and `log: 'planting_log'`.

- [ ] Tests (names): `a planting saves and comes back with its plant, variety and space`; `a variety from another plant is refused`; `mature start is refused for an annual`; `stale save 409`; `deleting a space takes its plantings, tasks and log to the Trash and restore brings them back`; `a planting can't be restored while its space is in the Trash`; `a plant with plantings can't be deleted`; `a deleted variety shows as none on the planting`; `emptying the Trash removes plantings before spaces`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 2: Task rules

**Files:** `server/services/dates.js` (`addDays(iso, n)`, `isDate(iso)`), `server/services/taskRules.js`, `server/services/plantings.js`, `server/routes/plantings.js`, `tests/server/taskRules.test.js`, `tests/server/plantings.test.js`

**Interfaces:**
- Produces: `planTasks(plant, howStarted, startOn) → [{ kind, due_on, end_on|null, stage }]` (pure; `stage` names the guide stage to link); `linkGuides(db, plantId, tasks) → tasks with guide_id`; `POST /api/plantings/preview` (same body as POST, returns `{ tasks }` with guide titles and supplies, saves nothing).

Rules, with weeks taken at the middle of each min/max range and rounded to whole days:
- **seed_indoors**:
  - start_seeds on `start_on`.
  - pot_up on `start_on + 21` when the indoor lead is 6 weeks or more.
  - transplant on `start_on + (lead + after) × 7`, where lead is the middle of `start_indoors` and after is the middle of `transplant` (0 when unset).
  - harden_off 7 days before the transplant.
  - Microgreens: sow on `start_on`, then the harvest window.
- **seed_outdoors**: sow on `start_on`; thin on `start_on + 14` when `spacing_cm ≥ 5`.
- **start**: harden_off on `start_on - 7`, then transplant on `start_on`.
- **mature**: plant on `start_on`. No harvest window this stage; Stage 5 adds perennial care.
- **After an annual is in the ground** (the transplant or sow date): feed at +28 days, and pests at +21 days.
- **No stake task**: the library has no "needs support" flag, and each plant's care and planting guides already say when to stake.
- **Harvest window**: from the in-ground date, `due_on = + days_min`, `end_on = + days_max`. Left out when days are unset or the plant is perennial.
- **Guide stages**: start_seeds and pot_up → start_indoors; harden_off → the basics guide `guide.basics.harden-off`; transplant and plant → transplant; sow and thin → sow_outdoors; feed and pests → care; harvest → harvest.
- **Guide links**: the plant's own guide for that stage comes first. Then the basics guide for that stage, the lowest id among live basics guides. Otherwise none. For `mature`, the plant's transplant or container guide.

Creating a planting saves its tasks with `auto = 1`. A PATCH that changes `start_on`, `how_started` or `plant_id` soft-deletes the planting's auto tasks that are not edited and not done (stamped with the planting's update), then saves a fresh set. Edited, done and owner-added tasks stay.

- [ ] Tests (names):
  - `indoor tomato: start, pot up, harden off, transplant, feed, pests, harvest window on the right days`.
  - `direct-sown beans: sow, thin, feed, pests, harvest`.
  - `a bought start hardens off a week before planting`.
  - `a mature fig gets one Plant task`.
  - `a microgreen gets sow and harvest`.
  - `tasks link the plant's own guide first, then a basics guide`.
  - `moving the start date moves untouched tasks and leaves edited and done ones`.
  - `preview returns tasks with guide titles and saves nothing`.
  - `a date across the new year lands in the next year`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 3: Tasks, log and supplies API

**Files:** `server/services/tasks.js`, `server/services/plantingLog.js`, `server/services/supplies.js`, `server/routes/plantings.js`, `tests/server/tasks.test.js`, `tests/server/supplies.test.js`

**Interfaces:**
- Produces:
  - `GET /api/tasks?place_id=&from=&to=&open=1` returns tasks with `planting` {id, status}, `plant` {id, name, starter_key, is_starter}, `variety_name`, `space` {id, name}, `guide` {id, title, starter_key, is_starter}. A task is included when its window overlaps the range. `open=1` also includes every undone task before `from`, for overdue.
  - `GET /api/supplies?place_id=&from=&to=` returns `[{ name, starter_key|null, index, items: [{ task_id, task_kind, due_on, plant, amount }] }]`.
- Consumes: `fold()` from `server/services/search.js` for matching names.

Rules:
- `POST /api/plantings/:id/tasks` adds a task with `auto = 0`; `kind` defaults to `other`, and a title is required for `other`.
- `PATCH /api/tasks/:id`: changing `due_on`, `end_on`, `title` or `notes` sets `edited = 1`. `done_on` alone does not.
- Setting `done_on` adds a log entry (`task_id` set, kind from the task: start_seeds/sow → sowed, transplant → transplanted, plant → planted, thin → thinned, feed → fed, harvest → harvested, others → note with the task title).
- Setting `done_on` also moves the planting forward when it's behind: sowed or started → started, transplanted or planted → growing, harvested → harvesting. It never moves a status back.
- Clearing `done_on` soft-deletes the log entry it made. The status stays.
- The log has POST, PATCH and DELETE, plus restore and photos.
- Supplies come from the guides of undone tasks in the range. Names are grouped by folded name, keeping the first spelling, and sorted by name. The starter key and index let the client show translated names.

- [ ] Tests (names):
  - `marking a task done logs it and moves the planting forward`.
  - `un-marking removes that log entry and leaves the status`.
  - `editing a task's date marks it edited`.
  - `an owner task needs a title`.
  - `tasks in a range include windows that overlap it and, with open, everything overdue`.
  - `supplies merge the same name across tasks regardless of case and accents`.
  - `supplies skip done tasks, tasks outside the range and tasks without a guide`.
  - `a log entry can't be restored while its planting is in the Trash`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 4: Plantings screens

**Files:** `client/src/screens/plantings/Plantings.jsx`, `PlantingForm.jsx`, `PlantingPage.jsx`, `TaskDialog.jsx`, `LogDialog.jsx`, `client/src/lib/tasks.js` (`taskTitle(task, t)`, `TASK_KINDS`, `LOG_KINDS`), `client/src/App.jsx` (routes), `client/src/components/Sidebar.jsx`, `client/src/screens/library/PlantPage.jsx`, `client/src/screens/spaces/SpacePage.jsx`, `client/src/screens/Trash.jsx`, `client/src/i18n/en.json`, `tests/client/plantings.test.jsx`

**Interfaces:**
- Consumes: `plantingWindows` and `zoneFit` from `client/src/lib/windows.js`; the preview endpoint from Task 2.

Screens:
- **Side bar:** Today, Calendar, Plantings, Spaces, Library, Places, as the design orders them; the later sections arrive in their own stages.
- **Plantings list** (`/plantings`): grouped by space, with place and status filters. Each row shows the plant (translated starter name), variety, count, status and next task.
- **Plan a planting form** (`/plantings/new?plant=&space=`):
  - Fields: place, then space, plant, variety, how started (only the choices the plant allows), count or row length, start date, status and notes.
  - Under the start date, the matching window for that place ("Start seeds indoors: Jan 23 to Feb 6") and a **Use this date** button.
  - With no window, it says which frost date to add, with a link to the place.
  - A zone warning for perennials that don't fit.
  - A live preview list of the tasks it will make, from the preview endpoint, debounced and with stale replies ignored.
  - Edit (`/plantings/:id/edit`) uses the same form and says that untouched tasks will move.
- **Planting page:**
  - Header: plant and variety, space, place, a status picker, edit and delete.
  - Tasks: a done checkbox (sends the place's today), date or window, title, guide link, and supplies that open in place. Edit and delete in a dialog, and an Add a task button.
  - Log: newest first, with add, edit and delete in a dialog and photos on each entry.
  - The planting's photo gallery.
- **Links in:** the plant page gets "Plan a planting" and lists its plantings; the space page lists its plantings and gets "Plan a planting here".
- **Trash:** shows plantings, tasks and log entries with readable titles.

- [ ] Tests (names):
  - `the form suggests the start-seeds window date and Use this date fills it`.
  - `with no last frost, the form asks for it and still accepts a typed date`.
  - `how started offers Mature plant only for perennials`.
  - `the preview lists the tasks the planting will make`.
  - `ticking a task done sends the place's today and shows it in the log`.
  - `a stale task edit shows the conflict choice`.
  - `the list groups plantings by space with their next task`.
  - `Spanish: plant names and task names come from the packs`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 5: Today

**Files:** `client/src/screens/today/Today.jsx`, `client/src/screens/today/TaskList.jsx`, `client/src/i18n/en.json`, `tests/client/today.test.jsx`

- Below the current place card, Today shows these sections, each line grouped by space:
  - **Overdue**: undone tasks due before today.
  - **Today**.
  - **This week**: the next 6 days.
  - **Harvest windows open now**: harvest tasks whose window includes today.
  - **Done today**.
- Each line has a done checkbox, the task name with plant and variety, and links to its guide and planting.
- An empty state, "Nothing to do today", links to Plan a planting.
- A link goes to "Supplies for the next few weeks".
- Data comes from `GET /api/tasks?place_id=<current>&from=<today>&to=<today+6>&open=1`, reloaded when `useToday` rolls over.

- [ ] Tests (names):
  - `overdue tasks come first, then today, then this week, grouped by space`.
  - `a task finished today moves to Done today`.
  - `harvest windows that include today are listed`.
  - `the lists roll over at midnight in the place's time zone`.
  - `no tasks shows the empty state with Plan a planting`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 6: Calendar and supplies list

**Files:** `client/src/screens/calendar/Calendar.jsx`, `MonthGrid.jsx`, `DayPanel.jsx`, `CalendarList.jsx`, `client/src/screens/supplies/Supplies.jsx`, `client/src/App.jsx`, `client/src/i18n/en.json`, `tests/client/calendar.test.jsx`, `tests/client/supplies.test.jsx`

- **Calendar** (`/calendar?place=&month=YYYY-MM&view=month|list`):
  - The month grid follows The Grimoire's `MonthGrid` and `DayPanel`, copied and adapted. Weeks start on Sunday, as in The Grimoire.
  - Each day shows dots for tasks. Harvest windows show on their first day as "Harvest window opens".
  - The place's last spring frost and first fall frost are marked on their days.
  - A planting's start date shows as a marker.
  - Picking a day opens its panel with the full lines.
  - List view shows the month's tasks by day.
  - Previous and next month and Today buttons; the month and view are kept in the address.
- **Supplies** (`/supplies?place=&weeks=2|4|8`, default 4):
  - One list of what the upcoming tasks need, with translated starter names.
  - Each supply opens to show the tasks and amounts.
  - A print-friendly layout (`@media print` hides the side bar).

- [ ] Tests (names):
  - `the month shows tasks on their days and frost dates marked`.
  - `a day panel lists that day's tasks with guide links`.
  - `next and previous month keep the view in the address`.
  - `the list view groups by day`.
  - `supplies show each name once with its tasks`.
  - `changing weeks reloads the list`.
- [ ] Run (fail), implement, run (pass), commit.

### Task 7: Search, demo, docs and browser tests

**Files:** `server/services/search.js` (plantings by plant, variety and notes, and log entries by note, with planting and log groups), `client/src/screens/search/Search.jsx`, `server/demo/*` (sample plantings with tasks at the demo places, some overdue, some done, one harvest window open), `README.md` (Plantings, Today and Calendar sections), `AGENTS.md` (nothing new to install; mention the new screens only if it lists them), `e2e/plantings.spec.js`, `tests/server/search.test.js`, `tests/server/demo.test.js`

- [ ] Tests (names): `search finds a planting by its plant's Spanish name and a log entry by its note`; `the demo has plantings with overdue, open and done tasks`.
- [ ] Browser tests (names):
  - `plan a planting from a plant page, see its tasks, tick one done, and it shows in the log after a restart`.
  - `Today lists an overdue task and the calendar shows it on its day`.
  - `changing a planting's start date moves its untouched tasks`.
  - `deleting a space takes its plantings to the Trash and restore brings them back`.
- [ ] Run everything, then commit.

### Task 8: Ship

- [ ] Whole-branch review on the most capable model, then one fix pass (each fix test-first).
- [ ] Evidence: before and after shots of Today, plus the planting form with its preview, a planting page, the calendar month and list, the supplies list, and Today on a phone.
- [ ] Push the full history to the private repo, then one clean public commit and the PR, then greploop with `@greptile-apps review` to 5/5.
- [ ] Merge, install and add the Spanish keys only on her OK.
