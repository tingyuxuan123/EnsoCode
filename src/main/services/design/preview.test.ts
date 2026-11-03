import { afterEach, expect, it } from 'vitest';
import { DesignPreviewService, designPreviewPorts } from './preview';

const services: DesignPreviewService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((s) => s.dispose()));
});
it('serves bounded HTML at an unguessable loopback URL with a dedicated sandbox CSP', async () => {
  const service = new DesignPreviewService();
  services.push(service);
  const opened = await service.request(7, { op: 'open', html: '<h1>preview</h1>' });
  if (!('url' in opened)) throw new Error('missing URL');
  const response = await fetch(opened.url);
  expect(await response.text()).toBe('<h1>preview</h1>');
  const policy = response.headers.get('content-security-policy');
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain('sandbox allow-scripts');
  expect(policy).not.toContain('allow-same-origin');
  expect(designPreviewPorts(7).has(Number(new URL(opened.url).port))).toBe(true);
  expect(designPreviewPorts(8).size).toBe(0);
  expect((await fetch(new URL('/unknown', opened.url))).status).toBe(404);
  expect((await fetch(opened.url, { method: 'POST' })).status).toBe(405);
  await expect(service.request(8, { op: 'close', previewId: opened.previewId })).rejects.toThrow();
  await service.request(7, { op: 'close', previewId: opened.previewId });
  expect(designPreviewPorts(7).size).toBe(0);
  expect((await fetch(opened.url)).status).toBe(404);
});
it('releases URLs on owner close and enforces per-owner preview limits', async () => {
  const service = new DesignPreviewService();
  services.push(service);
  for (let i = 0; i < 8; i++) await service.request(7, { op: 'open', html: String(i) });
  await expect(service.request(7, { op: 'open', html: 'overflow' })).rejects.toThrow();
  service.releaseOwner(7);
  expect(designPreviewPorts(7).size).toBe(0);
  await expect(service.request(7, { op: 'open', html: 'late' })).rejects.toThrow();
});
