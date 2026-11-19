import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const matrixArchExpression = ['$', '{{ matrix.arch }}'].join('');
const readJson = (name: string) => JSON.parse(readFileSync(path.join(root, name), 'utf8'));
const readWorkflow = (name: string) =>
  parse(readFileSync(path.join(root, '.github', 'workflows', name), 'utf8'));

function stepIndex(steps: Array<{ run?: string }>, fragment: string): number {
  return steps.findIndex((step) => step.run?.includes(fragment));
}

describe('device host build entry', () => {
  it('ships the utility process entry that Main forks through ?modulePath', () => {
    expect(existsSync(path.join(root, 'src/device-host/index.ts'))).toBe(true);
    expect(existsSync(path.join(root, 'src/device-host/start.ts'))).toBe(true);
  });

  it('keeps its runtime helpers outside the bundle, where they can be executed', () => {
    expect(existsSync(path.join(root, 'tools/install/device-helpers.mjs'))).toBe(true);
  });

  it('prepares helpers for development, local packaging and every release workflow', () => {
    const scripts = readJson('package.json').scripts as Record<string, string>;
    expect(scripts.predev).toContain('pnpm fetch:device-helpers');
    expect(scripts.postbuild).toContain('pnpm fetch:device-helpers');

    for (const [workflow, jobs] of [
      ['build.yml', ['build-mac', 'build-windows', 'build-linux']],
      ['build-windows.yml', ['build-windows']],
      ['build-personal-mac.yml', ['build-personal-mac']],
    ] as const) {
      const parsed = readWorkflow(workflow);
      for (const job of jobs) {
        const steps = parsed.jobs[job].steps as Array<{ run?: string }>;
        const helpers = stepIndex(steps, 'fetch:device-helpers');
        const packageApp = stepIndex(steps, 'electron-builder');
        expect(helpers, `${workflow} ${job} helper step`).toBeGreaterThanOrEqual(0);
        expect(helpers, `${workflow} ${job} helper order`).toBeLessThan(packageApp);
      }
    }
  });

  it('builds macOS helpers for the package architecture instead of the runner architecture', () => {
    const workflow = readWorkflow('build.yml');
    const macSteps = workflow.jobs['build-mac'].steps as Array<{
      name?: string;
      run?: string;
      env?: Record<string, string>;
    }>;
    const helper = macSteps.find((step) => step.run?.includes('fetch:device-helpers'));
    expect(helper?.env?.npm_config_arch).toBe(matrixArchExpression);

    const personal = readWorkflow('build-personal-mac.yml');
    const personalHelper = (
      personal.jobs['build-personal-mac'].steps as Array<{
        run?: string;
        env?: Record<string, string>;
      }>
    ).find((step) => step.run?.includes('fetch:device-helpers'));
    expect(personalHelper?.env?.npm_config_arch).toBe('arm64');
  });
});
