import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { projectRows } from "./data";
import { useExtensions } from "./ExtensionState";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState("项目");
  const [collapsed, setCollapsed] = useState(false);
  const [openProject, setOpenProject] = useState("EnsoCode");
  const { setNotice, setModal } = useExtensions();
  const preview = () => setNotice("当前是扩展页设计预览；项目、会话和本机配置不会改变。");
  return (
    <div className="flex h-full flex-col overflow-hidden bg-panel text-[13px] text-surface-foreground">
      <header className="flex h-10 shrink-0 items-center justify-between px-4">
        <div className="flex w-[300px] items-center gap-3">
          <div className="flex gap-2" aria-hidden="true">
            <span className="size-2.5 rounded-full bg-traffic-red" />
            <span className="size-2.5 rounded-full bg-traffic-yellow" />
            <span className="size-2.5 rounded-full bg-traffic-green" />
          </div>
          <span className="font-display text-muted">EnsoCode <span className="ml-1 font-sans">工作台</span></span>
        </div>
        <div className="flex items-center gap-2 font-medium">
          <span>扩展</span>
          <span className="rounded bg-hover px-2 py-0.5 text-[11px] font-normal text-muted">EnsoCode</span>
        </div>
        <div className="flex w-[300px] justify-end gap-4 text-muted">
          <button title="当前预览为扩展页" onClick={preview} className="flex size-6 items-center justify-center rounded hover:bg-hover">
            <span className="icon-[lucide--move-horizontal] size-4" />
          </button>
          <button title="当前预览为扩展页" onClick={preview} className="flex size-6 items-center justify-center rounded hover:bg-hover">
            <span className="icon-[lucide--panel-right] size-4" />
          </button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <nav aria-label="主导航" className="flex w-14 shrink-0 flex-col items-center gap-2 py-4">
          <span className="enso-mark mb-2" aria-label="EnsoCode" />
          <button title={collapsed ? "展开侧栏" : "收起侧栏"} onClick={() => setCollapsed(!collapsed)} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover">
            <span className="icon-[lucide--panel-left] size-[18px]" />
          </button>
          <div className="my-1 w-5 border-t border-border" />
          <button title="Code" onClick={preview} className="flex size-9 items-center justify-center rounded-lg bg-selected">
            <span className="icon-[lucide--square-terminal] size-[18px]" />
          </button>
          <button title="Bot" onClick={preview} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover">
            <span className="icon-[lucide--bot] size-[18px]" />
          </button>
          <button title="设计" onClick={preview} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover">
            <span className="icon-[lucide--ruler] size-[18px]" />
          </button>
          <div className="flex-1" />
          <button title="询问 Enso" onClick={preview} className="flex size-9 items-center justify-center rounded-lg hover:bg-hover">
            <span className="icon-[lucide--sparkles] size-[18px]" />
          </button>
          <button title="设置" onClick={preview} className="flex size-9 items-center justify-center rounded-lg text-muted hover:bg-hover">
            <span className="icon-[lucide--settings-2] size-[18px]" />
          </button>
        </nav>
        {!collapsed && (
          <aside className="flex w-[264px] shrink-0 flex-col bg-sidebar px-3 pb-3 pt-3">
            <div className="flex gap-2">
              <div className="flex flex-1 rounded-lg bg-panel p-1">
                {["项目", "对话"].map((label) => (
                  <button key={label} onClick={() => setTab(label)} className={`h-7 flex-1 rounded-md ${tab === label ? "bg-surface font-medium" : "text-muted hover:bg-hover"}`}>{label}</button>
                ))}
              </div>
              <button title="搜索任意内容" onClick={preview} className="flex size-9 items-center justify-center rounded-lg bg-panel text-muted hover:bg-hover">
                <span className="icon-[lucide--search] size-4" />
              </button>
            </div>
            <button onClick={() => setModal("compose")} className="mt-4 flex h-9 items-center gap-2 rounded-lg px-2 hover:bg-hover">
              <span className="icon-[lucide--circle-plus] size-4" />
              <span>新建{tab === "项目" ? "任务" : "对话"}</span>
              <span className="ml-auto rounded border border-border px-1 text-[11px] text-muted">⌘N</span>
            </button>
            <Link to="/" className="mt-1 flex h-9 items-center gap-2 rounded-lg bg-mint px-2 font-medium text-primary" aria-current="page">
              <span className="icon-[lucide--puzzle] size-4" />
              <span>扩展</span>
            </Link>
            <div className="mb-2 mt-7 flex items-center px-2 text-[11px] text-muted">
              <span>{tab}</span>
              <button className="ml-auto flex size-5 items-center justify-center" title="全部折叠" onClick={() => setOpenProject("")}>
                <span className="icon-[lucide--chevrons-up-down] size-3.5" />
              </button>
              <button className="ml-2 flex size-5 items-center justify-center" title="添加项目（预览）" onClick={preview}>
                <span className="icon-[lucide--plus] size-3.5" />
              </button>
            </div>
            {tab === "项目" ? (
              <>
                <div className="mb-5 flex gap-1 px-1 text-[11px] text-muted">
                  <span className="rounded-full bg-hover px-2 py-1">全部 {projectRows.length}</span>
                  <span className="rounded-full px-2 py-1">工作 1</span>
                  <span className="rounded-full px-2 py-1">个人 2</span>
                </div>
                {projectRows.map((project) => (
                  <div key={project.name} className="mb-3">
                    <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover" onClick={() => setOpenProject(openProject === project.name ? "" : project.name)}>
                      <span className="icon-[lucide--folder-open] size-4 text-muted" />
                      <span className="min-w-0 flex-1">
                        <span className="block font-medium">{project.name}</span>
                        <span className="text-[11px] text-muted">{project.group}</span>
                      </span>
                      <span className={`size-3 text-muted ${openProject === project.name ? "icon-[lucide--chevron-down]" : "icon-[lucide--chevron-right]"}`} />
                    </button>
                    {openProject === project.name && (
                      <div className="ml-4 mt-1 border-l border-border pl-3 text-[11px] text-muted">
                        <button className="block py-2 text-left hover:text-surface-foreground" onClick={preview}>{project.name === "EnsoCode" ? "Vetta 与 EnsoCode 功能规划" : "开始一个新任务"}</button>
                        {project.name === "EnsoCode" && <button className="block py-2 text-left hover:text-surface-foreground" onClick={preview}>薄荷白主题样式优化</button>}
                      </div>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <button className="rounded-lg px-2 py-3 text-left text-muted hover:bg-hover" onClick={preview}>临时对话预览</button>
            )}
            <div className="flex-1" />
            <button className="flex items-center gap-2 rounded-lg px-2 py-2 text-[11px] text-muted hover:bg-hover" onClick={preview}>
              <span className="icon-[lucide--laptop] size-3.5" />
              本机
              <span className="icon-[lucide--chevron-down] size-3" />
            </button>
            <button className="mt-1 flex items-center gap-2 rounded-lg px-2 py-2 text-[11px] text-muted hover:bg-hover" onClick={preview}>
              <span className="icon-[lucide--archive] size-3.5" />
              已归档
            </button>
          </aside>
        )}
        <div className="relative min-w-0 flex-1 overflow-hidden border-l border-line bg-surface">{children}</div>
      </div>
      <footer className="flex h-6 shrink-0 items-center justify-between px-4 text-[11px] text-muted">
        <span className="flex items-center gap-1.5"><span className="size-1.5 rounded-full bg-primary" /><span className="icon-[lucide--laptop] size-3" />本地工作区</span>
        <span className="flex items-center gap-1.5">设计预览 · 数据留在本机<span className="icon-[lucide--shield-check] size-3" /></span>
      </footer>
    </div>
  );
}
