# Clawd on Desk: custom hats

Custom head accessories for the **Clawd on Desk** desktop pet (Electron app by
rullerzhou-afk, `%LOCALAPPDATA%\Programs\Clawd on Desk`). The app has no hat
editor or user hat folder: its accessory list is hardcoded, so new hats are
added by patching the installed `app.asar`. `install-hats.js` does that.

Hats in this package: `hard-hat`, `beanie`, `crown`. Once installed they appear
under **Settings → Theme → Head accessory**, between the pumpkin hat and the halo.

Mouth-slot items: `scarf`. It appears under **Settings → Theme → Mouth accessory**,
after the cigarette, and can be worn together with any hat.

**Never add accessory data to `theme.json` on v1.3.0.** v1.3.0 passes the whole theme
config to the pet renderer on its command line, which already sits about 600
characters under the Windows limit of 32,767. A first scarf version put per-sprite
`itemOverrides` there; the renderer failed with `render-process-gone: launch-failed`
and the crab disappeared (2026-10-19, rolled back). Upstream commit `bec58ab` moves
the config to sync IPC after v1.3.0. After any install, confirm the renderer starts:
run `"Clawd on Desk.exe" --enable-logging=stderr` and check for no `launch-failed`.

**On a new machine, verify before running.** Everything below was checked
against Clawd on Desk **v1.0.0** on Windows; the mouth slot and the current
patcher against **v1.3.0**. Before the first install, confirm on
that machine: the app version, that both fuses below are disabled
(`npx @electron/fuses read --app "...\Clawd on Desk.exe"`), and that the catalog
and i18n anchors still exist. The script fails loudly if an anchor is missing,
and it never writes anything before every check has passed.

## Files

| File | Purpose |
|---|---|
| `install-hats.js` | The patcher. Holds the `HATS` and `MOUTH_ITEMS` lists and adds anything that is missing. |
| `hard-hat.svg`, `beanie.svg`, `crown.svg`, `scarf.svg` | Artwork, one file per item, named `<id>.svg`. |
| `backup/app.asar.<timestamp>` | Created by the script: archive copy taken before each install. The earliest one is the untouched original. |
| `backup/theme.json.<timestamp>` | Stock clawd `theme.json` (v1.3.0), kept from the abandoned `theme.json` approach. The script no longer touches that file. |

## Usage

Clawd on Desk must be closed. It ignores a normal close (tray app), so force it:

```
taskkill /F /IM "Clawd on Desk.exe"
node install-hats.js                 # patch the installed app
node install-hats.js --out X.asar    # dry run: write the patched archive elsewhere
```

Then start `%LOCALAPPDATA%\Programs\Clawd on Desk\Clawd on Desk.exe` again.
The script is idempotent: hats already present are skipped.

**After every app update** (it auto-updates from GitHub and the update wipes the
patch) quit the app and run `node install-hats.js` again.

## How the app handles hats (verified against v1.0.0 source)

- Catalog: `src/pet-customization-catalog.js`, `PET_ACCESSORY_CATALOG`, frozen
  `freezeAccessory({ id, labelKey, file, viewBox, widthScale, offsetY })` entries.
  Inside `app.asar`.
- Labels: `src/settings-i18n.js`, 7 language blocks in this order:
  en, zh, zh-TW, ko, ja, pt-BR, es. Inside `app.asar`.
- Artwork: `assets/accessories/<file>`. The whole folder is marked `unpacked`, so
  the real files live in `resources\app.asar.unpacked\assets\accessories\`.
- The renderer only accepts filenames matching `^[a-z][a-z0-9-]{0,63}\.svg$`.
- Both source files use **CRLF** line endings; the patcher preserves them.
- Electron fuses: `EnableEmbeddedAsarIntegrityValidation` and `OnlyLoadAppFromAsar`
  are both **disabled**, so a modified archive starts normally.

## The mouth slot (v1.3.0)

- Catalog: `PET_MOUTH_ACCESSORY_CATALOG` in the same catalog file. Labels sit next
  to `accessoryCigarette:` in each language block.
- Placement is per animation, in `themes/clawd/theme.json` (unpacked on disk) under
  `customization.mouthAccessories`. The stock frames (`cx 14, baseY 13, width 5`) sit
  on the right mouth corner for the cigarette, and `widthScale` is capped at 2.5, so
  anything wider than the cigarette cannot be placed with them.
- Per-item frames (`itemOverrides`) exist, but `src/theme-schema.js` enables them only
  for the head slot (`allowItemOverrides: false` for `customization.mouthAccessories`;
  still the case on upstream `main` as of 2026-10-19). With the flag off, an override
  in `theme.json` disables the whole mouth slot, cigarette included.
- Frame lookups happen in three places: `getAccessoryDescriptor` in `src/renderer.js`
  (drawing), `selectedAccessoryNeedsFollow` in `src/hit-geometry.js` and
  `resolveAccessoryDescriptor` in `src/pet-accessory-hitbox.js` (main process, click
  areas). The renderer always receives the head slot's attachments, selected hat
  or not (`buildRendererThemeConfig` in `src/main.js`).

## How the patcher works

It does not repack the archive. It parses the asar header, appends the two edited
source files to the end of the data section, repoints their header entries
(offset, size, SHA256 integrity) and adds an `unpacked: true` entry per new SVG.
Every other entry keeps its exact bytes and unpacked flag. This matters because
the Claude Code hooks run from `app.asar.unpacked\hooks\` and a repack could move
them. (`npx @electron/asar extract` on the original errors on a few missing arm64
koffi files; that is harmless and another reason not to repack.)

New catalog lines and labels are inserted directly above the halo entry
(`id: "halo"` / `accessoryHalo:`), so hats stay grouped in the menu.

Mouth items go at the end of the mouth catalog, with labels above
`accessoryCigarette:`. The three frame lookups above are rewired with one line each,
so for the ids in `MOUTH_ITEMS` they use the head slot's attachments: the item
follows the body wherever a hat would and hides where hats hide, and no data is added
to the renderer's command line. Each rewired line carries an id list tagged
`/*hats:head-frame-mouth-items*/`; a re-run updates that list in place. If any of the
three original lines is missing or appears more than once, the script stops before
writing.

## Adding a new hat

1. Draw `<id>.svg` as pixel art: `viewBox="0 0 W H"`, `shape-rendering="crispEdges"`,
   1×1 `<rect>` cells. Copy the style of the existing files.
2. Add an entry to `HATS` in `install-hats.js` with 7 labels in the order above.
3. Choose placement values. The app places the hat in Clawd's body coordinates
   (`pet-accessory-layout.js`, `buildAccessoryRect`), with the clawd theme frame
   `cx 7.5, baseY 6.5, width 16`:
   - drawn width = `16 × widthScale`, height = width ÷ (W/H)
   - left = `7.5 − width/2`, bottom = `6.5 + offsetY`
   - Clawd's head (torso) spans x 2 to 13 (11 px), top row y = 6.
   - Use `widthScale = W / 16` for one hat pixel per body pixel.
   - Use an **odd** W (11 or 13) so the edges land on whole pixels.
   - `offsetY: 0.5` puts the hat's bottom row on the head's top row.
   - Stay within the existing envelope (no wider than 17, no taller than the
     wizard hat): `pet-accessory-hitbox.js` sizes click areas from the built-ins.
4. Preview before installing: overlay the hat on
   `assets/svg/clawd-static-base.svg` at the computed rectangle and render it
   with headless Chrome.
5. Dry run with `--out`, extract both source files from the result with
   `npx @electron/asar extract-file` and diff them against the installed ones:
   expect one catalog line plus 7 label lines.
6. Install, then verify with Electron's own asar reader:
   `set ELECTRON_RUN_AS_NODE=1` and run `Clawd on Desk.exe` with a script that
   `require`s `...\resources\app.asar\src\pet-customization-catalog.js` and checks
   `PET_ACCESSORY_IDS` contains the new id.
7. Relaunch. Do not change the user's selected hat; they pick it themselves.

Recolouring an installed hat: replace the SVG in `app.asar.unpacked` and restart
the app. Keep the byte length identical if possible (the header records the size).

## Rollback

Quit the app, copy the backup taken before the install you want to undo over
`resources\app.asar` (use one from the same app version: the earliest backups are
v1.0.0), and delete the custom SVGs from `resources\app.asar.unpacked\assets\accessories\`.
On v1.3.0, `app.asar.2026-10-19T07-31-59-423Z` is the hats without the scarf, and
`app.asar.2026-10-19T07-01-53-623Z` is the stock archive.
