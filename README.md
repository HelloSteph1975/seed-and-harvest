# Seed & Harvest

A garden, greenhouse and food forest keeper that runs on your own computer. It's made for people who are new to growing food and want to learn as they go: plan in winter, know what to start and when, and keep track of every bed, greenhouse, pot and tree.

Everything is kept in one file on your computer. There are no accounts.

> Stages 1 to 5 are done: saving, backups, the Trash, settings, places with their climate, growing spaces with photos, the plant library with 89 starter plants and their guides, plantings with their tasks, Today, the calendar and a supplies list, microgreen trays with your animals, and the food forest with containers and a care calendar. Harvests and winter planning come next.

## Places

A place is a property where you garden: where you are now, where you'll move next, or where you used to grow. Each place has its own hardiness zone and frost dates, so the app can work out planting times for that climate. Frost-free places use their rainy and dry seasons instead.

When you add a place, type a town and press **Look up**. The app asks [Open-Meteo](https://open-meteo.com) for 30 years of weather and suggests a zone and average frost dates. You can change any of them, or type them yourself. This lookup is the only time the app goes online.

## Growing spaces

Beds, greenhouses (heated or not), containers, food forest areas, microgreen racks and seed-starting shelves. Each one keeps its size, how much sun it gets, notes and photos. Sizes show in feet and gallons or meters and liters, whichever you pick in Settings.

## Library

A starter library of food plants, written for this app: what each one needs, how far apart to plant it, how long until harvest, roughly how much it yields and how much you need for a quart of sauce or a pint of pickles. Each plant page works out its planting dates for any of your places from that place's frost dates, or its planting months where there's no frost.

Every plant has short step-by-step guides (starting seeds, planting out, sowing, harvest) with a list of what you'll need, and each one links to a basics guide that explains the job in full. You can edit anything, add your own plants, varieties and guides, and search across the whole garden from the side bar.

Microgreens list soak time, seed per tray, days to harvest, and whether they are safe for goats and chickens (always ask your vet before making a new feed regular). Fruit trees, shrubs and vines start with dwarf and pot-friendly kinds, say how many years until fruit, and come with guides for buying a plant that already produces and for growing a fruit tree in a pot. Figures in the starter library are common rules of thumb; your seed packet and local gardeners know your conditions best.

## Plantings, Today and the calendar

A planting is a plant in one of your spaces: how many, how it starts (seeds indoors, seeds outdoors, a young plant from a nursery, or a plant that already produces) and the date you start. The form suggests that date from the place's frost dates or planting months and shows the tasks it will make before you save.

The app works out each planting's tasks from the plant's timing: start seeds, pot up, harden off, move outside or plant, sow, thin, feed, check for pests, and the harvest window. Every task links to its guide and what you'll need. You can change a task's date, add your own, or delete one. Tick a task done and it goes in the planting's log, which also holds your own dated notes and photos. If you change a planting's start date, the tasks you haven't touched move with it.

Today shows what's overdue, due today, harvest windows open now, and the rest of the week, grouped by space. The calendar shows the month or a list, with your frost dates marked. Supplies for the next few weeks gathers what the coming tasks need into one shopping list.

## Microgreens, animals and greenhouses

A microgreen tray records the crop, the rack, how many trays and how much seed, the day it was sown, the day it should be ready to cut, and who it's for: people or one of your animals. The form fills in the dates and seed from the crop and reminds you to soak the seed when the crop needs it. "Sow again" starts the next tray of the same crop; set it to repeat every few days and Today tells you when to sow the next one, and when trays are ready to cut.

Add your animals under Microgreens. Goats and chickens use the library's safety ratings; for any other animal, rate each microgreen on its plant page. When you pick an animal for a tray, the form warns if the crop isn't safe for it, should only be given in small amounts, or hasn't been rated. Always check with your vet before a new feed.

Each greenhouse can keep notes for spring, summer, fall and winter, and its page shows the current season first.

## Food forest and containers

The Food Forest lists your fruit trees, berry bushes, vines and perennial herbs at a place, with how long until each should start bearing and its next care task. A perennial planting can record where you bought it, when, the price paid, its size or age, and when it should start bearing (the form can fill in the library's estimate).

Mark a planting as being in a container and it can move: to another space, or to another place when you move house. Its history and photos come with it, the move goes in its log, and its care dates are worked out again for the new place. A plant too tender for a place's winters gets a gentler note when it's in a pot you can bring inside.

Each perennial gets a care calendar as a rule of thumb: pruning in late winter, feeding in spring (twice for pots), mulching, a pot check, and moving to shelter before the first fall frost when it needs it. Places without frost use their coolest and rainy months instead. The app adds the coming year of care each morning, and never brings back a task you deleted.

To choose what to buy, open What to buy from the Food Forest: the library opens with fruit trees, shrubs and vines that fit the place's winters, sorted fastest to produce first.

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
