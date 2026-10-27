export const frame = { width: 1440, height: 900, title: "外观设置" };

import { useState } from 'react';
import { Link } from 'react-router';
import { useWorkbench } from '../components/Workbench';

export default function SettingsScreen() {
  const { dark, setDark, compact, setCompact, inspectorOpen, setInspectorOpen } = useWorkbench();
  const [fontSize, setFontSize] = useState(15);
  const [wrap, setWrap] = useState(true);
  const [process, setProcess] = useState(false);
  const [theme, setTheme] = useState('浅色');
  const [saved, setSaved] = useState(false);
  const toggles = [
    { title: '收起项目导航', description: '保留左侧图标栏，为会话释放更多空间。', value: compact, set: setCompact },
    { title: '显示工作区面板', description: '在对话右侧显示文件、改动和终端。', value: inspectorOpen, set: setInspectorOpen },
    { title: '代码自动换行', description: '长代码行跟随内容宽度换行。', value: wrap, set: setWrap },
    { title: '展开执行过程', description: '默认显示工具调用和中间执行信息。', value: process, set: setProcess },
  ];
  return (
    <div className="h-full overflow-y-auto px-12 py-8">
      <div className="mx-auto max-w-[900px]">
        <h1 className="text-[24px] font-semibold">外观</h1>
        <p className="mt-2 text-[14px] text-muted">让工作台更适合你的阅读和工作习惯。</p>
        <section className="mt-7 grid grid-cols-[180px_1fr] gap-6 border-b border-line pb-6">
          <div><h2 className="text-[14px] font-medium">界面主题</h2><p className="mt-2 text-[12px] leading-6 text-muted">蓝灰浅色主题源自<br />Proma 当前配色。</p></div>
          <div>
            <div className="mb-4 inline-flex h-9 items-center rounded-control bg-control/55 p-[3px]">
              {['浅色', '深色', '跟随系统'].map((label) => <button key={label} onClick={() => { setTheme(label); setDark(label === '深色' || (label === '跟随系统' && window.matchMedia('(prefers-color-scheme: dark)').matches)); setSaved(false); }} className={`flex h-full items-center gap-1.5 rounded-[4px] px-4 text-[12px] ${theme === label ? 'bg-surface font-medium' : 'text-muted'}`}><span className={`${label === '浅色' ? 'icon-[lucide--sun]' : label === '深色' ? 'icon-[lucide--moon]' : 'icon-[lucide--monitor]'} size-3.5`} />{label}</button>)}
            </div>
            <div className="overflow-hidden rounded-control border border-border bg-surface">
              <div className="flex h-7 items-center gap-1.5 bg-panel px-3"><span className="size-[5px] rounded-full bg-danger/60" /><span className="size-[5px] rounded-full bg-warning/60" /><span className="size-[5px] rounded-full bg-success/60" /><span className="ml-auto text-[11px] text-muted">实时预览</span></div>
              <div className="flex h-[139px]">
                <div className="w-[115px] shrink-0 bg-sidebar px-3 py-3"><p className="mb-2 text-[11px] text-muted">项目</p><div className="rounded bg-selected px-2 py-1 text-[11px]">EnsoCode</div><div className="mt-2 h-1 w-14 rounded bg-border/70" /><div className="mt-2 h-1 w-[72px] rounded bg-border/45" /></div>
                <div className="min-w-0 flex-1 p-4"><p className="text-[12px] font-medium">清晰的工作区，专注的对话</p><p className="mt-2 text-[11px] text-muted">用柔和层次区分导航、正文与输入区。</p><div className="mt-4 rounded border border-border bg-input px-2 py-2 text-[11px] text-faint">描述你的下一项任务…</div></div>
              </div>
            </div>
            <p className="mt-2 text-[11px] text-muted">{dark ? '深色为同一套令牌的预览扩展。' : '晴空碧海 · 低饱和蓝灰 · 6px 圆角'}</p>
          </div>
        </section>
        <section className="grid grid-cols-[180px_1fr] gap-6 border-b border-line py-5">
          <div><h2 className="text-[14px] font-medium">文字与阅读</h2><p className="mt-2 text-[12px] leading-6 text-muted">正文留出舒适的行距，<br />代码保留等宽排版。</p></div>
          <div>
            <div className="flex items-center gap-3 text-[12px]">
              <span className="text-muted">正文字号</span>
              <div className="ml-auto flex h-8 items-center rounded-control border border-border">
                <button aria-label="减小字号" disabled={fontSize <= 13} onClick={() => { setFontSize(fontSize - 1); setSaved(false); }} className="flex w-8 items-center justify-center">
                  <span className="icon-[lucide--minus] size-3" />
                </button>
                <span className="min-w-12 text-center tabular-nums">{fontSize}px</span>
                <button aria-label="增大字号" disabled={fontSize >= 18} onClick={() => { setFontSize(fontSize + 1); setSaved(false); }} className="flex w-8 items-center justify-center">
                  <span className="icon-[lucide--plus] size-3" />
                </button>
              </div>
            </div>
            <p className="mt-3 rounded-control bg-panel/65 px-3 py-3 leading-[1.8]" style={{ fontSize }}>保持信息清晰，让每一步改动都能被看见。</p>
            <div className="mt-3 flex justify-between text-[11px] text-muted"><span>界面字体</span><span>Inter / 系统中文字体</span></div>
          </div>
        </section>
        <section className="grid grid-cols-[180px_1fr] gap-6 py-5">
          <div><h2 className="text-[14px] font-medium">工作区布局</h2><p className="mt-2 text-[12px] leading-6 text-muted">按当前任务调整<br />信息密度和内容范围。</p></div>
          <div>
            {toggles.map((item, index) => (
              <div key={item.title} className={`flex items-center gap-4 ${index ? 'border-t border-line py-3' : 'pb-3'}`}>
                <div className="flex-1">
                  <h3 className="text-[13px]">{item.title}</h3>
                  <p className="mt-1 text-[11px] text-muted">{item.description}</p>
                </div>
                <button role="switch" aria-label={item.title} aria-checked={item.value} onClick={() => { item.set(!item.value); setSaved(false); }} className={`flex h-[18px] w-8 shrink-0 items-center rounded-full px-[3px] ${item.value ? 'justify-end bg-surface-foreground' : 'justify-start bg-border'}`}>
                  <span className="size-3 rounded-full bg-surface" />
                </button>
              </div>
            ))}
          </div>
        </section>
        <div className="flex items-center gap-3 border-t border-line pt-4">
          <span className="flex items-center gap-1.5 text-[11px] text-muted"><span className="icon-[lucide--info] size-3" />仅在当前设计预览中生效，不写入应用配置</span>
          <button onClick={() => { setDark(false); setTheme('浅色'); setFontSize(15); setCompact(false); setInspectorOpen(true); setWrap(true); setProcess(false); setSaved(false); }} className="ml-auto whitespace-nowrap text-[12px] text-muted hover:text-surface-foreground">恢复默认</button>
          <button onClick={() => setSaved(true)} className="whitespace-nowrap rounded-control bg-surface-foreground px-4 py-2 text-[12px] text-surface">{saved ? '已应用' : '应用到预览'}</button>
        </div>
        {saved && <p role="status" className="mt-3 text-right text-[12px] text-success">预览设置已更新。<Link className="ml-2 underline underline-offset-4" to="/">返回工作台查看</Link></p>}
      </div>
    </div>
  );
}
