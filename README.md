# Light Sources

**Your characters carry torches, candles and lanterns. This module makes them actually light the way — in any system.**

[![Buy Me a Coffee](https://img.shields.io/badge/Buy_Me_a_Coffee-Donate-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/mestredigital) [![More Modules](https://img.shields.io/badge/Foundry%20VTT-More%20Modules-red?style=for-the-badge&logo=gamepad)](https://mestredigital.online/pages/projetos-en)

Turn any item in a character's backpack into a real light source. One click on the token, and the darkness pulls back.

## 🕯️ Why?

The party walks into a pitch-black crypt. Someone says *"I light my torch."*

And then the table stops. The GM alt-tabs to the token settings, types a dim radius, types a bright radius, picks a color, picks an animation, closes the window... and by the time the light finally shows up on the map, the moment is gone. Later, nobody remembers to cross the torch off the character sheet, and nobody remembers when it should burn out.

**Light Sources fixes that.** The torch is already in the character's inventory, so lighting it is a single click on the token — the light appears instantly, the item is spent from the sheet, and the flame burns out on its own when its time is up. Darkness stops being paperwork and goes back to being a resource your players have to manage.

## ✨ Key Features

* 🔦 **One-click lighting.** Select a token, click the flame button on the Token HUD, and pick from the light sources available to that character. That's it.
* 🎒 **Uses the real inventory.** Only items the character actually owns show up (plus any "Free for All" sources the GM has enabled — see below). Lighting a torch can subtract it from the sheet, so a torch you burn is a torch you no longer have.
* ⏳ **Lights burn out on their own.** Give a source a duration and it goes out by itself when the time runs out — with a message in chat announcing it. No timers to babysit. Pick how each source counts down: **in-game time** (it burns as the GM advances the world clock — three real hours of chatter won't waste a torch) or **real time** (it burns in real-world minutes even while the game is paused or the player is offline).
* 🎨 **A look for every flame.** Each source gets its own light pattern: radius, angle, color, brightness and animation. A candle should feel nothing like a bullseye lantern, and here it doesn't.
* 🔀 **Multiple patterns per source.** A single item can have more than one way to shine. A lantern might have a "Low" mode with a soft glow and a "High" mode that fills the room — both appear in the Token HUD, and the player just picks the one they want.
* 👀 **See it before you save it.** While you edit a light pattern, the change is previewed live on the selected token. Tweak until it looks right — nothing is written until you hit Save.
* 🆓 **Free-for-all lights.** Mark a light source as "Free for All" and every eligible character can use it, even if they don't carry the item. Perfect for magical environmental effects, a bonfire everyone sits around, or a glowing aura that doesn't cost inventory.
* 🪔 **Drop a light on the ground.** Instead of lighting a source on your token, drop it — the item leaves your inventory and becomes an Ambient Light placed on the map at your token's feet. Walk away, and the torch stays behind on the floor. Works even for players; the module relays the request to the GM.
* 🧩 **Works with any system.** Tell the module which item types are light sources, which actor types carry them, and where an item's quantity lives — then it just works. Daggerheart comes preconfigured out of the box.
* 📏 **Handy range presets.** Radius fields come with one-click presets (Melee, Very Close, Close, Far) so you can size a light in a click instead of typing.
* 🗺️ **The light follows the character.** It stays with them across scenes, and blowing it out restores exactly the token lighting they had before.
* 💬 **Chat announcements.** When a light burns out, a styled chat card lets the whole table know. You can also send any registered light source to chat as a draggable card — drop it on an actor sheet to add it to their inventory.
* 🔌 **Developer API.** Module and system developers can [programmatically register light sources](docs/register-sources-api.md) from their own code — no manual drag-and-drop needed. Registered sources merge seamlessly with the GM's hand-picked ones.

## 🛠️ How to Use

### For the GM — set it up once

1. Open **Game Settings → Configure Settings → Light Sources → Configure System Compatibility**. Enable the **item types** that count as light sources, the **actor types** that can carry them, and enter the **item quantity path** (where your system stores an item's quantity, e.g. `system.quantity`). On Daggerheart this is already filled in for you.

   ![Configure System Compatibility](docs/system-setup.webp)

2. Open **Configure Light Sources** and drag any item of an enabled type from a compendium or the sidebar into the window to register it.

   ![Registering a light source](docs/add-light-source.webp)

3. Click the ✏️ pencil on any entry to shape it:
   * **Patterns** — add one or more light patterns for the same item (different radii, colors, animations). A lone pattern needs no name; add a second and each gets its own label in the HUD.

     ![Configuring a light pattern](docs/config-light-source.webp)

   * **Consumption** — whether lighting it uses one up, how many minutes it burns before dying out (`0` = burns forever until put out by hand), and whether that countdown runs on the **in-game clock** or on **real time**.

     ![Configuring consumption](docs/consumption.webp)

Optional per-source toggles on the config window:
* **Free for All** — when enabled, every eligible actor can light this source without carrying the item.
* **Send to Chat** — posts a draggable item card that can be dropped onto actor sheets.

Tip: select a token on the canvas while you edit — you'll watch the light change on the map in real time.

### For the players — light it up

1. Make sure the item (a Torch, a Lantern...) is in your character's inventory — however your system normally hands out items. (Skip this if the GM marked the source "Free for All" — then it's available to everyone automatically.)
2. Click your token on the map to bring up the Token HUD.
3. Click the 🔥 **flame button** and choose your light source. If the source has multiple patterns, each one shows as a separate option.
4. Done — your token is now lighting the room.

![Lighting a source from the Token HUD](docs/use-token-hud.gif)

To put it out, open the same menu and click **Extinguish Light**. If it burns out on its own first, everyone sees it happen in chat.

**Drop a light**: next to each entry in the flame menu you'll see a **Drop** button. Click it to leave the light on the ground as an Ambient Light — useful for torches left behind in a hallway or campfires.

![Dropping a light source on the ground](docs/drop-light.gif)

## 🔌 For Developers

If you maintain a game system or a companion module and want to ship pre-configured light sources, you can use the **Register Sources API** to add them with code — no GM setup needed.

👉 **[Read the full API documentation](docs/register-sources-api.md)**

Quick taste:

```js
Hooks.once("ready", async () => {
  await game.lightSources?.registerSources([
    {
      uuid: "Compendium.my-system.equipment.Item.torch01",
      patterns: [
        { name: "Standard", light: { dim: 40, bright: 20, color: "#ff8800", animation: { type: "torch", speed: 5, intensity: 5 } } }
      ],
      consume: true,
      durationMode: "world",
      durationMinutes: 60
    }
  ], { managedBy: "my-system" });
});
```

Registered sources appear in the Token HUD and in the GM's configuration window with a badge showing which module manages them.

## 🚀 Installation

Install via the Foundry VTT Module browser or use this manifest link:

```
https://raw.githubusercontent.com/brunocalado/light-sources/refs/heads/main/module.json
```

## ⚖️ Credits

* **Code License:** GNU GPLv3.

* [thumbnail/banner](https://unsplash.com/pt-br/fotografias/person-holding-torch-in-building-interior-5DIFvVwe6wka)