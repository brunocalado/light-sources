/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, TEMPLATES, CHAT_EVENTS } from "./constants.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM window that chooses which light events post a chat card: lit, dropped, picked up
 * and burned out. Opened through the module's settings menu (restricted to GMs).
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class ChatConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-chat`,
    classes: [MODULE_ID, "ls-chat", "standard-form"],
    tag: "form",
    window: {
      title: "LIGHTSOURCES.ChatConfig.Title",
      icon: "fa-solid fa-comment",
      contentClasses: ["standard-form"]
    },
    position: { width: 420, height: "auto" },
    form: {
      handler: this._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: TEMPLATES.CHAT }
  };

  /**
   * Build the render context: one row per chat event with its current state.
   * @param {object} options Render options.
   * @returns {Promise<object>} The template context.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const current = game.settings.get(MODULE_ID, SETTINGS.CHAT_MESSAGES);
    context.events = CHAT_EVENTS.map(id => ({
      id,
      checked: current[id],
      label: `LIGHTSOURCES.ChatConfig.Events.${id}.Label`,
      hint: `LIGHTSOURCES.ChatConfig.Events.${id}.Hint`
    }));
    return context;
  }

  /**
   * Form submission handler: store each event's checkbox in the world setting.
   * Called by ApplicationV2 with `this` bound to the application instance.
   * @param {SubmitEvent} event The originating submit event.
   * @param {HTMLFormElement} form The form element.
   * @param {foundry.applications.ux.FormDataExtended} formData The processed form data.
   * @returns {Promise<void>}
   */
  static async _onFormSubmit(event, form, formData) {
    const { events } = foundry.utils.expandObject(formData.object);
    await game.settings.set(MODULE_ID, SETTINGS.CHAT_MESSAGES, events);
  }
}
