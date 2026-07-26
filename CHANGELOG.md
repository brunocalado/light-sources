# 0.0.4

### Added

* **Pick a light back up off the ground.** A light dropped on the floor is no longer gone for good. Stand a token on it — or on any square beside it — and **Pick Up Light** appears in the Token HUD's flame menu. The flame returns to the token with only the burn time it has left, and nothing is consumed: it's the same torch that was put down, not a new one off the sheet.

### Changed

* **Lights left on the ground now burn down.** A dropped light keeps counting on the very clock it had on the token and goes out on its own when its time is up, announced in chat. Previously it stayed lit forever, and picking one up would have handed back a torch with its countdown reset.
* Dropped lights now record which source and pattern they came from, so the module can tell a torch a player left behind from ambient lighting the GM placed by hand. Lights dropped before this version are ordinary scenery and cannot be picked up.

