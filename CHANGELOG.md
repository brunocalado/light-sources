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

