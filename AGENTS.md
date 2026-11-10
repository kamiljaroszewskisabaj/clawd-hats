# Agent guide

Short operating guide for coding agents. `README.md` has the full background; read
it only when something here does not cover the task.

## What this repo does

Adds extra accessories to the **Clawd on Desk** desktop pet on Windows. The app has
no plugin or hat folder, so `install-hats.js` patches the installed archive:

```
%LOCALAPPDATA%\Programs\Clawd on Desk\resources\app.asar
%LOCALAPPDATA%\Programs\Clawd on Desk\resources\app.asar.unpacked\assets\accessories\<id>.svg
```

| You want to... | Edit | Then |
|---|---|---|
| Install or reinstall everything | nothing | [Install](#install) |
| Add a hat | new `<id>.svg` + entry in `HATS` | [Install](#install) |
| Add a mouth item (scarf slot) | new `<id>.svg` + entry in `MOUTH_ITEMS` | [Install](#install) |
| Recolour an installed item | its `.svg` | [Install](#install) (the script detects changed artwork) |
| Undo an install | nothing | [Rollback](#rollback) |

Requirements: Windows, Node.js, Clawd on Desk installed. Tested on app v1.0.0 and v1.3.0.

## Hard rules

1. **Never write to `theme.json`.** On v1.3.0 the theme config is passed on the
   renderer's command line, which is near the Windows length limit. Extra data there
   makes the pet vanish (`render-process-gone: launch-failed`).
2. **Never repack the archive** (`@electron/asar pack`). The script appends edited
   files and keeps every other entry byte for byte. Hooks in `app.asar.unpacked` depend on that.
3. **Never hand-edit the app's files** to get past an error. If the script reports an
   anchor or layout error, stop and report it.
4. **Always dry run before a real install.**
5. **Do not change the user's selected hat.** They pick it in the app.
6. **Do not commit `backup/`.** It holds copies of the app's own archive.

## Install

Run from the repo root, in `cmd` (the `%VAR%` paths below are cmd syntax).

1. Quit the app. It is a tray app and ignores a normal close:
   ```
   taskkill /F /IM "Clawd on Desk.exe"
   ```
2. Dry run (writes nothing to the app):
   ```
   node install-hats.js --out "%TEMP%\clawd-dry-run.asar"
   ```
   Expect `Added: ...`, `Updated artwork: ...`, or
   `Everything is already installed; nothing to do.` Any thrown error: stop, see [Errors](#errors).
3. Real install (also saves `backup\app.asar.<timestamp>` first):
   ```
   node install-hats.js
   ```
4. Confirm the pet still launches:
   ```
   "%LOCALAPPDATA%\Programs\Clawd on Desk\Clawd on Desk.exe" --enable-logging=stderr
   ```
   Pass: the pet appears and the log has no `launch-failed`. Fail: [Rollback](#rollback).
5. Report to the user: the item appears under **Settings → Theme → Head accessory**
   (hats) or **Mouth accessory** (mouth items).

The script is idempotent. Re-run it after every app update, because updates wipe the patch.

### First run on a new machine or app version

Before step 3, confirm both Electron fuses are disabled:

```
npx @electron/fuses read --app "%LOCALAPPDATA%\Programs\Clawd on Desk\Clawd on Desk.exe"
```

`EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar` must both be
**Disabled**. If either is enabled, stop: a patched archive will not start.

## Add a hat

1. **Artwork.** Copy `hard-hat.svg` to `<id>.svg` and redraw it.
   - `<id>`: lowercase letters, digits, hyphens; starts with a letter (`^[a-z][a-z0-9-]{0,63}$`).
   - `viewBox="0 0 W H"` with matching `width`/`height`, `shape-rendering="crispEdges"`.
   - Only `<rect>` elements on whole-pixel coordinates.
   - `W` odd, 11 or 13 (max 17). Keep it short: the built-in wizard hat is the height limit.
2. **Entry.** Add to `HATS` in `install-hats.js`:
   ```js
   {
     id: "top-hat",
     labelKey: "accessoryTopHat",          // "accessory" + PascalCase id, must be unique
     viewBox: { x: 0, y: 0, width: 11, height: 7 },  // same W and H as the SVG
     widthScale: 0.6875,                   // always W / 16
     offsetY: 0.5,                         // bottom row sits on top of the head
     labels: ["Top hat", "高顶礼帽", "高頂禮帽", "실크햇", "シルクハット", "Cartola", "Sombrero de copa"],
   },
   ```
   `labels` must have exactly 7 entries in this order: **en, zh, zh-TW, ko, ja, pt-BR, es**.
3. Run [Install](#install).

## Add a mouth item

Same as a hat, with three differences:

- Add the entry to `MOUTH_ITEMS`, not `HATS`.
- Start from `scarf.svg`.
- `offsetY` sets where the bottom row lands: bottom = `6.5 + offsetY` in body pixels.
  The scarf uses `8.5` (bottom on body row 14). Mouth items are positioned with the
  hat frames, so they follow the body exactly like hats.

## Rollback

1. `taskkill /F /IM "Clawd on Desk.exe"`
2. Copy the newest `backup\app.asar.<timestamp>` taken **before** the bad install
   over `resources\app.asar`. Use a backup from the same app version.
3. Delete the custom SVGs (the ids in `HATS` and `MOUTH_ITEMS`) from
   `resources\app.asar.unpacked\assets\accessories\`, unless the restored backup
   already contains those items.
4. Start the app and check it launches (Install step 4).

## Errors

| Message | Meaning | Action |
|---|---|---|
| `Clawd on Desk is running; quit it first` | App still open | `taskkill /F /IM "Clawd on Desk.exe"`, retry |
| `... not found ...; app layout has changed` | App update moved code the script anchors on | Stop. Report the app version and message. Do not patch by hand |
| `expected one "..." in src/..., found N` | Same as above, in the mouth-item rewiring | Stop and report |
| `expected 7 ... labels, found N` | App added or removed a language | Stop and report; every item's `labels` needs updating |
| `no <id> label for language block N` | N ≤ 7: that entry has too few labels. N = 8: the app added a language | Fix the `labels` array; for N = 8, stop and report |
| `missing file in archive: ...` | Wrong app or broken install | Stop and report |
| Pet gone after install, `launch-failed` in log | Renderer cannot start | [Rollback](#rollback), report |

The script checks everything before it writes, so an error means nothing was changed.
