import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { zipSync } from 'fflate';
import { stagePlugin } from '../main/services/extensionPlugins/install';

export interface PackedPlugin {
  file: string;
  sha256: string;
  size: number;
  id: string;
  version: string;
}

/** 只打包通过安装边界校验的私有快照，不在校验后重新读取可变的源目录。 */
export async function packPlugin(
  directory: string,
  options: { hostVersion: string; out?: string }
): Promise<PackedPlugin> {
  const root = resolve(directory);
  const temp = await mkdtemp(join(await realpath(tmpdir()), 'collabra-plugin-pack-'));
  try {
    const staged = await stagePlugin(temp, { kind: 'dir', path: root }, options.hostVersion);
    if (!staged.ok) throw new Error(staged.error);
    const { manifest, pluginRoot } = staged.staged;
    const files: Record<string, Uint8Array> = Object.create(null);
    const walk = async (directory: string) => {
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
      for (const entry of entries) {
        if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
        const file = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'test') await walk(file);
        } else if (
          entry.isFile() &&
          !entry.name.endsWith('.zip') &&
          !(directory === pluginRoot && entry.name === 'enso-testing.mjs')
        ) {
          files[relative(pluginRoot, file).split(sep).join('/')] = await readFile(file);
        }
      }
    };
    await walk(pluginRoot);
    const bytes = zipSync(files, { level: 6, mtime: new Date(1980, 0, 1) });
    // 排除开发文件后仍须确认所有清单引用齐全，不能产出无法安装的 ZIP。
    const candidate = join(temp, 'package.zip');
    const snapshot = await open(candidate, 'wx', 0o600);
    try {
      await snapshot.writeFile(bytes);
    } finally {
      await snapshot.close();
    }
    const validated = await stagePlugin(
      join(temp, 'verify'),
      { kind: 'zip', path: candidate },
      options.hostVersion
    );
    if (!validated.ok) throw new Error(validated.error);
    const file = options.out
      ? resolve(options.out)
      : join(dirname(root), `${manifest.id}-${manifest.version}.zip`);
    await mkdir(dirname(file), { recursive: true });
    const output = await open(
      file,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      0o600
    );
    try {
      await output.writeFile(bytes);
    } finally {
      await output.close();
    }
    return {
      file,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      size: bytes.byteLength,
      id: manifest.id,
      version: manifest.version,
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}
