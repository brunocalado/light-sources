# Register Sources API

The **Light Sources** module exposes a public API that lets other Foundry VTT modules and game systems programmatically register light source definitions — no manual drag-and-drop required.

Registered sources appear in the Token HUD alongside manually configured ones, and in the GM's Light Sources configuration window with a badge indicating which module manages them.

Registered sources are **not stored in the world**. They live in memory on each client, so your module registers them on **every** client, every session — the `ready` hook in the [Full Example](#full-example) does exactly that. Only the GM's own sources and the GM's edits to yours are stored.

---

## Accessing the API

The API is available after the `ready` hook fires. Two access paths are provided:

```js
// Foundry formal standard (safe with optional chaining when the module may be inactive)
const api = game.modules.get("light-sources")?.api;

// Convenience alias
const api = game.lightSources;
```

Both references point to the same object.

> ⚠️ **Gotcha — `ready`-vs-`ready` race condition**: "Available after the `ready` hook fires" only guarantees the API exists once *Light Sources' own* `ready` handler has finished running — not before. Foundry does not serialize different modules' `Hooks.once("ready", ...)` callbacks relative to each other, and both sides are typically `async`. If your module's `ready` handler happens to execute (or resume after an `await`) before Light Sources' does, `game.modules.get("light-sources")?.api` is still `undefined` at that instant — even though the module is installed, active, and about to set it a moment later.
>
> **Symptom**: the naive guard in the [Full Example](#full-example) below (`if (!api) return;`) exits silently. No error, no console output, nothing registered — indistinguishable from the module simply not being installed. This is easy to misdiagnose as a bug in Light Sources itself.
>
> **Fix**: check `mod.active` first (so you still no-op cleanly when the module truly isn't present), then poll for the `api` property for a few seconds before giving up — and log a `console.warn` if it never appears, so a genuine failure isn't silent:
>
> ```js
> async function waitForLightSourcesApi(retries = 20, delayMs = 250) {
>   for (let i = 0; i < retries; i++) {
>     const api = game.modules.get("light-sources")?.api;
>     if (api) return api;
>     await new Promise(resolve => setTimeout(resolve, delayMs));
>   }
>   return null;
> }
>
> Hooks.once("ready", async () => {
>   const mod = game.modules.get("light-sources");
>   if (!mod?.active) return;
>
>   const api = await waitForLightSourcesApi();
>   if (!api) {
>     console.warn("My Module | Light Sources is active but its API never became available");
>     return;
>   }
>
>   await api.registerSources([/* ... */], { managedBy: "my-module" });
> });
> ```

---

## `registerSources(entries, options?)`

Register one or more light source definitions on this client. Registering a UUID again replaces that source.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `entries` | `object[]` | ✅ | Array of light source definitions (see [Entry Schema](#entry-schema) below). |
| `options` | `object` | — | Optional settings for the call. |
| `options.managedBy` | `string` | — | An identifier for the calling module or system (usually its module id). Sources stamped with this value show a read-only badge in the GM's configuration window. |

### Returns

`Promise<void>` — resolves once the definitions are registered on this client. Nothing is written to the database, so any user may call it.

---

## `registerCompatibility(options?)`

Seed the module's compatibility settings — the same values the GM can set by hand in **Settings → Light Sources → Configure System Compatibility** — from your own module or system code. This plays the same role `SYSTEM_PRESETS` plays for systems built into the module (like Daggerheart), but supplied at runtime by you instead of hardcoded in the module.

This matters most for `freeForAll` sources: they only appear in the Token HUD for actor types enabled in the **Actor Types** compatibility setting (see [`freeForAll`](#freeforall) below). For a system with no built-in preset, that list starts empty, so a `freeForAll` source silently shows for nobody until either the GM visits the Compatibility window, or your code calls `registerCompatibility`.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `options` | `object` | — | The values to seed. |
| `options.itemTypes` | `string[]` | — | Item type ids to enable as light sources. |
| `options.actorTypes` | `string[]` | — | Actor type ids allowed to carry/light sources — and, specifically, to use `freeForAll` sources without an item. |
| `options.quantityPath` | `string` | — | Dotted path (from an item's root) to its quantity, e.g. `"system.quantity"`. |
| `options.chargesPath` | `string` | — | Dotted path (from an item's root) to how many charges it has left, e.g. `"system.uses.value"`. Read by `consume: "charge"` sources. |
| `options.chargesSpentPath` | `string` | — | Dotted path (from an item's root) to how many charges it has used, e.g. `"system.uses.spent"`, for a system that stores the count going up. When set, lighting adds one here instead of subtracting one from `chargesPath`, which is still what is read. |

### Returns

`Promise<void>` — resolves once any seeded settings are persisted. On a player's client it does nothing: only a GM may write world settings, and the GM's client seeds them for everyone.

### Behavior

Each field is seeded **independently and only when still unset** — the same "never configured yet" semantics `SYSTEM_PRESETS` uses. If the GM has already set `actorTypes` by hand (through the Compatibility window, or through a previous call to this function), a later call passing a different `actorTypes` value does **not** overwrite it, even though `itemTypes` or `quantityPath` might still be empty and get seeded normally.

This makes the call **safe to repeat every session**, the same way `registerSources` is meant to be re-called on every `ready` — it only ever fills in what nobody has configured yet, and never fights the GM for values they've already chosen.

---

## Entry Schema

Each object in the `entries` array describes a single light source:

```js
{
  uuid: string,              // Required – compendium or world item UUID (primary key)
  patterns: [                // Required – one or more light patterns
    {
      id: string,            // Required – stable key, unique within the entry; never shown, never translated
      name: string,          // Optional – label shown in the Token HUD when there are several patterns; may be localized or empty
      light: {               // Foundry light configuration
        dim: number,         //   Dim light radius (in grid units)
        bright: number,      //   Bright light radius (in grid units)
        angle: number,       //   Emission angle in degrees (360 = omnidirectional)
        color: string,       //   CSS hex color, e.g. "#ff8800"
        alpha: number,       //   Color intensity (0–1)
        negative: boolean,   //   Shed darkness instead of light (default: false) — see below
        animation: {
          type: string,      //   Foundry animation type, e.g. "torch", "pulse", "flame"
          speed: number,     //   Animation speed (1–10)
          intensity: number, //   Animation intensity (1–10)
          reverse: boolean   //   Reverse animation direction
        },
        advanced: {          // Optional – core's advanced light options; omit or null to leave the token's own untouched
          coloration: number,  //   Coloration technique id (AdaptiveLightingShader.SHADER_TECHNIQUES), default 1
          luminosity: number,  //   0–1, default 0.5
          attenuation: number, //   0–1, default 0.5
          saturation: number,  //   -1–1, default 0
          contrast: number,    //   -1–1, default 0
          shadows: number      //   0–1, default 0
        },
        ending: {            // Optional – the running-low look, shown in the source's last endingMinutes; omit or null to keep this look to the end
          dim: number,       //   As above
          bright: number,
          color: string,
          alpha: number,
          animation: { type: string, speed: number, intensity: number, reverse: boolean }
        }
      }
    }
  ],
  consume: string,           // Optional – what lighting spends: "none", "copy" or "charge" (default: "none")
  freeForAll: boolean,       // Optional – any actor of an Actor-Types-enabled type can light this, no inventory item needed (default: false)
  coverable: boolean,        // Optional – the light can be covered instead of ended, keeping its remaining duration (default: false)
  droppable: boolean,        // Optional – the Token HUD offers Drop while the light burns (default: true)
  hudHidden: boolean,        // Optional – never offered in the Token HUD; lit only through activate() (default: false)
  durationMode: string,      // Optional – "world" (in-game clock) or "real" (wall clock) (default: "world")
  durationMinutes: number,   // Optional – minutes until the light burns out; 0 = unlimited (default: 0)
  endingMinutes: number      // Optional – the last minutes in which each pattern shows its running-low look; 0 = off (default: 0)
}
```

### Key Fields

#### `uuid`
The **primary key**, and the source's id: `activate`, `getActive` and the GM's edits all refer to the source by it. Must be a valid Foundry UUID that resolves to an Item (compendium or world). If the UUID cannot be resolved, the entry is skipped with a console warning.

The item's `name`, `img`, and `type` are read automatically — you never need to supply them. A compendium entry is read from the pack's index, so this costs no server request and works on a player's client even for a pack hidden from players.

#### `patterns`
A source can have **multiple light patterns** — different ways the same item emits light. For example, a lantern might have a "Low" pattern (dim, warm glow) and a "High" pattern (bright, wide radius). Each pattern appears as a separate entry in the Token HUD. If a source has only one pattern, no sub-label is shown.

Every pattern has an **`id`**: a key you choose, unique within the entry, that stays the same across versions of your module. A lit light, a light on the ground and the GM's edits refer to the pattern by it, and `activate` selects a pattern by it. Change it and lights lit from the old id can no longer be dropped or picked up. The **`name`** is only a label, separate from the id on purpose: it can be localized with `game.i18n`, so it may differ between clients, the GM can rename it, and a source with a single pattern can leave it empty.

Consumption and duration are shared across all patterns of the same source; only the emitted light shape differs. Moving between the patterns of the light already burning reshapes that flame in place: nothing is spent, the countdown keeps running from when the source was first lit, and nothing is announced in chat. A player can therefore switch a lantern between "Low" and "High" freely, and can still switch after burning the last item in the stack.

#### `consume`
What **lighting** the source spends. `"none"` (the default) spends nothing: the item is the light, like a lantern. `"copy"` subtracts one from the matching item's quantity, using the quantity path configured in the module's compatibility settings: the item is a stack of identical lights, and one copy becomes the flame. Activation is the *only* moment an item is ever spent — dropping a lit light on the ground never consumes and never refunds (see [Dropping](#dropping)). A `consume: "none"` source therefore never touches inventory at any point. An entry with any other value is skipped, with a console warning. `"fuel"` (a lantern that spends a copy of a second Item, such as oil) is not accepted here either: the GM sets it in the light editor, where the fuel Item is dragged in, and an entry with it is skipped with a console warning.

`"charge"` spends one charge of one object: a torch that can be lit three times, a wand or a Driftglobe with charges. What is left is read from the charges path configured in the compatibility settings (see [`registerCompatibility`](#registercompatibilityoptions)), and one is subtracted there when the source is lit — or, when a charges-spent path is set, one is added to that instead. Unlike `"copy"`, the flame burns on that Item: it moves with it through [`dropLightWithItem`](#droplightwithitemitem-where) and [`handOverLight`](#handoverlightfromitem-toitem), and it goes out when the Item leaves the actor any other way. A charge put out before it burns down is not lost: when the light is extinguished from the Token HUD or through [`deactivate`](#deactivateactor), or replaced by lighting another source, the seconds it had left are kept on the Item, and the next lighting of that Item burns them instead of spending another charge (capped at the source's current `durationMinutes`; a source with no duration keeps nothing). A light that burns out, moves to the ground or to another actor, or leaves with its Item keeps nothing that way: the flame itself carries its time when it moves. Use it for an object with uses, never for a stack. It assumes the Item survives at 0 charges. A system that removes an object once its last charge is gone puts the light out on that removal, as any removal does, so such a system should use `"copy"`.

Items are matched by `_stats.compendiumSource` (the origin UUID core stamps on a copy made from a compendium), falling back to name + type, so a source keeps working after a player renames the item on their sheet or a translation module renames it. The fallback only fires when the item has no matching origin, so a system that creates items outside core's compendium import — a character creator, a shop, a starting kit — should stamp `_stats.compendiumSource` with the pack entry's UUID on each copy it makes; otherwise those items are matched by name alone.

Quantity only gates a source that spends it. For `consume: "copy"`, an item whose quantity has reached 0 stops matching, and the same holds for `"charge"` and an item whose charges have reached 0, unless it kept the time of a charge put out early, which it can still burn (though the source stays listed in the HUD while its light is still burning, so it can still be extinguished or dropped). For `consume: "none"` the quantity is never read, so the item matches at any value — including 0, and including a quantity path that does not resolve on that item at all. That is what lets a reusable tool be a light source in a system where the configured path is optional per item: without it, no value of `quantityPath` can make a consumable torch burn down *and* a permanent lantern appear.

#### `negative`
A pattern with `negative: true` is a **darkness source**: it dims the area inside its radii instead of revealing it, using core's own `LightData#negative`. Everything else about the pattern works unchanged — radii, angle, color, intensity, duration and consumption all behave the same, and extinguishing restores the token's own light exactly as it does for a normal pattern.

Light and darkness draw from **two disjoint animation sets**. Foundry offers `torch`, `pulse`, `flame` and the rest to light sources, and `magicalGloom`, `roiling`, `hole` and `denseSmoke` to darkness sources; an animation type from the wrong set is not an error, it just renders with no animation at all. The light editor swaps the animation dropdown when the option is toggled, so a pattern flipped to negative loses whatever animation type it previously had. When registering a negative pattern in code, pick its `animation.type` from the darkness set or leave it empty.

Negative is a property of the **pattern**, not of the source, so one source can own both a light pattern and a darkness pattern and the Token HUD offers them side by side.

#### `advanced`
Core's **advanced light options** for a pattern. Leave it out (or `null`) and the pattern sets none of them: a lit token keeps its own advanced values and a dropped light gets Foundry's defaults. Give the object and all six are set, both on the token and on a light dropped on the ground; a field left out takes the default listed above. The GM can switch them on per pattern in the light editor. The editor offers no advanced section for a `negative` pattern, as core's own light config offers none for darkness, so a GM saving a darkness pattern there clears it.

#### `ending`
A pattern's **running-low look**: its own radii, color, intensity and animation, shown in the source's last [`endingMinutes`](#endingminutes) before the light burns out — a torch that gutters redder and smaller, a lantern that flickers as its oil runs dry. Leave it out (or `null`) and the pattern keeps its full look to the end. `negative`, `angle` and `advanced` are not part of it: they say what the light is, not how much fuel it has left, so they carry over from the full look. A darkness pattern can have one too; its darkness shrinks as it fades.

#### `freeForAll`
When `true`, the source appears in the Token HUD only for actor types enabled in the module's compatibility settings (the "Actor Types" tab) — it needs no inventory item, and the item is never consumed. Useful for ambient environmental effects ("everyone eligible can see in this magically lit area").

Item-based sources (`freeForAll: false`, the default) work differently: they appear in the Token HUD for **any** actor type that carries a matching item, regardless of the Actor Types setting — carrying the item is itself the permission check. The Actor Types setting only restricts `freeForAll` sources.

#### `coverable`
When `true`, the Token HUD grows a **Stow** control beside **Drop** on the row of the light currently burning. Stowing covers the light instead of ending it: it stops shining, but the effect and both expiry stamps stay exactly where they are, so the countdown keeps running and **Uncover** brings it back with only the time it has left. The expiry sweep puts a covered light out on schedule like any other, announced in chat the usual way.

This is meant for a light that is a spell on an object rather than a flame — a Light cantrip cast on a pebble is pocketed, not snuffed, and pocketing it must not end the spell. Leave it `false` (the default) for torches, lanterns and candles, whose only correct "off" is destructive.

Covering is implemented as core's own `disabled` on the effect, not as a radius of 0, which has one visible consequence worth relying on: a token that emits light of its **own** (a glowing creature, a prototype-token light, another module's aura) gets that light back while the source is covered, instead of being blacked out. It also means a player can uncover a light straight from the effects tab of their character sheet; the Token HUD reads the effect's state rather than a copy of it, so the two never disagree.

Two limits follow from the module's one-light-per-actor rule, and neither changes with `coverable`:

- **Extinguish still ends the light for good**, covered or not, and so does lighting a *different* source — a covered light is deleted like any other when it is replaced. Only a `consume: "charge"` light keeps its unburned time, on its Item (see [`consume`](#consume)). To keep a spell alive while lighting something else, **drop** it: on the ground it goes on burning down, and anyone can pick it back up.
- **A covered light dropped on the ground stays covered**, using the AmbientLight's native `hidden` state — the same state the map control switches. Picking it back up returns it covered. This applies only to `coverable` sources: a torch snuffed on the floor and picked up lights normally, exactly as it always did.

#### Dropping
Any lit light can be dropped on the ground as an AmbientLight from the Token HUD. Dropping **relocates the burning light** — it does not spend an item, whatever the source's `consume` value: a `"copy"` source already paid when it was lit, and a `"none"` one never pays at all. The control appears only on the entry that is currently lit, since there is nothing to relocate otherwise.

A dropped light lands on the dropping token's level and at its elevation, the way [`dropLightWithItem`](#droplightwithitemitem-where) takes both from `where`. It keeps the schedule it had on the token. It burns out on its own when its time is up, announced in chat, and a token on the same level, standing on it or on a square beside it, can pick it back up from the Token HUD. The flame returns with only the time it has left, and nothing is spent. While a light dropped from the Token HUD lies on the ground, the item it burned on cannot be lit again (a `"copy"` source is not affected). When the same actor picks it back up, it relights on that same item. Lights placed by another module through [`dropLightWithItem`](#droplightwithitemitem-where) are handed back by that module instead, not from the Token HUD.

`freeForAll` sources are droppable too, but because nothing backs them they could be lit and dropped without limit. The GM world setting **Allow Dropping Free for All Lights** (on by default) gates that; it does not affect item-based sources. Dropping never removes anything from inventory — do not register a source expecting it to.

#### `droppable`
When `false`, the Token HUD never offers **Drop** for this source: the light stays on the token until it is extinguished, burns out, or its Item leaves the actor. Meant for a light built into what the actor wears — glowing armor, a lamp fixed to a helmet — whose light has no business lying on the floor without it. Defaults to `true`; for a `freeForAll` source, the world setting above must also allow dropping.

It governs the Token HUD only. [`dropLightWithItem`](#droplightwithitemitem-where) and [`handOverLight`](#handoverlightfromitem-toitem) still move such a light, because there it leaves *together with* its Item, which is exactly how a built-in light should travel. Like the other usage fields it freezes once the GM edits the source.

#### `durationMode`
Controls how the countdown timer works:

| Value | Behavior |
| :--- | :--- |
| `"world"` | Burns down as the GM advances the in-game world clock. Stays lit while the clock is still. |
| `"real"` | Burns down in real-world minutes, even while the game is paused or the owning player is offline. |

#### `endingMinutes`
How many of the last minutes before the light burns out each pattern shows its [`ending`](#ending) look. `0` (the default) turns it off; a pattern with no `ending` keeps its full look whatever the value. A value at or above `durationMinutes` makes the light burn its running-low look from the moment it is lit. It counts on the source's own clock (see [`durationMode`](#durationmode)), so a source with no duration never runs low.

Whether a light runs low is worked out from its expiry stamps every time, not scheduled: a light lit, picked up or handed over inside the window starts low, a pattern switch takes the new pattern's running-low look, and a covered light changes its look and stays covered. The active GM's client switches lights that cross the threshold on its regular sweep — every time the world clock moves, and every 15 seconds — both ways, so rewinding the clock brings the full look back. Lights on the ground switch the same way.

#### `hudHidden`
When `true`, the source is **never offered in the Token HUD palette** while it is unlit. It can only be lit through [`activate`](#activateactor-id-options) — which is the point: for a source whose real cost is a spell slot, a fatigue token or anything else only the game system knows how to charge, a palette entry is a way to get the light without paying for it.

A source that is currently lit is always listed, `hudHidden` or not, because that row is what carries the extinguish, drop and cover controls. So the practical behaviour is: invisible while off, appears the moment something lights it, disappears again when it is put out.

This pairs with `consume: "none"` in most cases — the module is not charging anything, the caller already did.

---

## `activate(actor, id, options?)`

Lights a registered source on an actor, exactly as clicking it in the Token HUD would: same consumption, same duration, same chat announcement, and the same one-light-per-actor rule.

```js
const lit = await game.lightSources.activate(actor, "Compendium.my-system.spells.Item.light01");
const lit = await game.lightSources.activate(actor, sourceUuid, { pattern: "narrow" });
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actor` | `Actor` | The actor to light. **Must be owned by the current user.** |
| `id` | `string` | The source's id: its `uuid` for any source with an Item, and for a source the GM added by name, the id `getActive` reports. |
| `options.pattern` | `string` | Id of the pattern to light. Defaults to the source's first pattern. |

Returns `Promise<boolean>` — `true` when the source is now lit, `false` when it was refused. It is refused when no source is registered for that id, when no pattern has the given id, when the current user does not own the actor, or when a `consume: "copy"` or `"charge"` source's item is no longer carried or has nothing left to spend. It is also refused while the light of every matching item, dropped from the Token HUD, lies on the ground (see [Dropping](#dropping)), and when the game system or another module refuses the light's effect on the actor. Nothing is spent and nothing is announced then, and the user sees a warning. PF2e refuses every effect a module adds to an actor, so no light can be lit there.

**Ownership.** Foundry refuses embedded document creation on an actor the current user does not own, so from a player's client this reaches their own character and nothing else; from the GM's client it reaches anyone. This is checked up front and reported as `false` rather than left to throw. There is deliberately **no relay** that would let one player light a light on another player's actor — routing that through the GM would mean any client could ask the GM to write ActiveEffects onto any actor, which is a larger permission surface than this module is willing to open. If your system needs to light someone else's character, run that part of the flow on the GM's client. The one relay is [`handOverLight`](#handoverlightfromitem-toitem): it goes through the GM to put a light on another player's actor, but only a light it moves off an actor the requester owns, so it never lights anything new.

**Consumption is not bypassed.** `activate` spends exactly what a HUD click would. A caller that wants no consumption should register the source with `consume: "none"`.

**The Restrict Player Control setting does not apply.** That world setting gates the Token HUD palette; this path is not the palette. Whatever charged the light has already run, and a caller can only ever reach an actor it already owns.

---

## `deactivate(actor)`

Puts out whatever light is burning on the actor, exactly as the Token HUD's extinguish control does. A no-op when nothing is lit. A `consume: "charge"` light keeps the time it had left on its Item, for its next lighting (see [`consume`](#consume)).

```js
await game.lightSources.deactivate(actor);
```

Returns `Promise<void>`.

---

## `getActive(actor)`

Reads what is currently burning on an actor.

```js
const light = game.lightSources.getActive(actor);
// → null, or { sourceId, patternId, patternName, itemName, itemId, mode, expiresAtWorld, expiresAtReal, runningLow, stowed }
```

Returns the active light payload, or `null` when the actor has no light lit. `sourceId` is the source's id — its `uuid` when it has one — and `patternId` the pattern's: for a registered pattern, the `id` it was registered with. `stowed` is `true` while the light is covered (see [`coverable`](#coverable)). `runningLow` is `true` while the light shows its pattern's running-low look (see [`endingMinutes`](#endingminutes)). `expiresAtWorld` / `expiresAtReal` are absolute stamps and are `null` for a source with no duration.

`itemId` is the id of the carried Item that is burning. Every source has one except two: a `"copy"` source turned one of its items into the flame, and a `freeForAll` source has no item at all, so for those it is `null`. When that Item leaves the actor (deleted from the sheet, dragged to another actor, removed by another module), its light goes out, unless whatever moved it took the light along with [`dropLightWithItem`](#droplightwithitemitem-where) or [`handOverLight`](#handoverlightfromitem-toitem).

---

## `dropLightWithItem(item, where)`

Moves the light burning on an Item's actor to the ground, together with that Item. It is meant for a module that carries Items off actors and onto the map, such as loot or a thrown lantern.

```js
const light = await game.lightSources.dropLightWithItem(item, {
  scene, x, y, elevation: 0, levels: [levelId], managedBy: "my-module"
});
if ( light ) { /* keep light.id with your own document */ }
await item.delete();
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `item` | `Item` | The Item about to leave its actor. **Still on the actor when called.** |
| `where.scene` | `Scene` | The scene it lands on. It doesn't have to be the one being viewed. |
| `where.x`, `where.y` | `number` | The light's centre. Rounded to integers. |
| `where.elevation` | `number` | Optional, `0` by default. |
| `where.levels` | `string[]` | Optional ids of the scene levels it belongs to, `[]` by default. |
| `where.managedBy` | `string` | The id of your module or system. **Required.** |

Returns `Promise<AmbientLightDocument | null>`: the placed light, or `null` when nothing moved. Nothing moves unless `item` is the very Item the light burns on (its `itemId`). That is every source except a `consume: "copy"` or `freeForAll` one: a lantern or a torch with uses takes its flame along, a rope leaving while a lantern burns moves nothing, and a light from a `"copy"` source never moves.

**Call it before removing the Item.** Removing a burning Item puts its light out, so once the Item is gone there is nothing left to move.

**GM client only.** Only a GM can create an AmbientLight, and you need the created document back. On any other client it logs a warning and returns `null`. Run it where a player's request is already handled on the GM, such as a `CONFIG.queries` handler.

**What happens to the light.** It burns out on its original schedule. While `managedBy` is active, this module leaves it out of its own Token HUD pickup and interactive control: your module hands it back. If your module is disabled, the light becomes an ordinary ground light that any token can pick up from the HUD. Nothing is posted to chat.

The flame is never in two places and never in none. The light is placed first and only then put out on the actor. If putting it out fails, the placed light is removed again.

---

## `pickupGroundLight(item, light)`

Puts a light placed by `dropLightWithItem` back on the actor carrying `item`. It burns on that Item with the time it had left.

```js
const { lit, reason } = await game.lightSources.pickupGroundLight(item, light);
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `item` | `Item` | The Item the light returns with, **already on the picking actor**: newly created, or the stack it merged into. |
| `light` | `AmbientLightDocument` | The light `dropLightWithItem` returned. |

Returns `Promise<{ lit: boolean, reason: string | null }>`. Once the light is found it always leaves the ground, even when it cannot be relit. When `lit` is `false`, `reason` says why:

| `reason` | Meaning |
| :--- | :--- |
| `"missing"` | The light is no longer on the scene: it burned out and was swept, or a GM deleted it. |
| `"sourceRemoved"` | Its light source or pattern no longer exists: the GM deleted or removed it, the module that registers it was disabled with no GM edit to keep it, or that module renamed the pattern. |
| `"burnedOut"` | It burned out while it lay on the ground. |
| `"occupied"` | The actor already has a light burning. That light is never replaced. The picked-up flame goes out and the Item arrives unlit. Lighting it again costs what lighting always costs — for a `consume: "charge"` Item, another charge. |
| `"refused"` | The game system or another module refused the light's effect on the actor. The picked-up flame goes out and the Item arrives unlit. |
| `"invalid"` | The call was refused: not a GM client, an Item not on an actor, or a light not placed by `dropLightWithItem`. |

**GM client only, and silent.** No chat message and no notification: the GM's client is rarely the one whose user picked the Item up. Tell your own user from `reason`, for example by returning it from your query handler.

---

## `handOverLight(fromItem, toItem)`

Moves the light burning on an Item to an Item on another actor. It is meant for a system or module that gives an Item to another character by creating a copy on the receiver and removing the original: a trade, a barter, a drag from one sheet to another.

```js
const [copy] = await receiver.createEmbeddedDocuments("Item", [original.toObject()]);
const { lit, reason } = await game.lightSources.handOverLight(original, copy);
await original.delete();
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `fromItem` | `Item` | The Item the light burns on now, **still on the giving actor**. |
| `toItem` | `Item` | The Item that takes it, **already on the receiving actor**. It must match the same light source as `fromItem`. |

**The call order.** Create the copy on the receiver, call this, then remove the original. Removing the original first puts its light out, as any removal of a burning Item does, and there is nothing left to hand over. Removed afterwards, the original has no light on it, so nothing goes out.

The flame moves, it is not copied. It keeps its source, pattern, time left and covered state, and **nothing is spent**: a torch with charges arrives with the charges it had. The light is created on the receiver first and only then put out on the giver. If putting it out fails, the receiver's light is removed again, so the flame is only ever in one place.

Returns `Promise<{ lit: boolean, reason: string | null }>`. When `lit` is `false`, nothing moved, and `reason` says why:

| `reason` | Meaning |
| :--- | :--- |
| `"notBurning"` | `fromItem` is not the Item its actor's light burns on: nothing is lit, another Item is, or the light belongs to no Item. |
| `"sourceRemoved"` | The light's source or pattern no longer exists: the GM deleted or removed it, the module that registers it was disabled with no GM edit to keep it, or that module renamed the pattern. |
| `"burnedOut"` | The light has burned out and is waiting for the expiry sweep. |
| `"occupied"` | The receiver already has a light burning. That light is never replaced, and the giver keeps its own, so you can cancel the hand-over. |
| `"noGm"` | The hand-over needed the GM, and no active GM answered. |
| `"refused"` | The game system or another module refused the light's effect on the receiver. The giver keeps its light. |
| `"invalid"` | The call was refused: an Item not on an actor (or on one in a compendium), the same actor on both sides, a `toItem` that does not match the light's source, a requester that does not own the giving actor, or a removal from the giver that another module cancelled. |

**Runs on any client.** When the current user can write both actors, the light moves right there. Between two players neither can write the other's actor, so it asks the active GM through a query, and the GM moves it only when the requester owns the giving actor. The receiver's permission is not asked: giving is the point. Without an active GM, a hand-over between two players returns `"noGm"`.

**Silent.** No chat message and no notification. Tell your own user from `reason`.

**Only a light that belongs to an Item moves.** A `"copy"` light turned one of its items into the flame, and a `freeForAll` light has no item at all, so both return `"notBurning"`. Moving an Item between containers on the same actor keeps its id, so its light needs nothing.

---

## Chat Announcements

The module posts its own styled chat card for these light events, on every source regardless of how it was registered:

| Event | Announced |
| :--- | :--- |
| The source is lit | ✅ Names the actor and the source. With more than one pattern, names the pattern too. |
| A lit light is dropped from the Token HUD | ✅ Only once the light actually reaches the ground. |
| A dropped light is picked back up from the Token HUD | ✅ |
| A duration runs out, on a token or on the ground | ✅ Posted by the active GM's expiry sweep. |
| A light is extinguished | ❌ Silent. |
| Switching between a source's patterns | ❌ Silent — the same flame is being reshaped, not lit. |
| Covering or uncovering a light | ❌ Silent — nothing was lit or put out, mirroring extinguishing. |
| `dropLightWithItem`, `pickupGroundLight` and `handOverLight` | ❌ Silent — the calling module tells its own users. |

The world setting **Announce Lights in Chat** turns off the "lit" card. The other cards always post, and there is no per-source way to opt out.

---

## Deduplication and Updates

- **Same UUID, same source**: Registering a UUID that is already registered on this client replaces that source.
- **Pattern ids**: Every pattern needs an `id`, unique within its entry; an entry with a pattern missing one, or with two patterns sharing one, is skipped with a console warning. See [`patterns`](#patterns).
- **Unresolvable UUID**: Logged as `console.warn` and skipped.
- **Removed from your list**: A source you stop registering is gone from the next session on, unless the GM has edited it (see below).

---

## GM Customization (important)

The values you pass are **defaults, not enforced settings**. The GM can edit any registered source in the module's configuration window:

- When the GM saves an edit to one of your sources, the module stores the GM's own copy of it under the same UUID. That copy **replaces your values** from then on. Your `registerSources` calls never overwrite it.
- Your calls still count for an edited source:
  - A pattern you **add** after the GM's edit still shows up, appended after the GM's patterns. A pattern of yours the GM **deleted** stays deleted.
  - The source's `name`, `img` and `type` always follow the Item.
- **Restore Module Default** deletes the GM's copy, so your current values apply again. The light editor can also restore a single pattern to what you register for it.
- When the GM **removes** one of your sources, the removal is stored too, so the source stays gone even though you register it again every session. It is listed under **Removed module light sources**, where Restore brings it back.
- If your module is later disabled, an edited source stays available, because the GM's copy is complete by itself. An unedited one disappears with your module.

Practical consequence: **do not** rely on `registerSources` to force a source back to a known state — a GM edit intentionally wins over your payload.

---

## The `managedBy` Badge

When `options.managedBy` is set, every source registered by that call is stamped with the value. In the GM's **Configure Light Sources** window, these sources display a read-only badge indicating external management.

The GM can still remove a source with the badge, and the removal sticks across sessions until the GM restores it.

`managedBy` is **purely cosmetic**, and stays optional. It does not affect [GM customization](#gm-customization-important). Do pass it anyway — it is the only thing telling a GM which module a source came from.

---

## Full Example

```js
// In your module's or system's code
Hooks.once("ready", async () => {
  // Guard: the light-sources module may not be installed or active
  const api = game.modules.get("light-sources")?.api;
  if ( !api ) return;

  // Seed compatibility once so freeForAll sources work without the GM having to
  // visit the Compatibility window by hand. Safe to call every session — it only
  // fills in fields nobody has configured yet (see registerCompatibility above).
  await api.registerCompatibility({
    itemTypes: ["equipment"],
    actorTypes: ["character"],
    quantityPath: "system.quantity"
  });

  await api.registerSources([
    {
      uuid: "Compendium.my-system.equipment.Item.torch01",
      patterns: [
        {
          id: "lit",
          name: "Standard",
          light: {
            dim: 40,
            bright: 20,
            angle: 360,
            color: "#ff8800",
            alpha: 0.4,
            animation: { type: "torch", speed: 5, intensity: 5, reverse: false }
          }
        }
      ],
      consume: "copy",
      durationMode: "world",
      durationMinutes: 60
    },
    {
      uuid: "Compendium.my-system.equipment.Item.lantern01",
      patterns: [
        {
          id: "low",
          name: "Low",
          light: {
            dim: 30,
            bright: 15,
            angle: 360,
            color: "#ffcc44",
            alpha: 0.35,
            animation: { type: "torch", speed: 3, intensity: 3, reverse: false }
          }
        },
        {
          id: "high",
          name: "High",
          light: {
            dim: 60,
            bright: 30,
            angle: 360,
            color: "#ffcc44",
            alpha: 0.5,
            animation: { type: "torch", speed: 5, intensity: 5, reverse: false }
          }
        }
      ],
      consume: "copy",
      durationMode: "world",
      durationMinutes: 240
    },
    {
      uuid: "Compendium.my-system.equipment.Item.magicglow",
      patterns: [
        {
          id: "glow",
          name: "Glow",
          light: {
            dim: 20,
            bright: 10,
            angle: 360,
            color: "#44aaff",
            alpha: 0.3,
            animation: { type: "pulse", speed: 3, intensity: 3, reverse: false }
          }
        }
      ],
      consume: "none",
      freeForAll: true,
      coverable: true,
      durationMinutes: 0
    },
    {
      // A spell, not an object. Its cost is a spell slot, which this module cannot
      // see or charge — so it is kept out of the Token HUD and lit from the cast.
      uuid: "Compendium.my-system.spells.Item.daylight01",
      patterns: [
        {
          id: "daylight",
          name: "Daylight",
          light: {
            dim: 60,
            bright: 30,
            angle: 360,
            color: "#fff4d6",
            alpha: 0.5,
            animation: { type: "sunburst", speed: 2, intensity: 4, reverse: false }
          }
        }
      ],
      consume: "none",
      hudHidden: true,
      durationMode: "world",
      durationMinutes: 600
    }
  ], { managedBy: "my-system" });
});
```

Lighting that last one is the casting flow's job, not the palette's:

```js
// Inside your system's own spell-cast handler, after the slot has been spent.
const lit = await game.lightSources.activate(actor, "Compendium.my-system.spells.Item.daylight01");
if ( !lit ) ui.notifications.warn("The light failed to take hold.");
```

A darkness spell is the same entry with `negative: true` on the pattern and an `animation.type` from the [darkness set](#light-animation-types).

In this example:
- **`registerCompatibility`** — seeds Item Types, Actor Types, and the quantity path, but only for whichever of those three the GM hasn't already touched.
- **Torch** — consumed on use, lasts 60 in-game minutes, single pattern.
- **Lantern** — consumed on use, lasts 4 in-game hours, two selectable brightness patterns.
- **Magic Glow** — free for all actors of a type listed in `actorTypes` above, never consumed, unlimited duration, and coverable: it is a spell on an object, so it can be pocketed and taken back out rather than only destroyed.
- **Daylight** — hidden from the Token HUD and lit only by [`activate`](#activateactor-id-options), because the spell slot it costs is something only the system can charge. A player cannot reach it from the palette and so cannot get the light without paying for it; once lit, its row appears with a working extinguish control for as long as it lasts.

---

## Tips

- **Call it in `ready`**: The API is assigned in the `ready` hook. Settings and compendium indices are available at that point, so UUIDs can be resolved.
- **Idempotent**: You can call `registerSources` multiple times with the same entries safely — a source registered again is replaced, not duplicated, and a source the GM has edited is never clobbered (see [GM Customization](#gm-customization-important)).
- **Register on every client, every session**: Pass your full, static entry list on every `ready`, on every client — the GM's and each player's. Sources are not stored, so a client that never registers them never shows them in its Token HUD. Do not guard the call with `game.user.isGM`.
- **System presets**: If your system already has built-in presets in the module (like Daggerheart), the API lets you replace or extend them programmatically.
- **Seed compatibility before sources**: Call `registerCompatibility` before `registerSources` in the same `ready` hook, especially if you register any `freeForAll` source — otherwise it may silently show for no one until the GM opens the Compatibility window (see [`registerCompatibility`](#registercompatibilityoptions)).

---

## Light Animation Types

Foundry keeps **two separate animation sets**, and which one applies depends on the pattern's [`negative`](#negative) flag. A type from the wrong set is not an error — it resolves to an empty animation configuration and the source simply renders static — so a darkness pattern must take its `animation.type` from the darkness table below.

### Light sources (`negative: false`, the default)

| Type | Name in the UI |
| :--- | :--- |
| `"flame"` | Torch |
| `"torch"` | Flickering Light |
| `"revolving"` | Revolving Light |
| `"siren"` | Siren Light |
| `"pulse"` | Pulse |
| `"reactivepulse"` | Sound-Reactive Pulse |
| `"chroma"` | Chroma |
| `"wave"` | Pulsing Wave |
| `"fog"` | Swirling Fog |
| `"sunburst"` | Sunburst |
| `"dome"` | Light Dome |
| `"emanation"` | Mysterious Emanation |
| `"hexa"` | Hexa Dome |
| `"ghost"` | Ghostly Light |
| `"energy"` | Energy Field |
| `"vortex"` | Vortex |
| `"witchwave"` | Bewitching Wave |
| `"rainbowswirl"` | Swirling Rainbow |
| `"radialrainbow"` | Radial Rainbow |
| `"fairy"` | Fairy Light |
| `"grid"` | Force Grid |
| `"starlight"` | Star Light |
| `"smokepatch"` | Smoke Patch |
| `""` or `null` | No animation (static light) |

### Darkness sources (`negative: true`)

| Type | Name in the UI |
| :--- | :--- |
| `"magicalGloom"` | Magical Gloom |
| `"roiling"` | Roiling Mass |
| `"hole"` | Black Hole |
| `"denseSmoke"` | Dense Smoke |
| `""` or `null` | No animation (static darkness) |

> **Note**: Available animation types vary by Foundry VTT version. The values above are read from Foundry V14's `CONFIG.Canvas.lightAnimations` and `CONFIG.Canvas.darknessAnimations`, which are also what the light editor's dropdown is built from — so whatever a given install offers, the editor and this table agree with it.
