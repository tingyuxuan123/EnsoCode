import { stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { findArchMismatches } from '../src/tooling/packagedArch.mjs';
import stripPackagedNatives from '../src/tooling/stripPackagedNatives.mjs';
import { stripForeignDesignPackages } from './prepare-design-engine.mjs';
import { copyRtkDistribution } from './rtk.mjs';

const ARCH_NAME = ['ia32', 'x64', 'armv7l', 'arm64', 'universal'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function archName(arch) {
  if (typeof arch === 'string') return arch;
  return ARCH_NAME[arch] ?? String(arch);
}

function packagedResourcesDir(context) {
  if (context.electronPlatformName === 'darwin') {
    return path.join(
      context.appOutDir,
      `${context.packager.appInfo.productFilename}.app`,
      'Contents',
      'Resources'
    );
  }
  return path.join(context.appOutDir, 'resources');
}

export default async function afterPack(context) {
  await stripPackagedNatives(context);
  const designModules = path.join(
    packagedResourcesDir(context),
    'design',
    'engine',
    'node_modules'
  );
  if (!(await stat(designModules).catch(() => null))?.isDirectory()) {
    throw new Error(
      'Design engine is not prepared; run node scripts/prepare-design-engine.mjs before packaging'
    );
  }
  await stripForeignDesignPackages(
    designModules,
    context.electronPlatformName,
    archName(context.arch)
  );
  await copyRtkDistribution(
    root,
    path.join(packagedResourcesDir(context), 'rtk'),
    context.electronPlatformName,
    archName(context.arch)
  );
  // mac 会在 Apple 芯片上交叉打 x64：签名前拦住混进包里的别架构二进制
  if (context.electronPlatformName === 'darwin') {
    const arch = archName(context.arch);
    const mismatches = findArchMismatches(context.appOutDir, arch);
    if (mismatches.length) {
      const list = mismatches.map(({ file, archs }) => `  ${file} (${archs.join(', ')})`);
      throw new Error(`packaged app has binaries without ${arch}:\n${list.join('\n')}`);
    }
  }
}
