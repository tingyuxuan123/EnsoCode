export const frame = { width: 1440, height: 900, title: "薄荷白 · 主题样式" };

import { Link, useOutletContext } from 'react-router';
import { palettes } from '../components/data';
import type { ShellState } from '../components/Shell';

export default function Appearance() {
  const { compact, setCompact, setSessionId } = useOutletContext<ShellState>();

  return (
    <main className="min-w-0 flex-1 overflow-y-auto px-10 pb-10 pt-8">
      <div className="mx-auto max-w-[880px]">
        <header className="flex items-end justify-between gap-5">
          <div>
            <h1 className="font-display text-[36px] font-bold leading-tight tracking-tight">薄荷白</h1>
            <p className="mt-2 text-[14px] leading-6 text-muted">为 EnsoCode 工作台设计的浅色主题。绿色只在需要读到状态或采取行动时出现。</p>
          </div>
          <Link to="/" className="flex h-9 shrink-0 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/90">
            预览工作台
            <span className="icon-[lucide--arrow-up-right] size-4" />
          </Link>
        </header>
        <section className="mt-8" aria-labelledby="palette-heading">
          <h2 id="palette-heading" className="text-[16px] font-semibold">主题色板</h2>
          <div className="mt-3 grid grid-cols-6 gap-3">
            {palettes.map((color) => (
              <div key={color.token} className="min-w-0">
                <div className={`h-[76px] rounded-control border border-line ${color.token}`} />
                <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[14px] font-semibold">{color.label}</span>
                  <span className="text-[12px] text-quiet tabular-nums">{color.hex}</span>
                </div>
                <p className="mt-0.5 text-[12px] leading-5 text-muted">{color.role}</p>
              </div>
            ))}
          </div>
        </section>
        <section className="mt-8 grid grid-cols-[1.18fr_1fr] gap-6 border-t border-line pt-6" aria-labelledby="states-heading">
          <div>
            <h2 id="states-heading" className="text-[16px] font-semibold">会话列表</h2>
            <p className="mb-3 mt-1 text-[14px] text-muted">选中项用白色浮层和细绿标记，不给整行铺绿。</p>
            <div className="rounded-card bg-panel p-3">
              <div className={`relative flex items-center gap-3 rounded-[16px] bg-surface px-3 shadow-selection ${compact ? 'min-h-[56px]' : 'min-h-[68px]'}`}>
                <span className="absolute bottom-4 left-0 top-4 w-[3px] rounded-r-full bg-signal" />
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-mint text-primary">
                  <span className="icon-[lucide--panels-top-left] size-4" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold text-primary">设计面板展开</p>
                  <p className="mt-0.5 text-[12px] text-quiet">当前会话 · 选中</p>
                </div>
              </div>
              <div className={`mt-1 flex items-center gap-3 rounded-[16px] px-3 ${compact ? 'min-h-[56px]' : 'min-h-[68px]'}`}>
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-inset text-quiet">
                  <span className="icon-[lucide--activity] size-4" />
                </span>
                <div>
                  <p className="text-[14px] font-semibold">画布活动提示</p>
                  <p className="mt-0.5 text-[12px] text-quiet">其他会话 · 默认</p>
                </div>
              </div>
            </div>
            <label className="mt-3 flex cursor-pointer items-center justify-between gap-3 rounded-control px-1 py-2 text-[14px] font-medium">
              紧凑会话列表
              <input type="checkbox" role="switch" checked={compact} onChange={(event) => setCompact(event.target.checked)} className="peer sr-only" />
              <span aria-hidden="true" className="relative h-5 w-9 shrink-0 rounded-full bg-quiet/65 after:absolute after:left-0.5 after:top-0.5 after:size-4 after:rounded-full after:bg-surface peer-checked:bg-primary peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-primary" />
            </label>
          </div>
          <div>
            <h2 className="text-[16px] font-semibold">状态与操作</h2>
            <p className="mb-3 mt-1 text-[14px] text-muted">状态用浅底深字，鲜绿不单独承担文字可读性。</p>
            <dl className="space-y-2.5 rounded-card bg-panel p-4">
              <div className="flex min-h-8 items-center justify-between gap-3">
                <dt className="text-[14px] text-muted">完成状态</dt>
                <dd className="flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-[12px] font-semibold text-primary"><span className="icon-[lucide--check] size-3.5" />已完成</dd>
              </div>
              <div className="flex min-h-8 items-center justify-between gap-3">
                <dt className="text-[14px] text-muted">主操作</dt>
                <dd>
                  <Link to="/" state={{ review: true }} className="flex h-8 items-center gap-1.5 rounded-full bg-primary px-3 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90" onClick={() => setSessionId('dock')}>审查改动<span className="icon-[lucide--arrow-up-right] size-3.5" /></Link>
                </dd>
              </div>
              <div className="flex min-h-8 items-center justify-between gap-3">
                <dt className="text-[14px] text-muted">输入为空</dt>
                <dd>
                  <button type="button" disabled aria-label="发送，输入为空时不可用" className="grid size-8 place-items-center rounded-full bg-inset text-quiet">
                    <span className="icon-[lucide--arrow-up] size-4" />
                  </button>
                </dd>
              </div>
            </dl>
          </div>
        </section>
        <p className="mt-6 text-[12px] text-quiet">标题 Schibsted Grotesk · 正文 DM Sans · 中文随系统字体</p>
      </div>
    </main>
  );
}
