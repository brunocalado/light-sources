/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID } from "./constants.js";
import { getSources, findMatchingItems, getActorTypes } from "./helpers.js";
import { getActiveLight, activateLight, deactivateLight, dropLight } from "./light-manager.js";

/**
 * Register the Token HUD integration hooks.
 * @returns {void}
 */
export function registerTokenHudHooks() {
  Hooks.on("renderTokenHUD", onRenderTokenHUD);
}

/**
 * Inject the light-source button and its palette into the Token HUD. Shown
 * for an actor that either carries at least one registered light-source item
 * (any actor type — possession of the item is itself sufficient), has a
 * "free for all" source available and is of an actor type enabled in the
 * compatibility settings (see the GM config's Actors tab), or currently has
 * an active light (so it can be put out regardless of actor type, even after
 * the last item was consumed or removed).
 * @param {foundry.applications.hud.TokenHUD} hud The rendered HUD application.
 * @param {HTMLElement} html The HUD root element.
 */
function onRenderTokenHUD(hud, html) {
  const actor = hud.object?.document?.actor;
  if ( !actor ) return;

  const freeForAllAllowed = getActorTypes().includes(actor.type);
  const active = getActiveLight(actor);
  const entries = getSources()
    .map(source => ({ source, items: findMatchingItems(actor, source) }))
    .filter(entry => (entry.items.length > 0) || (entry.source.freeForAll && freeForAllAllowed));
  if ( !entries.length && !active ) return;

  // Wrap the toggle and palette together so the palette is positioned relative
  // to the button (not the whole HUD), keeping it from overlapping the HUD's
  // top attribute row.
  const wrapper = document.createElement("div");
  wrapper.classList.add(MODULE_ID, "ls-control");
  const palette = buildPalette(hud, actor, entries, active);
  const button = buildToggleButton(palette, active);
  wrapper.append(button, palette);
  (html.querySelector(".col.left") ?? html).appendChild(wrapper);
}

/**
 * Build the HUD control button that toggles the light-source palette.
 * @param {HTMLElement} palette The palette element toggled by this button.
 * @param {object|null} active The actor's active light flag, if any.
 * @returns {HTMLButtonElement} The control button.
 */
function buildToggleButton(palette, active) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("control-icon", MODULE_ID, "ls-toggle");
  if ( active ) button.classList.add("ls-lit");
  const tooltip = game.i18n.localize("LIGHTSOURCES.Hud.Tooltip");
  button.dataset.tooltip = tooltip;
  button.setAttribute("aria-label", tooltip);
  const icon = document.createElement("i");
  icon.className = "fa-solid fa-fire-flame-curved";
  icon.inert = true;
  button.append(icon);
  button.addEventListener("click", event => {
    event.preventDefault();
    palette.classList.toggle("ls-open");
  });
  return button;
}

/**
 * Build the palette listing the actor's available light sources plus an
 * extinguish control while a light is burning. Each of a source's light
 * patterns ("stages" — e.g. a flashlight's wide vs. narrow beam) gets its own
 * entry. Only one light can be active at a time: activating any entry simply
 * replaces the current one.
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered after changes).
 * @param {Actor} actor The token's actor.
 * @param {Array<{source: object, items: Item[]}>} entries Registered sources present in the inventory.
 * @param {object|null} active The actor's active light flag, if any.
 * @returns {HTMLDivElement} The palette element.
 */
function buildPalette(hud, actor, entries, active) {
  const palette = document.createElement("div");
  palette.classList.add(MODULE_ID, "ls-palette");

  for ( const { source } of entries ) {
    // A lone pattern is the implicit default and needs no secondary label.
    const multiPattern = source.patterns.length > 1;

    for ( const pattern of source.patterns ) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("ls-entry");
      if ( (active?.sourceId === source.id) && (active?.patternId === pattern.id) ) button.classList.add("ls-active");

      const img = document.createElement("img");
      img.className = "ls-icon";
      img.src = source.img;
      img.alt = "";

      const label = document.createElement("span");
      label.className = "ls-label";
      const name = document.createElement("span");
      name.className = "ls-name-line";
      name.textContent = source.name;
      label.append(name);
      if ( multiPattern ) {
        const patternLine = document.createElement("span");
        patternLine.className = "ls-pattern-line";
        patternLine.textContent = pattern.name;
        label.append(patternLine);
      }

      button.append(img, label);
      button.addEventListener("click", async event => {
        event.preventDefault();
        palette.classList.remove("ls-open");
        await activateLight(actor, source, pattern);
        hud.render();
      });

      // Free-for-all sources have no item to leave behind, so they get no drop
      // control. Every other pattern row can drop this specific pattern's light.
      // The drop control is a *sibling* of the entry button, not a child: a native
      // <button> swallows pointer events from nested interactive elements, so a
      // nested drop button/span never receives its own clicks.
      const drop = source.freeForAll ? null : buildDropButton(hud, actor, source, pattern, palette);
      if ( drop ) {
        const row = document.createElement("div");
        row.classList.add("ls-row");
        row.append(button, drop);
        palette.append(row);
      } else {
        palette.append(button);
      }
    }
  }

  if ( active ) {
    const off = document.createElement("button");
    off.type = "button";
    off.classList.add("ls-entry", "ls-off");
    const icon = document.createElement("i");
    icon.className = "fa-solid fa-fire-extinguisher";
    icon.inert = true;
    const label = document.createElement("span");
    label.className = "ls-label";
    label.textContent = game.i18n.localize("LIGHTSOURCES.Hud.Extinguish");
    off.append(icon, label);
    off.addEventListener("click", async event => {
      event.preventDefault();
      palette.classList.remove("ls-open");
      await deactivateLight(actor);
      hud.render();
    });
    palette.append(off);
  }

  return palette;
}

/**
 * Build the secondary "Drop" control for a pattern row: leaves the light on the
 * ground as an AmbientLight (consuming one item) instead of lighting the token.
 * Rendered as a sibling of the entry button (see `buildPalette`), never nested
 * inside it, so it reliably receives its own clicks.
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered after the drop, to refresh quantities).
 * @param {Actor} actor The token's actor.
 * @param {object} source The registered light source definition.
 * @param {object} pattern The specific light pattern this row represents.
 * @param {HTMLElement} palette The palette element (closed after the drop).
 * @returns {HTMLButtonElement} The drop control button.
 */
function buildDropButton(hud, actor, source, pattern, palette) {
  const drop = document.createElement("button");
  drop.type = "button";
  drop.classList.add("ls-drop");
  drop.setAttribute("aria-label", game.i18n.localize("LIGHTSOURCES.Hud.DropTooltip"));
  const text = document.createElement("span");
  text.className = "ls-drop-label";
  text.textContent = game.i18n.localize("LIGHTSOURCES.Hud.Drop");
  drop.append(text);
  drop.addEventListener("click", async event => {
    event.preventDefault();
    await dropLight(actor, source, pattern, hud.object);
    hud.render();
  });
  return drop;
}
