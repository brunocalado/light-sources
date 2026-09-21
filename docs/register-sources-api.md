# Register Sources API

The **Light Sources** module exposes a public API that lets other Foundry VTT modules and game systems programmatically register light source definitions — no manual drag-and-drop required.

Registered sources appear in the Token HUD alongside manually configured ones, and in the GM's Light Sources configuration window with a badge indicating which module manages them.

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

Register or update one or more light source definitions. Existing sources (matched by UUID) are updated in-place; new ones are appended.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `entries` | `object[]` | ✅ | Array of light source definitions (see [Entry Schema](#entry-schema) below). |
| `options` | `object` | — | Optional settings for the call. |
| `options.managedBy` | `string` | — | An identifier for the calling module or system (usually its module id). Sources stamped with this value show a read-only badge in the GM's configuration window. |

### Returns

`Promise<void>` — resolves once the definitions are persisted.

---

## `registerCompatibility(options?)`

Seed the module's compatibility settings — the same three values the GM can set by hand in **Settings → Light Sources → Configure System Compatibility** — from your own module or system code. This plays the same role `SYSTEM_PRESETS` plays for systems built into the module (like Daggerheart), but supplied at runtime by you instead of hardcoded in the module.

This matters most for `freeForAll` sources: they only appear in the Token HUD for actor types enabled in the **Actor Types** compatibility setting (see [`freeForAll`](#freeforall) below). For a system with no built-in preset, that list starts empty, so a `freeForAll` source silently shows for nobody until either the GM visits the Compatibility window, or your code calls `registerCompatibility`.

### Parameters

| Parameter | Type | Required | Description |
| :--- | :--- | :---: | :--- |
| `options` | `object` | — | The values to seed. |
| `options.itemTypes` | `string[]` | — | Item type ids to enable as light sources. |
| `options.actorTypes` | `string[]` | — | Actor type ids allowed to carry/light sources — and, specifically, to use `freeForAll` sources without an item. |
| `options.quantityPath` | `string` | — | Dotted path (from an item's root) to its quantity, e.g. `"system.quantity"`. |

### Returns

`Promise<void>` — resolves once any seeded settings are persisted.

### Behavior

Each of the three fields is seeded **independently and only when still unset** — the same "never configured yet" semantics `SYSTEM_PRESETS` uses. If the GM has already set `actorTypes` by hand (through the Compatibility window, or through a previous call to this function), a later call passing a different `actorTypes` value does **not** overwrite it, even though `itemTypes` or `quantityPath` might still be empty and get seeded normally.

This makes the call **safe to repeat every session**, the same way `registerSources` is meant to be re-called on every `ready` — it only ever fills in what nobody has configured yet, and never fights the GM for values they've already chosen.

---

## Entry Schema

Each object in the `entries` array describes a single light source:

```js
{
  uuid: string,              // Required – compendium or world item UUID (primary key)
  patterns: [                // Required – one or more light patterns
    {
      name: string,          // Display name shown in the Token HUD
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
        }
      }
    }
  ],
  consume: boolean,          // Optional – subtract one from the item's quantity when lit; the only moment an item is ever spent (default: false)
  freeForAll: boolean,       // Optional – any actor of an Actor-Types-enabled type can light this, no inventory item needed (default: false)
  coverable: boolean,        // Optional – the light can be covered instead of ended, keeping its remaining duration (default: false)
  hudHidden: boolean,        // Optional – never offered in the Token HUD; lit only through activate() (default: false)
  durationMode: string,      // Optional – "world" (in-game clock) or "real" (wall clock) (default: "world")
  durationMinutes: number    // Optional – minutes until the light burns out; 0 = unlimited (default: 0)
}
```

### Key Fields

#### `uuid`
The **primary key** for deduplication. Must be a valid Foundry UUID that resolves to an Item document (compendium or world). If the UUID cannot be resolved, the entry is skipped with a console warning.

The item's `name`, `img`, and `type` are read from the resolved document automatically — you never need to supply them.

#### `patterns`
A source can have **multiple light patterns** — different ways the same item emits light. For example, a lantern might have a "Low" pattern (dim, warm glow) and a "High" pattern (bright, wide radius). Each pattern appears as a separate entry in the Token HUD. If a source has only one pattern, no sub-label is shown.

Consumption and duration are shared across all patterns of the same source; only the emitted light shape differs. Moving between the patterns of the light already burning reshapes that flame in place: nothing is spent, the countdown keeps running from when the source was first lit, and nothing is announced in chat. A player can therefore switch a lantern between "Low" and "High" freely, and can still switch after burning the last item in the stack.

#### `consume`
When `true`, **lighting** the source subtracts one from the matching item's quantity, using the quantity path configured in the module's compatibility settings. Activation is the *only* moment an item is ever spent — dropping a lit light on the ground never consumes and never refunds (see [Dropping](#dropping)). A `consume: false` source therefore never touches inventory at any point.

Items are matched by `flags.core.sourceId` (the origin UUID core stamps on an embedded copy), falling back to name + type, so a source keeps working after a player renames the item on their sheet.

Quantity only gates a source that spends it. For `consume: true`, an item whose quantity has reached 0 stops matching (though the source stays listed in the HUD while its light is still burning, so it can still be extinguished or dropped). For `consume: false` the quantity is never read, so the item matches at any value — including 0, and including a quantity path that does not resolve on that item at all. That is what lets a reusable tool be a light source in a system where the configured path is optional per item: without it, no value of `quantityPath` can make a consumable torch burn down *and* a permanent lantern appear.

#### `negative`
A pattern with `negative: true` is a **darkness source**: it dims the area inside its radii instead of revealing it, using core's own `LightData#negative`. Everything else about the pattern works unchanged — radii, angle, color, intensity, duration and consumption all behave the same, and extinguishing restores the token's own light exactly as it does for a normal pattern.

Light and darkness draw from **two disjoint animation sets**. Foundry offers `torch`, `pulse`, `flame` and the rest to light sources, and `magicalGloom`, `roiling`, `hole` and `denseSmoke` to darkness sources; an animation type from the wrong set is not an error, it just renders with no animation at all. The light editor swaps the animation dropdown when the option is toggled, so a pattern flipped to negative loses whatever animation type it previously had. When registering a negative pattern in code, pick its `animation.type` from the darkness set or leave it empty.

Negative is a property of the **pattern**, not of the source, so one source can own both a light pattern and a darkness pattern and the Token HUD offers them side by side.

#### `freeForAll`
When `true`, the source appears in the Token HUD only for actor types enabled in the module's compatibility settings (the "Actor Types" tab) — it needs no inventory item, and the item is never consumed. Useful for ambient environmental effects ("everyone eligible can see in this magically lit area").

Item-based sources (`freeForAll: false`, the default) work differently: they appear in the Token HUD for **any** actor type that carries a matching item, regardless of the Actor Types setting — carrying the item is itself the permission check. The Actor Types setting only restricts `freeForAll` sources.

#### `coverable`
When `true`, the Token HUD grows a **Stow** control beside **Drop** on the row of the light currently burning. Stowing covers the light instead of ending it: it stops shining, but the effect and both expiry stamps stay exactly where they are, so the countdown keeps running and **Uncover** brings it back with only the time it has left. The expiry sweep puts a covered light out on schedule like any other, announced in chat the usual way.

This is meant for a light that is a spell on an object rather than a flame — a Light cantrip cast on a pebble is pocketed, not snuffed, and pocketing it must not end the spell. Leave it `false` (the default) for torches, lanterns and candles, whose only correct "off" is destructive.

Covering is implemented as core's own `disabled` on the effect, not as a radius of 0, which has one visible consequence worth relying on: a token that emits light of its **own** (a glowing creature, a prototype-token light, another module's aura) gets that light back while the source is covered, instead of being blacked out. It also means a player can uncover a light straight from the effects tab of their character sheet; the Token HUD reads the effect's state rather than a copy of it, so the two never disagree.

Two limits follow from the module's one-light-per-actor rule, and neither changes with `coverable`:

- **Extinguish still ends the light for good**, covered or not, and so does lighting a *different* source — a covered light is deleted like any other when it is replaced. To keep a spell alive while lighting something else, **drop** it: on the ground it goes on burning down, and anyone can pick it back up.
- **A covered light dropped on the ground stays covered**, using the AmbientLight's native `hidden` state — the same state the map control switches. Picking it back up returns it covered. This applies only to `coverable` sources: a torch snuffed on the floor and picked up lights normally, exactly as it always did.

#### Dropping
Any lit light can be dropped on the ground as an AmbientLight from the Token HUD. Dropping **relocates the burning light** — it does not spend an item, whatever the source's `consume` value: a consuming source already paid when it was lit, and a non-consuming one never pays at all. The control appears only on the entry that is currently lit, since there is nothing to relocate otherwise.

A dropped light is a plain AmbientLight with no further ties to the module: it does not inherit the source's remaining duration, it never burns out, and it cannot be picked back up. Register a source with a duration expecting it to expire on the ground and it will not.

`freeForAll` sources are droppable too, but because nothing backs them they could be lit and dropped without limit. The GM world setting **Allow Dropping Free for All Lights** (on by default) gates that; it does not affect item-based sources, which are always droppable while lit. There is no per-source way to opt out of dropping — do not register a source expecting drop to remove it from inventory.

#### `durationMode`
Controls how the countdown timer works:

| Value | Behavior |
| :--- | :--- |
| `"world"` | Burns down as the GM advances the in-game world clock. Stays lit while the clock is still. |
| `"real"` | Burns down in real-world minutes, even while the game is paused or the owning player is offline. |

#### `hudHidden`
When `true`, the source is **never offered in the Token HUD palette** while it is unlit. It can only be lit through [`activate`](#activateactor-uuid-options) — which is the point: for a source whose real cost is a spell slot, a fatigue token or anything else only the game system knows how to charge, a palette entry is a way to get the light without paying for it.

A source that is currently lit is always listed, `hudHidden` or not, because that row is what carries the extinguish, drop and cover controls. So the practical behaviour is: invisible while off, appears the moment something lights it, disappears again when it is put out.

This pairs with `consume: false` in most cases — the module is not charging anything, the caller already did.

---

## `activate(actor, uuid, options?)`

Lights a registered source on an actor, exactly as clicking it in the Token HUD would: same consumption, same duration, same chat announcement, and the same one-light-per-actor rule.

```js
const lit = await game.lightSources.activate(actor, "Compendium.my-system.spells.Item.light01");
const lit = await game.lightSources.activate(actor, sourceUuid, { pattern: "Narrow Beam" });
```

| Parameter | Type | Description |
| :--- | :--- | :--- |
| `actor` | `Actor` | The actor to light. **Must be owned by the current user.** |
| `uuid` | `string` | The registered source's `uuid`, or its internal `id`. A source the GM added by name has no uuid and is reachable only by id. |
| `options.pattern` | `string` | Name of the pattern to light. Defaults to the source's first pattern. |

Returns `Promise<boolean>` — `true` when the source is now lit, `false` when it was refused. It is refused when no source is registered for that key, when the named pattern does not exist, when the current user does not own the actor, or when a `consume: true` source's item is no longer carried.

**Ownership.** Foundry refuses embedded document creation on an actor the current user does not own, so from a player's client this reaches their own character and nothing else; from the GM's client it reaches anyone. This is checked up front and reported as `false` rather than left to throw. There is deliberately **no relay** that would let one player light a light on another player's actor — routing that through the GM would mean any client could ask the GM to write ActiveEffects onto any actor, which is a larger permission surface than this module is willing to open. If your system needs to light someone else's character, run that part of the flow on the GM's client.

**Consumption is not bypassed.** `activate` spends exactly what a HUD click would. A caller that wants no consumption should register the source with `consume: false`.

**The Restrict Player Control setting does not apply.** That world setting gates the Token HUD palette; this path is not the palette. Whatever charged the light has already run, and a caller can only ever reach an actor it already owns.

---

## `deactivate(actor)`

Puts out whatever light is burning on the actor, exactly as the Token HUD's extinguish control does. A no-op when nothing is lit.

```js
await game.lightSources.deactivate(actor);
```

Returns `Promise<void>`.

---

## `getActive(actor)`

Reads what is currently burning on an actor.

```js
const light = game.lightSources.getActive(actor);
// → null, or { sourceId, patternId, patternName, itemName, mode, expiresAtWorld, expiresAtReal, stowed }
```

Returns the active light payload, or `null` when the actor has no light lit. `stowed` is `true` while the light is covered (see [`coverable`](#coverable)). `expiresAtWorld` / `expiresAtReal` are absolute stamps and are `null` for a source with no duration.

---

## Chat Announcements

The module posts its own styled chat card for three light events, on every source regardless of how it was registered:

| Event | Announced |
| :--- | :--- |
| The source is lit | ✅ Names the actor and the source. With more than one pattern, names the pattern too. |
| A lit light is dropped | ✅ Only once the light actually reaches the ground. |
| A duration runs out | ✅ Posted by the active GM's expiry sweep. |
| Switching between a source's patterns | ❌ Silent — the same flame is being reshaped, not lit. |
| Covering or uncovering a light | ❌ Silent — nothing was lit or put out, mirroring extinguishing. |

There is currently no per-source way to opt out of these announcements.

---

## Deduplication and Updates

- **New source**: If no registered source shares the same UUID, the item is resolved via `fromUuid`, and a new entry is appended.
- **Existing source**: If a source with the same UUID already exists, it is **updated in-place**. Its internal `id` is preserved so that any active effects currently on actors remain valid.
- **Pattern matching**: When updating, patterns are matched by the name **you last supplied** for them, not by their current display name — so a pattern the GM has renamed still matches, and keeps its internal `id`. A name you have never registered before generates a new pattern.
- **Unresolvable UUID**: Logged as `console.warn` and skipped silently.

All updates from a single `registerSources` call are batched into **one write** to the settings database.

---

## GM Customization (important)

The values you pass are **defaults, not enforced settings**. The GM can edit any registered source in the module's configuration window, and the module protects that work — automatically, for every source registered through this API:

- As soon as the GM saves an edit to one of your sources, that source is **frozen**. Your subsequent `registerSources` calls will no longer overwrite its patterns, consumption, duration, free-for-all or coverable flags.
- Your calls are still not wasted on a frozen source. The module keeps a **snapshot of the latest values you registered**, so:
  - A pattern you have **added** since the GM's edit is still appended to the source — the GM sees your new patterns without losing their own changes.
  - When the GM clicks **Restore Module Default**, the source reverts to the values from your **most recent** call, not to whatever you registered the first time. Shipping new defaults in a module update is therefore always worthwhile, even for sources a GM has already customized.
- Restoring also **unfreezes** the source, so it resumes updating automatically from your next call onward.
- Patterns the GM added by hand have no snapshot of yours behind them. They are never overwritten, and never removed by a restore.

Practical consequence: **do not** rely on `registerSources` to force a source back to a known state — a GM edit intentionally wins over your payload. If your module needs to react to the GM's values, read the stored sources rather than assuming your own payload is live.

---

## The `managedBy` Badge

When `options.managedBy` is set, every source created or updated by that call is stamped with the value. In the GM's **Configure Light Sources** window, these sources display a read-only badge indicating external management.

Sources with a `managedBy` stamp **can still be manually deleted** by the GM — the badge is informational, not a hard lock.

`managedBy` is **purely cosmetic**, and stays optional. It does not affect [GM customization](#gm-customization-important): every source registered through this API is protected and restorable whether or not you pass it. Do pass it anyway — it is the only thing telling a GM which module a source came from.

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
      consume: true,
      durationMode: "world",
      durationMinutes: 60
    },
    {
      uuid: "Compendium.my-system.equipment.Item.lantern01",
      patterns: [
        {
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
      consume: true,
      durationMode: "world",
      durationMinutes: 240
    },
    {
      uuid: "Compendium.my-system.equipment.Item.magicglow",
      patterns: [
        {
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
      consume: false,
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
      consume: false,
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
- **Daylight** — hidden from the Token HUD and lit only by [`activate`](#activateactor-uuid-options), because the spell slot it costs is something only the system can charge. A player cannot reach it from the palette and so cannot get the light without paying for it; once lit, its row appears with a working extinguish control for as long as it lasts.

---

## Tips

- **Call it in `ready`**: The API is assigned in the `ready` hook. Settings and compendium indices are available at that point, so UUIDs can be resolved.
- **Idempotent**: You can call `registerSources` multiple times with the same entries safely — existing sources are updated, not duplicated, and a source the GM has customized is never clobbered (see [GM Customization](#gm-customization-important)).
- **Re-register every session**: The intended pattern is to pass your full, static entry list on every `ready`. That keeps sources in sync with your module's current defaults without ever overwriting the GM's edits.
- **One write per call**: All entries are batched into a single database write. Pass all your sources in one array rather than making separate calls.
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
