import { useState } from 'react';
import { DangerConfirm, Dialog, Spinner, Switch } from '../../Controls';
import { Overlay, useWorkbench } from '../../Workbench';
import { Badge, InlineNotice, outlineButton, primaryButton, SettingsHeader, SettingsRow, SettingsSection } from '../SettingsUI';
import { LocalImportProviders, OauthPanel, ProviderEditDialog, ProviderWizard } from './ProviderDialogs';
import { ModelSelect, NewSessionBadge, Select, SwitchLine } from './shared';

type Provider = { id: string; vendor: string; name: string; sub?: boolean; plan?: string; api?: string; url?: string; models: number; accounts?: number; enabled: boolean; usage?: string; classifier?: boolean; imported?: string; pool?: boolean };
const SEED: Provider[] = [
  { id: 'p1', vendor: 'Anthropic', name: 'dev@example.com', sub: true, plan: 'MAX', models: 3, enabled: true, usage: '5 小时窗口 42% · 3 小时后重置' },
  { id: 'p2', vendor: 'OpenAI', name: 'ChatGPT 自动接替池', sub: true, pool: true, models: 2, accounts: 3, enabled: true },
  { id: 'p3', vendor: 'OpenAI', name: 'work@example.com', sub: true, plan: 'PLUS', models: 2, enabled: true, usage: '5 小时窗口 12%' },
  { id: 'p4', vendor: 'Google', name: 'Gemini API', api: 'Gemini', url: 'https://generativelanguage.googleapis.com', models: 2, enabled: true },
  { id: 'p5', vendor: 'TypeSafe', name: 'TypeSafe', api: 'TypeSafe System One', url: 'https://api.typesafe.ai', models: 1, enabled: true, classifier: true },
  { id: 'p6', vendor: '自定义', name: 'DeepSeek', api: 'OpenAI Completions', url: 'https://api.deepseek.com/v1', models: 2, enabled: false, imported: 'Cherry Studio' },
];

/** 虚拟模型（VirtualModelsSettings）：主/快/备用/按难度分档/分类器/超时 */
export function VirtualModelEditor({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('日常编码（自动分档）');
  const [primary, setPrimary] = useState('Claude Sonnet 4.5');
  const [fast, setFast] = useState('Claude Haiku 4.5');
  const [fallbacks, setFallbacks] = useState(['GPT-5 Codex', 'Gemini 2.5 Pro']);
  const [tiering, setTiering] = useState('fast');
  const [classifier, setClassifier] = useState('Gemini 2.5 Flash');
  const [timeout, setTimeoutValue] = useState('3');
  const [enabled, setEnabled] = useState(true);
  return (
    <Overlay>
      <Dialog width={600} title="编辑虚拟模型" description="虚拟模型在选择器里显示为一个模型，每次请求由路由挑选真实模型：限流或故障时切到备用，需要时换成支持图片或上下文更大的成员，摘要使用快模型。" onClose={onClose} footer={<><span className="mr-auto"><NewSessionBadge text="对新启动的会话生效" /></span><button onClick={onClose} className="px-3 py-2 text-[12px] text-danger">删除</button><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={onClose} className={primaryButton}>保存</button></>}>
        <div className="mb-3 flex items-center gap-3">
          <input value={name} onChange={(event) => setName(event.target.value)} aria-label="名称" className="h-8 min-w-0 flex-1 rounded-control border border-border bg-input px-2 text-[13px] outline-none" />
          <span className="flex items-center gap-2 text-[12px]">启用虚拟模型<Switch label="启用虚拟模型" checked={enabled} onChange={setEnabled} /></span>
        </div>
        <SettingsRow label="主模型" description="每轮默认使用"><ModelSelect label="主模型" value={primary} onChange={setPrimary} allowVirtual={false} /></SettingsRow>
        <SettingsRow label="快模型" description="摘要与简单问题"><ModelSelect label="快模型" value={fast} onChange={setFast} allowVirtual={false} emptyLabel="不使用" />{fast && <button onClick={() => setFast('')} className="text-[12px] text-muted">清除</button>}</SettingsRow>
        <div className="py-2.5">
          <p className="text-[13px]">备用模型</p>
          <p className="text-[12px] text-muted">限流或故障时按顺序切换</p>
          <div className="mt-2 space-y-1.5">
            {fallbacks.map((model, index) => (
              <div key={model} className="flex items-center gap-2">
                <span className="w-5 text-center text-[11px] tabular-nums text-faint">{index + 1}</span>
                <ModelSelect label="备用模型" value={model} onChange={(value) => setFallbacks(fallbacks.map((item, i) => i === index ? value : item))} allowVirtual={false} />
                <button aria-label="移除" onClick={() => setFallbacks(fallbacks.filter((_, i) => i !== index))} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-3.5" /></button>
              </div>
            ))}
            <button onClick={() => setFallbacks([...fallbacks, 'Claude Opus 4.1'])} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />添加备用</button>
          </div>
        </div>
        <SettingsRow label="按难度分档" description="每轮新输入先分类：简单问题用快模型，复杂任务用主模型。回复前会多一点延迟。">
          <Select label="按难度分档" value={tiering} onChange={setTiering} width="w-36" disabled={!fast} options={[['off', '关'], ['fast', '快模型判断'], ['classifier', '分类器模型']]} />
        </SettingsRow>
        {!fast && <p className="-mt-1 text-[11px] text-warning">先设置快模型</p>}
        {tiering === 'classifier' && (
          <SettingsRow label="分类器模型"><ModelSelect label="分类器模型" value={classifier} onChange={setClassifier} allowVirtual={false} /></SettingsRow>
        )}
        {tiering !== 'off' && (
          <SettingsRow label="超时" description="超时就用主模型。">
            <span className="flex items-center gap-2 text-[12px] text-muted"><input value={timeout} onChange={(event) => setTimeoutValue(event.target.value)} aria-label="超时秒数" className="h-8 w-16 rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" />秒</span>
          </SettingsRow>
        )}
      </Dialog>
    </Overlay>
  );
}

function VirtualModels({ onEdit }: { onEdit: () => void }) {
  const [list, setList] = useState([
    { name: '日常编码（自动分档）', desc: 'Claude Sonnet 4.5 · 快模型 Haiku 4.5 · 2 个备用', on: true },
    { name: '长上下文回退', desc: 'Gemini 2.5 Pro · 1 个备用', on: false },
  ]);
  return (
    <SettingsSection title="虚拟模型" description="在选择器里显示为一个模型，每次请求由路由挑选真实模型。" actions={<button onClick={onEdit} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />新建虚拟模型</button>}>
      <div className="divide-y divide-line rounded-control border border-line">
        {list.map((item, index) => (
          <div key={item.name} className="group flex h-11 cursor-pointer items-center gap-3 px-3 hover:bg-hover" onClick={onEdit}>
            <span className="icon-[lucide--shuffle] size-4 text-muted" />
            <div className="min-w-0 flex-1">
              <p className={`text-[13px] ${item.on ? '' : 'text-muted'}`}>{item.name}{!item.on && <span className="ml-2 text-[11px]">已停用</span>}</p>
              <p className="truncate text-[11px] text-muted">{item.desc}</p>
            </div>
            <span onClick={(event) => event.stopPropagation()}><Switch label={item.name} checked={item.on} onChange={(on) => setList(list.map((row, i) => i === index ? { ...row, on } : row))} /></span>
          </div>
        ))}
      </div>
    </SettingsSection>
  );
}

function SubagentModels() {
  const { setNotice } = useWorkbench();
  const [enabled, setEnabled] = useState(true);
  const [rows, setRows] = useState([
    { model: 'Gemini 2.5 Flash', desc: '便宜快、长上下文，适合调研、读代码与总结', on: true },
    { model: 'Claude Opus 4.1', desc: '推理最强，适合审查、架构与疑难排查；较贵', on: true },
    { model: 'GPT-5 Codex', desc: '稳定的实现模型，适合按计划写代码', on: false },
  ]);
  return (
    <SettingsSection title="允许子代理指定模型" description="主 agent 派发 subagent/coworker 时可从这些模型里挑选；描述用于告诉它每个模型适合什么任务。" actions={<button onClick={() => setNotice('AI 自动配置：打开询问 Enso，按已登录的服务商挑选 2–4 个模型并写好描述（设计预览）。')} className={outlineButton}><span className="icon-[lucide--sparkles] size-3.5 text-primary" />AI 自动配置</button>}>
      <SwitchLine label="启用子代理模型" badge={<NewSessionBadge text="对新启动的会话生效" />} checked={enabled} onChange={setEnabled} />
      <div className={`space-y-1.5 ${enabled ? '' : 'pointer-events-none opacity-45'}`}>
        {rows.map((row, index) => (
          <div key={row.model} className="flex items-center gap-2">
            <Switch label="允许子代理选择此模型" checked={row.on} onChange={(on) => setRows(rows.map((item, i) => i === index ? { ...item, on } : item))} />
            <ModelSelect label="模型" value={row.model} onChange={(model) => setRows(rows.map((item, i) => i === index ? { ...item, model } : item))} width="w-48" allowVirtual={false} />
            <input value={row.desc} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, desc: event.target.value } : item))} placeholder="什么时候用它，例如：便宜快，适合简单子任务" aria-label="模型描述" className={`h-8 min-w-0 flex-1 rounded-control border border-border bg-input px-2 text-[12px] outline-none ${row.on ? '' : 'text-muted'}`} />
            <button aria-label="移除" onClick={() => setRows(rows.filter((_, i) => i !== index))} className="flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover"><span className="icon-[lucide--x] size-3.5" /></button>
          </div>
        ))}
        <button onClick={() => setRows([...rows, { model: 'Claude Haiku 4.5', desc: '', on: true }])} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />添加模型</button>
      </div>
    </SettingsSection>
  );
}

/** 模型中心（ProvidersSettings）：服务商 → 默认/虚拟/标题/代审/子代理模型 → 接替池 → 服务商列表 */
export function ProvidersPage({ open }: { open?: 'wizard' | 'edit' | 'oauth' | 'virtual' | 'pool' | 'import' }) {
  const [providers, setProviders] = useState(SEED);
  const [dialog, setDialog] = useState(open ?? '');
  const [defaultModel, setDefaultModel] = useState('Claude Sonnet 4.5');
  const [followLast, setFollowLast] = useState('fixed');
  const [title, setTitle] = useState('');
  const [reviewer, setReviewer] = useState('deepseek-reasoner');
  const [remove, setRemove] = useState<Provider | null>(null);
  const [removing, setRemoving] = useState('');
  const [removeError, setRemoveError] = useState('');
  const [empty, setEmpty] = useState(false);
  const [oauthLoading] = useState(true);
  const groups = [...new Set(providers.map((provider) => provider.vendor))];
  const performRemove = (provider: Provider, skipLogout = false) => {
    setRemove(null);
    setRemoving(provider.id);
    window.setTimeout(() => {
      setRemoving('');
      if (provider.sub && !skipLogout && !removeError) { setRemoveError(provider.id); return; }
      setRemoveError('');
      setProviders(providers.filter((item) => item.id !== provider.id));
    }, 900);
  };
  const list = empty ? [] : providers;
  return (
    <div data-settings-row="providers.root">
      <SettingsHeader title="模型中心" description="管理应用的模型 API 服务" actions={
        <>
          <button onClick={() => setDialog('import')} className={outlineButton}><span className="icon-[lucide--hard-drive-download] size-3.5" />从本地应用导入</button>
          <button onClick={() => setDialog('wizard')} className={primaryButton}><span className="icon-[lucide--plus] size-3.5" />添加模型 / 提供商</button>
        </>
      } />
      <InlineNotice>新启用的模型可以立即选用；修改 API Key 或地址后，已打开的会话需切换一次模型或新建会话才会使用。</InlineNotice>
      <SettingsSection title="默认模型" description="会话里手动选的模型优先于项目、分组和全局默认。">
        <SettingsRow label="默认模型">
          <Select label="默认模型方式" value={followLast} onChange={setFollowLast} width="w-36" options={[['fixed', '指定模型'], ['last', '跟随最后一次选择']]} />
          {followLast === 'fixed' && <ModelSelect label="默认模型" value={defaultModel} onChange={setDefaultModel} emptyLabel="未设置默认模型" />}
        </SettingsRow>
        {oauthLoading && <p className="-mt-1 flex items-center gap-1.5 text-[11px] text-muted"><Spinner className="size-3" />正在加载订阅凭证，API Key 模型仍可使用。</p>}
        <SettingsRow label="会话标题总结" description="新会话发出首条消息后，用 AI 自动生成简短标题。">
          <ModelSelect label="会话标题总结" value={title} onChange={setTitle} emptyLabel="跟随默认模型" allowVirtual={false} />
        </SettingsRow>
        <SettingsRow label="助手代审模型" description={reviewer === 'deepseek-reasoner' ? <span className="text-danger">所选模型不可用 · DeepSeek 已停用</span> : '选好后新会话默认走助手代审；未选则该档不可用，不会回退到当前会话模型。'}>
          <ModelSelect label="助手代审模型" value={reviewer} onChange={setReviewer} emptyLabel="尚未选择助手代审模型" allowVirtual={false} unavailable={reviewer === 'deepseek-reasoner'} />
          {reviewer && <button onClick={() => setReviewer('')} className="text-[12px] text-muted">清除</button>}
        </SettingsRow>
      </SettingsSection>
      <VirtualModels onEdit={() => setDialog('virtual')} />
      <SubagentModels />
      <SettingsSection title="模型服务" actions={<button onClick={() => setEmpty(!empty)} className="text-[11px] text-faint">（预览：{empty ? '有数据' : '空状态'}）</button>}>
        <div className="mb-3 rounded-control border border-line px-3 py-2.5">
          <button onClick={() => setDialog('pool')} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />创建 ChatGPT 自动接替池</button>
          <p className="mt-1.5 text-[11px] text-muted">自动接替池不显示单个账号额度，固定账号条目保持不变。</p>
        </div>
        {!list.length ? (
          <div className="rounded-control border border-dashed border-border px-3 py-8 text-center">
            <span className="icon-[lucide--server] size-5 text-muted" />
            <p className="mt-3 text-[13px] font-medium">暂无模型服务</p>
            <p className="mt-1 text-[12px] text-muted">从本地应用导入模型服务，或使用统一向导开始配置</p>
          </div>
        ) : groups.map((group) => (
          <div key={group} className="py-2">
            <div className="flex items-baseline gap-1.5 px-1 text-[11px] text-muted"><span className="font-semibold">{group}</span><span className="text-faint">{list.filter((item) => item.vendor === group).length}</span></div>
            <div className="mt-1.5 space-y-0.5 border-l border-line pl-3">
              {list.filter((item) => item.vendor === group).map((provider) => (
                <div key={provider.id}>
                  <div className="group flex items-start gap-3 rounded-control px-3 py-2 hover:bg-hover">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`${provider.sub ? 'icon-[lucide--badge-check]' : 'icon-[lucide--key-round]'} size-3.5 shrink-0 text-muted`} />
                        <span className={`truncate text-[13px] font-medium ${provider.enabled ? '' : 'text-muted line-through'}`}>{provider.name}</span>
                        {provider.plan && <Badge>{provider.plan}</Badge>}
                        {provider.api && <Badge>{provider.api}</Badge>}
                        {provider.imported && <Badge tone="primary">{provider.imported}</Badge>}
                        <span className="min-w-0 truncate text-[12px] text-muted">{[provider.url, provider.accounts && `${provider.accounts} 个账号`, `${provider.models} 个模型`].filter(Boolean).join(' · ')}</span>
                      </div>
                      {provider.classifier && <p className="mt-1 text-[12px] text-muted">仅用于分类，不能聊天</p>}
                      {provider.usage && (
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                          <span className="inline-block h-1 w-20 overflow-hidden rounded-full bg-control"><span className="block h-full bg-primary/70" style={{ width: provider.usage.includes('42') ? '42%' : '12%' }} /></span>
                          {provider.usage}
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1 pt-0.5">
                      <Switch label={provider.name} checked={provider.enabled} onChange={(enabled) => setProviders(providers.map((item) => item.id === provider.id ? { ...item, enabled } : item))} />
                      <button aria-label="编辑" onClick={() => setDialog(provider.pool ? 'pool' : provider.sub ? 'oauth' : 'edit')} className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-control group-hover:opacity-100"><span className="icon-[lucide--pencil] size-3.5" /></button>
                      <button aria-label="删除" disabled={removing === provider.id} onClick={() => setRemove(provider)} className={`flex size-7 items-center justify-center rounded-control text-muted hover:bg-control hover:text-danger ${removing === provider.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>{removing === provider.id ? <Spinner /> : <span className="icon-[lucide--trash-2] size-3.5" />}</button>
                    </div>
                  </div>
                  {removeError === provider.id && (
                    <div className="mx-3 mb-1 flex items-center gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-1.5 text-[12px] text-danger">
                      <span className="min-w-0 flex-1 truncate">退登失败：网络连接超时</span>
                      <button onClick={() => performRemove(provider)} className="rounded-control border border-danger/40 px-2 py-0.5 text-[11px]">重试</button>
                      <button onClick={() => performRemove(provider, true)} className="px-2 py-0.5 text-[11px]">仍要删除</button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}
      </SettingsSection>
      {remove && <DangerConfirm requireCheck={false} confirmLabel="移除" title="删除该配置？" description={remove.sub ? `删除会同时退登「${remove.name}」。同一厂商下的其他账号仍保持登录。` : `将永久删除「${remove.name}」这项配置。`} onClose={() => setRemove(null)} onConfirm={() => performRemove(remove)} />}
      {dialog === 'wizard' && <Overlay><ProviderWizard onClose={() => setDialog('')} /></Overlay>}
      {dialog === 'edit' && <ProviderEditDialog onClose={() => setDialog('')} />}
      {dialog === 'pool' && <ProviderEditDialog pool onClose={() => setDialog('')} />}
      {dialog === 'virtual' && <VirtualModelEditor onClose={() => setDialog('')} />}
      {dialog === 'import' && <Overlay><LocalImportProviders onClose={() => setDialog('')} /></Overlay>}
      {dialog === 'oauth' && (
        <Overlay>
          <Dialog width={560} title="OpenAI 订阅" description="连接 ChatGPT 订阅账号以使用其可用模型。" onClose={() => setDialog('')} footer={<button onClick={() => setDialog('')} className={primaryButton}>完成</button>}>
            <OauthPanel vendor="OpenAI" />
          </Dialog>
        </Overlay>
      )}
    </div>
  );
}
