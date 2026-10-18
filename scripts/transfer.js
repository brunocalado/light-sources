/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS } from "./constants.js";
import {
  getGmSources, setGmSources, validateSource, getItemTypes, getActorTypes, getQuantityPath, getChargesPath,
  getChargesSpentPath
} from "./helpers.js";

/**
 * The compatibility settings an export carries, by setting key. They decide which
 * Items and actors the sources apply to, so a file without them would be half a setup.
 * @type {Record<string, string>}
 */
const COMPATIBILITY_KEYS = {
  itemTypes: SETTINGS.ITEM_TYPES,
  actorTypes: SETTINGS.ACTOR_TYPES,
  quantityPath: SETTINGS.QUANTITY_PATH,
  chargesPath: SETTINGS.CHARGES_PATH,
  chargesSpentPath: SETTINGS.CHARGES_SPENT_PATH
};

/**
 * Build what an export file holds: the GM's records and the compatibility settings.
 * What modules register is left out, because it comes back in any world where those
 * modules are active.
 * @returns {object} The export data.
 */
export function buildExportData() {
  return {
    module: MODULE_ID,
    systemId: game.system.id,
    exportedAt: new Date().toISOString(),
    sources: getGmSources(),
    compatibility: {
      itemTypes: getItemTypes(),
      actorTypes: getActorTypes(),
      quantityPath: getQuantityPath(),
      chargesPath: getChargesPath(),
      chargesSpentPath: getChargesSpentPath()
    }
  };
}

/**
 * Download the export file.
 */
export function exportToFile() {
  const json = JSON.stringify(buildExportData(), null, 2);
  foundry.utils.saveDataToFile(json, "application/json", `${MODULE_ID}-${game.world.id}.json`);
}

/**
 * Read an export file into what importing it would write, without writing anything.
 *
 * Records merge by id: one in the file replaces the GM's record with the same id, and
 * the GM's other records are left alone. A record that fails validation is skipped,
 * never repaired. A record whose uuid does not resolve in this world is imported all
 * the same — it still matches carried Items by name and type — and reported.
 * Compatibility applies only when the file comes from the same game system, since item
 * types and data paths belong to a system.
 * @param {string} text The file's contents.
 * @returns {{records: object[], compatibility: object|null, report: {added: string[],
 *   replaced: string[], invalid: number, unresolved: string[], unresolvedFuel: string[],
 *   compatibility: string}}|null}
 *   What to write, and the report to show; null when the file is not a Light Sources
 *   export (a notification says so).
 */
export function readImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch(err) {
    data = null;
  }
  if ( (data?.module !== MODULE_ID) || !Array.isArray(data.sources) ) {
    ui.notifications.error("LIGHTSOURCES.Transfer.NotAnExport", { localize: true });
    return null;
  }

  const records = getGmSources();
  const report = { added: [], replaced: [], invalid: 0, unresolved: [], unresolvedFuel: [], compatibility: "absent" };
  for ( const raw of data.sources ) {
    const record = validateSource(raw, raw?.id ?? raw?.name ?? "?");
    if ( !record ) {
      report.invalid++;
      continue;
    }
    const index = records.findIndex(r => r.id === record.id);
    if ( index >= 0 ) {
      records[index] = record;
      report.replaced.push(record.name);
    } else {
      records.push(record);
      report.added.push(record.name);
    }
    if ( record.uuid && !resolves(record.uuid) ) report.unresolved.push(record.name);
    // The fuel is repaired in the light editor, not by relinking the source, so it is told apart.
    if ( record.fuel && !resolves(record.fuel.uuid) ) report.unresolvedFuel.push(`${record.name} (${record.fuel.name})`);
  }

  let compatibility = null;
  if ( data.compatibility && (typeof data.compatibility === "object") ) {
    if ( data.systemId === game.system.id ) {
      compatibility = data.compatibility;
      report.compatibility = "applied";
    }
    else report.compatibility = "otherSystem";
  }
  return { records, compatibility, report };
}

/**
 * Write what `readImport` returned. Compatibility values of the wrong type are left as
 * they are: the settings are typed, and a hand-edited file is not a reason to throw.
 * @param {{records: object[], compatibility: object|null}} result What to write.
 * @returns {Promise<void>}
 */
export async function applyImport({ records, compatibility }) {
  await setGmSources(records);
  if ( !compatibility ) return;
  for ( const [field, key] of Object.entries(COMPATIBILITY_KEYS) ) {
    const value = compatibility[field];
    const valid = Array.isArray(game.settings.get(MODULE_ID, key))
      ? Array.isArray(value) && value.every(v => typeof v === "string")
      : typeof value === "string";
    if ( valid ) await game.settings.set(MODULE_ID, key, value);
  }
}

/**
 * Whether a uuid names something that exists in this world.
 * @param {string} uuid The uuid to test.
 * @returns {boolean}
 */
function resolves(uuid) {
  try {
    return !!foundry.utils.fromUuidSync(uuid);
  } catch(err) {
    return false;
  }
}
