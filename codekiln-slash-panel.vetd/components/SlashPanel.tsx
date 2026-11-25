import { type KeyboardEvent, useId, useRef, useState } from "react";
import mark from "../assets/codekiln-mark.png";
import { type Candidate, groups } from "./commands";

const suggestions = [
  { icon: "icon-[lucide--flask-conical]", title: "为核心模块补上测试" },
  { icon: "icon-[lucide--git-pull-request]", title: "基于 git log 生成变更摘要" },
];

function CandidateIcon({ item }: { item: Candidate }) {
  if (typeof item.icon !== "string") {
    return <img src={item.icon.image} alt="" className="size-5 object-contain" />;
  }
  const color = item.builtin === "image" ? "text-image-icon" : item.builtin === "plugin" ? "text-plugin-icon" : "text-muted";
  return <span aria-hidden="true" className={`${item.icon} size-4 ${color}`} />;
}

export default function SlashPanel({ initialSkill, detail = false }: { initialSkill?: Candidate; detail?: boolean }) {
  const editor = useRef<HTMLInputElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const listId = useId();
  const [draft, setDraft] = useState(initialSkill ? "" : "/");
  const [open, setOpen] = useState(!initialSkill);
  const [activeIndex, setActiveIndex] = useState(0);
  const [chip, setChip] = useState(initialSkill);
  const [attachment, setAttachment] = useState("");
  const [sent, setSent] = useState("");
  const query = draft.startsWith("/") ? draft.slice(1).trim().toLowerCase() : "";
  const matches = groups.map(group => ({
    ...group,
    items: group.items.filter(item => `${item.name} ${item.label} ${item.keywords ?? ""}`.toLowerCase().includes(query)),
  }));
  const visible = matches.flatMap(group => group.items);
  const active = visible[activeIndex];
  const canSend = Boolean(chip || draft.trim() || attachment);

  function pick(item: Candidate, option = "") {
    setChip(item.prompt ? undefined : item);
    setDraft(item.prompt ?? option);
    setOpen(false);
    requestAnimationFrame(() => {
      const input = editor.current;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
    });
  }

  function removeChip() {
    setChip(undefined);
    editor.current?.focus();
  }

  function setText(text: string) {
    setDraft(text);
    setActiveIndex(0);
    setOpen(text.startsWith("/") && !chip);
  }

  function replaceDraft(text: string) {
    setChip(undefined);
    setDraft(text);
    setActiveIndex(0);
    setOpen(text.startsWith("/"));
    editor.current?.focus();
  }

  function sendPreview() {
    if (open) {
      if (active) pick(active);
      return;
    }
    if (!canSend) return;
    setSent([chip?.name, draft.trim(), attachment ? `附件：${attachment}` : ""].filter(Boolean).join(" "));
    setDraft("");
    setChip(undefined);
    setAttachment("");
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing) return;
    if (open && event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (open && visible.length && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const next = (activeIndex + (event.key === "ArrowUp" ? -1 : 1) + visible.length) % visible.length;
      setActiveIndex(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: "nearest" });
    } else if (open && active && (event.key === "Enter" || (event.key === "Tab" && !event.shiftKey))) {
      event.preventDefault();
      pick(active);
    } else if (!open && chip && !draft && event.key === "Backspace") {
      event.preventDefault();
      removeChip();
    } else if (!open && event.key === "Enter") {
      event.preventDefault();
      sendPreview();
    }
  }

  let optionIndex = 0;

  return (
    <div className="flex h-full overflow-hidden bg-surface font-sans text-sm text-surface-foreground">
      {!detail && (
        <aside aria-label="工作区" className="flex w-56 shrink-0 flex-col bg-rail px-3 pb-4">
        <div className="flex h-14 shrink-0 items-center gap-2.5 px-2">
          <img src={mark} alt="" className="size-7 object-contain" />
          <span className="font-display text-base font-semibold">CodeKiln</span>
        </div>
        <div className="mt-4 space-y-1">
          <button
            type="button"
            onClick={() => { setSent(""); setAttachment(""); replaceDraft(""); }}
            className="flex h-9 w-full items-center gap-2.5 rounded-lg bg-panel px-3 text-left font-medium hover:bg-hover"
          >
            <span aria-hidden="true" className="icon-[lucide--square-pen] size-4" />
            新对话
          </button>
        </div>
        <div className="mt-8 px-3 text-xs text-muted">工作区</div>
        <div className="mt-3 flex items-center gap-2.5 px-3 font-medium">
          <span aria-hidden="true" className="icon-[lucide--folder-open] size-4 text-muted" />
          EnsoCode
        </div>
        <div className="mt-3 space-y-1">
          {suggestions.map(item => (
            <button
              key={item.title}
              type="button"
              onClick={() => replaceDraft(item.title)}
              className="flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left text-xs text-muted hover:bg-panel hover:text-surface-foreground"
            >
              <span aria-hidden="true" className="icon-[lucide--message-square] size-3.5 shrink-0" />
              <span className="truncate">{item.title}</span>
            </button>
          ))}
        </div>
        <div className="mt-auto flex items-center gap-2.5 px-3 py-2 text-xs text-muted">
          <span aria-hidden="true" className="icon-[lucide--laptop] size-4" />
          本地工作区
        </div>
        </aside>
      )}

      <main className={`flex min-w-0 flex-1 flex-col ${detail ? "justify-center" : ""}`}>
        {!detail && (
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line px-8 text-xs">
            <span className="text-muted">EnsoCode</span>
            <span className="icon-[lucide--chevron-right] size-3.5 text-muted" aria-hidden="true" />
            <span className="font-medium text-surface-foreground">新对话</span>
          </header>
        )}

        <div className={`mx-auto flex min-h-0 w-[calc(100%-64px)] max-w-[920px] flex-col ${detail ? "max-h-full" : "flex-1"}`}>
          {(!detail || sent) && (
            <section className={`relative min-h-0 flex-1 ${detail ? "pb-4" : "pt-9"}`} aria-label="会话正文">
            {sent ? (
              <div className="ml-auto max-w-[560px] rounded-card bg-hover px-5 py-4">
                <p className="text-xs text-muted">原型预览 · 未实际发送</p>
                <p className="mt-2 break-words">{sent}</p>
              </div>
            ) : (
              <>
                <h1 className="font-display text-[24px] leading-tight font-semibold">开始新对话</h1>
                <p className="mt-3 leading-6 text-muted">描述你要做的事，或输入 <code className="rounded bg-hover px-1.5 text-surface-foreground">/</code> 查找命令和技能。</p>
                <div className="mt-4 flex flex-wrap gap-x-8 gap-y-2">
                  {suggestions.map(item => (
                    <button
                      key={item.title}
                      type="button"
                      onClick={() => replaceDraft(item.title)}
                      className="group inline-flex h-8 items-center gap-2 text-sm text-muted hover:text-surface-foreground"
                    >
                      <span aria-hidden="true" className={`${item.icon} size-4`} />
                      {item.title}
                      <span aria-hidden="true" className="icon-[lucide--arrow-up-right] size-3.5" />
                    </button>
                  ))}
                </div>
              </>
            )}
            </section>
          )}

          <div className={`shrink-0 overflow-hidden rounded-card border border-edge bg-panel ${open ? "shadow-tray" : ""} ${detail ? "" : "mb-9"}`}>
            {open && (
              <section aria-label="命令面板">
                <header className="flex h-14 items-center justify-between gap-4 px-5">
                  <h2 className="flex items-center gap-2.5 font-display text-base font-semibold">
                    <span aria-hidden="true" className="icon-[lucide--terminal] size-4 text-muted" />
                    命令与技能
                  </h2>
                  <div className="flex items-center gap-4">
                    <span className="text-xs text-muted tabular-nums">{visible.length} 个结果</span>
                    <button
                      type="button"
                      aria-label="关闭命令面板"
                      onClick={() => { setOpen(false); editor.current?.focus(); }}
                      className="grid size-7 place-items-center rounded-md text-muted hover:bg-hover hover:text-surface-foreground"
                    >
                      <span aria-hidden="true" className="icon-[lucide--x] size-4" />
                    </button>
                  </div>
                </header>

                <div className={`grid grid-cols-[minmax(0,46fr)_minmax(0,54fr)] border-y border-line ${detail ? "h-[112px]" : "h-[416px]"}`}>
                  <div id={listId} role="listbox" aria-label="命令与技能" className="min-h-0 overflow-auto overscroll-contain px-3 py-2.5">
                    {matches.filter(group => group.items.length).map(group => (
                      <div key={group.label} role="group" aria-label={group.label} className="mb-2 last:mb-0">
                        <p aria-hidden="true" className="px-3 py-1.5 text-xs font-medium text-muted">{group.label}</p>
                        {group.items.map(item => {
                          const index = optionIndex++;
                          const selected = activeIndex === index;
                          return (
                            <button
                              key={item.name}
                              type="button"
                              id={`${listId}-${index}`}
                              role="option"
                              aria-selected={selected}
                              tabIndex={-1}
                              onMouseDown={event => event.preventDefault()}
                              onClick={() => { setActiveIndex(index); editor.current?.focus(); }}
                              onDoubleClick={() => pick(item)}
                              className={`flex h-8 w-full items-center gap-2.5 rounded-lg px-3 text-left ${selected ? "bg-primary-wash text-primary-ink" : "hover:bg-hover"}`}
                            >
                              <span aria-hidden="true" className="grid size-5 shrink-0 place-items-center">
                                <CandidateIcon item={item} />
                              </span>
                              {item.builtin ? (
                                <span className="min-w-0 truncate text-sm font-semibold">{item.label}</span>
                              ) : (
                                <code className="min-w-0 truncate text-xs font-medium">{item.name}</code>
                              )}
                              <span className="ml-auto shrink-0 text-xs text-muted">{item.builtin ? (item.builtin === "design" ? "技能" : "能力") : item.label}</span>
                              <span aria-hidden="true" className={`icon-[lucide--chevron-right] size-3.5 shrink-0 ${selected ? "opacity-100" : "opacity-0"}`} />
                            </button>
                          );
                        })}
                      </div>
                    ))}
                    {!visible.length && (
                      <div className="px-3 pt-3">
                        <p className="font-medium">没有匹配的命令</p>
                        <p className="mt-2 text-xs text-muted">试试缩短筛选词，或删除 / 后的文字。</p>
                      </div>
                    )}
                  </div>

                  <div aria-label="命令预览" className="flex min-h-0 min-w-0 flex-col overflow-auto border-l border-line bg-preview px-6 py-4">
                    {active ? (
                      <>
                        <h3 className="min-w-0 break-words font-display text-[24px] leading-8 font-semibold">{active.label}</h3>
                        <p className="mt-1.5 max-w-[380px] text-sm leading-5 text-muted">{active.description}</p>
                        <div className="mt-4 flex min-h-9 items-center gap-3 rounded-lg border border-line bg-panel px-3">
                          <span className="shrink-0 text-xs text-muted">用法</span>
                          {active.prompt ? (
                            <span className="min-w-0 text-xs font-medium">{active.syntax}</span>
                          ) : (
                            <code className="min-w-0 break-all text-xs font-medium">{active.syntax}</code>
                          )}
                        </div>
                        {active.options && (
                          <ul className="mt-2">
                            {active.options.map(option => (
                              <li key={option.name}>
                                <button type="button" onClick={() => pick(active, option.name)} className="grid h-6 w-full grid-cols-[72px_1fr] items-center rounded px-3 text-left hover:bg-hover">
                                  <code className="text-xs">{option.name}</code>
                                  <span className="text-xs text-muted">{option.label}</span>
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        {active.example && (
                          <p className="mt-3 px-3 text-xs text-muted">示例：{active.example.startsWith("/") ? <code>{active.example}</code> : active.example}</p>
                        )}
                        <div className="mt-auto flex justify-end pt-2">
                          <button type="button" onClick={() => pick(active)} className="inline-flex h-8 items-center gap-2 rounded-lg bg-surface-foreground px-3 text-xs font-medium text-panel hover:bg-muted">
                            {active.prompt ? "填入提示词" : "填入输入框"}
                            <span aria-hidden="true" className="icon-[lucide--corner-down-left] size-3.5" />
                          </button>
                        </div>
                      </>
                    ) : (
                      <p className="pt-3 text-sm text-muted">选中命令后，在这里查看用法。</p>
                    )}
                  </div>
                </div>

                <div aria-label="键盘快捷键" className="flex h-10 items-center gap-5 border-b border-line px-5 text-xs text-muted">
                  <div className="flex items-center gap-1.5">
                    <kbd className="rounded border border-line bg-preview px-1.5">↑</kbd>
                    <kbd className="rounded border border-line bg-preview px-1.5">↓</kbd>
                    <span className="ml-0.5">移动</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="rounded border border-line bg-preview px-1.5 font-sans">↵</kbd>
                    <span>填入</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <kbd className="rounded border border-line bg-preview px-1.5 font-sans">Esc</kbd>
                    <span>关闭</span>
                  </div>
                </div>
              </section>
            )}

            {attachment && (
              <div className="px-5 pt-3">
                <button type="button" aria-label={`移除附件 ${attachment}`} onClick={() => setAttachment("")} className="inline-flex max-w-full items-center gap-2 rounded-md bg-hover px-2 py-1 text-xs hover:bg-line">
                  <span aria-hidden="true" className="icon-[lucide--image] size-3.5 shrink-0" />
                  <span className="truncate">{attachment}</span>
                  <span aria-hidden="true" className="icon-[lucide--x] size-3.5 shrink-0 text-muted" />
                </button>
              </div>
            )}
            <div className="flex min-h-[80px] items-start gap-2.5 px-5 pt-4 pb-2">
              {chip && (
                <button
                  type="button"
                  aria-label={`移除${chip.label}`}
                  title={`移除${chip.label}`}
                  onClick={removeChip}
                  className="group/chip inline-flex h-8 max-w-[50%] shrink-0 items-center gap-1.5 rounded-lg border border-chip-edge bg-hover px-2.5 text-sm font-semibold text-surface-foreground hover:border-muted focus-visible:outline-2 focus-visible:outline-primary"
                >
                  <span aria-hidden="true" className="relative grid size-5 shrink-0 place-items-center">
                    <span className="grid place-items-center group-hover/chip:opacity-0 group-focus-visible/chip:opacity-0">
                      <CandidateIcon item={chip} />
                    </span>
                    <span className="icon-[lucide--x] absolute size-3.5 text-muted opacity-0 group-hover/chip:opacity-100 group-focus-visible/chip:opacity-100" />
                  </span>
                  <span className="truncate">{chip.builtin || chip.name.startsWith("/skill:") ? chip.label : chip.name}</span>
                </button>
              )}
              <input
                ref={editor}
                aria-label="输入消息或筛选命令"
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={open}
                aria-controls={open ? listId : undefined}
                aria-activedescendant={open && active ? `${listId}-${activeIndex}` : undefined}
                value={draft}
                placeholder={chip?.name === "/goal" ? "写下这段会话的目标…" : chip ? "" : "输入消息，或输入 / 查找命令"}
                onClick={() => { if (!chip && draft.startsWith("/")) setOpen(true); }}
                onChange={event => setText(event.target.value)}
                onKeyDown={onKeyDown}
                className="h-8 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
              />
            </div>

            <div className="flex h-14 items-center justify-between gap-2 border-t border-line px-4 text-xs text-muted">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex items-center gap-1">
                  <input ref={fileInput} type="file" accept="image/*" hidden onChange={event => {
                    if (event.target.files?.[0]) setAttachment(event.target.files[0].name);
                    event.target.value = "";
                  }} />
                  <button type="button" aria-label="添加图片" onClick={() => fileInput.current?.click()} className="grid size-8 shrink-0 place-items-center rounded-lg hover:bg-hover">
                    <span aria-hidden="true" className="icon-[lucide--image-plus] size-4" />
                  </button>
                  <button type="button" aria-label="打开或关闭命令面板" onClick={() => { if (open) { setOpen(false); editor.current?.focus(); } else { replaceDraft("/"); } }} className="grid size-8 shrink-0 place-items-center rounded-lg bg-hover hover:bg-line">
                    <span aria-hidden="true" className="icon-[lucide--square-slash] size-4" />
                  </button>
                </div>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span aria-hidden="true" className="icon-[lucide--layers] size-4" />
                  全局
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span aria-hidden="true" className="icon-[lucide--git-branch] size-4" />
                  main
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span aria-hidden="true" className="icon-[lucide--clipboard-list] size-4" />
                  计划
                </span>
                <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span aria-hidden="true" className="icon-[lucide--shield-off] size-4" />
                  完全放行
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span className="inline-flex items-center gap-2 whitespace-nowrap">
                  <span aria-hidden="true" className="icon-[lucide--sparkle] size-4" />
                  <span className="font-medium text-surface-foreground">GPT-6.2 Sol</span>
                  <span>极高</span>
                </span>
                <button type="button" aria-label="预览发送" disabled={!canSend || (open && !active)} onClick={sendPreview} className="grid size-9 place-items-center rounded-lg bg-primary text-primary-foreground hover:bg-primary-ink disabled:bg-hover disabled:text-muted">
                  <span aria-hidden="true" className="icon-[lucide--arrow-up] size-5" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
