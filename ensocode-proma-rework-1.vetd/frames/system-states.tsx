export const frame = { width: 1440, height: 900, title: "通用状态 · 空、加载、失败、确认与提示" };

import { Badge } from '../components/settings/SettingsUI';
import { Spinner, StateBar } from '../components/Controls';
import { DashedState, IconButton } from '../components/panel/PanelUI';

/** 通用状态集合（ui/empty、skeleton、toast、alert-dialog、menu、tooltip、kbd、meter）：真实应用里复用的同一套块 */
export default function SystemStates() {
  return (
    <div className="h-full overflow-y-auto bg-surface px-8 py-6">
      <div className="mx-auto max-w-[1080px]">
        <h1 className="text-[18px] font-semibold">通用状态</h1>
        <p className="mt-1 text-[13px] text-muted">所有页面共用：空态、加载、失败与重试、禁用与权限不足、未保存、危险确认、toast、菜单与快捷键、进度。</p>

        <section className="mt-5">
          <h2 className="mb-2 text-[14px] font-medium">空态与加载</h2>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-control border border-line">
              <DashedState icon="icon-[lucide--inbox]">没有会话<p className="text-faint">从侧栏新建任务开始</p></DashedState>
            </div>
            <div className="rounded-control border border-line p-3">
              <div className="space-y-2">
                <span className="block h-3 w-2/3 rounded bg-control" />
                <span className="block h-3 w-full rounded bg-control" />
                <span className="block h-3 w-4/5 rounded bg-control" />
                <span className="mt-3 block h-16 w-full rounded bg-control/60" />
              </div>
              <p className="mt-2 text-[11px] text-faint">骨架屏：首屏加载用，不用转圈</p>
            </div>
            <div className="flex flex-col items-center justify-center gap-2 rounded-control border border-line p-3 text-[12px] text-muted">
              <Spinner className="size-5 text-primary" />
              加载中…
              <span className="text-[11px] text-faint">超过 400ms 才显示，避免闪烁</span>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[14px] font-medium">失败、权限与禁用</h2>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-danger">
              <p className="font-medium">读取失败 · EACCES</p>
              <p className="mt-0.5 leading-5">没有权限读取 ~/.ssh/config。可以换一个目录，或去系统设置授权。</p>
              <div className="mt-1.5 flex gap-2"><button className="rounded-control bg-danger px-2.5 py-1 text-[11px] text-white">重试</button><button className="rounded-control border border-danger/40 px-2.5 py-1 text-[11px]">打开设置</button></div>
            </div>
            <div className="rounded-control border border-line px-3 py-2">
              <p className="font-medium">只读设备</p>
              <p className="mt-0.5 leading-5 text-muted">这台手机是只读权限：可以查看与输入，但不能审批或停止。可在桌面「设置 → 设备」改成可操作。</p>
              <div className="mt-1.5 flex gap-2"><button disabled className="rounded-control bg-control px-2.5 py-1 text-[11px] text-muted">允许（不可用）</button><button className="rounded-control border border-border px-2.5 py-1 text-[11px]">查看权限</button></div>
            </div>
          </div>
        </section>

        <section className="mt-6 grid grid-cols-2 gap-6">
          <div>
            <h2 className="mb-2 text-[14px] font-medium">页内提示</h2>
            <StateBar text="设置已保存到本机。部分项需要新会话生效。" onClear={() => undefined} />
            <div className="rounded-control border border-line bg-panel px-3 py-2 text-[12px] text-muted">
              <Badge>新会话生效</Badge>
              <span className="ml-2">启用工具只对新会话生效；已打开的会话仍用原来的工具集。</span>
            </div>
            <div className="mt-2 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[12px]">
              未保存的更改 · 关闭前会提示确认
            </div>
          </div>
          <div>
            <h2 className="mb-2 text-[14px] font-medium">进度与计量</h2>
            <div className="space-y-2 rounded-control border border-line p-3 text-[12px]">
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-muted"><span>下载模型</span><span className="tabular-nums">46% · 1.2 GB / 2.6 GB</span></div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-control"><span className="block h-full w-[46%] rounded-full bg-primary" /></span>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-[11px] text-muted"><span>上下文</span><span className="tabular-nums">48.2K / 200K · 24%</span></div>
                <span className="flex h-1.5 overflow-hidden rounded-full bg-control"><span className="w-[6%] bg-surface-foreground/70" /><span className="w-[4%] bg-warning" /><span className="w-[9%] bg-primary" /><span className="w-[5%] bg-success" /></span>
              </div>
              <div className="flex items-center gap-2 pt-1 text-[11px]">
                <span className="rounded border border-border px-1">⌘</span>
                <span className="rounded border border-border px-1">K</span>
                <span className="ml-2 text-muted">快捷键在哪里都显示为按键样式</span>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[14px] font-medium">危险确认</h2>
          <p className="mb-2 text-[11px] text-faint">危险操作必须有明确后果说明；能撤销的给撤销，不能撤销的要写清「无法恢复」。</p>
          <div className="max-w-[440px] rounded-control border border-border bg-surface">
            <div className="border-b border-line px-4 py-3">
              <p className="text-[14px] font-semibold">删除「重构前的临时会话」？</p>
              <p className="mt-1 text-[12px] leading-5 text-muted">对话记录、工具输出与隔离 worktree 会一起删除，无法恢复。</p>
            </div>
            <div className="flex items-center gap-2 px-4 py-3">
              <label className="mr-auto flex items-center gap-2 text-[12px]"><input type="checkbox" />我了解无法恢复</label>
              <button className="px-2.5 py-1.5 text-[12px] text-muted">取消</button>
              <button className="rounded-control bg-danger px-3 py-1.5 text-[12px] text-white disabled:opacity-50" disabled>删除</button>
            </div>
          </div>
        </section>

        <section className="mt-6">
          <h2 className="mb-2 text-[14px] font-medium">toast</h2>
          <div className="grid grid-cols-2 gap-3 text-[12px]">
            <div className="flex items-start gap-2 rounded-control border border-border bg-surface px-3 py-2 shadow-[0_8px_24px_rgba(20,40,60,0.12)]"><span className="icon-[lucide--circle-check] size-3.5 text-success" /><span className="flex-1">已保存到本机</span><span className="icon-[lucide--x] size-3.5 text-muted" /></div>
            <div className="flex items-start gap-2 rounded-control border border-danger/40 bg-surface px-3 py-2 shadow-[0_8px_24px_rgba(20,40,60,0.12)]"><span className="icon-[lucide--circle-x] size-3.5 text-danger" /><span className="flex-1"><span className="block font-medium">测试未通过</span><span className="block text-[11px] text-muted">2 个用例失败 · 已在时间线保留输出</span></span><span className="icon-[lucide--x] size-3.5 text-muted" /></div>
          </div>
        </section>

        <section className="mt-6 flex items-center gap-3 pb-6">
          <span className="text-[12px] text-muted">菜单与焦点：</span>
          <div className="flex items-center gap-1 rounded-control border border-border px-1.5 py-1 text-[12px]">
            <span className="icon-[lucide--folder-open] size-3.5 text-muted" />
            <span>打开文件</span>
            <span className="ml-2 rounded border border-border px-1 text-[11px] text-faint">⏎</span>
          </div>
          <div className="flex items-center gap-1 rounded-control border border-primary/60 px-1.5 py-1 text-[12px]">
            <span className="icon-[lucide--copy] size-3.5 text-muted" />
            <span>复制路径</span>
          </div>
          <span className="text-[11px] text-faint">焦点环 2px，offset 3px</span>
          <IconButton icon="icon-[lucide--settings-2]" label="图标按钮" />
        </section>
        <div className="mb-6 rounded-control border border-line bg-panel/40 px-3 py-2 text-[11px] leading-5 text-muted">
          对话框共用同一套：标题、说明、内容、右下角操作（示例见项目、搜索与系统各帧）。按 Esc 关闭，Tab 在弹窗内循环；打开时焦点移入，关闭后回到触发元素。
        </div>
      </div>
    </div>
  );
}
