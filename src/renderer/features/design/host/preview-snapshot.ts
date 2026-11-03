/**
 * Legacy snapshots select MemoryRouter for about:srcdoc, but BrowserRouter on HTTP.
 * Only the unprivileged Main preview page creates srcdoc: it inherits that page's
 * isolated CSP (not the application's), with two opaque-origin sandbox boundaries.
 */
export function wrapDesignSnapshot(html: string): string {
  let wrappedBytes = new TextEncoder().encode(html).length + 2048;
  for (const character of html) {
    wrappedBytes += character === '&' ? 4 : character === '"' ? 5 : character === '<' ? 3 : 0;
    if (wrappedBytes > 32 * 1024 * 1024) throw new Error('Snapshot wrapper exceeds size limit');
  }
  const escaped = html.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;overflow:hidden}iframe{display:block}</style></head><body><iframe id="snapshot" sandbox="allow-scripts" srcdoc="${escaped}"></iframe><script>
const child=document.getElementById('snapshot');let frame=null;
const show=()=>{if(frame!==null)child.contentWindow.postMessage({vetd:true,type:'show-frame',id:frame},'*')};
addEventListener('message',event=>{
 const data=event.data;
 if(!data||data.vetd!==true)return;
 if(event.source===parent&&data.type==='show-frame'&&typeof data.id==='string'&&data.id.length<=256){frame=data.id;show()}
 else if(event.source===child.contentWindow&&event.origin==='null'&&data.type==='ready'){show();parent.postMessage({vetd:true,type:'ready'},'*')}
});
child.addEventListener('load',show);
</script></body></html>`;
}

/** An independently-CSP'd Main URL, never inline HTML inheriting the privileged parent's policy. */
export function mountDesignSnapshot(html: string, ready: (url: string) => void): () => void {
  let disposed = false;
  let previewId: string | null = null;
  const close = (id: string) => {
    void Promise.resolve()
      .then(() => window.electronAPI.design.preview({ op: 'close', previewId: id }))
      .catch(() => {});
  };
  void Promise.resolve()
    .then(() => window.electronAPI.design.preview({ op: 'open', html: wrapDesignSnapshot(html) }))
    .then((result) => {
      if (!result.ok || !('url' in result)) return;
      if (disposed) {
        close(result.previewId);
        return;
      }
      previewId = result.previewId;
      ready(result.url);
    })
    .catch(() => {
      /* Older/unavailable Main: structural preview only, never srcdoc fallback. */
    });
  return () => {
    if (disposed) return;
    disposed = true;
    if (previewId) close(previewId);
  };
}
