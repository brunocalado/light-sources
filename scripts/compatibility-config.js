/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, TEMPLATES } from "./constants.js";
import { getItemTypes, getActorTypes, getQuantityPath, listDocumentTypes } from "./helpers.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM configuration application that adapts the module to the detected game
 * system. Three tabs let the GM pick which of the system's item types count as
 * light sources, which actor types may carry and light them, and the dotted
 * path to an item's quantity (used for consumption). Opened through the
 * module's settings menu (restricted to GMs).
 *
 * Nothing here is auto-detected beyond the list of available types: it is the
 * GM's responsibility to enable the correct types and enter the correct
 * quantity path. Known systems are seeded with sensible defaults when the
 * module is first installed (see SYSTEM_PRESETS); unknown systems start empty.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class CompatibilityConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-compatibility`,
    classes: [MODULE_ID, "ls-compatibility", "standard-form"],
    tag: "form",
    window: {
      title: "LIGHTSOURCES.Compat.Title",
      icon: "fa-solid fa-gears",
      resizable: true,
      contentClasses: ["standard-form"]
    },
    position: { width: 520, height: "auto" },
    form: {
      handler: this._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: TEMPLATES.COMPAT }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "items", icon: "fa-solid fa-box" },
        { id: "actors", icon: "fa-solid fa-user" },
        { id: "quantity", icon: "fa-solid fa-hashtag" }
      ],
      initial: "items",
      labelPrefix: "LIGHTSOURCES.Compat.Tabs"
    }
  };

  /**
   * Build the render context: the detected system's item/actor types (each
   * flagged with its current enabled state), the configured quantity path and
   * the active system's identity for display.
   * @param {object} options Render options.
   * @returns {Promise<object>} The template context.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.tabs = this._prepareTabs("primary");

    const enabledItems = getItemTypes();
    const enabledActors = getActorTypes();
    context.itemTypes = listDocumentTypes("Item").map(t => ({ ...t, checked: enabledItems.includes(t.value) }));
    context.actorTypes = listDocumentTypes("Actor").map(t => ({ ...t, checked: enabledActors.includes(t.value) }));
    context.quantityPath = getQuantityPath();
    context.systemTitle = game.system.title;
    context.systemId = game.system.id;
    return context;
  }

  /**
   * Form submission handler: collect the checked item/actor types and the
   * quantity path, then persist them to the world settings.
   * Called by ApplicationV2 with `this` bound to the application instance.
   * @param {SubmitEvent} event The originating submit event.
   * @param {HTMLFormElement} form The form element.
   * @param {foundry.applications.ux.FormDataExtended} formData The processed form data.
   * @returns {Promise<void>}
   */
  static async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const enabledFrom = group => Object.entries(group ?? {}).filter(([, on]) => on).map(([type]) => type);

    await game.settings.set(MODULE_ID, SETTINGS.ITEM_TYPES, enabledFrom(data.items));
    await game.settings.set(MODULE_ID, SETTINGS.ACTOR_TYPES, enabledFrom(data.actors));
    await game.settings.set(MODULE_ID, SETTINGS.QUANTITY_PATH, (data.quantityPath ?? "").trim());
  }
}
