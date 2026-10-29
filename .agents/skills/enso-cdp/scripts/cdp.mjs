#!/usr/bin/env node
// EnsoCode CDP 驱动脚本（免依赖，node >= 22）。用法：
//   node cdp.mjs pages                          列出可连接的 page 目标
//   node cdp.mjs eval '<js>' [--page settings]  在页面里执行 JS（支持 await/Promise）
//   node cdp.mjs shot /tmp/x.png [--page ...]   截图存文件
//   node cdp.mjs keys ArrowDown ArrowDown Enter 受信任按键（走浏览器真实输入管线）
//   node cdp.mjs type '@rev'                    受信任文本输入（Input.insertText）
//   node cdp.mjs drag '<fromJS>' '<toJS>'       受信任鼠标拖拽（press→分段move→release）
//     from/to 是返回 {x,y} 的 JS 表达式，如 '(()=>{const r=document.querySelector("x").getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()'
// --page 匹配 URL 子串，缺省 index.html（主窗口）；设置窗口用 --page settings.html。
//
// 何时用 keys/type 而非 eval 里的合成事件：合成 KeyboardEvent 的 isTrusted=false，
// 且不经过 IME/焦点管线；排查"真实键盘行为"必须用受信任事件。

import { connect, fetchJson, parseArgs, selectPage, waitUntil } from './cdp-core.mjs';
import {
  browserPid,
  checkFocus,
  click,
  ensureFocus,
  focusExpression,
  readyExpression,
} from './cdp-input.mjs';
import { sessionAction } from './cdp-session.mjs';

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const { command: cmd, rest, port, timeout } = options;
  const list = await fetchJson(port, '/json/list');
  if (cmd === 'pages') {
    if (!Array.isArray(list)) throw new Error('CDP_UNREACHABLE: invalid target list');
    for (const target of list.filter((x) => x.type === 'page')) console.log(target.url);
    return;
  }
  const page = selectPage(list, options.page);
  const rpc = await connect(page.webSocketDebuggerUrl, { timeout, expectedPort: port });
  const send = rpc.send;
  const evaluate = async (expression) => {
    const response = await send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (response.result?.exceptionDetails)
      throw new Error(
        `EVALUATE_EXCEPTION: ${JSON.stringify(response.result.exceptionDetails).slice(0, 2000)}`
      );
    return response.result?.result?.value;
  };
  const context = {
    send,
    evaluate,
    async activate() {
      if (process.platform !== 'darwin') return;
      // SystemInfo is browser-target-only. Never activate a process by name: multiple
      // Electron apps/profiles may be running, and only this CDP browser PID is safe.
      let browser;
      try {
        const version = await fetchJson(port, '/json/version');
        browser = await connect(version.webSocketDebuggerUrl, { timeout, expectedPort: port });
        const info = await browser.send('SystemInfo.getProcessInfo');
        const pid = browserPid(info);
        if (!pid) return;
        const { execFile } = await import('node:child_process');
        await new Promise((resolve, reject) =>
          execFile(
            'osascript',
            [
              '-e',
              `tell application "System Events" to set frontmost of (first process whose unix id is ${pid}) to true`,
            ],
            { timeout: Math.min(timeout, 5000) },
            (error) => (error ? reject(error) : resolve())
          )
        );
        await waitUntil(
          async () => {
            const state = await evaluate(focusExpression);
            return state?.visible && state.focused;
          },
          { timeout: Math.min(timeout, 2000), interval: 100 }
        );
      } catch {
        // ensureFocus checks the observable result and requests manual focus.
      } finally {
        browser?.close();
      }
    },
  };
  try {
    await send('Runtime.enable');
    if (cmd === 'ready') {
      const result = await waitUntil(
        async () => {
          const state = await evaluate(readyExpression(rest[0]));
          return state?.ready && state;
        },
        { timeout }
      );
      console.log(JSON.stringify(result));
    } else if (cmd === 'click') {
      console.log(JSON.stringify(await click(context, rest[0], options)));
    } else if (cmd.startsWith('session-')) {
      await waitUntil(async () => (await evaluate(readyExpression(undefined, true)))?.ready, {
        timeout,
      });
      const input = {
        command: cmd,
        id: rest[0],
        text: rest[1],
        providerId: options.providerId,
        modelId: options.modelId,
        afterSeq: options.afterSeq,
      };
      const action = (value) =>
        evaluate(`(${sessionAction.toString()})(window,${JSON.stringify(value)})`);
      let result;
      if (cmd === 'session-wait') {
        const first = await action({ ...input, command: 'session-state' });
        const afterSeq = options.afterSeq ?? first.afterSeq;
        let last = first;
        try {
          result = await waitUntil(
            async () => {
              last = await action({ ...input, command: 'session-state', afterSeq });
              return (!last.ok || last.waiting || last.complete) && last;
            },
            { timeout }
          );
        } catch (error) {
          if (error.message !== 'WAIT_TIMEOUT') throw error;
          result = {
            ...last,
            ok: false,
            complete: false,
            success: false,
            timedOut: true,
            error: 'WAIT_TIMEOUT: no confirmed turn settlement; do not resend automatically',
          };
        }
      } else result = await action(input);
      console.log(JSON.stringify(result));
      if (!result?.ok || result.waiting || result.success === false) process.exitCode = 1;
    } else if (cmd === 'eval') {
      const v = await evaluate(rest[0]);
      console.log(typeof v === 'string' ? v : JSON.stringify(v));
    } else if (cmd === 'shot') {
      const out = rest[0] || '/tmp/enso-shot.png';
      const shot = await send('Page.captureScreenshot', { format: 'png' });
      const { writeFileSync } = await import('node:fs');
      writeFileSync(out, Buffer.from(shot.result.data, 'base64'));
      console.log(out);
    } else if (cmd === 'keys') {
      await ensureFocus(context);
      // 常用键的 keyCode 映射；其余按 key 名直接发（现代前端多读 event.key）
      const CODES = {
        ArrowDown: 40,
        ArrowUp: 38,
        ArrowLeft: 37,
        ArrowRight: 39,
        Enter: 13,
        Escape: 27,
        Tab: 9,
        Backspace: 8,
      };
      for (const key of rest) {
        const keyCode = CODES[key];
        const base = {
          key,
          code: key,
          ...(keyCode ? { windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode } : {}),
        };
        await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...base });
        await send('Input.dispatchKeyEvent', { type: 'keyUp', ...base });
        await new Promise((r) => setTimeout(r, 120));
      }
      await checkFocus(context);
      console.log('sent:', rest.join(' '));
    } else if (cmd === 'type') {
      await ensureFocus(context);
      await send('Input.insertText', { text: rest[0] ?? '' });
      await checkFocus(context);
      console.log('typed');
    } else if (cmd === 'drag') {
      await ensureFocus(context);
      const evalJson = evaluate;
      const from = await evalJson(rest[0]);
      const to = await evalJson(rest[1]);
      const mouse = (type, x, y, extra = {}) =>
        send('Input.dispatchMouseEvent', {
          type,
          x,
          y,
          button: 'left',
          buttons: 1,
          clickCount: type === 'mouseMoved' ? 0 : 1,
          pointerType: 'mouse',
          ...extra,
        });
      await mouse('mouseMoved', from.x, from.y, { buttons: 0 });
      await mouse('mousePressed', from.x, from.y);
      // 分段移动：dnd-kit PointerSensor 需要超过 activation 阈值的连续真实移动
      const steps = 20;
      for (let i = 1; i <= steps; i++) {
        await mouse(
          'mouseMoved',
          from.x + ((to.x - from.x) * i) / steps,
          from.y + ((to.y - from.y) * i) / steps
        );
        await new Promise((r) => setTimeout(r, 25));
      }
      await new Promise((r) => setTimeout(r, 150)); // 悬停让 droppable 识别
      await mouse('mouseReleased', to.x, to.y, { buttons: 0 });
      await new Promise((r) => setTimeout(r, 200));
      await checkFocus(context);
      console.log('dragged', JSON.stringify(from), '->', JSON.stringify(to));
    }
  } finally {
    rpc.close();
  }
}

main().catch((error) => {
  const command = process.argv[2];
  if (['session-new', 'session-send'].includes(command))
    console.log(
      JSON.stringify({
        ok: false,
        accepted: false,
        error: error.message,
        outcome: 'If dispatch began, its outcome may be unknown. Never automatically retry.',
      })
    );
  else console.error(error.message);
  process.exitCode = 1;
});
