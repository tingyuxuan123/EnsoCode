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
async function ready(previousTimeOrigin) {
  await waitUntil(
    async () => {
      try {
        return await evaluate(`Boolean(window.__stores?.settings && document.readyState === "complete"
        && performance.timeOrigin !== ${JSON.stringify(previousTimeOrigin ?? null)})`);
      } catch (error) {
        if (/context.*destroyed|Cannot find context/i.test(error.message)) return false;
        throw error;
      }
    },
    { timeout: 15000 }
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
  await waitUntil(
    () => evaluate(`Boolean(window.__themeSelectionFixture?.host.querySelector('[role=switch]'))`),
    { timeout: 10000 }
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
        click(`[data-slot="app-rail"] button[data-rail-view="${view}"]`);
        await settle();
        const data = await evaluate(`(()=>{
          const b=document.querySelector('[data-slot=app-rail] button[data-rail-view="${view}"]');
          const fill=b.querySelector('[data-slot=rail-selection]')||b;
          const p=document.createElement('span');document.body.append(p);
          p.style.color='var(--brand)';p.style.backgroundColor='var(--selection)';
          const expected={color:getComputedStyle(p).color,background:getComputedStyle(p).backgroundColor};p.remove();
          return {pressed:b.getAttribute('aria-pressed'),color:getComputedStyle(b).color,background:getComputedStyle(fill).backgroundColor,expected,
            count:document.querySelectorAll('[data-slot=app-rail] button[data-rail-view][aria-pressed=true]').length};
        })()`);
        assert.equal(data.pressed, 'true', `${view}: active state`);
        assert.equal(data.count, 1, `${view}: exactly one workspace selected`);
        assert.equal(data.color, data.expected.color, `${view}: brand persists on hover`);
        assert.equal(
          data.background,
          data.expected.background,
          `${view}: selection survives wallpaper`
        );
        results.push({ check: 'navigation', accent, wallpaper: opacity, view, passed: true });
      }
    }
  }
  click('[data-slot="app-rail"] button[data-rail-view="code"]');
  await evaluate(`window.__stores.settings.getState().setBotModeEnabled(false)`);
  await settle();
  const fallback = await evaluate(
    `(()=>{const b=document.querySelector('[data-slot=app-rail] button[data-rail-view=code]');const p=document.createElement('span');p.style.color='var(--brand)';p.style.backgroundColor='var(--selection)';document.body.append(p);const expected={color:getComputedStyle(p).color,bg:getComputedStyle(p).backgroundColor};p.remove();return {active:b.getAttribute('aria-pressed'),color:getComputedStyle(b).color,bg:getComputedStyle(b).backgroundColor,expected};})()`
  );
  assert.equal(fallback.active, 'true');
  assert.equal(fallback.bg, fallback.expected.bg);
  assert.equal(fallback.color, fallback.expected.color);
  results.push({ check: 'Code remains selected with Bot disabled', passed: true });
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
  rmSync(temp, { recursive: true, force: true });
}
if (restorationError) throw new Error('Profile restoration failed', { cause: restorationError });
console.log(`PASS: ${results.length} Chromium theme scenarios; no chat turns sent.`);
