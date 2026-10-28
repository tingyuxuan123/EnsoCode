import { useState } from 'react';
import { MenuPanel, useDismiss } from '../../Controls';
import { useWorkbench } from '../../Workbench';
import { outlineButton, SettingsHeader, SettingsSection } from '../SettingsUI';
import { Select, SliderLine, SwitchLine } from './shared';

const THEME_MODES = [
  { value: 'light', label: '浅色', icon: 'icon-[lucide--sun]' },
  { value: 'dark', label: '深色', icon: 'icon-[lucide--moon]' },
  { value: 'system', label: '系统', icon: 'icon-[lucide--monitor]' },
  { value: 'sync-terminal', label: '同步终端主题', icon: 'icon-[lucide--terminal]' },
];
/** shared/accentColor.ts：ocean 为默认；色值为示意色点 */
const ACCENTS = [
  { value: 'ocean', label: '晴空蓝', swatch: '#3d8bc4' },
  { value: 'indigo', label: '靛蓝', swatch: '#5361c9' },
  { value: 'violet', label: '紫罗兰', swatch: '#8156c8' },
  { value: 'teal', label: '青绿', swatch: '#2c9488' },
  { value: 'amber', label: '琥珀', swatch: '#c08a2c' },
  { value: 'graphite', label: '石墨', swatch: '#5d6670' },
];
/** 来自 resources/ghostty-themes 的部分配色 */
const TERMINAL_THEMES = [
  { name: 'Ghostty Default Style Dark', bg: '#282c34', fg: '#ffffff', colors: ['#e06c75', '#98c379', '#e5c07b', '#61afef', '#c678dd'] },
  { name: 'Catppuccin Mocha', bg: '#1e1e2e', fg: '#cdd6f4', colors: ['#f38ba8', '#a6e3a1', '#f9e2af', '#89b4fa', '#f5c2e7'] },
  { name: 'GitHub Light Default', bg: '#ffffff', fg: '#1f2328', colors: ['#cf222e', '#116329', '#4d2d00', '#0969da', '#8250df'] },
  { name: 'Nord', bg: '#2e3440', fg: '#d8dee9', colors: ['#bf616a', '#a3be8c', '#ebcb8b', '#81a1c1', '#b48ead'] },
  { name: 'TokyoNight', bg: '#1a1b26', fg: '#c0caf5', colors: ['#f7768e', '#9ece6a', '#e0af68', '#7aa2f7', '#bb9af7'] },
  { name: 'Rose Pine Dawn', bg: '#faf4ed', fg: '#575279', colors: ['#b4637a', '#286983', '#ea9d34', '#56949f', '#907aa9'] },
  { name: 'Gruvbox Dark', bg: '#282828', fg: '#ebdbb2', colors: ['#cc241d', '#98971a', '#d79921', '#458588', '#b16286'] },
  { name: 'Solarized Osaka Night', bg: '#001a20', fg: '#839395', colors: ['#db302d', '#849900', '#b28500', '#268bd3', '#d23681'] },
];
const WEIGHTS = ['normal', '100', '200', '300', '400', '500', '600', '700', '800', '900', 'bold'].map((value) => [value, value === 'normal' ? 'Normal' : value === 'bold' ? 'Bold' : `${value}`] as [string, string]);

function ThemeCombobox({ value, onChange, favorites, toggleFavorite }: { value: string; onChange: (value: string) => void; favorites: string[]; toggleFavorite: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [favOnly, setFavOnly] = useState(false);
  const ref = useDismiss<HTMLDivElement>(open, () => setOpen(false));
  const list = TERMINAL_THEMES.filter((theme) => (!favOnly || favorites.includes(theme.name)) && theme.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <div ref={ref} className="relative flex-1">
      <button onClick={() => setOpen(!open)} className="flex h-8 w-full items-center gap-2 rounded-control border border-border bg-input px-2 text-left text-[12px]" aria-label="配色方案">
        <span className="min-w-0 flex-1 truncate">{value}</span>
        <span className="icon-[lucide--chevrons-up-down] size-3 text-faint" />
      </button>
      {open && (
        <MenuPanel label="配色方案" className="left-0 top-9 w-full">
          <div className="flex items-center gap-2 border-b border-line px-1.5 pb-1.5">
            <span className="icon-[lucide--search] size-3.5 text-muted" />
            <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索主题..." aria-label="搜索主题" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
            <button onClick={() => setFavOnly(!favOnly)} title="只显示收藏" aria-pressed={favOnly} className={`flex size-6 items-center justify-center rounded ${favOnly ? 'text-danger' : 'text-muted'}`}><span className={`${favOnly ? 'icon-[mdi--heart]' : 'icon-[lucide--heart]'} size-3.5`} /></button>
          </div>
          <div className="max-h-52 overflow-y-auto pt-1">
            {favOnly && !favorites.length && <p className="px-2 py-4 text-center text-[12px] text-muted">暂无收藏主题。点击爱心图标添加收藏。</p>}
            {(!favOnly || favorites.length > 0) && !list.length && <p className="px-2 py-4 text-center text-[12px] text-muted">未找到主题</p>}
            {list.map((theme) => (
              <div key={theme.name} onMouseEnter={() => onChange(theme.name)} className={`flex items-center gap-2 rounded-[4px] px-2 py-1.5 text-[12px] hover:bg-hover ${value === theme.name ? 'bg-selected' : ''}`}>
                <button onClick={() => { onChange(theme.name); setOpen(false); }} className="flex min-w-0 flex-1 items-center gap-2 text-left">
                  <span className="flex h-3.5 w-7 shrink-0 overflow-hidden rounded-[3px]" style={{ background: theme.bg }}>
                    {theme.colors.slice(0, 3).map((color) => <span key={color} className="h-full flex-1" style={{ background: color, opacity: 0.85 }} />)}
                  </span>
                  <span className="truncate">{theme.name}</span>
                </button>
                <button onClick={() => toggleFavorite(theme.name)} title={favorites.includes(theme.name) ? '取消收藏' : '添加收藏'} className={favorites.includes(theme.name) ? 'text-danger' : 'text-faint hover:text-muted'}><span className={`${favorites.includes(theme.name) ? 'icon-[mdi--heart]' : 'icon-[lucide--heart]'} size-3.5`} /></button>
              </div>
            ))}
          </div>
        </MenuPanel>
      )}
    </div>
  );
}

function Background() {
  const [enabled, setEnabled] = useState(true);
  const [source, setSource] = useState('folder');
  const [path, setPath] = useState('~/Pictures/Wallpapers');
  const [fit, setFit] = useState('cover');
  const [interval, setIntervalValue] = useState('300');
  const [visibility, setVisibility] = useState(35);
  const [blur, setBlur] = useState(6);
  const [brightness, setBrightness] = useState(90);
  const [saturation, setSaturation] = useState(80);
  const [composer, setComposer] = useState(92);
  const [code, setCode] = useState(88);
  const urlInvalid = source === 'url' && !/^https?:\/\//.test(path);
  return (
    <SettingsSection title="背景图" description="在界面背后显示自定义背景图">
      <SwitchLine label="背景图" checked={enabled} onChange={setEnabled} />
      <div className={enabled ? '' : 'pointer-events-none opacity-45'}>
        <div className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5">
          <span className="text-[13px]">来源类型</span>
          <Select label="来源类型" value={source} onChange={(value) => { setSource(value); setPath(value === 'url' ? 'https://' : value === 'file' ? '~/Pictures/desk.jpg' : '~/Pictures/Wallpapers'); }} width="w-44" options={[['file', '单张图片'], ['folder', '文件夹（随机）'], ['url', '网络图片']]} />
        </div>
        <div className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5">
          <span className="text-[13px]">{source === 'url' ? '图片地址' : source === 'file' ? '图片路径' : '文件夹路径'}</span>
          <div className="flex items-center gap-2">
            <input value={path} onChange={(event) => setPath(event.target.value)} aria-label="背景来源" className={`h-8 min-w-0 flex-1 rounded-control border bg-input px-2 font-mono text-[12px] outline-none ${urlInvalid ? 'border-danger/60' : 'border-border'}`} />
            {source !== 'url' && <button className={outlineButton} aria-label="浏览" title="浏览"><span className="icon-[lucide--folder-open] size-3.5" /></button>}
            <button className={outlineButton} aria-label="立即刷新" title="立即刷新"><span className="icon-[lucide--refresh-cw] size-3.5" /></button>
          </div>
        </div>
        {source === 'folder' && (
          <div className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5">
            <span className="text-[13px]">自动切换</span>
            <div className="flex items-center gap-2 text-[12px] text-muted">
              <input type="number" value={interval} onChange={(event) => setIntervalValue(event.target.value)} aria-label="自动切换间隔" className="h-8 w-20 rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground outline-none" />
              秒
            </div>
          </div>
        )}
        <div className="grid grid-cols-[120px_1fr] items-center gap-3 py-1.5">
          <span className="text-[13px]">填充方式</span>
          <Select label="填充方式" value={fit} onChange={setFit} width="w-36" options={[['cover', '覆盖'], ['contain', '完整显示'], ['repeat', '平铺'], ['center', '居中原图']]} />
        </div>
        <SliderLine label="背景可见度" value={visibility} onChange={setVisibility} />
        <SliderLine label="模糊" value={blur} onChange={setBlur} max={20} unit="px" />
        <SliderLine label="亮度" value={brightness} onChange={setBrightness} max={200} />
        <SliderLine label="饱和度" value={saturation} onChange={setSaturation} max={200} />
        <SliderLine label="输入框不透明度" value={composer} onChange={setComposer} />
        <SliderLine label="代码块不透明度" value={code} onChange={setCode} />
      </div>
    </SettingsSection>
  );
}

/** 外观（AppearanceSettings.tsx）：主题模式 / 强调色 / 终端外观 / 背景图 */
export function AppearancePage() {
  const { setDark } = useWorkbench();
  const [mode, setMode] = useState('light');
  const [accent, setAccent] = useState('ocean');
  const [theme, setTheme] = useState('Ghostty Default Style Dark');
  const [favorites, setFavorites] = useState(['Catppuccin Mocha', 'Nord']);
  const [font, setFont] = useState('JetBrains Mono, monospace');
  const [size, setSize] = useState(13);
  const [weight, setWeight] = useState('normal');
  const [bold, setBold] = useState('bold');
  const pickMode = (value: string) => {
    setMode(value);
    const current = TERMINAL_THEMES.find((item) => item.name === theme);
    const terminalDark = current ? parseInt(current.bg.slice(1, 3), 16) < 128 : true;
    setDark(value === 'dark' || (value === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches) || (value === 'sync-terminal' && terminalDark));
  };
  const preview = TERMINAL_THEMES.find((item) => item.name === theme) ?? TERMINAL_THEMES[0];
  const step = (dir: number) => {
    const index = TERMINAL_THEMES.findIndex((item) => item.name === theme);
    const next = TERMINAL_THEMES[(index + dir + TERMINAL_THEMES.length) % TERMINAL_THEMES.length].name;
    setTheme(next);
    if (mode === 'sync-terminal') setDark(parseInt((TERMINAL_THEMES.find((item) => item.name === next)?.bg ?? '#000').slice(1, 3), 16) < 128);
  };
  return (
    <div data-settings-row="appearance.root">
      <SettingsHeader title="外观" />
      <SettingsSection title="主题模式" description="选择界面主题">
        <div className="grid grid-cols-4 gap-3" role="radiogroup" aria-label="主题模式">
          {THEME_MODES.map((option) => (
            <button key={option.value} role="radio" aria-checked={mode === option.value} onClick={() => pickMode(option.value)} className={`flex flex-col items-center gap-2 rounded-control border-2 p-3 ${mode === option.value ? 'border-primary bg-primary-soft' : 'border-transparent bg-panel hover:bg-hover'}`}>
              <span className={`${option.icon} size-5 ${mode === option.value ? 'text-primary' : 'text-muted'}`} />
              <span className="text-[13px] font-medium">{option.label}</span>
            </button>
          ))}
        </div>
        {mode === 'sync-terminal' && <p className="mt-2 text-[12px] text-muted">界面明暗跟随下方终端配色「{theme}」。</p>}
      </SettingsSection>
      <SettingsSection title="强调色" description="界面高亮使用的颜色">
        <div className="flex items-center gap-4">
          {ACCENTS.map((option) => (
            <button key={option.value} onClick={() => setAccent(option.value)} aria-pressed={accent === option.value} title={option.label} className="flex flex-col items-center gap-1.5">
              <span className={`size-6 rounded-full ${accent === option.value ? 'ring-2 ring-surface-foreground/60 ring-offset-2 ring-offset-surface' : ''}`} style={{ backgroundColor: option.swatch }} />
              <span className={`text-[11px] ${accent === option.value ? 'text-surface-foreground' : 'text-muted'}`}>{option.label}</span>
            </button>
          ))}
        </div>
      </SettingsSection>
      <SettingsSection title="终端" description="终端外观">
        <p className="mb-1.5 text-[12px] font-medium">预览</p>
        <div className="overflow-hidden rounded-control border border-line p-3 font-mono" style={{ background: preview.bg, color: preview.fg, fontFamily: font, fontSize: size, fontWeight: weight === 'normal' ? 400 : weight === 'bold' ? 700 : Number(weight), lineHeight: 1.5 }}>
          <div><span style={{ color: preview.colors[1] }}>yfdl@mac</span> <span style={{ color: preview.colors[3] }}>~/githubproject/EnsoCode</span> <span style={{ color: preview.colors[4] }}>main</span></div>
          <div>$ pnpm typecheck && pnpm test</div>
          <div><span style={{ color: preview.colors[1], fontWeight: bold === 'bold' ? 700 : Number(bold) || 700 }}>✓</span> 412 tests passed <span style={{ color: preview.colors[2] }}>(3 skipped)</span></div>
          <div><span style={{ color: preview.colors[0], fontWeight: bold === 'bold' ? 700 : Number(bold) || 700 }}>✕</span> settingsDeepLink.test.ts</div>
        </div>
        <div className="mt-3 grid grid-cols-[100px_1fr] items-center gap-x-4 gap-y-2.5">
          <span className="text-[13px] font-medium">配色方案</span>
          <div className="flex items-center gap-2">
            <button onClick={() => step(-1)} className={outlineButton} aria-label="上一个配色"><span className="icon-[lucide--chevron-left] size-4" /></button>
            <ThemeCombobox value={theme} onChange={setTheme} favorites={favorites} toggleFavorite={(name) => setFavorites(favorites.includes(name) ? favorites.filter((item) => item !== name) : [...favorites, name])} />
            <button onClick={() => step(1)} className={outlineButton} aria-label="下一个配色"><span className="icon-[lucide--chevron-right] size-4" /></button>
          </div>
          <span className="text-[13px] font-medium">字体</span>
          <input value={font} onChange={(event) => setFont(event.target.value)} placeholder="JetBrains Mono, monospace" aria-label="字体" className="h-8 rounded-control border border-border bg-input px-2 text-[12px] outline-none focus:border-primary/60" />
          <span className="text-[13px] font-medium">字号</span>
          <div className="flex items-center gap-2 text-[12px] text-muted">
            <input type="number" min={8} max={32} value={size} onChange={(event) => setSize(Math.max(8, Math.min(32, Number(event.target.value) || 8)))} aria-label="字号" className="h-8 w-20 rounded-control border border-border bg-input px-2 text-[12px] text-surface-foreground outline-none" />
            px
          </div>
          <span className="text-[13px] font-medium">字重</span>
          <Select label="字重" value={weight} onChange={setWeight} width="w-48" options={WEIGHTS} />
          <span className="text-[13px] font-medium">粗体字重</span>
          <Select label="粗体字重" value={bold} onChange={setBold} width="w-48" options={WEIGHTS} />
        </div>
      </SettingsSection>
      <Background />
    </div>
  );
}
