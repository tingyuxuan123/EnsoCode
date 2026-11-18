import { PanelsTopLeft } from 'lucide-react';
import manifestJson from '@/assets/file-icons/manifest.json';
import { cn } from '@/lib/utils';

/**
 * 文件 / 目录图标来自 Material Icon Theme（VS Code 的 Material Icon Theme，
 * npm `material-icon-theme`）。`src/renderer/assets/file-icons/` 由
 * `scripts/generate-file-icons.mjs` 生成：manifest.json 是主题的名字 / 扩展名 /
 * 目录名映射，icons/ 是映射能到达的全部 SVG。图标自带配色，不走语义令牌 ——
 * 这是主题的素材，和 `.vetd` 用 `text-primary` 的宿主图标是两回事。
 *
 * 解析顺序与主题一致：文件先按整名（含 `.config/graphqlrc` 这类路径键），再按从长
 * 到短的复合扩展名（`a.test.ts` 先试 `test.ts` 再试 `ts`），最后回落到通用文件图标；
 * 目录按名字和展开状态取图，项目根目录单独一套。
 */

type FileIconManifest = {
  name: string;
  version: string;
  file: string;
  folder: string;
  rootFolder: string;
  fileNames: Record<string, string>;
  fileExtensions: Record<string, string>;
  folderNames: Record<string, string>;
};

const MANIFEST = manifestJson as FileIconManifest;

// `?no-inline`：SVG 作为资源文件产出，不要把 600 KiB 的图标全塞进主 chunk。
const ICON_PATHS = import.meta.glob('../../assets/file-icons/icons/*.svg', {
  eager: true,
  query: '?no-inline',
  import: 'default',
}) as Record<string, string>;

const ICON_URLS = new Map(
  Object.entries(ICON_PATHS).map(([file, url]) => [
    file.slice(file.lastIndexOf('/') + 1, -'.svg'.length),
    url,
  ])
);

/** 名字里带 `/` 的映射键（`.config/graphqlrc`、`.github/workflows`）按路径结尾匹配。
 * 按最后一段建索引，避免每行渲染都扫一遍两千多条映射。 */
function indexPathKeys(map: Record<string, string>): Map<string, [string, string][]> {
  const index = new Map<string, [string, string][]>();
  for (const [key, id] of Object.entries(map)) {
    if (!key.includes('/')) continue;
    const base = key.slice(key.lastIndexOf('/') + 1);
    const candidates = index.get(base);
    if (candidates) candidates.push([key, id]);
    else index.set(base, [[key, id]]);
  }
  return index;
}

const FILE_PATH_KEYS = indexPathKeys(MANIFEST.fileNames);
const FOLDER_PATH_KEYS = indexPathKeys(MANIFEST.folderNames);

function baseName(rel: string): string {
  const trimmed = rel.replace(/[/\\]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  return trimmed.slice(cut + 1).toLowerCase();
}

function normalizePath(rel: string): string {
  return rel.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
}

function pathIconId(index: Map<string, [string, string][]>, rel: string, name: string) {
  const candidates = index.get(name);
  if (!candidates) return undefined;
  const normalized = normalizePath(rel);
  for (const [key, id] of candidates) {
    if (normalized === key || normalized.endsWith(`/${key}`)) return id;
  }
  return undefined;
}

function fileIconByName(rel: string): string {
  const name = baseName(rel);
  const byName = MANIFEST.fileNames[name];
  if (byName) return byName;
  const byPath = pathIconId(FILE_PATH_KEYS, rel, name);
  if (byPath) return byPath;
  // 开头的点是隐藏文件前缀，不是扩展名；末尾的点后面没有扩展名。
  let dot = name.indexOf('.', 1);
  while (dot >= 0 && dot < name.length - 1) {
    const byExtension = MANIFEST.fileExtensions[name.slice(dot + 1)];
    if (byExtension) return byExtension;
    dot = name.indexOf('.', dot + 1);
  }
  return MANIFEST.file;
}

function folderIconByName(rel: string, expanded: boolean, root: boolean): string {
  if (root) return expanded ? `${MANIFEST.rootFolder}-open` : MANIFEST.rootFolder;
  const name = baseName(rel);
  const byName = MANIFEST.folderNames[name] ?? pathIconId(FOLDER_PATH_KEYS, rel, name);
  if (byName) return expanded ? `${byName}-open` : byName;
  return expanded ? `${MANIFEST.folder}-open` : MANIFEST.folder;
}

/** `rel` 可以是相对路径或单独的文件 / 目录名。 */
export function fileIconId(rel: string, isDir = false, expanded = false, root = false): string {
  return isDir ? folderIconByName(rel, expanded, root) : fileIconByName(rel);
}

export function fileIconUrl(rel: string, isDir = false, expanded = false, root = false): string {
  const id = fileIconId(rel, isDir, expanded, root);
  return ICON_URLS.get(id) ?? ICON_URLS.get(MANIFEST.file) ?? '';
}

type FileTypeIconProps = {
  name: string;
  isDir?: boolean;
  expanded?: boolean;
  root?: boolean;
  className?: string;
};

/** 设计目录和新旧分享文件是宿主概念，沿用宿主的原生图标而不是主题映射。 */
function isDesignPath(name: string, isDir: boolean): boolean {
  const base = baseName(name);
  return /\.vetd$/.test(base) || (!isDir && /\.vetdz$/.test(base));
}

export function FileTypeIcon({
  name,
  isDir = false,
  expanded = false,
  root = false,
  className,
}: FileTypeIconProps) {
  if (isDesignPath(name, isDir)) {
    return (
      <PanelsTopLeft aria-hidden="true" className={cn('size-4 shrink-0 text-primary', className)} />
    );
  }
  return (
    <img
      src={fileIconUrl(name, isDir, expanded, root)}
      alt=""
      aria-hidden="true"
      draggable={false}
      className={cn('size-4 shrink-0', className)}
    />
  );
}
