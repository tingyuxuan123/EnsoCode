import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DefaultResourceLoader } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it } from 'vitest';
import { createLcuResourceLoader } from './lcuExtension';
import { createProjectSettingsManager, listProjectCodeSources } from './projectCode';

const dirs: string[] = [];
function tmp(): string {
  const dir = mkdtempSync(join(tmpdir(), 'enso-project-code-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

/** 项目里放一个加载即写标记文件的扩展、一个技能和带包/npm 命令的 settings */
function hostileProject() {
  const cwd = tmp();
  const agentDir = tmp();
  const extMarker = join(tmp(), 'ext-loaded');
  const npmMarker = join(tmp(), 'npm-ran');
  write(
    join(cwd, '.pi/extensions/evil.ts'),
    `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(extMarker)}, 'x');\nexport default function () {}\n`
  );
  write(
    join(cwd, '.pi/skills/demo/SKILL.md'),
    '---\nname: demo\ndescription: Demo skill for tests\n---\nBody\n'
  );
  write(
    join(cwd, '.agents/skills/shared/SKILL.md'),
    '---\nname: shared\ndescription: Shared\n---\n'
  );
  return { cwd, agentDir, extMarker, npmMarker };
}

function withPackages(cwd: string, npmMarker: string): void {
  write(
    join(cwd, '.pi/settings.json'),
    JSON.stringify({
      enableSkillCommands: true,
      packages: ['npm:@enso-test/definitely-missing-package'],
      extensions: ['./tools/extra.ts'],
      npmCommand: ['node', '-e', `require('fs').writeFileSync(${JSON.stringify(npmMarker)}, 'x')`],
    })
  );
}

async function load(cwd: string, agentDir: string, trusted: string[]) {
  const { settingsManager, blocked } = createProjectSettingsManager(cwd, agentDir, trusted);
  const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager, noThemes: true });
  await loader.reload();
  return { loader, blocked };
}

describe('listProjectCodeSources', () => {
  it('没有 .pi 时没有代码来源', () => {
    expect(listProjectCodeSources(tmp())).toEqual([]);
  });

  it('列出项目扩展、包、扩展路径与可执行命令设置', () => {
    const { cwd, npmMarker } = hostileProject();
    withPackages(cwd, npmMarker);
    write(join(cwd, '.pi/extensions/.hidden.ts'), '');
    expect(listProjectCodeSources(cwd)).toEqual([
      '.pi/extensions/evil.ts',
      'extension:./tools/extra.ts',
      'package:npm:@enso-test/definitely-missing-package',
      'setting:npmCommand',
    ]);
  });

  it('坏的 settings.json 不抛错', () => {
    const cwd = tmp();
    write(join(cwd, '.pi/settings.json'), '{oops');
    expect(listProjectCodeSources(cwd)).toEqual([]);
  });
});

describe('createProjectSettingsManager', () => {
  it('未信任时不加载项目扩展、不装项目包，但项目技能照常加载', async () => {
    const { cwd, agentDir, extMarker, npmMarker } = hostileProject();
    withPackages(cwd, npmMarker);
    const { loader, blocked } = await load(cwd, agentDir, []);
    expect(blocked).toContain('.pi/extensions/evil.ts');
    expect(existsSync(extMarker)).toBe(false);
    expect(existsSync(npmMarker)).toBe(false);
    expect(loader.getExtensions().extensions).toHaveLength(0);
    const names = loader.getSkills().skills.map((skill) => skill.name);
    expect(names).toEqual(expect.arrayContaining(['demo', 'shared']));
  });

  it('来源全部已信任时照常加载项目扩展', async () => {
    const { cwd, agentDir, extMarker } = hostileProject();
    const { loader, blocked } = await load(cwd, agentDir, ['.pi/extensions/evil.ts']);
    expect(blocked).toEqual([]);
    expect(existsSync(extMarker)).toBe(true);
    expect(loader.getExtensions().extensions).toHaveLength(1);
  });

  it('信任后新增的来源会让整个项目重新被拦下', async () => {
    const { cwd, agentDir, extMarker } = hostileProject();
    write(join(cwd, '.pi/extensions/second.ts'), 'export default function () {}\n');
    const { loader, blocked } = await load(cwd, agentDir, ['.pi/extensions/evil.ts']);
    expect(blocked).toEqual(['.pi/extensions/second.ts']);
    expect(existsSync(extMarker)).toBe(false);
    expect(loader.getExtensions().extensions).toHaveLength(0);
  });

  it('没有项目代码时与默认行为一致', async () => {
    const cwd = tmp();
    write(join(cwd, '.pi/settings.json'), JSON.stringify({ enableSkillCommands: false }));
    const { settingsManager, blocked } = createProjectSettingsManager(cwd, tmp(), []);
    expect(blocked).toEqual([]);
    expect(settingsManager.getEnableSkillCommands()).toBe(false);
  });
});

describe('LCU 独立加载开关', () => {
  function fixture() {
    const cwd = tmp();
    const agentDir = tmp();
    const extensionPath = join(tmp(), 'lcu/pi/extension.mjs');
    const marker = join(tmp(), 'lcu-loaded');
    write(
      extensionPath,
      `import { writeFileSync } from 'node:fs';
       writeFileSync(${JSON.stringify(marker)}, 'loaded');
       export default pi => {
         pi.registerTool({ name: 'js', label: 'LCU js', description: 'fixture',
           parameters: { type: 'object', properties: {} },
           execute: async () => ({ content: [{type:'text',text:'lcu'}], details: {} }) });
       };`
    );
    write(
      join(agentDir, 'extensions/other.ts'),
      `export default pi => pi.registerTool({ name: 'other', label: 'other', description: 'fixture',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({ content: [{type:'text',text:'other'}], details: {} }) });`
    );
    return { cwd, agentDir, extensionPath, marker };
  }

  async function loadLcu(
    f: ReturnType<typeof fixture>,
    lcuEnabled?: boolean,
    trusted: string[] = []
  ) {
    const { settingsManager } = createProjectSettingsManager(f.cwd, f.agentDir, trusted);
    const loader = await createLcuResourceLoader(
      { cwd: f.cwd, agentDir: f.agentDir, settingsManager, noThemes: true },
      lcuEnabled,
      f.extensionPath
    );
    await loader.reload();
    expect(loader.getExtensions().errors).toEqual([]);
    return loader.getExtensions().extensions.flatMap((extension) => [...extension.tools.keys()]);
  }

  it.each(['string', 'object'] as const)(
    '关闭时不执行 %s 包形式的 LCU，其他扩展保留且用户配置不改写',
    async (form) => {
      const f = fixture();
      const source = `./${relative(f.agentDir, f.extensionPath)}`;
      const file = join(f.agentDir, 'settings.json');
      const original = JSON.stringify({ packages: [form === 'string' ? source : { source }] });
      write(file, original);
      expect(await loadLcu(f, false)).toEqual(['other']);
      expect(existsSync(f.marker)).toBe(false);
      expect(readFileSync(file, 'utf8')).toBe(original);
    }
  );

  it('开启和缺省都沿用已安装的 LCU，关闭后重新开启可恢复', async () => {
    const f = fixture();
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ packages: [f.extensionPath] }));
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(await loadLcu(f, true)).toEqual(expect.arrayContaining(['js', 'other']));
    expect(await loadLcu(f)).toEqual(expect.arrayContaining(['js', 'other']));
  });

  it('阻止已信任项目显式引用和全局自动发现的符号链接别名', async () => {
    const f = fixture();
    const alias = join(f.agentDir, 'extensions/cua.js');
    symlinkSync(f.extensionPath, alias);
    write(join(f.cwd, '.pi/settings.json'), JSON.stringify({ extensions: [alias] }));
    expect(await loadLcu(f, false, listProjectCodeSources(f.cwd))).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('全局显式 extensions 路径关闭后不执行，不按工具名或文件名误伤其他扩展', async () => {
    const f = fixture();
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ extensions: [f.extensionPath] }));
    write(
      join(f.agentDir, 'extensions/lcu.ts'),
      `export default pi => pi.registerTool({ name: 'js', label: 'unrelated js', description:'fixture',
        parameters: {type:'object',properties:{}},
        execute: async () => ({content:[],details:{}}) });`
    );
    expect(await loadLcu(f, false)).toEqual(expect.arrayContaining(['js', 'other']));
    expect(existsSync(f.marker)).toBe(false);
  });

  it('开启不会自动安装或加载没有在 Pi 配置里启用的 LCU', async () => {
    const f = fixture();
    expect(await loadLcu(f, true)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('坏配置不让自动发现的 LCU 绕过关闭，仍不改写坏文件', async () => {
    const f = fixture();
    symlinkSync(f.extensionPath, join(f.agentDir, 'extensions/cua.js'));
    const file = join(f.agentDir, 'settings.json');
    write(file, '{broken');
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{broken');
  });

  it('从目录包或显式扩展目录加载时仍排除 LCU，但保留同包的其他扩展', async () => {
    const f = fixture();
    const packageDir = dirname(f.extensionPath);
    write(
      join(packageDir, 'package.json'),
      JSON.stringify({ pi: { extensions: ['extension.mjs', 'other.ts'] } })
    );
    write(
      join(packageDir, 'other.ts'),
      `export default pi => pi.registerTool({ name:'sibling', label:'sibling', description:'fixture',
        parameters:{type:'object',properties:{}},
        execute: async () => ({content:[], details:{}}) });`
    );
    const file = join(f.agentDir, 'settings.json');
    write(file, JSON.stringify({ packages: [packageDir] }));
    expect((await loadLcu(f, false)).sort()).toEqual(['other', 'sibling']);
    expect(existsSync(f.marker)).toBe(false);
    write(file, JSON.stringify({ extensions: [packageDir] }));
    expect((await loadLcu(f, false)).sort()).toEqual(['other', 'sibling']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it.each(['url', 'spaces'] as const)('关闭不能被 %s 包路径写法绕过', async (form) => {
    const f = fixture();
    const source = form === 'url' ? pathToFileURL(f.extensionPath).href : ` ${f.extensionPath} `;
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ packages: [source] }));
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('带 BOM 的合法 Pi 设置保留其他显式包和设置', async () => {
    const f = fixture();
    const other = join(tmp(), 'other.mjs');
    write(
      other,
      `export default pi => pi.registerTool({name:'extra',label:'extra',description:'fixture',
      parameters:{type:'object',properties:{}}, execute:async()=>({content:[],details:{}})});`
    );
    write(
      join(f.agentDir, 'settings.json'),
      `\uFEFF${JSON.stringify({ packages: [f.extensionPath, other] })}`
    );
    expect((await loadLcu(f, false)).sort()).toEqual(['extra', 'other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('自动发现目录的 manifest 引用安装入口及其别名也被关闭', async () => {
    const f = fixture();
    const dir = join(f.agentDir, 'extensions/lcu-adapter');
    write(join(dir, 'package.json'), JSON.stringify({ pi: { extensions: ['./launch.mjs'] } }));
    symlinkSync(f.extensionPath, join(dir, 'launch.mjs'));
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('安装入口自身为符号链接时，自动发现的目录包仍能排除它', async () => {
    const f = fixture();
    const original = readFileSync(f.extensionPath, 'utf8');
    rmSync(f.extensionPath);
    const target = join(tmp(), 'release.mjs');
    write(target, original);
    symlinkSync(target, f.extensionPath);
    const packageDir = dirname(f.extensionPath);
    write(
      join(packageDir, 'package.json'),
      JSON.stringify({ pi: { extensions: ['extension.mjs'] } })
    );
    symlinkSync(packageDir, join(f.agentDir, 'extensions/lcu'));
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('父目录里的独立 index 扩展不因包含 LCU 子目录而被误关', async () => {
    const f = fixture();
    const root = dirname(dirname(f.extensionPath));
    write(
      join(root, 'index.ts'),
      `export default pi => pi.registerTool({name:'parent',label:'parent',description:'fixture',
      parameters:{type:'object',properties:{}},execute:async()=>({content:[],details:{}})});`
    );
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ packages: [root] }));
    expect((await loadLcu(f, false)).sort()).toEqual(['other', 'parent']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('目录包的 index 入口是 LCU 符号链接时也不能绕过关闭', async () => {
    const f = fixture();
    const root = tmp();
    symlinkSync(f.extensionPath, join(root, 'index.ts'));
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ packages: [root] }));
    expect(await loadLcu(f, false)).toEqual(['other']);
    expect(existsSync(f.marker)).toBe(false);
  });

  it('关闭 LCU 保留 inline 工具，重复 reload 仍不执行 LCU', async () => {
    const f = fixture();
    write(join(f.agentDir, 'settings.json'), JSON.stringify({ packages: [f.extensionPath] }));
    const { settingsManager } = createProjectSettingsManager(f.cwd, f.agentDir, []);
    const loader = await createLcuResourceLoader(
      {
        cwd: f.cwd,
        agentDir: f.agentDir,
        settingsManager,
        noThemes: true,
        extensionFactories: [
          (pi) =>
            pi.registerTool({
              name: 'computer',
              label: 'Computer fixture',
              description: 'independent tool',
              parameters: { type: 'object', properties: {} },
              execute: async () => ({ content: [], details: {} }),
            }),
        ],
      },
      false,
      f.extensionPath
    );
    for (let i = 0; i < 2; i++) {
      await loader.reload();
      expect(loader.getExtensions().errors).toEqual([]);
      expect(
        loader
          .getExtensions()
          .extensions.flatMap((ext) => [...ext.tools.keys()])
          .sort()
      ).toEqual(['computer', 'other']);
      expect(existsSync(f.marker)).toBe(false);
    }
  });
});
