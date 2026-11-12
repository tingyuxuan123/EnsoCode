import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateIcons, loadSharp } from './generate-app-icon.mjs';

test('generates the Collabra artwork for desktop, phone, Android and monochrome system icons', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'collabra-icons-'));
  try {
    const sharp = loadSharp();
    const files = await generateIcons(root);
    assert.equal(files.length, 27);
    const source = new URL('../assets/branding/collabra-logo.png', import.meta.url);
    const expected = await sharp(await readFile(source))
      .resize(128, 128)
      .ensureAlpha()
      .raw()
      .toBuffer();
    const actual = await sharp(path.join(root, 'build/brand-mark.png'))
      .ensureAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(
      actual,
      expected,
      'in-app artwork must preserve the supplied transparent logo'
    );
    for (const file of files) assert.ok((await stat(path.join(root, file))).size > 0, file);
    for (const file of files.filter((file) => file.endsWith('.png'))) {
      const image = sharp(path.join(root, file));
      const { width, height } = await image.metadata();
      const size = file.includes('eaves_launcher')
        ? 432
        : file.includes('eaves_notification') || file.includes('eaves_running_small')
          ? 96
          : file.includes('eaves_mark') || file.endsWith('/brand-mark.png')
            ? 128
            : file.includes('apple-touch')
              ? 180
              : file.includes('192')
                ? 192
                : file.includes('512')
                  ? 512
                  : file.includes('trayTemplate@2x')
                    ? 44
                    : file.includes('trayTemplate')
                      ? 22
                      : file.includes('icon-win')
                        ? 256
                        : file.includes('/icons/')
                          ? Number(path.basename(file).split('x')[0])
                          : 1024;
      assert.equal(width, size, file);
      assert.equal(height, size, file);
      const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      if (file.includes('trayTemplate') || /eaves_(notification|launcher_monochrome)/.test(file)) {
        assert.ok(data.some((value, i) => i % 4 === 3 && value > 0));
        for (let i = 0; i < data.length; i += 4) {
          assert.equal(data[i] + data[i + 1] + data[i + 2], 0, file);
        }
      } else if (file.startsWith('build/')) {
        assert.equal(data[3], 0, file);
        assert.ok(
          data.some((value, i) => i % 4 === 3 && value > 0),
          file
        );
        assert.ok(
          data.some((value, i) => i % 4 === 2 && value > 150),
          file
        );
      } else if (file.endsWith('/logo-192.png')) {
        assert.equal(data[3], 0, file);
        assert.ok(
          data.some((value, i) => i % 4 === 3 && value > 0),
          file
        );
      } else if (file.startsWith('packages/phone/')) {
        for (let i = 3; i < data.length; i += 4) assert.equal(data[i], 255, file);
      }
      if (file.includes('eaves_launcher')) {
        // Adaptive icons must keep the entire visible mark inside Android's safe circle.
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * 4 + 3] < 16) continue;
            assert.ok(
              Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= (size * 33) / 108,
              file
            );
          }
        }
      }
    }
    const ico = await readFile(path.join(root, 'build/icon.ico'));
    assert.equal(ico.readUInt16LE(2), 1);
    assert.equal(ico.readUInt16LE(4), 6);
    for (let i = 0; i < 6; i++) {
      const entry = 6 + i * 16;
      const size = ico[entry] || 256;
      const offset = ico.readUInt32LE(entry + 12);
      assert.equal(size, [256, 128, 64, 48, 32, 16][i]);
      if (size === 256) {
        assert.equal((await sharp(ico.subarray(offset)).metadata()).width, 256);
      } else {
        assert.equal(ico.readUInt32LE(offset), 40);
        assert.equal(ico.readUInt32LE(offset + 20), size * size * 4);
        const mask = ico.subarray(
          offset + 40 + size * size * 4,
          offset + ico.readUInt32LE(entry + 8)
        );
        assert.equal(
          mask.some((value) => value !== 0),
          size > 32
        );
      }
    }
    const icns = await readFile(path.join(root, 'build/icon.icns'));
    assert.equal(icns.toString('ascii', 0, 4), 'icns');
    assert.equal(icns.readUInt32BE(4), icns.length);
    let offset = 8;
    const types = [];
    while (offset < icns.length) {
      types.push(icns.toString('ascii', offset, offset + 4));
      const length = icns.readUInt32BE(offset + 4);
      assert.ok((await sharp(icns.subarray(offset + 8, offset + length)).metadata()).width);
      offset += length;
    }
    assert.deepEqual(types, ['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10']);
    assert.equal(offset, icns.length);
    for (const name of ['icon.svg', 'enso-mark.svg', 'trayTemplate.svg']) {
      const svg = await readFile(path.join(root, 'build', name), 'utf8');
      assert.ok(svg.includes('data:image/png;base64,'), name);
      assert.ok(!svg.includes('M12 23 Q16 31'), name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop and installer icons have a white rounded backing while UI and tray marks stay transparent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'collabra-icon-backing-'));
  try {
    const sharp = loadSharp();
    await generateIcons(root);
    const assertBacking = async (png, label) => {
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (x, y) => {
        const offset = (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * 4;
        return [...data.subarray(offset, offset + 4)];
      };
      assert.equal(pixel(0, 0)[3], 0, `${label}: transparent corner outside the rounded card`);
      for (const [x, y] of [
        [0.5, 0.05],
        [0.5, 0.95],
        [0.05, 0.5],
        [0.95, 0.5],
      ]) {
        const [r, g, b, alpha] = pixel(x, y);
        assert.equal(alpha, 255, `${label}: opaque backing at ${x},${y}`);
        assert.ok(Math.min(r, g, b) >= 240, `${label}: white backing at ${x},${y}`);
      }
      assert.ok(
        data.some((value, i) => i % 4 === 2 && value > 150 && data[i - 2] < 150),
        `${label}: original blue logo retained`
      );
    };
    for (const name of ['icon.png', 'icon-win.png', 'icon.svg', 'icons/128x128.png']) {
      await assertBacking(await readFile(path.join(root, 'build', name)), name);
    }
    const ico = await readFile(path.join(root, 'build/icon.ico'));
    const icoOffset = ico.readUInt32LE(18);
    await assertBacking(ico.subarray(icoOffset), 'ICO 256px');
    const icns = await readFile(path.join(root, 'build/icon.icns'));
    for (let offset = 8; offset < icns.length; ) {
      const length = icns.readUInt32BE(offset + 4);
      await assertBacking(
        icns.subarray(offset + 8, offset + length),
        icns.toString('ascii', offset, offset + 4)
      );
      offset += length;
    }
    for (const file of ['build/brand-mark.png', 'build/trayTemplate.png']) {
      const { data, info } = await sharp(path.join(root, file))
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const edge = Math.floor(info.width / 2) * 4 + 3;
      // Lanczos can leave nearly transparent ringing when resizing to 22px.
      assert.ok(data[edge] < 16, `${file}: no backing on UI and menu-bar marks`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
