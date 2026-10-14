/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import {
  MODULE_ID, SETTINGS, FLAGS, CONSUME_MODES, DURATION_MODES, DEFAULT_SOURCE_IMG, CHAT_CARD_BG, CHAT_CARD_ACCENT
} from "./constants.js";

/**
 * Build a light pattern: a uniquely-identified, named light configuration. A
 * single light source owns one or more of these "stages" (for example a
 * flashlight's wide-but-short beam versus its narrow-but-long beam); the Token
 * HUD lets the actor pick which one to light. Shared by source registration and
 * the pattern editor.
 * @param {object} light A light configuration (see DEFAULT_LIGHT for the shape).
 * @param {string} name The pattern's display name.
 * @returns {{id: string, name: string, light: object}} A new light pattern.
 */
export function makePattern(light, name) {
  return { id: foundry.utils.randomID(), name: name ?? "", light: foundry.utils.deepClone(light) };
}

/**
 * Build the fields a light's look is made of: radii, color and animation. Shared by a
 * pattern's full look and its running-low look, so both are cleaned by the same rules.
 * A factory for the same reason `sourceField` is one: each parent needs its own instances.
 * @returns {object} A fresh set of fields.
 */
function basicLightFields() {
  const f = foundry.data.fields;
  return {
    dim: new f.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
    bright: new f.NumberField({ required: true, nullable: false, min: 0, initial: 0 }),
    // Blank means "no tint", which the light editor allows.
    color: new f.StringField({ required: true, blank: true }),
    alpha: new f.NumberField({ required: true, nullable: false, min: 0, max: 1, initial: 0.5 }),
    animation: new f.SchemaField({
      type: new f.StringField({ required: true, blank: true }),
      speed: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 10, initial: 5 }),
      intensity: new f.NumberField({ required: true, nullable: false, integer: true, min: 1, max: 10, initial: 5 }),
      reverse: new f.BooleanField()
    })
  };
}

/**
 * Build the schema of one light source record. The same shape is stored in the
 * world setting, built from a `registerSources` entry, and read from an import
 * file, so all three ways data enters the module are validated by the same rules.
 *
 * A factory rather than a shared constant: a field instance is bound to the parent
 * it is placed in, so the setting's ArrayField and a standalone validation must
 * each get their own.
 * @returns {foundry.data.fields.SchemaField} A fresh source schema.
 */
export function sourceField() {
  const f = foundry.data.fields;
  const light = new f.SchemaField({
    ...basicLightFields(),
    negative: new f.BooleanField(),
    angle: new f.NumberField({ required: true, nullable: false, min: 5, max: 360, initial: 360 }),
    // Null leaves the token's own advanced options alone. The bounds mirror core's
    // LightData, and the coloration ids are core's shader techniques.
    advanced: new f.SchemaField({
      coloration: new f.NumberField({
        required: true, nullable: false, integer: true, initial: 1,
        choices: () => Object.values(foundry.canvas.rendering.shaders.AdaptiveLightingShader.SHADER_TECHNIQUES).map(t => t.id)
      }),
      luminosity: new f.NumberField({ required: true, nullable: false, min: 0, max: 1, initial: 0.5 }),
      attenuation: new f.NumberField({ required: true, nullable: false, min: 0, max: 1, initial: 0.5 }),
      saturation: new f.NumberField({ required: true, nullable: false, min: -1, max: 1, initial: 0 }),
      contrast: new f.NumberField({ required: true, nullable: false, min: -1, max: 1, initial: 0 }),
      shadows: new f.NumberField({ required: true, nullable: false, min: 0, max: 1, initial: 0 })
    }, { required: true, nullable: true, initial: null }),
    // The look the light takes in its source's last `endingMinutes`; null keeps the
    // full look to the end. It leaves `negative`, `angle` and `advanced` alone: those
    // say what the light is, not how much fuel it has left.
    ending: new f.SchemaField(basicLightFields(), { required: true, nullable: true, initial: null })
  });
  // The nullable strings refuse blank: a blank StringField cleans a missing value to
  // "" rather than null, and a name-only source has no uuid or type at all.
  return new f.SchemaField({
    id: new f.StringField({ required: true, blank: false }),
    uuid: new f.StringField({ required: true, nullable: true, blank: false, initial: null }),
    name: new f.StringField({ required: true, blank: false }),
    img: new f.StringField({ required: true, blank: false, initial: DEFAULT_SOURCE_IMG }),
    type: new f.StringField({ required: true, nullable: true, blank: false, initial: null }),
    managedBy: new f.StringField({ required: true, nullable: true, blank: false, initial: null }),
    consume: new f.StringField({ required: true, choices: Object.values(CONSUME_MODES), initial: CONSUME_MODES.NONE }),
    freeForAll: new f.BooleanField(),
    coverable: new f.BooleanField(),
    droppable: new f.BooleanField({ initial: true }),
    hudHidden: new f.BooleanField(),
    durationMode: new f.StringField({ required: true, choices: Object.values(DURATION_MODES), initial: DURATION_MODES.WORLD }),
    durationMinutes: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
    // How many of the last minutes before burning out each pattern shows its `ending`
    // look; 0 turns the running-low phase off.
    endingMinutes: new f.NumberField({ required: true, nullable: false, integer: true, min: 0, initial: 0 }),
    patterns: new f.ArrayField(new f.SchemaField({
      id: new f.StringField({ required: true, blank: false }),
      name: new f.StringField({ required: true, blank: true }),
      light
    }), { min: 1 }),
    // A tombstone: the GM removed the source a module registers under this id.
    removed: new f.BooleanField(),
    // Ids of the registered patterns the GM deleted from an edited source, so they are
    // not appended back as "patterns the module added since".
    removedPatterns: new f.ArrayField(new f.StringField({ blank: false }))
  });
}

/**
 * Clean one light source record and validate it strictly against `sourceField`.
 * @param {object} raw The record to check.
 * @param {string} label What to name the record in the warning.
 * @returns {object|null} The cleaned record, or null when it is invalid (a console
 *   warning says why).
 */
export function validateSource(raw, label) {
  const field = sourceField();
  let failure;
  let cleaned;
  try {
    cleaned = field.clean(foundry.utils.deepClone(raw ?? {}));
    failure = field.validate(cleaned, { strict: true, fallback: false });
  } catch(err) {
    failure = err;
  }
  if ( !failure ) return cleaned;
  console.warn(`${MODULE_ID} | Skipping invalid light source "${label}".`, failure.asError?.() ?? failure);
  return null;
}

/**
 * What modules registered through `registerSources`, by source id, in registration
 * order. Never persisted: every client rebuilds it each session, so it always matches
 * the modules active there, and a player's client never has to write a world setting.
 * @type {Map<string, object>}
 */
const registered = new Map();

/**
 * Add or replace a registered source.
 * @param {object} record A validated source record.
 */
export function setRegisteredSource(record) {
  registered.set(record.id, record);
}

/**
 * The source a module registered under an id, as it registered it.
 * @param {string} id The source id.
 * @returns {object|null} A deep clone, or null when no module registered that id.
 */
export function getRegisteredSource(id) {
  return foundry.utils.deepClone(registered.get(id) ?? null);
}

/**
 * Read the GM's own records from the world setting. A deep clone, so callers can
 * mutate freely before saving.
 * @returns {object[]} The GM records.
 */
export function getGmSources() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTINGS.GM_SOURCES)) ?? [];
}

/**
 * Persist the GM's own records. The setting's type validates every record and
 * rejects the whole write when one is invalid.
 * @param {object[]} records The GM records to save.
 * @returns {Promise<object[]>} The stored setting value.
 */
export async function setGmSources(records) {
  return game.settings.set(MODULE_ID, SETTINGS.GM_SOURCES, records);
}

/**
 * The light sources in effect on this client: every registered source, with the GM's
 * replacement applied and the ones the GM removed left out, followed by the GM's own.
 * A deep clone, so callers can mutate freely.
 * @returns {object[]} The effective light sources.
 */
export function getSources() {
  const gm = new Map(getGmSources().map(r => [r.id, r]));
  const sources = [];
  for ( const reg of registered.values() ) {
    const own = gm.get(reg.id);
    gm.delete(reg.id);
    if ( own?.removed ) continue;
    sources.push(own ? applyOverride(reg, own) : foundry.utils.deepClone(reg));
  }
  // What is left is the GM's own, or a replacement whose module is not active here.
  // Either stands as a source by itself, because the record is complete.
  for ( const own of gm.values() ) {
    if ( !own.removed ) sources.push(own);
  }
  return sources;
}

/**
 * Apply the GM's replacement to a registered source. The GM's record wins entirely,
 * except for the Item metadata, which this module never edits, and for the patterns
 * the module has added since the GM saved, which are appended so the GM sees them.
 * @param {object} reg The registered source.
 * @param {object} own The GM's record with the same id.
 * @returns {object} The effective source.
 */
function applyOverride(reg, own) {
  const known = new Set([...own.patterns.map(p => p.id), ...own.removedPatterns]);
  return {
    ...own,
    name: reg.name,
    img: reg.img,
    type: reg.type,
    managedBy: reg.managedBy,
    patterns: [...own.patterns, ...foundry.utils.deepClone(reg.patterns.filter(p => !known.has(p.id)))]
  };
}

/**
 * Change the GM's record for a source, creating it from the source in effect the
 * first time a source a module registers is edited. From then on the record replaces
 * the registered values (see `getSources`) until it is restored. Shared by
 * the configuration window and the light editor.
 * @param {string} id The source id.
 * @param {function(object): void} mutate Changes the record in place.
 * @returns {Promise<void>}
 */
export async function editSource(id, mutate) {
  const records = getGmSources();
  let record = records.find(r => r.id === id);
  if ( !record ) {
    record = getSources().find(s => s.id === id);
    if ( !record ) return;
    records.push(record);
  }
  mutate(record);
  await setGmSources(records);
}


/**
 * The GM's tombstones, for the configuration window's list of removed sources. A
 * tombstone over a source that is registered on this client shows that source's
 * current Item metadata.
 * @returns {object[]} The removed sources.
 */
export function getRemovedSources() {
  return getGmSources()
    .filter(r => r.removed)
    .map(r => {
      const reg = registered.get(r.id);
      return reg ? { ...r, name: reg.name, img: reg.img, type: reg.type, managedBy: reg.managedBy } : r;
    });
}

/**
 * The item types (of the detected system) enabled as light sources.
 * @returns {string[]} The enabled item type ids.
 */
export function getItemTypes() {
  return game.settings.get(MODULE_ID, SETTINGS.ITEM_TYPES) ?? [];
}

/**
 * The actor types (of the detected system) that may carry and light sources.
 * @returns {string[]} The enabled actor type ids.
 */
export function getActorTypes() {
  return game.settings.get(MODULE_ID, SETTINGS.ACTOR_TYPES) ?? [];
}

/**
 * Whether "free for all" lights may be dropped on the ground. Dropping only ever
 * relocates an already-lit light and never consumes anything, so a free-for-all
 * source — which has no item behind it — could otherwise be lit and dropped
 * without limit, filling a scene with AmbientLights at no cost. GMs who don't
 * want that switch it off.
 * @returns {boolean} True when free-for-all lights may be dropped.
 */
export function getAllowFreeForAllDrop() {
  return game.settings.get(MODULE_ID, SETTINGS.ALLOW_FREE_FOR_ALL_DROP) ?? true;
}

/**
 * Whether only the GM may activate, deactivate, drop or pick up a light source
 * from the Token HUD. Players still see the palette and the lit/unlit state, but
 * their clicks on those controls are refused with a warning (see
 * `guardPlayerControl` in `token-hud.js`) — this is a client-side courtesy gate,
 * consistent with the rest of the module's actor-write trust model, not a
 * permission enforced against direct document writes.
 * @returns {boolean} True when players are barred from working the controls.
 */
export function getRestrictPlayerControl() {
  return game.settings.get(MODULE_ID, SETTINGS.RESTRICT_PLAYER_CONTROL) ?? false;
}

/**
 * Whether lighting a source should post the "{actor} lights {item}" chat card.
 * Gates only that announcement — extinguishing, dropping, picking up and
 * burning out keep announcing regardless, since a GM who wants quieter chat
 * about *lighting* still typically wants those other events called out.
 * @returns {boolean} True when lighting a source announces in chat.
 */
export function getAnnounceLit() {
  return game.settings.get(MODULE_ID, SETTINGS.ANNOUNCE_LIT) ?? true;
}

/**
 * The dotted path (from an item's root) to its quantity, as configured for the
 * detected system. Empty when the system has no quantity concept configured.
 * @returns {string} The quantity path (e.g. "system.quantity"), or "".
 */
export function getQuantityPath() {
  return game.settings.get(MODULE_ID, SETTINGS.QUANTITY_PATH) ?? "";
}

/**
 * The dotted path (from an item's root) to how many charges it has left, as
 * configured for the detected system. Empty when the system has no charges configured.
 * @returns {string} The charges path (e.g. "system.uses.value"), or "".
 */
export function getChargesPath() {
  return game.settings.get(MODULE_ID, SETTINGS.CHARGES_PATH) ?? "";
}

/**
 * The dotted path (from an item's root) to how many charges it has used, for a
 * system that stores the count going up. Empty when charges are written through
 * the charges path itself.
 * @returns {string} The spent-charges path (e.g. "system.uses.spent"), or "".
 */
export function getChargesSpentPath() {
  return game.settings.get(MODULE_ID, SETTINGS.CHARGES_SPENT_PATH) ?? "";
}

/**
 * The burn time an Item kept from a charge put out before it burned down (see
 * `FLAGS.BURN_LEFT`).
 * @param {Item} item The item to read.
 * @returns {number} Whole seconds left, or 0 when nothing is kept.
 */
export function getBurnLeft(item) {
  return Number(item.getFlag(MODULE_ID, FLAGS.BURN_LEFT)) || 0;
}

/**
 * How many of what `mode` spends an Item has left: copies through the quantity path,
 * charges through the charges path. NaN when the path is unset or does not resolve to a
 * number, which callers treat as "unknown": always available, never spent.
 * @param {Item} item The item to read.
 * @param {string} mode The source's `consume` mode (see CONSUME_MODES).
 * @returns {number} What the item has left, or `NaN` when it cannot be determined.
 */
export function getItemRemaining(item, mode) {
  const path = mode === CONSUME_MODES.CHARGE ? getChargesPath() : getQuantityPath();
  if ( !path ) return NaN;
  return Number(foundry.utils.getProperty(item, path));
}

/**
 * List the document types the active system registers for a given document,
 * with a localized label, sorted by label. The abstract `base` type is
 * excluded. Used to populate the compatibility configuration's type lists.
 * @param {string} documentName The document name ("Item", "Actor", ...).
 * @returns {Array<{value: string, label: string}>} The available types.
 */
export function listDocumentTypes(documentName) {
  const labels = CONFIG[documentName]?.typeLabels ?? {};
  const types = game.documentTypes?.[documentName] ?? Object.keys(labels);
  return types
    .filter(type => type && (type !== CONST.BASE_DOCUMENT_TYPE))
    .map(type => {
      const key = labels[type];
      return { value: type, label: (key && game.i18n.has(key)) ? game.i18n.localize(key) : type };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Find the items in an Actor's inventory matching a registered light source,
 * using a two-tier strategy. When the source has a `uuid` (it was registered
 * by dragging a real Item), items are first matched by `_stats.compendiumSource`
 * — the origin UUID core stamps on a copy made from a compendium (v14 no longer
 * writes the old `flags.core.sourceId`) — so a source keeps matching even after
 * the player renames the item on their sheet, or a translation module renames it.
 * If that yields nothing (the item was not copied from that compendium entry, e.g.
 * it came from a world Item, or the source has no `uuid`
 * at all because it was registered by name only), matching falls back to name
 * (and, when the source has a `type`, that type too — a name-only source has
 * no type and matches by name alone).
 *
 * What is left gates only a source that spends what it matches. For a source that
 * spends a copy or a charge, an item worn down to 0 is excluded: it is kept in the
 * inventory rather than deleted, but stops being available for consumption or display
 * in the Token HUD — unless it kept the burn time of a charge put out early, which
 * lights without spending one (see `getBurnLeft`). A source that spends nothing never reads the number, so its item
 * matches at any count — which is what lets a reusable tool (a lantern, a glowing
 * blade) work in a system where the configured path is optional per item and rests at 0.
 * Items whose count cannot be determined (no path configured) are always treated as
 * available.
 * @param {Actor} actor The actor whose inventory is searched.
 * @param {object} source A light source definition ({name, type, uuid, ...}).
 *   `type` and `uuid` may be null/absent for a source registered by name only.
 * @param {object} [options={}]
 * @param {boolean} [options.anyCount=false] Match items worn down to 0 too — for
 *   finding the Item a flame burns on, which its last charge took to 0.
 * @returns {Item[]} The matching embedded Items available to this source.
 */
export function findMatchingItems(actor, source, { anyCount = false } = {}) {
  const available = item => {
    // "Empty" and "not a light source" are different questions: only the item that
    // will actually be spent is gated on what it has left.
    if ( anyCount || (source.consume === CONSUME_MODES.NONE) ) return true;
    // A charge put out half burned is still there to burn, even after the last one was spent.
    if ( (source.consume === CONSUME_MODES.CHARGE) && (getBurnLeft(item) > 0) ) return true;
    const remaining = getItemRemaining(item, source.consume);
    return !Number.isFinite(remaining) || (remaining > 0);
  };

  if ( source.uuid ) {
    const bySource = actor.items.filter(i => (i._stats?.compendiumSource === source.uuid) && available(i));
    if ( bySource.length ) return bySource;
  }

  return actor.items.filter(i => {
    if ( i.name !== source.name ) return false;
    if ( source.type && (i.type !== source.type) ) return false;
    return available(i);
  });
}

/**
 * Whether a token can reach a point on the canvas: the same square it stands on, or
 * one of the squares around it. The module's one definition of "close enough to
 * touch", shared by picking a light up off the ground and by working an interactive
 * light's control on the map.
 *
 * Reach is delegated to the scene's own grid rather than measured by hand, so the
 * rule follows whatever grid the scene uses. Three core behaviours this relies on:
 * `testAdjacency` compares grid offsets and is `false` for the *same* offset, so
 * the "standing on it" case has to be tested separately; on a square grid it honours
 * the scene's diagonal rule, narrowing to the four orthogonal neighbours when
 * diagonals are illegal; and on a gridless scene it always returns `false`, which
 * would put everything out of reach, so distance falls back to one grid unit there.
 * @param {foundry.canvas.placeables.Token} token The token reaching out.
 * @param {{x: number, y: number}} point The point being reached for.
 * @returns {boolean} True when the point is within the token's reach.
 */
export function isWithinReach(token, point) {
  const grid = canvas.grid;
  if ( !token || !grid ) return false;

  const origin = token.center;
  if ( grid.isGridless ) return Math.hypot(point.x - origin.x, point.y - origin.y) <= grid.size;

  const a = grid.getOffset(origin);
  const b = grid.getOffset(point);
  if ( (a.i === b.i) && (a.j === b.j) ) return true;
  return grid.testAdjacency(origin, point);
}

/**
 * Whether a ground light belongs to another package right now: it was placed through
 * the public API on that package's behalf, and that package is still running to hand
 * it back. Decided at read time rather than stored, so a light whose owner is later
 * disabled becomes an ordinary ground light again — picked up from the Token HUD and
 * switched on the map — instead of being stranded where nothing can ever claim it.
 * The owner may be a system as well as a module.
 * @param {AmbientLightDocument} light The light to test.
 * @returns {boolean} True when another active package owns the light.
 */
export function isManagedElsewhere(light) {
  const owner = light.getFlag(MODULE_ID, FLAGS.GROUND_LIGHT)?.managedBy;
  if ( !owner ) return false;
  return (owner === game.system.id) || !!game.modules.get(owner)?.active;
}

/**
 * Find a light lying on the ground within reach of a token, on the token's own level.
 * A light another package manages is left out: that package hands it back along with its own document.
 * @param {foundry.canvas.placeables.Token} token The token reaching for a light.
 * @returns {AmbientLightDocument|null} The dropped light in reach, or null.
 */
export function findGroundLight(token) {
  for ( const light of (canvas.scene?.lights ?? []) ) {
    if ( !light.getFlag(MODULE_ID, FLAGS.GROUND_LIGHT) || isManagedElsewhere(light) ) continue;
    // Reach is measured on the map's x/y alone, so a torch one floor up at the same spot
    // would otherwise be in reach.
    if ( !light.includedInLevel(token.document.level) ) continue;
    if ( isWithinReach(token, { x: light.x, y: light.y }) ) return light;
  }
  return null;
}

/**
 * Build the ChatMessage data announcing a light event, wrapping the text in the
 * module's standard chat card and speaking as the actor involved. Returns the
 * creation data rather than creating the document, so callers can batch several
 * announcements into one operation (see `sweepLights` in `light-manager.js`).
 * @param {Actor} [actor] The actor the message speaks for. May be omitted for a
 *   light with no actor left to speak for it (a torch that burned out on the ground
 *   after its owner's token was removed), which yields a generic speaker.
 * @param {string} title The card's header text, already localized.
 * @param {string} message The card's body text, already localized.
 * @returns {object} ChatMessage creation data ({content, speaker}).
 */
export function buildLightMessage(actor, title, message) {
  return {
    content: buildChatCard(title, `<p style="color: #fff; margin: 0;">${message}</p>`),
    speaker: ChatMessage.implementation.getSpeaker({ actor })
  };
}

/**
 * Build the module's standard chat card: a bordered, accent-colored header
 * over a themed background image with a dark overlay for legibility.
 * Every rule is inlined so the card renders identically for all connected
 * clients regardless of their installed modules/system CSS.
 * @param {string} title The header text (rendered upper-case via CSS).
 * @param {string} bodyHtml HTML injected into the foreground content container.
 * @param {object} [options={}] Card appearance overrides.
 * @param {string} [options.titleColor=CHAT_CARD_ACCENT] Accent color for the border and title.
 * @param {number} [options.overlayOpacity=0.85] Opacity of the dark background overlay (0-1).
 * @returns {string} Complete HTML ready to use as a ChatMessage's content.
 */
export function buildChatCard(title, bodyHtml, { titleColor = CHAT_CARD_ACCENT, overlayOpacity = 0.85 } = {}) {
  return `
  <div class="chat-card" style="border: 2px solid ${titleColor}; border-radius: 8px; overflow: hidden;">
    <header class="card-header flexrow" style="background: #191919 !important; padding: 8px; border-bottom: 2px solid ${titleColor};">
      <h3 class="noborder" style="margin: 0; font-weight: bold; color: ${titleColor} !important; font-family: 'Aleo', serif; text-align: center; text-transform: uppercase; letter-spacing: 1px; width: 100%;">
        ${title}
      </h3>
    </header>
    <div class="card-content" style="background-image: url('${CHAT_CARD_BG}'); background-repeat: no-repeat; background-position: center; background-size: cover; padding: 20px; min-height: 120px; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; position: relative;">
      <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, ${overlayOpacity}); z-index: 0;"></div>
      <div style="position: relative; z-index: 1; width: 100%; display: flex; flex-direction: column; align-items: center;">
        ${bodyHtml}
      </div>
    </div>
  </div>`;
}
