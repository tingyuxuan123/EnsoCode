import { useState } from 'react';
import { Dialog } from '../../Controls';
import { Badge, InlineNotice, ListRow, SettingsHeader, SettingsList, SettingsRow, SettingsSection, outlineButton, primaryButton } from '../SettingsUI';
import { SwitchLine } from '../core/shared';

/**
 * 配置迁移（ConfigSyncSettings + LocalImportDialog 的导入/导出流程）：
 * 导出加密配置包（≤8 位密码、两次一致、OAuth 不迁移）、导入前预览（Merge / Replace、信任确认、自动备份）。
 * 真实位置在「通用」页底部；这里作为独立一帧展开，便于核对这些状态。
 */
export function ConfigSyncPage() {
  const [dialog, setDialog] = useState<'' | 'export' | 'import' | 'preview' | 'password-error'>('export');
  const [encrypted, setEncrypted] = useState(true);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  return (
    <>
      <SettingsHeader title="通用" description="应用通用设置。" />
      <SettingsSection title="配置迁移" description="在设备之间迁移模型、预设、子代理类型、技能、MCP 服务和指令文件。">
        <SettingsRow label="可移植 Enso 配置" description="导出配置包，或在导入前预览配置包。OAuth 登录态不会迁移。">
          <button onClick={() => setDialog('import')} className={outlineButton}><span className="icon-[lucide--download] size-3.5" />导入配置</button>
          <button onClick={() => setDialog('export')} className={outlineButton}><span className="icon-[lucide--upload] size-3.5" />导出配置</button>
        </SettingsRow>
        <InlineNotice tone="warning">技能和指令文件内容可能包含私密信息，因此包含这些文件的配置只能使用加密导出。</InlineNotice>
        <SettingsList>
          <ListRow icon={<span className="icon-[lucide--server] size-4 text-muted" />} title="模型服务与账号" meta="API Key、MCP 参数与环境变量、MCP 地址里的凭据都会被省略" ><Badge>已排除</Badge></ListRow>
          <ListRow icon={<span className="icon-[lucide--key-round] size-4 text-muted" />} title="OAuth 登录态" meta="需要在目标设备重新登录" ><Badge tone="warning">不迁移</Badge></ListRow>
          <ListRow icon={<span className="icon-[lucide--sparkles] size-4 text-muted" />} title="技能与指令文件" meta="2 个技能 · 1 份指令 · 需要加密导出"><Badge tone="primary">需加密</Badge></ListRow>
        </SettingsList>
      </SettingsSection>
      <SettingsSection title="本地导入">
        <SettingsRow label="从本地 AI 应用导入" description="扫描 Claude Code、Codex、Cursor 里的模型服务、技能、MCP 与指令文件；重复项会给出候选。">
          <button className={outlineButton}><span className="icon-[lucide--scan-line] size-3.5" />扫描</button>
        </SettingsRow>
        <div className="rounded-control border border-line">
          <div className="flex h-8 items-center gap-2 border-b border-line px-2.5 text-[11px] text-muted">扫描结果 <span className="ml-auto">已选 3 / 9</span></div>
          {[['Claude Code · 技能', '6 个，其中 2 个同名'], ['Codex · MCP 服务器', '3 个，1 个缺凭证'], ['Cursor · 指令文件', '1 个 .cursorrules']].map(([name, meta]) => (
            <label key={name} className="flex items-center gap-2 border-b border-line px-2.5 py-1.5 text-[12px] last:border-b-0">
              <input type="checkbox" defaultChecked />
              <span className="font-medium">{name}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-muted">{meta}</span>
              <button className="text-[11px] text-primary">查看</button>
            </label>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="更新">
        <SwitchLine label="启动时检查更新" description="发现新版本会在标题栏下方提示，不会自动重启。" checked onChange={() => undefined} />
      </SettingsSection>
      {dialog === 'export' && (
        <Dialog
          title="导出配置"
          description="创建可在另一台设备使用的 .enso-config 配置包。"
          width={520}
          onClose={() => setDialog('')}
          footer={<><button onClick={() => setDialog('')} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setDialog('')} className={primaryButton}>导出</button></>}
        >
          <SwitchLine label="加密配置包" description="使用密码加密整个配置包。OAuth 登录态仍不会包含在内。" checked={encrypted} onChange={setEncrypted} />
          {encrypted && (
            <div className="mt-2 grid grid-cols-2 gap-3">
              <label className="text-[12px] text-muted">加密密码<input type="password" defaultValue="12345678" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none" /><span className="mt-1 block text-[11px] text-muted">请使用至少 8 个字符。此密码无法恢复。</span></label>
              <label className="text-[12px] text-muted">确认密码<input type="password" defaultValue="12345678" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] text-surface-foreground outline-none" /><span className="mt-1 block text-[11px] text-muted">两次输入需要一致。</span></label>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-5 text-muted">以下指令的源文件已丢失或无法读取，未包含在配置包中：~/.claude/CLAUDE.md</p>
        </Dialog>
      )}
      {dialog === 'password-error' && (
        <Dialog title="导出配置" description="创建可在另一台设备使用的 .enso-config 配置包。" width={520} onClose={() => setDialog('')} footer={<><button onClick={() => setDialog('')} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setDialog('')} className={primaryButton}>导出</button></>}>
          <label className="text-[12px] text-muted">加密密码<input type="password" defaultValue="1234" className="mt-1 h-9 w-full rounded-control border border-danger/60 bg-input px-2.5 text-[13px] outline-none" /><span className="mt-1 block text-[11px] text-danger">密码至少需要 8 个字符。</span></label>
          <label className="mt-2 block text-[12px] text-muted">确认密码<input type="password" defaultValue="12345" className="mt-1 h-9 w-full rounded-control border border-danger/60 bg-input px-2.5 text-[13px] outline-none" /><span className="mt-1 block text-[11px] text-danger">两次输入的密码不一致。</span></label>
        </Dialog>
      )}
      {dialog === 'import' && (
        <Dialog title="导入配置" description="修改此设备前，请先预览 enso-config-2026-10-27.enso-config。" width={560} onClose={() => setDialog('')} footer={<><button onClick={() => setDialog('')} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setDialog('preview')} className={primaryButton}>继续</button></>}>
          <div className="flex h-8 items-center gap-2 rounded-control border border-border bg-input px-2.5 font-mono text-[11.5px]">enso-config-2026-10-27.enso-config <span className="ml-auto text-muted">182 KB</span></div>
          <label className="mt-3 block text-[12px] text-muted">解密密码<input type="password" placeholder="配置包使用了密码加密" className="mt-1 h-9 w-full rounded-control border border-border bg-input px-2.5 text-[13px] outline-none" /></label>
        </Dialog>
      )}
      {dialog === 'preview' && (
        <Dialog title="导入预览" description="选择合并或替换；导入前会自动备份当前配置。" width={600} onClose={() => setDialog('')} footer={<><button onClick={() => setDialog('')} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setDialog('')} className={primaryButton}>导入</button></>}>
          <div className="mb-3 flex h-8 items-center rounded-control bg-control/50 p-[3px] text-[12px]">
            <button onClick={() => setMode('merge')} className={`h-full flex-1 rounded-[4px] ${mode === 'merge' ? 'bg-surface font-medium' : 'text-muted'}`}>合并（保留本机额外项）</button>
            <button onClick={() => setMode('replace')} className={`h-full flex-1 rounded-[4px] ${mode === 'replace' ? 'bg-surface font-medium' : 'text-muted'}`}>替换（以配置包为准）</button>
          </div>
          <div className="divide-y divide-line rounded-control border border-line text-[12px]">
            {[['模型服务', '新增 2 · 覆盖 1'], ['预设', '新增 1'], ['技能', '新增 2 · 同名 1'], ['MCP 服务器', '新增 1 · 缺凭证 1'], ['指令文件', '新增 1'], ['子代理类型', '无变化']].map(([name, delta]) => (
              <div key={name} className="flex items-center gap-2 px-3 py-1.5"><span className="w-24 shrink-0">{name}</span><span className="min-w-0 flex-1 truncate text-muted">{delta}</span></div>
            ))}
          </div>
          <div className="mt-3 rounded-control border border-warning/40 bg-warning-soft px-3 py-2 text-[11.5px] leading-5">
            配置来自你选择的文件。导入会写入模型地址与 MCP 命令，请确认来源可信；OAuth 登录态不会迁移。
          </div>
        </Dialog>
      )}
    </>
  );
}
