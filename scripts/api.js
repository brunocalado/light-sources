/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, DURATION_MODES } from "./constants.js";
import { getSources, setSources, makePattern } from "./helpers.js";

/**
 * The usage fields a caller supplies, with the API's documented defaults filled
 * in. Also snapshotted onto the source as `moduleDefaults`, so restoring returns
 * what the module wants *now* rather than what it asked for on first registration.
 * @param {object} entry The caller's light source definition.
 * @returns {{consume: boolean, freeForAll: boolean, durationMode: string, durationMinutes: number}} The usage fields.
 */
function usageFields(entry) {
  return {
    consume: entry.consume ?? false,
    freeForAll: entry.freeForAll ?? false,
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
