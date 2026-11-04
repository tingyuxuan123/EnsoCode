import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { Extension } from "./data";
import { useExtensions } from "./ExtensionState";
import { DetailPanel, PreviewModal } from "./ExtensionOverlays";

const labels = { skill: "技能", mcp: "MCP 连接" } as const;

function Banner() {
  return (
    <section className="relative isolate flex min-h-[176px] items-center overflow-hidden rounded-2xl bg-banner px-8 py-7">
      <div aria-hidden="true" className="banner-grain absolute inset-y-0 right-0 w-[432px] opacity-70" />
      <div className="relative z-10 max-w-[444px]">
        <h2 className="text-[22px] font-semibold tracking-tight">把常用工具带进对话</h2>
        <p className="mt-2 max-w-[420px] text-[14px] leading-6 text-muted">
          用技能复用做事方法，用 MCP 连接文档和外部工具。添加后，不用离开工作台就能使用。
        </p>
      </div>
      <div aria-hidden="true" className="pointer-events-none absolute right-8 top-1/2 hidden h-[144px] w-[360px] -translate-y-1/2 md:block">
        <div className="absolute left-2 top-8 flex h-[100px] w-[132px] -rotate-[12deg] flex-col justify-between rounded-xl border border-banner-rim bg-surface p-3 shadow-object">
          <span className="icon-[lucide--file-code] size-7 text-primary" />
          <code className="text-[12px] font-medium text-muted">SKILL.md</code>
        </div>
        <div className="absolute right-2 top-8 flex h-[100px] w-[122px] rotate-[12deg] flex-col items-end justify-between rounded-xl border border-banner-rim bg-surface p-3 shadow-object">
          <div className="flex items-center gap-3 text-primary">
            <span className="icon-[lucide--plug] size-6" />
            <span className="size-1.5 rounded-full bg-primary" />
          </div>
          <span className="text-[12px] font-medium text-muted">MCP 已连接</span>
        </div>
        <div className="absolute left-[88px] top-3 flex h-[110px] w-[164px] rotate-[2deg] flex-col justify-between rounded-xl border border-banner-rim bg-mint p-3 shadow-object">
          <div className="flex items-center justify-between text-primary">
            <span className="icon-[lucide--terminal] size-7" />
            <span className="icon-[lucide--corner-down-left] size-4" />
          </div>
          <code className="whitespace-nowrap rounded-md bg-surface px-2 py-1.5 text-[11px] font-medium text-surface-foreground">/skill:enso-cdp</code>
        </div>
      </div>
    </section>
  );
}

export function ItemStatus({ item }: { item: Extension }) {
  const label = !item.installed ? "可添加" : !item.enabled ? "已停用" : item.type === "skill" ? "已启用" : item.ready ? "已连接" : "待授权";
  const tone = item.installed && item.enabled ? (item.type === "mcp" && !item.ready ? "text-warning" : "text-primary") : "text-muted";
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap text-[11px] ${tone}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}

function CatalogItem({ item, onOpen }: { item: Extension; onOpen: (id: string) => void }) {
  return (
    <button onClick={() => onOpen(item.id)} className="group flex min-h-[86px] min-w-0 items-start gap-3 rounded-card px-2 py-3 text-left hover:bg-panel focus-visible:bg-panel">
      <span className={`flex size-10 shrink-0 items-center justify-center rounded-control ${item.type === "skill" ? "bg-panel text-surface-foreground" : "bg-hover text-muted"}`}>
        <span className={`${item.icon} size-5`} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate text-[14px] font-semibold" title={item.name}>{item.name}</span>
          <span aria-hidden="true" className={`icon-[lucide--chevron-right] size-3.5 shrink-0 text-faint ${item.installed ? "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" : ""}`} />
        </span>
        <span className="mt-1 block text-[12px] leading-5 text-muted">{item.description}</span>
        <span className="mt-1 flex items-center gap-2 text-[11px] text-faint">
          {item.source}
          {item.installed && <ItemStatus item={item} />}
        </span>
      </span>
    </button>
  );
}

export function CatalogPage({ view = "installed", detail = false }: { view?: "installed" | "discover"; detail?: boolean }) {
  const { extensions, selectedId, setSelectedId, scope, setScope, query, setQuery, filter, setFilter, modal, setModal, notice, setNotice } = useExtensions();
  const activeView = detail ? scope : view;
  const [addMenu, setAddMenu] = useState(false);
  const navigate = useNavigate();
  const selected = extensions.find((item) => item.id === selectedId) ?? extensions[0];
  const filtered = extensions.filter((item) => (
    (activeView === "installed" ? item.installed : item.featured) &&
    (filter === "all" || item.type === filter) &&
    `${item.name} ${item.description} ${item.source} ${item.slug}`.toLowerCase().includes(query.trim().toLowerCase())
  ));

  useEffect(() => {
    if (!detail && !modal && !addMenu) return;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (modal) setModal(null);
      else if (addMenu) setAddMenu(false);
      else navigate(activeView === "installed" ? "/" : "/discover");
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [activeView, addMenu, detail, modal, navigate, setModal]);

  function openItem(id: string) {
    setScope(activeView);
    setSelectedId(id);
    navigate("/detail");
  }

  return (
    <>
      <main className="h-full overflow-auto" inert={detail || !!modal}>
        <div className="mx-auto w-full max-w-[1104px] px-10 pb-8 pt-8">
          <h1 className="font-display text-[28px] font-semibold leading-9 tracking-tight">扩展</h1>
          <p className="mt-1 text-[14px] leading-6 text-muted">发现和管理 Agent 可用的技能与 MCP 连接。</p>
          <div className="mt-6"><Banner /></div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex h-9 w-[252px] items-center gap-2 rounded-control bg-panel px-3 text-muted focus-within:ring-1 focus-within:ring-primary">
                <span className="icon-[lucide--search] size-4 shrink-0" />
                <input aria-label="搜索扩展" placeholder="搜索扩展" className="min-w-0 flex-1 bg-transparent text-[13px] text-surface-foreground placeholder:text-faint focus-visible:outline-none" value={query} onChange={(event) => setQuery(event.target.value)} />
                {query && <button title="清除搜索" type="button" onClick={() => setQuery("")} className="flex size-5 items-center justify-center"><span className="icon-[lucide--x] size-3.5" /></button>}
              </div>
              <label className="relative flex h-9 items-center gap-2 rounded-control border border-border px-3 text-[13px] text-muted hover:bg-panel">
                <span aria-hidden="true" className="icon-[lucide--list-filter] size-4" />
                <select aria-label="扩展类型" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} className="h-full cursor-pointer appearance-none bg-transparent pr-5 text-surface-foreground">
                  <option value="all">全部类型</option>
                  <option value="skill">技能</option>
                  <option value="mcp">MCP 连接</option>
                </select>
                <span className="icon-[lucide--chevron-down] pointer-events-none absolute right-2.5 size-3.5" />
              </label>
              <div className="relative">
                <button aria-expanded={addMenu} onClick={() => setAddMenu(!addMenu)} className="flex h-9 items-center gap-2 whitespace-nowrap rounded-control bg-surface-foreground px-3 text-[13px] font-medium text-surface hover:bg-primary">
                  <span className="icon-[lucide--plus] size-4" />
                  添加扩展
                  <span className="icon-[lucide--chevron-down] size-3.5" />
                </button>
                {addMenu && (
                  <>
                    <button tabIndex={-1} aria-label="关闭添加菜单" onClick={() => setAddMenu(false)} className="fixed inset-0 z-20 cursor-default" />
                    <div className="absolute left-0 top-full z-30 mt-2 w-[200px] rounded-xl border border-line bg-surface p-1 shadow-float">
                      <button className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left hover:bg-panel" onClick={() => { setAddMenu(false); setModal("import"); }}>
                        <span className="icon-[lucide--hard-drive-download] size-4 text-muted" />
                        从本机导入技能
                      </button>
                      <button className="flex h-9 w-full items-center gap-2 rounded-control px-2 text-left hover:bg-panel" onClick={() => { setAddMenu(false); setModal("add-mcp"); }}>
                        <span className="icon-[lucide--plug] size-4 text-muted" />
                        手动添加 MCP
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
            <nav aria-label="扩展目录" className="flex h-9 items-center rounded-control bg-panel p-1 text-[13px]">
              <Link to="/" aria-current={activeView === "installed" ? "page" : undefined} className={`flex h-7 items-center whitespace-nowrap rounded-md px-3 ${activeView === "installed" ? "bg-surface font-semibold" : "text-muted hover:bg-hover"}`}>已添加</Link>
              <Link to="/discover" aria-current={activeView === "discover" ? "page" : undefined} className={`flex h-7 items-center whitespace-nowrap rounded-md px-3 ${activeView === "discover" ? "bg-surface font-semibold" : "text-muted hover:bg-hover"}`}>精选</Link>
            </nav>
          </div>
          {activeView === "discover" && <p className="mt-4 text-[12px] text-muted">精选目录示例。当前预览不会联网安装扩展。</p>}
          {filtered.length ? (
            <div className="mt-7 space-y-6">
              {(["skill", "mcp"] as const).map((type) => {
                const rows = filtered.filter((item) => item.type === type);
                if (!rows.length) return null;
                return (
                  <section key={type} aria-label={labels[type]}>
                    <div className="flex items-baseline gap-2 border-b border-line pb-2.5">
                      <h2 className="text-[14px] font-semibold">{labels[type]}</h2>
                      <span className="text-[11px] tabular-nums text-muted">{rows.length} 项</span>
                    </div>
                    <div className="-mx-2 mt-2 grid grid-cols-1 gap-x-4 gap-y-1 md:grid-cols-2 xl:grid-cols-3">
                      {rows.map((item) => <CatalogItem key={item.id} item={item} onOpen={openItem} />)}
                    </div>
                  </section>
                );
              })}
            </div>
          ) : (
            <section className="mt-7 flex flex-col items-center gap-3 rounded-xl bg-panel py-12 text-center">
              <span className="icon-[lucide--search-x] size-6 text-muted" />
              <h2 className="text-[14px] font-semibold">没有匹配的扩展</h2>
              <p className="text-[13px] text-muted">换个关键词，或查看全部类型。</p>
              <button className="rounded-control bg-surface px-3 py-2 text-[13px] font-medium" onClick={() => { setQuery(""); setFilter("all"); }}>清除筛选</button>
            </section>
          )}
          {activeView === "installed" && (
            <p className="mt-6 flex items-center gap-2 text-[12px] text-muted">
              <span className="icon-[lucide--info] size-3.5 shrink-0" />
              现有会话保留已加载的技能；更改后请新开会话。
            </p>
          )}
        </div>
      </main>
      {detail && <DetailPanel item={selected} close={() => navigate(activeView === "installed" ? "/" : "/discover")} />}
      {modal && <PreviewModal item={detail ? selected : undefined} />}
      {notice && (
        <div role="status" className="absolute bottom-5 right-5 z-50 flex max-w-[420px] items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px] shadow-float">
          <span className="icon-[lucide--info] size-4 shrink-0 text-primary" />
          <span>{notice}</span>
          <button title="关闭提示" onClick={() => setNotice("")} className="ml-1 flex size-6 shrink-0 items-center justify-center rounded hover:bg-panel"><span className="icon-[lucide--x] size-4" /></button>
        </div>
      )}
    </>
  );
}
