# Seed & Harvest

A garden, greenhouse and food forest keeper that runs on your own computer. It's made for people who are new to growing food and want to learn as they go: plan in winter, know what to start and when, and keep track of every bed, greenhouse, pot and tree.

Everything is kept in one file on your computer. There are no accounts.

> Stages 1 and 2 are done: saving, backups, the Trash, settings, places with their climate, growing spaces with photos, Today, and the plant library with 89 starter plants (vegetables, herbs, microgreens, and fruit trees, shrubs and vines) and their guides. Plantings and tasks, greenhouses, the food forest, and harvests come in later stages.

## Places

A place is a property where you garden: where you are now, where you'll move next, or where you used to grow. Each place has its own hardiness zone and frost dates, so the app can work out planting times for that climate. Frost-free places use their rainy and dry seasons instead.

When you add a place, type a town and press **Look up**. The app asks [Open-Meteo](https://open-meteo.com) for 30 years of weather and suggests a zone and average frost dates. You can change any of them, or type them yourself. This lookup is the only time the app goes online.

## Growing spaces

Beds, greenhouses (heated or not), containers, food forest areas, microgreen racks and seed-starting shelves. Each one keeps its size, how much sun it gets, notes and photos. Sizes show in feet and gallons or meters and liters, whichever you pick in Settings.

## Library

A starter library of food plants, written for this app: what each one needs, how far apart to plant it, how long until harvest, roughly how much it yields and how much you need for a quart of sauce or a pint of pickles. Each plant page works out its planting dates for any of your places from that place's frost dates, or its planting months where there's no frost.

Every plant has short step-by-step guides (starting seeds, planting out, sowing, harvest) with a list of what you'll need, and each one links to a basics guide that explains the job in full. You can edit anything, add your own plants, varieties and guides, and search across the whole garden from the side bar.

Microgreens list soak time, seed per tray, days to harvest, and whether they are safe for goats and chickens (always ask your vet before making a new feed regular). Fruit trees, shrubs and vines start with dwarf and pot-friendly kinds, say how many years until fruit, and come with guides for buying a plant that already produces and for growing a fruit tree in a pot. Figures in the starter library are common rules of thumb; your seed packet and local gardeners know your conditions best.

## Install

You need [Node.js](https://nodejs.org) 24 or newer.

    npm run setup
    npm start

Then open http://localhost:4215. On Windows, `npm run install-windows` adds a Desktop shortcut. It also starts the app each morning at 5:30, then backs it up and stops it at 9 PM.

The easiest way is to open this folder in Claude Code or Codex and say "install Seed & Harvest". `AGENTS.md` tells them exactly what to do.

To look around with sample places first, run `npm run demo` and open http://localhost:4217.

## Your data

Everything lives in `Documents\Seed & Harvest Data`: the database, your photos and the backups. The app makes a backup once a day when it starts, whenever it is stopped normally (the 9 PM task, `npm run stop`, or the Stop script), before it restores a backup or empties the Trash, and before an update changes the database. It keeps the newest 30. You restore from Settings.

## More languages

The app comes in English. To add another, ask Claude Code or Codex: "Add a Spanish language pack to Seed & Harvest" (or any language). They write the translation files into your data folder, following `AGENTS.md`, and you pick the language in Settings.

## License

MIT. See `LICENSE` and `NOTICE.md`. Climate estimates use weather data from Open-Meteo.com (CC BY 4.0).
