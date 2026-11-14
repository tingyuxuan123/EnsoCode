// Run with Electron, NOT node --test. HTTPS is intercepted in this isolated session.
const { app, session, BrowserWindow } = require('electron');
globalThis[Symbol.for('collabra.kdocs.electron-fixture')] = require('electron');
const { mkdtemp, readFile, rm, writeFile, mkdir } = require('node:fs/promises');
const { join } = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const root = join(__dirname, '../../..');
if (process.platform === 'darwin') app.setActivationPolicy('prohibited');
app.on('window-all-closed', () => {});
let failed = false;
process.on('unhandledRejection', (error) => {
  failed = true;
  console.error('Unexpected harness rejection', error?.message ?? String(error));
});
app
  .whenReady()
  .then(async () => {
    const directory = await mkdtemp(join(tmpdir(), 'collabra-kdocs-electron-'));
    app.setPath('userData', directory);
    const { createServer } = await import('vite');
    const vite = await createServer({
      root,
      configFile: false,
      envFile: false,
      publicDir: false,
      appType: 'custom',
      plugins: [
        {
          name: 'isolate-worker-entry-paths',
          enforce: 'pre',
          resolveId(id) {
            if (id.endsWith('?modulePath')) return `\0fixture-module-path:${id}`;
          },
          load(id) {
            if (id.startsWith('\0fixture-module-path:'))
              return 'export default "fixture-worker-not-spawned.cjs"';
          },
        },
      ],
      optimizeDeps: { noDiscovery: true },
      server: { middlewareMode: true, hmr: false, watch: null },
      resolve: {
        alias: {
          '@shared': join(root, 'src/shared'),
          electron: join(__dirname, 'electron-bridge.mjs'),
        },
      },
    });
    let host;
    const deadline = setTimeout(() => {
      console.error('FAIL: isolated browser deadline');
      app.exit(1);
    }, 150000);
    try {
      if (process.env.KDOCS_UI_SHOT) {
        const win = new BrowserWindow({
          show: false,
          width: 440,
          height: 820,
          webPreferences: {
            sandbox: true,
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
          },
        });
        try {
          const page = win.webContents;
          await page.loadURL('about:blank');
          page.debugger.attach('1.3');
          await page.debugger.sendCommand('Emulation.setDeviceMetricsOverride', {
            width: 440,
            height: 820,
            deviceScaleFactor: 1,
            mobile: false,
          });
          const state = {
            configured: true,
            connected: true,
            settings: { url: 'https://www.kdocs.cn/l/demo', sheet: '需求清单2026', owner: '谢' },
            tasks: [
              { id: 'demo', description: '优化 PWA 应用的图片显示', status: '', claimable: true },
            ],
            execution: null,
            preview: null,
          };
          const ui = await readFile(join(root, 'examples/plugins/kdocs-tasks/tasks.html'), 'utf8');
          const withBridge = ui.replace(
            '<head>',
            `<head><script>window.enso={call:async()=>(${JSON.stringify(state)})};</script>`
          );
          await page.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(withBridge)}`);
          await page.executeJavaScript(
            'new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'
          );
          const screenshot = await page.debugger.sendCommand('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
          });
          const target = join(root, 'dist/plugins/requirements-ui-v020.png');
          await mkdir(join(root, 'dist/plugins'), { recursive: true });
          await writeFile(target, Buffer.from(screenshot.data, 'base64'));
          console.log(JSON.stringify({ uiPreview: true, path: target, sampleDataOnly: true }));
        } finally {
          win.destroy();
        }
        return;
      }
      const { BrowserHost, partitionName } = await vite.ssrLoadModule(
        '/src/main/services/browserHost.ts'
      );
      const fixture = await readFile(join(__dirname, 'spreadsheet-fixture.html'), 'utf8');
      const profile = session.fromPartition(partitionName(false));
      const liveUrl = process.env.KDOCS_LIVE_URL;
      if (!liveUrl)
        await profile.protocol.handle(
          'https',
          () => new Response(fixture, { headers: { 'content-type': 'text/html; charset=utf-8' } })
        );
      host = new BrowserHost();
      const { createController } = await import(
        pathToFileURL(join(root, 'examples/plugins/kdocs-tasks/lib/controller.mjs')).href
      );
      const { BrowserSheet } = await import(
        pathToFileURL(join(root, 'examples/plugins/kdocs-tasks/lib/browser-sheet.mjs')).href
      );
      const owner = 'isolated-kdocs-smoke';
      const { createPluginBrowserBridge } = await vite.ssrLoadModule(
        '/src/main/services/pluginBrowserBridge.ts'
      );
      const readonlyBridge = createPluginBrowserBridge({
        authorizeSession: () => ({ ok: true, sessionKey: owner }),
        isSessionCurrent: () => true,
        authoritativeUrl: (key, id) => host.tabUrl(id, key),
        currentTabId: (key) => host.agentTabId(key),
        run: (run) =>
          host.invoke(run.sessionKey, run.op, run.params, run.actor, {
            signal: run.signal,
            guard: run.guard,
          }),
        inspect: (request) =>
          host.inspectElements(request.tabId, request.sessionKey, request.selector),
      });
      const invoke = async (op, params) => {
        if (op === 'read_range')
          return readonlyBridge({
            kind: 'ui',
            sessionId: owner,
            projectRoot: directory,
            op,
            params,
            domains: ['www.kdocs.cn', 'kdocs.cn', 'ap.wps.com'],
            signal: AbortSignal.timeout(30000),
          });
        if (op === 'inspect') return host.inspectElements(params.tabId, owner, params.selector);
        const result = await host.invoke(
          owner,
          op === 'read'
            ? 'read_text'
            : op === 'copy_selection'
              ? 'plugin_copy_selection'
              : op === 'insert_text'
                ? 'plugin_insert_text'
                : op,
          params
        );
        return result;
      };
      const enso = {
        dataDir: join(directory, 'plugin-data'),
        config: {
          get: async () => ({
            document_url: 'https://www.kdocs.cn/l/isolated-fixture',
            first_row: 2,
            last_row: 2,
            enable_writes: true,
          }),
        },
        browser: { invoke },
      };
      const sheets = [];
      const controller = createController(enso, {
        sheetFactory: (_invoke, config) => {
          const sheet = new BrowserSheet(invoke, config);
          sheets.push(sheet);
          return sheet;
        },
      });
      const ctx = {
        sessionId: owner,
        projectRoot: directory,
        agent: null,
        signal: AbortSignal.timeout(140000),
      };
      if (liveUrl) {
        const loaded = await controller.call('load', { url: liveUrl, owner: '谢' }, ctx);
        console.log(
          JSON.stringify({
            liveRead: true,
            tasks: loaded.tasks.map((task) => ({
              description: task.description,
              status: task.status,
              claimable: task.claimable,
            })),
            sheet: loaded.settings.sheet,
          })
        );
        const address = process.env.KDOCS_LIVE_TEST_CELL;
        if (address) {
          assert.match(address, /^H(?:[1-9][0-9]+)$/);
          const sheet = sheets.find((item) => item.tabId);
          assert.equal(await sheet.readCell(address), '', 'Live test cell must be blank');
          const marker = '需求助手：读写测试，完成后清空';
          try {
            await sheet.writeCell(address, '', marker);
            assert.equal(await sheet.readCell(address), marker);
          } finally {
            const actual = await sheet.readCell(address);
            if (actual === marker) await sheet.writeCell(address, marker, '');
          }
          assert.equal(await sheet.readCell(address), '');
          console.log(
            JSON.stringify({
              liveWritePassed: true,
              address,
              restoredBlank: true,
              existingTaskStatusChanged: false,
            })
          );
        }
      } else {
        // 与截图同形：没有worker、没有模型请求，写策略拒绝时仍应完成固定整表读取。
        const { PluginHostGate } = await vite.ssrLoadModule(
          '/src/main/services/extensionPlugins/gate.ts'
        );
        const manifest = JSON.parse(
          await readFile(join(root, 'examples/plugins/kdocs-tasks/enso-plugin.json'), 'utf8')
        );
        const policy = async () => ({ allowWrite: false, allowMcpCall: false });
        const gate = new PluginHostGate({
          manifest: () => manifest,
          approved: () => true,
          browser: readonlyBridge,
          now: () => Date.now(),
          invocationPolicy: policy,
        });
        const invocation = gate.invocations.create({
          pluginId: manifest.id,
          sessionId: owner,
          projectRoot: directory,
          kind: 'ui',
          gesture: true,
        });
        const coldSheet = new BrowserSheet(
          (op, params) => gate.handle(manifest.id, 'browser.invoke', { op, params }, invocation),
          {
            url: 'https://www.kdocs.cn/l/isolated-fixture',
            canonical: 'https://www.kdocs.cn/l/isolated-fixture',
            sheet: '需求清单2026',
          }
        );
        const readonly = await coldSheet.readTable({ discover: true });
        assert.match(readonly.text, /ERP-1/);
        await assert.rejects(
          gate.handle(
            manifest.id,
            'browser.invoke',
            { op: 'insert_text', params: { tabId: coldSheet.tabId, text: '不得写入' } },
            invocation
          )
        );
        console.log(
          JSON.stringify({
            coldPlanReadPassed: true,
            workerStarted: false,
            modelRequests: 0,
            genericWriteDenied: true,
            range: readonly.range,
          })
        );
        await controller.call('connect', {}, ctx);
        await controller.call('calibrate', { address: 'A1', expected: '编号' }, ctx);
        await controller.call('test_write', { address: 'Z99' }, ctx);
        const synced = await controller.call('sync', { reset: true }, ctx);
        assert.equal(synced.tasks[0].id, 'ERP-1');
        const preview = await controller.call('prepare_claim', { taskId: 'ERP-1' }, ctx);
        const claimed = await controller.call('confirm', { token: preview.preview.token }, ctx);
        assert.equal(claimed.execution.phase, 'claimed');
        const current = await controller.getTask(ctx);
        assert.equal(current.task.owner, '谢');
        const input = {
          taskId: 'ERP-1',
          summary: '隔离夹具交付',
          cause: '演示字段校验',
          impact: '夹具订单',
          reproduction: ['打开订单', '保存'],
          environment: '隔离本地夹具',
          version: 'fixture',
          prerequisites: '无真实账号',
          steps: ['使用合法名称保存'],
          expected: '保存成功',
          actual: '未执行业务测试',
          regression: '未执行',
          unverified: '非真实ERP业务测试',
          verification: 'not_tested',
          deployment: 'not_deployed',
          evidence: [],
        };
        const candidate = await controller.report(input, ctx);
        await controller.call('save_report', { candidate }, ctx);
        const delivery = await controller.call('prepare_delivery', {}, ctx);
        const delivered = await controller.call('confirm', { token: delivery.preview.token }, ctx);
        assert.equal(delivered.execution.phase, 'delivered');
        console.log(
          JSON.stringify({
            passed: true,
            fixtureOnly: true,
            realDocumentWrites: 0,
            ownerPreserved: true,
            finalPhase: delivered.execution.phase,
          })
        );
      }
    } catch (error) {
      failed = true;
      console.error('FAIL: isolated plugin browser fixture', error.message, error.stack);
      if (process.env.KDOCS_LIVE_URL && host) {
        try {
          console.error(
            'LIVE_PAGE_STATE',
            String(await host.invoke('isolated-kdocs-smoke', 'snapshot', {})).slice(-6000)
          );
        } catch {}
      }
    } finally {
      clearTimeout(deadline);
      await host?.dispose();
      await vite.close();
      await rm(directory, { recursive: true, force: true });
      app.exit(failed ? 1 : 0);
    }
  })
  .catch((error) => {
    console.error(error.message);
    app.exit(1);
  });
