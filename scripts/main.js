/*!
 * Light Sources
 * Copyright (c) 2026 https://github.com/brunocalado
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { MODULE_ID, SETTINGS, SYSTEM_PRESETS } from "./constants.js";
import { LightSourcesConfig } from "./light-sources-config.js";
import { CompatibilityConfig } from "./compatibility-config.js";
import { registerTokenHudHooks } from "./token-hud.js";
import { startExpiryTicker, sweepExpiredLights, handleSocketMessage } from "./light-manager.js";
import { registerSources } from "./api.js";

Hooks.once("init", () => {
  // Seed the compatibility settings from the active system's preset (if any) so
  // known systems work out of the box; unknown systems start fully unconfigured.
  const preset = SYSTEM_PRESETS[game.system.id] ?? {};

  game.settings.register(MODULE_ID, SETTINGS.SOURCES, {
    scope: "world",
    config: false,
    type: Array,
    default: []
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
});

Hooks.once("ready", () => {
  startExpiryTicker();
  // Players relay GM-only work (placing dropped AmbientLights) over this socket.
  game.socket.on(`module.${MODULE_ID}`, handleSocketMessage);

  // Public API for external systems/modules to register light sources without
  // the GM drag-and-drop UI. Exposed both via Foundry's formal module.api and a
  // convenience `game.lightSources` alias. Assigned in `ready` so settings are
  // available and compendium UUIDs can be resolved by callers.
  const api = { registerSources };
  game.modules.get(MODULE_ID).api = api;
  game.lightSources = api;
});

// In-game-time lights burn down with the world clock: extinguish them whenever
// it advances past their expiry (real-time lights are handled by the ticker).
Hooks.on("updateWorldTime", () => {
  sweepExpiredLights().catch(err => console.error(`${MODULE_ID} | World-time expiry check failed`, err));
});

registerTokenHudHooks();
