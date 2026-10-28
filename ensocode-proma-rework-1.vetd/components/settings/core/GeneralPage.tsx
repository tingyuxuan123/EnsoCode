import { useState } from 'react';
import { Link } from 'react-router';
import { Spinner } from '../../Controls';
import { InlineNotice, outlineButton, primaryButton, SettingsHeader, SettingsRow, SettingsSection } from '../SettingsUI';
import { ModelSelect, NewSessionBadge, Select, SwitchLine } from './shared';

/** 文件打开（FileOpeningSettings）+ 右键打开方式（ContextMenuOpeningSettings） */
function FileOpening() {
  const [rules, setRules] = useState([
    { ext: '.md', mode: '在 EnsoCode 内打开' },
    { ext: '.pdf', mode: '系统默认应用' },
    { ext: '.fig', mode: '指定应用', app: 'Figma' },
  ]);
  const [ext, setExt] = useState('');
  const [error, setError] = useState('');
  const [apps, setApps] = useState([{ name: '文件管理器', on: true }, { name: 'VS Code', on: true }, { name: 'Cursor', on: false }]);
  const add = () => {
    const value = ext.trim();
    if (!/^\.[a-z0-9]+$/i.test(value)) return setError('请输入有效的文件扩展名，例如 .md。');
    if (rules.some((rule) => rule.ext === value)) return setError('此扩展名已有打开规则。');
    setRules([...rules, { ext: value, mode: '在 EnsoCode 内打开' }]);
    setExt(''); setError('');
  };
  return (
    <SettingsSection title="文件打开" description="按扩展名配置本地工作区文件链接的打开方式。默认在 EnsoCode 内打开支持的文件，其他文件在文件管理器中显示。">
      <div className="rounded-control border border-line">
        {rules.map((rule, index) => (
          <div key={rule.ext} className="flex h-10 items-center gap-3 border-b border-line px-3 last:border-b-0">
            <code className="w-16 shrink-0">{rule.ext}</code>
            <Select label="打开方式" value={rule.mode} width="w-48" onChange={(mode) => setRules(rules.map((item, i) => i === index ? { ...item, mode } : item))} options={['在 EnsoCode 内打开', '在文件管理器中显示', '系统默认应用', '指定应用']} />
            {rule.mode === '指定应用' && <button className={outlineButton}>{'app' in rule && rule.app ? rule.app : '选择应用'}</button>}
            {rule.ext === '.pdf' && rule.mode === '在 EnsoCode 内打开' && <span className="text-[11px] text-danger">此扩展名不支持内部预览。</span>}
            <button aria-label="删除" title="删除" onClick={() => setRules(rules.filter((_, i) => i !== index))} className="ml-auto flex size-7 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-danger"><span className="icon-[lucide--trash-2] size-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="mt-2 flex items-center gap-2">
        <input value={ext} onChange={(event) => setExt(event.target.value)} placeholder="文件扩展名" aria-label="文件扩展名" className="h-8 w-40 rounded-control border border-border bg-input px-2 text-[12px] outline-none focus:border-primary/60" />
        <button onClick={add} className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />添加</button>
        {error && <span className="text-[12px] text-danger">{error}</span>}
      </div>
      <p className="mt-2 text-[11px] text-faint">可执行文件和安装包始终在文件管理器中显示。</p>
      <div className="mt-4">
        <p className="text-[13px]">右键打开方式</p>
        <p className="mt-0.5 text-[12px] text-muted">勾选文件链接右键菜单中显示的打开方式，可添加多个应用。最多可配置 32 项打开方式。</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {apps.map((app, index) => (
            <label key={app.name} className="flex h-8 items-center gap-2 rounded-control border border-border px-2.5 text-[12px]">
              <input type="checkbox" checked={app.on} onChange={() => setApps(apps.map((item, i) => i === index ? { ...item, on: !item.on } : item))} />
              {app.name}
            </label>
          ))}
          <button className={outlineButton}><span className="icon-[lucide--plus] size-3.5" />添加应用</button>
        </div>
      </div>
    </SettingsSection>
  );
}

/** 上下文压缩（SmartCompactPicker） */
function Compaction() {
  const [strategy, setStrategy] = useState('smart');
  const [mode, setMode] = useState('auto');
  const [model, setModel] = useState('');
  return (
    <SettingsSection title="上下文压缩策略" description="标准使用默认压缩。智能压缩在压缩时用 Enso 验证式摘要。Codex 原生压缩在 Codex 模型上额外保存官方 checkpoint。持续记忆在后台持续记录观察；失败都回退默认压缩。">
      <SettingsRow label="策略" description={<span className="flex items-center gap-2">切换策略从下一个会话生效 <NewSessionBadge /></span>}>
        <Select label="上下文压缩策略" value={strategy} onChange={setStrategy} width="w-52" options={[['standard', '标准'], ['smart', '智能压缩'], ['codex-native', 'Codex 原生压缩'], ['continuous-memory', '持续记忆（实验）']]} />
      </SettingsRow>
      {(strategy === 'smart' || strategy === 'codex-native') && (
        <SettingsRow label="压缩档位" description="档位只影响摘要细致和留多长尾巴，不决定是否压缩。">
          <Select label="压缩档位" value={mode} onChange={setMode} options={[['auto', '自动（按占用）'], ['fast', '快速'], ['balanced', '均衡'], ['thorough', '细致']]} />
        </SettingsRow>
      )}
      {strategy !== 'standard' && (
        <SettingsRow label={strategy === 'continuous-memory' ? '后台记忆模型' : '摘要模型'} description="对已打开的对话，下一次压缩时使用最新设置。">
          <ModelSelect label="摘要模型" value={model} onChange={setModel} emptyLabel="跟随当前会话模型" />
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

function Proxy() {
  const [mode, setMode] = useState('custom');
  const [url, setUrl] = useState('http://127.0.0.1:7890');
  const invalid = mode === 'custom' && !/^https?:\/\/.+/.test(url);
  return (
    <SettingsSection title="网络代理" description="作用于模型请求、内嵌浏览器和 agent 工具">
      <SettingsRow label="代理模式">
        <Select label="代理模式" value={mode} onChange={setMode} options={[['system', '跟随系统代理'], ['none', '不使用代理'], ['custom', '自定义代理']]} />
      </SettingsRow>
      {mode === 'custom' && (
        <SettingsRow label="代理地址" description={invalid ? <span className="text-danger">请输入 http(s) 代理地址</span> : undefined}>
          <input value={url} onChange={(event) => setUrl(event.target.value)} aria-label="代理地址" className={`h-8 w-64 rounded-control border bg-input px-2 font-mono text-[12px] outline-none ${invalid ? 'border-danger/60' : 'border-border focus:border-primary/60'}`} />
        </SettingsRow>
      )}
    </SettingsSection>
  );
}

function Updates() {
  const [state, setState] = useState<'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'failed'>('idle');
  const [auto, setAuto] = useState(true);
  const [idleRestart, setIdleRestart] = useState(false);
  const check = () => {
    setState('checking');
    window.setTimeout(() => setState('downloading'), 900);
    window.setTimeout(() => setState('ready'), 2200);
  };
  const status = { idle: '', checking: '正在检查更新…', latest: '已是最新版本', downloading: '正在下载更新… 64%', ready: '新版本 0.42.0 已就绪 —— 重启以更新。', failed: '更新失败' }[state];
  return (
    <SettingsSection title="更新" description="应用更新设置">
      <SettingsRow label="当前版本" description={<span className="font-mono">0.41.3 (personal)</span>}>
        {state === 'ready' ? <button className={primaryButton}>重启更新</button> : <button disabled={state === 'checking' || state === 'downloading'} onClick={check} className={outlineButton}>{state === 'checking' && <Spinner className="size-3" />}检查更新</button>}
      </SettingsRow>
      {status && (
        <p className={`-mt-1 mb-2 flex items-center gap-2 text-[12px] ${state === 'failed' ? 'text-danger' : state === 'ready' ? 'text-success' : 'text-muted'}`}>
          {status}
          {state === 'downloading' && <span className="inline-block h-1 w-28 overflow-hidden rounded-full bg-control"><span className="block h-full w-[64%] bg-primary" /></span>}
          {state === 'ready' && <button onClick={() => setState('failed')} className="text-[11px] text-faint">（预览：切到失败态）</button>}
        </p>
      )}
      <SwitchLine label="自动更新" description="自动下载并安装更新" checked={auto} onChange={setAuto} />
      <SwitchLine label="空闲时重启并应用更新" description="更新下载完成后，没有 agent 在跑、没有排队消息、也没有待回答/待审批时自动重启。该状态需连续保持 5 分钟；窗口在前台时也会拦住。" checked={idleRestart} onChange={setIdleRestart} disabled={!auto} />
    </SettingsSection>
  );
}

/** 通用（GeneralSettings.tsx）：顺序与源码一致 */
export function GeneralPage() {
  const [language, setLanguage] = useState('zh');
  const [mainOnly, setMainOnly] = useState(true);
  const [toggles, setToggles] = useState({ openChanges: true, compactRead: true, expandEdits: false, expandThinking: true, foldHistory: true, foldWork: true, pinTodos: true });
  const set = (key: keyof typeof toggles) => (value: boolean) => setToggles({ ...toggles, [key]: value });
  const [stall, setStall] = useState('5');
  const [retry, setRetry] = useState('5');
  const [archiveDays, setArchiveDays] = useState('14');
  const [cleanWorktree, setCleanWorktree] = useState(true);
  const [deleteDays, setDeleteDays] = useState('0');
  const [winShell, setWinShell] = useState('default');
  const [shell, setShell] = useState('default');
  const [root, setRoot] = useState('');
  const rootInvalid = Boolean(root) && !root.startsWith('/') && !root.startsWith('~');
  return (
    <div data-settings-row="general.root">
      <SettingsHeader title="通用" description="应用通用设置" />
      <SettingsSection>
        <SettingsRow label="语言">
          <Select label="语言" value={language} onChange={setLanguage} width="w-40" options={[['system', '跟随系统'], ['zh', '简体中文'], ['en', 'English']]} />
        </SettingsRow>
      </SettingsSection>
      <SettingsSection title="通知">
        <SwitchLine label="仅主 agent 发送完成通知" description="coworker 的回合完成和失败不弹桌面或手机通知。提问和审批仍会提醒。" checked={mainOnly} onChange={setMainOnly} />
      </SettingsSection>
      <SettingsSection title="会话归档">
        <SettingsRow label="归档闲置会话" description="将闲置超过此天数的会话移入已归档，不会删除。">
          <Select label="归档闲置会话" value={archiveDays} onChange={setArchiveDays} width="w-28" options={[['0', '关'], ['7', '7 天'], ['14', '14 天'], ['30', '30 天'], ['90', '90 天']]} />
        </SettingsRow>
        <SwitchLine label="清理已合并 worktree" description="归档闲置会话时，一并清理已合并且干净的隔离 worktree。" checked={cleanWorktree} onChange={setCleanWorktree} disabled={archiveDays === '0'} />
        <SettingsRow label="归档超过此天数后删除" description="永久删除归档超过此天数的会话，不可恢复。改成正数会立即删除已超期的归档。">
          <Select label="归档超过此天数后删除" value={deleteDays} onChange={setDeleteDays} width="w-28" options={[['0', '永不'], ['30', '30 天'], ['90', '90 天'], ['180', '180 天']]} />
        </SettingsRow>
        {deleteDays !== '0' && <InlineNotice tone="warning">保存后会立即永久删除归档超过 {deleteDays} 天的会话，无法恢复。</InlineNotice>}
      </SettingsSection>
      <SettingsSection title="对话与右侧面板">
        <SwitchLine label="有文件改动时打开 Changes" description="Agent 改文件后自动打开右侧 Changes" checked={toggles.openChanges} onChange={set('openChanges')} />
        <SwitchLine label="精简只读工具调用" description="read/grep/find/ls 显示为单行，agent 运行中也折叠连续的工具调用" checked={toggles.compactRead} onChange={set('compactRead')} />
        <SwitchLine label="运行中自动展开文件改动" description="agent 运行中，文件修改工具的 diff 或写入内容自动展开" checked={toggles.expandEdits} onChange={set('expandEdits')} />
        <SwitchLine label="流式推理时自动展开" description="模型思考时自动展开推理内容；思考结束后仍自动收起" checked={toggles.expandThinking} onChange={set('expandThinking')} />
        <SwitchLine label="自动折叠历史轮次" description="发送新消息后，之前的轮次只保留提问、时间与用时；最后一轮保持展开" checked={toggles.foldHistory} onChange={set('foldHistory')} />
        <SwitchLine label="回合结束后折叠工作过程" description="把最终答案之前的思考、工具调用和过程叙述收进一行「已工作」；运行中、已停止和失败的轮保持展开" checked={toggles.foldWork} onChange={set('foldWork')} />
        <SwitchLine label="固定显示未完成待办" description="最新任务清单还有未完成项时，固定显示在输入框上方，不随时间线滚走" checked={toggles.pinTodos} onChange={set('pinTodos')} />
        <SettingsRow label="无输出则停止" description="超过此时长没有 token 或工具结果就中止并重试。思考输出也算有输出。">
          <Select label="无输出则停止" value={stall} onChange={setStall} width="w-28" options={[['0', '永不'], ['3', '3 分钟'], ['5', '5 分钟'], ['10', '10 分钟']]} />
        </SettingsRow>
        <SettingsRow label="瞬态错误自动重试" description="遇到 429、5xx 或网络错误时退避重试（间隔最长 60 秒）。额度与计费错误不重试。选「无限」会一直重试，直到手动取消。">
          <Select label="瞬态错误自动重试" value={retry} onChange={setRetry} width="w-28" options={[['0', '关'], ['3', '3 次'], ['5', '5 次'], ['10', '10 次'], ['inf', '无限']]} />
        </SettingsRow>
      </SettingsSection>
      <FileOpening />
      <Compaction />
      <SettingsSection title="命令与终端">
        <SettingsRow label="Windows 本地命令壳" description={<span className="flex flex-wrap items-center gap-2">只影响 Windows 本机 agent 命令工具。SSH 与其它平台仍用 bash。<NewSessionBadge text="下次开会话生效" /></span>}>
          <Select label="Windows 本地命令壳" value={winShell} onChange={setWinShell} width="w-52" disabled options={[['default', 'Windows 默认（PowerShell）'], ['pwsh', 'PowerShell'], ['bash', 'Git Bash']]} />
        </SettingsRow>
        <p className="-mt-1 mb-1 text-[11px] text-faint">当前为 macOS，此项仅在 Windows 上可改。</p>
        <SettingsRow label="终端 Shell" description="仅对新开的侧边栏终端生效。SSH 项目仍用远端登录 shell。">
          <Select label="终端 Shell" value={shell} onChange={setShell} width="w-44" options={[['default', '系统默认'], ['zsh', '/bin/zsh'], ['bash', '/bin/bash'], ['fish', '/opt/homebrew/bin/fish']]} />
        </SettingsRow>
        <SettingsRow label="Worktree 根目录" description={rootInvalid ? <span className="text-danger">请输入绝对路径</span> : '隔离会话的 worktree 建在此目录下。留空则用应用数据目录。已有 worktree 不迁移。'}>
          <input value={root} onChange={(event) => setRoot(event.target.value)} placeholder="默认位置" aria-label="Worktree 根目录" className={`h-8 w-52 rounded-control border bg-input px-2 font-mono text-[12px] outline-none ${rootInvalid ? 'border-danger/60' : 'border-border'}`} />
          <button onClick={() => setRoot('~/worktrees')} className={outlineButton}>浏览</button>
        </SettingsRow>
      </SettingsSection>
      <Proxy />
      <SettingsSection title="配置迁移" description="在设备之间迁移模型、预设、子代理类型、技能、MCP 服务和指令文件。">
        <SettingsRow label="可移植 Enso 配置" description="导出配置包，或在导入前预览配置包。OAuth 登录态不会迁移。">
          <Link to="/settings-general--config-sync" className={outlineButton}><span className="icon-[lucide--download] size-3.5" />导入配置</Link>
          <Link to="/settings-general--config-sync" className={outlineButton}><span className="icon-[lucide--upload] size-3.5" />导出配置</Link>
        </SettingsRow>
      </SettingsSection>
      <Updates />
    </div>
  );
}
