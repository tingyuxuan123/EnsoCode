#!/usr/bin/env node
/** Authoritative 小满 artwork. Run from any directory: node scripts/generate-app-icon.mjs.
 * Uses the existing sharp installation (including pnpm's unhoisted store); installs nothing.
 * ICNS uses native PNG chunks, so neither Pillow nor macOS iconutil is required.
 */
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const SIZES = [16, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [256, 128, 64, 48, 32, 16];
const BG = '#0B0C0E';
const FG = '#F4F5F6';
const DROP = '#3B82F6';

export function loadSharp() {
  try {
    return require('sharp');
  } catch {
    const store = path.join(ROOT, 'node_modules/.pnpm');
    const candidates = readdirSync(store)
      .filter((name) => name.startsWith('sharp@'))
      .sort();
    for (const name of candidates) {
      try {
        return require(path.join(store, name, 'node_modules/sharp'));
      } catch {
        // Another version may have native bindings for this platform.
      }
    }
    throw new Error('No usable sharp installation found. Run in the existing pnpm workspace.');
  }
}

// Exact geometry from eaves-logo.vetd/assets/mark-a-{body,drop}.svg; do not read
// design files at generation time, so the shipped icon has a self-contained source.
function mark(body, drop) {
  return `<g fill="none" stroke="${body}" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12 23 Q16 31 26 32 L74 32 Q84 31 88 23" stroke-width="8"/>
  <path d="M31 45 V56 M31 64 V72 M50 45 V58 M69 45 V50 M69 58 V76" stroke-width="6"/>
</g><circle cx="50" cy="70" r="4.5" fill="${drop}"/>`;
}

function svg(content, size = 1024) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 100 100">\n${content}\n</svg>\n`;
}

function appSvg({ rounded = true, maskable = false } = {}) {
  // AppIcon: 22.5% corners; mark's 100-unit box occupies 60% of the card.
  // Maskable PWA icons retain the former extra 80% safe-zone inset.
  const scale = maskable ? 0.48 : 0.6;
  const inset = (100 - scale * 100) / 2;
  return svg(`<rect width="100" height="100" rx="${rounded ? 22.5 : 0}" fill="${BG}"/>
<g transform="translate(${inset} ${inset}) scale(${scale})">${mark(FG, DROP)}</g>`);
}

/** Windows Shell layout: PNG at 256, 32-bit DIB + AND mask below 256.
 * Keep 16/32's empty AND masks / white transparent RGB from the proven old
 * generator. PNG-only small frames regress taskbar/Explorer rounded corners.
 */
function dibFrame(data, size) {
  const small = size <= 32;
  const xorSize = size * size * 4;
  const stride = Math.ceil(size / 32) * 4;
  const frame = Buffer.alloc(40 + xorSize + stride * size);
  frame.writeUInt32LE(40, 0);
  frame.writeInt32LE(size, 4);
  frame.writeInt32LE(size * 2, 8);
  frame.writeUInt16LE(1, 12);
  frame.writeUInt16LE(32, 14);
  frame.writeUInt32LE(xorSize, 20); // XOR only, not XOR + mask (Windows Shell).
  for (let y = 0; y < size; y++) {
    const row = size - y - 1;
    for (let x = 0; x < size; x++) {
      const source = (y * size + x) * 4;
      const target = 40 + (row * size + x) * 4;
      const alpha = data[source + 3] < 16 ? 0 : data[source + 3];
      const empty = small ? 255 : 0;
      frame[target] = alpha ? data[source + 2] : empty;
      frame[target + 1] = alpha ? data[source + 1] : empty;
      frame[target + 2] = alpha ? data[source] : empty;
      frame[target + 3] = alpha;
      if (!small && !alpha) frame[40 + xorSize + row * stride + (x >> 3)] |= 0x80 >> (x % 8);
    }
  }
  return frame;
}

async function ico(sharp, pngs) {
  const directory = Buffer.alloc(6 + ICO_SIZES.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(ICO_SIZES.length, 4);
  const frames = [];
  let offset = directory.length;
  for (const [i, size] of ICO_SIZES.entries()) {
    const frame =
      size === 256
        ? pngs.get(size)
        : dibFrame(await sharp(pngs.get(size)).ensureAlpha().raw().toBuffer(), size);
    const entry = 6 + i * 16;
    directory[entry] = directory[entry + 1] = size === 256 ? 0 : size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(frame.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    frames.push(frame);
    offset += frame.length;
  }
  return Buffer.concat([directory, ...frames]);
}

function icns(pngs) {
  // Apple ICNS PNG element types (macOS 10.7+); lengths include each 8-byte header.
  const types = {
    16: 'icp4',
    32: 'icp5',
    64: 'icp6',
    128: 'ic07',
    256: 'ic08',
    512: 'ic09',
    1024: 'ic10',
  };
  const chunks = Object.entries(types).map(([size, type]) => {
    const png = pngs.get(Number(size));
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(png.length + 8, 4);
    return Buffer.concat([header, png]);
  });
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  return Buffer.concat([header, ...chunks]);
}

export async function generateIcons(root = ROOT) {
  const sharp = loadSharp();
  const files = [];
  const pngSizes = new Map();
  const write = async (relative, data) => {
    const dest = path.join(root, relative);
    await mkdir(path.dirname(dest), { recursive: true });
    await writeFile(dest, data);
    files.push(relative);
  };
  const writePng = async (relative, source, size, opaque = false) => {
    let image = sharp(Buffer.from(source)).resize(size, size);
    if (opaque) image = image.removeAlpha();
    const png = await image.png().toBuffer();
    await write(relative, png);
    pngSizes.set(relative, size);
    return png;
  };

  const app = appSvg();
  const tray = svg(mark('#000000', '#000000'), 64);
  await write('build/icon.svg', app);
  await write('build/enso-mark.svg', svg(mark(BG, '#2563EB')));
  await write('build/trayTemplate.svg', tray);
  const pngs = new Map();
  pngs.set(1024, await writePng('build/icon.png', app, 1024));
  for (const size of SIZES) {
    pngs.set(size, await writePng(`build/icons/${size}x${size}.png`, app, size));
  }
  await writePng('build/icon-win.png', app, 256);
  await writePng('build/trayTemplate.png', tray, 22);
  await writePng('build/trayTemplate@2x.png', tray, 44);
  await write('build/icon.ico', await ico(sharp, pngs));
  await write('build/icon.icns', icns(pngs));
  for (const [name, size] of [
    ['apple-touch-icon', 180],
    ['icon-192', 192],
    ['icon-512', 512],
    ['icon-maskable-512', 512],
  ]) {
    await writePng(
      `packages/phone/public/icons/${name}.png`,
      appSvg({ rounded: false, maskable: name.includes('maskable') }),
      size,
      true
    );
  }

  // Read every generated PNG back through sharp, not just metadata/file existence.
  for (const file of files) {
    assert.ok((await stat(path.join(root, file))).size > 0, `${file} is empty`);
    if (!pngSizes.has(file)) continue;
    const { data, info } = await sharp(await readFile(path.join(root, file)))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, pngSizes.get(file), file);
    assert.equal(info.height, pngSizes.get(file), file);
    if (file.includes('trayTemplate')) {
      assert.ok(
        data.some((value, i) => i % 4 === 3 && value > 0),
        file
      );
      for (let i = 0; i < data.length; i += 4)
        assert.equal(data[i] + data[i + 1] + data[i + 2], 0, file);
    }
  }
  return files;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = await generateIcons();
  for (const file of files) console.log(`wrote ${file}`);
  console.log(
    `Verified ${files.length} 小满 assets; ICNS generated with PNG chunks (no iconutil needed).`
  );
}
