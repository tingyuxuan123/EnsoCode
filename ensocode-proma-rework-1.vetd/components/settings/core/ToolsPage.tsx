import { useState } from 'react';
import { Link } from 'react-router';
import { Badge, InlineNotice, ListRow, SettingsHeader, SettingsList, SettingsRow, SettingsSection, outlineButton, primaryButton, selectClass } from '../SettingsUI';
import { Segmented } from '../../Controls';
import { NewSessionBadge, SwitchLine } from './shared';

type Tool = { id: string; name: string; desc: string; on: boolean; extra?: string };
const initial: Tool[] = [
  { id: 'subagent', name: 'Subagent', desc: '统一 agents：派发一次性任务，或在 Main 控制下保留持久协作者', on: true },
  { id: 'workflow', name: 'Workflow', desc: '运行 JS 工作流把工作分给子代理，实时状态显示在侧栏', on: true },
  { id: 'todo', name: 'Todo', desc: '任务清单：跟踪多步工作的进度', on: true },
  { id: 'plan', name: 'Plan mode', desc: '只读调研，提交计划待批准后再执行', on: true },
  { id: 'ask_user', name: 'Ask user', desc: '向用户提问并等待回答（选项 / 超时）', on: true },
  { id: 'browser', name: 'Browser', desc: '内置浏览器：在 Enso 自己的 Chromium 里打开页面、读快照、按 ref 点击输入', on: true },
  { id: 'web', name: 'Web search', desc: '联网搜索与抓取：用会话模型的原生搜索，失败回退免 key 服务', on: true },
  { id: 'code_search', name: 'Code search', desc: '用已有的 Devin 订阅搜索工作区代码。默认关闭。', on: false },
  { id: 'background_tasks', name: 'Background tasks', desc: '后台 shell 任务：跑长命令，完成时通知', on: true },
  { id: 'memory', name: 'Memory', desc: '长期记忆：跨会话检索与写入决策、偏好与经验', on: false, extra: '依赖 embedding 模型，默认关闭' },
  { id: 'isolated_sandbox', name: 'Isolated sandbox', desc: '在隔离沙箱里跑 JS 并调用会话工具，只把返回值带回对话', on: true },
  { id: 'computer', name: 'Computer', desc: '宿主桌面：列窗口、截图、无障碍树与输入。默认关闭。', on: false, extra: '需要屏幕录制与辅助功能授权' },
];

/** 内置工具（BuiltinToolsSettings + CodeSearchSettings + 电脑操控权限引导 + 浏览器数据） */
export function ToolsPage() {
  const [tools, setTools] = useState(initial);
  const [fileMode, setFileMode] = useState('apply_patch');
  const [foldAfterExplore, setFold] = useState(true);
  const [rtk, setRtk] = useState(true);
  const [protectedAsk, setProtectedAsk] = useState(true);
  const [webChain, setWebChain] = useState(['当前会话模型原生搜索', 'Exa（免 key）']);
  const [showPerm, setShowPerm] = useState(false);
  const on = tools.filter((tool) => tool.on).length;
  return (
    <>
      <SettingsHeader title="内置工具" description="开关 agent 可用的内置工具。" actions={<span className="text-[11px] text-muted">已启用 {on}/{tools.length}</span>} />
      <InlineNotice>开启工具只对新会话生效；关闭记忆或电脑操控会同时在已打开的会话中拦截。<NewSessionBadge /></InlineNotice>
      <SettingsSection title="工具" description="关闭后不下发给会话，模型看不到这份工具。">
        <SettingsList>
          {tools.map((tool) => (
            <ListRow
              key={tool.id}
              icon={<span className={`${tool.on ? 'icon-[lucide--wrench] text-primary' : 'icon-[lucide--wrench] text-faint'} size-4`} />}
              title={<><span className="font-medium">{tool.name}</span>{!tool.on && <Badge tone="warning">默认关闭</Badge>}</>}
              meta={<>{tool.desc}{tool.extra && <span className="ml-1 text-warning">{tool.extra}</span>}</>}
            >
              <button onClick={() => setTools(tools.map((item) => item.id === tool.id ? { ...item, on: !item.on } : item))} aria-pressed={tool.on} className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] ${tool.on ? 'justify-end bg-primary' : 'justify-start bg-border'}`}><span className="size-3 rounded-full bg-white" /></button>
            </ListRow>
          ))}
        </SettingsList>
      </SettingsSection>

      <SettingsSection title="联网搜索" description="按顺序尝试这些模型的原生搜索。凭证在调用时现取；全部失败时由免 key 的 Exa 服务永久兜底。">
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-[12px]">
          {webChain.map((item, index) => (
            <span key={item} className="flex items-center gap-1 rounded-control border border-line bg-panel/50 px-2 py-1">
              <span className="text-faint">{index + 1}</span>
              {item}
              {index > 0 && <button onClick={() => setWebChain(webChain.filter((entry) => entry !== item))} aria-label={`移除 ${item}`}><span className="icon-[lucide--x] size-3 text-muted" /></button>}
            </span>
          ))}
          <button onClick={() => setWebChain([...webChain, 'GPT-5 原生搜索'])} className="flex items-center gap-1 rounded-control px-2 py-1 text-primary"><span className="icon-[lucide--plus] size-3" />添加候选</button>
        </div>
        <p className="text-[11px] text-muted">最终兜底：Exa（免 key 托管搜索）。不是链条目，永远在最后。</p>
      </SettingsSection>

      <SettingsSection title="代码搜索" description="用 Devin 订阅检索工作区代码；查询与选中的代码片段会发到云端，需要在本机显式授权。">
        <div className="flex items-center gap-2 text-[12px]">
          <Badge tone="warning">未授权</Badge>
          <span className="text-muted">账号 dev@example.com</span>
          <button className={`${outlineButton} ml-auto`}>授权账号</button>
          <button className={outlineButton}>依赖准备</button>
        </div>
        <p className="mt-1.5 text-[11px] text-muted">资源准备失败时工具会退回本地 grep，并在时间线提示原因。</p>
      </SettingsSection>

      <SettingsSection title="电脑操控" description="Agent 可以截取窗口并控制键鼠。需要把屏幕录制和辅助功能授权给 EnsoCode，然后重启；只有新会话会拿到这个工具。">
        <SettingsRow label="权限状态" description={showPerm ? '屏幕录制：已授权 · 辅助功能：未授权' : '当前系统还不能操作桌面。'}>
          <button className={outlineButton} onClick={() => setShowPerm(!showPerm)}>打开权限引导</button>
        </SettingsRow>
        {showPerm && (
          <div className="mb-2 rounded-control border border-line bg-panel/50 px-3 py-2 text-[12px] leading-6">
            <p className="font-medium">需要两项系统权限</p>
            <ol className="mt-1 list-decimal pl-4 text-muted">
              <li>屏幕录制：用于截取窗口画面</li>
              <li>辅助功能：用于读取无障碍树与点击</li>
            </ol>
            <div className="mt-1.5 flex gap-2"><button className={outlineButton}>打开屏幕录制设置</button><button className={outlineButton}>打开辅助功能设置</button></div>
            <p className="mt-1 text-[11px] text-faint">授权后重启应用；已完成授权时显示「电脑操控已就绪。开一个新会话即可使用。」</p>
          </div>
        )}
      </SettingsSection>

      <SettingsSection title="工作方式">
        <div className="mb-2 grid grid-cols-[160px_1fr] items-center gap-3 text-[12px]">
          <span className="text-muted">文件编辑模式</span>
          <Segmented label="文件编辑模式" value={fileMode} onChange={setFileMode} options={[{ value: 'apply_patch', label: '应用补丁（默认）' }, { value: 'replace', label: '文本替换' }]} />
        </div>
        <p className="mb-2 text-[11px] text-muted">新建和冷恢复的会话使用此模式；已在内存中的会话保持原模式。</p>
        <SwitchLine label="探后折叠" description="让模型在探仓库前打点，探完只把报告留在后续模型上下文里；时间线仍完整。" checked={foldAfterExplore} onChange={setFold} />
        <SwitchLine label="RTK 命令压缩" description="在受支持的命令输出进入模型上下文前进行压缩。新会话生效。" checked={rtk} onChange={setRtk} />
        <SwitchLine label="受保护操作确认" description="即使完全放行，对外发送、删除、付款、部署和访问密钥文件前也要求确认。非完全放行的 Bot 成员始终开启。" checked={protectedAsk} onChange={setProtectedAsk} />
      </SettingsSection>

      <SettingsSection title="内置浏览器数据" description="内嵌浏览器的 Cookie 与站点存储，与应用本身隔离。">
        <div className="flex items-center gap-2 text-[12px]">
          <button className={outlineButton}>清除 Cookie</button>
          <button className={outlineButton}>清除缓存</button>
          <button className={outlineButton}>清除全部浏览数据</button>
          <span className="text-[11px] text-success">已清除 2 分钟前</span>
        </div>
      </SettingsSection>
      <p className="text-[11px] text-muted">关掉「记忆」或「工作流」时，设置里对应的分页会隐藏；重新打开它们的开关在 <Link to="/settings-tools" className="text-primary">本页工具列表</Link>，不会造成死锁。</p>
    </>
  );
}
