/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES, DEFAULT_LIGHT, DURATION_MODES, CHAT_CARD_ACCENT } from "./constants.js";
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
      openItem: this.prototype._onOpenItem,
      sendToChat: this.prototype._onSendToChat,
      toggleFreeForAll: this.prototype._onToggleFreeForAll,
      editSource: this.prototype._onEditSource,
      deleteSource: this.prototype._onDeleteSource
    }
  };

  static PARTS = {
    main: { template: TEMPLATES.CONFIG }
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
      typeLabel: game.i18n.localize(CONFIG.Item.typeLabels?.[source.type] ?? source.type),
      durationLabel: source.durationMinutes > 0
        ? game.i18n.format("LIGHTSOURCES.Config.Minutes", { minutes: source.durationMinutes })
        : game.i18n.localize("LIGHTSOURCES.Config.Unlimited"),
      // Only surfaced when a source has more than one pattern; a lone pattern is
      // the implicit default and needs no badge.
      patternLabel: source.patterns.length > 1
        ? game.i18n.format("LIGHTSOURCES.Config.Patterns", { count: source.patterns.length })
        : null
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
   * Re-attach the source icons' drag listeners after every render, since the
   * source list markup (and therefore its <img> elements) is replaced
   * whenever the PART re-renders.
   * @param {object} context The render context.
   * @param {object} options Render options.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);
    for ( const icon of this.element.querySelectorAll(".ls-icon") ) {
      icon.addEventListener("dragstart", this.#onIconDragStart.bind(this));
    }
  }

  /**
   * Set native HTML5 drag data on a source's icon so it can be dropped onto
   * an Actor sheet exactly like dragging the Item from a compendium or
   * directory would.
   * @param {DragEvent} event The dragstart event.
   */
  #onIconDragStart(event) {
    const uuid = event.currentTarget.dataset.uuid;
    if ( !uuid ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.setData("text/plain", JSON.stringify({ type: "Item", uuid }));
  }

  /**
   * Open the source's linked Item sheet so its details can be inspected.
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
