/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, FLAGS, DURATION_MODES, CONSUME_MODES, LIGHT_REASONS } from "./constants.js";
import {
  getSources, setRegisteredSource, validateSource, getItemTypes, getActorTypes, getQuantityPath, getChargesPath,
  getChargesSpentPath
} from "./helpers.js";
import {
  activateLight, extinguishLight, getActiveLight, dropItemLight, pickupItemLight, moveItemLight
} from "./light-manager.js";

/**
 * The usage fields a caller supplies, with the API's documented defaults filled in.
 * @param {object} entry The caller's light source definition.
 * @returns {{consume: string, freeForAll: boolean, coverable: boolean, droppable: boolean, hudHidden: boolean, durationMode: string, durationMinutes: number, endingMinutes: number}} The usage fields.
 */
function usageFields(entry) {
  return {
    consume: entry.consume ?? CONSUME_MODES.NONE,
    freeForAll: entry.freeForAll ?? false,
    coverable: entry.coverable ?? false,
    droppable: entry.droppable ?? true,
    hudHidden: entry.hudHidden ?? false,
    durationMode: entry.durationMode ?? DURATION_MODES.WORLD,
    durationMinutes: entry.durationMinutes ?? 0,
    endingMinutes: entry.endingMinutes ?? 0
  };
}

/**
 * Programmatically register or update light source definitions from an external
 * system or module. Nothing is written to the database: registered sources live in
 * memory, so the caller registers them on **every** client, every session (its
 * `ready` hook does exactly that). Calling again with the same uuid replaces that
 * source.
 *
 * A source's id is its uuid, and each pattern carries an `id` of its own, so lights
 * that are burning, or lying on the ground, find their source and pattern again after
 * the registry is rebuilt. The pattern id is separate from its `name` because a name
 * is a label: it may be translated, so it can differ between clients, or be left
 * empty. The GM's edits are stored apart, as records
 * of their own with the same id (see `getSources` in `helpers.js`), so registering
 * never overwrites them.
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

  for ( const entry of entries ) {
    if ( !entry?.uuid || !Array.isArray(entry.patterns) ) {
      console.warn(`${MODULE_ID} | Skipping light source entry missing a uuid or patterns array.`, entry);
      continue;
    }
    // Fuel names a second Item, which only the GM picks, in the light editor.
    if ( entry.consume === CONSUME_MODES.FUEL ) {
      console.warn(`${MODULE_ID} | Skipping light source "${entry.uuid}": fuel is set by the GM in the light editor.`, entry);
      continue;
    }
    if ( (entry.consume !== undefined) && !Object.values(CONSUME_MODES).includes(entry.consume) ) {
      const modes = Object.values(CONSUME_MODES).filter(m => m !== CONSUME_MODES.FUEL);
      console.warn(`${MODULE_ID} | Skipping light source "${entry.uuid}": consume must be one of ${modes.join(", ")}.`, entry);
      continue;
    }

    // Synchronous: a compendium entry resolves to its index entry, which every client
    // holds for every active pack, so this costs no server request per client.
    let item = null;
    try {
      item = foundry.utils.fromUuidSync(entry.uuid);
    } catch(err) {
      // A uuid that cannot be parsed is treated like one that does not resolve.
    }
    if ( !item ) {
      console.warn(`${MODULE_ID} | Could not resolve light source item "${entry.uuid}"; skipping.`);
      continue;
    }

    const ids = entry.patterns.map(p => p?.id);
    if ( ids.some(id => !id || (typeof id !== "string")) || (new Set(ids).size !== ids.length) ) {
      console.warn(`${MODULE_ID} | Skipping light source "${entry.uuid}": every pattern needs an id, unique within the entry.`, entry);
      continue;
    }

    const record = validateSource({
      id: entry.uuid,
      uuid: entry.uuid,
      name: item.name,
      img: item.img,
      type: item.type,
      managedBy,
      ...usageFields(entry),
      patterns: entry.patterns.map(p => ({ id: p.id, name: p.name ?? "", light: p.light }))
    }, entry.uuid);
    if ( record ) setRegisteredSource(record);
  }
}

/**
 * Programmatically seed the compatibility settings (item types, actor types,
 * and the item quantity and charges paths) from an external system or module,
 * mirroring what SYSTEM_PRESETS does for systems built into the module — but
 * supplied at runtime by the caller instead of hardcoded in constants.js.
 *
 * Each field seeds independently and only when still unset, so this is safe
 * to call every session (e.g. alongside registerSources in the same `ready`
 * hook): a GM who has already configured any of these through the
 * Compatibility config window keeps that choice untouched, even if the
 * caller supplies a different value for it. A no-op on a player's client.
 *
 * @param {object} [options={}]
 * @param {string[]} [options.itemTypes] Item type ids to enable as light sources.
 * @param {string[]} [options.actorTypes] Actor type ids allowed to carry/light sources.
 * @param {string} [options.quantityPath] Dotted path (from an item's root) to its quantity.
 * @param {string} [options.chargesPath] Dotted path (from an item's root) to how many
 *   charges it has left.
 * @param {string} [options.chargesSpentPath] Dotted path (from an item's root) to how
 *   many charges it has used, for a system that stores the count going up.
 * @returns {Promise<void>}
 */
export async function registerCompatibility({ itemTypes, actorTypes, quantityPath, chargesPath, chargesSpentPath } = {}) {
  // Only a GM may write world settings, and the GM's client seeds them for everyone.
  if ( !game.user.isGM ) return;
  if ( Array.isArray(itemTypes) && !getItemTypes().length ) {
    await game.settings.set(MODULE_ID, SETTINGS.ITEM_TYPES, itemTypes);
  }
  if ( Array.isArray(actorTypes) && !getActorTypes().length ) {
    await game.settings.set(MODULE_ID, SETTINGS.ACTOR_TYPES, actorTypes);
  }
  if ( quantityPath && !getQuantityPath() ) {
    await game.settings.set(MODULE_ID, SETTINGS.QUANTITY_PATH, quantityPath);
  }
  if ( chargesPath && !getChargesPath() ) {
    await game.settings.set(MODULE_ID, SETTINGS.CHARGES_PATH, chargesPath);
  }
  if ( chargesSpentPath && !getChargesSpentPath() ) {
    await game.settings.set(MODULE_ID, SETTINGS.CHARGES_SPENT_PATH, chargesSpentPath);
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
 * @param {string} id The source's id: its uuid when it has one. A source the GM added
 *   by name has no uuid, and its id is the one `getActive` reports.
 * @param {object} [options={}]
 * @param {string} [options.pattern] Id of the pattern to light. Defaults to the
 *   source's first pattern.
 * @returns {Promise<boolean>} True when the source is now lit.
 */
export async function activate(actor, id, { pattern } = {}) {
  if ( !actor ) {
    console.warn(`${MODULE_ID} | activate called without an actor.`);
    return false;
  }
  if ( !actor.isOwner ) {
    console.warn(`${MODULE_ID} | Cannot light "${actor.name}": the current user does not own that actor.`);
    return false;
  }

  const source = getSources().find(s => s.id === id);
  if ( !source ) {
    console.warn(`${MODULE_ID} | No light source registered for "${id}".`);
    return false;
  }

  // By id, never by name: a name is a label that may be translated or renamed by the GM.
  const target = pattern ? source.patterns.find(p => p.id === pattern) : source.patterns[0];
  if ( !target ) {
    console.warn(`${MODULE_ID} | Light source "${source.name}" has no pattern with the id "${pattern}".`);
    return false;
  }

  return activateLight(actor, source, target);
}

/**
 * Put out whatever light is burning on an Actor, exactly as the Token HUD's
 * extinguish control does, down to a `"charge"` light keeping the time it had left on
 * its Item. A no-op when nothing is lit.
 * @param {Actor} actor The actor whose light is extinguished.
 * @returns {Promise<void>}
 */
export async function deactivate(actor) {
  return extinguishLight(actor);
}

/**
 * Read what is currently burning on an Actor, so a caller can tell whether a light
 * is lit, which source and pattern it came from, and when it runs out.
 *
 * `itemId` names the carried Item the light burns on, which then moves and goes out
 * with it. That is every source except one that spends a copy, and a free-for-all
 * source; for those it is null.
 *
 * `runningLow` is true while the light shows its pattern's running-low look, in the
 * source's last `endingMinutes`.
 * @param {Actor} actor The actor to inspect.
 * @returns {object|null} The active light payload ({sourceId, patternId, patternName,
 *   itemName, itemId, mode, expiresAtWorld, expiresAtReal, runningLow, stowed}), or null
 *   when unlit.
 */
export function getActive(actor) {
  return getActiveLight(actor);
}

/**
 * Move the light burning on an Item's actor to the ground, together with that Item —
 * for a module that carries Items off actors and onto the map (loot, a thrown
 * lantern). The light moves only when `item` is the very Item it burns on, which is
 * every source except one that spends a copy, and a free-for-all source: a lit lantern
 * or torch with uses leaving takes its flame, a rope leaving takes nothing, and a
 * light lit from a stack never moves, since the copy it spent is the flame.
 *
 * Call it while `item` is still on its actor, then remove the Item. Removing it first
 * puts its light out, as any removal of a burning Item does.
 *
 * GM client only: only a GM can create an AmbientLight, and the caller needs the
 * created document back, which the player socket relay cannot return. The placed
 * light is left out of this module's Token HUD pickup and interactive control while
 * `managedBy` is active, burns out on its original schedule, and is handed back with
 * `pickupGroundLight`. Nothing is posted to chat.
 * @param {Item} item The Item about to leave its actor.
 * @param {object} where Where the light lands.
 * @param {Scene} where.scene The scene, which need not be the one being viewed.
 * @param {number} where.x The x coordinate of the light's centre.
 * @param {number} where.y The y coordinate of the light's centre.
 * @param {number} [where.elevation=0] The light's elevation.
 * @param {string[]} [where.levels=[]] The ids of the scene levels it belongs to.
 * @param {string} where.managedBy The id of the calling module or system.
 * @returns {Promise<AmbientLightDocument|null>} The placed light, or null when nothing moved.
 */
export async function dropLightWithItem(item, { scene, x, y, elevation = 0, levels = [], managedBy } = {}) {
  if ( !game.user.isGM ) {
    console.warn(`${MODULE_ID} | dropLightWithItem runs on a GM client only.`);
    return null;
  }
  if ( (item?.documentName !== "Item") || (item.parent?.documentName !== "Actor") ) {
    console.warn(`${MODULE_ID} | dropLightWithItem expected an Item still on its actor.`, item);
    return null;
  }
  if ( (scene?.documentName !== "Scene") || !Number.isFinite(x) || !Number.isFinite(y)
    || !Number.isFinite(elevation) || !Array.isArray(levels) ) {
    console.warn(`${MODULE_ID} | dropLightWithItem expected a scene and a finite x, y and elevation.`);
    return null;
  }
  if ( !managedBy || (typeof managedBy !== "string") ) {
    console.warn(`${MODULE_ID} | dropLightWithItem expected the calling package's id as managedBy.`);
    return null;
  }
  return dropItemLight(item, scene, { x, y, elevation, levels }, managedBy);
}

/**
 * Put a light placed by `dropLightWithItem` back on the actor carrying `item`,
 * burning on that Item with the time it had left. Call it once `item` is on the
 * picking actor — newly created, or the stack it merged into.
 *
 * The light always leaves the ground once found, even when it cannot be relit. A
 * light already burning on the actor is never replaced: the picked-up flame goes out,
 * and lighting that Item again costs what lighting always costs — for an Item that
 * spends a charge, another charge.
 *
 * GM client only, and silent: no chat and no notification, because the GM's client is
 * rarely the one whose user picked the Item up. The returned `reason` is for the
 * caller to tell its own user: `"missing"` (already gone from the scene),
 * `"sourceRemoved"`, `"burnedOut"`, `"occupied"`, `"refused"` (the game system refused the
 * light's effect), or `"invalid"` for a refused call.
 * @param {Item} item The Item the light returns with, already on the picking actor.
 * @param {AmbientLightDocument} light The ground light `dropLightWithItem` returned.
 * @returns {Promise<{lit: boolean, reason: string|null}>} Whether the actor is now lit, and why not.
 */
export async function pickupGroundLight(item, light) {
  const refused = { lit: false, reason: LIGHT_REASONS.INVALID };
  if ( !game.user.isGM ) {
    console.warn(`${MODULE_ID} | pickupGroundLight runs on a GM client only.`);
    return refused;
  }
  if ( (item?.documentName !== "Item") || (item.parent?.documentName !== "Actor") ) {
    console.warn(`${MODULE_ID} | pickupGroundLight expected an Item on the picking actor.`, item);
    return refused;
  }
  // Only a light placed through the API: a Token HUD drop has no package to hand it
  // back, and its Item may still be on the actor.
  if ( (light?.documentName !== "AmbientLight") || !light.getFlag(MODULE_ID, FLAGS.GROUND_LIGHT)?.managedBy ) {
    console.warn(`${MODULE_ID} | pickupGroundLight expected a light placed by dropLightWithItem.`, light);
    return refused;
  }
  return pickupItemLight(item, light);
}

/**
 * Hand the light burning on `fromItem` to `toItem`, an Item on another actor — for a
 * system or module that gives an Item to another character by creating a copy on the
 * receiver and removing the original. The flame moves, it is not copied: it keeps its
 * source, pattern, time left and covered state, spends nothing, and ends up in exactly
 * one place.
 *
 * Call it after creating the copy and before removing the original. Removing the
 * original first puts its light out, as any removal of a burning Item does; removing it
 * afterwards finds nothing burning on it.
 *
 * Runs on any client. When the caller can write both actors it moves the light itself;
 * otherwise — between two players — it asks the active GM through a query, and the GM
 * moves it only when the caller owns the giving actor. Silent: no chat and no
 * notification. When `lit` is false, `reason` is `"notBurning"` (`fromItem` is not the
 * Item the light burns on, which includes every `"copy"` and free-for-all light),
 * `"sourceRemoved"`, `"burnedOut"`, `"occupied"` (the receiver's light is never replaced,
 * and the giver keeps its own), `"noGm"`, `"refused"` (the receiver's game system refused
 * the light's effect, and the giver keeps its own), or `"invalid"` for a refused call.
 * @param {Item} fromItem The Item the light burns on now, still on the giving actor.
 * @param {Item} toItem The Item that takes it, already on the receiving actor.
 * @returns {Promise<{lit: boolean, reason: string|null}>} Whether the receiver is now lit, and why not.
 */
export async function handOverLight(fromItem, toItem) {
  const refused = { lit: false, reason: LIGHT_REASONS.INVALID };
  if ( !isCarriedItem(fromItem) || !isCarriedItem(toItem) ) {
    console.warn(`${MODULE_ID} | handOverLight expected two Items, each on an actor.`);
    return refused;
  }
  if ( fromItem.parent.isOwner && toItem.parent.isOwner ) return moveItemLight(fromItem, toItem);
  const gm = game.users.activeGM;
  if ( !gm ) return { lit: false, reason: LIGHT_REASONS.NO_GM };
  try {
    return await gm.query(`${MODULE_ID}.handOverLight`, { fromUuid: fromItem.uuid, toUuid: toItem.uuid }, { timeout: 20 * 1000 });
  } catch(err) {
    console.warn(`${MODULE_ID} | handOverLight got no answer from the GM.`, err);
    return { lit: false, reason: LIGHT_REASONS.NO_GM };
  }
}

/**
 * The GM's half of `handOverLight`, reached through a query. The requester may hand over only a
 * light burning on an actor it owns. The receiver needs no permission from it, because giving
 * is the point. `context.user` is the sender, filled in by the server, so it cannot be forged.
 * @param {{fromUuid: string, toUuid: string}} data The two Items' uuids.
 * @param {{user: User}} context The query context core passes to a handler.
 * @returns {Promise<{lit: boolean, reason: string|null}>}
 */
export async function handleHandOverQuery({ fromUuid, toUuid } = {}, { user } = {}) {
  const refused = { lit: false, reason: LIGHT_REASONS.INVALID };
  if ( !game.user.isGM || !user ) return refused;
  if ( (typeof fromUuid !== "string") || (typeof toUuid !== "string") ) return refused;
  const [fromItem, toItem] = await Promise.all([foundry.utils.fromUuid(fromUuid), foundry.utils.fromUuid(toUuid)]);
  if ( !isCarriedItem(fromItem) || !isCarriedItem(toItem) ) return refused;
  if ( !fromItem.parent.testUserPermission(user, "OWNER") ) return refused;
  return moveItemLight(fromItem, toItem);
}

/**
 * Both functions above use it: the item must be an Item embedded in a world Actor. A
 * compendium's is refused, so a query cannot have the GM write into a pack.
 * @param {*} item The value to test.
 * @returns {boolean}
 */
function isCarriedItem(item) {
  return (item?.documentName === "Item") && (item.parent?.documentName === "Actor") && !item.pack;
}
