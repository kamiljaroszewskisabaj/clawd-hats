"use strict";

// Adds custom head accessories (the HATS list below) and mouth-slot accessories
// (MOUTH_ITEMS) to Clawd on Desk.
//
// Patches resources/app.asar in place of a full repack: the edited source files
// are appended to the archive data and their header entries repointed, so every
// other entry keeps its exact bytes and its unpacked flag (the Claude Code hooks
// run from app.asar.unpacked and must stay where they are).
//
// Mouth items are placed with the head slot's per-animation frames, because the
// stock mouth frames sit on the mouth corner for the cigarette. The three places
// that look up accessory frames are rewired to use the head attachments for these
// ids. theme.json is left untouched on purpose: v1.3.0 passes the whole theme
// config to the pet renderer on its command line, which is already close to the
// Windows limit, and extra frame data there stops the renderer from launching.
//
// Usage (Clawd on Desk must be closed):
//   node install-hats.js            patch the installed app
//   node install-hats.js --out X    write the patched archive to X instead
//
// Re-run after an app update. Parts already present are skipped, so it is a
// no-op when everything is installed.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { execSync } = require("child_process");

const RESOURCES = path.join(process.env.LOCALAPPDATA, "Programs", "Clawd on Desk", "resources");
const ASAR = path.join(RESOURCES, "app.asar");
const UNPACKED_ACCESSORIES = path.join(RESOURCES, "app.asar.unpacked", "assets", "accessories");
const BACKUP_DIR = path.join(__dirname, "backup");

const CATALOG_PATH = "src/pet-customization-catalog.js";
const I18N_PATH = "src/settings-i18n.js";

// Label order follows the language blocks in settings-i18n.js: en, zh, zh-TW, ko, ja, pt-BR, es.
// widthScale = viewBox width / 16 keeps one hat pixel per body pixel; offsetY 0.5
// rests the bottom row on the top row of Clawd's head.
const HATS = [
  {
    id: "hard-hat",
    labelKey: "accessoryHardHat",
    viewBox: { x: 0, y: 0, width: 13, height: 6 },
    widthScale: 0.8125,
    offsetY: 0.5,
    labels: ["Hard hat", "安全帽", "安全帽", "안전모", "工事用ヘルメット", "Capacete de obra", "Casco de obra"],
  },
  {
    id: "beanie",
    labelKey: "accessoryBeanie",
    viewBox: { x: 0, y: 0, width: 13, height: 7 },
    widthScale: 0.8125,
    offsetY: 0.5,
    labels: ["Beanie", "毛线帽", "毛線帽", "비니", "ニット帽", "Gorro", "Gorro de lana"],
  },
  {
    id: "crown",
    labelKey: "accessoryCrown",
    viewBox: { x: 0, y: 0, width: 11, height: 6 },
    widthScale: 0.6875,
    offsetY: 0.5,
    labels: ["Crown", "王冠", "王冠", "왕관", "王冠", "Coroa", "Corona"],
  },
];

// Mouth-slot items use the head slot's frames (cx 7.5, baseY 6.5, width 16,
// following the body), so they are placed like hats: offsetY 8.5 puts the
// scarf's bottom row on body row 14, its band on rows 10 and 11.
const MOUTH_ITEMS = [
  {
    id: "scarf",
    labelKey: "accessoryScarf",
    viewBox: { x: 0, y: 0, width: 13, height: 5 },
    widthScale: 0.8125,
    offsetY: 8.5,
    labels: ["Scarf", "围巾", "圍巾", "목도리", "マフラー", "Cachecol", "Bufanda"],
  },
];

// Frame lookups that get rewired for MOUTH_ITEMS. `ids` is replaced with the id
// list; the marker comment lets a re-run update the list instead of patching twice.
const MARKER = "/*hats:head-frame-mouth-items*/";
const FRAME_REWIRES = [
  {
    file: "src/renderer.js",
    from: "attachments: slot.attachments,",
    to: 'attachments: (slotName === "mouth" && IDS.includes(slot.payload.id) && getAccessorySlot("head").attachments) || slot.attachments,',
  },
  {
    file: "src/hit-geometry.js",
    from: "const attachments = theme.customization && theme.customization[field];",
    to: 'const attachments = theme.customization && theme.customization[slot === "mouth" && IDS.includes(payload.id) ? "accessories" : field];',
  },
  {
    file: "src/pet-accessory-hitbox.js",
    from: 'const field = slot === "mouth" ? "mouthAccessories" : "accessories";',
    to: 'const field = slot === "mouth" && !IDS.includes(itemId) ? "mouthAccessories" : "accessories";',
  },
];

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function integrity(buf) {
  const blockSize = 4 * 1024 * 1024;
  const blocks = [];
  for (let i = 0; i < buf.length; i += blockSize) blocks.push(sha256(buf.subarray(i, i + blockSize)));
  return { algorithm: "SHA256", hash: sha256(buf), blockSize, blocks };
}

function readArchive(file) {
  const buf = fs.readFileSync(file);
  const headerSize = buf.readUInt32LE(4);
  const jsonLen = buf.readUInt32LE(12);
  const header = JSON.parse(buf.subarray(16, 16 + jsonLen).toString("utf8"));
  return { header, data: buf.subarray(8 + headerSize) };
}

function writeArchive(file, header, chunks) {
  const json = Buffer.from(JSON.stringify(header), "utf8");
  const padded = (json.length + 3) & ~3;
  const headerPickle = Buffer.alloc(8 + padded);
  headerPickle.writeUInt32LE(4 + padded, 0);
  headerPickle.writeUInt32LE(json.length, 4);
  json.copy(headerPickle, 8);
  const sizePickle = Buffer.alloc(8);
  sizePickle.writeUInt32LE(4, 0);
  sizePickle.writeUInt32LE(headerPickle.length, 4);
  fs.writeFileSync(file, Buffer.concat([sizePickle, headerPickle, ...chunks]));
}

function entry(header, filePath, create = false) {
  const parts = filePath.split("/");
  let node = header;
  for (const dir of parts.slice(0, -1)) {
    if (!node.files || !node.files[dir]) throw new Error(`missing directory in archive: ${dir}`);
    node = node.files[dir];
  }
  const name = parts[parts.length - 1];
  if (!node.files[name] && create) node.files[name] = {};
  if (!node.files[name]) throw new Error(`missing file in archive: ${filePath}`);
  return node.files[name];
}

function packedContent(archive, filePath) {
  const e = entry(archive.header, filePath);
  if (e.unpacked) throw new Error(`${filePath} is unpacked; expected it inside the archive`);
  const offset = Number(e.offset);
  return archive.data.subarray(offset, offset + e.size).toString("utf8");
}

function catalogLine(item) {
  const vb = item.viewBox;
  return `  freezeAccessory({ id: "${item.id}", labelKey: "${item.labelKey}", file: "${item.id}.svg", `
    + `viewBox: { x: ${vb.x}, y: ${vb.y}, width: ${vb.width}, height: ${vb.height} }, `
    + `widthScale: ${item.widthScale}, offsetY: ${item.offsetY} }),`;
}

// New hats go directly above the halo, so the menu keeps hats together.
function patchCatalog(src, hats) {
  const anchor = src.match(/^  freezeAccessory\(\{ id: "halo"[^\r\n]*(\r?\n)/m);
  if (!anchor) throw new Error("halo entry not found in catalog; app layout has changed");
  const lines = hats.map((hat) => catalogLine(hat) + anchor[1]).join("");
  return src.replace(anchor[0], lines + anchor[0]);
}

// New mouth items go at the end of the mouth catalog, after the cigarette.
function patchMouthCatalog(src, items) {
  const anchor = src.match(/(const PET_MOUTH_ACCESSORY_CATALOG = Object\.freeze\(\[[\s\S]*?)(\r?\n)(\]\);)/);
  if (!anchor) throw new Error("mouth catalog not found; app layout has changed");
  const eol = anchor[2];
  const lines = items.map((item) => eol + catalogLine(item)).join("");
  return src.replace(anchor[0], anchor[1] + lines + eol + anchor[3]);
}

// Labels go directly above the anchor key in each language block.
function patchI18n(src, items, anchorKey) {
  let index = 0;
  const pattern = new RegExp(`^([ \\t]*)${anchorKey}: "[^"]*",(\\r?\\n)`, "gm");
  const out = src.replace(pattern, (line, indent, eol) => {
    const added = items.map((item) => {
      const label = item.labels[index];
      if (!label) throw new Error(`no ${item.id} label for language block ${index + 1}`);
      return `${indent}${item.labelKey}: "${label}",${eol}`;
    }).join("");
    index++;
    return added + line;
  });
  const expected = items[0].labels.length;
  if (index !== expected) throw new Error(`expected ${expected} ${anchorKey} labels, found ${index}; app layout has changed`);
  return out;
}

function patchFrameRewire(src, rewire, ids) {
  const list = JSON.stringify(ids) + MARKER;
  const patched = /\[(?:"[a-z0-9-]+"(?:,"[a-z0-9-]+")*)?\]\/\*hats:head-frame-mouth-items\*\//;
  if (patched.test(src)) return src.replace(patched, list);
  const count = src.split(rewire.from).length - 1;
  if (count !== 1) throw new Error(`expected one "${rewire.from}" in ${rewire.file}, found ${count}; app layout has changed`);
  return src.replace(rewire.from, rewire.to.replace("IDS", list));
}

function main() {
  const outIndex = process.argv.indexOf("--out");
  const outFile = outIndex > 0 ? path.resolve(process.argv[outIndex + 1]) : null;

  if (!outFile) {
    const running = execSync('tasklist /FI "IMAGENAME eq Clawd on Desk.exe" /NH', { encoding: "utf8" });
    if (running.includes("Clawd on Desk.exe")) throw new Error("Clawd on Desk is running; quit it first");
  }

  const archive = readArchive(ASAR);
  const sources = {};
  for (const filePath of [CATALOG_PATH, I18N_PATH, ...FRAME_REWIRES.map((rewire) => rewire.file)]) {
    sources[filePath] = packedContent(archive, filePath);
  }
  const patched = { ...sources };
  const missingHats = HATS.filter((hat) => !sources[CATALOG_PATH].includes(`id: "${hat.id}"`));
  const missingMouth = MOUTH_ITEMS.filter((item) => !sources[CATALOG_PATH].includes(`id: "${item.id}"`));
  if (missingHats.length > 0) {
    patched[CATALOG_PATH] = patchCatalog(patched[CATALOG_PATH], missingHats);
    patched[I18N_PATH] = patchI18n(patched[I18N_PATH], missingHats, "accessoryHalo");
  }
  if (missingMouth.length > 0) {
    patched[CATALOG_PATH] = patchMouthCatalog(patched[CATALOG_PATH], missingMouth);
    patched[I18N_PATH] = patchI18n(patched[I18N_PATH], missingMouth, "accessoryCigarette");
  }
  if (MOUTH_ITEMS.length > 0) {
    const ids = MOUTH_ITEMS.map((item) => item.id);
    for (const rewire of FRAME_REWIRES) patched[rewire.file] = patchFrameRewire(patched[rewire.file], rewire, ids);
  }

  const changed = Object.keys(sources).filter((filePath) => patched[filePath] !== sources[filePath]);
  const newItems = [...missingHats, ...missingMouth];
  // Installed items whose artwork changed since: the SVG is rewritten and its
  // header entry (size, integrity) updated to match.
  const restyled = [...HATS, ...MOUTH_ITEMS].filter((item) => {
    if (newItems.includes(item)) return false;
    const installed = path.join(UNPACKED_ACCESSORIES, `${item.id}.svg`);
    return !fs.existsSync(installed) || !fs.readFileSync(installed).equals(fs.readFileSync(path.join(__dirname, `${item.id}.svg`)));
  });
  if (changed.length === 0 && restyled.length === 0) {
    console.log("Everything is already installed; nothing to do.");
    return;
  }

  const files = {};
  for (const filePath of changed) files[filePath] = Buffer.from(patched[filePath], "utf8");
  let offset = archive.data.length;
  for (const [filePath, buf] of Object.entries(files)) {
    const e = entry(archive.header, filePath);
    e.offset = String(offset);
    e.size = buf.length;
    e.integrity = integrity(buf);
    offset += buf.length;
  }

  const svgs = {};
  for (const item of [...newItems, ...restyled]) {
    const svg = fs.readFileSync(path.join(__dirname, `${item.id}.svg`));
    const svgEntry = entry(archive.header, `assets/accessories/${item.id}.svg`, true);
    for (const key of Object.keys(svgEntry)) delete svgEntry[key];
    Object.assign(svgEntry, { size: svg.length, unpacked: true, integrity: integrity(svg) });
    svgs[item.id] = svg;
  }

  const target = outFile || ASAR;
  if (!outFile) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    fs.copyFileSync(ASAR, path.join(BACKUP_DIR, `app.asar.${stamp}`));
  }
  const tmp = `${target}.tmp`;
  writeArchive(tmp, archive.header, [archive.data, ...Object.values(files)]);
  fs.renameSync(tmp, target);
  if (!outFile) {
    for (const [id, svg] of Object.entries(svgs)) fs.writeFileSync(path.join(UNPACKED_ACCESSORIES, `${id}.svg`), svg);
  }

  if (newItems.length > 0) console.log(`Added: ${newItems.map((item) => item.id).join(", ")}`);
  if (restyled.length > 0) console.log(`Updated artwork: ${restyled.map((item) => item.id).join(", ")}`);
  console.log(`Patched archive written to ${target}${changed.length > 0 ? ` (${changed.join(", ")})` : " (header only)"}`);
}

main();
