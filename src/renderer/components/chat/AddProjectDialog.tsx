import type { ProjectGroup, RecentProject, SshHostKeyChallenge } from '@shared/types';
import { Loader2 } from 'lucide-react';
import * as React from 'react';
import { hostKeyFromSshFailure, SshHostKeyDialog } from '@/components/chat/SshHostKeyDialog';
import {
  Autocomplete,
  AutocompleteEmpty,
  AutocompleteInput,
  AutocompleteItem,
  AutocompleteList,
  AutocompletePopup,
} from '@/components/ui/autocomplete';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs';
import { useI18n } from '@/i18n';
import { Z_INDEX } from '@/lib/z-index';
import { useSettingsStore } from '@/stores/settings';

/** 内嵌远程目录浏览：逐级钻取，选中回填路径输入框（避免嵌套 Dialog） */
function RemoteDirBrowser({
  connectionId,
  initialPath,
  hostKeyRetry = 0,
  fallbackHost,
  onSelect,
  onClose,
  onHostKey,
}: {
  connectionId: string;
  initialPath?: string;
  hostKeyRetry?: number;
  fallbackHost?: { host: string; port?: number };
  onSelect: (path: string) => void;
  onClose: () => void;
  onHostKey: (challenge: SshHostKeyChallenge) => void;
}) {
  const { t } = useI18n();
  const [path, setPath] = React.useState<string | null>(null);
  const [dirs, setDirs] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const requestSeq = React.useRef(0);
  const pathRef = React.useRef<string | null>(null);
  const onHostKeyRef = React.useRef(onHostKey);
  onHostKeyRef.current = onHostKey;
  const fallbackHostRef = React.useRef(fallbackHost);
  fallbackHostRef.current = fallbackHost;

  const load = React.useCallback(
    (target?: string, promptHostKey = true) => {
      const seq = ++requestSeq.current;
      setLoading(true);
      setError('');
      window.electronAPI.sshConnections
        .listDirs(connectionId, target)
        .then((result) => {
          if (seq !== requestSeq.current) return;
          if (result.ok) {
            setPath(result.path);
            pathRef.current = result.path;
            setDirs(result.dirs);
            return;
          }
          const challenge = hostKeyFromSshFailure(result, fallbackHostRef.current);
          if (challenge && promptHostKey) {
            onHostKeyRef.current(challenge);
            return;
          }
          setError(result.error);
        })
        .catch(() => {
          if (seq === requestSeq.current) setError(t('Failed to list remote directory.'));
        })
        .finally(() => {
          if (seq === requestSeq.current) setLoading(false);
        });
    },
    [connectionId, t]
  );

  // 仅挂载/切换连接时以当前输入为起点；后续导航由 load 驱动，不跟随输入框变化
  const initialRef = React.useRef(initialPath);
  React.useEffect(() => {
    const initial = initialRef.current;
    load(initial?.startsWith('/') ? initial : undefined);
  }, [load]);

  React.useEffect(() => {
    if (!hostKeyRetry) return;
    load(
      pathRef.current ?? (initialRef.current?.startsWith('/') ? initialRef.current : undefined),
      false
    );
  }, [hostKeyRetry, load]);

  const parent = path && path !== '/' ? path.replace(/\/[^/]+$/, '') || '/' : null;

  return (
    <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-[calc(11rem/14)]">
          {path ?? '…'}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[calc(11rem/14)]"
          disabled={!parent || loading}
          onClick={() => parent && load(parent)}
        >
          {t('Up')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[calc(11rem/14)]"
          onClick={onClose}
        >
          {t('Close')}
        </Button>
      </div>
      <div className="relative min-h-16 max-h-40 overflow-y-auto">
        {error ? (
          <p className="px-1 py-2 text-destructive text-[calc(11rem/14)]">{error}</p>
        ) : dirs.length === 0 && !loading ? (
          <p className="px-1 py-2 text-muted-foreground text-[calc(11rem/14)]">
            {t('No subdirectories')}
          </p>
        ) : (
          <div className={loading ? 'pointer-events-none space-y-0.5 opacity-40' : 'space-y-0.5'}>
            {dirs.map((dir) => (
              <button
                key={dir}
                type="button"
                className="block w-full truncate rounded px-1.5 py-1 text-left font-mono text-[calc(11rem/14)] hover:bg-muted"
                disabled={loading}
                onClick={() => path && load(path === '/' ? `/${dir}` : `${path}/${dir}`)}
              >
                {dir}/
              </button>
            ))}
          </div>
        )}
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/60">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="sr-only">{t('Loading...')}</span>
          </div>
        )}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 w-full text-[calc(11rem/14)]"
        disabled={!path || loading}
        onClick={() => path && onSelect(path)}
      >
        {t('Use this directory')}
      </Button>
    </div>
  );
}

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (request: {
    path: string;
    sshConnectionId?: string;
    sshHost?: string;
    groupId?: string;
  }) => void;
  groups?: readonly ProjectGroup[];
  defaultGroupId?: string;
}

export function AddProjectDialog({
  open,
  onOpenChange,
  onAdd,
  groups = [],
  defaultGroupId,
}: AddProjectDialogProps) {
  const { t } = useI18n();
  const projects = useSettingsStore((state) => state.projects);
  const [mode, setMode] = React.useState<'local' | 'ssh'>('local');
  const [pathValue, setPathValue] = React.useState('');
  const [sshConnectionId, setSshConnectionId] = React.useState('');
  const [sshPath, setSshPath] = React.useState('');
  const [connections, setConnections] = React.useState<
    Awaited<ReturnType<typeof window.electronAPI.sshConnections.list>>
  >([]);
  const [groupId, setGroupId] = React.useState<string | undefined>(defaultGroupId);
  const [browserOpen, setBrowserOpen] = React.useState(false);
  const [recent, setRecent] = React.useState<RecentProject[]>([]);
  const [formError, setFormError] = React.useState('');
  const [hostKey, setHostKey] = React.useState<SshHostKeyChallenge | null>(null);
  const [afterTrust, setAfterTrust] = React.useState<'submit' | 'browse' | null>(null);
  const [hostKeyRetry, setHostKeyRetry] = React.useState(0);
  const [trusting, setTrusting] = React.useState(false);
  const groupItems = React.useMemo(
    () => [
      { value: '', label: t('Ungrouped') },
      ...groups.map((group) => ({ value: group.id, label: group.name })),
    ],
    [groups, t]
  );

  React.useEffect(() => {
    if (!open) return;
    setMode('local');
    setPathValue('');
    setSshConnectionId('');
    setSshPath('');
    setGroupId(defaultGroupId);
    setBrowserOpen(false);
    setFormError('');
    setHostKey(null);
    setAfterTrust(null);
    setHostKeyRetry(0);
    window.electronAPI.sshConnections
      .list()
      .then(setConnections)
      .catch(() => setConnections([]));
    window.electronAPI.projects
      .getRecent()
      .then(setRecent)
      .catch(() => setRecent([]));
  }, [open, defaultGroupId]);

  const existing = React.useMemo(
    () => new Set(projects.map((project) => project.path)),
    [projects]
  );
  const items = React.useMemo(
    () => recent.filter((project) => !existing.has(project.path)),
    [recent, existing]
  );

  const filterProject = React.useCallback((project: RecentProject, query: string) => {
    if (!query) return true;
    const needle = query.toLowerCase();
    return (
      project.path.toLowerCase().includes(needle) ||
      project.displayPath.toLowerCase().includes(needle) ||
      project.sourceName.toLowerCase().includes(needle)
    );
  }, []);

  const handleBrowse = async () => {
    const selected = await window.electronAPI.dialog.selectDirectory();
    if (selected) setPathValue(selected);
  };

  const canSubmit =
    mode === 'local'
      ? pathValue.trim().length > 0
      : sshConnectionId.length > 0 && sshPath.trim().startsWith('/');

  const submitSsh = () => {
    const connection = connections.find((item) => item.id === sshConnectionId);
    onAdd({
      path: sshPath.trim(),
      sshConnectionId,
      sshHost: connection?.name,
      ...(groupId ? { groupId } : {}),
    });
    onOpenChange(false);
  };

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    if (mode !== 'ssh') {
      onAdd({ path: pathValue.trim(), ...(groupId ? { groupId } : {}) });
      onOpenChange(false);
      return;
    }
    setFormError('');
    const connection = connections.find((item) => item.id === sshConnectionId);
    void window.electronAPI.sshConnections.test(sshConnectionId).then((result) => {
      if (!result.ok) {
        const challenge = hostKeyFromSshFailure(result, connection);
        if (challenge) {
          setAfterTrust('submit');
          setHostKey(challenge);
          return;
        }
        setFormError(result.error);
        return;
      }
      submitSsh();
    });
  };

  const trustHost = async () => {
    if (!hostKey) return;
    setTrusting(true);
    const trusted = await window.electronAPI.sshConnections.trustHost(sshConnectionId);
    setTrusting(false);
    if (!trusted.ok) {
      setFormError(trusted.error || t('Could not save host key.'));
      setHostKey(null);
      setAfterTrust(null);
      return;
    }
    const resume = afterTrust;
    setHostKey(null);
    setAfterTrust(null);
    if (resume === 'browse') {
      setHostKeyRetry((value) => value + 1);
      return;
    }
    if (resume === 'submit') submitSsh();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form onSubmit={handleSubmit} className="flex flex-col">
          <DialogHeader>
            <DialogTitle>{t('Add project')}</DialogTitle>
            <DialogDescription>
              {t('Add a local directory as the conversation working folder.')}
            </DialogDescription>
          </DialogHeader>

          <DialogPanel className="space-y-4">
            <Tabs value={mode} onValueChange={(value) => setMode(value as 'local' | 'ssh')}>
              <TabsList>
                <TabsTab value="local">{t('Local directory')}</TabsTab>
                <TabsTab value="ssh">{t('Remote (SSH)')}</TabsTab>
              </TabsList>
            </Tabs>
            {mode === 'ssh' ? (
              <>
                <Field className="w-full">
                  <FieldLabel>{t('SSH connection')}</FieldLabel>
                  {connections.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      {t('Add an SSH connection in Settings first.')}
                    </p>
                  ) : (
                    <Select
                      items={[
                        { value: '', label: t('Select an SSH connection') },
                        ...connections.map((connection) => ({
                          value: connection.id,
                          label: `${connection.name} (${connection.user ? `${connection.user}@` : ''}${connection.host})`,
                        })),
                      ]}
                      value={sshConnectionId}
                      onValueChange={(value) => setSshConnectionId(value ?? '')}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                        <SelectItem value="">{t('Select an SSH connection')}</SelectItem>
                        {connections.map((connection) => (
                          <SelectItem key={connection.id} value={connection.id}>
                            {connection.name} ({connection.user ? `${connection.user}@` : ''}
                            {connection.host})
                          </SelectItem>
                        ))}
                      </SelectPopup>
                    </Select>
                  )}
                </Field>
                <Field className="w-full">
                  <FieldLabel>{t('Remote directory')}</FieldLabel>
                  <div className="flex w-full gap-2">
                    <Input
                      value={sshPath}
                      onChange={(event) => setSshPath(event.target.value)}
                      placeholder="/home/user/project"
                      autoCorrect="off"
                      autoCapitalize="off"
                      spellCheck={false}
                      className="min-w-0 flex-1"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!sshConnectionId}
                      onClick={() => setBrowserOpen((open) => !open)}
                    >
                      {t('Browse')}
                    </Button>
                  </div>
                </Field>
                {browserOpen && sshConnectionId && (
                  <RemoteDirBrowser
                    connectionId={sshConnectionId}
                    initialPath={sshPath.trim() || undefined}
                    hostKeyRetry={hostKeyRetry}
                    fallbackHost={connections.find((item) => item.id === sshConnectionId)}
                    onSelect={(selected) => {
                      setSshPath(selected);
                      setBrowserOpen(false);
                    }}
                    onClose={() => setBrowserOpen(false)}
                    onHostKey={(challenge) => {
                      setAfterTrust('browse');
                      setHostKey(challenge);
                    }}
                  />
                )}
                <p className="text-[calc(11rem/14)] text-muted-foreground">
                  {t('Tools run on the remote host; chat history stays local.')}
                </p>
                {formError && <p className="text-destructive text-[calc(11rem/14)]">{formError}</p>}
              </>
            ) : (
              <Field className="w-full">
                <FieldLabel>{t('Working directory')}</FieldLabel>
                <Autocomplete
                  value={pathValue}
                  onValueChange={(value) => setPathValue(value ?? '')}
                  items={items}
                  filter={filterProject}
                  itemToStringValue={(item) => item.path}
                >
                  <div className="flex w-full gap-2">
                    <div className="min-w-0 flex-1">
                      <AutocompleteInput
                        placeholder={t('Type a path or select from recent projects...')}
                        showClear={!!pathValue}
                        showTrigger
                      />
                    </div>
                    <Button type="button" variant="outline" onClick={() => void handleBrowse()}>
                      {t('Browse')}
                    </Button>
                  </div>
                  <AutocompletePopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                    <AutocompleteEmpty>{t('No matching projects found')}</AutocompleteEmpty>
                    <AutocompleteList>
                      {(project: RecentProject) => (
                        <AutocompleteItem key={project.path} value={project} className="gap-2">
                          <span className="min-w-0 flex-1 truncate" title={project.path}>
                            {project.displayPath}
                          </span>
                          <span className="shrink-0 text-[calc(11rem/14)] text-muted-foreground">
                            {project.sourceName}
                          </span>
                        </AutocompleteItem>
                      )}
                    </AutocompleteList>
                  </AutocompletePopup>
                </Autocomplete>
              </Field>
            )}
            {groups.length > 0 && (
              <Field>
                <FieldLabel>{t('Project group')}</FieldLabel>
                <Select
                  items={groupItems}
                  value={groupId ?? ''}
                  onValueChange={(value) => setGroupId(value || undefined)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
                    {groupItems.map((item) => (
                      <SelectItem key={item.value || 'ungrouped'} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </Field>
            )}
          </DialogPanel>

          <DialogFooter>
            <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              {t('Cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {t('Add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
      <SshHostKeyDialog
        challenge={hostKey}
        nested
        busy={trusting}
        onTrust={() => void trustHost()}
        onDismiss={() => {
          if (trusting) return;
          setHostKey(null);
          setAfterTrust(null);
        }}
      />
    </Dialog>
  );
}
