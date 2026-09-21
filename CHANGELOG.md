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

