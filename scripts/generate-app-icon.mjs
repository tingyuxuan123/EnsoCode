#!/usr/bin/env node
/** Authoritative CodeKiln artwork. Run from any directory: node scripts/generate-app-icon.mjs.
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
// 菜单栏模板图标画布高度与剪影高度（pt）：22pt 画布、16pt 剪影。
const TRAY_CANVAS = 22;
const TRAY_GLYPH = 16;
const ARTWORK = new URL('../assets/branding/codekiln-logo.png', import.meta.url);
// 素材 2048×2048：白底包裹的深色圆角方板，板沿外还有一圈生成器光晕。
// 向内裁 18px 再按实测圆角遮罩，白底与光晕都不会进 Dock / 任务栏 / 安装包。
const PLATE = { left: 162, top: 162, side: 1724, radius: 282 };
// 手机安装图标必须不透明；用板自身的深蓝色填满圆角外的空隙。
const PHONE_BG = '#101B29';

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

function svg(png, size = 1024) {
  // Embed the supplied raster, not a hand-redrawn approximation of the logo.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><image width="${size}" height="${size}" href="data:image/png;base64,${png.toString('base64')}"/></svg>\n`;
}

/** 只保留素材里那块深色方板；圆角遮罩按目标尺寸重新叠加。 */
async function plateCrop(sharp, artwork) {
  return sharp(artwork)
    .extract({ left: PLATE.left, top: PLATE.top, width: PLATE.side, height: PLATE.side })
    .png()
    .toBuffer();
}

/** 方板本身就是图标外形，圆角以外一律透明。
 * 遮罩按目标尺寸再叠一次：源图遮罩被 Lanczos 缩小时，圆角外侧会留下淡淡的光晕。
 */
async function plateAt(sharp, crop, size) {
  const radius = Math.max(1, Math.round((size * PLATE.radius) / PLATE.side));
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#FFFFFF"/></svg>`
  );
  return sharp(crop)
    .resize(size, size)
    .composite([{ input: mask, blend: 'dest-in' }])
    .png()
    .toBuffer();
}

/** 菜单栏 / 通知栏 / Android 单色图层：只保留主火焰的实心剪影。
 * 火焰内部有深色空腔、上方还有火星，逐像素取最大连通块后按行填充，
 * 22px 下仍能读出火苗；直接用透明度会得到一整块方板。
 */
async function flameGlyph(sharp, platePng) {
  const { data, info } = await sharp(platePng)
    .resize(1024, 1024)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const size = info.width;
  const warm = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    if (data[i * 4 + 3] > 128 && r > 120 && r - b > 30 && r - g > -40) warm[i] = 1;
  }
  const seen = new Uint8Array(size * size);
  const stack = [];
  let main = null;
  for (let start = 0; start < warm.length; start++) {
    if (!warm[start] || seen[start]) continue;
    stack.push(start);
    seen[start] = 1;
    const component = [];
    while (stack.length) {
      const index = stack.pop();
      component.push(index);
      const x = index % size;
      const y = (index - x) / size;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
        const next = ny * size + nx;
        if (warm[next] && !seen[next]) {
          seen[next] = 1;
          stack.push(next);
        }
      }
    }
    if (!main || component.length > main.length) main = component;
  }
  assert.ok(main && main.length > 0, 'CodeKiln artwork must contain a flame');
  const rowMin = new Int32Array(size).fill(size);
  const rowMax = new Int32Array(size).fill(-1);
  let minX = size;
  let maxX = -1;
  let minY = size;
  let maxY = -1;
  for (const index of main) {
    const x = index % size;
    const y = (index - x) / size;
    if (x < rowMin[y]) rowMin[y] = x;
    if (x > rowMax[y]) rowMax[y] = x;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  // 方形画布居中：模板图标按原图尺寸绘制，尺寸不一致会被系统拉伸。
  const glyphWidth = maxX - minX + 1;
  const glyphHeight = maxY - minY + 1;
  const side = Math.max(glyphWidth, glyphHeight);
  const offsetX = Math.floor((side - glyphWidth) / 2);
  const offsetY = Math.floor((side - glyphHeight) / 2);
  const pixels = Buffer.alloc(side * side * 4);
  for (let y = minY; y <= maxY; y++) {
    for (let x = rowMin[y]; x <= rowMax[y]; x++) {
      const target = ((y - minY + offsetY) * side + (x - minX + offsetX)) * 4;
      pixels[target + 3] = 255;
    }
  }
  return sharp(pixels, { raw: { width: side, height: side, channels: 4 } })
    .png()
    .toBuffer();
}

/** 菜单栏模板图标：22pt 画布只画 16pt 剪影，与系统菜单栏图标的上下留白对齐。
 * 剪影顶满画布时，macOS 会按 22pt 原样绘制，整条菜单栏里只有它比邻居大一圈。
 */
async function trayTemplate(sharp, glyph, size) {
  const content = Math.round((size * TRAY_GLYPH) / TRAY_CANVAS);
  const inset = Math.floor((size - content) / 2);
  const body = await sharp(glyph)
    .resize(content, content, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([{ input: body, left: inset, top: inset }])
    .png()
    .toBuffer();
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

  const app = await readFile(ARTWORK);
  const { width, height } = await sharp(app).metadata();
  assert.equal(width, 2048, 'CodeKiln source width');
  assert.equal(height, 2048, 'CodeKiln source height');
  const crop = await plateCrop(sharp, app);
  const plate = await plateAt(sharp, crop, 1024);
  const mono = await flameGlyph(sharp, plate);
  // SVG 只是把位图包进外壳：512 够用且不会把仓库 lint 的单文件上限顶爆。
  const svgPlate = await plateAt(sharp, crop, 512);
  await write('build/icon.svg', svg(svgPlate, 512));
  await write('build/codekiln-mark.svg', svg(svgPlate, 512));
  await writePng('build/brand-mark.png', await plateAt(sharp, crop, 128), 128);
  await write('build/trayTemplate.svg', svg(mono));
  const pngs = new Map();
  pngs.set(1024, await writePng('build/icon.png', plate, 1024));
  for (const size of SIZES) {
    pngs.set(
      size,
      await writePng(`build/icons/${size}x${size}.png`, await plateAt(sharp, crop, size), size)
    );
  }
  await writePng('build/icon-win.png', await plateAt(sharp, crop, 256), 256);
  await write('build/trayTemplate.png', await trayTemplate(sharp, mono, TRAY_CANVAS));
  await write('build/trayTemplate@2x.png', await trayTemplate(sharp, mono, TRAY_CANVAS * 2));
  await write('build/icon.ico', await ico(sharp, pngs));
  await write('build/icon.icns', icns(pngs));
  // In-app phone UI keeps transparency; installed PWA icons below stay opaque.
  await writePng('packages/phone/public/icons/logo-192.png', await plateAt(sharp, crop, 192), 192);
  for (const [name, size] of [
    ['apple-touch-icon', 180],
    ['icon-192', 192],
    ['icon-512', 512],
    ['icon-maskable-512', 512],
  ]) {
    // PWA home-screen icons must be opaque. Extra inset protects maskable icons.
    let phone = sharp(await plateAt(sharp, crop, 1024));
    if (name.includes('maskable'))
      phone = phone
        .resize(820, 820)
        .extend({ top: 102, bottom: 102, left: 102, right: 102, background: PHONE_BG });
    await writePng(
      `packages/phone/public/icons/${name}.png`,
      await phone.flatten({ background: PHONE_BG }).png().toBuffer(),
      size,
      true
    );
  }

  // Adaptive launcher: the plate keeps the artwork's own rounded silhouette,
  // the monochrome layer is the flame silhouette launchers tint themselves.
  const drawable = 'android/app/src/main/res/drawable-nodpi';
  await writePng(`${drawable}/codekiln_mark.png`, await plateAt(sharp, crop, 128), 128);
  await writePng(`${drawable}/codekiln_running_small.png`, await plateAt(sharp, crop, 96), 96);
  await writePng(`${drawable}/codekiln_notification.png`, mono, 96);
  for (const [name, source, inset] of [
    ['foreground', await plateAt(sharp, crop, 400), 400],
    ['monochrome', mono, 220],
  ]) {
    const padding = (432 - inset) / 2;
    const adaptive = await sharp(source)
      .resize(inset, inset)
      .extend({
        top: padding,
        bottom: padding,
        left: padding,
        right: padding,
        background: '#00000000',
      })
      .png()
      .toBuffer();
    await writePng(`${drawable}/codekiln_launcher_${name}.png`, adaptive, 432);
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
    `Verified ${files.length} CodeKiln assets; ICNS generated with PNG chunks (no iconutil needed).`
  );
}
