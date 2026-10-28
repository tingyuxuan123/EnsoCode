import { useState } from 'react';
import { Dialog, Spinner, Switch } from '../../Controls';
import { Overlay } from '../../Workbench';
import { outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { Select } from './shared';

export const API_KINDS = [
  ['openai-completions', 'OpenAI Completions'],
  ['openai-responses', 'OpenAI Responses'],
  ['anthropic-messages', 'Anthropic'],
  ['google-generative-ai', 'Gemini'],
  ['typesafe-system-one', 'TypeSafe System One'],
  ['ollama', 'Ollama'],
] as [string, string][];

/** providerCatalog.ts 中的厂商；icon 为 simple-icons，无标志的用通用图标 */
export const CATALOG = [
  { id: 'anthropic', label: 'Anthropic', icon: 'icon-[simple-icons--anthropic]', oauth: true },
  { id: 'openai', label: 'OpenAI', icon: 'icon-[simple-icons--openai]', oauth: true },
  { id: 'google', label: 'Google', icon: 'icon-[simple-icons--google]', oauth: true },
  { id: 'xai', label: 'xAI', icon: 'icon-[simple-icons--x]', oauth: true },
  { id: 'deepseek', label: 'DeepSeek', icon: 'icon-[lucide--fish]', oauth: false },
  { id: 'openrouter', label: 'OpenRouter', icon: 'icon-[simple-icons--openrouter]', oauth: false },
  { id: 'typesafe', label: 'TypeSafe', icon: 'icon-[lucide--shield-check]', oauth: false, classifier: true },
  { id: 'moonshot', label: 'Moonshot', icon: 'icon-[lucide--moon-star]', oauth: false },
  { id: 'zhipu', label: 'Zhipu AI', icon: 'icon-[lucide--sparkles]', oauth: false },
  { id: 'minimax', label: 'MiniMax', icon: 'icon-[lucide--audio-waveform]', oauth: false },
  { id: 'siliconflow', label: 'SiliconFlow', icon: 'icon-[lucide--cpu]', oauth: false },
  { id: 'groq', label: 'Groq', icon: 'icon-[lucide--zap]', oauth: false },
  { id: 'mistral', label: 'Mistral AI', icon: 'icon-[simple-icons--mistralai]', oauth: false },
  { id: 'local', label: 'Local', icon: 'icon-[simple-icons--ollama]', oauth: false },
  { id: 'azure', label: 'Azure OpenAI', icon: 'icon-[lucide--cloud]', oauth: false },
  { id: 'alibaba', label: 'Alibaba Cloud', icon: 'icon-[simple-icons--alibabacloud]', oauth: false },
  { id: 'volcengine', label: 'Volcengine', icon: 'icon-[lucide--mountain]', oauth: false },
  { id: 'custom', label: '自定义', icon: 'icon-[lucide--server]', oauth: false },
];

type Model = { id: string; enabled: boolean; reasoning: 'follow' | 'on' | 'off'; context: string; output: string };
const seedModels: Model[] = [
  { id: 'deepseek-chat', enabled: true, reasoning: 'off', context: '128K', output: '8K' },
  { id: 'deepseek-reasoner', enabled: true, reasoning: 'on', context: '128K', output: '64K' },
];

/** API 表单（ProviderApiForm）：名称 / API 类型 / Base URL / API Key / 拉取模型 / 筛选 / 添加模型 ID / 测试连接 / 模型行能力覆盖 */
export function ProviderApiForm({ initial, vendor = 'DeepSeek' }: { initial?: 'empty' | 'filled'; vendor?: string }) {
  const filled = initial !== 'empty';
  const [name, setName] = useState(filled ? vendor : '');
  const [api, setApi] = useState('openai-completions');
  const [url, setUrl] = useState(filled ? 'https://api.deepseek.com/v1' : '');
  const [key, setKey] = useState(filled ? 'sk-••••••••••••3f9a' : '');
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<Model[]>(filled ? seedModels : []);
  const [fetchState, setFetchState] = useState<'' | 'loading' | 'done' | 'failed'>('');
  const [testState, setTestState] = useState<'' | 'loading' | 'ok' | 'failed'>('');
  const [query, setQuery] = useState('');
  const [newId, setNewId] = useState('');
  const [expanded, setExpanded] = useState('deepseek-reasoner');
  const fetchModels = () => {
    setFetchState('loading');
    window.setTimeout(() => {
      if (!key) { setFetchState('failed'); return; }
      setModels([...seedModels, { id: 'deepseek-coder', enabled: false, reasoning: 'follow', context: '128K', output: '8K' }, { id: 'deepseek-v3.2-exp', enabled: false, reasoning: 'follow', context: '128K', output: '8K' }]);
      setFetchState('done');
    }, 900);
  };
  const test = () => {
    setTestState('loading');
    window.setTimeout(() => setTestState(key && url.startsWith('https') ? 'ok' : 'failed'), 900);
  };
  const shown = models.filter((model) => model.id.includes(query));
  const enabled = models.filter((model) => model.enabled).length;
  const label = 'mb-1 block text-[12px] font-medium';
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <label><span className={label}>名称</span><input value={name} onChange={(event) => setName(event.target.value)} className="h-8 w-full rounded-control border border-border bg-input px-2 text-[13px] outline-none focus:border-primary/60" /></label>
        <label><span className={label}>API 类型</span><select value={api} onChange={(event) => setApi(event.target.value)} className={`${selectClass} w-full`}>{API_KINDS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>
      </div>
      <label className="block"><span className={label}>Base URL</span><input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://api.example.com/v1" className="h-8 w-full rounded-control border border-border bg-input px-2 font-mono text-[12px] outline-none focus:border-primary/60" /></label>
      <label className="block">
        <span className={label}>API Key</span>
        <span className="flex gap-2">
          <input type={showKey ? 'text' : 'password'} value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk-…" className="h-8 min-w-0 flex-1 rounded-control border border-border bg-input px-2 font-mono text-[12px] outline-none focus:border-primary/60" />
          <button type="button" onClick={() => setShowKey(!showKey)} aria-label="显示密钥" className={outlineButton}><span className={`${showKey ? 'icon-[lucide--eye-off]' : 'icon-[lucide--eye]'} size-3.5`} /></button>
        </span>
        <span className="mt-1 block text-[11px] text-faint">密钥只保存在主进程，不下发到界面层。</span>
      </label>
      <div>
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[12px] font-medium">模型</span>
          <span className="text-[11px] text-muted">已启用 {enabled}/{models.length}</span>
          <span className="ml-auto" />
          {fetchState === 'done' && <span className="text-[11px] text-success">拉取到 {models.length} 个模型</span>}
          {fetchState === 'failed' && <span className="text-[11px] text-danger">拉取失败：401 Unauthorized</span>}
          <button onClick={fetchModels} disabled={fetchState === 'loading'} className={outlineButton}>{fetchState === 'loading' ? <><Spinner className="size-3" />拉取中...</> : <><span className="icon-[lucide--download] size-3.5" />拉取模型</>}</button>
        </div>
        <div className="rounded-control border border-line">
          {models.length > 0 && (
            <label className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-muted">
              <span className="icon-[lucide--search] size-3.5" />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="筛选模型..." aria-label="筛选模型" className="min-w-0 flex-1 bg-transparent text-[12px] text-surface-foreground outline-none" />
            </label>
          )}
          <div className="max-h-[156px] overflow-y-auto">
            {!models.length && <p className="px-3 py-5 text-center text-[12px] text-muted">暂无模型，点击拉取</p>}
            {models.length > 0 && !shown.length && <p className="px-3 py-5 text-center text-[12px] text-muted">没有匹配的模型</p>}
            {shown.map((model) => (
              <div key={model.id} className="border-b border-line last:border-b-0">
                <div className="flex h-9 items-center gap-2 px-2.5">
                  <Switch label={model.id} checked={model.enabled} onChange={(value) => setModels(models.map((item) => item.id === model.id ? { ...item, enabled: value } : item))} />
                  <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{model.id}</span>
                  <span className="text-[11px] text-faint">上下文 {model.context}</span>
                  <button aria-label="能力覆盖" onClick={() => setExpanded(expanded === model.id ? '' : model.id)} className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover"><span className={`icon-[lucide--chevron-down] size-3.5 ${expanded === model.id ? 'rotate-180' : ''}`} /></button>
                </div>
                {expanded === model.id && (
                  <div className="grid grid-cols-4 gap-2 bg-panel/50 px-2.5 py-2 text-[11px] text-muted">
                    <label>推理<select value={model.reasoning} onChange={(event) => setModels(models.map((item) => item.id === model.id ? { ...item, reasoning: event.target.value as Model['reasoning'] } : item))} className={`${selectClass} mt-1 h-7 w-full`}><option value="follow">跟随</option><option value="on">开</option><option value="off">关</option></select></label>
                    <label>思考档位<select className={`${selectClass} mt-1 h-7 w-full`}><option>跟随</option><option>低</option><option>中</option><option>高</option></select></label>
                    <label>上下文<input defaultValue={model.context} className="mt-1 h-7 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" /></label>
                    <label>最大输出<input defaultValue={model.output} className="mt-1 h-7 w-full rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground" /></label>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-2 border-t border-line px-2.5 py-1.5">
            <input value={newId} onChange={(event) => setNewId(event.target.value)} placeholder="添加模型 ID" aria-label="添加模型 ID" className="h-7 min-w-0 flex-1 rounded-control border border-border bg-input px-2 font-mono text-[12px] outline-none" />
            <button disabled={!newId.trim()} onClick={() => { setModels([...models, { id: newId.trim(), enabled: true, reasoning: 'follow', context: '—', output: '—' }]); setNewId(''); }} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" /></button>
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={test} disabled={testState === 'loading' || !enabled} className={outlineButton}>{testState === 'loading' ? <><Spinner className="size-3" />测试中...</> : <><span className="icon-[lucide--plug-zap] size-3.5" />测试连接</>}</button>
        {testState === 'ok' && <span className="flex items-center gap-1 text-[12px] text-success"><span className="icon-[lucide--circle-check] size-3.5" />连接成功(412ms)</span>}
        {testState === 'failed' && <span className="flex items-center gap-1 text-[12px] text-danger"><span className="icon-[lucide--circle-x] size-3.5" />连接失败：Base URL 需为 https，或 API Key 无效</span>}
      </div>
    </div>
  );
}

/** 编辑模型服务（ProviderEditDialog） */
export function ProviderEditDialog({ onClose, pool = false }: { onClose: () => void; pool?: boolean }) {
  return (
    <Overlay>
      <Dialog width={600} title="编辑模型服务" description={pool ? 'ChatGPT 自动接替池' : 'DeepSeek · OpenAI Completions'} onClose={onClose} footer={<><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={onClose} className={primaryButton}>保存</button></>}>
        {pool ? <PoolEditor /> : <ProviderApiForm />}
      </Dialog>
    </Overlay>
  );
}

/** ChatGPT 自动接替池：按列表顺序使用已启用且已登录的账号 */
export function PoolEditor() {
  const [accounts, setAccounts] = useState([
    { email: 'dev@example.com', plan: 'Pro', on: true, logged: true, usage: '5 小时窗口 82%' },
    { email: 'work@example.com', plan: 'Plus', on: true, logged: true, usage: '5 小时窗口 12%' },
    { email: 'old@example.com', plan: 'Plus', on: false, logged: true, usage: '' },
    { email: 'team@example.com', plan: 'Team', on: true, logged: false, usage: '' },
  ]);
  const move = (index: number, dir: number) => {
    const next = [...accounts];
    const [item] = next.splice(index, 1);
    next.splice(index + dir, 0, item);
    setAccounts(next);
  };
  return (
    <div>
      <p className="text-[13px] font-medium">接替账号</p>
      <p className="mt-0.5 text-[12px] leading-5 text-muted">按列表顺序使用已启用且已登录的账号。模型和推理设置保持不变，主代理与子代理共用此池。</p>
      <div className="mt-3 divide-y divide-line rounded-control border border-line">
        {accounts.map((account, index) => (
          <div key={account.email} className="flex h-11 items-center gap-2 px-2.5">
            <span className="w-5 text-center text-[11px] tabular-nums text-faint">{index + 1}</span>
            <span className="icon-[simple-icons--openai] size-3.5 text-muted" />
            <div className="min-w-0 flex-1">
              <p className={`truncate text-[13px] ${account.on && account.logged ? '' : 'text-muted'}`}>{account.email} <span className="ml-1 rounded-[3px] bg-primary-soft px-1 text-[11px] text-primary">{account.plan}</span></p>
              <p className="text-[11px] text-muted">{!account.logged ? <span className="text-warning">账号未登录</span> : !account.on ? '账号已停用' : `${account.usage} · 2 小时后重置`}</p>
            </div>
            <button disabled={index === 0} onClick={() => move(index, -1)} aria-label="上移" className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover disabled:opacity-30"><span className="icon-[lucide--arrow-up] size-3.5" /></button>
            <button disabled={index === accounts.length - 1} onClick={() => move(index, 1)} aria-label="下移" className="flex size-6 items-center justify-center rounded text-muted hover:bg-hover disabled:opacity-30"><span className="icon-[lucide--arrow-down] size-3.5" /></button>
            <Switch label={account.email} checked={account.on} onChange={(on) => setAccounts(accounts.map((item, i) => i === index ? { ...item, on } : item))} />
          </div>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-faint">自动接替池不显示单个账号额度，固定账号条目保持不变。</p>
    </div>
  );
}

/** 订阅登录（OauthProvidersDialog / OauthLoginStep）：授权步骤 + 手动回填 */
export function OauthPanel({ vendor = 'OpenAI' }: { vendor?: string }) {
  const [step, setStep] = useState<'idle' | 'waiting' | 'manual' | 'done' | 'error'>('idle');
  const [code, setCode] = useState('');
  const [accounts, setAccounts] = useState(vendor === 'OpenAI' ? [{ email: 'dev@example.com', plan: 'Pro' }] : []);
  return (
    <div>
      <div className="divide-y divide-line rounded-control border border-line">
        {!accounts.length && <p className="px-3 py-5 text-center text-[12px] text-muted">尚未连接订阅账号<br /><span className="text-faint">授权此提供商，以添加其可用模型。</span></p>}
        {accounts.map((account) => (
          <div key={account.email} className="flex h-11 items-center gap-2 px-3">
            <span className="icon-[lucide--badge-check] size-4 text-success" />
            <span className="min-w-0 flex-1 truncate text-[13px]">{account.email}<span className="ml-1.5 rounded-[3px] bg-primary-soft px-1 text-[11px] text-primary">{account.plan}</span></span>
            <span className="text-[11px] text-faint">5 小时窗口 42% · 3 小时后重置</span>
            <button onClick={() => setAccounts([])} className="text-[12px] text-muted hover:text-danger">退出登录</button>
          </div>
        ))}
      </div>
      {step === 'idle' && (
        <div className="mt-3 flex gap-2">
          <button onClick={() => { setStep('waiting'); window.setTimeout(() => setStep((s) => s === 'waiting' ? 'manual' : s), 2500); }} className={primaryButton}><span className="icon-[lucide--log-in] size-3.5" />{accounts.length ? '添加其他账号' : '连接订阅'}</button>
          {vendor === 'OpenAI' && <button onClick={() => setStep('error')} className={outlineButton}>从 Codex 导入</button>}
        </div>
      )}
      {step === 'waiting' && (
        <div className="mt-3 rounded-control border border-line bg-panel/50 p-3 text-[12px]">
          <p className="flex items-center gap-2 font-medium"><Spinner />已在浏览器打开授权页面</p>
          <p className="mt-1 text-muted">在浏览器中登录 {vendor} 并同意授权，完成后会自动回到这里。</p>
          <button onClick={() => setStep('manual')} className="mt-2 text-primary">浏览器没有跳回？手动粘贴授权码</button>
        </div>
      )}
      {step === 'manual' && (
        <div className="mt-3 rounded-control border border-line bg-panel/50 p-3 text-[12px]">
          <p className="font-medium">手动回填</p>
          <p className="mt-1 text-muted">复制浏览器地址栏中的完整回调地址或授权码，粘贴到这里。</p>
          <div className="mt-2 flex gap-2">
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="http://localhost:1455/auth/callback?code=…" aria-label="授权码" className="h-8 min-w-0 flex-1 rounded-control border border-border bg-input px-2 font-mono text-[12px] outline-none" />
            <button disabled={!code.trim()} onClick={() => { setAccounts([...accounts, { email: 'work@example.com', plan: 'Plus' }]); setStep('idle'); setCode(''); }} className={primaryButton}>提交</button>
            <button onClick={() => setStep('idle')} className="px-2 text-muted">取消</button>
          </div>
        </div>
      )}
      {step === 'error' && (
        <div className="mt-3 flex items-start gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger">
          <span className="icon-[lucide--circle-alert] mt-0.5 size-3.5 shrink-0" />
          <span className="flex-1">未找到 Codex 登录态，请先在 Codex Desktop 或 CLI 中登录。</span>
          <button onClick={() => setStep('idle')} className="text-[12px]">重试</button>
        </div>
      )}
    </div>
  );
}

/** 统一向导（ProviderSetupWizard）：选提供商 → 选连接方式（订阅 / API Key）→ 配置 */
export function ProviderWizard({ onClose, startStep = 0 }: { onClose: () => void; startStep?: 0 | 1 | 2 }) {
  const [step, setStep] = useState(startStep);
  const [vendor, setVendor] = useState(startStep ? 'deepseek' : '');
  const [method, setMethod] = useState<'oauth' | 'api'>('api');
  const [loadFailed, setLoadFailed] = useState(false);
  const picked = CATALOG.find((item) => item.id === vendor);
  const steps = ['选择提供商', '选择连接方式', method === 'oauth' ? '提供商订阅' : 'API Key'];
  return (
    <Dialog width={640} title="添加模型 / 提供商" description={step === 0 ? '请先选择提供商，下一步再选择订阅或 API Key。' : picked?.label} onClose={onClose} footer={
      <>
        <div className="mr-auto flex items-center gap-1.5 text-[11px] text-muted">
          {steps.map((label, index) => <span key={label} className={`flex items-center gap-1.5 ${index === step ? 'font-medium text-surface-foreground' : ''}`}>{index > 0 && <span className="text-faint">›</span>}{label}</span>)}
        </div>
        {step > 0 && <button onClick={() => setStep((step - 1) as 0 | 1)} className="px-3 py-2 text-[12px] text-muted">上一步</button>}
        {step < 2 ? <button disabled={!vendor} onClick={() => setStep(picked?.oauth || step === 1 ? ((step + 1) as 1 | 2) : 2)} className={primaryButton}>下一步</button> : <button onClick={onClose} className={primaryButton}>完成</button>}
      </>
    }>
      {step === 0 && (
        <>
          {loadFailed && <div className="mb-3 flex items-center gap-2 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] text-danger"><span className="icon-[lucide--circle-alert] size-3.5" />无法加载订阅提供商<button onClick={() => setLoadFailed(false)} className="ml-auto">重试</button></div>}
          <div className="grid grid-cols-3 gap-2">
            {CATALOG.map((item) => (
              <button key={item.id} onClick={() => { setVendor(item.id); setMethod(item.oauth ? 'oauth' : 'api'); }} className={`flex h-12 items-center gap-2.5 rounded-control border px-3 text-left ${vendor === item.id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover'}`}>
                <span className={`${item.icon} size-4 shrink-0 text-muted`} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px]">{item.label}</span>
                  {'classifier' in item && item.classifier ? <span className="block text-[11px] text-faint">仅用于分类，不能聊天</span> : item.oauth ? <span className="block text-[11px] text-faint">订阅 · API Key</span> : <span className="block text-[11px] text-faint">API Key</span>}
                </span>
              </button>
            ))}
          </div>
          <button onClick={() => setLoadFailed(true)} className="mt-2 text-[11px] text-faint">（预览：订阅提供商加载失败）</button>
        </>
      )}
      {step === 1 && (
        <div className="grid grid-cols-2 gap-3">
          {([['oauth', 'icon-[lucide--badge-check]', '订阅', '提供商订阅', '在浏览器中登录并使用订阅账号。'], ['api', 'icon-[lucide--key-round]', 'API Key', 'API Key', '配置端点和密钥后，再拉取或测试模型。']] as const).map(([id, icon, label, , desc]) => (
            <button key={id} disabled={id === 'oauth' && !picked?.oauth} onClick={() => setMethod(id)} className={`rounded-control border p-4 text-left disabled:opacity-45 ${method === id ? 'border-primary bg-primary-soft' : 'border-line hover:bg-hover'}`}>
              <span className={`${icon} size-5 text-muted`} />
              <p className="mt-2 text-[14px] font-medium">{label}</p>
              <p className="mt-1 text-[12px] leading-5 text-muted">{desc}</p>
            </button>
          ))}
        </div>
      )}
      {step === 2 && (method === 'oauth' ? <OauthPanel vendor={picked?.label} /> : <ProviderApiForm initial="empty" vendor={picked?.label} />)}
    </Dialog>
  );
}

/** 从本地应用导入模型服务（LocalImportDialog）：扫描 → 选择 → 拉取并启用 */
export function LocalImportProviders({ onClose, initial = 'list' }: { onClose: () => void; initial?: 'scanning' | 'list' | 'failed' | 'empty' | 'fetch' }) {
  const [stage, setStage] = useState(initial);
  const [picked, setPicked] = useState(['cc-1', 'cherry-1']);
  const rows = [
    { id: 'cc-1', app: 'Claude Code', name: 'Anthropic API', models: 4 },
    { id: 'codex-1', app: 'Codex', name: 'OpenAI', models: 6, exists: true },
    { id: 'cherry-1', app: 'Cherry Studio', name: 'SiliconFlow', models: 12 },
    { id: 'cherry-2', app: 'Cherry Studio', name: 'Moonshot', models: 3 },
  ];
  const selectable = rows.filter((row) => !row.exists);
  return (
    <Dialog width={600} title="从本地应用导入" description="扫描本机 AI 应用中已配置的模型服务并导入。" onClose={onClose} footer={
      stage === 'list' ? (
        <>
          <span className="mr-auto text-[12px] text-muted">已选 {picked.length} 项</span>
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button>
          <button disabled={!picked.length} onClick={() => setStage('fetch')} className={primaryButton}>导入所选</button>
        </>
      ) : stage === 'fetch' ? <button onClick={onClose} className={primaryButton}>完成</button> : <button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">关闭</button>
    }>
      {stage === 'scanning' && <div className="flex flex-col items-center py-10 text-[13px] text-muted"><Spinner className="size-5" /><p className="mt-3">正在扫描本地应用...</p></div>}
      {stage === 'failed' && <div className="flex flex-col items-center py-10 text-center"><span className="icon-[lucide--circle-alert] size-6 text-danger" /><p className="mt-3 text-[13px] font-medium">扫描失败</p><p className="mt-1 text-[12px] text-muted">读取 ~/.cherrystudio 时权限不足。</p><button onClick={() => setStage('list')} className={`${outlineButton} mt-3`}>重新扫描</button></div>}
      {stage === 'empty' && <div className="flex flex-col items-center py-10 text-center"><span className="icon-[lucide--search-x] size-6 text-faint" /><p className="mt-3 text-[13px] font-medium">未检测到本地应用</p><p className="mt-1 max-w-[380px] text-[12px] leading-5 text-muted">支持:Claude Code、Codex、CC Switch、Alma、Cherry Studio、Hermes、OpenClaw、Grok CLI、Cursor</p></div>}
      {stage === 'list' && (
        <>
          <div className="mb-2 flex gap-3 text-[12px]"><button onClick={() => setPicked(selectable.map((row) => row.id))} className="text-primary">全选</button><button onClick={() => setPicked([])} className="text-muted">全不选</button></div>
          <div className="divide-y divide-line rounded-control border border-line">
            {rows.map((row) => (
              <label key={row.id} className={`flex h-11 items-center gap-3 px-3 ${row.exists ? 'opacity-55' : 'cursor-pointer hover:bg-hover'}`}>
                <input type="checkbox" disabled={row.exists} checked={picked.includes(row.id)} onChange={(event) => setPicked(event.target.checked ? [...picked, row.id] : picked.filter((id) => id !== row.id))} />
                <span className="min-w-0 flex-1 text-[13px]">{row.name}<span className="ml-2 text-[11px] text-muted">{row.app}</span></span>
                <span className="text-[11px] text-muted">{row.models} 个模型</span>
                {row.exists && <span className="rounded-[4px] bg-control px-1.5 text-[11px] text-muted">已存在</span>}
              </label>
            ))}
          </div>
        </>
      )}
      {stage === 'fetch' && (
        <>
          <p className="mb-2 text-[12px] text-muted">为每个模型服务拉取模型，再启用你需要的。</p>
          {[['Anthropic API', 'done', 4], ['SiliconFlow', 'failed', 0]].map(([name, state, count]) => (
            <div key={name as string} className="mb-2 rounded-control border border-line px-3 py-2">
              <div className="flex items-center gap-2 text-[13px]">
                <span className="font-medium">{name}</span>
                {state === 'failed' ? <span className="text-[11px] text-danger">拉取失败</span> : <span className="text-[11px] text-success">拉取到 {count} 个模型</span>}
                <span className="ml-auto" />
                {state === 'failed' ? <button className={outlineButton}>拉取模型</button> : <><button className="text-[12px] text-primary">全部启用</button><button className="text-[12px] text-muted">全部禁用</button></>}
              </div>
            </div>
          ))}
        </>
      )}
      <div className="mt-3 flex gap-2 text-[11px] text-faint">
        预览状态：
        {(['scanning', 'list', 'failed', 'empty', 'fetch'] as const).map((s) => <button key={s} onClick={() => setStage(s)} className={stage === s ? 'text-primary' : 'hover:text-surface-foreground'}>{{ scanning: '扫描中', list: '列表', failed: '失败', empty: '无应用', fetch: '拉取' }[s]}</button>)}
      </div>
    </Dialog>
  );
}

export { Select };
