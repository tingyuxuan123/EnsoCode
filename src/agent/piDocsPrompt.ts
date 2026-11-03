/**
 * 打包版按 electron-builder 规则剔除了 node_modules 下的 README/docs/examples，
 * 但 pi 默认的 docs 段仍指向 app.asar 里的这些路径，模型照着读就是 ENOENT。
 * 文档不在磁盘上时，把 docs 段换成如实说明（pi 以同名 section 覆盖内置段）。
 */

import { existsSync } from 'node:fs';
import { getDocsPath, type InlineExtension } from '@earendil-works/pi-coding-agent';

export const PI_DOCS_UNAVAILABLE =
  'Pi documentation is not bundled with this app, so do not look for pi README, docs or examples inside the app bundle. If the user asks about pi itself, read the copy under node_modules/@earendil-works/pi-coding-agent/ in the workspace when one exists.';

export function applyPiDocsAvailability(
  options: { customPrompt?: string; sections: Record<string, string> },
  docsOnDisk: boolean
): void {
  // 自定义整段提示词时 pi 不生成 docs 段，不能反向塞进去
  if (docsOnDisk || options.customPrompt) return;
  options.sections.docs = PI_DOCS_UNAVAILABLE;
}

let docsOnDisk: boolean | undefined;

function piDocsOnDisk(): boolean {
  docsOnDisk ??= existsSync(getDocsPath());
  return docsOnDisk;
}

/** 只在文档缺失（打包版）时装上；需排在会强制整段提示词的 persona 之前 */
export function piDocsAvailabilityExtensions(): InlineExtension[] {
  if (piDocsOnDisk()) return [];
  return [
    {
      name: 'pi-docs-availability',
      hidden: true,
      factory: (pi) => {
        pi.on('before_agent_start', (event) => {
          applyPiDocsAvailability(event.systemPromptOptions, false);
        });
      },
    },
  ];
}
