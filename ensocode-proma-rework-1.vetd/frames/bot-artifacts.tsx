export const frame = { width: 1440, height: 900, title: "Bot · 交付物与成员浏览器" };

import { Avatar } from '../components/bot/BotShell';
import { artifacts, members } from '../components/bot/data';

/** 交付物（bots/ArtifactCards.tsx）+ 成员浏览器（BotBrowserPanel）：预览、工作区文件、浏览器标签/接管、成员用量 */
export default function BotArtifacts() {
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
          <span className="icon-[lucide--package] size-4 text-muted" />
          <h1 className="text-[15px] font-medium">交付物</h1>
          <span className="text-[12px] text-muted">竞品周报 · 共享工作区 ~/githubproject/reports</span>
          <span className="ml-auto text-[11px] text-faint">{artifacts.length} 个文件</span>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          <div className="grid grid-cols-3 gap-3">
            {artifacts.map((artifact) => (
              <article key={artifact.id} className="rounded-control border border-line">
                <div className="flex h-24 items-center justify-center rounded-t-control bg-panel/60 text-faint">
                  <span className={`${artifact.kind === 'markdown' ? 'icon-[lucide--file-text]' : artifact.kind === 'table' ? 'icon-[lucide--table]' : 'icon-[lucide--presentation]'} size-7`} />
                </div>
                <div className="px-2.5 py-2">
                  <p className="truncate font-mono text-[11.5px]">{artifact.name}</p>
                  <p className="mt-0.5 text-[11px] text-faint">{artifact.from} · {artifact.size} · {artifact.time}</p>
                  <div className="mt-1.5 flex gap-2 text-[11px]"><button className="text-primary">预览</button><button className="text-muted hover:text-surface-foreground">在工作区打开</button><button className="text-muted hover:text-surface-foreground">下载</button></div>
                </div>
              </article>
            ))}
          </div>
          <div className="mt-4 rounded-control border border-line p-3">
            <p className="text-[12.5px] font-medium">成员用量</p>
            <div className="mt-2 space-y-1.5">
              {members.map((member) => (
                <div key={member.id} className="flex items-center gap-2 text-[12px]">
                  <Avatar member={member} size="sm" />
                  <span className="w-16 shrink-0">{member.name}</span>
                  <span className="h-1.5 flex-1 rounded-full bg-control"><span className={`block h-full rounded-full ${member.color}`} style={{ width: `${30 + Number(member.id.slice(1)) * 12}%` }} /></span>
                  <span className="w-28 shrink-0 text-right text-[11px] text-muted">{member.budget ?? '未设预算'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <aside className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2 text-[12px]">
          <span className="icon-[lucide--globe] size-3.5 text-muted" />
          <span className="font-medium">成员浏览器</span>
          <span className="rounded-[4px] bg-warning-soft px-1.5 text-[10px] text-warning">小满占用中</span>
          <button className="ml-auto text-[11px] text-primary">我来接管</button>
        </div>
        <div className="flex h-8 shrink-0 items-center gap-1 border-b border-line px-2 text-[11px] text-muted">
          <span className="rounded-[4px] bg-selected px-1.5 py-0.5 font-mono">competitors.example.com</span>
          <span className="rounded-[4px] px-1.5 py-0.5 hover:bg-hover">pricing</span>
          <button className="ml-auto flex size-5 items-center justify-center hover:bg-hover"><span className="icon-[lucide--plus] size-3" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-panel/40 p-3">
          <div className="rounded-control border border-line bg-surface p-3 text-[12px] leading-6">
            <p className="font-medium">功能对比</p>
            <table className="mt-1.5 w-full text-[11.5px]">
              <thead className="text-faint"><tr><th className="text-left font-normal">能力</th><th className="text-left font-normal">A</th><th className="text-left font-normal">B</th><th className="text-left font-normal">我们</th></tr></thead>
              <tbody>
                {[['多成员协作', '✓', '✓', '✓'], ['成员预算', '—', '✓', '✓'], ['群组看板', '—', '✓', '✓'], ['委派记录', '✓', '—', '✓']].map((row) => (
                  <tr key={row[0]} className="border-t border-line/60">{row.map((cell, index) => <td key={index} className={index === 0 ? 'py-1 text-muted' : 'py-1'}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-faint">接管后成员暂停操作；关闭标签不会丢历史，可在浏览历史里找回。</p>
        </div>
      </aside>
    </div>
  );
}
