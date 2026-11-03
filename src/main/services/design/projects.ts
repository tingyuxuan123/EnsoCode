import { randomUUID } from 'node:crypto';
import { mkdir, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import type { DesignProjectsRequest, DesignProjectsResponse } from '@shared/types/design';
import type { SourceAuthorityRegistry } from '../sourceAuthorityRegistry';
import { DesignServiceError, isErrno } from './errors';
import type { DesignStorage } from './storage';

const ARCHIVED = 'gallery/archived-projects.json';
export function validDesignProjectName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 120 &&
    value.trim() === value &&
    !/[\\/:*?"<>|]/.test(value) &&
    ![...value].some((char) => char.charCodeAt(0) < 32) &&
    !value.startsWith('.') &&
    !value.endsWith('.') &&
    !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  );
}

export class DesignProjectsService {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly workspace: string,
    private readonly registry: Pick<
      SourceAuthorityRegistry,
      'rendererProjection' | 'createProject'
    >,
    private readonly storage: DesignStorage
  ) {}
  request(request: DesignProjectsRequest): Promise<DesignProjectsResponse> {
    const next = this.queue.catch(() => {}).then(() => this.perform(request));
    this.queue = next;
    return next;
  }
  private async archived(): Promise<Set<string>> {
    const response = await this.storage.request({
      op: 'readFile',
      path: ARCHIVED,
      encoding: 'utf8',
    });
    if (!response.ok || !('data' in response))
      throw new Error('Could not read gallery preferences');
    if (response.data === null) return new Set();
    const ids: unknown = JSON.parse(response.data);
    if (!Array.isArray(ids) || ids.length > 10000 || !ids.every((id) => typeof id === 'string'))
      throw new Error('Invalid gallery archive preferences');
    return new Set(ids);
  }
  private async perform(request: DesignProjectsRequest): Promise<DesignProjectsResponse> {
    const projects = this.registry
      .rendererProjection()
      .projects.filter((p) => p.state === 'active' && (p.kind === undefined || p.kind === 'local'))
      .map((p) => ({ projectId: p.projectId, path: p.canonicalPath }));
    if (request.op === 'create') {
      if (!validDesignProjectName(request.name))
        throw new DesignServiceError('INVALID_ARGUMENT', 'Invalid design project name');
      await mkdir(this.workspace, { recursive: true });
      const root = await realpath(this.workspace);
      for (let suffix = 0; suffix < 10000; suffix++) {
        const destination = path.join(root, `${request.name}${suffix ? `-${suffix}` : ''}`);
        try {
          await mkdir(destination);
        } catch (error) {
          if (isErrno(error, 'EEXIST')) continue;
          throw error;
        }
        const result = this.registry.createProject({ requestId: randomUUID(), path: destination });
        if (!result.accepted) {
          await rm(destination, { recursive: true, force: true });
          throw new DesignServiceError('FAILED', result.error);
        }
        return {
          ok: true,
          project: { projectId: result.value.projectId, path: result.value.canonicalPath },
        };
      }
      throw new DesignServiceError('FAILED', 'Too many projects with the same name');
    }
    const archived = await this.archived();
    if (request.op === 'list')
      return {
        ok: true,
        workspacePath: this.workspace,
        projects: projects.filter((p) => !archived.has(p.projectId)),
        archivedProjects: projects.filter((p) => archived.has(p.projectId)),
      };
    if (!projects.some((p) => p.projectId === request.projectId))
      throw new DesignServiceError('NOT_FOUND', 'Local project is unavailable');
    if (request.archived) archived.add(request.projectId);
    else archived.delete(request.projectId);
    const saved = await this.storage.request({
      op: 'commit',
      changes: [
        {
          type: 'write',
          path: ARCHIVED,
          data: JSON.stringify([...archived].sort()),
          encoding: 'utf8',
        },
      ],
    });
    if (!saved.ok) throw new DesignServiceError('FAILED', saved.error);
    return { ok: true };
  }
}
