import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Extension } from "./data";
import { useExtensions } from "./ExtensionState";

const actionClass = "flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-control bg-surface-foreground px-3 text-[13px] font-medium text-surface hover:bg-primary";
const secondaryClass = "flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-control border border-border px-3 text-[13px] font-medium hover:bg-panel";

export function DetailPanel({ item, close }: { item: Extension; close: () => void }) {
  const { install, toggle, authorize, setModal, setNotice, modal } = useExtensions();
  const command = `/skill:${item.slug}`;
  const needsAuth = item.type === "mcp" && !item.ready && item.enabled;
  const status = !item.installed ? "尚未添加" : !item.enabled ? "已停用" : needsAuth ? "待授权" : item.type === "skill" ? "已启用" : "已连接";
  const panelRef = useRef<HTMLElement>(null);
  useEffect(() => { panelRef.current?.focus(); }, [item.id]);

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(command);
      setNotice("已复制对话命令。");
    } catch {
      setNotice("无法自动复制，可以选中命令手动复制。");
    }
  }

  return (
    <>
      <button tabIndex={-1} aria-label="返回扩展目录" onClick={close} className="absolute inset-0 z-10 bg-surface-foreground/12" />
      <aside ref={panelRef} tabIndex={-1} role="dialog" aria-label="扩展详情" inert={!!modal} className="absolute inset-y-0 right-0 z-20 flex w-[440px] max-w-full flex-col overflow-auto bg-surface shadow-float outline-none">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-line px-5 text-[13px]">
          <button className="flex h-8 items-center gap-2 rounded-control px-2 text-muted hover:bg-panel" onClick={close}>
            <span className="icon-[lucide--arrow-left] size-4" />
            返回扩展
          </button>
          <button title="关闭详情" onClick={close} className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-panel">
            <span className="icon-[lucide--x] size-4" />
          </button>
        </div>
        <div className="flex-1 px-7 pb-7 pt-8">
          <div className="flex items-center gap-4">
            <div className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-panel text-primary">
              <span className={`${item.icon} size-7`} />
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-[22px] font-semibold leading-7">{item.name}</h2>
              <p className="mt-1 text-[12px] text-muted">{item.type === "skill" ? "技能" : "MCP 连接"} · {item.source}</p>
            </div>
          </div>
          <p className="mt-5 text-[14px] leading-6 text-muted">{item.description}</p>
          <div className="mt-4 flex items-center gap-2">
            {!item.installed ? (
              <button className={actionClass} onClick={() => install(item.id)}><span className="icon-[lucide--plus] size-4" />添加到演示目录</button>
            ) : item.type === "skill" && item.enabled ? (
              <button className={actionClass} onClick={() => setModal("compose")}><span className="icon-[lucide--message-square-plus] size-4" />在对话中使用</button>
            ) : needsAuth ? (
              <button className={actionClass} onClick={() => authorize(item.id)}><span className="icon-[lucide--shield-check] size-4" />模拟授权</button>
            ) : null}
            {item.installed && <button className={secondaryClass} onClick={() => toggle(item.id)}>{item.enabled ? "停用" : "启用"}</button>}
          </div>
          <dl className="mt-7 grid grid-cols-2 gap-4 border-y border-line py-4 text-[13px]">
            <div><dt className="text-[11px] text-muted">状态</dt><dd className="mt-1 font-medium">{status}</dd></div>
            <div><dt className="text-[11px] text-muted">来源</dt><dd className="mt-1 font-medium">{item.source}</dd></div>
          </dl>
          <section className="detail-copy mt-7">
            <h3 className="text-[14px] font-semibold">它能做什么</h3>
            <p className="mt-2 text-[13px] text-muted">{item.detail}</p>
          </section>
          <section className="detail-copy mt-7">
            <h3 className="text-[14px] font-semibold">{item.type === "skill" ? "在输入框调用" : "连接与权限"}</h3>
            {item.type === "skill" ? (
              <>
                <div className="mt-2 flex items-center justify-between gap-2 rounded-control bg-code px-3 py-2">
                  <code className="min-w-0 select-all break-all text-[12px]">{command}</code>
                  <button title="复制命令" onClick={copyCommand} className="flex size-7 shrink-0 items-center justify-center rounded-control text-muted hover:bg-surface">
                    <span className="icon-[lucide--copy] size-3.5" />
                  </button>
                </div>
                <p className="mt-2 text-[12px] text-muted">新建会话后可加载启用的技能。已有会话不会被重置。</p>
              </>
            ) : <p className="mt-2 text-[13px] text-muted">MCP 可以把外部工具交给 Agent。先确认服务来源和授权范围，再连接账号或使用凭证。</p>}
          </section>
          {item.path && (
            <section className="mt-7">
              <h3 className="text-[14px] font-semibold">技能文件</h3>
              <code className="mt-2 block break-all rounded-control bg-code p-3 text-[12px] text-muted">{item.path}</code>
            </section>
          )}
        </div>
        <p className="flex items-center gap-2 border-t border-line px-7 py-4 text-[12px] text-muted">
          <span className="icon-[lucide--info] size-3.5 shrink-0" />
          这是设计预览，不会修改真实配置。
        </p>
      </aside>
    </>
  );
}

export function PreviewModal({ item }: { item?: Extension }) {
  const { modal, setModal, setNotice, add, extensions } = useExtensions();
  const dialog = useRef<HTMLDialogElement>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [draft, setDraft] = useState(item ? `/skill:${item.slug} ` : "");
  const [error, setError] = useState("");
  const close = () => setModal(null);

  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  const importSample = () => {
    if (extensions.some((entry) => entry.id === "imported-example")) {
      setError("示例技能已在目录中。");
      return;
    }
    add({ id: "imported-example", name: "交付前检查", slug: "delivery-checklist", type: "skill", icon: "icon-[lucide--list-checks]", source: "导入示例", installed: true, enabled: true, description: "检查变更范围、测试与交付说明。", detail: "在交付前核对改动和验证结果。此技能只存在于设计预览内。" });
  };

  function saveMcp(event: FormEvent) {
    event.preventDefault();
    let address: URL;
    try {
      address = new URL(url);
    } catch {
      setError("请输入有效的服务地址。");
      return;
    }
    if (address.protocol !== "http:" && address.protocol !== "https:") {
      setError("服务地址须使用 HTTP 或 HTTPS。");
      return;
    }
    const displayName = name.trim();
    if (!displayName) {
      setError("请输入连接名称。");
      return;
    }
    if (extensions.some((entry) => entry.type === "mcp" && entry.name.toLowerCase() === displayName.toLowerCase())) {
      setError("已有同名连接，请换一个名称。");
      return;
    }
    add({ id: `mcp:${displayName.toLowerCase()}`, name: displayName, slug: displayName.toLowerCase(), type: "mcp", icon: "icon-[lucide--plug]", source: "手动添加", installed: true, enabled: true, ready: false, description: `HTTP 服务 · ${address.hostname}`, detail: "通过手动配置添加的演示连接。此预览未发起网络请求。" });
  }

  return (
    <dialog ref={dialog} onCancel={(event) => { event.preventDefault(); close(); }} className="fixed m-auto w-[440px] max-w-[calc(100%-32px)] rounded-2xl bg-surface p-6 text-surface-foreground shadow-float backdrop:bg-surface-foreground/25">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-[18px] font-semibold">{modal === "add-mcp" ? "添加 MCP 连接" : modal === "compose" ? "新会话预览" : "从本机导入技能"}</h2>
        <button title="关闭" className="flex size-8 items-center justify-center rounded-control text-muted hover:bg-panel" onClick={close}><span className="icon-[lucide--x] size-4" /></button>
      </div>
      {modal === "add-mcp" ? (
        <form onSubmit={saveMcp} className="mt-4 space-y-4 text-[13px]">
          <p className="text-muted">仅演示 HTTP 连接，不会连接服务。请不要填写凭证。</p>
          <label className="block">连接名称<input required className="mt-1.5 h-9 w-full rounded-control border border-input px-3" placeholder="例如：团队开发文档" value={name} onChange={(event) => setName(event.target.value)} /></label>
          <label className="block">服务地址<input required type="url" className="mt-1.5 h-9 w-full rounded-control border border-input px-3" placeholder="https://example.com/mcp" value={url} onChange={(event) => setUrl(event.target.value)} /></label>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} onClick={close}>取消</button><button className={actionClass}>添加演示连接</button></div>
        </form>
      ) : modal === "compose" ? (
        <div className="mt-4 space-y-4 text-[13px]">
          <p className="text-muted">{item ? "技能命令已放入输入框。预览不会启动 Agent。" : "输入一项任务，预览不会启动 Agent。"}</p>
          <textarea aria-label="任务内容" className="min-h-24 w-full rounded-xl border border-input p-3" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="描述你要完成的任务" />
          <div className="flex justify-end gap-2"><button className={secondaryClass} onClick={close}>关闭</button><button className={actionClass} disabled={!draft.trim()} onClick={() => { close(); setNotice("已预览提交。没有发送消息，也没有启动 Agent。"); }}>预览提交</button></div>
        </div>
      ) : (
        <div className="mt-4 space-y-4 text-[13px]">
          <p className="text-muted">正式版可从本机已有工具导入技能。设计稿只用示例演示，不读取本机文件。</p>
          {error && <p role="alert" className="text-danger">{error}</p>}
          <div className="flex justify-end gap-2"><button className={secondaryClass} onClick={close}>取消</button><button className={actionClass} onClick={importSample}>导入示例技能</button></div>
        </div>
      )}
    </dialog>
  );
}
