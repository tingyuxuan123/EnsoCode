export type PluginInstallUrlResult = { ok: true; url: URL } | { ok: false; error: string };
export function parsePluginInstallUrl(input: string): PluginInstallUrlResult {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return { ok: false, error: '链接不合法' };
  }
  if (url.protocol !== 'https:') return { ok: false, error: '安装只支持 HTTPS 链接' };
  if (url.username || url.password) return { ok: false, error: '链接不能带账号密码' };
  if (!url.hostname || url.href.length > 2048) return { ok: false, error: '链接不合法' };
  return { ok: true, url };
}
export type PluginArchiveSource =
  | { ok: true; archive: URL; subdir: string | null }
  | { ok: false; error: string };
const name = (s: string) => /^[A-Za-z0-9._-]+$/.test(s) && s !== '.' && !s.includes('..');
export function resolvePluginArchive(url: URL): PluginArchiveSource {
  if (
    !['github.com', 'www.github.com'].includes(url.hostname.toLowerCase()) ||
    url.pathname.toLowerCase().endsWith('.zip')
  )
    return { ok: true, archive: url, subdir: null };
  const bad = {
    ok: false as const,
    error:
      'GitHub 仓库请用 https://github.com/owner/repo ，指定目录用 .../tree/分支/子目录；zip 链接可直接粘贴',
  };
  let parts: string[];
  try {
    parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  } catch {
    return bad;
  }
  if (parts[1]?.toLowerCase().endsWith('.git')) parts[1] = parts[1].slice(0, -4);
  const [owner, repo] = parts;
  if (!owner || !repo || !name(owner) || !name(repo)) return bad;
  if (
    parts.length !== 2 &&
    (parts[2] !== 'tree' || !parts[3] || parts.slice(3).some((s) => !name(s)))
  )
    return bad;
  const ref = parts[3];
  return {
    ok: true,
    archive: new URL(
      `https://api.github.com/repos/${owner}/${repo}/zipball${ref ? `/${encodeURIComponent(ref)}` : ''}`
    ),
    subdir: parts.length > 4 ? parts.slice(4).join('/') : null,
  };
}
