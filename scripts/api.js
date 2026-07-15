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
 * Convert a caller-supplied raw pattern ({name, light}) into the module's
 * internal {id, name, light} shape, reusing an existing pattern's id when a
 * previous pattern on the same source shares its name. Preserving ids keeps any
 * HUD state that references a pattern by id valid across an update.
 * @param {{name: string, light: object}} raw The caller's pattern definition.
 * @param {object[]} existingPatterns The source's current patterns (may be empty).
 * @returns {{id: string, name: string, light: object}} The internal pattern.
 */
function toInternalPattern(raw, existingPatterns) {
  const pattern = makePattern(raw.light, raw.name);
  const previous = existingPatterns.find(p => p.name === raw.name);
  if ( previous ) pattern.id = previous.id;
  return pattern;
}

/**
 * Programmatically register or update light source definitions from an
 * external system or module. UUID is used as the primary key: existing
 * sources are updated in-place (preserving their internal id); new ones
 * are appended. A single setSources write is performed per call.
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
    const patterns = entry.patterns.map(raw => toInternalPattern(raw, existing?.patterns ?? []));

    const fields = {
      patterns,
      consume: entry.consume ?? false,
      freeForAll: entry.freeForAll ?? false,
      durationMode: entry.durationMode ?? DURATION_MODES.WORLD,
      durationMinutes: entry.durationMinutes ?? 0,
      managedBy
    };

    if ( existing ) {
      // Update in place, preserving the internal id (it may be referenced by
      // active effects currently on actors) and refreshing the item metadata.
      Object.assign(existing, fields, { name: item.name, img: item.img, type: item.type });
    } else {
      sources.push({
        id: foundry.utils.randomID(),
        uuid: entry.uuid,
        name: item.name,
        img: item.img,
        type: item.type,
        ...fields
      });
    }
  }

  await setSources(sources);
}
