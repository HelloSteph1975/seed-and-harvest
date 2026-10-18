# Seed & Harvest Stage 1: Foundation and Places Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, installed Seed & Harvest app with careful saving, Trash, backups, settings, language packs, a garden-journal look, **places** (with an optional zone and frost-date lookup) and **growing spaces** (with photos), plus a simple Today page for the current place.

**Architecture:** Copy The Grimoire's foundation (server, client data layer, Windows scripts, tests) at commit `dd421c9`, strip everything Grimoire-specific, then add places, spaces, photos and the climate lookup as new services behind thin routes. One SQLite file per data folder; every editable table is versioned; the client loads and saves only through `useResource` and `useRecordForm`.

**Tech Stack:** Node 24+, Express 5, `node:sqlite`, React 19, React Router 7, Vite, lucide-react, multer (photos), Vitest, Supertest, Testing Library, Playwright. Climate data from Open-Meteo's free APIs (no key), only when the user asks.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`. Foundation reference: The Grimoire's design (`HelloSteph1975/the-grimoire`, `docs/superpowers/specs/2026-10-14-the-grimoire-design.md`), section "Saving and loading".

## Global Constraints

- App name **Seed & Harvest**. Folder `~\dev\seed-and-harvest`. npm name `seed-and-harvest`.
- Public repo `HelloSteph1975/seed-and-harvest`, started from one clean commit; full build history in private repo `HelloSteph1975/seed-and-harvest-dev` (remote `private`). Public PRs go up as one clean commit.
- Ports: app **4215**, demo **4217**, browser tests **4219**.
- Data folder default `Documents\Seed & Harvest Data`; demo `Documents\Seed & Harvest Demo Data`. Database file `garden.db`; backups `backups\garden-YYYY-MM-DD-HHMM.db`.
- Environment variables use the prefix `SEED_HARVEST_` (`SEED_HARVEST_PORT`, `SEED_HARVEST_DATA_DIR`, `SEED_HARVEST_DEMO_PORT`, `SEED_HARVEST_DEMO_DATA_DIR`, `SEED_HARVEST_CONTENT_DIR`).
- Scheduled tasks `Seed & Harvest - Start Morning` (daily 5:30 AM, `windows\start-server.vbs`, StartWhenAvailable, ExecutionTimeLimit PT72H, `-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries`) and `Seed & Harvest - Stop 9 PM` (hidden `.vbs` running `node scripts/stop.js`; no PowerShell stop script). Desktop shortcut `Seed & Harvest Dashboard.lnk` → `windows\Launch Seed & Harvest.vbs`, icon `windows\seed-and-harvest.ico`.
- Saving rules exactly as The Grimoire: `version` on every editable table, updates send it, stale saves get `409` with the current record; soft delete with `deleted_at`; Trash restores and purges; `VACUUM INTO` backups on start (if none today), on shutdown, before restore and before Trash empty; newest 30 kept, older to the Recycle Bin; data epoch guards pages loaded before a restore.
- Stored measurements are metric (meters, liters, °C). The screen converts for the `us` units setting.
- English in the repo. Other languages are packs in `<data>\locales\<code>\ui.json`. No owner home names or personal details in the public repo, its demo data, tests or screenshots.
- The only network call is the climate lookup, made only when the user presses a lookup button. Everything else works offline.
- All human-facing text plain and warm, no em dashes; run `/unslop` on commit messages, PR text and docs.
- Keep `~\dev\seed-and-harvest` on `main` once installed; feature work goes in a worktree.

## Review Focus

1. **The weather service is down, slow or the laptop is offline** → the lookup says so in one plain line ("Couldn't reach the weather service. You can type the zone and frost dates yourself."), the form keeps everything typed, nothing is saved. Tests in Task 5 (fetch rejects; fetch never answers within the timeout).
2. **A town name matches several places, or none** (there are many towns called Springfield) → the user picks from a list showing state or region and country; no match says "No places found by that name." Tests in Task 5 and Task 8.
3. **Southern-hemisphere places**, where last spring frost (around September) comes after first fall frost (around May) in the calendar year → saved without a "wrong order" error, estimates use the right months, Today counts to the right next date. Tests in Tasks 3, 5 and 10.
4. **Deleting or restoring the current place** → Today asks the user to choose a current place instead of breaking; restoring a current place while another one is now current brings it back as past, never two current places. Tests in Task 3 and Task 10.
5. **Unit round-trips** → opening a space in US units and saving without touching the size never changes the stored meters (10 ft stays 3.048 m, not 3.05 m). Test in Task 7 and Task 9.

---

## File map

New or rewritten in `~\dev\seed-and-harvest` (everything else is copied from The Grimoire in Task 1 and renamed):

| File | Responsibility |
| --- | --- |
| `server/db/migrations.js` | Fresh migration list for this app (settings, starter_removed, places, spaces, photos) |
| `server/db/repos.js` | `places`, `spaces`, `photos` repos |
| `server/services/places.js` | Place rules: one current place, frost order, delete and restore with spaces |
| `server/services/spaces.js` | Space rules: live place, fields per kind, delete and restore with photos |
| `server/services/climate.js` | Geocode and estimate (pure math split from fetching) |
| `server/services/photos.js`, `server/routes/photos.js` | Adapted from The Apothecary |
| `server/routes/places.js`, `spaces.js`, `climate.js` | Thin routes |
| `server/demo/seed.js` | Generic demo places and spaces |
| `client/src/lib/units.js`, `client/src/lib/frost.js` | Unit conversion; next frost date |
| `client/src/screens/places/*`, `spaces/*`, `today/Today.jsx` | Screens |
| `client/src/components/PhotoGallery.jsx` | Adapted from The Apothecary |
| `client/src/theme/tokens.css`, `global.css`, `components/Ornaments.jsx` | Garden-journal look |

---

### Task 1: Repo and copied foundation

**Files:**
- Create: `~\dev\seed-and-harvest\` (whole tree)
- Test: the copied foundation tests listed below

**Interfaces:**
- Produces: the Grimoire foundation under new names. `createRepo(db, table, columns, { orderBy })`, `crudRouter(ctx, { repo, schema, starter, beforeDelete, remove, restore })`, `validate/check(schema, body, { partial })`, `transaction(db, fn)`, `HttpError(status, message, errors, { code })`, `notFound()`, `notInTrash()`, `TRASH_TYPES`, `backupNow`, `restoreBackup`, `reorder(db, table, items)`, `reorderItems(body)`, `sendToRecycleBin`, client `api`, `useResource(url)`, `useRecordForm({ initial, submit })`, `useLeaveGuard`, `ConflictDialog`, `LoadState`, `Field`, `Dialog`, `ConfirmProvider`, `ToastProvider`, `ToggleGroup`, `ReorderButtons`, `useReorder`, `I18nProvider`/`useT`.

- [ ] **Step 1: Make the GitHub repos and the starting commit.** Create public `HelloSteph1975/seed-and-harvest` and private `HelloSteph1975/seed-and-harvest-dev` (both empty). In `~\dev\seed-and-harvest`, `git init -b main`, add `LICENSE` (MIT, same holder line as The Grimoire), `.gitignore` (copy The Grimoire's) and a three-line `README.md` ("Seed & Harvest: a garden, greenhouse and food forest keeper that runs on your own computer. Work in progress."). Commit, add remotes `origin` (public) and `private`, push `main` to both. Then ask the owner to turn on Greptile for the public repo in the Greptile dashboard.

- [ ] **Step 2: Start the Stage 1 worktree** with `/new-feature` (branch `stage-1-foundation` from `origin/main`).

- [ ] **Step 3: Copy from `~\dev\the-grimoire` at commit `dd421c9`** (use `git archive dd421c9 <paths> | tar -x`):
  - root: `package.json`, `vite.config.js`, `vitest.config.js`, `playwright.config.js`, `CLAUDE.md`, `AGENTS.md`, `NOTICE.md`
  - `server/`: `app.js`, `config.js`, `context.js`, `http.js`, `index.js`, `validate.js`, `db/connection.js`, `db/repo.js`, `lib/probe.js`, `lib/recycle.js`, `routes/crud.js`, `routes/index.js`, `routes/system.js`, `routes/settings.js`, `routes/locales.js`, `routes/trash.js`, `services/backup.js`, `services/trash.js`, `services/settings.js`, `services/locales.js`, `services/maintenance.js`, `services/epoch.js`, `services/fields.js`, `services/reorder.js`, `services/starter.js`, `demo/seed.js`
  - `scripts/`: all four; `windows/`: all files
  - `client/`: `index.html`, `public/*`, `src/main.jsx`, `src/App.jsx`, `src/i18n/*`, `src/theme/*`, `src/lib/{api,collate,errors,fold,useLeaveGuard,useRecordForm,useReorder,useResource}.js`, `src/components/{Button,ConfirmProvider,ConflictDialog,Dialog,Field,Layout,LeaveGuardProvider,ListEditor,LoadState,Ornaments,PageHeader,ReorderButtons,SettingsProvider,Sidebar,ToastProvider,ToggleGroup,ChipsInput}.jsx`, `src/screens/{NotFound,Settings,Trash}.jsx`, `src/screens/settings/{Backups,General}.jsx`
  - tests: `tests/server/{backup,config,db,demo,epoch,errors,health,locales,probe,repo,settings,stop-script,system,trash,validate,check-pack,client-dist,reorder}.test.js`, `tests/server/helpers.js`, `tests/client/{ConflictDialog.test.jsx,LoadState.test.jsx,api.test.js,collate.test.js,contrast.test.js,errors.test.jsx,i18n.test.jsx,leaveGuard.test.jsx,listEditor.test.jsx,settings.test.jsx,shell.test.jsx,setup.js,chips.test.jsx}`, `e2e/{global-setup,server,guards,saving,settings}.spec.js` (keep `global-setup.js` and `server.js` names as they are)

- [ ] **Step 4: Rename.** Replace `The Grimoire` → `Seed & Harvest`, `the-grimoire` → `seed-and-harvest`, `GRIMOIRE_` → `SEED_HARVEST_`, `grimoire.db` → `garden.db`, backup kind `'grimoire'` → `'garden'` (including the `NAME` pattern in `server/services/backup.js`, so old-style names aren't listed and `garden-…` names are), ports 4209/4211/4213 → 4215/4217/4219, `windows\Launch The Grimoire.vbs` → `windows\Launch Seed & Harvest.vbs`, task names as in Global Constraints. In `package.json` set description "A garden, greenhouse and food forest keeper that runs on your own computer.", remove `astronomy-engine` and the two `@fontsource` Garamond packages, add `multer@^2.4.0`, `@fontsource/fraunces`, `@fontsource/source-sans-3`.

- [ ] **Step 5: Strip Grimoire-only code.** `server/db/migrations.js` keeps `NOW`, `TS`, `migrate()` (message says "newer version of Seed & Harvest") and only two migrations: 1 = `settings`, 2 = `starter_removed`. `repos.js` returns `{}` for now. `routes/index.js` mounts only health, trash, settings, locales, system. `TRASH_TYPES` starts empty. `starter.js` keeps the generic `seedSimple`/`starter_removed` mechanics and seeds nothing yet (Stage 2 fills it); `readContentDir` checks only that the folder exists. Delete the theme setting and the hemisphere setting from `services/settings.js` (Task 2 adds units). `Sidebar.jsx` sections: Today `/`, Spaces `/spaces`, Places `/places`; foot: Trash, Settings; no search box. Remove the Grimoire routes from `App.jsx`. Reduce `en.json` to the keys the remaining screens use (run `npm run check-pack` style key check after Task 7).

- [ ] **Step 6: Run the copied tests.**
Run: `npm install && npm test`
Expected: all copied server and client tests pass, after deleting assertions that name removed Grimoire records (traditions, spells, themes). Replace the e2e tests' tradition steps with a `// Task 12` marker; they are rewritten there.

- [ ] **Step 7: Commit** ("Start Seed & Harvest from The Grimoire's foundation") and push the branch to `private`.

---

### Task 2: Settings: units

**Files:**
- Modify: `server/services/settings.js`, `client/src/screens/settings/General.jsx`, `client/src/i18n/en.json`
- Test: `tests/server/settings.test.js`, `tests/client/settings.test.jsx`

**Interfaces:**
- Produces: settings `{ language, time_zone, units }`; `units` is `'us' | 'metric'`.

- [ ] **Step 1: Write the failing tests.**
```js
test('units defaults from the machine region and saves', async () => {
  expect(defaultSettings({ region: 'US' }).units).toBe('us');
  expect(defaultSettings({ region: 'MX' }).units).toBe('metric');
  const res = await t.http().put('/api/settings').send({ units: 'metric' });
  expect(res.body.units).toBe('metric');
});
test('a bad units value is refused', async () => {
  const res = await t.http().put('/api/settings').send({ units: 'cubits' });
  expect(res.status).toBe(400);
  expect(res.body.errors.units).toBeTruthy();
});
test('theme and hemisphere are no longer settings', async () => {
  const res = await t.http().put('/api/settings').send({ theme: 'old-book' });
  expect(res.status).toBe(400);
});
```
Client: General settings shows a Units toggle (US / Metric) and saves through the existing settings flow.

- [ ] **Step 2: Run, see them fail.** `npx vitest run tests/server/settings.test.js tests/client/settings.test.jsx`
- [ ] **Step 3: Implement.** `defaultSettings({ region } = {})` where region comes from `new Intl.Locale(Intl.DateTimeFormat().resolvedOptions().locale).maximize().region`; `'us'` for `US`, `LR`, `MM`, otherwise `'metric'`. Rule `units: v => ['us', 'metric'].includes(v)`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 3: Places

**Files:**
- Modify: `server/db/migrations.js` (migration 3), `server/db/repos.js`, `server/routes/index.js`, `server/services/trash.js`
- Create: `server/services/places.js`, `server/routes/places.js`
- Test: `tests/server/places.test.js`

**Interfaces:**
- Consumes: `createRepo`, `crudRouter`, `transaction`, `TRASH_TYPES`.
- Produces:
  - table `places`; repo `repos(db).places`
  - `PLACE_SCHEMA`; `savePlace(db, id | null, body, version?) -> row` (used by routes for create and update); `deletePlace(db, id)`; `restorePlace(db, id) -> row`; `purgePlace(db, row)`
  - API: `GET/POST /api/places`, `GET/PATCH/DELETE /api/places/:id`, `POST /api/places/:id/restore`, `POST /api/places/reorder`
  - place row shape: `{ id, name, location, latitude, longitude, time_zone, hemisphere, zone, last_frost, first_frost, frost_free, wet_months: number[], status, notes, sort_order, version, created_at, updated_at, deleted_at }` (`wet_months` parsed from JSON text on the way out)

Migration 3:
```sql
CREATE TABLE places (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, location TEXT,
  latitude REAL, longitude REAL, time_zone TEXT,
  hemisphere TEXT NOT NULL DEFAULT 'north' CHECK (hemisphere IN ('north','south')),
  zone TEXT, last_frost TEXT, first_frost TEXT, frost_free INTEGER NOT NULL DEFAULT 0,
  wet_months TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'future' CHECK (status IN ('current','future','past')),
  notes TEXT, sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
CREATE UNIQUE INDEX idx_places_one_current ON places(status) WHERE status = 'current' AND deleted_at IS NULL;
```

`PLACE_SCHEMA`: `name` string! max 80; `location` string max 120; `latitude` number −90..90; `longitude` number −180..180; `time_zone` string (valid IANA zone, same check as settings); `hemisphere` `['north','south']`; `zone` string pattern `/^(1[0-3]|[1-9])[ab]?$/` (hint "Use a zone like 7b"); `last_frost`, `first_frost` monthDay; `frost_free` bool; `wet_months` ints 1..12, no repeats, max 12; `status` `['current','future','past']`; `notes` string max 2000; `sort_order` int 0..10000.

- [ ] **Step 1: Write the failing tests** (names and assertions):
  - `the first place is current when no status is sent` → POST `{ name: 'Home' }` gives `status: 'current'`; a second POST `{ name: 'Later' }` gives `status: 'future'`.
  - `saving a place as current makes the old current place past` → PATCH second with `status: 'current'`; GET first shows `status: 'past'` and its `version` went up by 1.
  - `frost dates in the wrong order are refused in the north` → `{ hemisphere: 'north', last_frost: '11-15', first_frost: '03-15' }` → 400, `errors.first_frost` set.
  - `southern frost dates are accepted` → `{ hemisphere: 'south', last_frost: '09-20', first_frost: '05-10' }` → 201.
  - `frost-free places clear their frost dates` → `{ frost_free: true, last_frost: '03-01' }` → saved `last_frost: null, first_frost: null`.
  - `only one frost date is fine` → `{ last_frost: '03-20' }` → 201.
  - `wet months come back as a sorted list` → send `[10, 6, 6, 7]` → get `[6, 7, 10]`.
  - `a bad zone is refused` → `'14a'` and `'7c'` → 400.
  - `stale save gets 409 with the current place`.
  - `deleting a place sends its spaces to the Trash with it, and restore brings them back` (write after Task 4 adds spaces; mark `test.todo` until then).
  - `restoring a current place while another is current brings it back as past`.
  - `deleting the current place leaves no current place` → GET list has no `status: 'current'`.
  - `reorder changes sort_order and bumps versions`.
- [ ] **Step 2: Run, see them fail.** `npx vitest run tests/server/places.test.js`
- [ ] **Step 3: Implement** `server/services/places.js` and `server/routes/places.js`. Frost-order rule: only when both dates are present and `frost_free` is 0; north needs `last_frost < first_frost`, south needs `last_frost > first_frost` (compare `MM-DD` strings). Status default and the "demote old current to past" step run inside the same `transaction` as the save, before the insert or update, so the unique index never trips. Use `crudRouter` with `remove`/`restore` hooks; create and update go through `savePlace` (pass a custom `post` and `patch` by mounting them before `crudRouter`). Add `place: { repo, title: row => row.name, restore: restorePlace, purge: purgePlace }` to `TRASH_TYPES`, after `space` (Task 4) in purge order.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 4: Growing spaces

**Files:**
- Modify: `server/db/migrations.js` (migration 4), `server/db/repos.js`, `server/routes/index.js`, `server/services/trash.js`, `server/services/places.js`
- Create: `server/services/spaces.js`, `server/routes/spaces.js`
- Test: `tests/server/spaces.test.js`, finish the place delete/restore test in `tests/server/places.test.js`

**Interfaces:**
- Produces:
  - table `spaces`; repo `repos(db).spaces`
  - `SPACE_KINDS = ['bed','greenhouse','container','food_forest','microgreen_rack','seed_starting']`, `SUN = ['full','part','shade']`
  - `saveSpace(db, id | null, body, version?) -> row`, `deleteSpace(db, id, stamp?)`, `restoreSpace(db, id) -> row`, `purgeSpace(db, row)`
  - API: `GET /api/spaces?place_id=` (live spaces of that place, by `sort_order, name`), `POST /api/spaces`, `GET/PATCH/DELETE /api/spaces/:id`, `POST /api/spaces/:id/restore`, `POST /api/spaces/reorder`

Migration 4:
```sql
CREATE TABLE spaces (id INTEGER PRIMARY KEY AUTOINCREMENT, place_id INTEGER NOT NULL REFERENCES places(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('bed','greenhouse','container','food_forest','microgreen_rack','seed_starting')),
  length_m REAL, width_m REAL, pot_liters REAL, tray_count INTEGER, heated INTEGER NOT NULL DEFAULT 0,
  sun TEXT CHECK (sun IS NULL OR sun IN ('full','part','shade')), notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0, ${TS});
CREATE INDEX idx_spaces_place ON spaces(place_id);
```
Schema: `place_id` int! (must be a live place, else 400 "That place is gone"), `name` string! max 80, `kind` required one of `SPACE_KINDS`, `length_m`/`width_m` number 0..10000, `pot_liters` number 0..100000, `tray_count` int 0..1000, `heated` bool, `sun` one of `SUN`, `notes` max 2000, `sort_order`.

- [ ] **Step 1: Write the failing tests:**
  - `a space needs a live place` → place in Trash → 400 `errors.place_id`.
  - `fields that don't fit the kind are cleared` → bed with `pot_liters: 20, tray_count: 4, heated: true` saves `pot_liters: null, tray_count: null, heated: 0`; container keeps `pot_liters`; microgreen_rack keeps `tray_count`; greenhouse keeps `heated`.
  - `changing kind clears the old kind's field` → container (pot 20) PATCHed to bed → `pot_liters: null`.
  - `a space can move to another place`.
  - `listing by place hides deleted spaces and other places' spaces`.
  - `reorder within a place`.
  - places test: `deleting a place sends its spaces to the Trash with it, and restore brings them back` → spaces share the place's `deleted_at`; Trash list shows the place with `extra: 2` (spaces not listed on their own), restore brings both spaces back; a space deleted earlier on its own stays in the Trash with `placeInTrash: true`.
  - `emptying the Trash purges spaces before their place` (no foreign key error).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Grouping in `listTrash` follows the category/entries pattern already there: generalize it to a `groupedUnder: { type: 'place', key: 'place_id' }` option on the `space` trash type instead of the hard-coded correspondence check, and rename `categoryInTrash` to `parentInTrash`. Restoring a lone space whose place is in the Trash answers 409 "Restore its place first."
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 5: Climate lookup

**Files:**
- Create: `server/services/climate.js`, `server/routes/climate.js`
- Modify: `server/context.js` (`ctx.fetch = config.fetch ?? globalThis.fetch`), `server/routes/index.js`, `NOTICE.md` (data credit)
- Test: `tests/server/climate.test.js`, `tests/server/fixtures/climate/*.json`

**Interfaces:**
- Produces:
  - `zoneFromF(coldestF: number) -> string` (e.g. `'7a'`)
  - `estimateFromDaily({ time: string[], temperature_2m_min: number[] }, hemisphere) -> { last_frost, first_frost, frost_free, coldest_f, zone, years }`
  - `searchPlaces(ctx, q) -> Promise<Array<{ label, latitude, longitude, time_zone, country_code }>>`
  - `estimateClimate(ctx, { latitude, longitude }) -> Promise<{ hemisphere, zone, last_frost, first_frost, frost_free, coldest_f, years, source: 'Open-Meteo' }>`
  - API: `GET /api/climate/search?q=` and `GET /api/climate/estimate?latitude=&longitude=`

Sources: geocoding `https://geocoding-api.open-meteo.com/v1/search?name=<q>&count=8&language=en&format=json`; history `https://archive-api.open-meteo.com/v1/archive?latitude=<lat>&longitude=<lon>&start_date=1995-01-01&end_date=2024-12-31&daily=temperature_2m_min&timezone=auto`. Label = `name, admin1, country` (skip blanks). Timeout 20 s with `AbortSignal.timeout`.

Estimate rules (a frost day is a daily low ≤ 0 °C):
- hemisphere = `latitude < 0 ? 'south' : 'north'`.
- North: last spring frost = last frost day Jan 1–Jul 31 of each year; first fall frost = first frost day Aug 1–Dec 31. South: last spring frost in Jul 1–Dec 31; first fall frost in Jan 1–Jun 30.
- Average each across the years that have one, as day of a non-leap year, turned back into `MM-DD`.
- `frost_free` when fewer than half of the full years have any frost day; then both dates are `null`.
- Coldest night: lowest daily low per winter (north: Jul 1 to Jun 30; south: calendar year), averaged, in °F, rounded to one decimal.
- Zone: `n = clamp(floor((F + 60) / 10) + 1, 1, 13)`, half `'a'` when `F + 60 − 10(n − 1) < 5`, else `'b'`; below −60 °F is `'1a'`, 70 °F and above is `'13b'`.

- [ ] **Step 1: Write the failing tests:**
  - `zoneFromF`: `0 → '7a'`, `-5 → '6b'`, `-0.1 → '6b'`, `34.9 → '10a'`, `-80 → '1a'`, `75 → '13b'`.
  - `estimateFromDaily` with a built fixture of 30 northern years where every year's last frost is Mar 20 and first is Nov 10 → `last_frost: '03-20', first_frost: '11-10', frost_free: false`.
  - southern fixture (last Sep 15, first May 5) with `'south'` → `'09-15'`, `'05-05'`.
  - fixture with frost in only 10 of 30 years → `frost_free: true`, dates `null`.
  - `search lists every match with region and country` → fake fetch returns two "Springfield" results → two labels, `'Springfield, Ohio, United States'` first.
  - `search with no results says so` → `results` missing → `[]`, and the route answers `200 []`.
  - `estimate when the service fails` → fake fetch rejects → `502`, `code: 'lookup_failed'`, message "Couldn't reach the weather service. You can type the zone and frost dates yourself."
  - `estimate times out` → fake fetch that waits on the abort signal; set the timeout to 50 ms through `ctx.config.lookupTimeoutMs` → `502 lookup_failed`.
  - `bad latitude is refused` → `latitude=95` → 400.
  - `nothing is written to the database by a lookup` → `places` row count unchanged.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Keep the math (`zoneFromF`, `estimateFromDaily`) free of I/O. Add to `NOTICE.md`: "Climate estimates use weather data from Open-Meteo.com (CC BY 4.0)."
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 6: Photos on spaces

**Files:**
- Create: `server/services/photos.js`, `server/routes/photos.js` (adapted from `~\dev\the-apothecary\server\...` at its current `main`), `client/src/components/PhotoGallery.jsx`
- Modify: `server/db/migrations.js` (migration 5), `server/db/repos.js`, `server/services/spaces.js`, `server/services/trash.js`, `server/app.js` (serve `<data>\photos` at `/photos`)
- Test: `tests/server/photos.test.js`

**Interfaces:**
- Produces: table `photos (id AUTOINCREMENT, owner_type TEXT NOT NULL, owner_id INTEGER NOT NULL, filename TEXT NOT NULL, caption TEXT, is_cover INTEGER NOT NULL DEFAULT 0, sort_order INTEGER NOT NULL DEFAULT 0, ${TS})` with index on `(owner_type, owner_id)`; `PHOTO_OWNERS = { space: 'spaces' }` (later stages add owners here, no CHECK constraint); `cascadeDeletePhotos(ctx, ownerType, ownerId, stamp)`, `cascadeRestorePhotos(ctx, ownerType, ownerId, stamp)`; API `GET /api/photos?owner_type=&owner_id=`, `POST /api/photos` (multipart `file`, `owner_type`, `owner_id`, `caption`), `PATCH /api/photos/:id` (caption, is_cover, version), `DELETE`, restore. `<PhotoGallery ownerType ownerId />`.

- [ ] **Step 1: Write the failing tests:** upload a small PNG for a space → 201 and the file exists under `photos\`; a 16 MB file → 413 "That photo is too big (15 MB max)."; a text file → 400; deleting the space moves its photo row to the Trash with the same `deleted_at` and the file into `photos\.trash\`; restoring the space brings both back; emptying the Trash sends the file to the Recycle Bin through `sendToRecycleBin` (stubbed in the test); setting a cover clears the old cover; a stale caption save → 409.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement** by adapting The Apothecary's files to this repo's versioned repo, epoch check and `TRASH_TYPES` (photos are grouped under their owner in the Trash list, like spaces under places).
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 7: Look, shell and units on the screen

**Files:**
- Modify: `client/src/theme/tokens.css`, `client/src/theme/global.css`, `client/src/components/Ornaments.jsx`, `client/src/components/Sidebar.jsx`, `client/src/components/Layout.jsx`, `client/src/main.jsx` (fonts), `client/src/i18n/en.json`, `client/public/favicon.svg`, `scripts/make-icon.js`
- Create: `client/src/lib/units.js`
- Test: `tests/client/contrast.test.js`, `tests/client/shell.test.jsx`, `tests/client/units.test.js`

**Interfaces:**
- Produces: `toDisplay(kind: 'length'|'volume'|'temp', metric: number|null, units) -> string` (one decimal, trailing `.0` dropped, `''` for null); `toMetric(kind, text: string, units) -> number|null`; `unitLabel(kind, units) -> 'ft'|'m'|'gal'|'L'|'°F'|'°C'`; `keepOrConvert(kind, text, initialText, initialMetric, units) -> number|null` (returns `initialMetric` unchanged when `text === initialText`).

Look (my call within the spec's "garden journal"): cream page `#f7f1e3`, ink `#2f2a1f`, leaf green `#3f6b3a`, soil brown `#6b4a2e`, tomato accent `#a8402a`, sage line `#c9d3b4`; Fraunces for headings, Source Sans 3 for text; original SVG ornaments (a seedling, a leaf sprig, a row-of-seeds divider). Sidebar brand shows "Seed & Harvest" with the seedling mark.

- [ ] **Step 1: Write the failing tests:** contrast test checks ink, leaf and tomato on cream and cream on leaf at WCAG AA 4.5:1; shell test sees Today, Spaces, Places, Trash, Settings links and the brand name; units tests: `toDisplay('length', 3.048, 'us') === '10'`, `toMetric('length', '10', 'us')` within 1e-9 of `3.048`, `toDisplay('volume', 18.927, 'us') === '5'`, `toMetric('length', '', 'us') === null`, `toMetric('length', 'abc', 'us')` throws a `UnitError`, and `keepOrConvert('length', '10', '10', 3.048, 'us') === 3.048` (exact, no rounding drift).
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** Factors: 1 m = 3.280839895 ft; 1 US gal = 3.785411784 L; °F = °C × 9/5 + 32. Seedling icon drawn as SVG, turned into `windows\seed-and-harvest.ico` with `npm run icon`.
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 8: Places screens

**Files:**
- Create: `client/src/screens/places/Places.jsx`, `PlaceForm.jsx`, `PlacePage.jsx`, `ClimateLookup.jsx`
- Modify: `client/src/App.jsx` (routes `/places`, `/places/new`, `/places/:id`, `/places/:id/edit`), `client/src/i18n/en.json`
- Test: `tests/client/places.test.jsx`

**Interfaces:**
- Consumes: `/api/places`, `/api/climate/search`, `/api/climate/estimate`, `useResource`, `useRecordForm`, `ReorderButtons`.

Behaviour:
- **Places list:** current place first with a "Current" badge, then future, then past; each card shows zone and frost dates or "Frost-free". Reorder within the list. "Add a place" button.
- **Place form:** name, status, then a **Find my climate** box: type a town, press **Look up**, pick one result from the list (label shows region and country), and the app fills location, latitude, longitude, time zone, hemisphere, zone, last and first frost, frost-free. A note under the filled fields: "Estimated from 30 years of weather records. Local gardeners or your extension office may know better dates." Everything stays editable and can be typed by hand. Wet season months (twelve month toggles) show only when Frost-free is on. Notes.
- When a place isn't frost-free and is missing a frost date, the form and the place page show: "Add both frost dates so the app can work out planting times."
- **Place page:** the details, its spaces (links), Edit, Delete (confirm says how many spaces go to the Trash with it).

- [ ] **Step 1: Write the failing tests** (mock `api`): `look up fills the fields after picking a result`; `several results are listed with region and country`; `no results says "No places found by that name."`; `a failed lookup keeps what was typed and shows the weather-service message`; `wet months show only for frost-free places`; `missing frost date shows the reminder`; `saving sends the version and shows the saved place`; `the delete confirm counts the spaces`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 9: Spaces screens

**Files:**
- Create: `client/src/screens/spaces/Spaces.jsx`, `SpaceForm.jsx`, `SpacePage.jsx`, `client/src/components/SpaceKindIcon.jsx`
- Modify: `client/src/App.jsx` (routes `/spaces`, `/spaces/new`, `/spaces/:id`, `/spaces/:id/edit`), `client/src/i18n/en.json`
- Test: `tests/client/spaces.test.jsx`

Behaviour:
- **Spaces list:** a place picker at the top (defaults to the current place; remembers the last choice in `localStorage`, wrapped in try/catch), spaces grouped by kind with an icon each (bed, greenhouse, container, food forest, microgreen rack, seed-starting spot), reorder buttons, "Add a space".
- **Space form:** place, name, kind, then only the fields for that kind: size (length × width, in ft or m) for beds, greenhouses, food forest areas and seed-starting spots; pot size (gal or L) for containers; number of trays for microgreen racks; Heated for greenhouses. Sun (full, part, shade). Notes. Sizes use `keepOrConvert` so an untouched size is sent back as the stored meters.
- **Space page:** details, photos (`PhotoGallery`), Edit, Delete.

- [ ] **Step 1: Write the failing tests:** `only the fields for the chosen kind show`; `switching kind hides the old kind's field`; `in US units a 3.048 m bed shows 10 ft and an untouched save sends 3.048`; `a typed size of 12 ft is sent as metres`; `the place picker defaults to the current place`; `localStorage throwing doesn't break the list`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 10: Today

**Files:**
- Create: `client/src/lib/frost.js`, `client/src/screens/today/Today.jsx`
- Modify: `client/src/App.jsx` (route `/`), `client/src/i18n/en.json`
- Test: `tests/client/frost.test.js`, `tests/client/today.test.jsx`

**Interfaces:**
- Produces: `todayIn(timeZone: string, now = new Date()) -> 'YYYY-MM-DD'`; `nextFrostEvent(place, todayISO) -> { kind: 'last'|'first', date: 'YYYY-MM-DD', days: number } | null` (null when frost-free or no frost dates). It takes the next upcoming of the two `MM-DD` dates (this year or next), counting today as 0 days.

Behaviour: no places → a welcome card ("Start by adding the place where you'll garden") linking to `/places/new`. Places but none current → "Which place are you gardening at now?" with a link to Places. Current place → name, zone, the next frost event ("Last spring frost in 23 days, around March 20" or "First fall frost in 9 days"), or "Frost-free" with the wet season months, and a count of its spaces with a link. Uses the place's `time_zone`, else the settings time zone.

- [ ] **Step 1: Write the failing tests:** north place (03-20, 11-10) on 2027-02-25 → `{ kind: 'last', date: '2027-03-20', days: 23 }`; same place on 2027-03-20 → days 0; on 2027-12-01 → `{ kind: 'last', date: '2028-03-20' }`; south place (last 09-15, first 05-05) on 2027-06-01 → `{ kind: 'last', date: '2027-09-15' }`; only `last_frost` set → still works; frost-free → `null`; `todayIn('America/Mexico_City', new Date('2027-01-01T03:00:00Z')) === '2026-12-31'`. Today screen: welcome card with no places; choose-current prompt when no current place; frost line for the current place.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see them pass.**
- [ ] **Step 5: Commit.**

---

### Task 11: Demo, Windows scripts, setup

**Files:**
- Modify: `server/demo/seed.js`, `scripts/setup.js`, `scripts/stop.js`, `windows/*`, `tests/server/demo.test.js`, `tests/server/stop-script.test.js`

- [ ] **Step 1: Write the failing test:** `npm run demo` seeding (called directly) makes three generic places: "Riverside Homestead" (current, zone 8a, 03-15 / 11-15), "High Desert Plot" (future, zone 6b, 04-25 / 10-15), "Highland Valley" (future, frost-free, wet months 6–10), and at least one space of every kind on the first place; running it twice doesn't duplicate.
- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement**, and check the renamed Windows scripts: start task, stop task (Node, through `stop-server.vbs`), shortcut, battery switches, PT72H, `install-windows.ps1` and `uninstall-windows.ps1` never touch the data folder.
- [ ] **Step 4: Run, see it pass.** `npm test`
- [ ] **Step 5: Commit.**

---

### Task 12: Browser tests

**Files:**
- Modify: `e2e/saving.spec.js`, `e2e/guards.spec.js`, `e2e/settings.spec.js`
- Create: `e2e/places.spec.js`

Port 4219, throwaway data folder, climate lookup stubbed with Playwright `page.route` on `/api/climate/**`.

- [ ] **Step 1: Write the tests:**
  - saving: `a new place and an edit survive a restart`; `a space with a US-units size survives a restart unchanged`; `delete a place, restore it from the Trash, and its spaces come back after a restart`; `back up, change something, restore, and the change is gone`.
  - guards: the four existing guard tests, using places instead of traditions (two windows conflict with Keep mine; unsaved change asks before leaving; a late list reply doesn't hide a new place; server closed → Try again; server closed → save keeps the form).
  - settings: `switching to Spanish and metric sticks after a restart` (with a test `es` pack in the throwaway data folder); `Settings rows wrap on a phone`.
  - places: `look up a town, pick it, save, and Today shows the frost countdown`; `a failed lookup keeps the form and lets you type the dates`; `a photo added to a space is still there after a restart`.
- [ ] **Step 2: Run.** `npm run build && npm run test:e2e` → all pass.
- [ ] **Step 3: Commit.**

---

### Task 13: Docs, Spanish pack, ship and install

**Files:**
- Modify: `README.md`, `AGENTS.md`, `CLAUDE.md`, `NOTICE.md`
- Create (private notes, not the repo): a handover note; copy of the design without personal details to `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md` and this plan to `docs/superpowers/plans/` (both scrubbed of her place names)
- Create (data folder, not the repo): `Documents\Seed & Harvest Data\locales\es\ui.json`

- [ ] **Step 1: Docs.** README: what it is, install, data folder, language packs (ask Claude Code or Codex to make one), units, the climate lookup and its data credit, license. AGENTS.md and CLAUDE.md: same structure as The Grimoire's, with this app's names, ports and env vars, and the saving rules. Run `/unslop` on them.
- [ ] **Step 2: Evidence.** `/evidence-driven-testing` and `/before-and-after` (before = empty app, after = places, spaces, Today) at desktop and phone widths, using demo data only. Save under `docs/evidence/stage-1/`.
- [ ] **Step 3: Ship.** Push the full history to `private`. Make one clean commit for the public branch, open the PR "Stage 1: foundation, places and spaces" with the evidence, then `/greploop` until Greptile gives 5/5 with no open comments. Merge after the owner's OK.
- [ ] **Step 4: Install on her laptop** (after merge, from `main`): `npm run setup`; ask before `npm run install-windows`; start the task; check `GET http://127.0.0.1:4215/api/health` and the Desktop shortcut.
- [ ] **Step 5: Her data.** Write the Spanish `ui.json` pack (every key in `en.json`; check with `npm run check-pack`), switch her copy to Español and US units, and add her places through the app with her watching.
- [ ] **Step 6: Notes.** Update her private notes and handover.
