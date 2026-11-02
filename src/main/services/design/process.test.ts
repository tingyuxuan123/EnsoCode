import type { ChildProcess } from 'node:child_process';
import { expect, it } from 'vitest';
import { allocateFreePort, OutputTail, runCommand } from './process';

it('环形尾巴包括单个超大块，按字节有界且保留末尾', () => {
  const tail = new OutputTail(12);
  tail.append(Buffer.from('abcdefghijklmnop'));
  expect(tail.text()).toBe('efghijklmnop');
  tail.append(Buffer.from('末尾'));
  expect(Buffer.byteLength(tail.text())).toBeLessThanOrEqual(12);
  expect(tail.text().endsWith('末尾')).toBe(true);
});
it('只在 loopback 分配有效端口', async () => {
  const port = await allocateFreePort();
  expect(port).toBeGreaterThan(0);
  expect(port).toBeLessThanOrEqual(65535);
});
it('固定脚本 stdout 与 stderr 分开，JSON 不受诊断文字污染', async () => {
  const output = await runCommand(
    process.execPath,
    [
      '-e',
      'process.stderr.write("diagnostic");process.stdout.write(JSON.stringify({ok:true,data:"x".repeat(70000)}))',
    ],
    { cwd: process.cwd(), timeoutMs: 5000, captureStdout: true, stdoutLimitBytes: 100000 }
  );
  expect(JSON.parse(output)).toMatchObject({ ok: true, data: 'x'.repeat(70000) });
});
it('脚本 stdout 超限返回 TOO_LARGE，不截断成坏 JSON', async () => {
  await expect(
    runCommand(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], {
      cwd: process.cwd(),
      timeoutMs: 5000,
      captureStdout: true,
      stdoutLimitBytes: 100,
    })
  ).rejects.toMatchObject({ code: 'TOO_LARGE' });
});
it('超时返回前进程已回收，不能在 job 移除后留下后台子进程', async () => {
  let child: ChildProcess | undefined;
  await expect(
    runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], {
      cwd: process.cwd(),
      timeoutMs: 50,
      onChild: (c) => {
        child = c;
      },
    })
  ).rejects.toMatchObject({ code: 'TIMEOUT' });
  expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
});
