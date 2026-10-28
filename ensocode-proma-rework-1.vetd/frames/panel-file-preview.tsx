export const frame = { width: 1440, height: 900, title: "右侧面板 · 文件内容搜索与 Markdown 预览" };

import { PanelFrame } from '../components/panel/PanelFrame';

/** 全屏文件面板：内容搜索（rg 命中行，带文件与行号）+ Markdown 预览 / 查看源码；窄面板时改用全屏才能读 */
export default function PanelFilePreview() {
  return (
    <PanelFrame
      kind="files"
      title="文件"
      fullscreen
      preset={{
        search: true,
        searchMode: 'content',
        query: 'ModeSwitch',
        open: ['AGENTS.md'],
        active: 'AGENTS.md',
        markdownPreview: true,
      }}
    />
  );
}
