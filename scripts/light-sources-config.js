/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES, DEFAULT_LIGHT, DEFAULT_SOURCE_IMG, DURATION_MODES, CHAT_CARD_ACCENT } from "./constants.js";
import { getSources, setSources, makePattern, buildChatCard, getItemTypes } from "./helpers.js";
import { LightSourceEditor } from "./light-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * GM configuration application listing the registered light sources.
 * Items of an enabled type (see the compatibility settings) are registered by
 * dragging them onto the window; each entry can then be edited (light pattern,
 * consumption, duration) or removed. Opened through the module's settings menu
 * (restricted to GMs).
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class LightSourcesConfig extends HandlebarsApplicationMixin(ApplicationV2) {

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-config`,
    classes: [MODULE_ID, "ls-config"],
    window: {
      title: "LIGHTSOURCES.Config.Title",
      icon: "fa-solid fa-fire-flame-curved",
      resizable: true
    },
    position: { width: 520, height: "auto" },
    actions: {
      addByName: this.prototype._onAddByName,
      openItem: this.prototype._onOpenItem,
      sendToChat: this.prototype._onSendToChat,
      toggleFreeForAll: this.prototype._onToggleFreeForAll,
      editSource: this.prototype._onEditSource,
      restoreDefault: this.prototype._onRestoreDefault,
      deleteSource: this.prototype._onDeleteSource
    }
  };

  static PARTS = {
    // `scrollable` preserves the source list's scroll position across the
    // re-renders triggered by every action in this window (toggling free-for-all,
    // adding/removing a source, ...), instead of resetting it to the top.
    main: { template: TEMPLATES.CONFIG, scrollable: [".ls-source-list"] }
  };

  /**
   * Build the render context with display labels for each registered source.
   * @param {object} options Render options.
   * @returns {Promise<object>} The template context.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.sources = getSources().map(source => ({
      ...source,
      // Null for a name-only source (no linked Item, so no document subtype).
      typeLabel: source.type ? game.i18n.localize(CONFIG.Item.typeLabels?.[source.type] ?? source.type) : null,
      durationLabel: source.durationMinutes > 0
        ? game.i18n.format("LIGHTSOURCES.Config.Minutes", { minutes: source.durationMinutes })
        : game.i18n.localize("LIGHTSOURCES.Config.Unlimited"),
      // Only surfaced when a source has more than one pattern; a lone pattern is
      // the implicit default and needs no badge.
      patternLabel: source.patterns.length > 1
        ? game.i18n.format("LIGHTSOURCES.Config.Patterns", { count: source.patterns.length })
        : null,
      // Only a source registered through the API has a module default behind it;
      // one the GM added by hand has nothing to restore to. The control is then
      // rendered for all of them but stays inert until the GM edits one, so the
      // tooltip has to explain both states.
      hasModuleDefault: !!source.moduleDefaults,
      restoreTooltip: source.customized
        ? game.i18n.localize("LIGHTSOURCES.Config.RestoreTooltip")
        : game.i18n.localize("LIGHTSOURCES.Config.RestoreDisabledTooltip")
    }));
    return context;
  }

  /**
   * Attach the drag & drop listeners. Called from `_onFirstRender` because the
   * application frame persists across re-renders and listeners must not stack.
   * @param {object} context The render context.
   * @param {object} options Render options.
   * @override
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.element.addEventListener("dragover", event => event.preventDefault());
    this.element.addEventListener("dragenter", event => {
      event.preventDefault();
      this.element.classList.add("ls-drag-over");
    });
    this.element.addEventListener("dragleave", event => {
      if ( this.element.contains(event.relatedTarget) ) return;
      this.element.classList.remove("ls-drag-over");
    });
    this.element.addEventListener("drop", event => {
      this.element.classList.remove("ls-drag-over");
      this._onDrop(event);
    });
  }

  /**
   * Handle an Item dropped onto the window: validate its type against the
   * enabled item types and register it as a new light source with the default
   * light pattern.
   * @param {DragEvent} event The drop event.
   * @returns {Promise<void>}
   */
  async _onDrop(event) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( data?.type !== "Item" ) return;
    const item = await foundry.utils.fromUuid(data.uuid);
    if ( !item ) return;
    if ( !getItemTypes().includes(item.type) ) {
      ui.notifications.warn("LIGHTSOURCES.Config.InvalidType", { localize: true });
      return;
    }
    const sources = getSources();
    if ( sources.some(s => (s.name === item.name) && (s.type === item.type)) ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name: item.name }));
      return;
    }
    sources.push({
      id: foundry.utils.randomID(),
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      type: item.type,
      consume: false,
      freeForAll: false,
      durationMode: DURATION_MODES.WORLD,
      durationMinutes: 0,
      patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))]
    });
    await setSources(sources);
    this.render();
  }

  /**
   * Register a new light source from a name alone, with no linked Item: the
   * GM is prompted for a name, and the source is created with a default icon
   * and no `type`/`uuid`. Meant for "free for all" grants with no physical
   * item, or for sources the GM wants to register before the item exists.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onAddByName(event, target) {
    const content = `
      <div class="form-group">
        <label>${game.i18n.localize("LIGHTSOURCES.Config.NameLabel")}</label>
        <div class="form-fields">
          <input type="text" name="name" required autofocus
                 placeholder="${game.i18n.localize("LIGHTSOURCES.Config.NamePlaceholder")}">
        </div>
      </div>`;
    const name = await DialogV2.prompt({
      window: { title: "LIGHTSOURCES.Config.AddByNameTitle" },
      content,
      ok: {
        label: "LIGHTSOURCES.Config.AddByName",
        callback: (event, button) => button.form.elements.name.value.trim()
      }
    });
    if ( !name ) return;

    const sources = getSources();
    if ( sources.some(s => s.name === name) ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name }));
      return;
    }

    sources.push({
      id: foundry.utils.randomID(),
      uuid: null,
      name,
      img: DEFAULT_SOURCE_IMG,
      type: null,
      consume: false,
      freeForAll: false,
      durationMode: DURATION_MODES.WORLD,
      durationMinutes: 0,
      patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))]
    });
    await setSources(sources);
    this.render();
  }

  /**
   * Open the source's linked Item sheet so its details can be inspected.
   * Bound to the source's icon, which is the only control for this.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onOpenItem(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const source = getSources().find(s => s.id === sourceId);
    const item = source?.uuid ? await foundry.utils.fromUuid(source.uuid) : null;
    if ( !item ) {
      ui.notifications.warn("LIGHTSOURCES.Config.NoItemReference", { localize: true });
      return;
    }
    item.sheet.render(true);
  }

  /**
   * Post the source's linked Item to chat as a content link, letting any
   * player drag it from the chat message onto an Actor sheet.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onSendToChat(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const source = getSources().find(s => s.id === sourceId);
    const item = source?.uuid ? await foundry.utils.fromUuid(source.uuid) : null;
    if ( !item ) {
      ui.notifications.warn("LIGHTSOURCES.Config.NoItemReference", { localize: true });
      return;
    }
    const link = await foundry.applications.ux.TextEditor.implementation.enrichHTML(`@UUID[${item.uuid}]{${item.name}}`);
    const body = `
      <img src="${item.img}" alt="${item.name}" style="width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 2px solid ${CHAT_CARD_ACCENT}; margin-bottom: 8px;">
      <div style="color: #fff;">${link}</div>
      <p style="color: #ccc; font-size: 12px; font-style: italic; margin: 6px 0 0;">${game.i18n.localize("LIGHTSOURCES.Chat.DragHint")}</p>
    `;
    await ChatMessage.implementation.create({
      content: buildChatCard(item.name, body),
      speaker: ChatMessage.implementation.getSpeaker()
    });
  }

  /**
   * Toggle the clicked source's "free for all" flag: while set, the source is
   * offered on the Token HUD of every eligible actor regardless of inventory,
   * and activating it never looks up or consumes an item (see `activateLight`
   * in `light-manager.js`). Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onToggleFreeForAll(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const sources = getSources();
    const source = sources.find(s => s.id === sourceId);
    if ( !source ) return;
    source.freeForAll = !source.freeForAll;
    // Freeze the source against the next registerSources call, exactly as saving
    // the light editor does (see `_onFormSubmit` in light-editor.js).
    if ( source.moduleDefaults ) source.customized = true;
    await setSources(sources);
    this.render();
  }

  /**
   * Open the light pattern editor for the clicked source.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   */
  _onEditSource(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    if ( !sourceId ) return;
    new LightSourceEditor({ sourceId, configApp: this }).render(true);
  }

  /**
   * Discard the GM's edits to the clicked source and restore the values its
   * managing module last supplied, unfreezing it so `registerSources` resumes
   * updating it automatically. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onRestoreDefault(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const sources = getSources();
    const source = sources.find(s => s.id === sourceId);
    if ( !source?.customized ) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "LIGHTSOURCES.Config.RestoreTitle" },
      content: `<p>${game.i18n.format("LIGHTSOURCES.Config.RestoreContent", { name: source.name })}</p>`
    });
    if ( !confirmed ) return;

    Object.assign(source, source.moduleDefaults);
    for ( const pattern of source.patterns ) {
      // A pattern with no snapshot was added by the GM, not by the module: a
      // restore reverts the module's own patterns, it never deletes work the
      // module did not supply. The next registerSources call — which the source
      // is no longer frozen against — prunes any pattern the module has dropped.
      if ( !pattern.moduleLight ) continue;
      pattern.name = pattern.moduleName;
      pattern.light = foundry.utils.deepClone(pattern.moduleLight);
    }
    source.customized = false;

    await setSources(sources);
    this.render();
  }

  /**
   * Remove the clicked source after confirmation.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onDeleteSource(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const source = getSources().find(s => s.id === sourceId);
    if ( !source ) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "LIGHTSOURCES.Config.DeleteTitle" },
      content: `<p>${game.i18n.format("LIGHTSOURCES.Config.DeleteContent", { name: source.name })}</p>`
    });
    if ( !confirmed ) return;
    await setSources(getSources().filter(s => s.id !== sourceId));
    this.render();
  }
}
