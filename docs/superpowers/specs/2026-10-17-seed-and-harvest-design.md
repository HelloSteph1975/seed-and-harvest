# Seed & Harvest: design

Date: 2026-10-17
Status: approved by the owner in chat on 2026-10-17
App name: **Seed & Harvest** (a garden, greenhouse and food forest app)

This is the public copy; the owner's own places and details are kept out of the repo.

## Intent

The owner is new to gardening. She wants to grow food little by little: vegetable beds, one or more greenhouses (a couple of large ones, maybe some small ones), microgreens, and a small food forest. The main reason is to keep her larder, cellar and pantry stocked, with extra to give away or sell. Microgreens also feed her animals (two goats now, maybe chickens next year).

She'll use it all year: planning in winter, then a "what to do now" list through spring, care and harvest in summer and fall, and greenhouse and microgreen work in every season.

Because she's a beginner, the app has to teach. Every task links to step-by-step instructions and a list of what she'll need. She shouldn't have to look anything up elsewhere.

She expects to move more than once over the years. Her records and her container plants come with her. Because she may not stay long anywhere, the food forest leans on dwarf fruit trees and mature trees, shrubs and vines that already produce, many of them in containers. She'll also plant some in the ground at each place.

The app is **public**. Anyone, anywhere, should be able to set it up for their own places and climate. The owner's own places, plants and records stay in her private data folder.

## Goals

- Plan in winter: what to grow, where, and how much, aimed at what she wants on the pantry shelves.
- Tell her what to do and when, worked out from each place's frost dates and season, with steps and a supply list for each task.
- Track every growing space: beds, greenhouses (big and small), containers, food forest areas, microgreen racks.
- Track what's planted, what's been done, and what was harvested.
- Microgreens on short repeating cycles, for people and for animals, with animal-safety notes.
- Food forest and containers: perennials bought already producing, purchase records, years to bearing, moving a container plant to a new place with its history.
- Harvests record where food went (kept fresh, sent to the larder, fed to animals, given away, sold, with an optional price). Larder harvests go to Hearth & Larder.
- Add, edit, save and delete every kind of record, with the same careful saving as The Grimoire.
- Work for any user, in any climate, in any language (through language packs).

## Non-goals (for now)

- **Medicinal herbs.** The Apothecary keeps its own garden log for medicinal herbs, and the two stay separate. Culinary herbs (basil, dill, cilantro) live here. This app never writes to The Apothecary.
- **Moon gardening.** Timing comes from frost dates, seasons and zones only.
- **A full selling section** (customers, farm stand lists, income and costs). The first version only records sales with a price. A later stage can add more once she knows whether she'll have enough to sell.
- Animal care beyond microgreen feed (no herd records, no egg log).
- Accounts, sign-in, syncing between computers, phone apps.
- Weather stations, sensors or watering automation.

## Anti-goals

- Copied text. Every guide and plant note is written fresh for this app. No closely paraphrased seed-catalog or extension-service text. No invented sources; if a guide cites something, it's real.
- Guessed advice presented as fact. Where timing or yield is a rough rule of thumb, it says so.
- Losing edits. Same saving guards as The Grimoire, from the first stage.
- Making The Apothecary or Hearth & Larder depend on this app. The Hearth & Larder link is optional and the app works fully without it.
- Burying a beginner in options. The "what to do now" list and the guides come first; detail is one tap away.

## Foundation (decided: same as the owner's other apps)

Copied and adapted from The Grimoire (`~\dev\the-grimoire`), not shared as a library:

- Node 24+, Express 5, built-in `node:sqlite`, React 19 with React Router, Vite. Tests with Vitest, Supertest, Testing Library and Playwright.
- Same layout: `server/` (config, db, routes, services, demo), `client/src/` (screens, components, lib, theme, i18n), `scripts/`, `windows/`.
- Same saving and loading rules as The Grimoire's design ("Saving and loading" section): `version` on every editable table, `409` on stale saves, soft delete with a Trash screen, `VACUUM INTO` backups (start, shutdown, before restore or Trash empty, newest 30 kept, older to the Recycle Bin), pre-migrate backups, one shared loading and form hook on the client (`useResource` / `useRecordForm`), unsaved-changes prompts, Try again on failed loads, translated errors.
- Same language-pack system: English in the repo, other languages as packs in the data folder. The owner's copy gets a Spanish pack.
- Photos on plantings, plants, spaces and harvests, as in The Apothecary.
- A demo copy with sample data.
- Units setting: US (inches, feet, pounds, °F) or metric. Stored values are metric; the screen converts.

### Where things live

| What | Where |
| --- | --- |
| Code | `~\dev\seed-and-harvest`, public GitHub repo `HelloSteph1975/seed-and-harvest`, started from one clean commit; full build history in the private repo `HelloSteph1975/seed-and-harvest-dev` (remote `private`), as with The Grimoire |
| Data | `Documents\Seed & Harvest Data` (database, photos, backups, locales), overridable in `config.json` or by an environment variable |
| App port | 4215 |
| Demo port | 4217 |
| Browser test port | 4219 |

Ports 4215, 4217 and 4219 are the next free ones. The global notes get updated to say the next free port is 4221.

### Daily rhythm (Windows)

Same as her other apps: `Seed & Harvest - Start Morning` (5:30 AM, `start-server.vbs`, StartWhenAvailable, PT72H, runs on battery), `Seed & Harvest - Stop 9 PM` (runs `node scripts/stop.js` through a hidden `.vbs`, which backs up and shuts down via `POST /api/shutdown`), Desktop shortcut `Seed & Harvest Dashboard.lnk` with an `.ico` in `windows\`. Keep the app folder on `main`; feature work goes in a worktree.

## Places and climate

A **place** is a property: name, location, hemisphere, hardiness zone, last spring frost date, first fall frost date, notes. One place is the current one; the others are past or future. The owner's copy starts with her current place and the places she plans to move to.

- **Adding a place:** the user types a town or city. The app looks it up and suggests a zone and average frost dates. The user can change any of them, and can always type them in by hand with no lookup.
- **Lookup (builder's call on the source; my suggestion):** Open-Meteo's free geocoding and historical-weather APIs, no key needed. Work out average last and first frost (daily low at or below 0 °C) and the average yearly coldest night over about 30 years, then turn the coldest night into a zone on the common 10 °F band scale (with a/b halves). Show the data credit the source asks for. This is the app's only network call. It happens only when the user asks, and the app works fully offline without it.
- **Frost-free places** (like many tropical highlands): the place is marked frost-free. Timing comes from the season instead. Each place can set wet and dry season months, and each plant's guide gives a best planting window by month for frost-free climates.
- *My call:* planning isn't limited to the current place. Any place can be chosen when planning plantings, filtering what to buy, or checking zone fit (for example buying container trees now that suit the next place's zone). When a container plant moves to another place, its finished history stays as it was and its future tasks are worked out again for the new place.
- **Zones** decide which perennials, trees and shrubs survive the winter there. The plant library shows each perennial's zone range and warns when a plant doesn't fit the place's zone (unless it's in a container that comes indoors or into the greenhouse).

## Growing spaces

Every place has **spaces**: name, kind, size, sun (full, part, shade), notes, photo. Kinds:

- **Bed** (in-ground or raised)
- **Greenhouse** (with heated or not, and its own notes on what grows there in each season)
- **Container** (pot size; a container plant can move to another place)
- **Food forest area**
- **Microgreen rack** (number of trays)
- **Indoor seed-starting spot** (shelves, lights)

Spaces can be added, edited, moved within a place, and deleted (to the Trash).

## Plant library (teaching)

The app ships with a starter library of common food plants, written fresh for this app. The builder decides the exact list. Rough size: about 50 vegetables and culinary herbs, about 15 microgreens, and about 25 fruit trees, berry shrubs and vines (dwarf and container-friendly ones first). Starter entries are tagged **Starter**, as in The Grimoire, and editing one drops the tag.

Each plant has:

- name, kind (vegetable, herb, microgreen, fruit tree, shrub, vine), family, varieties the user adds
- **timing** relative to frost: start indoors (weeks before last frost), move outside (weeks after), sow outdoors, fall planting; plus month windows for frost-free places
- days to harvest; for perennials, years to first fruit, and how fast a bought plant produces at different ages
- zone range (perennials), sun, water, spacing, container size (and whether it does well in a pot), greenhouse notes
- rough yield per plant or per foot of row, marked as a rule of thumb
- companions and plants to keep apart
- common problems and what to do
- **step-by-step guides** for the stages that apply to it (starting seeds indoors, hardening off and transplanting, sowing outdoors, growing in a container or greenhouse, care through the season, harvest, storing or preserving). *My call:* each stage's general method lives once in a basics guide; a plant's own guide for that stage is a short list of plant-specific steps and numbers (depth, temperature, spacing, signs it's ready) that links to the basics guide. This keeps the writing to a size that can be checked for accuracy.
- **supplies** needed for each stage (seeds, trays, soil mix, pot size, stakes, cover)
- for crops commonly preserved: rough raw amount per jar or per pound stored for each common form (for example pounds of tomatoes per quart of sauce), marked as a rule of thumb
- for microgreens: soak time, seeding amount per tray, days to harvest, and **animal safety** for goats and chickens (safe, small amounts, avoid), plus a note to check with a vet. Users can add their own animal kinds.

**Basics guides** (not tied to one plant): soil and compost, watering, raised beds, setting up and running a greenhouse through the seasons, microgreens start to finish, planting and caring for a container fruit tree, buying a mature tree or shrub (what to look for), hardening off seedlings.

The user can edit any guide, add plants and guides of their own, and delete them.

## Plantings and tasks

A **planting** is something growing (or planned) in a space: plant, variety, space, how many, how started (seed indoors, seed outdoors, bought start, bought mature plant), dates, status (planned, started, growing, harvesting, done), notes, photos.

- When the user plans a planting, the app works out its **tasks** from the place's frost dates or season windows and the plant's timing: start seeds, pot up, harden off, transplant, sow, thin, feed, stake, check for pests, harvest window. Each task links to its guide and lists its supplies.
- The user can move, edit, add or delete tasks. Marking a task done records the date in the planting's history.
- **Planting log entries**: dated notes on a planting (sowed, transplanted, pruned, watered, problem seen, harvested), with photos.

## Today and Calendar

- **Today**: what to do today and this week, overdue tasks first, grouped by space. Each line opens its guide. Also: microgreen trays ready to harvest, harvest windows opening, and days until the next frost date at the current place.
- **Calendar**: month and list views of tasks and plantings, with the place's frost dates marked.
- **Supplies for the next few weeks**: one list of what upcoming tasks need, so she can buy ahead.

## Greenhouses and microgreens

- Each greenhouse is a space with its own plantings, so its schedule shows on Today like any bed.
- **Microgreen trays**: crop, rack, sown date, expected harvest date, who it's for (people or one of the animals), status. "Sow again" starts the next tray of the same crop. A repeat setting (every N days) keeps a steady supply, and Today shows when to sow the next one.
- Choosing an animal warns if the crop is marked "avoid" for that animal.

## Food forest and containers

- Perennial plantings record **purchase details**: where bought, price, age or size when bought, date, and when it should start bearing.
- **In the ground or in a container.** A container planting can be **moved** to another space or another place. Its history, photos and harvests come with it, and the move goes in its log.
- **Care calendar** for perennials: pruning, feeding, mulching, winter protection, worked out by season and zone.
- **Choosing what to buy**: the library filters fruit trees, shrubs and vines by fit for the place's zone, container-friendly, and fastest to produce.

## Harvests and where food goes

- A **harvest** has: planting, date, amount and unit, and how it was split: kept fresh, to the larder, fed to animals (which), given away (to whom, optional), sold (amount, price, optional buyer).
- **Send to Hearth & Larder:** the larder part can be sent to Hearth & Larder, which already accepts harvests from a garden app on the same computer (`POST /api/harvests` with crop, quantity, unit, harvested_on, note, source; port from its `config.json`, default 4193). *My call:* a small, optional change to Hearth & Larder goes with Stage 6: its harvests accept an optional `external_id` (unique per source), so sending again never makes a duplicate, and edits or deletes of a sent harvest follow to Hearth & Larder through its existing versioned update and soft delete. Hearth & Larder keeps working with or without the garden app. Settings has the address and a switch to turn it off; it's off by default in the public app. If Hearth & Larder isn't running, the harvest is saved here and marked "not sent yet", with a Send again button. Nothing is lost.
- **Year summary**: totals per crop and per place, how much went where, and sales income. This is the base for winter planning and for any future selling stage.

## Winter planning

- The user lists **pantry goals**: what they want stored for the year (for example 24 quarts of tomato sauce, 20 pounds of onions, 30 pints of green beans).
- *My call:* a goal is entered either as a raw amount (20 pounds of onions) or as a preserved form the plant lists (quarts of sauce). Preserved forms convert to raw amounts with the plant's rough ratio.
- The app suggests how many plants or feet of row to grow for each goal, using the library's rough yields and last year's real harvests where there are any. It says these are estimates.
- From the goals the user builds next year's planting plan (planned plantings in spaces), which makes the next year's tasks.
- A seed and supply list comes from the plan.

## Look and feel

The builder's call: one warm theme that fits the owner's other apps, such as a garden journal (soil browns, leaf greens, cream pages, a readable serif or rounded font), original SVG ornaments, WCAG AA contrast. Side bar: Today, Calendar, Plantings, Spaces, Microgreens, Food Forest, Harvests, Plan, Library, then Places, Trash and Settings. A search box searches plants, guides, plantings and log entries.

## Build stages (suggested; the builder writes a plan per stage)

1. **Foundation and places**: saving, Trash, backups, settings, language packs, theme, places with zone and frost lookup, spaces.
2. **Plant library**: plants, varieties, guides, supplies, basics guides, starter content (in batches), Spanish pack for those batches.
3. **Plantings, tasks, Today and Calendar**: planning a planting, worked-out tasks, planting log, supplies list.
4. **Greenhouses and microgreens**: trays, repeats, animals and animal-safety warnings.
5. **Food forest and containers**: purchases, moving plants between places, perennial care calendar, choosing what to buy.
6. **Harvests and winter planning**: harvests and where food went, Hearth & Larder link, year summary, pantry goals, next year's plan.

Later, separately: a selling section, if the first year shows there's enough to sell.

Each stage follows her usual flow: worktree from `origin/main`, tests, before-and-after evidence, one clean public commit per PR, Greptile to 5/5, then install.

## Left to the builder

- The exact starter plant list and the wording of every guide (original, beginner-friendly, rough rules of thumb marked as such).
- Database tables and how tasks are stored (worked out once and saved, or worked out each time from rules).
- Which climate data source to use, and the frost-date and zone calculations, as long as manual entry always works.
- The theme's details and the icon.
