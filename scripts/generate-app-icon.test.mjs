import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateIcons, loadSharp } from './generate-app-icon.mjs';

test('generates the Eaves icon family, Windows DIB frames and monochrome tray templates', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'eaves-icons-'));
  try {
    const sharp = loadSharp();
    const files = await generateIcons(root);
    assert.equal(files.length, 20);
    for (const file of files) assert.ok((await stat(path.join(root, file))).size > 0, file);
    for (const file of files.filter((file) => file.endsWith('.png'))) {
      const image = sharp(path.join(root, file));
      const { width, height } = await image.metadata();
      const size = file.includes('apple-touch')
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
      if (file.includes('trayTemplate')) {
        assert.ok(data.some((value, i) => i % 4 === 3 && value > 0));
        for (let i = 0; i < data.length; i += 4) {
          assert.equal(data[i] + data[i + 1] + data[i + 2], 0, file);
        }
      } else if (file.startsWith('build/')) {
        assert.equal(data[3], 0, file);
        const center = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4;
        assert.equal(data[center + 3], 255, file);
        if (size >= 128) {
          const blue = (Math.round(size * 0.62) * info.width + Math.floor(size / 2)) * 4;
          assert.deepEqual([...data.subarray(blue, blue + 4)], [59, 130, 246, 255], file);
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
      assert.ok(svg.includes('M12 23 Q16 31 26 32 L74 32 Q84 31 88 23'));
      assert.ok(svg.includes('M31 45 V56 M31 64 V72 M50 45 V58 M69 45 V50 M69 58 V76'));
      if (name === 'trayTemplate.svg') assert.ok(!svg.includes('#3B82F6'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
