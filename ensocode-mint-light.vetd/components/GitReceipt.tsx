import { changes, patchSamples, totals } from './data';

const filename = (path: string) => path.slice(path.lastIndexOf('/') + 1);

export function GitReceipt({ onReview, expanded }: { onReview: (index?: number) => void; expanded: boolean }) {
  return (
    <article className="git-receipt relative mt-5 rounded-card border border-rim px-6 pb-5 pt-6" aria-label="Git 变更摘要">
      <div className="flex items-center justify-between gap-4">
        <span className="flex items-center gap-2 text-[12px] font-semibold text-primary">
          <span className="icon-[lucide--git-compare-arrows] size-4" />
          Git 变更
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-mint px-2.5 py-1 text-[12px] font-semibold text-primary">
          <span className="icon-[lucide--check] size-3.5" />
          已完成
        </span>
      </div>
      <h2 className="mt-3 font-display text-[28px] font-bold leading-tight tracking-tight">画布展开，会话仍可见</h2>
      <p className="mt-2 text-[14px] leading-6 text-muted">画布请求最大宽度时，右侧面板展开到可用宽度。手动进入全屏的行为不变。</p>
      <div className="mb-2 mt-6 flex items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-1.5 text-[12px] font-medium text-muted">
          <span className="font-display text-[28px] font-semibold leading-none text-surface-foreground tabular-nums">{changes.length}</span>
          个文件
        </div>
        <div className="flex gap-3 text-[14px] font-semibold tabular-nums" aria-label={`新增 ${totals.added} 行，删除 ${totals.removed} 行`}>
          <span className="text-primary">+{totals.added}</span>
          <span className="text-danger">−{totals.removed}</span>
        </div>
      </div>
      <div className="flex h-7 gap-1.5" aria-label="按文件分布的新增和删除行数">
        {changes.map((file, index) => (
          <button key={file.path} type="button" className="flex min-w-0 items-center gap-px rounded-[3px] hover:opacity-80" style={{ flexGrow: file.added + file.removed, flexBasis: 0 }} aria-label={`${filename(file.path)}：新增 ${file.added} 行，删除 ${file.removed} 行`} title={`${filename(file.path)} +${file.added} −${file.removed}`} onClick={() => onReview(index)}>
            {Array.from({ length: file.added + file.removed }, (_, tick) => (
              <span key={tick} className={`h-[22px] min-w-0 flex-1 rounded-[2px] ${tick < file.added ? 'bg-signal' : 'bg-danger/55'}`} />
            ))}
          </button>
        ))}
      </div>
      <div className="mt-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[12px] text-muted">
          <span className="icon-[lucide--git-commit-horizontal] size-4" />
          ad3b0dd0 · 提交示例
        </span>
        <button type="button" aria-expanded={expanded} aria-controls={expanded ? 'changes-dock' : undefined} onClick={() => onReview()} className="flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground hover:bg-primary/90">
          审查改动
          <span className="icon-[lucide--arrow-up-right] size-4" />
        </button>
      </div>
    </article>
  );
}

export function ChangesDock({ fileIndex, onSelect, onClose }: { fileIndex: number; onSelect: (index: number) => void; onClose: () => void }) {
  const current = changes[fileIndex];
  const name = filename(current.path);
  const sample = patchSamples[name];

  return (
    <aside id="changes-dock" aria-label="改动审查" className="flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-line bg-panel">
      <div className="flex h-[57px] shrink-0 items-center justify-between gap-2 border-b border-line px-4">
        <h2 className="flex items-center gap-2 text-[14px] font-semibold">
          <span className="icon-[lucide--git-compare-arrows] size-4 text-primary" />
          改动审查
        </h2>
        <button type="button" aria-label="关闭改动面板" onClick={onClose} className="grid size-8 place-items-center rounded-control text-muted hover:bg-inset">
          <span className="icon-[lucide--x] size-4" />
        </button>
      </div>
      <div className="px-3 py-4">
        <div className="px-2 pb-2 text-[12px] font-medium text-quiet">{changes.length} 个文件</div>
        <ul className="space-y-1">
          {changes.map((file, index) => (
            <li key={file.path}>
              <button type="button" title={file.path} aria-current={fileIndex === index ? 'true' : undefined} onClick={() => onSelect(index)} className={`flex w-full items-center gap-2 rounded-control px-2 py-2.5 text-left text-[12px] ${fileIndex === index ? 'bg-mint text-primary' : 'hover:bg-inset'}`}>
                <span className="icon-[lucide--file-code-2] size-4 shrink-0" />
                <span className="min-w-0 flex-1 truncate font-semibold">{filename(file.path)}</span>
                <span className="shrink-0 text-primary tabular-nums">+{file.added}</span>
                {file.removed > 0 && <span className="shrink-0 text-danger tabular-nums">−{file.removed}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="border-t border-line px-4 py-4">
        <h3 className="break-all text-[14px] font-semibold">{name}</h3>
        <p className="mb-3 mt-1.5 text-[12px] leading-5 text-muted">{sample.note}</p>
        <pre className="overflow-hidden rounded-control bg-surface py-2 text-[12px] leading-5" aria-label={`${name} 的代码改动节选`}>
          {sample.lines.map((line, index) => (
            <code key={index} className={`flex gap-2 px-2 py-1 ${line.kind === 'add' ? 'bg-mint text-primary' : line.kind === 'remove' ? 'bg-danger-soft text-danger' : 'text-muted'}`}>
              <span className="w-3 shrink-0">{line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '}</span>
              <span className="min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere]">{line.text}</span>
            </code>
          ))}
        </pre>
        <div className="mt-2 text-[12px] text-quiet">提交节选 · ad3b0dd0</div>
      </div>
    </aside>
  );
}
