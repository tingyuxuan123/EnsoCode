export const frame = { width: 1440, height: 900, title: "全功能重构 · 覆盖清单" };

import { useState } from 'react';
import { Link } from 'react-router';
import { featureCount, featureGroups, partialCount } from '../components/coverage';

export default function CoverageScreen() {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('all');
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState('');
  const groups = featureGroups.filter((group) => groupId === 'all' || group.id === groupId).map((group) => ({
    ...group,
    features: group.features.filter((feature) => (!query || `${feature.name} ${feature.surfaces}`.toLowerCase().includes(query.toLowerCase())) && (filter === 'all' || feature.status === filter)),
  })).filter((group) => group.features.length);
  const active = featureGroups.flatMap((group) => group.features).find((feature) => feature.id === selected);
  const visibleCount = groups.reduce((sum, group) => sum + group.features.length, 0);
  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b border-line px-7 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <h1 className="text-[22px] font-semibold">全功能 UI 重构</h1>
          <span className="ml-auto text-[12px] text-muted">源码盘点 · 不是完成声明</span>
        </div>
        <p className="mt-2 text-[13px] leading-6 text-muted">以当前 EnsoCode 的真实功能为边界，逐项覆盖页面、弹窗、工具面板和关键状态。</p>
        <div className="mt-4 flex items-center gap-7 text-[12px]">
          <span><strong className="mr-1.5 text-[20px] font-medium tabular-nums">{featureGroups.length}</strong>功能域</span>
          <span><strong className="mr-1.5 text-[20px] font-medium tabular-nums">{featureCount}</strong>验收单元</span>
          <span className="text-muted">{partialCount} 项已有首批设计，仍需补齐状态</span>
          <span className="text-muted">完整验收 0 项</span>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="w-[214px] shrink-0 border-r border-line px-3 py-4">
          <button onClick={() => setGroupId('all')} className={`mb-2 flex h-9 w-full items-center justify-between rounded-control px-2 text-[12px] ${groupId === 'all' ? 'bg-selected font-medium' : 'text-muted hover:bg-hover'}`}><span>全部功能</span><span className="tabular-nums text-faint">{featureCount}</span></button>
          {featureGroups.map((group) => (
            <button key={group.id} onClick={() => setGroupId(group.id)} className={`mb-1 flex min-h-10 w-full items-center justify-between gap-2 rounded-control px-2 py-2 text-left text-[12px] ${groupId === group.id ? 'bg-selected font-medium' : 'text-muted hover:bg-hover'}`}>
              <span className="whitespace-nowrap">{group.name}</span>
              <span className="tabular-nums text-faint">{group.features.length}</span>
            </button>
          ))}
          <p className="mt-5 border-t border-line px-2 pt-4 text-[11px] leading-6 text-muted">不能用占位提示代替页面；不能把一个主页面当作整个功能已完成。</p>
        </aside>
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-[59px] shrink-0 items-center gap-3 border-b border-line px-5">
            <label className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-control bg-panel px-3 text-muted"><span className="icon-[lucide--search] size-3.5" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索功能或交互状态…" aria-label="搜索功能覆盖清单" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" /></label>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="设计进度筛选" className="h-8 rounded-control border border-border bg-surface px-2 text-[12px] text-muted"><option value="all">全部进度</option><option value="partial">首批已覆盖部分</option><option value="pending">待设计</option></select>
            <span className="whitespace-nowrap text-[11px] text-faint">{visibleCount} 项</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
            {groups.map((group) => (
              <section key={group.id} className="pt-5">
                <h2 className="text-[14px] font-medium">{group.name}</h2>
                <p className="mb-3 mt-1 text-[11px] leading-5 text-muted">{group.description}</p>
                {group.features.map((feature) => (
                  <article key={feature.id} className={`border-t border-line px-1 py-3 ${active?.id === feature.id ? 'bg-panel/60' : ''}`}>
                    <div className="flex items-center gap-3">
                      <button onClick={() => setSelected(selected === feature.id ? '' : feature.id)} className="min-w-0 flex-1 text-left text-[13px] hover:text-primary">{feature.name}</button>
                      <span className={`whitespace-nowrap text-[11px] ${feature.status === 'partial' ? 'text-primary' : 'text-faint'}`}>{feature.status === 'partial' ? '部分已设计' : '待设计'}</span>
                      {feature.route ? <Link to={feature.route} className="flex items-center gap-1 whitespace-nowrap text-[11px] text-primary">看首稿<span className="icon-[lucide--arrow-up-right] size-3" /></Link> : <button onClick={() => setSelected(feature.id)} className="whitespace-nowrap text-[11px] text-muted hover:text-primary">范围</button>}
                    </div>
                    <p className="mt-1.5 text-[12px] leading-5 text-muted">{feature.surfaces}</p>
                    {active?.id === feature.id && <div className="mt-3 rounded-control bg-panel px-3 py-2 text-[11px] leading-5 text-muted"><p>验收要求：完整主要路径、编辑/确认、空/加载/错误与权限状态；预览可点击；视觉检查通过。</p><p className="mt-2 break-all font-mono">{feature.source}</p></div>}
                  </article>
                ))}
              </section>
            ))}
            {!groups.length && <div className="py-14 text-center text-[13px] text-muted">没有匹配项，试试其他功能名称。</div>}
          </div>
        </section>
      </div>
    </div>
  );
}
