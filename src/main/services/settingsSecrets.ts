import { randomUUID } from 'node:crypto';
import { vendorOf } from '@shared/providerGroups';
import { isSecretReference } from '@shared/secretReference';

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
const entries = (value: unknown): Row[] =>
  Array.isArray(value) ? value.map(row).filter((item): item is Row => item !== null) : [];
const providerScope = (value: Row) => JSON.stringify([value.api, value.baseUrl]);
const mcpScope = (value: Row) =>
  JSON.stringify([value.transport, value.command, value.args ?? [], value.url]);
type Binding = { kind: string; id?: string; scope: string; field: string };
type Issued = Binding & { secret: string; expiresAt?: number };
const providerIdentity = (value: Row) =>
  value.oauthAccountPool
    ? JSON.stringify(['oauth-pool', value.oauthAccountPool])
    : value.oauthAccountKey
      ? JSON.stringify(['oauth', value.oauthAccountKey])
      : JSON.stringify([
          typeof value.baseUrl === 'string'
            ? value.baseUrl.trim().replace(/\/+$/, '')
            : value.baseUrl,
          value.apiKey,
          vendorOf({
            baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
            catalogId: typeof value.catalogId === 'string' ? value.catalogId : undefined,
            oauthAccountKey:
              typeof value.oauthAccountKey === 'string' ? value.oauthAccountKey : undefined,
          }),
        ]);

function storedSecrets(data: Row | null): Issued[] {
  const state = row(row(data?.['enso-settings'])?.state);
  if (!state) return [];
  const result: Issued[] = [];
  for (const provider of entries(state.providers)) {
    if (typeof provider.apiKey === 'string' && provider.apiKey)
      result.push({
        kind: 'provider',
        id: typeof provider.id === 'string' ? provider.id : undefined,
        scope: providerScope(provider),
        field: 'apiKey',
        secret: provider.apiKey,
      });
  }
  for (const server of entries(state.mcpServers))
    for (const field of ['env', 'headers']) {
      for (const [key, value] of Object.entries(row(server[field]) ?? {}))
        if (typeof value === 'string' && value)
          result.push({
            kind: 'mcp',
            id: typeof server.id === 'string' ? server.id : undefined,
            scope: mcpScope(server),
            field: `${field}.${key}`,
            secret: value,
          });
    }
  if (typeof state.voiceGeminiApiKey === 'string' && state.voiceGeminiApiKey)
    result.push({
      kind: 'voice',
      scope: 'gemini',
      field: 'apiKey',
      secret: state.voiceGeminiApiKey,
    });
  return result;
}

/** Kept in Main only. Handles are scoped to an entity, field and destination, and expire on restart. */
class SettingsSecrets {
  private readonly issued = new Map<string, Issued>();
  private readonly references = new Map<string, string>();

  hasPlaintext(data: Row): boolean {
    const state = row(row(data['enso-settings'])?.state);
    if (!state) return false;
    const plain = (value: unknown) =>
      typeof value === 'string' && value.length > 0 && !isSecretReference(value);
    return (
      entries(state.providers).some((p) => plain(p.apiKey)) ||
      entries(state.mcpServers).some((m) =>
        ['env', 'headers'].some((field) => Object.values(row(m[field]) ?? {}).some(plain))
      ) ||
      plain(state.voiceGeminiApiKey)
    );
  }

  needsRefresh(data: Row): boolean {
    return (
      this.hasPlaintext(data) ||
      storedSecrets(data).some(({ secret }) => this.issued.get(secret)?.expiresAt !== undefined)
    );
  }

  /** Called only after an accepted write: bind import authority and revoke deleted/replaced values. */
  didWrite(data: Row, submitted?: Row): void {
    const values = storedSecrets(data);
    const incoming = submitted
      ? new Map(storedSecrets(submitted).map((item) => [item.secret, item]))
      : new Map();
    for (const [ref, binding] of this.issued) {
      const transfer = binding.expiresAt !== undefined ? incoming.get(ref) : undefined;
      if (binding.expiresAt !== undefined && !transfer) {
        if (binding.expiresAt <= Date.now()) this.issued.delete(ref);
        continue;
      }
      const stored = values.find(
        (value) =>
          value.kind === binding.kind &&
          value.scope === binding.scope &&
          value.field === binding.field &&
          value.secret === binding.secret &&
          value.id === (transfer ? transfer.id : binding.id)
      );
      if (!stored) {
        // Duplicate imports can merge into an existing row; the submitted temporary ID is gone.
        this.issued.delete(ref);
        continue;
      }
      this.issued.set(ref, { ...stored });
    }
    this.references.clear();
    for (const [ref, { secret, expiresAt, ...binding }] of this.issued) {
      this.references.set(JSON.stringify([binding, secret]), ref);
    }
  }

  private protect(value: unknown, binding: Binding, imported = false): unknown {
    if (typeof value !== 'string' || !value) return value;
    const key = JSON.stringify([binding, value]);
    let ref = this.references.get(key);
    if (!ref) {
      ref = `enso-secret:${randomUUID()}`;
      this.references.set(key, ref);
      this.issued.set(ref, {
        ...binding,
        secret: value,
        ...(imported ? { expiresAt: Date.now() + 10 * 60_000 } : {}),
      });
    }
    return ref;
  }

  private restore(value: unknown, binding: Binding, current?: unknown): unknown {
    if (!isSecretReference(value)) return value;
    const issued = this.issued.get(value);
    if (
      !issued ||
      (issued.expiresAt !== undefined && issued.expiresAt <= Date.now()) ||
      issued.kind !== binding.kind ||
      issued.scope !== binding.scope ||
      issued.field !== binding.field ||
      (issued.id !== undefined && issued.id !== binding.id) ||
      (issued.expiresAt === undefined && issued.secret !== current)
    ) {
      throw new Error('Credential reference is stale or belongs to another destination');
    }
    return issued.secret;
  }

  provider<T extends object>(input: T, imported = false): T {
    const source = row(input)!;
    return {
      ...input,
      apiKey: this.protect(
        source.apiKey,
        {
          kind: 'provider',
          id: imported ? undefined : typeof source.id === 'string' ? source.id : undefined,
          scope: providerScope(source),
          field: 'apiKey',
        },
        imported
      ),
    };
  }

  mcp<T extends object>(input: T, imported = false): T {
    const source = row(input)!;
    const next = { ...input };
    for (const field of ['env', 'headers']) {
      const values = row(source[field]);
      if (!values) continue;
      next[field as keyof T] = Object.fromEntries(
        Object.entries(values).map(([key, value]) => [
          key,
          this.protect(
            value,
            {
              kind: 'mcp',
              id: imported ? undefined : typeof source.id === 'string' ? source.id : undefined,
              scope: mcpScope(source),
              field: `${field}.${key}`,
            },
            imported
          ),
        ])
      ) as T[keyof T];
    }
    return next;
  }

  project(data: Row | null): Row | null {
    if (!data) return null;
    this.didWrite(data);
    const next = structuredClone(data);
    const state = row(row(next['enso-settings'])?.state);
    if (!state) return next;
    if (Array.isArray(state.providers))
      state.providers = entries(state.providers).map((p) => this.provider(p));
    if (Array.isArray(state.mcpServers))
      state.mcpServers = entries(state.mcpServers).map((m) => this.mcp(m));
    if (typeof state.voiceGeminiApiKey === 'string')
      state.voiceGeminiApiKey = this.protect(state.voiceGeminiApiKey, {
        kind: 'voice',
        scope: 'gemini',
        field: 'apiKey',
      });
    return next;
  }

  restoreSettings(data: Row, current: Row | null): Row {
    const next = structuredClone(data);
    const state = row(row(next['enso-settings'])?.state);
    const old = row(row(current?.['enso-settings'])?.state);
    if (!state) return next;
    if (Array.isArray(state.providers)) {
      const incoming = entries(state.providers);
      const resolved: Row[] = incoming.map((p) => {
        const stored = entries(old?.providers).find(
          (v) => v.id === p.id && providerScope(v) === providerScope(p)
        );
        return {
          ...p,
          apiKey: this.restore(
            p.apiKey,
            {
              kind: 'provider',
              id: typeof p.id === 'string' ? p.id : undefined,
              scope: providerScope(p),
              field: 'apiKey',
            },
            stored?.apiKey
          ),
        };
      });
      const merged: Row[] = [];
      const knownIds = new Set(entries(old?.providers).map((p) => p.id));
      // Existing identity wins over imported or newly entered keys, even if input order changed.
      for (const p of resolved.filter((p) => knownIds.has(p.id))) merged.push(p);
      for (const p of resolved.filter((p) => !knownIds.has(p.id))) {
        const existing = merged.find((v) => providerIdentity(v) === providerIdentity(p));
        if (!existing) {
          merged.push(p);
          continue;
        }
        const models = entries(existing.models);
        const ids = new Set(models.map((m) => m.id));
        existing.models = [...models, ...entries(p.models).filter((m) => !ids.has(m.id))];
      }
      state.providers = merged;
    }
    if (Array.isArray(state.mcpServers))
      state.mcpServers = entries(state.mcpServers).map((m) => {
        const stored = entries(old?.mcpServers).find(
          (v) => v.id === m.id && mcpScope(v) === mcpScope(m)
        );
        const result = { ...m };
        for (const field of ['env', 'headers']) {
          const values = row(m[field]);
          if (values)
            result[field] = Object.fromEntries(
              Object.entries(values).map(([key, value]) => [
                key,
                this.restore(
                  value,
                  {
                    kind: 'mcp',
                    id: typeof m.id === 'string' ? m.id : undefined,
                    scope: mcpScope(m),
                    field: `${field}.${key}`,
                  },
                  row(stored?.[field])?.[key]
                ),
              ])
            );
        }
        return result;
      });
    if (typeof state.voiceGeminiApiKey === 'string')
      state.voiceGeminiApiKey = this.restore(
        state.voiceGeminiApiKey,
        {
          kind: 'voice',
          scope: 'gemini',
          field: 'apiKey',
        },
        old?.voiceGeminiApiKey
      );
    return next;
  }

  apiConfig<T extends { api: string; baseUrl: string; apiKey: string }>(
    input: T,
    providers: unknown
  ): T {
    if (!isSecretReference(input.apiKey)) return input;
    const issued = this.issued.get(input.apiKey);
    const stored = entries(providers).find(
      (p) => p.id === issued?.id && providerScope(p) === issued?.scope
    );
    return {
      ...input,
      apiKey: this.restore(
        input.apiKey,
        { kind: 'provider', id: issued?.id, scope: providerScope(input), field: 'apiKey' },
        stored?.apiKey
      ) as string,
    };
  }
}

export const settingsSecrets = new SettingsSecrets();
