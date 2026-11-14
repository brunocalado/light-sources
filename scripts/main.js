/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, SOCKET_EVENT, SYSTEM_PRESETS, EXPIRY_EVENT, CHAT_EVENTS } from "./constants.js";
import { sourceField } from "./helpers.js";
import { LightSourcesConfig } from "./light-sources-config.js";
import { CompatibilityConfig } from "./compatibility-config.js";
import { TransferConfig } from "./transfer-config.js";
import { ChatConfig } from "./chat-config.js";
import { registerTokenHudHooks } from "./token-hud.js";
import { registerInteractiveLightHooks } from "./interactive-lights.js";
import { startExpiryTicker, sweepLights, handleSocketMessage, onDeleteItem } from "./light-manager.js";
import {
  registerSources, registerCompatibility, activate, deactivate, getActive, dropLightWithItem, pickupGroundLight,
  handOverLight, handleHandOverQuery
} from "./api.js";

Hooks.once("init", () => {
  // Registered in init: core caches the list of expiry events the first time it reads it.
  CONFIG.ActiveEffect.expiryEvents[EXPIRY_EVENT] = "LIGHTSOURCES.Effect.ExpiryEvent";

  // Registered on every client, since `User#query` refuses a name it does not know; the
  // handler itself refuses anywhere but a GM.
  CONFIG.queries[`${MODULE_ID}.handOverLight`] = handleHandOverQuery;

  // Seed the compatibility settings from the active system's preset (if any) so
  // known systems work out of the box; unknown systems start fully unconfigured.
  const preset = SYSTEM_PRESETS[game.system.id] ?? {};

  // Only the GM's own records are stored; what modules register lives in memory.
  // A DataField type makes core clean and strictly validate every write, which
  // rejects before anything reaches the server.
  game.settings.register(MODULE_ID, SETTINGS.GM_SOURCES, {
    scope: "world",
    config: false,
    type: new foundry.data.fields.ArrayField(sourceField())
  });

  game.settings.register(MODULE_ID, SETTINGS.ITEM_TYPES, {
    scope: "world",
    config: false,
    type: Array,
    default: preset.itemTypes ?? []
  });

  game.settings.register(MODULE_ID, SETTINGS.ACTOR_TYPES, {
    scope: "world",
    config: false,
    type: Array,
    default: preset.actorTypes ?? []
  });

  game.settings.register(MODULE_ID, SETTINGS.QUANTITY_PATH, {
    scope: "world",
    config: false,
    type: String,
    default: preset.quantityPath ?? ""
  });

  game.settings.register(MODULE_ID, SETTINGS.CHARGES_PATH, {
    scope: "world",
    config: false,
    type: String,
    default: preset.chargesPath ?? ""
  });

  game.settings.register(MODULE_ID, SETTINGS.CHARGES_SPENT_PATH, {
    scope: "world",
    config: false,
    type: String,
    default: preset.chargesSpentPath ?? ""
  });

  game.settings.register(MODULE_ID, SETTINGS.ALLOW_FREE_FOR_ALL_DROP, {
    name: "LIGHTSOURCES.Settings.AllowFreeForAllDrop.Name",
    hint: "LIGHTSOURCES.Settings.AllowFreeForAllDrop.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.RESTRICT_PLAYER_CONTROL, {
    name: "LIGHTSOURCES.Settings.RestrictPlayerControl.Name",
    hint: "LIGHTSOURCES.Settings.RestrictPlayerControl.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  // One Boolean per announcement, all on. A key added to CHAT_EVENTS later reads as its
  // `initial` in a world that stored the older object, since core cleans on read.
  const { SchemaField, BooleanField } = foundry.data.fields;
  game.settings.register(MODULE_ID, SETTINGS.CHAT_MESSAGES, {
    scope: "world",
    config: false,
    type: new SchemaField(Object.fromEntries(CHAT_EVENTS.map(e => [e, new BooleanField({ initial: true })])))
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.MENU, {
    name: "LIGHTSOURCES.Settings.Menu.Name",
    label: "LIGHTSOURCES.Settings.Menu.Label",
    hint: "LIGHTSOURCES.Settings.Menu.Hint",
    icon: "fa-solid fa-fire-flame-curved",
    type: LightSourcesConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.COMPAT_MENU, {
    name: "LIGHTSOURCES.Settings.Compat.Name",
    label: "LIGHTSOURCES.Settings.Compat.Label",
    hint: "LIGHTSOURCES.Settings.Compat.Hint",
    icon: "fa-solid fa-gears",
    type: CompatibilityConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.TRANSFER_MENU, {
    name: "LIGHTSOURCES.Settings.Transfer.Name",
    label: "LIGHTSOURCES.Settings.Transfer.Label",
    hint: "LIGHTSOURCES.Settings.Transfer.Hint",
    icon: "fa-solid fa-file-export",
    type: TransferConfig,
    restricted: true
  });

  game.settings.registerMenu(MODULE_ID, SETTINGS.CHAT_MENU, {
    name: "LIGHTSOURCES.Settings.Chat.Name",
    label: "LIGHTSOURCES.Settings.Chat.Label",
    hint: "LIGHTSOURCES.Settings.Chat.Hint",
    icon: "fa-solid fa-comment",
    type: ChatConfig,
    restricted: true
  });
});

Hooks.once("ready", () => {
  startExpiryTicker();
  // Players relay GM-only work (placing and removing dropped AmbientLights) over
  // this socket.
  game.socket.on(SOCKET_EVENT, handleSocketMessage);

  // Public API for external systems/modules to register light sources without
  // the GM drag-and-drop UI. Exposed both via Foundry's formal module.api and a
  // convenience `game.lightSources` alias. Assigned in `ready` so settings are
  // available and compendium UUIDs can be resolved by callers.
  const api = {
    registerSources, registerCompatibility, activate, deactivate, getActive, dropLightWithItem, pickupGroundLight,
    handOverLight
  };
  game.modules.get(MODULE_ID).api = api;
  game.lightSources = api;
});

// In-game-time lights burn down with the world clock: extinguish them whenever
// it advances past their expiry, and switch the ones that crossed into or out of
// their running-low window (real-time lights are handled by the ticker).
Hooks.on("updateWorldTime", () => {
  sweepLights().catch(err => console.error(`${MODULE_ID} | World-time light sweep failed`, err));
});

// A light burning on an Item goes out when that Item leaves its actor.
Hooks.on("deleteItem", onDeleteItem);

registerTokenHudHooks();
registerInteractiveLightHooks();
