import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';
import { RunawayGuard } from './runawayGuard';
import { SystemReminderRegistry } from './systemReminder';
import { decorateSessionTools } from './toolDecorators';
import { ToolOutputBudget } from './toolOutputBudget';

describe('decorateSessionTools', () => {
  it('codemode 嵌套调用（<parent>/<n>）拿原始结果，不吞 system reminder', async () => {
    const reminders = new SystemReminderRegistry();
    let pending = ['remember this'];
    reminders.register('test', () => pending.splice(0));
    const tool = {
      name: 'probe',
      label: 'probe',
      description: 'probe',
      parameters: { type: 'object', properties: {} },
      execute: async () => ({
        content: [{ type: 'text' as const, text: 'raw' }],
        details: undefined,
      }),
    } as unknown as ToolDefinition;
    const [decorated] = decorateSessionTools([tool], {
      reminders,
      runaway: new RunawayGuard(),
      budget: new ToolOutputBudget({ rootDir: mkdtempSync(path.join(tmpdir(), 'enso-deco-')) }),
    });
    const nested = await decorated.execute('call_1/2', {}, undefined, undefined, {} as never);
    expect(nested.content).toEqual([{ type: 'text', text: 'raw' }]);
    expect(pending).toEqual(['remember this']);
    const direct = await decorated.execute('call_1', {}, undefined, undefined, {} as never);
    expect(JSON.stringify(direct.content)).toContain('remember this');
    pending = [];
  });

  it('codemode 禁用的工具标为 model-only：模型可直接调用，但不进脚本可调用集', () => {
    const make = (name: string) =>
      ({
        name,
        label: name,
        description: name,
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [], details: undefined }),
      }) as unknown as ToolDefinition;
    const [todo, read] = decorateSessionTools([make('todo'), make('read_file')], {
      reminders: new SystemReminderRegistry(),
      runaway: new RunawayGuard(),
      budget: new ToolOutputBudget({ rootDir: mkdtempSync(path.join(tmpdir(), 'enso-deco-')) }),
    });
    expect(todo.exposure).toBe('model-only');
    expect(read.exposure).toBeUndefined();
  });
});
