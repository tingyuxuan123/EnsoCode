/** Paths that let the existing DesignSession recover a missing manifest. */
export function sourceDesignFile(rel: string): { bundle: string; kind: 'theme' | 'frame' } | null {
  const match = /^(.*\.vetd)\/(theme\.css|frames\/([^/]+\.tsx))$/.exec(rel);
  if (!match || /\.vetd(?:\.d)?\//.test(match[1])) return null;
  if (match[2] === 'theme.css') return { bundle: match[1], kind: 'theme' };
  const name = match[3];
  return name && name !== '.tsx' && !name.startsWith('_')
    ? { bundle: match[1], kind: 'frame' }
    : null;
}
