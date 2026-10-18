# Seed & Harvest Stage 2B: The Rest of the Starter Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (kept from Stages 1 and 2A). Steps use checkbox (`- [ ]`) syntax.

**Goal:** Finish the starter library the design asks for: about 20 more vegetables and culinary herbs, 15 microgreens with goat and chicken safety, and 25 fruit trees, shrubs and vines (dwarf and container-friendly first, bought already producing), each with short guides, plus three new basics guides. Small screen changes so microgreens and fruit plants read naturally, and the Stage 2A minors that touch the same screens.

**Architecture:** No new tables. New content files in `server/content/plants/` and `server/content/guides/`, validated by the existing content test (extended for microgreens and perennials). Screen changes in `PlantPage.jsx`, `Library.jsx` and `units.js`.

**Spec:** `docs/superpowers/specs/2026-10-17-seed-and-harvest-design.md`, "Plant library (teaching)". Stage 2A plan for the content shapes: `docs/superpowers/plans/2026-10-18-stage-2a-plant-library.md`.

## Global Constraints

Everything from Stages 1 and 2A (original text, rules of thumb labeled, measurements written both ways in step text, no personal details in the public repo, plain text with no em dashes). Animal safety notes always tell the reader to check with a vet for anything new or in large amounts.

## Review Focus

1. **A microgreen on the plant page** → says it grows indoors any time and how many days to harvest, never "no planting dates yet". Test in Task 1.
2. **A fruit tree's planting window** → labeled as planting, not "move outside", and zone fit shows for every place. Test in Task 1.
3. **Library order in Spanish** → sorted by the name shown on screen. Test in Task 1.
4. **Animal safety** → every microgreen has both safety fields set and the goat and chicken notes are conservative (brassicas, beet, amaranth and buckwheat greens are "small amounts"). Content test in Task 3.
5. **Perennials** → every fruit plant is marked perennial with zones and years to fruit; every container-friendly one has a pot size. Content test in Task 4.

---

### Task 1: Screen changes

**Files:** `client/src/screens/library/PlantPage.jsx`, `client/src/screens/library/Library.jsx`, `client/src/lib/units.js`, `client/src/i18n/en.json`, `server/content/plants/vegetables.json` (December months), tests `tests/client/library.test.jsx`, `tests/client/units.test.js`.

- [ ] Tests: `a microgreen says it grows indoors any time and shows its days`; `a perennial's planting window reads "Plant"`; `the rule-of-thumb note leaves once the owner edits the plant`; `the library sorts by the name shown on screen` (Spanish pack: Albahaca after Ajo); `a weight under 0.05 lb shows 0.1, not 0`; `a missing last frost with no dates at all says which date to add, without "the rest"`.
- [ ] Implement: microgreen box ("Grow indoors any time of year. Ready in {from} to {to} days."), `plants.window.plant` label for perennials' transplant window, `p.is_starter` for the note, sort by `starterText` name with `localeCompare(language)`, weight floor like seed, `plants.need.last_frost_only` when no windows were worked out; potato months `[10, 11, 12, 1, 2]`, cabbage `[9, 10, 11, 12, 1]` with content_version bumped.
- [ ] Run → commit.

### Task 2: New basics guides and 19 vegetables and herbs

**Files:** `server/content/guides/basics.json` (three new: `guide.basics.microgreens` "Growing microgreens start to finish", `guide.basics.buy-plant` "Buying a fruit tree, shrub or vine that already produces", `guide.basics.container-fruit` "Planting and caring for a fruit tree in a pot"), `server/content/plants/vegetables-2.json`, `server/content/plants/herbs-2.json`, `server/content/guides/vegetables-2.json`, `server/content/guides/herbs-2.json`.

Vegetables (12): Swiss chard, collard greens, arugula, bok choy, turnip, leek, green onion, cauliflower, cantaloupe, watermelon, dry beans (pinto and black), tomatillo. Herbs (7): chives, thyme, rosemary, mint, sage, epazote, lemongrass. Each has the plant fields that apply and two short guides linked to basics guides.

- [ ] Content test passes → commit.

### Task 3: 15 microgreens

**Files:** `server/content/plants/microgreens.json`, `server/content/guides/microgreens.json`, `tests/server/content.test.js` (microgreen rule).

Pea shoots, sunflower, radish, broccoli, kale, mustard, arugula, red cabbage, beet, amaranth, basil, buckwheat, wheatgrass, barley fodder, garden cress. Each: soak hours, seed per standard 25 × 50 cm (10 × 20 in) tray, days to harvest, goat and chicken safety, container_ok, and one `microgreens` guide linked to `guide.basics.microgreens`.

- [ ] Test first: every microgreen has `seed_g_per_tray`, `days`, both safety fields, and a microgreens guide; brassica, beet, amaranth and buckwheat entries are not "safe" for goats. Run (fail on no file) → write content → pass → commit.

### Task 4: 25 fruit trees, shrubs and vines

**Files:** `server/content/plants/fruit.json`, `server/content/guides/fruit.json`, `tests/server/content.test.js` (perennial rule).

Trees (12): apple (dwarf), peach (dwarf), pear (dwarf), plum, apricot, Asian persimmon, fig, pomegranate, Meyer lemon, satsuma mandarin, avocado, guava. Shrubs (7): blueberry, thornless blackberry, raspberry, elderberry, strawberry, pineapple guava (feijoa), goji. Vines (6): grape, muscadine grape, passion fruit, hardy kiwi, chayote, dragon fruit. Each: perennial, zones, years to fruit (and how much sooner a bought plant fruits, in notes), container_ok and pot size where it suits a pot, chill-hour notes where it matters, planting window (dormant season before the last frost, plus frost-free months), and two guides (planting, care and harvest) linked to the new basics guides.

- [ ] Test first: every fruit plant is perennial with zones and years; container_ok ones have container_liters. → content → pass → commit.

### Task 5: Ship

- [ ] Demo unchanged. Browser test: `a microgreen page and a fruit tree page read naturally`.
- [ ] Whole-branch review, fix pass, evidence, private push, clean public commit, PR, greploop with `@greptile-apps review`, merge on her OK, install, Spanish texts for every new plant and guide (kept with the owner), `npm run check-pack -- es` clean.
