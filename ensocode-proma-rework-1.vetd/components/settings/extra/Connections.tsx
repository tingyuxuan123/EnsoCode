import { useEffect, useState } from 'react';
import { DangerConfirm, Dialog, Empty, Segmented, Spinner, Switch, inputClass } from '../../Controls';
import { Overlay } from '../../Workbench';
import { Badge, InlineNotice, SettingsHeader, SettingsRow, SettingsSection, outlineButton, primaryButton } from '../SettingsUI';

/** 用 div 画的示意二维码（真实二维码由主进程生成） */
function QrPlaceholder() {
  const cells = Array.from({ length: 21 * 21 }, (_, i) => {
    const x = i % 21;
    const y = Math.floor(i / 21);
    const finder = (x < 7 && y < 7) || (x > 13 && y < 7) || (x < 7 && y > 13);
    if (finder) {
      const fx = x > 13 ? x - 14 : x;
      const fy = y > 13 ? y - 14 : y;
      return fx === 0 || fx === 6 || fy === 0 || fy === 6 || (fx > 1 && fx < 5 && fy > 1 && fy < 5);
    }
    return (x * 7 + y * 13 + x * y) % 3 === 0;
  });
  return (
    <div className="grid size-[148px] shrink-0 grid-cols-[repeat(21,1fr)] rounded-control border border-line bg-white p-2" role="img" aria-label="配对二维码">
      {cells.map((on, i) => <span key={i} className={on ? 'bg-surface-foreground' : ''} />)}
    </div>
  );
}

const devicesSeed = [
  { id: 'd1', name: 'iPhone 16 Pro', kind: 'phone', route: '直连', state: 'online', readOnly: false },
  { id: 'd2', name: '工作室 Mac mini', kind: 'desktop', route: '中继', state: 'waiting', readOnly: true },
  { id: 'd3', name: 'iPad Air', kind: 'phone', route: '中继', state: 'offline', readOnly: false },
];
const nodesSeed = [
  { id: 'n1', name: '工作室 Mac mini', state: 'online' },
  { id: 'n2', name: '家里的 iMac', state: 'offline' },
];

/** DevicesSettings：允许连入 / 配对码 / 已配对设备 / 连接到节点 / 中继服务器 */
export function DevicesPage({ insecure = false }: { insecure?: boolean }) {
  const [allow, setAllow] = useState(true);
  const [code, setCode] = useState<'none' | 'active' | 'expired'>('none');
  const [left, setLeft] = useState(60);
  const [copied, setCopied] = useState(false);
  const [devices, setDevices] = useState(devicesSeed);
  const [renaming, setRenaming] = useState('');
  const [revoke, setRevoke] = useState('');
  const [pairNode, setPairNode] = useState(false);
  const [relay, setRelay] = useState('wss://relay.enso.dev');
  useEffect(() => {
    if (code !== 'active') return;
    if (left <= 0) { setCode('expired'); return; }
    const timer = window.setTimeout(() => setLeft(left - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [code, left]);
  const stateLabel = { online: ['在线', 'bg-success'], waiting: ['等待设备', 'bg-warning'], offline: ['离线', 'bg-faint'] } as const;
  return (
    <>
      <SettingsHeader title="设备" description="让手机或另一台 EnsoCode 桌面连到这台电脑。需保持本应用运行。" />
      {insecure && <InlineNotice tone="warning">当前系统不支持安全存储，配对密钥将以未加密方式保存。</InlineNotice>}
      <SettingsSection>
        <SettingsRow label="允许连入" description="关闭后已配对设备暂时无法连接，配对关系保留。"><Switch label="允许连入" checked={allow} onChange={setAllow} /></SettingsRow>
        {allow && (
          code === 'none' ? (
            <button onClick={() => { setCode('active'); setLeft(60); }} className={`${primaryButton} mt-1`}><span className="icon-[lucide--qr-code] size-3.5" />生成配对码</button>
          ) : (
            <div className="mt-2 flex gap-5 rounded-control border border-line p-4">
              <div className={code === 'expired' ? 'opacity-25' : ''}><QrPlaceholder /></div>
              <div className="min-w-0 flex-1 text-[12px] leading-5">
                <p className="text-[13px] font-medium">用手机相机扫码</p>
                <p className="text-muted">扫码即可打开并完成配对。想常用的话，打开后添加到主屏幕。</p>
                <p className="mt-3 text-muted">在另一台 EnsoCode 桌面，把下方链接粘到「设置 → 设备 → 连接到节点」。</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-[4px] bg-code px-2 py-1 font-mono text-[11px]">enso://pair?c=7HQK-2M9X&amp;h=192.168.1.24</code>
                  <button disabled={code === 'expired'} onClick={() => setCopied(true)} className={`${outlineButton} h-7`}>{copied ? '已复制' : '复制'}</button>
                </div>
                <p className={`mt-3 ${code === 'expired' ? 'text-danger' : 'text-muted'}`}>{code === 'expired' ? '配对码已失效' : `${left} 秒后失效 · 仅可用一次`}</p>
                <div className="mt-2 flex gap-2">
                  {code === 'expired' ? <button onClick={() => { setCode('active'); setLeft(60); setCopied(false); }} className={`${primaryButton} h-7`}>生成配对码</button> : <button onClick={() => setCode('none')} className={`${outlineButton} h-7`}>取消配对</button>}
                </div>
              </div>
            </div>
          )
        )}
      </SettingsSection>
      <SettingsSection title="已配对设备">
        {devices.length ? (
          <div className="divide-y divide-line rounded-control border border-line">
            {devices.map((d) => (
              <div key={d.id} className="flex items-center gap-3 px-3 py-2.5">
                <span className={`${d.kind === 'phone' ? 'icon-[lucide--smartphone]' : 'icon-[lucide--monitor]'} size-4 shrink-0 text-muted`} />
                <div className="min-w-0 flex-1">
                  {renaming === d.id ? (
                    <input autoFocus defaultValue={d.name} onBlur={(e) => { setDevices(devices.map((x) => x.id === d.id ? { ...x, name: e.target.value || x.name } : x)); setRenaming(''); }} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} aria-label="重命名" className={`${inputClass} h-7`} />
                  ) : <p className="text-[13px] font-medium">{d.name}</p>}
                  <p className="mt-0.5 flex items-center gap-1.5 text-[12px] text-muted"><span className={`size-1.5 rounded-full ${stateLabel[d.state as keyof typeof stateLabel][1]}`} />{stateLabel[d.state as keyof typeof stateLabel][0]} · {d.route}</p>
                </div>
                <button title="点击切换：只读设备不能发送、审批或停止。" onClick={() => setDevices(devices.map((x) => x.id === d.id ? { ...x, readOnly: !x.readOnly } : x))}><Badge tone={d.readOnly ? 'neutral' : 'primary'}>{d.readOnly ? '只读' : '可操作'}</Badge></button>
                <button onClick={() => setRenaming(d.id)} className="text-[12px] text-muted hover:text-surface-foreground">重命名</button>
                <button onClick={() => setRevoke(d.id)} className="text-[12px] text-muted hover:text-danger">取消配对</button>
              </div>
            ))}
          </div>
        ) : <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--smartphone]" title="暂无已配对设备" description="生成配对码，让手机或另一台桌面连入。" /></div>}
      </SettingsSection>
      <SettingsSection title="连接到节点" description="浏览并操控另一台 EnsoCode 桌面上的会话。agent、密钥与历史都留在对方机器上。" actions={<button onClick={() => setPairNode(true)} className={outlineButton}><span className="icon-[lucide--link] size-3.5" />连接到节点</button>}>
        <p className="mb-2 text-[12px] font-medium">已连接的节点</p>
        <div className="divide-y divide-line rounded-control border border-line">
          {nodesSeed.map((n) => (
            <div key={n.id} className="flex items-center gap-3 px-3 py-2.5 text-[13px]">
              <span className="icon-[lucide--monitor] size-4 text-muted" />
              <span className="flex-1 font-medium">{n.name}</span>
              <span className="flex items-center gap-1.5 text-[12px] text-muted"><span className={`size-1.5 rounded-full ${n.state === 'online' ? 'bg-success' : 'bg-faint'}`} />{n.state === 'online' ? '在线' : '对方桌面离线'}</span>
              <button className="text-[12px] text-muted hover:text-surface-foreground">重命名</button>
              <button className="text-[12px] text-muted hover:text-danger">断开</button>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-muted">每台要连入的电脑都需要对方桌面单独生成一个配对码。</p>
      </SettingsSection>
      <SettingsSection title="中继服务器" description="中继只转发密文，无法读取你的消息内容。">
        <div className="flex gap-2"><input value={relay} onChange={(e) => setRelay(e.target.value)} aria-label="中继服务器" className={`${inputClass} font-mono`} /><button className={outlineButton}>保存</button></div>
      </SettingsSection>
      {pairNode && (
        <Overlay>
          <Dialog title="连接到节点" description="在对方电脑打开「设置 → 设备」，生成配对码并复制链接，粘到这里。" width={480} onClose={() => setPairNode(false)} footer={<><button onClick={() => setPairNode(false)} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setPairNode(false)} className={primaryButton}>连接</button></>}>
            <input autoFocus placeholder="enso://pair?c=…" aria-label="配对链接" className={`${inputClass} font-mono`} />
          </Dialog>
        </Overlay>
      )}
      {revoke && <Overlay><DangerConfirm title="取消配对？" description={`「${devices.find((d) => d.id === revoke)?.name}」将无法再连接，需要重新扫码配对。`} confirmLabel="取消配对" requireCheck={false} onClose={() => setRevoke('')} onConfirm={() => { setDevices(devices.filter((d) => d.id !== revoke)); setRevoke(''); }} /></Overlay>}
    </>
  );
}

const sshSeed = [
  { id: 'h1', name: '生产服务器', host: 'deploy@10.0.3.12', port: 22, auth: '密钥 / agent' },
  { id: 'h2', name: '开发服务器', host: 'dev.internal', port: 2222, auth: '密码' },
];

/** SshEditDialog：名称、主机、用户、端口、认证方式、密码（留空保持）；测试结果 */
export function SshDialog({ editing, onClose }: { editing?: string; onClose: () => void }) {
  const target = sshSeed.find((s) => s.id === editing);
  const [auth, setAuth] = useState<'password' | 'key'>(target?.auth === '密码' ? 'password' : 'key');
  const [test, setTest] = useState<'' | 'running' | 'ok' | 'fail'>('');
  const [name, setName] = useState(target?.name ?? '');
  const [host, setHost] = useState(target ? 'dev.internal' : '');
  const [error, setError] = useState('');
  const run = () => { setTest('running'); window.setTimeout(() => setTest(host.includes('dev') ? 'ok' : 'fail'), 900); };
  return (
    <Overlay>
      <Dialog title={target ? '编辑 SSH 连接' : '添加 SSH 连接'} width={500} onClose={onClose} footer={<><button onClick={run} disabled={!host || test === 'running'} className={`${outlineButton} mr-auto`}>{test === 'running' ? <Spinner /> : null}测试</button><button onClick={onClose} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => (!name.trim() || !host.trim() ? setError('请填写名称和主机。') : onClose())} className={primaryButton}>保存</button></>}>
        {error && <p role="alert" className="mb-3 rounded-control bg-danger-soft px-3 py-2 text-[12px] text-danger">{error}</p>}
        <label className="block text-[12px] font-medium">名称<input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-1.5 font-normal`} /></label>
        <div className="mt-3 grid grid-cols-[1fr_110px] gap-3">
          <label className="text-[12px] font-medium">主机<input value={host} onChange={(e) => setHost(e.target.value)} placeholder="example.com" className={`${inputClass} mt-1.5 font-mono font-normal`} /></label>
          <label className="text-[12px] font-medium">端口(可选)<input placeholder="22" defaultValue={target?.port} className={`${inputClass} mt-1.5 font-normal`} /></label>
        </div>
        <label className="mt-3 block text-[12px] font-medium">用户(可选)<input defaultValue={target ? 'dev' : ''} className={`${inputClass} mt-1.5 font-normal`} /></label>
        <div className="mt-3 text-[12px] font-medium">认证方式</div>
        <div className="mt-1.5"><Segmented label="认证方式" value={auth} onChange={setAuth} options={[{ value: 'password', label: '密码' }, { value: 'key', label: '密钥 / agent' }]} /></div>
        {auth === 'password' && <label className="mt-3 block text-[12px] font-medium">{target ? '密码(留空则保持原密码)' : '密码'}<input type="password" className={`${inputClass} mt-1.5 font-normal`} /></label>}
        {test === 'ok' && <p className="mt-3 flex items-center gap-1.5 text-[12px] text-success"><span className="icon-[lucide--circle-check] size-3.5" />SSH 连接成功</p>}
        {test === 'fail' && <p className="mt-3 rounded-control bg-danger-soft px-3 py-2 font-mono text-[11px] text-danger">connect ETIMEDOUT {host || '10.0.3.12'}:22</p>}
      </Dialog>
    </Overlay>
  );
}

/** SshSettings：连接列表 / 添加编辑 / 测试 / 主机指纹信任 / SSH 超时 / 删除 */
export function SshPage({ dialog = '', empty = false }: { dialog?: '' | 'edit' | 'hostkey'; empty?: boolean }) {
  const [list, setList] = useState(empty ? [] : sshSeed);
  const [editing, setEditing] = useState(dialog === 'edit' ? 'h2' : '');
  const [hostKey, setHostKey] = useState(dialog === 'hostkey');
  const [remove, setRemove] = useState('');
  const [testing, setTesting] = useState('');
  return (
    <>
      <SettingsHeader title="SSH" description="远程项目用的主机。密码保存在系统钥匙串。" actions={<button onClick={() => setEditing('new')} className={primaryButton}><span className="icon-[lucide--plus] size-3.5" />添加连接</button>} />
      <InlineNotice>文件面板和终端立即使用新配置；已打开会话里的代理仍使用原来的连接配置。</InlineNotice>
      {list.length ? (
        <div className="divide-y divide-line rounded-control border border-line">
          {list.map((s) => (
            <div key={s.id} className="group flex items-center gap-3 px-3 py-2.5">
              <span className="icon-[lucide--server] size-4 shrink-0 text-muted" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[13px] font-medium">{s.name}<Badge>{s.auth}</Badge></p>
                <p className="font-mono text-[11px] text-muted">{s.host}:{s.port}</p>
              </div>
              <button onClick={() => { setTesting(s.id); window.setTimeout(() => { setTesting(''); if (s.id === 'h1') setHostKey(true); }, 800); }} className="text-[12px] text-muted hover:text-surface-foreground">{testing === s.id ? <Spinner /> : '测试'}</button>
              <button onClick={() => setEditing(s.id)} aria-label="编辑" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover group-hover:opacity-100"><span className="icon-[lucide--pencil] size-3.5" /></button>
              <button onClick={() => setRemove(s.id)} aria-label="删除" className="flex size-7 items-center justify-center rounded-control text-muted opacity-0 hover:bg-hover hover:text-danger group-hover:opacity-100"><span className="icon-[lucide--trash-2] size-3.5" /></button>
            </div>
          ))}
        </div>
      ) : <div className="rounded-control border border-dashed border-border"><Empty icon="icon-[lucide--server]" title="还没有 SSH 连接" action={<button onClick={() => setEditing('new')} className={outlineButton}>添加连接</button>} /></div>}
      <SettingsSection title=" ">
        <SettingsRow label="SSH 超时" description="连接测试、读取远端 AGENTS.md、浏览远程目录和文件面板操作的超时时间。不影响 Agent 工具执行的命令。">
          <input type="number" defaultValue={15} aria-label="SSH 超时" className={`${inputClass} w-20`} />
          <span className="text-[12px] text-muted">秒</span>
        </SettingsRow>
      </SettingsSection>
      {editing && <SshDialog editing={editing === 'new' ? undefined : editing} onClose={() => setEditing('')} />}
      {hostKey && (
        <Overlay>
          <Dialog title="未知 SSH 主机" description="信任此主机并把密钥写入 known_hosts？" width={480} onClose={() => setHostKey(false)} footer={<><button onClick={() => setHostKey(false)} className="px-3 py-2 text-[12px] text-muted">取消</button><button onClick={() => setHostKey(false)} className={primaryButton}>信任</button></>}>
            <dl className="grid grid-cols-[64px_1fr] gap-y-1.5 text-[12px]">
              <dt className="text-muted">主机</dt><dd className="font-mono">10.0.3.12:22</dd>
              <dt className="text-muted">类型</dt><dd className="font-mono">ssh-ed25519</dd>
              <dt className="text-muted">指纹</dt><dd className="break-all font-mono">SHA256:Xo3m1vYQ8k7kM2bL9fE4yTqZp0aWcR5sN6uH1dJgVtA</dd>
            </dl>
            <p className="mt-3 text-[12px] text-muted">请与服务器管理员核对指纹；不一致时不要信任。</p>
          </Dialog>
        </Overlay>
      )}
      {remove && <Overlay><DangerConfirm title="删除 SSH 连接？" description={`「${list.find((s) => s.id === remove)?.name}」及其钥匙串密码将被删除；使用它的远程项目需要重新选择连接。`} confirmLabel="删除" requireCheck={false} onClose={() => setRemove('')} onConfirm={() => { setList(list.filter((s) => s.id !== remove)); setRemove(''); }} /></Overlay>}
    </>
  );
}
