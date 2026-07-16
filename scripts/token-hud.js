/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, DURATION_MODES } from "./constants.js";
import { getSources, findMatchingItems, getActorTypes, getAllowFreeForAllDrop } from "./helpers.js";
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
    // The lit source is always listed, even once its last item has been consumed
    // down to 0 (lighting the last torch empties the stack): its row is what
    // carries the extinguish/drop controls for the light already burning.
    .filter(entry => (entry.items.length > 0) || (entry.source.freeForAll && freeForAllAllowed)
      || (entry.source.id === active?.sourceId));
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
 * Build the tooltip for the HUD's flame button. While a light burns, the tooltip
 * names it and, when it has a duration, how much of it is left. The remaining
 * time deliberately lives here rather than in the palette: the palette is cramped,
 * and only one light is ever lit at a time (see `activateLight` in
 * `light-manager.js`), so a per-row time slot would cost every row to inform one.
 * @param {object|null} active The actor's active light flag, if any.
 * @returns {string} The tooltip text.
 */
function buildToggleTooltip(active) {
  if ( !active ) return game.i18n.localize("LIGHTSOURCES.Hud.Tooltip");

  // A light with no duration stores no expiry at all and burns until it is put
  // out by hand, so there is nothing to count down.
  const remainingMs = active.mode === DURATION_MODES.REAL
    ? (active.expiresAtReal != null ? active.expiresAtReal - Date.now() : null)
    : (active.expiresAtWorld != null ? (active.expiresAtWorld - game.time.worldTime) * 1000 : null);
  if ( remainingMs === null ) return game.i18n.format("LIGHTSOURCES.Hud.TooltipLit", { item: active.itemName });

  // Round up, and never read "0 min": the light keeps burning until the expiry
  // sweep catches it, so its last partial minute should still show as one.
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  return game.i18n.format("LIGHTSOURCES.Hud.TooltipRemaining", { item: active.itemName, minutes });
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
  // Computed once per render: the remaining time ages while the HUD stays open,
  // but the HUD re-renders on every token selection and after every light change.
  const tooltip = buildToggleTooltip(active);
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
 * replaces the current one. The lit entry additionally carries a drop control,
 * since dropping relocates the burning light rather than spending a new item.
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
      const isActive = (active?.sourceId === source.id) && (active?.patternId === pattern.id);

      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("ls-entry");
      if ( isActive ) button.classList.add("ls-active");

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

      // Dropping relocates the light already burning on the token, so it is only
      // offered on the lit row. Free-for-all lights cost nothing to drop (no item
      // backs them), so a GM setting gates whether they can be dropped at all.
      // The drop control is a *sibling* of the entry button, not a child: a native
      // <button> swallows pointer events from nested interactive elements, so a
      // nested drop button/span never receives its own clicks.
      const droppable = isActive && (!source.freeForAll || getAllowFreeForAllDrop());
      const drop = droppable ? buildDropButton(hud, actor, source, pattern) : null;
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
 * Build the secondary "Drop" control for the lit pattern row: moves the burning
 * light off the token and onto the ground as an AmbientLight, consuming nothing
 * (see `dropLight` in `light-manager.js`). Only built for the lit row (see
 * `buildPalette`). Rendered as a sibling of the entry button, never nested inside
 * it, so it reliably receives its own clicks.
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered after the drop, which also rebuilds the palette closed).
 * @param {Actor} actor The token's actor.
 * @param {object} source The registered light source definition.
 * @param {object} pattern The specific light pattern this row represents.
 * @returns {HTMLButtonElement} The drop control button.
 */
function buildDropButton(hud, actor, source, pattern) {
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
