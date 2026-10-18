/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES } from "./constants.js";
import { exportToFile, readImport, applyImport } from "./transfer.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * GM window that exports the world's light sources and compatibility settings to a
 * JSON file, and imports such a file, to copy a setup from one world to another.
 * Opened through the module's settings menu (restricted to GMs).
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class TransferConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-transfer`,
    classes: [MODULE_ID, "ls-transfer"],
    window: {
      title: "LIGHTSOURCES.Transfer.Title",
      icon: "fa-solid fa-file-export"
    },
    position: { width: 440, height: "auto" },
    actions: {
      exportSources: this.prototype._onExport,
      importSources: this.prototype._onImport
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.TRANSFER }
  };

  /**
   * Download the export file. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   */
  _onExport(event, target) {
    exportToFile();
  }

  /**
   * Read the chosen file, show what importing it would change, and write it only once
   * the GM confirms. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onImport(event, target) {
    const file = this.element.querySelector("input[name='file']")?.files?.[0];
    if ( !file ) {
      ui.notifications.warn("LIGHTSOURCES.Transfer.NoFile", { localize: true });
      return;
    }
    let text;
    try {
      text = await foundry.utils.readTextFromFile(file);
    } catch(err) {
      // readTextFromFile rejects with no argument when the browser cannot read the file.
      ui.notifications.error("LIGHTSOURCES.Transfer.NotAnExport", { localize: true });
      return;
    }
    const result = readImport(text);
    if ( !result ) return;

    const confirmed = await DialogV2.confirm({
      window: { title: "LIGHTSOURCES.Transfer.ConfirmTitle" },
      content: buildReport(result.report)
    });
    if ( !confirmed ) return;

    await applyImport(result);
    ui.notifications.info("LIGHTSOURCES.Transfer.Done", { localize: true });
    foundry.applications.instances.get(`${MODULE_ID}-config`)?.render();
  }
}

/**
 * The confirmation text listing what an import would do. Names come from a file the
 * GM may not have written, so each is escaped before it enters the HTML.
 * @param {{added: string[], replaced: string[], invalid: number, unresolved: string[], unresolvedFuel: string[],
 *   compatibility: string}} report
 * @returns {string} The dialog content.
 */
function buildReport(report) {
  const names = list => list.map(n => foundry.utils.escapeHTML(n)).join(", ");
  const lines = [];
  if ( report.added.length ) {
    lines.push(game.i18n.format("LIGHTSOURCES.Transfer.Added", { count: report.added.length, names: names(report.added) }));
  }
  if ( report.replaced.length ) {
    lines.push(game.i18n.format("LIGHTSOURCES.Transfer.Replaced", { count: report.replaced.length, names: names(report.replaced) }));
  }
  if ( !report.added.length && !report.replaced.length ) lines.push(game.i18n.localize("LIGHTSOURCES.Transfer.NoSources"));
  if ( report.invalid ) lines.push(game.i18n.format("LIGHTSOURCES.Transfer.Invalid", { count: report.invalid }));
  if ( report.unresolved.length ) {
    lines.push(game.i18n.format("LIGHTSOURCES.Transfer.Unresolved", { names: names(report.unresolved) }));
  }
  if ( report.unresolvedFuel.length ) {
    lines.push(game.i18n.format("LIGHTSOURCES.Transfer.UnresolvedFuel", { names: names(report.unresolvedFuel) }));
  }
  const compatibility = {
    applied: "LIGHTSOURCES.Transfer.CompatApplied",
    otherSystem: "LIGHTSOURCES.Transfer.CompatOtherSystem"
  }[report.compatibility];
  if ( compatibility ) lines.push(game.i18n.localize(compatibility));
  return `${lines.map(l => `<p>${l}</p>`).join("")}<p>${game.i18n.localize("LIGHTSOURCES.Transfer.ConfirmQuestion")}</p>`;
}
