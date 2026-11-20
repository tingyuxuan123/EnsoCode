import fs from 'node:fs';
import path from 'node:path';
import { isVaultPreset, type VaultPreset } from '@shared/memory/constants';
import { defaultPresetForSpace } from '@shared/memory/presets';
import { MemoryValidationError, parseSpaceId, type ResolvedVaultSpace } from './types';

interface StoredBinding {
  externalRoot?: string;
  preset?: VaultPreset;
}

type BindingsFile = Record<string, StoredBinding>;

/**
 * Main 独占的 Vault 绑定表（`<memoryRoot>/vault-bindings.json`）。
 * 外部 Obsidian 目录路径不进 `settings.json` / `configSync`，避免跨设备污染。
 */
export class VaultBindingStore {
  private readonly filePath: string;
  private readonly vaultsRoot: string;
  private entries: BindingsFile;

  constructor(private readonly memoryRoot: string) {
    this.filePath = path.join(memoryRoot, 'vault-bindings.json');
    this.vaultsRoot = path.join(memoryRoot, 'vaults');
    this.entries = this.load();
  }

  private load(): BindingsFile {
    try {
      if (!fs.existsSync(this.filePath)) return {};
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
      const out: BindingsFile = {};
      for (const [spaceId, raw] of Object.entries(parsed as Record<string, unknown>)) {
        if (!parseSpaceId(spaceId) || !raw || typeof raw !== 'object' || Array.isArray(raw))
          continue;
        const row = raw as Record<string, unknown>;
        const entry: StoredBinding = {};
        if (typeof row.externalRoot === 'string' && row.externalRoot.trim()) {
          entry.externalRoot = path.resolve(row.externalRoot.trim());
        }
        if (isVaultPreset(row.preset)) entry.preset = row.preset;
        if (entry.externalRoot || entry.preset) out[spaceId] = entry;
      }
      return out;
    } catch {
      return {};
    }
  }

  private save(): void {
    fs.mkdirSync(this.memoryRoot, { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmp, `${JSON.stringify(this.entries, null, 2)}\n`, 'utf8');
    fs.renameSync(tmp, this.filePath);
  }

  managedPathFor(spaceId: string): string {
    const parsed = parseSpaceId(spaceId);
    if (!parsed) {
      throw new MemoryValidationError('invalid_space', `Invalid memory spaceId: ${spaceId}`);
    }
    switch (parsed.kind) {
      case 'global':
        return path.join(this.vaultsRoot, 'global');
      case 'project':
        return path.join(this.vaultsRoot, 'projects', parsed.id);
      case 'bot':
        return path.join(this.vaultsRoot, 'bots', parsed.id);
      case 'chat':
        return path.join(this.vaultsRoot, 'chats', parsed.id);
    }
  }

  resolveSpace(spaceId: string): ResolvedVaultSpace {
    const managedPath = this.managedPathFor(spaceId);
    const stored = this.entries[spaceId];
    const preset = stored?.preset ?? defaultPresetForSpace(spaceId);
    if (stored?.externalRoot) {
      return {
        spaceId,
        rootPath: stored.externalRoot,
        isExternal: true,
        preset,
      };
    }
    return {
      spaceId,
      rootPath: managedPath,
      isExternal: false,
      preset,
    };
  }

  bindExternal(spaceId: string, dirPath: string, preset?: VaultPreset): ResolvedVaultSpace {
    this.managedPathFor(spaceId); // validates spaceId
    const resolved = path.resolve(dirPath);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new MemoryValidationError(
        'invalid_vault',
        'Selected vault path must be an existing directory.'
      );
    }
    const canonical = fs.realpathSync(resolved);
    const prev = this.entries[spaceId];
    this.entries[spaceId] = {
      ...prev,
      externalRoot: canonical,
      ...(preset ? { preset } : {}),
    };
    this.save();
    return this.resolveSpace(spaceId);
  }

  unbind(spaceId: string): ResolvedVaultSpace {
    this.managedPathFor(spaceId);
    const prev = this.entries[spaceId];
    if (prev) {
      const { externalRoot: _removed, ...rest } = prev;
      if (Object.keys(rest).length > 0) this.entries[spaceId] = rest;
      else delete this.entries[spaceId];
      this.save();
    }
    return this.resolveSpace(spaceId);
  }

  setPreset(spaceId: string, preset: VaultPreset): ResolvedVaultSpace {
    this.managedPathFor(spaceId);
    this.entries[spaceId] = { ...this.entries[spaceId], preset };
    this.save();
    return this.resolveSpace(spaceId);
  }

  removeSpace(spaceId: string): void {
    const prev = this.entries[spaceId];
    if (prev) {
      delete this.entries[spaceId];
      this.save();
    }
  }

  /** 列出所有已知空间（含已绑定的外部空间与磁盘上已存在的托管目录） */
  listKnownSpaceIds(): string[] {
    const ids = new Set<string>(['global', ...Object.keys(this.entries)]);
    const scanKind = (subdir: string, prefix: string) => {
      const dir = path.join(this.vaultsRoot, subdir);
      if (!fs.existsSync(dir)) return;
      try {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
          const candidate = `${prefix}${entry.name}`;
          if (parseSpaceId(candidate)) ids.add(candidate);
        }
      } catch {}
    };
    scanKind('projects', 'proj:');
    scanKind('bots', 'bot:');
    scanKind('chats', 'chat:');
    return [...ids];
  }
}
