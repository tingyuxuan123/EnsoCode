import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { generateIcons, loadSharp } from './generate-app-icon.mjs';

test('generates the CodeKiln artwork for desktop, phone, Android and monochrome system icons', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codekiln-icons-'));
  try {
    const sharp = loadSharp();
    const files = await generateIcons(root);
    assert.equal(files.length, 27);
    const pixelsOf = async (file) =>
      sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 方板圆角之外必须透明，芯部必须是素材里的火光，而不是被重画的近似图。
    const mark = await pixelsOf(path.join(root, 'build/brand-mark.png'));
    assert.ok(mark.data[3] < 16, 'in-app mark keeps transparent plate corners');
    assert.ok(
      mark.data.some((value, i) => i % 4 === 0 && value > 200 && mark.data[i - 2] < 120),
      'in-app mark keeps the supplied flame colours'
    );
    for (const file of files) assert.ok((await stat(path.join(root, file))).size > 0, file);
    for (const file of files.filter((file) => file.endsWith('.png'))) {
      const image = sharp(path.join(root, file));
      const { width, height } = await image.metadata();
      const size = file.includes('codekiln_launcher')
        ? 432
        : file.includes('codekiln_notification') || file.includes('codekiln_running_small')
          ? 96
          : file.includes('codekiln_mark') || file.endsWith('/brand-mark.png')
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
      if (
        file.includes('trayTemplate') ||
        /codekiln_(notification|launcher_monochrome)/.test(file)
      ) {
        assert.ok(data.some((value, i) => i % 4 === 3 && value > 0));
        for (let i = 0; i < data.length; i += 4) {
          assert.equal(data[i] + data[i + 1] + data[i + 2], 0, file);
        }
        if (file.includes('trayTemplate')) {
          // 菜单栏图标要和系统图标一样留出上下留白；顶满 22pt 画布会比邻居大一圈。
          const inkRows = [];
          for (let y = 0; y < info.height; y++) {
            for (let x = 0; x < info.width; x++) {
              if (data[(y * info.width + x) * 4 + 3] > 8) {
                inkRows.push(y);
                break;
              }
            }
          }
          const expected = Math.round((info.width * 16) / 22);
          assert.equal(inkRows[0], Math.floor((info.width - expected) / 2), `${file}: top inset`);
          assert.ok(Math.abs(inkRows.length - expected) <= 1, `${file}: ink ${inkRows.length}`);
        }
      } else if (file.startsWith('build/')) {
        assert.ok(data[3] < 16, file);
        assert.ok(
          data.some((value, i) => i % 4 === 3 && value > 0),
          file
        );
        assert.ok(
          data.some(
            (value, i) => i % 4 === 0 && value > 200 && data[i + 2] < 120 && data[i + 3] > 200
          ),
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
      if (file.includes('codekiln_launcher_monochrome')) {
        // 单色图层由系统着色，剪影必须留在自适应图标可见区域内。
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            if (data[(y * info.width + x) * 4 + 3] < 16) continue;
            assert.ok(
              Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) <= (size * 36) / 108,
              file
            );
          }
        }
      }
      if (file.includes('codekiln_launcher_foreground')) {
        // 前景方板要盖满可见区域，否则圆形遮罩下会露出白角。
        for (let y = 0; y < info.height; y++) {
          for (let x = 0; x < info.width; x++) {
            if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > (size * 35) / 108) continue;
            assert.ok(data[(y * info.width + x) * 4 + 3] > 200, file);
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
    for (const name of ['icon.svg', 'codekiln-mark.svg', 'trayTemplate.svg']) {
      const svg = await readFile(path.join(root, 'build', name), 'utf8');
      assert.ok(svg.includes('data:image/png;base64,'), name);
      assert.ok(!svg.includes('M12 23 Q16 31'), name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('desktop and installer icons keep the supplied dark plate while UI and tray marks stay transparent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'codekiln-icon-plate-'));
  try {
    const sharp = loadSharp();
    await generateIcons(root);
    const assertPlate = async (png, label) => {
      const { data, info } = await sharp(png)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixel = (x, y) => {
        const offset = (Math.floor(y * info.height) * info.width + Math.floor(x * info.width)) * 4;
        return [...data.subarray(offset, offset + 4)];
      };
      assert.ok(pixel(0, 0)[3] < 16, `${label}: transparent corner outside the rounded plate`);
      for (const [x, y] of [
        [0.5, 0.05],
        [0.5, 0.95],
        [0.05, 0.5],
        [0.95, 0.5],
      ]) {
        const [r, g, b, alpha] = pixel(x, y);
        assert.equal(alpha, 255, `${label}: opaque plate edge at ${x},${y}`);
        assert.ok(Math.max(r, g, b) <= 96, `${label}: dark plate edge at ${x},${y}`);
      }
      assert.ok(
        data.some((value, i) => i % 4 === 0 && value > 200 && data[i + 2] < 120),
        `${label}: supplied flame retained`
      );
    };
    for (const name of ['icon.png', 'icon-win.png', 'icon.svg', 'icons/128x128.png']) {
      await assertPlate(await readFile(path.join(root, 'build', name)), name);
    }
    const ico = await readFile(path.join(root, 'build/icon.ico'));
    const icoOffset = ico.readUInt32LE(18);
    await assertPlate(ico.subarray(icoOffset), 'ICO 256px');
    const icns = await readFile(path.join(root, 'build/icon.icns'));
    for (let offset = 8; offset < icns.length; ) {
      const length = icns.readUInt32BE(offset + 4);
      await assertPlate(
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
      // 圆角方板与火苗剪影都自带透明四角；不能有白色或方板底色漏出来。
      for (const corner of [0, (info.width - 1) * 4]) {
        assert.ok(data[corner + 3] < 16, `${file}: transparent corner`);
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
