import { useState } from 'react';
import { Link } from 'react-router';
import { Dialog, Segmented, Switch } from '../../Controls';
import { Badge, FilterBar, InlineNotice, ListRow, SettingsHeader, SettingsList, SettingsRow, SettingsSection, outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { ModelSelect, SwitchLine } from '../core/shared';

/** 实验功能（ExperimentalSettings）：当前只有 Bot 模式；开关写进 useWorkbench，导航里 Bot 两页随之显隐 */
export function ExperimentalPage() {
  const [bot, setBot] = useState(true);
  return (
    <>
      <SettingsHeader title="实验功能" description="仍在测试中的功能，之后可能调整或移除。" />
      <SettingsList>
        <ListRow
          icon={<span className="icon-[lucide--bot-message-square] size-4 text-primary" />}
          title={<><span className="font-medium">Bot 模式</span>{bot && <Badge tone="primary">已开启</Badge>}</>}
          meta="在侧栏顶部加入 Code | Bot 切换。创建拥有各自人设、模型和工具的成员，与他们私聊或拉群协作。"
        >
          <Switch label="Bot 模式" checked={bot} onChange={setBot} />
        </ListRow>
      </SettingsList>
      <div className="mt-3 flex items-center gap-2 text-[12px]">
        <Link to="/settings-bots" className="flex h-8 items-center gap-1.5 rounded-control border border-border px-3 hover:bg-hover"><span className="icon-[lucide--settings-2] size-3.5" />Bot 模式设置</Link>
        <Link to="/bot" className="text-[11px] text-primary">去 Bot 模式看看</Link>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted">关闭开关后，侧栏的 Code | Bot 分段消失，设置里的「Bot 模式」「Bot 模板」两页也隐藏；重新打开即可恢复，不会丢失成员与群聊。</p>
    </>
  );
}

/** Bot 模式设置（BotSettings）：所有成员与群聊共用 */
export function BotSettingsPage() {
  const [concurrency, setConcurrency] = useState('3');
  const [fallback, setFallback] = useState(true);
  return (
    <>
      <SettingsHeader title="Bot 模式" description="所有成员和群聊共用的设置。" />
      <SettingsSection title="并发" description="私聊、群聊、委派和例行任务共用一个上限。调低不会打断进行中的回复；调高可能触发模型限流。">
        <SettingsRow label="Bot 并发上限">
          <select value={concurrency} onChange={(event) => setConcurrency(event.target.value)} className={selectClass}><option>1</option><option>2</option><option>3</option><option>5</option></select>
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="辅助模型">
        <SettingsRow label="Bot 助理模型" description="用于自动设置成员能力等辅助任务。">
          <ModelSelect label="Bot 助理模型" value="Claude Haiku 4.5" onChange={() => undefined} />
        </SettingsRow>
        {fallback && <InlineNotice tone="warning" action={<button onClick={() => setFallback(false)} className="shrink-0 text-[11px] text-primary">改跟默认模型</button>}>所选模型已不可用——将回退到默认模型。</InlineNotice>}
        <SettingsRow label="群聊选人模型" description="在「智能选人」的群里没人被 @ 时，用这个模型选出回复的成员。">
          <ModelSelect label="群聊选人模型" value="默认（跟随标题总结模型）" onChange={() => undefined} />
        </SettingsRow>
        <SettingsRow label="快速聊天模型" description="超时、出错或回答不明确时由群主回复。">
          <ModelSelect label="快速聊天模型" value="Gemini 2.5 Flash" onChange={() => undefined} />
        </SettingsRow>
        <p className="text-[11px] text-muted">超时就交给群主处理。</p>
      </SettingsSection>
      <p className="text-[11px] leading-5 text-muted">成员的日预算、单回合 Token 上限与委派时限在「成员资料 → 能力」里单独设置。</p>
    </>
  );
}

type Template = { id: string; kind: 'member' | 'team'; title: string; summary: string; state: '内置' | '自定义' | '已修改' | '已隐藏'; members?: number };
const memberTemplates: Template[] = [
  { id: 't1', kind: 'member', title: '研究员', summary: '检索、对比、输出结构化结论', state: '内置' },
  { id: 't2', kind: 'member', title: '写手', summary: '把结论写成可发的文稿', state: '已修改' },
  { id: 't3', kind: 'member', title: '数据', summary: '抓取与维护指标', state: '自定义' },
  { id: 't4', kind: 'member', title: '旧版客服', summary: '已不再使用', state: '已隐藏' },
];
const teamTemplates: Template[] = [
  { id: 'g1', kind: 'team', title: '三人内容小队', summary: '主理人 + 研究员 + 写手，适合作品牌周报与选题', state: '内置', members: 3 },
  { id: 'g2', kind: 'team', title: '发布前自检组', summary: '数据 + 校验，每次发版前的检查清单', state: '内置', members: 2 },
  { id: 'g3', kind: 'team', title: '投放素材组', summary: '研究员 + 设计 + 写手，独立工作区', state: '自定义', members: 3 },
];

/** Bot 模板（BotTemplatesSettings）：成员模板 / 团队模板，内置可改可隐藏可恢复默认，支持导入导出 JSON */
export function BotTemplatesPage({ open }: { open?: 'member' | 'team' }) {
  const [tab, setTab] = useState<'member' | 'team'>('member');
  const [editor, setEditor] = useState<'' | 'member' | 'team'>(open ?? '');
  const [hidden, setHidden] = useState<string[]>(['t4']);
  const list = (tab === 'member' ? memberTemplates : teamTemplates).map((item) => ({ ...item, state: hidden.includes(item.id) ? '已隐藏' as const : item.state }));
  const openEditor = (kind: 'member' | 'team') => setEditor(kind);
  return (
    <>
      <SettingsHeader title="Bot 模板" description="新建成员和团队时使用的模板。内置模板可以修改、隐藏或恢复默认。" actions={<><button className={outlineButton}>导入团队（JSON）</button><button className={primaryButton} onClick={() => openEditor(tab)}>{tab === 'member' ? '新建成员模板' : '新建团队模板'}</button></>} />
      <Segmented label="模板类型" value={tab} onChange={(value) => setTab(value)} options={[{ value: 'member', label: '成员模板' }, { value: 'team', label: '团队模板' }]} />
      <div className="mt-3">
        <SettingsList>
          {list.map((item) => (
            <ListRow
              key={item.id}
              icon={<span className={`${item.kind === 'team' ? 'icon-[lucide--layout-template]' : 'icon-[lucide--user]'} size-4 text-muted`} />}
              title={<><span className="font-medium">{item.title}</span><Badge tone={item.state === '自定义' ? 'primary' : item.state === '已修改' ? 'warning' : 'neutral'}>{item.state}</Badge>{item.members && <span className="text-[11px] text-faint">{item.members} 名成员</span>}</>}
              meta={item.summary}
              onClick={() => openEditor(item.kind)}
            >
              {item.state === '已隐藏' ? (
                <button onClick={() => setHidden(hidden.filter((id) => id !== item.id))} className="text-[11px] text-primary">恢复默认</button>
              ) : (
                <>
                  <button onClick={() => setHidden([...hidden, item.id])} className="text-[11px] text-muted hover:text-surface-foreground">隐藏</button>
                  <button onClick={() => setHidden([...hidden, item.id])} className="text-[11px] text-muted hover:text-danger">删除</button>
                </>
              )}
              <button className="text-[11px] text-muted hover:text-surface-foreground">导出 JSON</button>
            </ListRow>
          ))}
        </SettingsList>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-muted">内置模板被修改后显示「已修改」；「恢复默认」会丢弃改动。团队需要 2–12 名成员。</p>
      {editor && <TemplateEditor kind={editor} onClose={() => setEditor('')} />}
    </>
  );
}

function TemplateEditor({ kind, onClose }: { kind: 'member' | 'team'; onClose: () => void }) {
  const [shared, setShared] = useState(true);
  return (
    <Dialog
      title={kind === 'member' ? '成员模板' : '团队模板'}
      description={kind === 'member' ? '用于新建成员：工具、审批档位、职责与人设。' : '用于从模板创建团队：群名、群主、工作区与成员。'}
      width={640}
      onClose={onClose}
      footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={onClose} className={primaryButton}>保存</button></>}
    >
      {kind === 'member' ? (
        <div className="grid grid-cols-2 gap-x-4">
          <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">名称</span><input defaultValue="研究员" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
          <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">头衔</span><input defaultValue="研究员" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
          <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">工具</span><select className={`${selectClass} h-9 w-full`}><option>全部工具</option><option>只读</option></select></label>
          <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">审批档位</span><select className={`${selectClass} h-9 w-full`}><option>自动接受编辑</option><option>全程审批</option><option>完全放行</option></select></label>
          <label className="col-span-2 mb-3 block text-[12px]"><span className="mb-1 block font-medium">摘要（显示在模板卡片上）</span><input defaultValue="检索、对比、输出结构化结论" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
          <label className="col-span-2 mb-3 block text-[12px]"><span className="mb-1 block font-medium">职责</span><input defaultValue="检索竞品与用户反馈，输出对比表" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
          <label className="col-span-2 block text-[12px]"><span className="mb-1 block font-medium">人设</span><textarea rows={3} defaultValue="遇到不确定的口径先问清楚；结论先行，依据在后。" className="block w-full resize-none rounded-control border border-border bg-input p-2.5 text-[13px] leading-6 outline-none" /></label>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-x-4">
            <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">群名</span><input defaultValue="三人内容小队" className="h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
            <label className="mb-3 block text-[12px]"><span className="mb-1 block font-medium">群主</span><select className={`${selectClass} h-9 w-full`}><option>阿岚</option><option>小满</option></select></label>
          </div>
          <SettingsRow label="共享工作区" description={shared ? '基于 Code 项目：成员直接在项目目录里读写' : '独立工作区：为这个群新建一个空目录，删除群时一并清理'}>
            <Segmented label="工作区" value={shared ? 'shared' : 'own'} onChange={(value) => setShared(value === 'shared')} options={[{ value: 'shared', label: '共享' }, { value: 'own', label: '独立' }]} />
          </SettingsRow>
          <div className="mt-2">
            <p className="mb-1.5 text-[12px] font-medium">成员<span className="ml-2 text-[11px] text-muted">2–12 名</span></p>
            <div className="divide-y divide-line rounded-control border border-line text-[12px]">
              {['阿岚 · 主理人', '小满 · 研究员', '阿米 · 写手'].map((row, index) => (
                <div key={row} className="flex items-center gap-2 px-2.5 py-1.5">
                  <span className="min-w-0 flex-1 truncate">{row}</span>
                  <span className="text-[11px] text-muted">{index === 0 ? '可委派给 小满、阿米' : '接受来自 阿岚'}</span>
                  <button className="text-[11px] text-muted hover:text-danger">移除</button>
                </div>
              ))}
            </div>
            <button className="mt-1.5 text-[11px] text-primary">添加成员</button>
          </div>
          <p className="mt-2 text-[11px] text-danger">请填写团队标题 · 每个成员都需要合法的名字</p>
        </>
      )}
    </Dialog>
  );
}
