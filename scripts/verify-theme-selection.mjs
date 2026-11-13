// Start an ISOLATED Electron dev profile on 9333, then:
// ENSO_CDP_PORT=9333 node scripts/verify-theme-selection.mjs
// Tests actual compiled CSS and shared React controls; never sends model requests.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';

const port = Number(process.env.ENSO_CDP_PORT || 9333);
assert.ok(
  Number.isInteger(port) && port > 0 && port < 65536 && port !== 9222,
  'This test changes settings. Use a verified isolated dev profile, never port 9222.'
);
const profile = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(profile.webSocketDebuggerUrl, { expectedPort: port, timeout: 20000 });
const results = [];
/** 每段等待都带步骤名：WAIT_TIMEOUT 必须能指出卡在哪一步，而不是只报超时。 */
async function step(label, work) {
  try {
    return await work();
  } catch (error) {
    throw new Error(`STUCK_AT: ${label}`, { cause: error });
  }
}
async function evaluate(expression, client = rpc) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });
  if (response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}
function click(selector, page = 'index.html') {
  execFileSync(
    process.execPath,
    ['.agents/skills/enso-cdp/scripts/cdp.mjs', 'click', selector, '--page', page],
    { env: { ...process.env, ENSO_CDP_PORT: String(port) }, timeout: 30000, stdio: 'pipe' }
  );
}
async function settle() {
  await evaluate(`(async()=>{
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
    await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity)
      .map(a=>a.finished.catch(()=>{})));
  })()`);
}
async function ready(previousTimeOrigin, client = rpc, storeRequired = true) {
  await step(
    `${storeRequired ? 'renderer' : 'settings renderer'} ready after reload (origin ${previousTimeOrigin ?? 'initial'})`,
    () =>
      waitUntil(
        async () => {
          try {
            return await evaluate(
              `Boolean(${storeRequired ? 'window.__stores?.settings' : 'true'} && document.readyState === "complete"
        && performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin ?? null)})`,
              client
            );
          } catch (error) {
            if (/context.*destroyed|Cannot find context/i.test(error.message)) return false;
            throw error;
          }
        },
        { timeout: 15000 }
      )
  );
}
// The first import of a rarely-used UI control can make Vite optimize a new
// dependency and reload. Warm the modules before mounting a fixture or changing
// any settings, then intentionally reload to start from the settled dependency graph.
await ready();
await evaluate(`Promise.all(['switch','checkbox','radio-group','slider','toggle','tabs']
  .map(name=>import('/components/ui/'+name+'.tsx'))).then(()=>true)`);
const previousTimeOrigin = await evaluate('performance.timeOrigin');
await rpc.send('Page.reload');
await ready(previousTimeOrigin);
const original = await evaluate(`(()=>{
  const s=window.__stores.settings.getState();
  return Object.fromEntries(['theme','accentColor','lightPalette','terminalTheme','botModeEnabled',
    'designEnabled','backgroundImageEnabled','backgroundImagePath','backgroundOpacity'].map(k=>[k,s[k]]));
})()`);
const temp = mkdtempSync(path.join(tmpdir(), 'enso-theme-selection-'));
let restorationError;
let settingsRpc;
try {
  await evaluate(`(async()=>{
    const resources=performance.getEntriesByType('resource').map(e=>e.name);
    const {default:React}=await import(resources.find(url=>url.includes('/react.js?')));
    const {default:ReactDOM}=await import(resources.find(url=>url.includes('/react-dom_client.js?')));
    const names=['switch','checkbox','radio-group','slider','toggle','tabs'];
    const [s,c,r,l,o,t]=await Promise.all(names.map(n=>import('/components/ui/'+n+'.tsx')));
    const host=document.createElement('div');
    host.style.cssText='position:fixed;left:-10000px;top:0;width:320px';
    document.body.append(host);
    const root=ReactDOM.createRoot(host), h=React.createElement;
    root.render(h('div',null,
      h(s.Switch,{checked:true,'aria-label':'Theme test switch'}),
      h('div',{'data-probe':'unchecked'},h(s.Switch,{checked:false,'aria-label':'Theme test unchecked switch'})),
      h(c.Checkbox,{checked:true,'aria-label':'Theme test checkbox'}),
      h(r.RadioGroup,{value:'a'},h(r.Radio,{value:'a','aria-label':'Theme test radio'})),
      h(l.Slider,{value:50,'aria-label':'Theme test slider'}),
      h(o.Toggle,{pressed:true},'Selected'),
      h(t.Tabs,{value:'a'},h(t.TabsList,null,h(t.TabsTab,{value:'a'},'Selected'))),
      h('div',{'data-probe':'dark',className:'bg-brand/10 dark:bg-brand/15'})
    ));
    window.__themeSelectionFixture={host,dispose(){root.unmount();host.remove();delete window.__themeSelectionFixture;}};
  })()`);
  await step('shared-control fixture mounted', () =>
    waitUntil(
      () =>
        evaluate(`Boolean(window.__themeSelectionFixture?.host.querySelector('[role=switch]'))`),
      { timeout: 10000 }
    )
  );

  for (const [appTheme, terminalTheme, forcedDark] of [
    ['dark', null, true],
    ['light', null, false],
    ['system', null, null],
    ['sync-terminal', 'Dracula', true],
    ['sync-terminal', 'GitHub Light Default', false],
  ]) {
    for (const osTheme of ['light', 'dark']) {
      await rpc.send('Emulation.setEmulatedMedia', {
        features: [{ name: 'prefers-color-scheme', value: osTheme }],
      });
      await evaluate(
        `(()=>{const s=window.__stores.settings.getState();s.setBackgroundImageEnabled(false);s.setAccentColor('teal');
          if(${Boolean(terminalTheme)})s.setTerminalTheme(${JSON.stringify(terminalTheme)});s.setTheme(${JSON.stringify(appTheme)});})()`
      );
      await settle();
      const data = await evaluate(`(()=>{
        const host=window.__themeSelectionFixture.host;
        const css=el=>getComputedStyle(el);
        const token=(name,prop='backgroundColor')=>{
          const p=document.createElement('span');p.style[prop]='var('+name+')';host.append(p);
          const v=css(p)[prop];p.remove();return v;
        };
        return {
          dark:document.documentElement.classList.contains('dark'),
          variant:css(host.querySelector('[data-probe=dark]')).backgroundColor,
          brand:token('--brand'),brandForeground:token('--brand-foreground'),selection:token('--selection'),
          mutedForeground:token('--muted-foreground'),primaryForeground:token('--primary-foreground'),
          switch:css(host.querySelector('[data-slot=switch]')).backgroundColor,
          thumb:css(host.querySelector('[data-slot=switch-thumb]')).backgroundColor,
          uncheckedThumb:css(host.querySelector('[data-probe=unchecked] [data-slot=switch-thumb]')).backgroundColor,
          checkbox:css(host.querySelector('[data-slot=checkbox-indicator]')).backgroundColor,
          radio:css(host.querySelector('[data-slot=radio-indicator]')).backgroundColor,
          slider:css(host.querySelector('[data-slot=slider-indicator]')).backgroundColor,
          toggle:css(host.querySelector('[data-slot=toggle]')).backgroundColor,
          tabs:css(host.querySelector('[data-slot=tab-indicator]')).backgroundColor,
        };
      })()`);
      const dark = forcedDark ?? osTheme === 'dark';
      assert.equal(data.dark, dark, `${appTheme}/${osTheme}: root appearance`);
      const alpha = Number(data.variant.match(/\/\s*([\d.]+)\)/)?.[1]);
      assert.equal(
        alpha,
        dark ? 0.15 : 0.1,
        `${appTheme}/${osTheme}: dark utility follows application`
      );
      for (const key of ['switch', 'checkbox', 'radio', 'slider'])
        assert.equal(data[key], data.brand, `${appTheme}/${osTheme}: ${key} brand`);
      assert.equal(data.thumb, data.brandForeground, 'checked thumb contrast');
      assert.equal(
        data.uncheckedThumb,
        dark ? data.mutedForeground : data.primaryForeground,
        'unchecked thumb visibility'
      );
      for (const key of ['toggle', 'tabs'])
        assert.equal(data[key], data.selection, `${key} persistent selection`);
      results.push({
        check: 'shared controls + dark variant',
        appTheme,
        terminalTheme,
        osTheme,
        passed: true,
      });
    }
  }
  await rpc.send('Emulation.setEmulatedMedia', { features: [] });
  await evaluate(
    `(()=>{const s=window.__stores.settings.getState();s.setTheme('dark');s.setBotModeEnabled(true);s.setDesignEnabled(true);})()`
  );
  await settle();
  const shot = await rpc.send('Page.captureScreenshot', { format: 'png' });
  const wallpaper = path.join(temp, 'wallpaper.png');
  writeFileSync(wallpaper, Buffer.from(shot.result.data, 'base64'));

  for (const accent of ['teal', 'violet']) {
    for (const opacity of [null, 0.85, 1]) {
      await evaluate(`(()=>{const s=window.__stores.settings.getState();s.setAccentColor(${JSON.stringify(accent)});
        s.setBackgroundImagePath(${JSON.stringify(wallpaper)});s.setBackgroundOpacity(${opacity ?? 0.85});s.setBackgroundImageEnabled(${opacity !== null});})()`);
      await settle();
      for (const view of ['code', 'images', 'design', 'bot']) {
        // Code / Bot 是工作模式，入口在标题栏分段控件；画图 / 设计仍在左侧图标轨。
        click(`button[data-rail-view="${view}"]`);
        await settle();
        // 两个承载层的选中样式不同：图标轨用 brand 文字 + selection 底，
        // 标题栏模式分段用前景色文字 + 内容区色胶囊（上游风格）。
        const modeSegment = view === 'code' || view === 'bot';
        const data = await evaluate(`(()=>{
          const b=document.querySelector('button[data-rail-view="${view}"]');
          const fill=${modeSegment ? "b.querySelector('[data-slot=mode-switch-selection]')" : 'b'};
          const p=document.createElement('span');document.body.append(p);
          p.style.color=${modeSegment ? "'var(--foreground)'" : "'var(--brand)'"};
          // 模式胶囊的承载令牌是 --color-background（背景图模式下会被面板 alpha 重映射），
          // 直接比 --background 会漏掉透明化机制。
          p.style.backgroundColor=${modeSegment ? "'var(--color-background)'" : "'var(--selection)'"};
          const expected={color:getComputedStyle(p).color,background:getComputedStyle(p).backgroundColor};p.remove();
          const tint=document.createElement('span');tint.style.backgroundColor='var(--selection)';
          document.body.append(tint);const selection=getComputedStyle(tint).backgroundColor;tint.remove();
          return {pressed:b.getAttribute('aria-pressed'),pill:Boolean(fill),color:getComputedStyle(b).color,background:getComputedStyle(fill).backgroundColor,expected,
            selection,count:document.querySelectorAll('button[data-rail-view][aria-pressed=true]').length};
        })()`);
        assert.equal(data.pressed, 'true', `${view}: active state`);
        assert.equal(data.pill, true, `${view}: selected segment has its own visual carrier`);
        assert.equal(data.count, 1, `${view}: exactly one workspace selected`);
        assert.equal(
          data.color,
          data.expected.color,
          `${view}: active text uses the ${modeSegment ? 'foreground' : 'brand'} token`
        );
        assert.equal(
          data.background,
          data.expected.background,
          `${view}: ${modeSegment ? 'pill stays the content surface' : 'selection survives wallpaper'}`
        );
        if (modeSegment)
          assert.notEqual(
            data.background,
            data.selection,
            `${view}: pill is the content surface, not the selection tint`
          );
        results.push({ check: 'navigation', accent, wallpaper: opacity, view, passed: true });
      }
    }
  }
  click('button[data-rail-view="code"]');
  await evaluate(`window.__stores.settings.getState().setBotModeEnabled(false)`);
  await settle();
  const fallback = await evaluate(
    `(()=>{const b=document.querySelector('button[data-rail-view=code]');const fill=b.querySelector('[data-slot=mode-switch-selection]');const p=document.createElement('span');p.style.color='var(--foreground)';p.style.backgroundColor='var(--color-background)';document.body.append(p);const expected={color:getComputedStyle(p).color,bg:getComputedStyle(p).backgroundColor};p.remove();const t=document.createElement('span');t.style.backgroundColor='var(--selection)';document.body.append(t);const selection=getComputedStyle(t).backgroundColor;t.remove();return {active:b.getAttribute('aria-pressed'),pill:Boolean(fill),color:getComputedStyle(b).color,bg:fill?getComputedStyle(fill).backgroundColor:null,expected,selection,count:document.querySelectorAll('[data-rail-view][aria-pressed=true]').length};})()`
  );
  assert.equal(fallback.active, 'true');
  assert.equal(fallback.pill, true, 'Code keeps its capsule with Bot disabled');
  assert.equal(fallback.count, 1, 'only Code is selected with Bot disabled');
  assert.equal(fallback.bg, fallback.expected.bg);
  assert.equal(fallback.color, fallback.expected.color);
  assert.notEqual(fallback.bg, fallback.selection, 'Code pill is not the selection tint');
  results.push({ check: 'Code remains selected with Bot disabled', passed: true });

  // Use the real settings buttons, not only root-token self-comparisons: light
  // palettes used to disable these and override --brand even after store updates.
  await evaluate('window.electronAPI.window.openSettings()');
  const settingsPage = await waitUntil(
    async () => {
      try {
        return selectPage(await fetchJson(port, '/json/list'), 'settings.html');
      } catch (error) {
        if (error.code === 'NO_PAGE') return false;
        throw error;
      }
    },
    { timeout: 15000 }
  );
  settingsRpc = await connect(settingsPage.webSocketDebuggerUrl, {
    expectedPort: port,
    timeout: 20000,
  });
  await waitUntil(
    () =>
      evaluate(
        `document.readyState==='complete' && Boolean(document.querySelector('[data-slot=settings-navigation]'))`,
        settingsRpc
      ),
    { timeout: 15000 }
  );
  const categoryIndex = await evaluate(
    `Array.from(document.querySelectorAll('[data-slot=settings-navigation] button')).findIndex(b=>['Appearance','外观'].includes(b.textContent.trim()))`,
    settingsRpc
  );
  assert.ok(categoryIndex >= 0, 'appearance settings category');
  click(`[data-slot=settings-navigation] button:nth-child(${categoryIndex + 1})`, 'settings.html');
  await waitUntil(
    () => evaluate(`Boolean(document.querySelector('[data-accent-option=teal]'))`, settingsRpc),
    { timeout: 15000 }
  );
  const lightAccents = {
    ocean: 'rgb(64, 138, 191)',
    indigo: 'rgb(79, 70, 229)',
    violet: 'rgb(124, 78, 214)',
    teal: 'rgb(13, 138, 136)',
    amber: 'rgb(180, 116, 12)',
    graphite: 'rgb(60, 66, 80)',
  };
  for (const palette of ['ocean', 'mint-light', 'cloud-light']) {
    await evaluate(
      `(()=>{const s=window.__stores.settings.getState();s.setBackgroundImageEnabled(false);s.setTheme('light');s.setLightPalette(${JSON.stringify(palette)});})()`
    );
    await waitUntil(
      () =>
        evaluate(
          `(document.documentElement.dataset.lightPalette||'ocean')===${JSON.stringify(palette)} && !document.documentElement.classList.contains('dark')`,
          settingsRpc
        ),
      { timeout: 10000 }
    );
    const surface = await evaluate(
      `getComputedStyle(document.documentElement).getPropertyValue('--background').trim()`
    );
    for (const [accent, expected] of Object.entries(lightAccents)) {
      const selector = `[data-accent-option="${accent}"]`;
      await evaluate(
        `document.querySelector('${selector}').scrollIntoView({block:'center'})`,
        settingsRpc
      );
      click(selector, 'settings.html');
      const hasAccent = `(document.documentElement.dataset.accent===${JSON.stringify(accent)} && getComputedStyle(document.documentElement).getPropertyValue('--brand').trim()===${JSON.stringify(expected.replaceAll(', ', ' '))})`;
      await waitUntil(() => evaluate(hasAccent), { timeout: 10000 });
      await waitUntil(() => evaluate(hasAccent, settingsRpc), { timeout: 10000 });
      const data = await evaluate(
        `(()=>{const b=document.querySelector('${selector}');return {enabled:!b.disabled,selected:b.getAttribute('aria-pressed')};})()`,
        settingsRpc
      );
      assert.equal(data.enabled, true, `${palette}/${accent}: interactive`);
      assert.equal(data.selected, 'true', `${palette}/${accent}: selected`);
      // Code / Bot 分段不再用强调色。图标轨的 brand 图标在 cloud-light 被方案改成
      // foreground，不能用来验证强调色，这里直接在主窗口渲染一个 `text-brand`
      // 工具类节点：它验证的是编译后的 brand 工具类跟随设置窗口写入的强调色。
      const brandProbe =
        "(()=>{const p=document.createElement('span');p.className='text-brand';document.body.append(p);const v=getComputedStyle(p).color;p.remove();return v})()";
      const styles = await evaluate(
        `(()=>{const css=getComputedStyle(document.documentElement);return {surface:css.getPropertyValue('--background').trim(),icon:${brandProbe}};})()`
      );
      assert.equal(styles.surface, surface, `${palette}: neutral surface unchanged`);
      assert.ok(styles.icon, `${palette}: brand utility resolves in the main window`);
      await waitUntil(() => evaluate(`(${brandProbe})===${JSON.stringify(expected)}`), {
        timeout: 10000,
      });
      results.push({ check: 'light settings click + both windows', palette, accent, passed: true });
    }
    // The Main broadcast above proves the write was persisted; reload both renderers.
    const origin = await evaluate('performance.timeOrigin');
    await rpc.send('Page.reload');
    await ready(origin);
    await waitUntil(
      () =>
        evaluate(
          `window.__stores.settings.getState().accentColor==='graphite' && window.__stores.settings.getState().lightPalette===${JSON.stringify(palette)}`
        ),
      { timeout: 10000 }
    );
    const settingsOrigin = await evaluate('performance.timeOrigin', settingsRpc);
    await settingsRpc.send('Page.reload');
    await ready(settingsOrigin, settingsRpc, false);
    await waitUntil(
      () =>
        evaluate(
          `document.readyState==='complete' && Boolean(document.querySelector('[data-slot=settings-navigation]'))`,
          settingsRpc
        ),
      { timeout: 15000 }
    );
    click(
      `[data-slot=settings-navigation] button:nth-child(${categoryIndex + 1})`,
      'settings.html'
    );
    await waitUntil(
      () =>
        evaluate(
          `Boolean(document.querySelector('[data-accent-option=graphite][aria-pressed=true]'))`,
          settingsRpc
        ),
      { timeout: 10000 }
    );
    results.push({ check: 'light accent survives renderer reload', palette, passed: true });
  }
  console.table(results);
} finally {
  await rpc.send('Emulation.setEmulatedMedia', { features: [] }).catch(() => {});
  await evaluate(`(()=>{
    window.__themeSelectionFixture?.dispose();
    const s=window.__stores.settings.getState(), o=${JSON.stringify(original)};
    for(const key of ['backgroundImageEnabled','backgroundImagePath','backgroundOpacity','terminalTheme','lightPalette','accentColor','botModeEnabled','designEnabled','theme']) {
      const setter='set'+key[0].toUpperCase()+key.slice(1);s[setter](o[key]);
    }
  })()`).catch((error) => {
    restorationError = error;
  });
  rpc.close();
  settingsRpc?.close();
  rmSync(temp, { recursive: true, force: true });
}
if (restorationError) throw new Error('Profile restoration failed', { cause: restorationError });
console.log(`PASS: ${results.length} Chromium theme scenarios; no chat turns sent.`);
