/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, FLAGS } from "./constants.js";
import { isWithinReach } from "./helpers.js";
import { toggleAmbientLight } from "./light-manager.js";

/**
 * The container holding one control icon per interactive light on the current scene,
 * parented to the controls layer alongside core's own door controls. Rebuilt from
 * scratch on every canvas draw (see `onCanvasReady`).
 * @type {PIXI.Container|null}
 */
let layer = null;

/**
 * The control icon currently drawn for each interactive AmbientLight, keyed by the
 * light's id.
 * @type {Map<string, LightControl>}
 */
const controls = new Map();

/**
 * A clickable icon on the map that switches an AmbientLight on and off, so a player
 * can snuff a torch in a corridor the way they open a door.
 *
 * Core has no such affordance for lights: `AmbientLight#_canHUD` is gated on the
 * lighting layer being active *and* the user being a GM, and the placeable's own
 * control icon lives on a layer players never activate. So this is modelled directly
 * on core's `DoorControl` — the same 44px rounded plate, the same hover treatment,
 * the same `eventMode`/`hitArea` setup — and parented to the same controls layer, so
 * it behaves like a door control because it is built like one.
 *
 * It parts ways with doors on reach. Core doors have no distance rule at all: a
 * DoorControl is clickable from across the room as long as it is in line of sight.
 * A light must actually be reached, so visibility follows the door rule while the
 * click additionally requires an adjacent (or co-located) controlled token.
 */
class LightControl extends PIXI.Container {
  /**
   * @param {AmbientLightDocument} light The light this control switches.
   */
  constructor(light) {
    super();
    this.light = light;
    this.visible = false;
    /**
     * The on/off icon textures, resolved once in `draw` so `refresh` can swap
     * between them synchronously.
     * @type {{on: PIXI.Texture, off: PIXI.Texture}|null}
     */
    this.textures = null;
  }

  /* -------------------------------------------- */

  /**
   * The point on the canvas this control sits over — the light's own anchor.
   * @type {{x: number, y: number}}
   */
  get center() {
    return { x: this.light.x, y: this.light.y };
  }

  /* -------------------------------------------- */

  /**
   * Whether this control is visible from the current user's perspective, following
   * core's door rule: anything goes when the scene has no token vision, otherwise the
   * light's position must be visible.
   *
   * This is what keeps a light that is switched off from being a free beacon in the
   * dark — an unlit torch across an unexplored room is not visible, so its control is
   * not there to click. Walk up with another light and it appears.
   * @type {boolean}
   */
  get isVisible() {
    if ( !this.light.getFlag(MODULE_ID, FLAGS.INTERACTIVE) ) return false;
    if ( !canvas.visibility.tokenVision ) return true;
    return canvas.visibility.testVisibility(this.center, { object: this, tolerance: 0 });
  }

  /* -------------------------------------------- */

  /**
   * Whether the user can actually work this light right now: a controlled token has
   * to be standing on it or beside it. GMs are exempt — they are not playing a
   * character, and can already switch any light from the lighting layer.
   * @type {boolean}
   */
  get isReachable() {
    if ( game.user.isGM ) return true;
    const point = this.center;
    return (canvas.tokens?.controlled ?? []).some(token => isWithinReach(token, point));
  }

  /* -------------------------------------------- */

  /**
   * Draw the control's plate, icon and border, and wire up its interactivity.
   * @returns {Promise<LightControl>} This control, drawn.
   */
  async draw() {
    const s = canvas.dimensions.uiScale;
    const icons = CONFIG.controlIcons;
    this.textures ??= {
      on: await foundry.canvas.loadTexture(icons.light),
      off: await foundry.canvas.loadTexture(icons.lightOff)
    };

    this.bg ??= this.addChild(new PIXI.Graphics());
    this.bg.clear().beginFill(0x000000, 1.0).drawRoundedRect(-2 * s, -2 * s, 44 * s, 44 * s, 5 * s).endFill();
    this.bg.alpha = 0;

    this.icon ??= this.addChild(new PIXI.Sprite());
    this.icon.width = this.icon.height = 40 * s;

    this.border ??= this.addChild(new PIXI.Graphics());
    this.border.clear().lineStyle(s, 0xFF5500, 0.8).drawRoundedRect(-2 * s, -2 * s, 44 * s, 44 * s, 5 * s);
    this.border.visible = false;

    // Events land on the container itself, never on the sprites inside it.
    this.eventMode = "static";
    this.interactiveChildren = false;
    this.hitArea = new PIXI.Rectangle(-2 * s, -2 * s, 44 * s, 44 * s);

    this.reposition();
    this.refresh();

    this.removeAllListeners();
    this.on("pointerover", this.#onPointerOver)
      .on("pointerout", this.#onPointerOut)
      .on("pointerdown", this.#onPointerDown);
    return this;
  }

  /* -------------------------------------------- */

  /**
   * Move the control back over its light, centring the 40px icon on the light's anchor.
   * @returns {void}
   */
  reposition() {
    const s = canvas.dimensions.uiScale;
    const { x, y } = this.center;
    this.position.set(x - (20 * s), y - (20 * s));
  }

  /* -------------------------------------------- */

  /**
   * Bring the control up to date with the light's state and the user's position:
   * whether it shows at all, which icon it shows, and whether it currently looks
   * within reach. Cheap enough to call on every vision refresh and token move.
   * @returns {void}
   */
  refresh() {
    this.visible = this.isVisible;
    if ( !this.visible ) return;
    if ( this.textures ) this.icon.texture = this.light.hidden ? this.textures.off : this.textures.on;

    // Out of reach still shows — the player should see there is something to walk up
    // to — but faded, and without the pointer cursor promising a click that won't work.
    const reachable = this.isReachable;
    this.icon.alpha = reachable ? 0.8 : 0.3;
    this.cursor = reachable ? "pointer" : null;
  }

  /* -------------------------------------------- */
  /*  Event Handlers                              */
  /* -------------------------------------------- */

  /**
   * Highlight the control on hover, matching core's door controls.
   * @param {PIXI.FederatedEvent} event The originating interaction event.
   * @returns {void}
   */
  #onPointerOver(event) {
    if ( event.nativeEvent && (event.nativeEvent.target.id !== canvas.app.view.id) ) return;
    event.stopPropagation();
    if ( game.paused && !game.user.isGM ) return;
    this.border.visible = true;
    this.bg.alpha = 0.25;
    if ( this.isReachable ) this.icon.alpha = 1.0;
  }

  /* -------------------------------------------- */

  /**
   * Drop the hover highlight.
   * @param {PIXI.FederatedEvent} event The originating interaction event.
   * @returns {void}
   */
  #onPointerOut(event) {
    if ( event.nativeEvent && (event.nativeEvent.target.id !== canvas.app.view.id) ) return;
    event.stopPropagation();
    this.border.visible = false;
    this.bg.alpha = 0;
    this.icon.alpha = this.isReachable ? 0.8 : 0.3;
  }

  /* -------------------------------------------- */

  /**
   * Switch the light on left click, provided the user is close enough to touch it.
   * @param {PIXI.FederatedEvent} event The originating interaction event.
   * @returns {void}
   */
  #onPointerDown(event) {
    if ( event.button !== 0 ) return; // Left click only, like a door
    event.stopPropagation();

    if ( game.paused && !game.user.isGM ) {
      ui.notifications.warn("GAME.PausedWarning", { localize: true });
      return;
    }
    // Checked here rather than trusted from the last refresh: the token may have
    // moved since, and this is the check that actually enforces the rule.
    if ( !this.isReachable ) {
      ui.notifications.warn(game.i18n.localize("LIGHTSOURCES.Interactive.OutOfReach"));
      return;
    }

    toggleAmbientLight(this.light)
      .catch(err => console.error(`${MODULE_ID} | Failed to switch light`, err));
  }
}

/* -------------------------------------------- */
/*  Layer Management                            */
/* -------------------------------------------- */

/**
 * Register the interactive-light hooks.
 * @returns {void}
 */
export function registerInteractiveLightHooks() {
  Hooks.on("canvasReady", onCanvasReady);
  Hooks.on("createAmbientLight", onCreateAmbientLight);
  Hooks.on("updateAmbientLight", onUpdateAmbientLight);
  Hooks.on("deleteAmbientLight", onDeleteAmbientLight);

  // Core repaints its own door controls from the same hook, for the same reason:
  // it fires whenever what the user can see changes.
  Hooks.on("sightRefresh", refreshControls);

  // Reach depends on where the controlled token is, which vision alone does not
  // track — a scene with token vision off never refreshes sight on movement.
  Hooks.on("controlToken", refreshControls);
  Hooks.on("updateToken", onUpdateToken);

  Hooks.on("renderAmbientLightConfig", injectInteractiveField);
}

/* -------------------------------------------- */

/**
 * Build the control layer and its icons for the scene that was just drawn.
 *
 * Rebuilt wholesale rather than reused: `ControlsLayer#_tearDown` only clears the
 * children it created itself, so a container of ours left behind would survive a
 * scene change holding icons for lights that are no longer there.
 * @returns {Promise<void>}
 */
async function onCanvasReady() {
  controls.clear();
  layer = null;
  if ( !canvas.controls ) return;

  layer = canvas.controls.addChild(new PIXI.Container());
  layer.eventMode = "passive";
  for ( const light of (canvas.scene?.lights ?? []) ) await addControl(light);
}

/* -------------------------------------------- */

/**
 * Add a control for a light, if it is one players may work.
 * @param {AmbientLightDocument} light The light to add a control for.
 * @returns {Promise<void>}
 */
async function addControl(light) {
  if ( !layer || !light.getFlag(MODULE_ID, FLAGS.INTERACTIVE) ) return;
  if ( controls.has(light.id) ) return;
  const control = layer.addChild(new LightControl(light));
  controls.set(light.id, control);
  await control.draw();
}

/* -------------------------------------------- */

/**
 * Remove and destroy the control for a light, if it has one.
 * @param {string} lightId The id of the light whose control is removed.
 * @returns {void}
 */
function removeControl(lightId) {
  const control = controls.get(lightId);
  if ( !control ) return;
  controls.delete(lightId);
  control.removeAllListeners();
  control.destroy({ children: true });
}

/* -------------------------------------------- */

/**
 * Bring every control up to date. Called whenever what the user can see or reach
 * may have changed.
 * @returns {void}
 */
function refreshControls() {
  for ( const control of controls.values() ) control.refresh();
}

/* -------------------------------------------- */

/**
 * Draw a control for a light that was just created on the active scene.
 * @param {AmbientLightDocument} light The created light.
 * @returns {void}
 */
function onCreateAmbientLight(light) {
  if ( light.parent !== canvas.scene ) return;
  addControl(light).catch(err => console.error(`${MODULE_ID} | Failed to draw light control`, err));
}

/* -------------------------------------------- */

/**
 * Keep a light's control in step with the light itself: added or removed when the GM
 * flips the interactive option, moved when the light moves, and repainted when it is
 * switched on or off.
 * @param {AmbientLightDocument} light The updated light.
 * @param {object} changed The differential update data.
 * @returns {void}
 */
function onUpdateAmbientLight(light, changed) {
  if ( light.parent !== canvas.scene ) return;

  const interactive = !!light.getFlag(MODULE_ID, FLAGS.INTERACTIVE);
  const control = controls.get(light.id);
  if ( interactive && !control ) {
    addControl(light).catch(err => console.error(`${MODULE_ID} | Failed to draw light control`, err));
    return;
  }
  if ( !interactive ) {
    if ( control ) removeControl(light.id);
    return;
  }

  if ( ("x" in changed) || ("y" in changed) ) control.reposition();
  control.refresh();
}

/* -------------------------------------------- */

/**
 * Drop the control of a light that was deleted.
 * @param {AmbientLightDocument} light The deleted light.
 * @returns {void}
 */
function onDeleteAmbientLight(light) {
  if ( light.parent !== canvas.scene ) return;
  removeControl(light.id);
}

/* -------------------------------------------- */

/**
 * Re-evaluate reach after a token moves. Only movement matters here — every other
 * token change leaves the distances alone.
 * @param {TokenDocument} token The updated token.
 * @param {object} changed The differential update data.
 * @returns {void}
 */
function onUpdateToken(token, changed) {
  if ( ("x" in changed) || ("y" in changed) ) refreshControls();
}

/* -------------------------------------------- */
/*  Light Configuration                         */
/* -------------------------------------------- */

/**
 * Add the "players may switch this light" checkbox to the bottom of the native light
 * config's Basic tab, so the GM decides light by light which ones the party can work.
 *
 * The field is injected into the existing form rather than added through a template
 * override, and needs nothing else to persist: `DocumentSheetV2` builds its update
 * from `expandObject` over the whole form with no schema allowlist, so a `flags.`
 * input is submitted like any native field. It carries no `value` attribute on
 * purpose — that is what makes `FormDataExtended` read it as a plain boolean, so
 * clearing the box actually writes `false` instead of submitting nothing.
 *
 * Deliberately unstyled and unscoped: borrowing core's own `fieldset`/`form-group`
 * markup makes it look like part of the sheet, which is the point.
 * @param {foundry.applications.sheets.AmbientLightConfig} app The rendered config app.
 * @param {HTMLElement} element The application's root element.
 * @returns {void}
 */
function injectInteractiveField(app, element) {
  const tab = element.querySelector('section[data-tab="basic"]');
  // Fires on every render, including partial ones, so never inject twice.
  if ( !tab || tab.querySelector(".ls-interactive-field") ) return;

  const fieldset = document.createElement("fieldset");
  fieldset.classList.add("ls-interactive-field");

  const legend = document.createElement("legend");
  legend.textContent = game.i18n.localize("LIGHTSOURCES.Interactive.Legend");

  const group = document.createElement("div");
  group.classList.add("form-group");

  const label = document.createElement("label");
  label.textContent = game.i18n.localize("LIGHTSOURCES.Interactive.Label");

  const fields = document.createElement("div");
  fields.classList.add("form-fields");

  const input = document.createElement("input");
  input.type = "checkbox";
  input.name = `flags.${MODULE_ID}.${FLAGS.INTERACTIVE}`;
  input.checked = !!app.document?.getFlag(MODULE_ID, FLAGS.INTERACTIVE);

  const hint = document.createElement("p");
  hint.classList.add("hint");
  hint.textContent = game.i18n.localize("LIGHTSOURCES.Interactive.Hint");

  fields.append(input);
  group.append(label, fields, hint);
  fieldset.append(legend, group);
  tab.append(fieldset);
}
