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
 * - `SOURCES`: the registered light-source definitions (world data).
 * - `MENU`: the light-sources configuration menu.
 * - `COMPAT_MENU`: the system-compatibility configuration menu.
 * - `ITEM_TYPES` / `ACTOR_TYPES`: which of the detected system's document
 *   types this module treats as light-source items / light-bearing actors.
 * - `QUANTITY_PATH`: dotted path (from the item root) to an item's quantity.
 * - `ALLOW_FREE_FOR_ALL_DROP`: whether "free for all" lights may be dropped on
 *   the ground (see `getAllowFreeForAllDrop` in `helpers.js`).
 * @type {{SOURCES: string, MENU: string, COMPAT_MENU: string, ITEM_TYPES: string, ACTOR_TYPES: string, QUANTITY_PATH: string, ALLOW_FREE_FOR_ALL_DROP: string}}
 */
export const SETTINGS = {
  SOURCES: "sources",
  MENU: "config",
  COMPAT_MENU: "compatibility",
  ITEM_TYPES: "itemTypes",
  ACTOR_TYPES: "actorTypes",
  QUANTITY_PATH: "quantityPath",
  ALLOW_FREE_FOR_ALL_DROP: "allowFreeForAllDrop"
};

/**
 * Flag keys stored under the MODULE_ID scope. `EFFECT_LIGHT` marks the
 * ActiveEffect this module creates to drive a token's light, and carries its
 * bookkeeping payload ({sourceId, itemName, mode, expiresAtWorld, expiresAtReal}).
 * @type {{EFFECT_LIGHT: string}}
 */
export const FLAGS = {
  EFFECT_LIGHT: "light"
};

/**
 * How a light source counts down its duration.
 * - `world`: tied to `game.time.worldTime` (the in-game clock) via the effect's
 *   native duration — the light goes out when the GM advances the clock past it.
 * - `real`: tied to real-world wall-clock time via a polling ticker — the light
 *   burns down even while the game is paused or the owner is disconnected.
 * @type {{WORLD: string, REAL: string}}
 */
export const DURATION_MODES = {
  WORLD: "world",
  REAL: "real"
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
 * @type {Record<string, {itemTypes: string[], actorTypes: string[], quantityPath: string}>}
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
 * @type {{CONFIG: string, LIGHT_EDITOR: string, COMPAT: string}}
 */
export const TEMPLATES = {
  CONFIG: `modules/${MODULE_ID}/templates/light-sources-config.hbs`,
  LIGHT_EDITOR: `modules/${MODULE_ID}/templates/light-editor.hbs`,
  COMPAT: `modules/${MODULE_ID}/templates/compatibility-config.hbs`
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
 * Only basic + animation fields are managed by this module; advanced light
 * options are intentionally left untouched on the token.
 * @type {object}
 */
export const DEFAULT_LIGHT = {
  dim: 40,
  bright: 20,
  angle: 360,
  color: "#ff8800",
  alpha: 0.4,
  animation: {
    type: "torch",
    speed: 5,
    intensity: 5,
    reverse: false
  }
};

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
