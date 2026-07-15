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
  consume: boolean,          // Optional – subtract one from the item's quantity when lit (default: false)
  freeForAll: boolean,       // Optional – any eligible actor can light this, no inventory item needed (default: false)
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

#### `freeForAll`
When `true`, the source appears in the Token HUD for every eligible actor type, even if they don't carry the item in their inventory. The item is never consumed. Useful for ambient environmental effects ("everyone can see in this magically lit area").

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
- **Pattern matching**: When updating, patterns are matched by `name`. A pattern whose name already exists keeps its internal `id`; a new name generates a new `id`.
- **Unresolvable UUID**: Logged as `console.warn` and skipped silently.

All updates from a single `registerSources` call are batched into **one write** to the settings database.

---

## The `managedBy` Badge

When `options.managedBy` is set, every source created or updated by that call is stamped with the value. In the GM's **Configure Light Sources** window, these sources display a read-only badge indicating external management.

Sources with a `managedBy` stamp **can still be manually deleted** by the GM — the badge is informational, not a hard lock.

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
- **Idempotent**: You can call `registerSources` multiple times with the same entries safely — existing sources are updated, not duplicated.
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
