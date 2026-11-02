import type { ExtensionPluginManifest } from './manifest';
export interface PluginGrant {
  permissions: string[];
  fsRead: string[];
  fsWrite: string[];
  netDomains: string[];
  mcp: { name: string; command: string; args: string[]; envKeys: string[] }[];
  mcpTools?: string[];
  renderer: boolean;
}
export function grantOf(manifest: ExtensionPluginManifest): PluginGrant {
  return {
    permissions: [...manifest.permissions].sort(),
    fsRead: [...manifest.fs.read].sort(),
    fsWrite: [...manifest.fs.write].sort(),
    netDomains: [...manifest.net.domains].sort(),
    mcp: manifest.contributes.mcpServers.map((s) => ({
      name: s.name,
      command: s.command,
      args: [...s.args],
      envKeys: Object.keys(s.env).sort(),
    })),
    mcpTools: [...manifest.mcp.tools].sort(),
    renderer: manifest.renderer !== undefined,
  };
}
const covered = (path: string, scope: string[]) =>
  scope.some((root) => root === '.' || path === root || path.startsWith(`${root}/`));
export function grantExpands(previous: PluginGrant, next: PluginGrant): boolean {
  if (
    next.permissions.some((p) => !previous.permissions.includes(p)) ||
    next.fsRead.some((p) => !covered(p, previous.fsRead)) ||
    next.fsWrite.some((p) => !covered(p, previous.fsWrite)) ||
    next.netDomains.some((d) => !previous.netDomains.includes(d))
  )
    return true;
  const key = (s: PluginGrant['mcp'][number]) =>
    JSON.stringify([s.name, s.command, s.args, s.envKeys]);
  const known = new Set(previous.mcp.map(key));
  return (
    next.mcp.some((s) => !known.has(key(s))) ||
    (next.mcpTools ?? []).some((t) => !(previous.mcpTools ?? []).includes(t)) ||
    (next.renderer && !previous.renderer)
  );
}
