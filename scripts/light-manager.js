/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, FLAGS, DURATION_MODES, LIGHT_CHANGE_PRIORITY, EXPIRY_CHECK_INTERVAL_MS } from "./constants.js";
import { findMatchingItems, buildLightMessage, getItemQuantity, getQuantityPath } from "./helpers.js";

/**
 * Interval id of the real-time expiry ticker, so it is only ever started once
 * per client.
 * @type {number|null}
 */
let tickerId = null;

/**
 * Get the ActiveEffect this module uses to drive an Actor's light, if any.
 * The module only ever keeps one such effect per actor at a time.
 * @param {Actor} actor The actor to inspect.
 * @returns {ActiveEffect|null} The module's light effect, or null.
 */
export function getLightEffect(actor) {
  return actor.effects.find(e => e.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT)) ?? null;
}

/**
 * Get the active light bookkeeping payload stored on an Actor's light effect.
 * Used by the Token HUD to reflect the lit/unlit state.
 * @param {Actor} actor The actor to inspect.
 * @returns {object|null} The flag payload ({sourceId, patternId, patternName, itemName, mode, expiresAtWorld, expiresAtReal}) or null.
 */
export function getActiveLight(actor) {
  return getLightEffect(actor)?.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT) ?? null;
}

/**
 * Build the token light data for a light pattern. Only basic + animation fields
 * are set; advanced light options on the token are deliberately left untouched.
 * Used by the light editor's live preview, which writes directly to a token's
 * light source without persisting.
 * @param {object} pattern A light pattern ({id, name, light}), or any object
 *   exposing a `light` configuration.
 * @returns {object} Plain light data suitable for a Token light source.
 */
export function buildLightData(pattern) {
  const light = foundry.utils.deepClone(pattern.light);
  light.color = light.color || null;
  light.animation = {
    type: light.animation?.type || null,
    speed: light.animation?.speed ?? 5,
    intensity: light.animation?.intensity ?? 5,
    reverse: !!light.animation?.reverse
  };
  return light;
}

/**
 * Build the ActiveEffect `changes` array that overrides a token's light with a
 * light pattern. One entry per basic/animation field, each an `override`
 * targeting a native v14 `token.light.*` key (core strips the `token.` prefix and
 * applies it to the TokenDocument — a core feature, independent of any game
 * system). Only these keys are touched, so advanced light options (luminosity,
 * attenuation, coloration, shadows, darkness) remain at the token's own base value.
 * @param {object} pattern A light pattern ({id, name, light}) of a source.
 * @returns {object[]} The change entries for `ActiveEffect#system#changes`.
 */
function buildLightChanges(pattern) {
  const light = pattern.light ?? {};
  const anim = light.animation ?? {};
  const alpha = Number(light.alpha);
  const entry = (key, value) => ({ key, value, type: "override", phase: "initial", priority: LIGHT_CHANGE_PRIORITY });
  return [
    entry("token.light.dim", Math.max(0, Number(light.dim) || 0)),
    entry("token.light.bright", Math.max(0, Number(light.bright) || 0)),
    entry("token.light.angle", Number(light.angle) || 360),
    entry("token.light.color", light.color || null),
    entry("token.light.alpha", Number.isFinite(alpha) ? alpha : 0.5),
    entry("token.light.animation.type", anim.type || ""),
    entry("token.light.animation.speed", Number(anim.speed) || 5),
    entry("token.light.animation.intensity", Number(anim.intensity) || 5),
    entry("token.light.animation.reverse", !!anim.reverse)
  ];
}

/**
 * Activate a light source on an Actor: optionally consume one item, then create
 * an ActiveEffect that overrides the token's light. The effect lives on the
 * Actor, so its light applies to every token of that actor across all scenes and
 * follows the character; extinguishing is simply deleting the effect, which
 * reverts the token to its original light with no stored snapshot.
 *
 * Re-lighting the source already burning is a *pattern switch* and takes a separate
 * path: it reshapes the existing flame in place instead of spending a second item and
 * restarting the clock (see `switchPattern`).
 * @param {Actor} actor The actor (world actor, or synthetic actor of an unlinked token).
 * @param {object} source The registered light source definition. When
 *   `source.freeForAll` is set, the item lookup and quantity consumption are
 *   skipped entirely (regardless of `source.consume`), so every eligible actor
 *   can use the light with no carried item.
 * @param {object} pattern The light pattern ({id, name, light}) to light. A source
 *   may own several patterns (e.g. a flashlight's wide vs. narrow beam);
 *   consumption and duration are shared across all of them, only the emitted
 *   light shape differs.
 * @returns {Promise<void>}
 */
export async function activateLight(actor, source, pattern) {
  // Matched on the source alone, not the pattern: a source's patterns are ways for
  // the same flame to burn, so moving between them is never a new light.
  const effect = getLightEffect(actor);
  if ( effect?.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT)?.sourceId === source.id ) {
    return switchPattern(actor, effect, pattern);
  }

  if ( source.consume && !source.freeForAll ) {
    const item = findMatchingItems(actor, source)[0];
    if ( !item ) {
      ui.notifications.warn(game.i18n.format("LIGHTSOURCES.Hud.NoItem", { name: actor.name, item: source.name }));
      return;
    }
    // Only decrement when a quantity path is configured and resolves to a
    // number; otherwise the item has no tracked quantity to spend.
    const quantityPath = getQuantityPath();
    const quantity = getItemQuantity(item);
    if ( quantityPath && Number.isFinite(quantity) ) {
      await Item.implementation.updateDocuments([{ _id: item.id, [quantityPath]: quantity - 1 }], { parent: actor });
    }
  }

  // Only one light effect at a time: remove any previous one (switching sources / re-lighting).
  const stale = actor.effects.filter(e => e.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT)).map(e => e.id);
  if ( stale.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", stale);

  const mode = source.durationMode === DURATION_MODES.REAL ? DURATION_MODES.REAL : DURATION_MODES.WORLD;
  const minutes = source.durationMinutes > 0 ? source.durationMinutes : 0;
  const worldExpiry = (mode === DURATION_MODES.WORLD) && minutes;

  // World-time lights use the effect's native duration so the light reverts the
  // instant the game clock passes the expiry, on every client. Real-time lights
  // keep an indefinite native duration (advancing the clock must not affect them)
  // and are extinguished by the real-time ticker. `expiry: null` makes the native
  // duration expire purely on elapsed time rather than on a combat turn boundary.
  const duration = worldExpiry ? { value: minutes, units: "minutes", expiry: null } : { value: null };
  const flagValue = {
    sourceId: source.id,
    patternId: pattern.id,
    patternName: pattern.name,
    itemName: source.name,
    mode,
    expiresAtWorld: worldExpiry ? game.time.worldTime + (minutes * 60) : null,
    expiresAtReal: (mode === DURATION_MODES.REAL) && minutes ? Date.now() + (minutes * 60000) : null
  };

  // This effect is system-agnostic: every piece below is core Foundry v14, not
  // system-specific. `token.light.*` is native token-targeting (core strips
  // the `token.` prefix and applies it to the TokenDocument); `type: "base"` is
  // CONST.BASE_DOCUMENT_TYPE, for which core itself registers the data model
  // (CONFIG.ActiveEffect.dataModels.base = ActiveEffectTypeDataModel) defining
  // `system.changes`. The change shape validates on a vanilla-core world and on
  // any system that doesn't hostilely narrow the base changes schema (some
  // systems reshape it but keep the same shape + the `override` mode).
  await actor.createEmbeddedDocuments("ActiveEffect", [{
    name: source.name,
    img: source.img,
    type: "base",
    transfer: false,
    duration,
    system: { changes: buildLightChanges(pattern) },
    flags: { [MODULE_ID]: { [FLAGS.EFFECT_LIGHT]: flagValue } }
  }]);

  // Name the pattern only when the source has more than one: a lone pattern is
  // the implicit default and its name carries no information (it may be empty).
  const announcement = (source.patterns?.length > 1) && pattern.name
    ? game.i18n.format("LIGHTSOURCES.Chat.LitPattern", { actor: actor.name, item: source.name, pattern: pattern.name })
    : game.i18n.format("LIGHTSOURCES.Chat.Lit", { actor: actor.name, item: source.name });
  await ChatMessage.implementation.createDocuments([
    buildLightMessage(actor, game.i18n.localize("LIGHTSOURCES.Chat.LitTitle"), announcement)
  ]);
}

/**
 * Move the light already burning on an Actor to another of its source's patterns —
 * a flashlight going from wide beam to narrow, not a second flashlight.
 *
 * The effect is updated in place rather than replaced, which is what makes the
 * source's consumption and duration genuinely shared across its patterns (as the
 * light editor promises the GM): no item is spent, and the untouched `duration`
 * keeps counting from the original light's start, so the native expiry still lands
 * where it always would have. The bookkeeping flag is rewritten wholesale from the
 * previous payload with only the pattern fields moved, so the source, the item name
 * and both expiry stamps survive verbatim — a GM re-timing the source mid-burn does
 * not retime a flame that is already lit. Nothing is announced in chat: the table
 * already heard this light being lit.
 * @param {Actor} actor The actor whose light is being reshaped.
 * @param {ActiveEffect} effect The module's light effect currently on the actor.
 * @param {object} pattern The light pattern ({id, name, light}) to switch to.
 * @returns {Promise<void>}
 */
async function switchPattern(actor, effect, pattern) {
  const flag = effect.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT);
  await actor.updateEmbeddedDocuments("ActiveEffect", [{
    _id: effect.id,
    system: { changes: buildLightChanges(pattern) },
    flags: { [MODULE_ID]: { [FLAGS.EFFECT_LIGHT]: { ...flag, patternId: pattern.id, patternName: pattern.name } } }
  }]);
}

/**
 * Drop the light burning on a token as a standalone AmbientLight on the scene:
 * the lit light moves from the token to the ground. Dropping only ever relocates
 * an already-active light, so it never consumes and never refunds an item —
 * spending is entirely activation's business (see `activateLight`). A consuming
 * source already paid for this light when it was lit; a non-consuming source
 * never pays at all. Re-lighting afterwards is a deliberate, manual action.
 * The light is placed at the token's center using the given pattern's light data,
 * and announced in chat once it is down.
 * @param {Actor} actor The actor dropping the light.
 * @param {object} source The registered light source definition. Must be the source
 *   of the actor's currently active light — dropping is a no-op otherwise.
 * @param {object} pattern The light pattern ({id, name, light}) whose light data is
 *   placed. Passed in rather than read from the active-light flag, which stores only
 *   the pattern's id and name, not its light configuration.
 * @param {foundry.canvas.placeables.Token} token The token placeable the drop originates from.
 * @returns {Promise<void>}
 */
export async function dropLight(actor, source, pattern, token) {
  // Matched on the source alone, not the pattern: consumption and duration are
  // shared across a source's patterns, so any of its patterns is the same lit light.
  // Defensive — the Token HUD only offers the drop control on the lit row.
  const active = getActiveLight(actor);
  if ( active?.sourceId !== source.id ) return;

  // The light is now the one lying on the ground, not the one on the token.
  await deactivateLight(actor);

  // AmbientLight documents anchor on their center point, so drop the light at the
  // token's center rather than its top-left origin (token.x / token.y).
  const { x, y } = token.center;
  const placed = await placeAmbientLight(canvas.scene?.id, { x, y, config: buildLightData(pattern) });
  // Nothing reached the ground (no scene, or no GM to place it): stay silent rather
  // than announce a light that does not exist. `placeAmbientLight` reports the cause.
  if ( !placed ) return;

  await ChatMessage.implementation.createDocuments([
    buildLightMessage(
      actor,
      game.i18n.localize("LIGHTSOURCES.Chat.DroppedTitle"),
      game.i18n.format("LIGHTSOURCES.Chat.Dropped", { actor: actor.name, item: source.name })
    )
  ]);
}

/**
 * Place an AmbientLight on a scene, delegating to the active GM when the current
 * user lacks permission. Foundry only lets a GM create AmbientLight documents, so
 * a non-GM caller hands the request off over the module socket.
 * @param {string} sceneId The id of the scene to place the light on.
 * @param {object} lightData The AmbientLight creation data ({x, y, config}).
 * @returns {Promise<boolean>} True once the light is placed, or handed to the active
 *   GM to place. The relay is fire-and-forget, so a player only ever learns that the
 *   request was accepted — not that the document was created.
 */
async function placeAmbientLight(sceneId, lightData) {
  if ( !sceneId ) return false;
  if ( game.user.isGM ) return createAmbientLight(sceneId, lightData);
  if ( !game.users.activeGM ) {
    ui.notifications.warn(game.i18n.localize("LIGHTSOURCES.Hud.NoGm"));
    return false;
  }
  game.socket.emit(`module.${MODULE_ID}`, { action: "dropLight", sceneId, lightData });
  return true;
}

/**
 * Create the AmbientLight document. Runs on a GM client — directly for a GM user,
 * or on the active GM after a socket relay from a player.
 * @param {string} sceneId The id of the scene to place the light on.
 * @param {object} lightData The AmbientLight creation data ({x, y, config}).
 * @returns {Promise<boolean>} True when the light was created, false when the scene
 *   no longer exists.
 */
async function createAmbientLight(sceneId, lightData) {
  const scene = game.scenes.get(sceneId);
  if ( !scene ) return false;
  await scene.createEmbeddedDocuments("AmbientLight", [lightData]);
  return true;
}

/**
 * Handle an inbound module socket message. Only the active GM acts on it, so a
 * relayed request runs exactly once even when several GMs are connected.
 * Registered on the module socket from the `ready` hook.
 * @param {object} payload The socket payload ({action, ...}).
 * @returns {void}
 */
export function handleSocketMessage(payload) {
  if ( !payload || (game.users.activeGM !== game.user) ) return;
  if ( payload.action === "dropLight" ) {
    createAmbientLight(payload.sceneId, payload.lightData)
      .catch(err => console.error(`${MODULE_ID} | Drop light relay failed`, err));
  }
}

/**
 * Deactivate the active light on a single Actor by deleting its light effect,
 * reverting the token to its original light automatically.
 * @param {Actor} actor The actor whose light is extinguished.
 * @returns {Promise<void>}
 */
export async function deactivateLight(actor) {
  return deactivateLights([actor]);
}

/**
 * Deactivate the active light on several Actors, deleting each one's light
 * effect. Deletion is per-actor because ActiveEffects are embedded documents
 * with distinct parents.
 * @param {Actor[]} actors The actors whose lights are extinguished.
 * @returns {Promise<void>}
 */
export async function deactivateLights(actors) {
  for ( const actor of actors ) {
    const ids = actor.effects.filter(e => e.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT)).map(e => e.id);
    if ( ids.length ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  }
}

/**
 * Collect this module's expired light effects on a single Actor.
 * A world-time light is expired once the game clock passes its stored
 * `expiresAtWorld`; a real-time light once wall-clock time passes `expiresAtReal`.
 * @param {Actor} actor The actor to inspect.
 * @param {number} now The current `Date.now()` timestamp.
 * @returns {Array<{actor: Actor, id: string, itemName: string}>} The expired entries.
 */
function collectExpired(actor, now) {
  const expired = [];
  for ( const effect of actor.effects ) {
    const flag = effect.getFlag(MODULE_ID, FLAGS.EFFECT_LIGHT);
    if ( !flag ) continue;
    const isExpired = flag.mode === DURATION_MODES.REAL
      ? (flag.expiresAtReal != null) && (flag.expiresAtReal <= now)
      : (flag.expiresAtWorld != null) && (game.time.worldTime >= flag.expiresAtWorld);
    if ( isExpired ) expired.push({ actor, id: effect.id, itemName: flag.itemName });
  }
  return expired;
}

/**
 * Find every actor whose light has burned out and extinguish it. Runs only on
 * the active GM client, so it works regardless of whether the owning player is
 * connected. Triggered both by the real-time ticker (for real-time lights) and
 * by the `updateWorldTime` hook (for in-game-time lights). Expired lights are
 * deleted and announced in chat; they are never re-lit or re-consumed.
 * @returns {Promise<void>}
 */
export async function sweepExpiredLights() {
  if ( game.users.activeGM !== game.user ) return;
  const now = Date.now();
  const expired = [];

  for ( const actor of game.actors ) expired.push(...collectExpired(actor, now));

  // Unlinked tokens keep their effect on a synthetic actor, not in game.actors.
  for ( const scene of game.scenes ) {
    for ( const token of scene.tokens ) {
      if ( token.actorLink || !token.actor ) continue;
      expired.push(...collectExpired(token.actor, now));
    }
  }

  if ( !expired.length ) return;

  // Group deletions per actor (embedded documents have distinct parents).
  const byActor = new Map();
  for ( const { actor, id } of expired ) {
    if ( !byActor.has(actor) ) byActor.set(actor, []);
    byActor.get(actor).push(id);
  }
  for ( const [actor, ids] of byActor ) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);

  await ChatMessage.implementation.createDocuments(expired.map(({ actor, itemName }) => buildLightMessage(
    actor,
    game.i18n.localize("LIGHTSOURCES.Chat.ExpiredTitle"),
    game.i18n.format("LIGHTSOURCES.Chat.Expired", { actor: actor.name, item: itemName })
  )));
}

/**
 * Start the periodic real-time expiry check. Called once from the `ready` hook;
 * the check itself no-ops on every client except the active GM. In-game-time
 * lights are handled separately through the `updateWorldTime` hook.
 * @returns {void}
 */
export function startExpiryTicker() {
  if ( tickerId !== null ) return;
  const tick = () => sweepExpiredLights().catch(err => console.error(`${MODULE_ID} | Expiry check failed`, err));
  tickerId = window.setInterval(tick, EXPIRY_CHECK_INTERVAL_MS);
  tick(); // Catch lights that expired while no GM was connected.
}
