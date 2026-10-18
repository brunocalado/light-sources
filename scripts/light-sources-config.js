/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES, DEFAULT_LIGHT, DEFAULT_SOURCE_IMG, DURATION_MODES, CONSUME_MODES, CHAT_CARD_ACCENT } from "./constants.js";
import {
  getSources, getGmSources, setGmSources, getRegisteredSource, getRemovedSources, editSource, makePattern, buildChatCard,
  getItemTypes
} from "./helpers.js";
import { LightSourceEditor } from "./light-editor.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * Whether a dropped Item may take over a source with its name: only the GM's own
 * live record (a module's registration would overwrite the Item metadata again)
 * whose Item does not resolve here, or which never had one.
 * @param {object} source The clashing source.
 * @returns {object|null} The source, or null when it must not be relinked.
 */
function relinkable(source) {
  const own = getGmSources().find(r => r.id === source.id);
  if ( !own || own.removed || getRegisteredSource(source.id) ) return null;
  if ( source.uuid && foundry.utils.fromUuidSync(source.uuid, { strict: false }) ) return null;
  return source;
}

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
      toggleHudHidden: this.prototype._onToggleHudHidden,
      duplicateSource: this.prototype._onDuplicateSource,
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
    const edited = new Set(getGmSources().map(r => r.id));
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
      consumeLabel: {
        [CONSUME_MODES.COPY]: game.i18n.localize("LIGHTSOURCES.Config.ConsumeCopy"),
        [CONSUME_MODES.CHARGE]: game.i18n.localize("LIGHTSOURCES.Config.ConsumeCharge")
      }[source.consume] ?? null,
      // Only a source a module registers has a default behind it; one the GM added
      // by hand has nothing to restore to. The control is then rendered for all of
      // them but stays inert until the GM edits one, so the tooltip has to explain
      // both states.
      hasModuleDefault: !!getRegisteredSource(source.id),
      customized: edited.has(source.id),
      restoreTooltip: edited.has(source.id)
        ? game.i18n.localize("LIGHTSOURCES.Config.RestoreTooltip")
        : game.i18n.localize("LIGHTSOURCES.Config.RestoreDisabledTooltip")
    }));
    context.removed = getRemovedSources();
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
   * light pattern, or relink the GM's source of the same name whose Item is gone.
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
    // Same uuid catches one compendium entry seen under another language's name; same
    // name + type stays blocked because two such sources would fight over the same
    // items through findMatchingItems' name fallback, and a name-only source (no type)
    // matches any item with its name, so it blocks that name too. Checked against the effective
    // list, so an Item a module already registers is refused too. A source the GM
    // removed is still a record under that id, so it is refused as well: restoring it
    // is the way back.
    const taken = [...getSources(), ...getRemovedSources()];
    if ( taken.some(s => s.uuid === item.uuid) ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name: item.name }));
      return;
    }
    const clash = taken.filter(s => (s.name === item.name) && (!s.type || (s.type === item.type)));
    // The one exception: a single clash that is the GM's own source and has lost its
    // Item (deleted, imported from another world, pack disabled) takes this Item
    // instead, since that is the only way to repair it without losing its settings.
    const stale = (clash.length === 1) ? relinkable(clash[0]) : null;
    if ( stale ) {
      // The id stays: lit effects and ground lights find their source by it.
      await editSource(stale.id, record => Object.assign(record, {
        uuid: item.uuid, name: item.name, img: item.img, type: item.type
      }));
      ui.notifications.info(game.i18n.format("LIGHTSOURCES.Config.Relinked", { name: item.name }));
      this.render();
      return;
    }
    if ( clash.length ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name: item.name }));
      return;
    }
    const records = getGmSources();
    // The uuid is the id, so the source is the same on every client and in every
    // world that holds this Item.
    records.push({
      id: item.uuid,
      uuid: item.uuid,
      name: item.name,
      img: item.img,
      type: item.type,
      consume: CONSUME_MODES.NONE,
      freeForAll: false,
      coverable: false,
      droppable: true,
      hudHidden: false,
      durationMode: DURATION_MODES.WORLD,
      durationMinutes: 0,
      endingMinutes: 0,
      patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))]
    });
    await setGmSources(records);
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

    if ( getSources().some(s => s.name === name) ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name }));
      return;
    }

    const records = getGmSources();
    records.push({
      id: foundry.utils.randomID(),
      uuid: null,
      name,
      img: DEFAULT_SOURCE_IMG,
      type: null,
      consume: CONSUME_MODES.NONE,
      freeForAll: false,
      coverable: false,
      droppable: true,
      hudHidden: false,
      durationMode: DURATION_MODES.WORLD,
      durationMinutes: 0,
      endingMinutes: 0,
      patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))]
    });
    await setGmSources(records);
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
    await editSource(sourceId, source => source.freeForAll = !source.freeForAll);
    this.render();
  }

  /**
   * Toggle the clicked source's "hidden from the Token HUD" flag: while set, the
   * source is not offered in the palette and can only be lit through the module's
   * `activate` API — which is the point, for a source whose real cost is charged by
   * a game system before the light exists. A lit source is listed regardless (see
   * `onRenderTokenHUD` in `token-hud.js`), so the light can always be put out.
   * Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onToggleHudHidden(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    await editSource(sourceId, source => source.hudHidden = !source.hudHidden);
    this.render();
  }

  /**
   * Copy the clicked source into a new one, as a starting point, and open the editor on
   * the copy so it can be renamed. The copy starts as "<name> (Copy)", which matches no
   * item until it is renamed. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onDuplicateSource(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const sources = getSources();
    const source = sources.find(s => s.id === sourceId);
    if ( !source ) return;
    const taken = new Set(sources.map(s => s.name));
    // 64 is the editor's name limit; the base is cut so the suffix always fits.
    let name;
    for ( let n = 1; !name || taken.has(name); n++ ) {
      const key = (n === 1) ? "LIGHTSOURCES.Config.CopyName" : "LIGHTSOURCES.Config.CopyNameNumbered";
      const suffix = game.i18n.format(key, { name: "", n }).length;
      name = game.i18n.format(key, { name: source.name.slice(0, 64 - suffix).trim(), n });
    }
    // Always a name-only source of the GM's own: an Item-backed or registered source's
    // id is its uuid, which a second source cannot share. Free for all and hidden start
    // off, so a placeholder copy never shows up on every token's HUD.
    const id = foundry.utils.randomID();
    const records = getGmSources();
    records.push({
      id,
      uuid: null,
      name,
      img: source.img,
      type: null,
      managedBy: null,
      consume: source.consume,
      freeForAll: false,
      coverable: source.coverable,
      droppable: source.droppable,
      hudHidden: false,
      durationMode: source.durationMode,
      durationMinutes: source.durationMinutes,
      endingMinutes: source.endingMinutes,
      patterns: foundry.utils.deepClone(source.patterns)
    });
    await setGmSources(records);
    this.render();
    new LightSourceEditor({ sourceId: id, configApp: this }).render(true);
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
   * Discard the GM's record for the clicked source, so the values its module
   * registers apply again. Also the way back for a registered source the GM removed,
   * since that removal is a record too. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onRestoreDefault(event, target) {
    const sourceId = target.closest("[data-source-id]")?.dataset.sourceId;
    const records = getGmSources();
    const record = records.find(r => r.id === sourceId);
    if ( !record ) return;
    const name = getRegisteredSource(sourceId)?.name ?? record.name;
    const confirmed = await DialogV2.confirm({
      window: { title: "LIGHTSOURCES.Config.RestoreTitle" },
      content: `<p>${game.i18n.format("LIGHTSOURCES.Config.RestoreContent", { name: foundry.utils.escapeHTML(name) })}</p>`
    });
    if ( !confirmed ) return;
    await setGmSources(records.filter(r => r.id !== sourceId));
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
      content: `<p>${game.i18n.format("LIGHTSOURCES.Config.DeleteContent", { name: foundry.utils.escapeHTML(source.name) })}</p>`
    });
    if ( !confirmed ) return;
    // A source a module registers comes back with the next registration, so removing
    // it is a record of its own (a tombstone) that Restore deletes again.
    if ( getRegisteredSource(sourceId) ) await editSource(sourceId, record => record.removed = true);
    else await setGmSources(getGmSources().filter(r => r.id !== sourceId));
    this.render();
  }
}

