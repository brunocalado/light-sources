/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, FLAGS, CHAT_CARD_BG, CHAT_CARD_ACCENT } from "./constants.js";

/**
 * Build a light pattern: a uniquely-identified, named light configuration. A
 * single light source owns one or more of these "stages" (for example a
 * flashlight's wide-but-short beam versus its narrow-but-long beam); the Token
 * HUD lets the actor pick which one to light. Shared by source registration and
 * the pattern editor.
 * @param {object} light A light configuration (see DEFAULT_LIGHT for the shape).
 * @param {string} name The pattern's display name.
 * @returns {{id: string, name: string, light: object}} A new light pattern.
 */
export function makePattern(light, name) {
  return { id: foundry.utils.randomID(), name: name ?? "", light: foundry.utils.deepClone(light) };
}

/**
 * Read the registered light sources from the world setting.
 * Returns a deep clone so callers can mutate freely before saving.
 * @returns {object[]} The array of light source definitions.
 */
export function getSources() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.SOURCES)) ?? [];
}

/**
 * Persist the registered light sources to the world setting.
 * @param {object[]} sources The array of light source definitions to save.
 * @returns {Promise<object[]>} The stored setting value.
 */
export async function setSources(sources) {
  return game.settings.set(MODULE_ID, SETTINGS.SOURCES, sources);
}

/**
 * The item types (of the detected system) enabled as light sources.
 * @returns {string[]} The enabled item type ids.
 */
export function getItemTypes() {
  return game.settings.get(MODULE_ID, SETTINGS.ITEM_TYPES) ?? [];
}

/**
 * The actor types (of the detected system) that may carry and light sources.
 * @returns {string[]} The enabled actor type ids.
 */
export function getActorTypes() {
  return game.settings.get(MODULE_ID, SETTINGS.ACTOR_TYPES) ?? [];
}

/**
 * Whether "free for all" lights may be dropped on the ground. Dropping only ever
 * relocates an already-lit light and never consumes anything, so a free-for-all
 * source — which has no item behind it — could otherwise be lit and dropped
 * without limit, filling a scene with AmbientLights at no cost. GMs who don't
 * want that switch it off.
 * @returns {boolean} True when free-for-all lights may be dropped.
 */
export function getAllowFreeForAllDrop() {
  return game.settings.get(MODULE_ID, SETTINGS.ALLOW_FREE_FOR_ALL_DROP) ?? true;
}

/**
 * Whether only the GM may activate, deactivate, drop or pick up a light source
 * from the Token HUD. Players still see the palette and the lit/unlit state, but
 * their clicks on those controls are refused with a warning (see
 * `guardPlayerControl` in `token-hud.js`) — this is a client-side courtesy gate,
 * consistent with the rest of the module's actor-write trust model, not a
 * permission enforced against direct document writes.
 * @returns {boolean} True when players are barred from working the controls.
 */
export function getRestrictPlayerControl() {
  return game.settings.get(MODULE_ID, SETTINGS.RESTRICT_PLAYER_CONTROL) ?? false;
}

/**
 * Whether lighting a source should post the "{actor} lights {item}" chat card.
 * Gates only that announcement — extinguishing, dropping, picking up and
 * burning out keep announcing regardless, since a GM who wants quieter chat
 * about *lighting* still typically wants those other events called out.
 * @returns {boolean} True when lighting a source announces in chat.
 */
export function getAnnounceLit() {
  return game.settings.get(MODULE_ID, SETTINGS.ANNOUNCE_LIT) ?? true;
}

/**
 * The dotted path (from an item's root) to its quantity, as configured for the
 * detected system. Empty when the system has no quantity concept configured.
 * @returns {string} The quantity path (e.g. "system.quantity"), or "".
 */
export function getQuantityPath() {
  return game.settings.get(MODULE_ID, SETTINGS.QUANTITY_PATH) ?? "";
}

/**
 * Read an item's quantity using the system-specific path configured in the
 * compatibility settings. Returns `NaN` when no path is configured or the path
 * resolves to a non-numeric value — callers treat that as "quantity unknown"
 * (i.e. always available, never consumed).
 * @param {Item} item The item to read.
 * @returns {number} The item's quantity, or `NaN` when it cannot be determined.
 */
export function getItemQuantity(item) {
  const path = getQuantityPath();
  if ( !path ) return NaN;
  return Number(foundry.utils.getProperty(item, path));
}

/**
 * List the document types the active system registers for a given document,
 * with a localized label, sorted by label. The abstract `base` type is
 * excluded. Used to populate the compatibility configuration's type lists.
 * @param {string} documentName The document name ("Item", "Actor", ...).
 * @returns {Array<{value: string, label: string}>} The available types.
 */
export function listDocumentTypes(documentName) {
  const labels = CONFIG[documentName]?.typeLabels ?? {};
  const types = game.documentTypes?.[documentName] ?? Object.keys(labels);
  return types
    .filter(type => type && (type !== CONST.BASE_DOCUMENT_TYPE))
    .map(type => {
      const key = labels[type];
      return { value: type, label: (key && game.i18n.has(key)) ? game.i18n.localize(key) : type };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Find the items in an Actor's inventory matching a registered light source,
 * using a two-tier strategy. When the source has a `uuid` (it was registered
 * by dragging a real Item), items are first matched by `_stats.compendiumSource`
 * — the origin UUID core stamps on a copy made from a compendium (v14 no longer
 * writes the old `flags.core.sourceId`) — so a source keeps matching even after
 * the player renames the item on their sheet, or a translation module renames it.
 * If that yields nothing (the item was not copied from that compendium entry, e.g.
 * it came from a world Item, or the source has no `uuid`
 * at all because it was registered by name only), matching falls back to name
 * (and, when the source has a `type`, that type too — a name-only source has
 * no type and matches by name alone).
 *
 * Quantity gates only a source that spends what it matches. For a consuming
 * source, an item worn down to 0 is excluded: it is kept in the inventory rather
 * than deleted, but stops being available for consumption or display in the Token
 * HUD. A non-consuming source never reads the number, so its item matches at any
 * quantity — which is what lets a reusable tool (a lantern, a glowing blade) work
 * in a system where the configured path is optional per item and rests at 0.
 * Items whose quantity cannot be determined (no quantity path configured) are
 * always treated as available.
 * @param {Actor} actor The actor whose inventory is searched.
 * @param {object} source A light source definition ({name, type, uuid, ...}).
 *   `type` and `uuid` may be null/absent for a source registered by name only.
 * @returns {Item[]} The matching embedded Items available to this source.
 */
export function findMatchingItems(actor, source) {
  const available = item => {
    // "Empty" and "not a light source" are different questions: only the item that
    // will actually be spent is gated on its quantity.
    if ( !source.consume ) return true;
    const quantity = getItemQuantity(item);
    return !Number.isFinite(quantity) || (quantity > 0);
  };

  if ( source.uuid ) {
    const bySource = actor.items.filter(i => (i._stats?.compendiumSource === source.uuid) && available(i));
    if ( bySource.length ) return bySource;
  }

  return actor.items.filter(i => {
    if ( i.name !== source.name ) return false;
    if ( source.type && (i.type !== source.type) ) return false;
    return available(i);
  });
}

/**
 * Whether a token can reach a point on the canvas: the same square it stands on, or
 * one of the squares around it. The module's one definition of "close enough to
 * touch", shared by picking a light up off the ground and by working an interactive
 * light's control on the map.
 *
 * Reach is delegated to the scene's own grid rather than measured by hand, so the
 * rule follows whatever grid the scene uses. Three core behaviours this relies on:
 * `testAdjacency` compares grid offsets and is `false` for the *same* offset, so
 * the "standing on it" case has to be tested separately; on a square grid it honours
 * the scene's diagonal rule, narrowing to the four orthogonal neighbours when
 * diagonals are illegal; and on a gridless scene it always returns `false`, which
 * would put everything out of reach, so distance falls back to one grid unit there.
 * @param {foundry.canvas.placeables.Token} token The token reaching out.
 * @param {{x: number, y: number}} point The point being reached for.
 * @returns {boolean} True when the point is within the token's reach.
 */
export function isWithinReach(token, point) {
  const grid = canvas.grid;
  if ( !token || !grid ) return false;

  const origin = token.center;
  if ( grid.isGridless ) return Math.hypot(point.x - origin.x, point.y - origin.y) <= grid.size;

  const a = grid.getOffset(origin);
  const b = grid.getOffset(point);
  if ( (a.i === b.i) && (a.j === b.j) ) return true;
  return grid.testAdjacency(origin, point);
}

/**
 * Find a light lying on the ground within reach of a token.
 * @param {foundry.canvas.placeables.Token} token The token reaching for a light.
 * @returns {AmbientLightDocument|null} The dropped light in reach, or null.
 */
export function findGroundLight(token) {
  for ( const light of (canvas.scene?.lights ?? []) ) {
    if ( !light.getFlag(MODULE_ID, FLAGS.GROUND_LIGHT) ) continue;
    if ( isWithinReach(token, { x: light.x, y: light.y }) ) return light;
  }
  return null;
}

/**
 * Build the ChatMessage data announcing a light event, wrapping the text in the
 * module's standard chat card and speaking as the actor involved. Returns the
 * creation data rather than creating the document, so callers can batch several
 * announcements into one operation (see `sweepExpiredLights` in `light-manager.js`).
 * @param {Actor} [actor] The actor the message speaks for. May be omitted for a
 *   light with no actor left to speak for it (a torch that burned out on the ground
 *   after its owner's token was removed), which yields a generic speaker.
 * @param {string} title The card's header text, already localized.
 * @param {string} message The card's body text, already localized.
 * @returns {object} ChatMessage creation data ({content, speaker}).
 */
export function buildLightMessage(actor, title, message) {
  return {
    content: buildChatCard(title, `<p style="color: #fff; margin: 0;">${message}</p>`),
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  };
}

/**
 * Build the module's standard chat card: a bordered, accent-colored header
 * over a themed background image with a dark overlay for legibility.
 * Every rule is inlined so the card renders identically for all connected
 * clients regardless of their installed modules/system CSS.
 * @param {string} title The header text (rendered upper-case via CSS).
 * @param {string} bodyHtml HTML injected into the foreground content container.
 * @param {object} [options={}] Card appearance overrides.
 * @param {string} [options.titleColor=CHAT_CARD_ACCENT] Accent color for the border and title.
 * @param {number} [options.overlayOpacity=0.85] Opacity of the dark background overlay (0-1).
 * @returns {string} Complete HTML ready to use as a ChatMessage's content.
 */
export function buildChatCard(title, bodyHtml, { titleColor = CHAT_CARD_ACCENT, overlayOpacity = 0.85 } = {}) {
  return `
  <div class="chat-card" style="border: 2px solid ${titleColor}; border-radius: 8px; overflow: hidden;">
    <header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid ${titleColor};">
      <h3 class="noborder" style="margin: 0; font-weight: bold; color: ${titleColor} !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">
        ${title}
      </h3>
    </header>
    <div class="card-content" style="background-image: url('${CHAT_CARD_BG}'); background-repeat: no-repeat; background-position: center; background-size: cover; padding: 20px; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative;">
      <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, ${overlayOpacity}); z-index: 0;"></div>
      <div style="position: relative; z-index: 1; width: 100%; display: flex; flex-direction: column; align-items: center;">
        ${bodyHtml}
      </div>
    </div>
  </div>`;
}
