/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

/**
 * The module id. Must match the `id` field in module.json verbatim.
 * @type {string}
 */
export const MODULE_ID = "light-sources";

/**
 * Setting keys registered under the MODULE_ID scope.
 * - `GM_SOURCES`: the GM's own light-source records (world data): sources the GM
 *   made, full replacements for a source a module registers (same `id`), and
 *   tombstones (`removed: true`) hiding one. What modules register is never stored
 *   here; it lives in memory on every client (see `getSources` in `helpers.js`).
 * - `MENU`: the light-sources configuration menu.
 * - `COMPAT_MENU`: the system-compatibility configuration menu.
 * - `TRANSFER_MENU`: the import/export menu, which copies a world's light sources and
 *   compatibility settings to another world through a JSON file.
 * - `ITEM_TYPES` / `ACTOR_TYPES`: which of the detected system's document
 *   types this module treats as light-source items / light-bearing actors.
 * - `QUANTITY_PATH`: dotted path (from the item root) to an item's quantity.
 * - `CHARGES_PATH`: dotted path (from the item root) to how many charges an item
 *   has left.
 * - `CHARGES_SPENT_PATH`: optional dotted path to the charges an item has used, for
 *   a system that counts up; when set, lighting writes here instead.
 * - `ALLOW_FREE_FOR_ALL_DROP`: whether "free for all" lights may be dropped on
 *   the ground (see `getAllowFreeForAllDrop` in `helpers.js`).
 * - `RESTRICT_PLAYER_CONTROL`: whether only the GM may activate, deactivate,
 *   drop or pick up a light source from the Token HUD (see
 *   `getRestrictPlayerControl` in `helpers.js`).
 * - `ANNOUNCE_LIT`: whether lighting a source posts a chat message (see
 *   `getAnnounceLit` in `helpers.js`).
 * @type {{GM_SOURCES: string, MENU: string, COMPAT_MENU: string, TRANSFER_MENU: string, ITEM_TYPES: string, ACTOR_TYPES: string, QUANTITY_PATH: string, CHARGES_PATH: string, CHARGES_SPENT_PATH: string, ALLOW_FREE_FOR_ALL_DROP: string, RESTRICT_PLAYER_CONTROL: string, ANNOUNCE_LIT: string}}
 */
export const SETTINGS = {
  GM_SOURCES: "gmSources",
  MENU: "config",
  COMPAT_MENU: "compatibility",
  TRANSFER_MENU: "transfer",
  ITEM_TYPES: "itemTypes",
  ACTOR_TYPES: "actorTypes",
  QUANTITY_PATH: "quantityPath",
  CHARGES_PATH: "chargesPath",
  CHARGES_SPENT_PATH: "chargesSpentPath",
  ALLOW_FREE_FOR_ALL_DROP: "allowFreeForAllDrop",
  RESTRICT_PLAYER_CONTROL: "restrictPlayerControl",
  ANNOUNCE_LIT: "announceLit"
};

/**
 * Flag keys stored under the MODULE_ID scope.
 * - `EFFECT_LIGHT`: marks the ActiveEffect this module creates to drive a token's
 *   light, and carries its bookkeeping payload ({sourceId, patternId, patternName,
 *   itemName, itemId, mode, expiresAtWorld, expiresAtReal, runningLow}). `itemId` is
 *   the carried Item that is burning, or null when no item is (a copy was spent, or a
 *   free-for-all source has none); older effects lack it and count as null.
 *   `runningLow` says the effect carries its pattern's running-low look; older
 *   effects lack it and count as false.
 * - `GROUND_LIGHT`: marks an AmbientLight dropped by an actor (as opposed to one
 *   the GM placed by hand) and carries what is needed to light it again on a token
 *   ({sourceId, patternId, patternName, itemName, actorUuid, itemId, mode,
 *   expiresAtWorld, expiresAtReal, runningLow, managedBy}). Without it a dropped light is
 *   indistinguishable from scenery. `itemId` is the Item the flame burned on, as on
 *   `EFFECT_LIGHT`; while it lies there, that Item of `actorUuid` is not lit again.
 *   Older lights lack it and count as null. `managedBy` names the module that placed
 *   it through the API and hands it back itself; absent for a light dropped from the
 *   Token HUD. `runningLow` is as on `EFFECT_LIGHT`.
 * - `INTERACTIVE`: set on an AmbientLight the players may switch on and off from the
 *   map. The GM sets it per light in the native light config; lights dropped by a
 *   player get it automatically. A light another module manages keeps the flag but
 *   gets no control while that module is active (see `isManagedElsewhere`).
 * - `BURN_LEFT`: set on an Item, the whole seconds of burn time left when the flame
 *   of a `"charge"` or `"fuel"` source burning on it was put out. The next lighting of that Item
 *   burns them instead of spending a charge or fuel, and removes the flag. Counted on the
 *   source's own clock: game seconds or real seconds.
 * @type {{EFFECT_LIGHT: string, GROUND_LIGHT: string, INTERACTIVE: string, BURN_LEFT: string}}
 */
export const FLAGS = {
  EFFECT_LIGHT: "light",
  GROUND_LIGHT: "groundLight",
  INTERACTIVE: "interactive",
  BURN_LEFT: "burnLeft"
};

/**
 * Why the public `pickupGroundLight` or `handOverLight` left an actor unlit, returned
 * to the caller as `reason` instead of shown as a notification: they often run on the
 * GM's client, inside whatever request the caller is serving, so only the caller can
 * tell the right user.
 * - `INVALID`: the call itself was refused (not a GM client, bad arguments, or a
 *   requester without permission), or a removal it needed was cancelled.
 * - `MISSING`: the light is no longer on the scene.
 * - `SOURCE_REMOVED`: its light source was deleted from the config meanwhile.
 * - `BURNED_OUT`: it burned out, on the ground or while it burned.
 * - `OCCUPIED`: the actor already has a light burning, which is never replaced.
 * - `NOT_BURNING`: `fromItem` is not the Item its actor's light burns on.
 * - `NO_GM`: the move needed the GM, and no active GM answered.
 * - `REFUSED`: the game system or another module refused the light's effect on the
 *   actor (PF2e refuses them all).
 * @type {{INVALID: string, MISSING: string, SOURCE_REMOVED: string, BURNED_OUT: string, OCCUPIED: string, NOT_BURNING: string, NO_GM: string, REFUSED: string}}
 */
export const LIGHT_REASONS = {
  INVALID: "invalid",
  MISSING: "missing",
  SOURCE_REMOVED: "sourceRemoved",
  BURNED_OUT: "burnedOut",
  OCCUPIED: "occupied",
  NOT_BURNING: "notBurning",
  NO_GM: "noGm",
  REFUSED: "refused"
};

/**
 * The module's socket channel. Foundry namespaces package sockets as
 * `module.<id>`, and the manifest must declare `"socket": true` for the server to
 * relay them.
 * @type {string}
 */
export const SOCKET_EVENT = `module.${MODULE_ID}`;

/**
 * How a light source counts down its duration.
 * - `world`: tied to `game.time.worldTime` (the in-game clock) — the light goes out
 *   when the GM advances the clock past it, and the effect shows its native duration.
 * - `real`: tied to real-world wall-clock time via a polling ticker — the light
 *   burns down even while the game is paused or the owner is disconnected.
 * @type {{WORLD: string, REAL: string}}
 */
export const DURATION_MODES = {
  WORLD: "world",
  REAL: "real"
};

/**
 * What lighting a source spends from the carried Item.
 * - `none`: nothing; the Item is the light (a lantern).
 * - `copy`: one copy of a stack, through the quantity path; the copy becomes the flame,
 *   which no longer belongs to the stack.
 * - `charge`: one charge of a single object, through the charges path; the flame
 *   burns on that Item.
 * - `fuel`: nothing from the light Item; one copy of the source's `fuel` Item (a lantern's
 *   oil), through the quantity path. The flame burns on the light Item.
 * @type {{NONE: string, COPY: string, CHARGE: string, FUEL: string}}
 */
export const CONSUME_MODES = {
  NONE: "none",
  COPY: "copy",
  CHARGE: "charge",
  FUEL: "fuel"
};

/**
 * Priority assigned to every `token.light.*` ActiveEffect change. Matches the
 * core default priority of the `override` change type; kept explicit so the
 * change sort in `TokenDocument#applyActiveEffects` is always well-defined.
 * @type {number}
 */
export const LIGHT_CHANGE_PRIORITY = 50;

/**
 * Per-system compatibility presets. When a world runs one of these systems and
 * the module has never been configured, these values seed the item types,
 * actor types and item-quantity path so the module works out of the box.
 * Systems not listed here start fully unconfigured (nothing enabled) and rely
 * on the GM to fill in the compatibility settings by hand.
 * @type {Record<string, {itemTypes: string[], actorTypes: string[], quantityPath: string, chargesPath?: string, chargesSpentPath?: string}>}
 */
export const SYSTEM_PRESETS = {
  daggerheart: {
    itemTypes: ["loot", "consumable"],
    actorTypes: ["character"],
    quantityPath: "system.quantity"
  }
};

/**
 * Handlebars template paths used by the module's Applications.
 * @type {{CONFIG: string, LIGHT_EDITOR: string, COMPAT: string, TRANSFER: string}}
 */
export const TEMPLATES = {
  CONFIG: `modules/${MODULE_ID}/templates/light-sources-config.hbs`,
  LIGHT_EDITOR: `modules/${MODULE_ID}/templates/light-editor.hbs`,
  COMPAT: `modules/${MODULE_ID}/templates/compatibility-config.hbs`,
  TRANSFER: `modules/${MODULE_ID}/templates/transfer-config.hbs`
};

/**
 * Background image shown behind the module's chat cards (see `buildChatCard`
 * in `scripts/helpers.js`).
 * @type {string}
 */
export const CHAT_CARD_BG = `modules/${MODULE_ID}/assets/banner.webp`;

/**
 * Accent color applied to chat card borders/titles by default, matching the
 * module's `--light-sources-accent` CSS custom property (see base.css).
 * @type {string}
 */
export const CHAT_CARD_ACCENT = "#ff9838";

/**
 * Default light pattern assigned to a newly registered light source.
 * Only basic + animation fields are managed by default; `advanced` stays null, which
 * leaves the token's own advanced light options untouched (see ADVANCED_LIGHT_KEYS),
 * and `ending` stays null, so the light keeps this look until it burns out.
 * @type {object}
 */
export const DEFAULT_LIGHT = {
  dim: 40,
  bright: 20,
  negative: false,
  angle: 360,
  color: "#ff8800",
  alpha: 0.4,
  animation: {
    type: "torch",
    speed: 5,
    intensity: 5,
    reverse: false
  },
  advanced: null,
  ending: null
};

/**
 * The `LightData` fields core groups under its "Advanced" light options. A pattern
 * sets them only when its `light.advanced` object is filled in; while it is null the
 * light keeps whatever the token (or, on the ground, core's defaults) already has —
 * exactly how the module behaved before these options existed.
 * @type {string[]}
 */
export const ADVANCED_LIGHT_KEYS = ["coloration", "luminosity", "attenuation", "saturation", "contrast", "shadows"];

/**
 * The expiry event a light's ActiveEffect is stamped with, registered in
 * `CONFIG.ActiveEffect.expiryEvents`. Core never fires a package's own event, so it
 * leaves these effects to this module's expiry sweep. With the default `expiry: null`
 * core expires an effect on *any* event, and on every clock advance it wrote
 * `duration.expired` to the same effect the sweep was deleting.
 * @type {string}
 */
export const EXPIRY_EVENT = `${MODULE_ID}.burnOut`;

/**
 * How often (in milliseconds) the active GM client checks for expired lights.
 * @type {number}
 */
export const EXPIRY_CHECK_INTERVAL_MS = 15000;

/**
 * Fallback icon assigned to a light source registered by name only (no
 * dragged Item to source an image from). A stable, bundled core Foundry asset.
 * @type {string}
 */
export const DEFAULT_SOURCE_IMG = "icons/svg/fire.svg";

/**
 * Quick radius presets offered for the Dim/Bright radius fields in the light
 * pattern editor. Plain convenience shortcuts — no unit or game system is
 * assumed, so each option's label is just the value itself.
 * @type {number[]}
 */
export const RANGE_PRESETS = [10, 15, 20, 30, 60];

/**
 * Quick duration presets, in minutes, offered for the Duration field in the
 * light source editor's Consumption tab. Convenience shortcuts only.
 * @type {number[]}
 */
export const DURATION_PRESETS = [10, 15, 20, 30, 60];
