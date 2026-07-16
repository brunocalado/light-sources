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

Consumption and duration are shared across all patterns of the same source; only the emitted light shape differs.

#### `consume`
When `true`, **lighting** the source subtracts one from the matching item's quantity, using the quantity path configured in the module's compatibility settings. Activation is the *only* moment an item is ever spent — dropping a lit light on the ground never consumes and never refunds (see [Dropping](#dropping)). A `consume: false` source therefore never touches inventory at any point.

Items are matched by `flags.core.sourceId` (the origin UUID core stamps on an embedded copy), falling back to name + type, so a source keeps working after a player renames the item on their sheet. Items whose quantity has reached 0 stop matching, but the source stays listed in the HUD while its light is still burning, so it can still be extinguished or dropped.

#### `freeForAll`
When `true`, the source appears in the Token HUD only for actor types enabled in the module's compatibility settings (the "Actor Types" tab) — it needs no inventory item, and the item is never consumed. Useful for ambient environmental effects ("everyone eligible can see in this magically lit area").

Item-based sources (`freeForAll: false`, the default) work differently: they appear in the Token HUD for **any** actor type that carries a matching item, regardless of the Actor Types setting — carrying the item is itself the permission check. The Actor Types setting only restricts `freeForAll` sources.

#### Dropping
Any lit light can be dropped on the ground as an AmbientLight from the Token HUD. Dropping **relocates the burning light** — it does not spend an item, whatever the source's `consume` value: a consuming source already paid when it was lit, and a non-consuming one never pays at all. The control appears only on the entry that is currently lit, since there is nothing to relocate otherwise.

`freeForAll` sources are droppable too, but because nothing backs them they could be lit and dropped without limit. The GM world setting **Allow Dropping Free for All Lights** (on by default) gates that; it does not affect item-based sources, which are always droppable while lit. There is no per-source way to opt out of dropping — do not register a source expecting drop to remove it from inventory.

#### `durationMode`
Controls how the countdown timer works:

| Value | Behavior |
| :--- | :--- |
| `"world"` | Burns down as the GM advances the in-game world clock. Stays lit while the clock is still. |
| `"real"` | Burns down in real-world minutes, even while the game is paused or the owning player is offline. |

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

- As soon as the GM saves an edit to one of your sources, that source is **frozen**. Your subsequent `registerSources` calls will no longer overwrite its patterns, consumption, duration or free-for-all flag.
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
      durationMinutes: 0
    }
  ], { managedBy: "my-system" });
});
```

In this example:
- **Torch** — consumed on use, lasts 60 in-game minutes, single pattern.
- **Lantern** — consumed on use, lasts 4 in-game hours, two selectable brightness patterns.
- **Magic Glow** — free for all actors, never consumed, unlimited duration.

---

## Tips

- **Call it in `ready`**: The API is assigned in the `ready` hook. Settings and compendium indices are available at that point, so UUIDs can be resolved.
- **Idempotent**: You can call `registerSources` multiple times with the same entries safely — existing sources are updated, not duplicated, and a source the GM has customized is never clobbered (see [GM Customization](#gm-customization-important)).
- **Re-register every session**: The intended pattern is to pass your full, static entry list on every `ready`. That keeps sources in sync with your module's current defaults without ever overwriting the GM's edits.
- **One write per call**: All entries are batched into a single database write. Pass all your sources in one array rather than making separate calls.
- **System presets**: If your system already has built-in presets in the module (like Daggerheart), the API lets you replace or extend them programmatically.

---

## Light Animation Types

Foundry's built-in animation types you can use in the `animation.type` field:

| Type | Description |
| :--- | :--- |
| `"torch"` | Flickering torch flame |
| `"pulse"` | Gentle pulsing glow |
| `"chroma"` | Color-shifting chromatic light |
| `"wave"` | Oscillating wave pattern |
| `"flame"` | Smooth flame animation (v2) |
| `"fog"` | Swirling fog effect |
| `"sunburst"` | Radiant sunburst |
| `"dome"` | Dome-shaped emanation |
| `"emanation"` | Mystical emanation |
| `"hexa"` | Hexagonal grid pattern |
| `"ghost"` | Ghostly flickering |
| `"energy"` | Energy field |
| `"roiling"` | Roiling mass |
| `"hole"` | Black hole effect |
| `""` or `null` | No animation (static light) |

> **Note**: Available animation types may vary by Foundry VTT version. The values above are for Foundry V14.
