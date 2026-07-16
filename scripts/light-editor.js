/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, TEMPLATES, DEFAULT_LIGHT, DURATION_MODES, RANGE_PRESETS, DURATION_PRESETS } from "./constants.js";
import { getSources, setSources, makePattern } from "./helpers.js";
import { buildLightData } from "./light-manager.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Editor for a single registered light source. A source owns one or more light
 * patterns ("stages" — e.g. a flashlight's wide-short beam vs. narrow-long beam);
 * each pattern exposes only the basic light configuration and the light animation
 * (advanced light options are intentionally not editable). Consumption and
 * duration are configured once and shared across all of the source's patterns.
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
   * @type {Array<{id: string, name: string, light: object, moduleName: (string|undefined), moduleLight: (object|undefined)}>|null}
   */
  #draftPatterns = null;

  /**
   * Index of the pattern currently receiving the live preview — the last one the
   * user interacted with. Defaults to the first pattern.
   * @type {number}
   */
  #activePatternIndex = 0;

  static DEFAULT_OPTIONS = {
    id: `${MODULE_ID}-light-editor`,
    classes: [MODULE_ID, "ls-light-editor", "standard-form"],
    tag: "form",
    window: {
      icon: "fa-solid fa-lightbulb",
      contentClasses: ["standard-form"]
    },
    position: { width: 480, height: "auto" },
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

    // The live preview reflects whichever pattern the user is editing: retarget
    // it whenever focus enters a pattern card.
    for ( const card of this.element.querySelectorAll(".ls-pattern-card") ) {
      card.addEventListener("focusin", () => {
        this.#activePatternIndex = Number(card.dataset.patternIndex) || 0;
        this.#applyPreviewLight();
      });
    }
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
    const light = buildLightData(pattern);
    this.#previewToken.document.updateSource({ light });
    this.#previewToken.initializeLightSource();
  }

  /**
   * Read every pattern from the current form state, sanitized into the stored
   * pattern shape. The form is the source of truth for unsaved edits, so this
   * backs both the live preview and the add/remove/restore pattern actions.
   * @returns {Array<{id: string, name: string, light: object, moduleName: (string|undefined), moduleLight: (object|undefined)}>}
   *   The patterns (see `#patternsFromData`).
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
   * @returns {Array<{id: string, name: string, light: object, moduleName: (string|undefined), moduleLight: (object|undefined)}>}
   *   The patterns, each carrying its module default snapshot when it has one.
   */
  #patternsFromData(data) {
    const stored = this.source?.patterns ?? [];
    const raw = data.patterns ?? {};
    const entries = Array.isArray(raw)
      ? raw.map((value, index) => [index, value])
      : Object.entries(raw);
    return entries
      .sort((a, b) => Number(a[0]) - Number(b[0]))
      .map(([, p]) => {
        const pattern = {
          id: p.id || foundry.utils.randomID(),
          name: (p.name ?? "").trim(),
          light: this.#buildLightPatch(p)
        };
        // A registered pattern's module snapshot has no form field of its own, so
        // it has to be carried across explicitly or a plain save would strip it
        // and silently break "restore to module default". Matched on id, never on
        // name: renaming a pattern is exactly what the form may have just done.
        const previous = stored.find(sp => sp.id === pattern.id);
        if ( previous?.moduleLight ) Object.assign(pattern, {
          moduleName: previous.moduleName,
          moduleLight: previous.moduleLight
        });
        return pattern;
      });
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
    const alpha = Number(data.light?.alpha);
    const angle = Number(data.light?.angle);
    const anim = data.light?.animation ?? {};
    return {
      dim: Math.max(0, Number(data.light?.dim) || 0),
      bright: Math.max(0, Number(data.light?.bright) || 0),
      angle: Math.clamp(Number.isFinite(angle) && (angle > 0) ? angle : 360, 5, 360),
      color: data.light?.color || "",
      alpha: Math.clamp(Number.isFinite(alpha) ? alpha : 0.5, 0, 1),
      animation: {
        type: anim.type || "",
        speed: Math.clamp(Number(anim.speed) || 5, 1, 10),
        intensity: Math.clamp(Number(anim.intensity) || 5, 1, 10),
        reverse: !!anim.reverse
      }
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
      ?? { patterns: [makePattern(DEFAULT_LIGHT, game.i18n.localize("LIGHTSOURCES.Patterns.Standard"))], consume: false, durationMode: DURATION_MODES.WORLD, durationMinutes: 0 };
    const patterns = this.#draftPatterns ?? source.patterns;
    context.source = source;
    context.tabs = this._prepareTabs("primary");
    // A source must keep at least one pattern; hide the remove control otherwise.
    context.canRemove = patterns.length > 1;
    context.patterns = patterns.map((pattern, index) => ({
      id: pattern.id,
      name: pattern.name,
      index,
      light: pattern.light,
      // Only a pattern a module registered has a default to fall back to; one the
      // GM added by hand carries no snapshot.
      canRestore: !!pattern.moduleLight,
      dimPresets: this.#buildPresetOptions(pattern.light.dim, RANGE_PRESETS),
      brightPresets: this.#buildPresetOptions(pattern.light.bright, RANGE_PRESETS),
      animationTypes: this.#buildAnimationOptions(pattern.light.animation?.type)
    }));
    const mode = source.durationMode === DURATION_MODES.REAL ? DURATION_MODES.REAL : DURATION_MODES.WORLD;
    context.durationModes = [
      { value: DURATION_MODES.WORLD, label: "LIGHTSOURCES.LightEditor.Fields.DurationModeWorld", selected: mode === DURATION_MODES.WORLD },
      { value: DURATION_MODES.REAL, label: "LIGHTSOURCES.LightEditor.Fields.DurationModeReal", selected: mode === DURATION_MODES.REAL }
    ];
    context.durationPresets = this.#buildPresetOptions(source.durationMinutes, DURATION_PRESETS);
    return context;
  }

  /**
   * Build the animation-type <select> options for a pattern, with the entry
   * matching the pattern's current animation marked selected, sorted by label.
   * @param {string} selectedType The pattern's current animation type key.
   * @returns {Array<{value: string, label: string, selected: boolean}>} The option list.
   */
  #buildAnimationOptions(selectedType) {
    return Object.entries(CONFIG.Canvas.lightAnimations)
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
    if ( !pattern?.moduleLight ) return;
    pattern.name = pattern.moduleName;
    pattern.light = foundry.utils.deepClone(pattern.moduleLight);
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
    const sources = getSources();
    const source = sources.find(s => s.id === this.options.sourceId);
    if ( !source ) return;

    source.consume = !!data.consume;
    source.durationMode = data.durationMode === DURATION_MODES.REAL ? DURATION_MODES.REAL : DURATION_MODES.WORLD;
    source.durationMinutes = Math.max(0, Math.round(Number(data.durationMinutes) || 0));
    source.patterns = this.#patternsFromData(data);
    // Freeze the source so the next registerSources call stops overwriting these
    // values; only an explicit restore (see `_onRestoreDefault` in
    // light-sources-config.js) hands control back to the module. Keyed on the
    // snapshot, not on `managedBy`: the latter is an optional cosmetic stamp, so
    // a module that omits it must still not lose the GM's work.
    if ( source.moduleDefaults ) source.customized = true;

    await setSources(sources);
    this.options.configApp?.render();
  }
}
