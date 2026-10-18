/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  MODULE_ID, TEMPLATES, DEFAULT_LIGHT, DURATION_MODES, CONSUME_MODES, RANGE_PRESETS, DURATION_PRESETS, ADVANCED_LIGHT_KEYS,
  DEFAULT_SOURCE_IMG
} from "./constants.js";
import { getSources, getRegisteredSource, editSource, makePattern } from "./helpers.js";
import { buildLightData, patternForPhase, sweepLights } from "./light-manager.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Sanitize the fields a light's look is made of — radii, color and animation — from
 * raw form values. Shared by a pattern's full look and its running-low look, so the
 * two are clamped and defaulted by the same rules.
 * @param {object} [raw={}] The raw form values of one look.
 * @returns {{dim: number, bright: number, color: string, alpha: number, animation: object}}
 */
function sanitizeBasic(raw = {}) {
  const alpha = Number(raw.alpha);
  const anim = raw.animation ?? {};
  return {
    dim: Math.max(0, Number(raw.dim) || 0),
    bright: Math.max(0, Number(raw.bright) || 0),
    color: raw.color || "",
    alpha: Math.clamp(Number.isFinite(alpha) ? alpha : 0.5, 0, 1),
    animation: {
      type: anim.type || "",
      speed: Math.clamp(Number(anim.speed) || 5, 1, 10),
      intensity: Math.clamp(Number(anim.intensity) || 5, 1, 10),
      reverse: !!anim.reverse
    }
  };
}

/**
 * Editor for a single registered light source. A source owns one or more light
 * patterns ("stages" — e.g. a flashlight's wide-short beam vs. narrow-long beam);
 * each pattern exposes the basic light configuration and the light animation, with
 * its running-low look and core's advanced light options folded away behind opt-in
 * sections. Consumption and duration are configured once and shared across all of the
 * source's patterns.
 * While open, every edit is live-previewed on the currently controlled canvas
 * Token (if any), the same way core's placeable config sheets preview changes;
 * the preview follows whichever pattern card the user is currently editing.
 * @extends {foundry.applications.api.ApplicationV2}
 */
export class LightSourceEditor extends HandlebarsApplicationMixin(ApplicationV2) {

  /**
   * The Token currently receiving the live light preview, if any.
   * @type {Token|null}
   */
  #previewToken = null;

  /**
   * The previewed Token's light data before the preview started, so it can be
   * restored when the preview target changes or the editor closes.
   * @type {object|null}
   */
  #previewOriginalLight = null;

  /**
   * The `controlToken` hook id registered while this editor is open, so the
   * preview always follows the currently selected Token.
   * @type {number|null}
   */
  #controlTokenHookId = null;

  /**
   * Working copy of the pattern list, used to carry unsaved edits across the
   * re-renders triggered by adding, removing or restoring a pattern (the rendered
   * form is otherwise the single source of truth). Null until the first such edit.
   * @type {Array<{id: string, name: string, light: object}>|null}
   */
  #draftPatterns = null;

  /**
   * Index of the pattern currently receiving the live preview — the last one the
   * user interacted with. Defaults to the first pattern.
   * @type {number}
   */
  #activePatternIndex = 0;

  /**
   * Whether the live preview shows the active pattern's running-low look: true while
   * focus is inside its Running Low section, false anywhere else in the card.
   * @type {boolean}
   */
  #previewLow = false;

  /**
   * The folded sections that are open, as `${patternId}:${section}`, so a re-render
   * (adding, removing or restoring a pattern) does not fold them shut again.
   * @type {Set<string>}
   */
  #openSections = new Set();

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-light-editor`,
    classes: [MODULE_ID, "ls-light-editor", "standard-form"],
    tag: "form",
    window: {
      icon: "fa-solid fa-lightbulb",
      contentClasses: ["standard-form"],
      resizable: true
    },
    // A real height rather than "auto": the pattern stack is unbounded, so an
    // auto-height window grows past the viewport as patterns are added and takes
    // the Save footer with it. Fixed height + an internally scrolling list keeps
    // the footer pinned no matter how many patterns a source has.
    position: { width: 480, height: 760 },
    actions: {
      addPattern: this.prototype._onAddPattern,
      removePattern: this.prototype._onRemovePattern,
      restorePattern: this.prototype._onRestorePattern
    },
    form: {
      handler: this._onFormSubmit,
      submitOnChange: false,
      closeOnSubmit: true
    }
  };

  static PARTS = {
    form: { template: TEMPLATES.LIGHT_EDITOR }
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "patterns", icon: "fa-solid fa-lightbulb" },
        { id: "usage", icon: "fa-solid fa-hourglass-half" }
      ],
      initial: "patterns",
      labelPrefix: "LIGHTSOURCES.LightEditor.Tabs"
    }
  };

  /**
   * The light source definition currently being edited, re-read from the
   * world setting so the editor never works on stale data.
   * @returns {object|null} The source definition or null if it was deleted.
   */
  get source() {
    return getSources().find(s => s.id === this.options.sourceId) ?? null;
  }

  /**
   * Register the canvas selection hook and start previewing on whichever
   * Token is already controlled when the editor first opens.
   * Called once from `_onFirstRender` because the application frame persists
   * across re-renders and the hook must not be registered more than once.
   * @param {object} context The render context.
   * @param {object} options Render options.
   * @override
   */
  _onFirstRender(context, options) {
    super._onFirstRender(context, options);
    this.#controlTokenHookId = Hooks.on("controlToken", this.#onControlToken.bind(this));
    this.#setPreviewToken(canvas.tokens?.controlled[0] ?? null);
  }

  /**
   * Re-attach the per-render listeners. The form PART's markup (and therefore
   * every element below) is replaced on each render, so this wires up both the
   * range-preset <select>s and the per-pattern focus tracking that decides which
   * pattern the live preview reflects.
   * @param {object} context The render context.
   * @param {object} options Render options.
   * @override
   */
  _onRender(context, options) {
    super._onRender(context, options);

    // Sync each preset <select> (Dim/Bright radius, Duration) with its paired
    // number input: choosing a preset overwrites the input value, while typing
    // a value updates the select back to the matching preset (or "Custom" if it
    // matches none). The valid preset values are read from the select's own
    // <option>s, so this works for any preset list without hardcoding one.
    for ( const select of this.element.querySelectorAll(".ls-value-preset") ) {
      const input = this.element.querySelector(`[name="${select.dataset.target}"]`);
      if ( !input ) continue;
      select.addEventListener("change", () => {
        if ( select.value === "custom" ) return;
        input.value = select.value;
        input.dispatchEvent(new Event("change", { bubbles: true }));
      });
      input.addEventListener("input", () => {
        const hasPreset = Array.from(select.options).some(o => (o.value !== "custom") && (o.value === input.value));
        select.value = hasPreset ? input.value : "custom";
      });
    }

    for ( const details of this.element.querySelectorAll(".ls-pattern-section") ) {
      const key = `${details.dataset.patternId}:${details.dataset.section}`;
      details.addEventListener("toggle", () => {
        if ( details.open ) this.#openSections.add(key);
        else this.#openSections.delete(key);
      });
    }

    // The live preview reflects whichever pattern the user is editing, in the look
    // being edited: retarget it whenever focus enters a pattern card.
    for ( const card of this.element.querySelectorAll(".ls-pattern-card") ) {
      card.addEventListener("focusin", event => {
        this.#activePatternIndex = Number(card.dataset.patternIndex) || 0;
        this.#previewLow = !!event.target.closest('[data-section="ending"]');
        this.#applyPreviewLight();
      });
    }

    const fuelZone = this.element.querySelector(".ls-fuel-drop");
    fuelZone?.addEventListener("dragover", event => event.preventDefault());
    fuelZone?.addEventListener("drop", event => this.#onDropFuel(event, fuelZone));
  }

  /**
   * Take an Item dropped on the fuel row as the source's fuel. Only the hidden input and
   * the row's label change: re-rendering would throw away every other unsaved edit in the
   * form, and nothing is stored until the GM saves.
   * @param {DragEvent} event The drop event.
   * @param {HTMLElement} zone The fuel row's drop zone.
   * @returns {Promise<void>}
   */
  async #onDropFuel(event, zone) {
    event.preventDefault();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if ( data?.type !== "Item" ) return;
    const item = await foundry.utils.fromUuid(data.uuid);
    if ( !item ) return;
    // The lantern burning itself as fuel would spend the light it is lighting.
    if ( item.uuid === this.source?.uuid ) {
      ui.notifications.warn("LIGHTSOURCES.LightEditor.Fields.FuelIsSource", { localize: true });
      return;
    }
    zone.querySelector('input[name="fuelUuid"]').value = item.uuid;
    const img = document.createElement("img");
    img.src = item.img || DEFAULT_SOURCE_IMG;
    img.alt = "";
    const name = document.createElement("span");
    name.textContent = item.name;
    zone.querySelectorAll(":scope > :not(input)").forEach(el => el.remove());
    zone.append(img, " ", name);
  }

  /**
   * Restore the previewed Token's light and unregister the selection hook.
   * @param {object} options Close options.
   * @returns {Promise<void>}
   * @override
   */
  async _preClose(options) {
    await super._preClose(options);
    if ( this.#controlTokenHookId !== null ) {
      Hooks.off("controlToken", this.#controlTokenHookId);
      this.#controlTokenHookId = null;
    }
    this.#restorePreviewToken();
  }

  /**
   * Re-apply the live preview to the current form values whenever an input,
   * range-picker, color-picker or checkbox in the form changes.
   * @param {ApplicationFormConfiguration} formConfig The form configuration.
   * @param {Event} event The originating change event.
   * @override
   */
  _onChangeForm(formConfig, event) {
    super._onChangeForm(formConfig, event);
    // Toggling negative changes which animation types exist, so the <select>s have to
    // be rebuilt. Routed through the draft-pattern mechanism the add/remove/restore
    // actions already use, so the other patterns' unsaved edits survive the re-render.
    if ( event.target?.name?.endsWith(".light.negative") ) {
      this.#draftPatterns = this.#readFormPatterns();
      // Not awaited (the override is synchronous), but the preview still has to catch
      // up with the new kind of source rather than wait for the next interaction.
      this.render().then(() => this.#applyPreviewLight());
      return;
    }
    // Toggled in place rather than re-rendered, so values typed before switching a
    // section off are still there if it is switched back on.
    const name = event.target?.name ?? "";
    if ( name.endsWith(".light.advancedEnabled") || name.endsWith(".light.endingEnabled") ) {
      const fieldset = event.target.closest(".ls-pattern-section")?.querySelector(".ls-section-fields");
      if ( fieldset ) fieldset.disabled = !event.target.checked;
    }
    this.#applyPreviewLight();
  }

  /**
   * Retarget the live preview whenever the canvas Token selection changes
   * while this editor remains open.
   */
  #onControlToken() {
    this.#setPreviewToken(canvas.tokens?.controlled[0] ?? null);
  }

  /**
   * Switch the Token receiving the live light preview, restoring the light of
   * any previously previewed Token first.
   * @param {Token|null} token The newly selected Token, or null if none is controlled.
   */
  #setPreviewToken(token) {
    token ??= null;
    if ( token === this.#previewToken ) return;
    this.#restorePreviewToken();
    this.#previewToken = token;
    if ( !this.#previewToken ) return;
    this.#previewOriginalLight = this.#previewToken.document.toObject().light;
    this.#applyPreviewLight();
  }

  /**
   * Restore the previewed Token's original light and clear the preview state.
   */
  #restorePreviewToken() {
    if ( this.#previewToken && !this.#previewToken.destroyed ) {
      this.#previewToken.document.updateSource({ light: this.#previewOriginalLight });
      this.#previewToken.initializeLightSource();
    }
    this.#previewToken = null;
    this.#previewOriginalLight = null;
  }

  /**
   * Read the current (unsaved) form values for the actively edited pattern and
   * apply them to the previewed Token's light source, without persisting.
   */
  #applyPreviewLight() {
    if ( !this.#previewToken || this.#previewToken.destroyed ) return;
    const patterns = this.#readFormPatterns();
    const pattern = patterns[this.#activePatternIndex] ?? patterns[0];
    if ( !pattern ) return;
    const light = buildLightData(patternForPhase(pattern, this.#previewLow));
    // `updateSource` merges, so advanced values an earlier preview wrote would linger
    // once the pattern stops setting them: put the token's own back instead.
    if ( !pattern.light.advanced ) {
      for ( const key of ADVANCED_LIGHT_KEYS ) light[key] = this.#previewOriginalLight[key];
    }
    this.#previewToken.document.updateSource({ light });
    this.#previewToken.initializeLightSource();
  }

  /**
   * Read every pattern from the current form state, sanitized into the stored
   * pattern shape. The form is the source of truth for unsaved edits, so this
   * backs both the live preview and the add/remove/restore pattern actions.
   * @returns {Array<{id: string, name: string, light: object}>} The patterns (see
   *   `#patternsFromData`).
   */
  #readFormPatterns() {
    const formData = new foundry.applications.ux.FormDataExtended(this.form);
    return this.#patternsFromData(foundry.utils.expandObject(formData.object));
  }

  /**
   * Convert expanded form data into a sanitized pattern array. `expandObject`
   * turns the indexed `patterns.<i>.*` field names into an object keyed by index
   * (not a true array), so entries are re-sorted by their numeric index.
   * @param {object} data Expanded form data (see foundry.utils.expandObject).
   * @returns {Array<{id: string, name: string, light: object}>} The patterns.
   */
  #patternsFromData(data) {
    const raw = data.patterns ?? {};
    const entries = Array.isArray(raw)
      ? raw.map((value, index) => [index, value])
      : Object.entries(raw);
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      // The id travels in a hidden field, so a renamed pattern keeps it: a registered
      // pattern's id is the one its module gave it, whatever the GM calls it now.
      .map(([, p]) => ({
        id: p.id || foundry.utils.randomID(),
        name: (p.name ?? "").trim(),
        light: this.#buildLightPatch(p)
      }));
  }

  /**
   * Sanitize a single pattern's raw form values into a light pattern object, in
   * the same shape as a stored pattern's `light` field. Shared by the persisted
   * form submission, the live canvas preview and the add/remove actions so they
   * always agree on the same clamped/defaulted values.
   * @param {object} data A single pattern's expanded form data ({name, light}).
   * @returns {object} A light pattern object ready to store on a pattern.
   */
  #buildLightPatch(data) {
    const angle = Number(data.light?.angle);
    const negative = !!data.light?.negative;
    // A darkness pattern has no advanced section (core disables those options for
    // darkness), so it never keeps any.
    const advanced = (data.light?.advancedEnabled && !negative)
      ? Object.fromEntries(ADVANCED_LIGHT_KEYS.map(key => {
        const field = foundry.documents.TokenDocument.schema.fields.light.fields[key];
        const value = Number(data.light.advanced?.[key]);
        return [key, Number.isFinite(value) ? Math.clamp(value, field.min ?? -Infinity, field.max ?? Infinity) : field.getInitialValue()];
      }))
      : null;
    return {
      ...sanitizeBasic(data.light),
      negative,
      angle: Math.clamp(Number.isFinite(angle) && (angle > 0) ? angle : 360, 5, 360),
      advanced,
      ending: data.light?.endingEnabled ? sanitizeBasic(data.light.ending) : null
    };
  }

  /** @override */
  get title() {
    return game.i18n.format("LIGHTSOURCES.LightEditor.Title", { name: this.source?.name ?? "" });
  }

  /**
   * Build the render context: the edited source, its patterns (with per-pattern
   * range-preset and animation-type options), the tab state and the duration
   * modes. Unsaved edits carried in `#draftPatterns` win over the stored source.
   * @param {object} options Render options.
   * @returns {Promise<object>} The template context.
   * @override
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const source = this.source
      ?? { patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))], consume: CONSUME_MODES.NONE, coverable: false, droppable: true, durationMode: DURATION_MODES.WORLD, durationMinutes: 0, endingMinutes: 0 };
    const patterns = this.#draftPatterns ?? source.patterns;
    const registered = getRegisteredSource(this.options.sourceId);
    context.source = source;
    // `strict: false`: a fuel from a pack that is not available here keeps the fallback icon.
    context.fuelImg = (source.fuel && foundry.utils.fromUuidSync(source.fuel.uuid, { strict: false })?.img) || DEFAULT_SOURCE_IMG;
    // Only a name-only source the GM made can be renamed: an Item-backed source takes its
    // name from the Item, and a registered one from the module that registers it.
    context.renamable = !!source.id && !source.uuid && !registered;
    context.tabs = this._prepareTabs("primary");
    // The advanced inputs are rendered from core's own token light fields, so their
    // labels, hints and bounds are core's. Taken from TokenDocument rather than a bare
    // LightData, whose schema core never localizes (its labels come out blank).
    context.advancedFields = foundry.documents.TokenDocument.schema.fields.light.fields;
    context.colorationTechniques = foundry.canvas.rendering.shaders.AdaptiveLightingShader.SHADER_TECHNIQUES;
    // A source must keep at least one pattern; hide the remove control otherwise.
    context.canRemove = patterns.length > 1;
    context.patterns = patterns.map((pattern, index) => {
      const { dim, bright, color, alpha, animation } = pattern.light;
      // Off, the section starts from the pattern's own look, so ticking the box begins
      // from what the light already is rather than from blanks.
      const ending = pattern.light.ending ?? { dim, bright, color, alpha, animation };
      return {
        id: pattern.id,
        name: pattern.name,
        index,
        // Handlebars has no arithmetic helper, so the 1-based badge label is
        // precomputed here rather than derived in the template.
        number: index + 1,
        light: pattern.light,
        // Only a pattern a module registers has a default to fall back to; one the GM
        // added by hand has none.
        canRestore: !!registered?.patterns.some(p => p.id === pattern.id),
        advancedEnabled: !!pattern.light.advanced,
        advancedOpen: this.#openSections.has(`${pattern.id}:advanced`),
        // Left undefined while off, so each input shows core's default for its field.
        advanced: pattern.light.advanced ?? {},
        endingEnabled: !!pattern.light.ending,
        endingOpen: this.#openSections.has(`${pattern.id}:ending`),
        ending,
        dimPresets: this.#buildPresetOptions(pattern.light.dim, RANGE_PRESETS),
        brightPresets: this.#buildPresetOptions(pattern.light.bright, RANGE_PRESETS),
        animationTypes: this.#buildAnimationOptions(pattern.light.animation?.type, pattern.light.negative),
        endingDimPresets: this.#buildPresetOptions(ending.dim, RANGE_PRESETS),
        endingBrightPresets: this.#buildPresetOptions(ending.bright, RANGE_PRESETS),
        // The running-low look draws from the same set as the full one: a darkness
        // pattern fades as darkness.
        endingAnimationTypes: this.#buildAnimationOptions(ending.animation?.type, pattern.light.negative)
      };
    });
    const mode = source.durationMode === DURATION_MODES.REAL ? DURATION_MODES.REAL : DURATION_MODES.WORLD;
    context.durationModes = [
      { value: DURATION_MODES.WORLD, label: "LIGHTSOURCES.LightEditor.Fields.DurationModeWorld", selected: mode === DURATION_MODES.WORLD },
      { value: DURATION_MODES.REAL, label: "LIGHTSOURCES.LightEditor.Fields.DurationModeReal", selected: mode === DURATION_MODES.REAL }
    ];
    context.consumeModes = Object.values(CONSUME_MODES).map(value => ({
      value, label: `LIGHTSOURCES.LightEditor.Fields.ConsumeModes.${value}`, selected: source.consume === value
    }));
    context.durationPresets = this.#buildPresetOptions(source.durationMinutes, DURATION_PRESETS);
    context.endingPresets = this.#buildPresetOptions(source.endingMinutes, DURATION_PRESETS);
    return context;
  }

  /**
   * Build the animation-type <select> options for a pattern, with the entry
   * matching the pattern's current animation marked selected, sorted by label.
   *
   * Darkness and light draw from two disjoint animation sets — core itself swaps
   * between them (see `CONFIG.Canvas.darknessAnimations`), and a type from the wrong
   * set resolves to an empty animation config and simply renders static. Offering the
   * right list is therefore the only thing keeping a negative pattern's animation
   * meaningful; flipping a pattern to negative drops whatever type it had.
   * @param {string} selectedType The pattern's current animation type key.
   * @param {boolean} negative Whether the pattern sheds darkness rather than light.
   * @returns {Array<{value: string, label: string, selected: boolean}>} The option list.
   */
  #buildAnimationOptions(selectedType, negative) {
    const animations = negative ? CONFIG.Canvas.darknessAnimations : CONFIG.Canvas.lightAnimations;
    return Object.entries(animations)
      .map(([value, cfg]) => ({ value, label: game.i18n.localize(cfg.label), selected: value === selectedType }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  /**
   * Build a quick-preset <select> options list for a numeric field: a "Custom"
   * entry plus one per given preset value (labeled with the value itself),
   * with the entry matching the current value (if any) marked selected.
   * Shared by the Dim/Bright radius presets and the Duration preset.
   * @param {number} value The current field value.
   * @param {number[]} presets The preset values to offer.
   * @returns {Array<{value: string, label: string, selected: boolean}>} The option list.
   */
  #buildPresetOptions(value, presets) {
    const match = presets.find(p => p === value);
    return [
      { value: "custom", label: game.i18n.localize("LIGHTSOURCES.LightEditor.Fields.RangeCustom"), selected: match === undefined },
      ...presets.map(p => ({
        value: String(p),
        label: String(p),
        selected: p === match
      }))
    ];
  }

  /**
   * Append a new default pattern, preserving the current form edits, and focus
   * the preview on it. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onAddPattern(event, target) {
    const patterns = this.#readFormPatterns();
    patterns.push(makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.New")));
    this.#draftPatterns = patterns;
    this.#activePatternIndex = patterns.length - 1;
    await this.render();
  }

  /**
   * Remove the clicked pattern, preserving the other patterns' current form
   * edits. A source must keep at least one pattern, so this is a no-op when only
   * one remains. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onRemovePattern(event, target) {
    const index = Number(target.closest("[data-pattern-index]")?.dataset.patternIndex);
    const patterns = this.#readFormPatterns();
    if ( !Number.isInteger(index) || (patterns.length <= 1) ) return;
    patterns.splice(index, 1);
    this.#draftPatterns = patterns;
    this.#activePatternIndex = Math.min(this.#activePatternIndex, patterns.length - 1);
    await this.render();
  }

  /**
   * Revert the clicked pattern to the light its managing module registered,
   * preserving every other pattern's current form edits. Like adding and removing
   * a pattern, this only rewrites the form — nothing is persisted until the GM
   * saves. Declared in DEFAULT_OPTIONS.actions.
   * @param {PointerEvent} event The originating click event.
   * @param {HTMLElement} target The element bearing the data-action.
   * @returns {Promise<void>}
   */
  async _onRestorePattern(event, target) {
    const index = Number(target.closest("[data-pattern-index]")?.dataset.patternIndex);
    const patterns = this.#readFormPatterns();
    const pattern = patterns[index];
    const original = getRegisteredSource(this.options.sourceId)?.patterns.find(p => p.id === pattern?.id);
    if ( !original ) return;
    pattern.name = original.name;
    pattern.light = original.light;
    this.#draftPatterns = patterns;
    this.#activePatternIndex = index;
    await this.render();
    // The restored values are the point of the click: show them on the previewed
    // token straight away rather than waiting for the next form interaction.
    this.#applyPreviewLight();
  }

  /**
   * Form submission handler: sanitize the submitted values, write them back
   * into the world setting and refresh the parent configuration app.
   * Called by ApplicationV2 with `this` bound to the application instance.
   * @param {SubmitEvent} event The originating submit event.
   * @param {HTMLFormElement} form The form element.
   * @param {foundry.applications.ux.FormDataExtended} formData The processed form data.
   * @returns {Promise<void>}
   */
  static async _onFormSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const patterns = this.#patternsFromData(data);
    const registered = getRegisteredSource(this.options.sourceId);
    // For a name-only source the name is its only match rule, so renaming it changes which
    // items count as this light.
    const current = this.source;
    const name = (current && !current.uuid && !registered) ? String(data.sourceName ?? "").trim() : "";
    if ( name && getSources().some(s => (s.id !== current.id) && (s.name === name)) ) {
      // Thrown, not warned: ApplicationV2#_onSubmitForm catches it, notifies, and skips
      // closeOnSubmit, so the GM keeps every other edit in the open form.
      throw new Error(game.i18n.format("LIGHTSOURCES.Config.Duplicate", { name }));
    }
    const consume = Object.values(CONSUME_MODES).includes(data.consume) ? data.consume : CONSUME_MODES.NONE;
    // A fuel source with no fuel could never be lit. Kept as stored unless another Item was
    // dropped, so a fuel whose Item is gone still matches by its stored name and type.
    let fuel = null;
    if ( consume === CONSUME_MODES.FUEL ) {
      const uuid = String(data.fuelUuid ?? "");
      if ( !uuid ) throw new Error(game.i18n.localize("LIGHTSOURCES.LightEditor.Fields.FuelMissing"));
      if ( uuid === current?.fuel?.uuid ) fuel = current.fuel;
      else {
        const item = await foundry.utils.fromUuid(uuid);
        if ( !item ) throw new Error(game.i18n.localize("LIGHTSOURCES.LightEditor.Fields.FuelMissing"));
        fuel = { uuid: item.uuid, name: item.name, type: item.type };
      }
    }

    // Saving a source a module registers stores the GM's own copy, which replaces the
    // registered values until it is restored (see `_onRestoreDefault` in
    // light-sources-config.js).
    await editSource(this.options.sourceId, source => {
      if ( name ) source.name = name;
      source.consume = consume;
      source.fuel = fuel;
      source.coverable = !!data.coverable;
      source.droppable = !!data.droppable;
      source.durationMode = data.durationMode === DURATION_MODES.REAL ? DURATION_MODES.REAL : DURATION_MODES.WORLD;
      source.durationMinutes = Math.max(0, Math.round(Number(data.durationMinutes) || 0));
      source.endingMinutes = Math.max(0, Math.round(Number(data.endingMinutes) || 0));
      source.patterns = patterns;
      // A registered pattern the GM deleted must stay deleted, rather than come back
      // as one the module added since.
      const kept = new Set(patterns.map(p => p.id));
      source.removedPatterns = (registered?.patterns ?? []).map(p => p.id).filter(id => !kept.has(id));
    });
    // Lights already burning adopt the edited looks and threshold now rather than on
    // the next tick. A no-op on any client but the active GM's.
    await sweepLights().catch(err => console.error(`${MODULE_ID} | Light sweep after saving a source failed`, err));
    this.options.configApp?.render();
  }
}
