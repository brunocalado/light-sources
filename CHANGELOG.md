# 0.8.1

### Fixed

* **Italian translation updated** (#18, thanks @GregoryWarn). Adds the missing strings for the refused-light notice and the effect expiry event, and tightens the wording of the running-low option.


# 0.8.0

### Added

* **A light that spends a charge keeps the time it had left** (#16). Putting out a `"charge"` light before it burns down — with **Extinguish Light**, through `deactivate`, or by lighting another source — keeps the time it had left on its item. The next lighting of that item burns that time without spending another charge, and an item that kept time can still be lit at 0 charges. Hover the source in the flame menu to see how much is left. A light that burns out, or that moves to the ground or to another character, keeps nothing this way. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#consume).
* **Lights that run low before they go out** (#12). Each pattern can have a second, running-low look — its own radii, color and animation — and a source's **Running Low Phase** sets how many of its last minutes use it. A light switches to it on its own, in hand or on the ground, and switches back if the clock is rewound. `registerSources` accepts it as `ending` on a pattern's `light` and `endingMinutes` on the entry. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#ending).

### Fixed

* **The flame button's tooltip is shown.** Hovering the flame button on the Token HUD now tells what is lit and how many minutes it has left. Foundry 14 never displayed that text.
* **A GM can drag a dropped light on the Lighting layer** (#12). The players' on/off control over an interactive light sat on top of core's own light icon, so dragging the light switched it off instead of moving it. The controls are now hidden while the Lighting layer is active, where a right-click already switches a light.


# 0.7.0

### Added

* **Advanced light options per pattern** (#12). Each pattern in the light editor has a folded **Advanced** section with Foundry's coloration technique, luminosity, attenuation, saturation, contrast and shadows. They apply only when **Use Advanced Options** is ticked, and then both on the token and on a light dropped on the ground. Left off, a pattern behaves exactly as before: the token keeps its own advanced options and a dropped light uses Foundry's defaults. Not offered for a darkness source. `registerSources` accepts them as an optional `advanced` object on a pattern's `light`. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#advanced).


# 0.6.0

### Added

* **A light source can be kept from being dropped** (#14). A new **Can Be Dropped** switch on the Consumption tab of the light editor, on by default. Turned off, the Token HUD no longer offers **Drop** for that source, for a light built into what the character wears, such as glowing armor or a lamp fixed to a helmet. The light still leaves together with its item when a module carries the item off through `dropLightWithItem` or `handOverLight`. `registerSources` accepts it as `droppable`. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#droppable).


# 0.5.0

### Changed

* **Every registered pattern needs an `id`.** A pattern was identified by its `name`, so a translated name gave the same pattern different ids on clients with different languages, and a pattern with no name, which the docs allowed for a source with a single pattern, was rejected. A pattern now has an `id`, a key unique within its entry that is never shown. Its `name` is only the label: it can be localized or left empty. An entry with a pattern missing an `id`, or with two patterns sharing one, is skipped with a console warning. `activate`'s `pattern` option takes the pattern's id instead of its name. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#patterns).


# 0.4.0

### Added

* **Copy light sources to another world** (#11). A new **Import or Export Light Sources** menu in the module settings saves the world's light sources, the GM's edits to sources that modules provide, and the System Compatibility settings to a JSON file, and loads such a file in another world. The import shows what it will change before writing anything. Compatibility is applied only between worlds of the same game system. A source whose item does not exist in the new world is still imported and keeps working by name and type.

### Changed

* **Light sources registered by other modules are no longer stored in the world.** Each module registers its sources again every session, on every client, and only the GM's own sources and the GM's edits are saved. A module that is disabled takes its sources with it, unless the GM edited them. Modules using the API must call `registerSources` on every client, not only the GM's. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#gm-customization-important).
* **A source's id is its item's UUID.** `activate` takes that id, and `getActive` reports it as `sourceId`. A pattern's id is the name its module registered it under.
* **Light sources configured before this version are not kept.** The module now stores them in a new setting, so a world updated from 0.3.0 starts with no sources of its own and has to set them up again. Lights burning during the update can still be put out and still burn out, but they can no longer be dropped, picked up or handed over.

### Fixed

* **A light with no color works in Daggerheart.** A pattern whose color was left blank made Daggerheart throw an error when it was lit, and the token stayed dark. Such a light now shines with no tint, as it always did in other systems.
* **A light source the GM removes stays removed.** Removing a source registered by another module used to last only until the next session, when the module registered it again. It is now listed under **Removed module light sources**, where Restore brings it back.
* **`registerCompatibility` no longer tries to write world settings from a player's client**, which only a GM may do.


# 0.3.0

### Added

* **A light can spend a charge and burn on its item.** A new `consume` value, `"charge"`, spends one charge of a single object instead of one copy of a stack: a torch that can be lit three times, a wand with charges. The light burns on that item, so it goes out when the item leaves the character and travels with it when a module carries the item onto the map. Two new compatibility paths say where charges live: **Item Charges Path** (charges left, e.g. `system.uses.value`) and an optional **Charges Spent Path** for systems that count charges used instead (e.g. `system.uses.spent`). Both can be seeded through `registerCompatibility`. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#consume).
* **A lit item handed to another character keeps its light.** A new API function, `handOverLight`, lets a system or module that gives items between characters take the light along. Create the copy on the receiver, call `handOverLight(original, copy)`, then remove the original. The light moves with the time it had left and spends nothing, so a torch with charges doesn't lose one to a lighting that never happened. Between two players it goes through the GM. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#handoverlightfromitem-toitem).

### Changed

* **`consume` says what lighting spends.** The API and the stored sources take `"none"` or `"copy"` instead of `false` or `true`. An API entry with any other value is skipped with a console warning. There is no migration: a source stored with the old boolean lights without spending until it is registered again or opened in the editor and saved. The editor shows a select instead of a checkbox.

### Fixed

* **A light the game system refuses is no longer spent or announced.** Some systems don't let modules add effects to actors. PF2e refuses all of them (#9). Lighting a source there used to spend the item and post the "lit" message while the token stayed dark. Now nothing is spent, nothing is posted, and a warning says the light was refused. `activate` returns `false`, and `pickupGroundLight` and `handOverLight` return the reason `"refused"`. On PF2e the module still can't light anything.
* **A light set down from the Token HUD can't be lit a second time.** A lantern put down and lit again used to give two lights from one lantern. Picking the light back up now returns it to the item it came from.


# 0.2.0

### Added

* **Other modules can carry a lit light to the ground with its item.** Two new API functions, `dropLightWithItem` and `pickupGroundLight`, let a module that moves items between sheets and the map (loot, a thrown lantern) take the light along. The light lands where the item lands and comes back with the burn time it had left. See [the API docs](https://github.com/brunocalado/light-sources/blob/main/docs/register-sources-api.md#droplightwithitemitem-where).

### Changed

* **A lit light belongs to the item that burns.** A light from a source that doesn't consume its item now remembers which item it is. `getActive` reports it as `itemId`.

### Fixed

* **Removing a lit item puts its light out.** Deleting a lit lantern from a sheet, or dragging it to another actor, used to leave the token glowing until the timer ran out.
* **Burned-out lights go out without console errors, and lights on the ground go out on time.** When the in-game clock moved past a light's end, Foundry's own effect expiry and this module both acted on the same light, and two checks could overlap and put the same light out twice. The error that followed also stopped that check before it reached the lights lying on the ground, so they stayed lit up to 15 seconds longer. Light effects now use their own expiry event, which Foundry leaves to this module, and the checks run one at a time. Lights lit before this update can still show the error once, when they burn out.
* **Ctrl+Z on the Lighting layer no longer loses or copies a dropped light.** The GM's client recorded every light the module placed on the ground or picked up, including the ones done for players. Undoing on the Lighting layer could then remove a dropped light, putting the flame out for good, or bring back one already picked up, so the same flame burned in two places. Those changes are no longer recorded. Lights the GM places by hand can still be undone as before.
* **A player dropping a light with no GM connected keeps it.** The light was put out on the token before the module found out there was no GM to place it on the ground, so it vanished. The light now stays on the token and the player is told a GM is needed.


# 0.1.2

### Added

* **Italian translation.** Thanks to [GregoryWarn](https://github.com/GregoryWarn). ([#8](https://github.com/brunocalado/light-sources/pull/8))


# 0.1.1

### Fixed

* **Installs on hosts with their own package installer.** The download used GitHub's source archive, which wraps every file in a `light-sources-main/` folder. Foundry's own installer looks for `module.json` inside that folder, but some hosts (Sqyre, #7) extract the archive as-is, so the module never showed up. Each version is now published as a GitHub release whose `module.zip` has the module files at its root. The zip also no longer includes the README's images and GIFs.

  **Update the manifest URL** if you installed from the old one: `https://github.com/brunocalado/light-sources/releases/latest/download/module.json`. Installs from the old URL still update, since the last `module.json` on `main` points to the new location.


# 0.1.0

### Fixed

* **Light sources keep matching their items when the name changes.** An item was meant to be recognised by its origin first and its name only as a fallback, but the origin check read `flags.core.sourceId`, which Foundry v14 no longer writes — so every item was matched by name. A source then stopped lighting when the item's name and the registered name drifted apart: a player renaming "Torch" to "Aldo's Torch", a translation module switched on (or off, or to another language) after the world was created, while the torches already on character sheets kept their old name. Matching now reads `_stats.compendiumSource`, where v14 records the origin, so any copy that came from the registered compendium entry matches under any name. Items with no origin, and sources registered by name only, still match by name as before.

* **Dragging the same item into the config window twice is caught in any language.** The duplicate check compared name and type only, so the same compendium entry seen under a translated name registered a second time. It now also refuses an item whose UUID is already registered. The name-and-type check stays, because two sources sharing a name would compete for the same items through the name fallback.


# 0.0.9

### Added

* **Darkness sources.** A light pattern can now be marked **Darkness Source** in the light editor: it dims the area inside its radii instead of revealing it, using core's own negative-light support. Everything else about the pattern is unchanged — radii, angle, color, intensity, consumption and duration all behave the same, dropping one on the ground places a darkness light, and extinguishing restores the token's own light as before.

  Light and darkness draw from two completely separate animation sets in Foundry, so the animation dropdown swaps to the darkness animations when the option is switched on. A pattern flipped to negative therefore loses whatever animation type it had — the old value would not have rendered anything anyway. `negative` is a property of the pattern, not the source, so a single source can own both a light pattern and a darkness pattern and offer them side by side in the Token HUD.

* **Light a source from code.** The public API gains three functions: `activate(actor, uuid, options?)` lights a registered source exactly as a Token HUD click would (same consumption, same duration, same chat announcement) and reports whether it happened; `deactivate(actor)` puts the light out; `getActive(actor)` reads back what is burning. See `docs/register-sources-api.md`.

  This exists for a light whose real cost is not a quantity — a spell slot, a fatigue token, a resource only the game system knows how to charge. The system charges it and then lights the source, instead of the module trying to model a cost it cannot see. The caller must own the actor: from a player's client that means their own character, and there is deliberately no relay that would let one player light a light on another player's actor.

* **Keep a source out of the Token HUD.** New per-source toggle in the Light Sources config window (the eye icon, beside Free for All): while set, the source is never offered in the palette and can only be lit through `activate`. Without it, a player could click the palette entry and get the light without paying whatever the system charges for it.

  A lit source is still listed whether or not it is hidden, because that row carries the extinguish, drop and cover controls. So it is invisible while off, appears the moment something lights it, and disappears again once it is put out. `hudHidden` is accepted by `registerSources` like the other usage fields: it freezes once the GM edits the source, and comes back with **Restore Module Default**.

### Fixed

* **A reusable light source no longer disappears when its item quantity is 0.** The item-quantity check was gating whether a source appears in the Token HUD at all, not just whether it can be spent — so "this item is empty" and "this item cannot be a light source" were the same test. A source registered with `consume: false` never spends anything, so its item now matches at any quantity, including 0 and including a quantity path that does not resolve on that item.

  This only mattered in systems where the configured quantity path is optional per item and rests at 0, where it made a whole shape of content impossible to express: no value of the quantity path could make a consumable torch burn down *and* a permanent lantern appear. Consuming sources are unaffected — an item worn down to 0 still stops matching, and a source still stays listed while its light is burning so it can be put out or dropped.

# 0.0.8

### Added

* **Stow a light instead of destroying it.** New per-source option **Can Be Covered** (off by default), on the light editor's Consumption tab. A source that has it grows a **Stow** control beside **Drop** on the Token HUD row of the light currently burning: stowing covers the light instead of ending it — it stops shining, but the effect and its expiry both stay put, so the countdown keeps running and **Uncover** brings it back with only the time it has left. A covered light burns out on schedule like any other, announced in chat as usual. ([#3](https://github.com/brunocalado/light-sources/issues/3))

  This exists for lights that are a spell on an object rather than a flame. A Light cantrip cast on a pebble is pocketed, not snuffed, and the only "off" the module had was **Extinguish**, which ends the spell — a one-way door, and worse for a character carrying a light someone else cast, whose HUD row disappears along with it. Torches, lanterns and candles keep the behaviour they have always had: the option stays off unless a GM turns it on, and every control they show is unchanged.

  Covering uses core's own `disabled` on the effect rather than zeroing the light radius, which has one visible consequence: a token that emits light of its own — a glowing creature, a light on its prototype token — gets that light back while the carried source is covered, instead of being blacked out. It also means the light can be uncovered from the effects tab of the character sheet; the HUD reads the effect's state rather than a copy of it, so the two never disagree.

* **A covered light stays covered on the ground.** Dropping a stowed light places it using the AmbientLight's native `hidden` state — the same one the map control switches — and picking it back up returns it covered, with its remaining time. This applies only to sources marked **Can Be Covered**; a torch snuffed on the floor and picked back up lights normally, as before.

* `coverable` is accepted by `registerSources`, so a system or module integration can ship it as a default. Like the other usage fields it freezes once the GM edits the source, and comes back with **Restore Module Default**. See `docs/register-sources-api.md`.

# 0.0.7

### Added

* **Restrict light control to the GM.** New world setting, **Restrict Light Control to the GM** (off by default). When enabled, only the GM may activate, extinguish, drop or pick up a light source from the Token HUD — players still see the palette and the lit/unlit state, but their clicks on those controls are refused. ([#2](https://github.com/brunocalado/light-sources/issues/2))
* **Toggle for "light lit" chat announcements.** New world setting, **Announce Lights in Chat** (on by default). Turn it off to stop the "{actor} lights {item}" chat card from posting when a source is lit. Extinguishing, dropping, picking up and burning out keep announcing regardless. ([#1](https://github.com/brunocalado/light-sources/issues/1))

# 0.0.6

### Added

* **`registerCompatibility` API.** A system or module integration can now seed the compatibility settings — Item Types, Actor Types, and the item-quantity path — programmatically, the same way `registerSources` registers light sources. This matters most for `freeForAll` sources: without a preset, they silently showed for no one until a GM opened the Compatibility window and enabled the relevant actor type by hand. Calling `registerCompatibility` alongside `registerSources` in the integration's own `ready` hook now takes care of that. Each field is seeded only when the GM hasn't already configured it, so the call is safe to repeat every session and never overwrites a GM's own choices. See `docs/register-sources-api.md`.

### Changed

* **Clicking a lit torch in the Token HUD now puts it out.** Previously, clicking the palette entry for the light already burning did nothing — the instinctive move for a player wanting to snuff their own torch. It now extinguishes the light, the same as the dedicated **Extinguish Light** row.
* **Token HUD tooltips removed.** The flame toggle and the **Pick Up Light** button no longer pop up a tooltip on hover; the same text is still exposed to screen readers via `aria-label`.



# 0.0.5

### Added

* **Lights the players can switch.** Tick **Players Can Switch** on any light in the scene's own light configuration and a control appears over it on the map, much like a door's. Players walk a token up to the light and click to snuff it or light it again — a corridor of torches becomes something a stealthy party can do something about. The control has to be reached: a token must be standing on the light or on a square beside it, so putting out the torch at the end of the hall means going down the hall.
* **Dropped lights are interactive from the start.** A torch a player put on the floor is theirs to work, with no GM opt-in — they can walk back and snuff it, light it again, or pick it up entirely.



# 0.0.4

### Added

* **Pick a light back up off the ground.** A light dropped on the floor is no longer gone for good. Stand a token on it — or on any square beside it — and **Pick Up Light** appears in the Token HUD's flame menu. The flame returns to the token with only the burn time it has left, and nothing is consumed: it's the same torch that was put down, not a new one off the sheet.

### Changed

* **Lights left on the ground now burn down.** A dropped light keeps counting on the very clock it had on the token and goes out on its own when its time is up, announced in chat. Previously it stayed lit forever, and picking one up would have handed back a torch with its countdown reset.
* Dropped lights now record which source and pattern they came from, so the module can tell a torch a player left behind from ambient lighting the GM placed by hand. Lights dropped before this version are ordinary scenery and cannot be picked up.

