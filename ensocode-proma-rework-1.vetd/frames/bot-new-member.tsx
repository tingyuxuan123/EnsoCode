export const frame = { width: 1440, height: 900, title: "Bot · 新建成员（含能力与预算）" };

import { useState } from 'react';
import { Link } from 'react-router';
import { Avatar } from '../components/bot/BotShell';
import { personas, templates } from '../components/bot/data';
import { Segmented, Switch } from '../components/Controls';

const colors = ['bg-primary', 'bg-warning', 'bg-success', 'bg-danger', 'bg-muted', 'bg-surface-foreground'];

/** 新建成员（bots/NewBotDialog.tsx + PersonaSuggest + AvatarCropDialog）：从模板/空白/导入人物卡，名称、头衔、模型、头像颜色、职责、人设、能力 */
export default function BotNewMember() {
  const [source, setSource] = useState<'template' | 'blank' | 'card'>('template');
  const [tab, setTab] = useState<'base' | 'ability'>('base');
  const [name, setName] = useState('小满');
  const [color, setColor] = useState(0);
  const [budget, setBudget] = useState(true);
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-6">
        <span className="icon-[lucide--user-plus] size-4 text-muted" />
        <h1 className="text-[15px] font-medium">新建成员</h1>
        <span className="text-[12px] text-muted">成员拥有各自的人设、模型、工具和记忆；名字用于在群里 @ 他。</span>
        <Link to="/bot" className="ml-auto text-[12px] text-muted hover:text-surface-foreground">取消</Link>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-[760px]">
          <div className="mb-4 flex items-center gap-2">
            <Segmented label="创建方式" value={source} onChange={setSource} options={[{ value: 'template', label: '从模板' }, { value: 'blank', label: '空白' }, { value: 'card', label: '导入人物卡（PNG / JSON）' }]} />
            <span className="text-[11px] text-faint">{source === 'template' ? '模板预置职责与人设，可再改' : source === 'blank' ? '空白成员：从零填写' : '人物卡会带回头像与人设'}</span>
          </div>
          {source === 'template' && (
            <div className="mb-4 space-y-1.5">
              {templates.map((template, index) => (
                <button key={template.id} className={`flex w-full items-center gap-3 whitespace-nowrap rounded-control border px-3 py-2 text-left ${index === 0 ? 'border-primary/50 bg-primary-soft/30' : 'border-line hover:bg-hover'}`}>
                  <span className="icon-[lucide--layout-template] size-3.5 shrink-0 text-muted" />
                  <span className="shrink-0 whitespace-nowrap text-[12.5px] font-medium">{template.title}</span>
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{template.desc}</span>
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-faint">{template.members} 名成员</span>
                </button>
              ))}
            </div>
          )}
          <div className="mb-3 flex items-center gap-1 border-b border-line text-[12px]">
            {([['base', '资料'], ['ability', '能力']] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`-mb-px border-b-2 px-3 py-1.5 ${tab === id ? 'border-primary font-medium text-surface-foreground' : 'border-transparent text-muted'}`}>{label}</button>)}
          </div>
          {tab === 'base' ? (
            <div className="grid grid-cols-2 gap-x-5">
              <label className="mb-3 block text-[12px] text-muted">名称<span className="ml-1 text-faint">群内 @ 用，必须唯一</span>
                <input value={name} onChange={(event) => setName(event.target.value)} className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none focus:border-primary/60" />
              </label>
              <label className="mb-3 block text-[12px] text-muted">头衔
                <input defaultValue="研究员" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none focus:border-primary/60" />
              </label>
              <label className="mb-3 block text-[12px] text-muted">模型
                <select className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2 text-[13px] text-surface-foreground"><option>Gemini 2.5 Pro</option><option>Claude Sonnet 4.5</option><option>GPT-5 Codex</option></select>
              </label>
              <div className="mb-3 text-[12px] text-muted">头像颜色
                <div className="mt-1.5 flex items-center gap-1.5">
                  {colors.map((tone, index) => <button key={tone} onClick={() => setColor(index)} aria-label={`颜色 ${index + 1}`} className={`size-6 rounded-full ${tone} ${color === index ? 'ring-2 ring-primary ring-offset-2 ring-offset-surface' : ''}`} />)}
                  <span className="ml-1 text-[11px] text-faint">或上传图片后裁剪</span>
                </div>
              </div>
              <label className="col-span-2 mb-3 block text-[12px] text-muted">职责<span className="ml-1 text-faint">用于路由和委派目录</span>
                <input defaultValue="检索竞品与用户反馈，输出对比表" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none focus:border-primary/60" />
              </label>
              <div className="col-span-2 mb-3 text-[12px] text-muted">
                人设
                <textarea defaultValue={personas[1]} rows={3} className="mt-1 block w-full resize-none rounded-control border border-border bg-input p-2.5 text-[13px] leading-6 text-surface-foreground outline-none focus:border-primary/60" />
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">{personas.map((suggestion) => <button key={suggestion} className="rounded-control border border-border px-2 py-0.5 text-muted hover:bg-hover">{suggestion}</button>)}</div>
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-[92px] text-muted">工具</span><span className="flex-1">全部工具（bash / edit / write / browser）</span><span className="text-[11px] text-primary">修改</span></div>
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-[92px] text-muted">审批档位</span><span className="flex-1">自动接受编辑</span><Switch label="审批档位" checked onChange={() => undefined} /></div>
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-[92px] text-muted">技能</span><span className="flex-1">竞品检索 · 表格整理</span><span className="text-[11px] text-primary">选择</span></div>
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-[92px] text-muted">MCP</span><span className="flex-1">browser-tools（常驻）</span><span className="text-[11px] text-primary">选择</span></div>
              <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="w-[92px] text-muted">委派关系</span><span className="flex-1">可委派给 老周；接受来自 阿岚</span><span className="text-[11px] text-primary">编辑</span></div>
              <div className="rounded-control border border-line px-3 py-2">
                <div className="flex items-center gap-2"><span className="w-[92px] text-muted">日预算</span><Switch label="启用日预算" checked={budget} onChange={setBudget} /><span className="text-[11px] text-faint">开启后超限的新消息会被拒绝</span></div>
                {budget && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    <label className="text-[11px] text-muted">
                      每日成本上限
                      <input defaultValue="2.00" className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" />
                    </label>
                    <label className="text-[11px] text-muted">
                      单回合 Token 上限
                      <input defaultValue="60000" className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" />
                    </label>
                    <label className="text-[11px] text-muted">
                      委派时限（分钟）
                      <input defaultValue="30" className="mt-1 h-8 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" />
                    </label>
                  </div>
                )}
                <p className="mt-1.5 text-[11px] text-danger">请检查单回合 Token 上限（正整数）与委派时限（1–1440 的整数分钟）</p>
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="flex h-12 shrink-0 items-center gap-2 border-t border-line px-6">
        <span className="flex items-center gap-1.5 text-[11px] text-muted"><Avatar member={{ name: name || '新', color: colors[color] }} size="sm" />{name || '未命名'} · 群内 @ 用</span>
        <div className="ml-auto flex items-center gap-2">
          <button className="px-3 py-1.5 text-[12px] text-muted">取消</button>
          <Link to="/bot-chat" className="rounded-control bg-surface-foreground px-4 py-1.5 text-[12px] text-surface">创建并开始私聊</Link>
        </div>
      </div>
    </div>
  );
}
