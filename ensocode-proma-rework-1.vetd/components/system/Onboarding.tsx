import { useState } from 'react';
import { Link } from 'react-router';
import { Dialog, Spinner } from '../Controls';
import { TrafficLights } from '../Shell';

/**
 * 首次使用引导（onboarding/Onboarding.tsx）：8 步 —— 欢迎 → 模型中心 → 技能 → MCP 服务器 →
 * 指令文件 → 预设 → 子代理类型 → 全部就绪。每步可跳过，之后随时能回到设置里继续。
 * 设计稿做成独立窗口样式（引导期间主窗口不可用）。
 */
const steps = [
  { id: 'welcome', title: '欢迎使用 EnsoCode', desc: '从本地 AI 应用导入模型服务与资源即可开始，每一步都可跳过。' },
  { id: 'providers', title: '模型中心', desc: '添加提供商订阅或 API Key，也可从本地 AI 应用导入模型服务。' },
  { id: 'skills', title: '技能', desc: '从 Claude Code、Codex 或 Cursor 导入技能。' },
  { id: 'mcp', title: 'MCP 服务器', desc: '导入本机 AI 应用中已配置的 MCP 服务器。' },
  { id: 'instructions', title: '指令文件', desc: '导入本机 AI 工具中已配置的全局指令文件。' },
  { id: 'preset', title: '预设', desc: '把技能、MCP 服务和一份指令组合成预设（可选）。' },
  { id: 'agentType', title: '子代理类型', desc: '为子代理配置专属模型、技能与 MCP 服务（可选）。' },
  { id: 'done', title: '全部就绪', desc: '之后随时可在设置里导入更多。' },
];

export function Onboarding({ start = 0 }: { start?: number }) {
  const [index, setIndex] = useState(start);
  const [busy, setBusy] = useState('');
  const [imported, setImported] = useState<string[]>(['providers']);
  const step = steps[index];
  const runImport = (id: string) => {
    setBusy(id);
    window.setTimeout(() => { setBusy(''); setImported([...new Set([...imported, id])]); }, 900);
  };
  return (
    <div className="flex h-full flex-col bg-panel">
      <header className="flex h-11 shrink-0 items-center bg-panel pr-3">
        <TrafficLights />
        <span className="text-[12px] font-medium text-muted">EnsoCode</span>
      </header>
      <div className="flex min-h-0 flex-1 items-center justify-center px-8">
        <div className="w-full max-w-[620px] rounded-control border border-border bg-surface">
          <div className="flex items-center gap-1.5 border-b border-line px-4 py-2.5">
            {steps.map((item, i) => (
              <span key={item.id} className={`h-1 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-control'}`} title={item.title} />
            ))}
            <span className="ml-2 shrink-0 text-[11px] tabular-nums text-faint">{index + 1}/{steps.length}</span>
          </div>
          <div className="px-6 py-6">
            <h1 className="text-[18px] font-semibold">{step.title}</h1>
            <p className="mt-1.5 text-[13px] leading-6 text-muted">{step.desc}</p>
            <div className="mt-4 min-h-[168px]">
              {step.id === 'welcome' && (
                <div className="space-y-2 text-[12.5px]">
                  {['从本地 AI 应用导入模型服务', '导入技能、MCP 与指令文件', '配置好第一套预设与子代理类型'].map((line) => (
                    <div key={line} className="flex items-center gap-2 rounded-control border border-line px-3 py-2">
                      <span className="icon-[lucide--check] size-3.5 text-success" />
                      {line}
                    </div>
                  ))}
                  <p className="pt-1 text-[11px] text-faint">不确定如何配置？<Link to="/" className="text-primary">询问 Enso</Link> 帮你检查并给出建议。</p>
                </div>
              )}
              {step.id === 'providers' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <button onClick={() => runImport('providers')} className="flex h-8 items-center gap-1.5 rounded-control bg-surface-foreground px-3 text-[12px] text-surface"><span className="icon-[lucide--download] size-3.5" />从本地应用导入</button>
                    <Link to="/settings-providers--wizard" className="flex h-8 items-center gap-1.5 rounded-control border border-border px-3 text-[12px] hover:bg-hover">添加模型 / 提供商</Link>
                    {imported.includes('providers') && <span className="text-[11px] text-success">已导入 2 个</span>}
                  </div>
                  <div className="divide-y divide-line rounded-control border border-line text-[12px]">
                    {[['Anthropic 订阅', 'dev@example.com · Max', '已登录'], ['OpenAI', 'API Key · 4 个模型', '可用'], ['DeepSeek', '自定义端点', '待填 Key']].map(([name, meta, state]) => (
                      <div key={name} className="flex items-center gap-2 px-3 py-2">
                        <span className="min-w-0 flex-1 truncate">{name}<span className="ml-2 text-[11px] text-faint">{meta}</span></span>
                        <span className={`text-[11px] ${state === '待填 Key' ? 'text-warning' : 'text-success'}`}>{state}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {['skills', 'mcp', 'instructions'].includes(step.id) && (
                <div className="space-y-2">
                  <button onClick={() => runImport(step.id)} className="flex h-8 items-center gap-1.5 rounded-control bg-surface-foreground px-3 text-[12px] text-surface">
                    {busy === step.id ? <Spinner className="size-3.5 text-surface" /> : <span className="icon-[lucide--scan-line] size-3.5" />}
                    {busy === step.id ? '正在扫描…' : '扫描并导入'}
                  </button>
                  <div className="divide-y divide-line rounded-control border border-line text-[12px]">
                    {(step.id === 'skills' ? ['frontend-design · 项目内', 'project-knowledge · 全局', 'enso-cdp · 项目内'] : step.id === 'mcp' ? ['browser-tools · stdio', 'github · http', 'figma · http · 未授权'] : ['~/.claude/CLAUDE.md', '~/.codex/AGENTS.md']).map((item) => (
                      <div key={item} className="flex items-center gap-2 px-3 py-2">
                        <span className="icon-[lucide--check] size-3 text-success" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px]">{item}</span>
                      </div>
                    ))}
                  </div>
                  {imported.includes(step.id) && <p className="text-[11px] text-success">已导入 {step.id === 'skills' ? 3 : step.id === 'mcp' ? 3 : 2} 个</p>}
                </div>
              )}
              {step.id === 'preset' && (
                <div className="space-y-2 text-[12px]">
                  <p className="text-muted">已有 1 个预设</p>
                  <div className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="flex-1">前端重构 · 4 个技能 · 2 个 MCP · 1 份指令</span><span className="text-[11px] text-faint">默认</span></div>
                  <Link to="/settings-presets--edit" className="flex h-8 w-fit items-center gap-1.5 rounded-control border border-border px-3 hover:bg-hover"><span className="icon-[lucide--plus] size-3.5" />新建预设</Link>
                </div>
              )}
              {step.id === 'agentType' && (
                <div className="space-y-2 text-[12px]">
                  {[['scout · 只读调研', 'Gemini 2.5 Flash'], ['reviewer · 代码审查', 'Claude Opus 4.1'], ['tester · 写测试', 'GPT-5 Codex'], ['worker · 实现', 'Claude Sonnet 4.5']].map(([name, model]) => (
                    <div key={name} className="flex items-center gap-2 rounded-control border border-line px-3 py-2"><span className="min-w-0 flex-1 truncate">{name}</span><span className="text-[11px] text-faint">{model}</span></div>
                  ))}
                </div>
              )}
              {step.id === 'done' && (
                <div className="flex flex-col items-center gap-2 py-6 text-center">
                  <span className="icon-[lucide--circle-check] size-7 text-success" />
                  <p className="text-[13px]">全部就绪</p>
                  <p className="text-[11px] text-muted">之后随时可在设置里导入更多。</p>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-line px-4 py-3 text-[12px]">
            <span className="text-[11px] text-faint">不确定如何配置？询问 Enso</span>
            <div className="ml-auto flex items-center gap-2">
              {index > 0 && <button onClick={() => setIndex(index - 1)} className="px-2.5 py-1.5 text-muted">上一步</button>}
              {step.id !== 'done' && <Link to="/" className="px-2.5 py-1.5 text-muted">跳过</Link>}
              <button onClick={() => setIndex(Math.min(index + 1, steps.length - 1))} className="rounded-control bg-surface-foreground px-4 py-1.5 text-surface">{index === 0 ? '开始' : step.id === 'done' ? '完成' : '下一步'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 退出确认（App.tsx AlertDialog）：退出会完全关闭应用，手机将无法连接；最小化到托盘可继续连接 */
export function QuitDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog
      title="确认退出"
      description="退出会完全关闭应用，手机将无法再连接。最小化到托盘会在后台继续运行，手机仍可连接。"
      width={440}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="rounded-control border border-border px-3 py-2 text-[12px] hover:bg-hover">取消</button>
          <button onClick={onClose} className="rounded-control bg-surface-foreground px-3 py-2 text-[12px] text-surface">最小化到托盘</button>
          <button onClick={onClose} className="rounded-control bg-danger px-3 py-2 text-[12px] text-white">退出</button>
        </>
      }
    >
      <p className="text-[11px] leading-5 text-muted">勾选过「不再询问」的话，可以从托盘菜单重新打开这个确认。</p>
    </Dialog>
  );
}

/** OAuth 登录（OauthLoginStep）+ 子 Agent 授权（AgentChildOauthHost） */
export function OauthLogin({ child = false }: { child?: boolean }) {
  const [phase, setPhase] = useState<'waiting' | 'manual' | 'error' | 'done'>('waiting');
  const [code, setCode] = useState('');
  return (
    <div className="flex h-full items-center justify-center bg-panel px-6">
      <div className="w-full max-w-[520px] rounded-control border border-border bg-surface p-6">
        <div className="flex items-center gap-2">
          <span className="icon-[lucide--key-round] size-4 text-primary" />
          <h1 className="text-[15px] font-medium">{child ? '子 Agent 请求授权' : '登录 ChatGPT / Claude 订阅'}</h1>
          {child && <span className="rounded-[4px] bg-control px-1.5 text-[10px] text-muted">由 scout 发起</span>}
        </div>
        <p className="mt-1.5 text-[12px] leading-5 text-muted">{child ? '子 Agent 需要访问订阅模型才能继续。授权只作用于这一个成员，主会话与密钥仍留在主进程。' : '浏览器会打开授权页；完成后回到这里，凭据只保存在主进程。'}</p>
        <ol className="mt-4 space-y-2 text-[12px]">
          {['在浏览器里登录并同意授权', '复制回调地址或授权码', '粘贴回下方输入框完成绑定'].map((line, index) => (
            <li key={line} className="flex items-start gap-2">
              <span className={`mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full text-[10px] ${index === 0 && phase === 'waiting' ? 'bg-primary text-primary-foreground' : 'bg-control text-muted'}`}>{index + 1}</span>
              <span className={index === 0 && phase === 'waiting' ? '' : 'text-muted'}>{line}</span>
            </li>
          ))}
        </ol>
        {phase === 'waiting' && (
          <div className="mt-4 flex items-center gap-2 rounded-control border border-line bg-panel/50 px-3 py-2 text-[12px] text-muted">
            <Spinner />
            已打开浏览器，等待授权回调…
            <button onClick={() => setPhase('manual')} className="ml-auto text-[11px] text-primary">手动回填</button>
            <button onClick={() => setPhase('error')} className="text-[11px] text-muted">模拟失败</button>
          </div>
        )}
        {phase === 'manual' && (
          <div className="mt-4">
            <label className="text-[11px] text-muted">回调地址 / 授权码</label>
            <div className="mt-1 flex gap-2">
              <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="http://localhost:1455/auth/callback?code=…" className="h-8 min-w-0 flex-1 rounded-control border border-border bg-input px-2 font-mono text-[11.5px] outline-none" />
              <button disabled={!code.trim()} onClick={() => setPhase('done')} className="rounded-control bg-surface-foreground px-3 text-[12px] text-surface disabled:opacity-50">完成</button>
            </div>
          </div>
        )}
        {phase === 'error' && (
          <div className="mt-4 rounded-control border border-danger/30 bg-danger-soft px-3 py-2 text-[12px] leading-5 text-danger">
            授权失败：回调超时（5 分钟）。可以重试，或改用 API Key。
            <div className="mt-1.5 flex gap-2"><button onClick={() => setPhase('waiting')} className="rounded-control bg-danger px-2.5 py-1 text-[11px] text-white">重试</button><Link to="/settings-providers--edit" className="rounded-control border border-danger/40 px-2.5 py-1 text-[11px]">改用 API Key</Link></div>
          </div>
        )}
        {phase === 'done' && (
          <div className="mt-4 flex items-center gap-2 rounded-control border border-success/40 bg-success-soft px-3 py-2 text-[12px] text-success">
            <span className="icon-[lucide--circle-check] size-3.5" />
            已登录 dev@example.com · Max · 3 个模型可用
            <Link to="/" className="ml-auto text-[11px]">返回会话</Link>
          </div>
        )}
      </div>
    </div>
  );
}
