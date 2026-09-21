/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, DURATION_MODES } from "./constants.js";
import {
  getSources, findMatchingItems, getActorTypes, getAllowFreeForAllDrop, getRestrictPlayerControl, findGroundLight
} from "./helpers.js";
import {
  getActiveLight, activateLight, deactivateLight, setLightStowed, dropLight, pickupLight
} from "./light-manager.js";

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
 * the last item was consumed or removed), or is standing on or beside a light
 * someone dropped on the ground (so it can be picked back up).
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
    // carries the extinguish/drop controls for the light already burning. That also
    // makes `hudHidden` safe to apply bluntly here — a hidden source reappears the
    // moment something lights it, carrying its controls, and vanishes again when put out.
    .filter(entry => (entry.source.id === active?.sourceId)
      || (!entry.source.hudHidden
        && ((entry.items.length > 0) || (entry.source.freeForAll && freeForAllAllowed))));
  // A ground light on its own is enough to open the HUD: an actor who lit its last
  // torch and put it down carries no item and has no active light, yet must still
  // be able to reach down and take it back.
  const ground = findGroundLight(hud.object);
  if ( !entries.length && !active && !ground ) return;

  // Wrap the toggle and palette together so the palette is positioned relative
  // to the button (not the whole HUD), keeping it from overlapping the HUD's
  // top attribute row.
  const wrapper = document.createElement("div");
  wrapper.classList.add(MODULE_ID, "ls-control");
  const palette = buildPalette(hud, actor, entries, active, ground);
  const button = buildToggleButton(palette, active);
  wrapper.append(button, palette);
  (html.querySelector(".col.left") ?? html).appendChild(wrapper);
}

/**
 * Refuse a player's click on a light-source control while the GM has restricted
 * these controls to themselves. Checked at the moment of the click rather than by
 * hiding the controls, so the palette keeps showing players what is lit and what
 * is available — they just can't act on it.
 * @returns {boolean} True when the click must be refused (and a warning was shown).
 */
function guardPlayerControl() {
  if ( game.user.isGM || !getRestrictPlayerControl() ) return false;
  ui.notifications.warn(game.i18n.localize("LIGHTSOURCES.Hud.GmOnly"));
  return true;
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
  // A covered light is still burning down, so it reports its remaining time exactly
  // like a shining one — only the wording says it is out of sight.
  if ( remainingMs === null ) {
    const key = active.stowed ? "LIGHTSOURCES.Hud.TooltipStowed" : "LIGHTSOURCES.Hud.TooltipLit";
    return game.i18n.format(key, { item: active.itemName });
  }

  // Round up, and never read "0 min": the light keeps burning until the expiry
  // sweep catches it, so its last partial minute should still show as one.
  const minutes = Math.max(1, Math.ceil(remainingMs / 60000));
  const key = active.stowed ? "LIGHTSOURCES.Hud.TooltipStowedRemaining" : "LIGHTSOURCES.Hud.TooltipRemaining";
  return game.i18n.format(key, { item: active.itemName, minutes });
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
  // A covered light gets its own treatment rather than the lit one: nothing is
  // shining, but something is still burning down and the button must not read as idle.
  if ( active ) button.classList.add(active.stowed ? "ls-stowed" : "ls-lit");
  // Computed once per render: the remaining time ages while the HUD stays open,
  // but the HUD re-renders on every token selection and after every light change.
  const tooltip = buildToggleTooltip(active);
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
 * replaces the current one, except the entry for the pattern already lit —
 * clicking that one extinguishes it, mirroring the dedicated "off" row, since
 * that is the click a player instinctively reaches for to turn a light back
 * off. The lit entry additionally carries a drop control, since dropping
 * relocates the burning light rather than spending a new item, and — for a source
 * marked coverable — a control that covers the light without ending it.
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered after changes).
 * @param {Actor} actor The token's actor.
 * @param {Array<{source: object, items: Item[]}>} entries Registered sources present in the inventory.
 * @param {object|null} active The actor's active light flag, if any.
 * @param {AmbientLightDocument|null} ground A dropped light within the token's reach, if any.
 * @returns {HTMLDivElement} The palette element.
 */
function buildPalette(hud, actor, entries, active, ground) {
  const palette = document.createElement("div");
  palette.classList.add(MODULE_ID, "ls-palette");

  // First in the palette: reclaiming a light already on the ground is a reply to
  // something the player can see right there, unlike the inventory rows below it.
  if ( ground ) palette.append(buildPickupButton(hud, actor, palette, ground));

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
        if ( guardPlayerControl() ) return;
        // Clicking the already-lit entry is how a player expects to put it out —
        // the same action as the dedicated extinguish row below, just reachable
        // without an extra scan down the palette.
        if ( isActive ) await deactivateLight(actor);
        else await activateLight(actor, source, pattern);
        hud.render();
      });

      // Dropping relocates the light already burning on the token, so it is only
      // offered on the lit row. Free-for-all lights cost nothing to drop (no item
      // backs them), so a GM setting gates whether they can be dropped at all.
      // The drop control is a *sibling* of the entry button, not a child: a native
      // <button> swallows pointer events from nested interactive elements, so a
      // nested drop button/span never receives its own clicks. The cover control
      // follows the same rule, and sits after drop so drop stays where it has
      // always been for anyone used to reaching for it.
      const droppable = isActive && (!source.freeForAll || getAllowFreeForAllDrop());
      const drop = droppable ? buildDropButton(hud, actor, source, pattern) : null;
      const stow = (isActive && source.coverable) ? buildStowButton(hud, actor, active) : null;
      if ( drop || stow ) {
        const row = document.createElement("div");
        row.classList.add("ls-row");
        row.append(button, ...[drop, stow].filter(control => control));
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
      if ( guardPlayerControl() ) return;
      await deactivateLight(actor);
      hud.render();
    });
    palette.append(off);
  }

  return palette;
}

/**
 * Build the "Pick Up Light" control: takes a light off the ground and lights it on
 * the token again, spending nothing (see `pickupLight` in `light-manager.js`).
 *
 * A full-width row of its own rather than a secondary control on a source row: the
 * light being reclaimed is on the map, not in the inventory, and may well belong to
 * a source this actor no longer carries any item for. That also sidesteps the
 * nesting trap `buildDropButton` has to work around — there is no entry button to
 * sit inside.
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered after the pickup).
 * @param {Actor} actor The token's actor.
 * @param {HTMLElement} palette The palette element, closed before the pickup runs.
 * @param {AmbientLightDocument} ground The dropped light within reach.
 * @returns {HTMLButtonElement} The pickup control button.
 */
function buildPickupButton(hud, actor, palette, ground) {
  const button = document.createElement("button");
  button.type = "button";
  button.classList.add("ls-entry", "ls-pickup");
  button.setAttribute("aria-label", game.i18n.localize("LIGHTSOURCES.Hud.PickupTooltip"));

  const icon = document.createElement("i");
  icon.className = "fa-solid fa-hand-holding";
  icon.inert = true;

  const label = document.createElement("span");
  label.className = "ls-label";
  label.textContent = game.i18n.localize("LIGHTSOURCES.Hud.Pickup");

  button.append(icon, label);
  button.addEventListener("click", async event => {
    event.preventDefault();
    palette.classList.remove("ls-open");
    if ( guardPlayerControl() ) return;
    await pickupLight(actor, ground);
    hud.render();
  });
  return button;
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
    if ( guardPlayerControl() ) return;
    await dropLight(actor, source, pattern, hud.object);
    hud.render();
  });
  return drop;
}

/**
 * Build the secondary "Stow"/"Uncover" control for the lit pattern row: covers the
 * burning light without ending it, or takes it back out (see `setLightStowed` in
 * `light-manager.js`). Only built for the lit row of a source the GM marked
 * coverable — a torch has nothing to cover, it is snuffed or it burns.
 *
 * One button for both directions rather than two rows: covering and uncovering are
 * the same gesture from opposite sides, and the label already says which way it
 * goes. Rendered as a sibling of the entry button for the same reason the drop
 * control is (see `buildDropButton`).
 * @param {foundry.applications.hud.TokenHUD} hud The HUD application (re-rendered afterwards).
 * @param {Actor} actor The token's actor.
 * @param {object} active The actor's active light flag, carrying the derived `stowed` state.
 * @returns {HTMLButtonElement} The cover control button.
 */
function buildStowButton(hud, actor, active) {
  const stowed = !!active.stowed;
  const stow = document.createElement("button");
  stow.type = "button";
  stow.classList.add("ls-stow");
  if ( stowed ) stow.classList.add("ls-stowed");
  stow.setAttribute("aria-label", game.i18n.localize(
    stowed ? "LIGHTSOURCES.Hud.UncoverTooltip" : "LIGHTSOURCES.Hud.StowTooltip"
  ));
  const text = document.createElement("span");
  text.className = "ls-stow-label";
  text.textContent = game.i18n.localize(stowed ? "LIGHTSOURCES.Hud.Uncover" : "LIGHTSOURCES.Hud.Stow");
  stow.append(text);
  stow.addEventListener("click", async event => {
    event.preventDefault();
    if ( guardPlayerControl() ) return;
    await setLightStowed(actor, !stowed);
    hud.render();
  });
  return stow;
}
