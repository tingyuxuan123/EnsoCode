import { describe, expect, it } from 'vitest';
import { agentTypeCapabilitySummary } from './agentTypeCapabilities';

describe('子代理能力说明复用权威工具档', () => {
  it('父会话禁写时 all 类型也明确没有 shell 和编辑工具', () => {
    const text = agentTypeCapabilitySummary(
      { name: 'worker', tools: 'all', allowModelOverride: true, writeScope: ['**/*.test.ts'] },
      { workspaceWrite: false, isolatedSandbox: false }
    );
    expect(text).toContain('no shell or file-edit tools');
    expect(text).not.toContain('bash');
    expect(text).not.toContain('apply_patch');
    expect(text).not.toContain('codemode');
    expect(text).not.toContain('file-edit scope');
  });
  it('按 Windows shell、替换编辑档和范围展示，不展示 MCP 凭证', () => {
    const text = agentTypeCapabilitySummary(
      {
        name: 'tester',
        tools: 'all',
        allowModelOverride: true,
        writeScope: ['**/*.test.ts'],
        mcpServers: [
          {
            name: 'private',
            transport: 'stdio',
            command: 'sensitive',
            env: { SECRET: 'do-not-expose' },
          },
        ],
      },
      { shell: 'powershell', editMode: 'replace', exploreFold: true }
    );
    expect(text).toContain('powershell, edit, write');
    expect(text).toContain('explore_mark, explore_fold');
    expect(text).toContain('**/*.test.ts');
    expect(text).not.toContain('bash');
    expect(text).not.toContain('do-not-expose');
    expect(text).not.toContain('sensitive');
  });
});
