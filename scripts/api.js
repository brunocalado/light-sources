/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, DURATION_MODES } from "./constants.js";
import { getSources, setSources, makePattern, getItemTypes, getActorTypes, getQuantityPath } from "./helpers.js";
import { activateLight, deactivateLight, getActiveLight } from "./light-manager.js";

/**
 * The usage fields a caller supplies, with the API's documented defaults filled
 * in. Also snapshotted onto the source as `moduleDefaults`, so restoring returns
 * what the module wants *now* rather than what it asked for on first registration.
 * @param {object} entry The caller's light source definition.
 * @returns {{consume: boolean, freeForAll: boolean, coverable: boolean, hudHidden: boolean, durationMode: string, durationMinutes: number}} The usage fields.
 */
function usageFields(entry) {
  return {
    consume: entry.consume ?? false,
    freeForAll: entry.freeForAll ?? false,
    coverable: entry.coverable ?? false,
    hudHidden: entry.hudHidden ?? false,
    durationMode: entry.durationMode ?? DURATION_MODES.WORLD,
    durationMinutes: entry.durationMinutes ?? 0
  };
}

/**
 * Find the stored pattern an incoming module pattern refers to. Matching is on
 * `moduleName` — the name the module last supplied — and never on `name`, which
 * the GM may rename freely in the editor: matching a renamed pattern by name
 * fails and mints a fresh id, orphaning any ActiveEffect pointing at the old one
 * through its `patternId` flag. A pattern the GM added by hand carries no
 * `moduleName`, so it never matches and is never claimed by a module.
 * @param {object[]} patterns The source's stored patterns.
 * @param {string} moduleName The name the module supplied for the pattern.
 * @returns {object|null} The matching stored pattern, or null when it is new.
 */
function findModulePattern(patterns, moduleName) {
  return patterns.find(p => p.moduleName === moduleName) ?? null;
}

/**
 * Convert a caller-supplied raw pattern ({name, light}) into the module's
 * internal {id, name, light, moduleName, moduleLight} shape, stamping the
 * module's own values as the snapshot a restore reverts to, and reusing a matched
 * pattern's id so live effects referencing it stay valid across an update.
 * @param {{name: string, light: object}} raw The caller's pattern definition.
 * @param {object|null} previous The stored pattern it matched, if any.
 * @returns {object} The internal pattern.
 */
function toInternalPattern(raw, previous) {
  const pattern = makePattern(raw.light, raw.name);
  if ( previous ) pattern.id = previous.id;
  return Object.assign(pattern, { moduleName: raw.name, moduleLight: foundry.utils.deepClone(raw.light) });
}

/**
 * Refresh a customized source's snapshots without disturbing what the GM edited:
 * stored patterns keep their live id/name/light and only have their snapshot
 * advanced, while a pattern the module has newly added is appended (the GM can
 * only benefit from seeing it). Nothing is ever dropped here — a pattern the GM
 * added by hand has no snapshot at all and is left strictly alone.
 * @param {object} existing The stored source (mutated in place).
 * @param {object} entry The caller's light source definition.
 */
function refreshSnapshots(existing, entry) {
  existing.moduleDefaults = usageFields(entry);
  for ( const raw of entry.patterns ) {
    const previous = findModulePattern(existing.patterns, raw.name);
    if ( previous ) Object.assign(previous, { moduleName: raw.name, moduleLight: foundry.utils.deepClone(raw.light) });
    else existing.patterns.push(toInternalPattern(raw, null));
  }
}

/**
 * Programmatically register or update light source definitions from an
 * external system or module. UUID is used as the primary key: existing
 * sources are updated in-place (preserving their internal id); new ones
 * are appended. A single setSources write is performed per call.
 *
 * A source the GM has since edited is frozen (`customized`): its values are left
 * untouched, and only its module-default snapshot is advanced, until the GM
 * explicitly restores it. Callers may therefore re-register the same static
 * entries every session without clobbering the GM's work.
 *
 * @param {object[]} entries       Array of light source definitions.
 * @param {object}  [options={}]
 * @param {string}  [options.managedBy]  id of the calling module or system.
 * @returns {Promise<void>}
 */
export async function registerSources(entries, { managedBy = null } = {}) {
  if ( !Array.isArray(entries) ) {
    console.warn(`${MODULE_ID} | registerSources expected an array of entries.`);
    return;
  }

  const sources = getSources();

  for ( const entry of entries ) {
    if ( !entry?.uuid || !Array.isArray(entry.patterns) ) {
      console.warn(`${MODULE_ID} | Skipping light source entry missing a uuid or patterns array.`, entry);
      continue;
    }

    const item = await foundry.utils.fromUuid(entry.uuid);
    if ( !item ) {
      console.warn(`${MODULE_ID} | Could not resolve light source item "${entry.uuid}"; skipping.`);
      continue;
    }

    const existing = sources.find(s => s.uuid === entry.uuid);
    const usage = usageFields(entry);
    // Item metadata is not editable through this module, so it always refreshes.
    const metadata = { name: item.name, img: item.img, type: item.type, managedBy };

    if ( existing?.customized ) {
      Object.assign(existing, metadata);
      refreshSnapshots(existing, entry);
    }
    else if ( existing ) {
      // Update in place, preserving the internal id (it may be referenced by
      // active effects currently on actors) and refreshing the item metadata.
      Object.assign(existing, metadata, usage, {
        customized: false,
        moduleDefaults: { ...usage },
        patterns: entry.patterns.map(raw => toInternalPattern(raw, findModulePattern(existing.patterns, raw.name)))
      });
    }
    else {
      sources.push({
        id: foundry.utils.randomID(),
        uuid: entry.uuid,
        ...metadata,
        ...usage,
        customized: false,
        moduleDefaults: { ...usage },
        patterns: entry.patterns.map(raw => toInternalPattern(raw, null))
      });
    }
  }

  await setSources(sources);
}

/**
 * Programmatically seed the compatibility settings (item types, actor types,
 * and the item-quantity path) from an external system or module, mirroring
 * what SYSTEM_PRESETS does for systems built into the module — but supplied
 * at runtime by the caller instead of hardcoded in constants.js.
 *
 * Each field seeds independently and only when still unset, so this is safe
 * to call every session (e.g. alongside registerSources in the same `ready`
 * hook): a GM who has already configured any of these three through the
 * Compatibility config window keeps that choice untouched, even if the
 * caller supplies a different value for it.
 *
 * @param {object} [options={}]
 * @param {string[]} [options.itemTypes] Item type ids to enable as light sources.
 * @param {string[]} [options.actorTypes] Actor type ids allowed to carry/light sources.
 * @param {string} [options.quantityPath] Dotted path (from an item's root) to its quantity.
 * @returns {Promise<void>}
 */
export async function registerCompatibility({ itemTypes, actorTypes, quantityPath } = {}) {
  if ( Array.isArray(itemTypes) && !getItemTypes().length ) {
    await game.settings.set(MODULE_ID, SETTINGS.ITEM_TYPES, itemTypes);
  }
  if ( Array.isArray(actorTypes) && !getActorTypes().length ) {
    await game.settings.set(MODULE_ID, SETTINGS.ACTOR_TYPES, actorTypes);
  }
  if ( quantityPath && !getQuantityPath() ) {
    await game.settings.set(MODULE_ID, SETTINGS.QUANTITY_PATH, quantityPath);
  }
}

/**
 * Light a registered source on an Actor, exactly as clicking it in the Token HUD
 * would: the same consumption, the same duration, the same chat announcement, and
 * the same one-light-per-actor rule. Meant for a cost the module cannot express as
 * a quantity — a spell slot, a fatigue token, a resource only the game system knows
 * how to charge. The system charges it, then calls this; pair it with `hudHidden`
 * so the Token HUD cannot be used to skip the charge.
 *
 * The caller must be able to write to `actor`. Foundry refuses embedded document
 * creation on an Actor the current user does not own, so from a player's client this
 * reaches their own character and nothing else; from the GM's it reaches anyone.
 * Ownership is checked up front and reported as `false` rather than left to throw.
 * There is deliberately no relay that would let one player light another's actor.
 *
 * The GM's **Restrict Player Control** setting is not consulted here. It gates the
 * Token HUD palette, and this path is not the palette: whatever charged the light
 * has already run, and a caller can only ever reach an actor it already owns.
 * @param {Actor} actor The actor to light. Must be owned by the current user.
 * @param {string} uuid The registered source's `uuid`, or its internal `id` (a source
 *   the GM added by name has no uuid, and is only reachable by id).
 * @param {object} [options={}]
 * @param {string} [options.pattern] Name of the pattern to light. Defaults to the
 *   source's first pattern.
 * @returns {Promise<boolean>} True when the source is now lit.
 */
export async function activate(actor, uuid, { pattern } = {}) {
  if ( !actor ) {
    console.warn(`${MODULE_ID} | activate called without an actor.`);
    return false;
  }
  if ( !actor.isOwner ) {
    console.warn(`${MODULE_ID} | Cannot light "${actor.name}": the current user does not own that actor.`);
    return false;
  }

  const source = getSources().find(s => (s.uuid === uuid) || (s.id === uuid));
  if ( !source ) {
    console.warn(`${MODULE_ID} | No light source registered for "${uuid}".`);
    return false;
  }

  // Patterns are selected by name because that is what a caller registered them
  // under; internal ids are minted by this module and never travel outward.
  const target = pattern ? source.patterns.find(p => p.name === pattern) : source.patterns[0];
  if ( !target ) {
    console.warn(`${MODULE_ID} | Light source "${source.name}" has no pattern named "${pattern}".`);
    return false;
  }

  return activateLight(actor, source, target);
}

/**
 * Put out whatever light is burning on an Actor, exactly as the Token HUD's
 * extinguish control does. A no-op when nothing is lit.
 * @param {Actor} actor The actor whose light is extinguished.
 * @returns {Promise<void>}
 */
export async function deactivate(actor) {
  return deactivateLight(actor);
}

/**
 * Read what is currently burning on an Actor, so a caller can tell whether a light
 * is lit, which source and pattern it came from, and when it runs out.
 * @param {Actor} actor The actor to inspect.
 * @returns {object|null} The active light payload ({sourceId, patternId, patternName,
 *   itemName, mode, expiresAtWorld, expiresAtReal, stowed}), or null when unlit.
 */
export function getActive(actor) {
  return getActiveLight(actor);
}
