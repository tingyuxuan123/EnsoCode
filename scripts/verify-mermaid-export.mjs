// Actual Electron DOM + SVG/canvas rendering, no model request, isolated profile only.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import {
  connect,
  fetchJson,
  selectPage,
  waitUntil,
} from '../.agents/skills/enso-cdp/scripts/cdp-core.mjs';

const port = Number(process.env.ENSO_CDP_PORT || 9333);
assert.ok(port !== 9222 && port > 0 && port < 65536, 'Use an isolated non-default port');
const page = selectPage(await fetchJson(port, '/json/list'), 'index.html');
const rpc = await connect(page.webSocketDebuggerUrl, { expectedPort: port, timeout: 30000 });
async function evaluate(expression) {
  const response = await rpc.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (response.result?.exceptionDetails)
    throw new Error(JSON.stringify(response.result.exceptionDetails));
  return response.result.result.value;
}
try {
  await evaluate(`(async()=>{
    const resources=performance.getEntriesByType('resource').map(e=>e.name);
    const {default:React}=await import(resources.find(u=>u.includes('/react.js?')));
    const {default:ReactDOM}=await import(resources.find(u=>u.includes('/react-dom_client.js?')));
    const {MermaidRenderer}=await import('/components/chat/MermaidRenderer.tsx');
    const host=document.createElement('div'); host.dataset.portVerification='mermaid';
    host.style.cssText='position:fixed;inset:40px;z-index:100000;background:white;color:black;padding:28px;overflow:auto';
    document.body.append(host);
    const root=ReactDOM.createRoot(host), originalClick=HTMLAnchorElement.prototype.click;
    const originalCreate=URL.createObjectURL, blobs=new Map();
    const originalDecode=Image.prototype.decode, decodeErrors=[];
    Image.prototype.decode=function(){return originalDecode.call(this).catch(error=>{decodeErrors.push({message:error.message,source:this.src});throw error})};
    URL.createObjectURL=function(blob){const url=originalCreate.call(URL,blob);blobs.set(url,blob);return url};
    const downloads=[];
    HTMLAnchorElement.prototype.click=function(){
      if(!this.download.startsWith('mermaid-')) return originalClick.call(this);
      const entry={name:this.download,url:this.href};downloads.push(entry);
      entry.ready=Promise.resolve(blobs.get(this.href)??new Blob([Uint8Array.from(atob(this.href.split(',')[1]),c=>c.charCodeAt(0))],{type:'image/png'})).then(async b=>{
        entry.type=b.type;entry.size=b.size;
        entry.data=await new Promise(resolve=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.readAsDataURL(b)});
        if(b.type==='image/svg+xml')entry.svg=await b.text();
        const image=new Image(); image.src=entry.data; await image.decode();
        entry.dimensions=[image.naturalWidth,image.naturalHeight]; return true;
      });
    };
    root.render(React.createElement(MermaidRenderer,{code:${JSON.stringify('flowchart LR\n A[只读代理] --> B[Read README]\n B --> C[SVG / PNG 导出]')}}));
    window.__mermaidPortFixture={host,downloads,decodeErrors,dispose(){root.unmount();host.remove();HTMLAnchorElement.prototype.click=originalClick;URL.createObjectURL=originalCreate;Image.prototype.decode=originalDecode;delete window.__mermaidPortFixture}};
  })()`);
  await waitUntil(
    () => evaluate(`Boolean(window.__mermaidPortFixture?.host.querySelector('svg.flowchart'))`),
    { timeout: 30000 }
  );
  await evaluate(
    `(()=>{const h=window.__mermaidPortFixture.host;h.querySelector('[title="导出 SVG"]').click();h.querySelector('[title="导出 PNG"]').click()})()`
  );
  await waitUntil(() => evaluate(`window.__mermaidPortFixture.downloads.length===2`), {
    timeout: 30000,
  });
  const downloads = await evaluate(`(async()=>{
    await Promise.all(window.__mermaidPortFixture.downloads.map(d=>d.ready));
    return window.__mermaidPortFixture.downloads.map(({ready,url,...d})=>d);
  })()`);
  assert.equal(downloads[0].type, 'image/svg+xml');
  assert.ok(downloads[0].svg.includes('xmlns="http://www.w3.org/2000/svg"'));
  if (downloads[1].type !== 'image/png') {
    const diagnostics = await evaluate(
      `({errors:window.__mermaidPortFixture.decodeErrors,notices:document.body.innerText.slice(-500)})`
    );
    writeFileSync(
      '/private/tmp/collabra-mermaid-export-diagnostics.json',
      JSON.stringify(diagnostics, null, 2)
    );
    console.log(JSON.stringify(diagnostics));
  }
  assert.equal(downloads[1].type, 'image/png');
  assert.ok(downloads[1].size > 1000, 'PNG must contain rendered pixels');
  for (const item of downloads) {
    assert.ok(item.dimensions.every((d) => d > 0));
    writeFileSync(
      `/private/tmp/collabra-port-${item.name}`,
      Buffer.from(item.data.split(',')[1], 'base64')
    );
  }
  const screenshot = await rpc.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(
    '/private/tmp/collabra-mermaid-export-ui.png',
    Buffer.from(screenshot.result.data, 'base64')
  );
  console.log(
    JSON.stringify(
      downloads.map(({ data, svg, ...summary }) => summary),
      null,
      2
    )
  );
} finally {
  await evaluate('window.__mermaidPortFixture?.dispose()').catch(() => {});
  rpc.close();
}
