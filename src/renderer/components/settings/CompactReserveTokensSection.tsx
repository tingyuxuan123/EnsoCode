import {
  COMPACT_RESERVE_TOKENS_DEFAULT,
  COMPACT_RESERVE_TOKENS_MAX,
  COMPACT_RESERVE_TOKENS_MIN,
  type CompactReserveTokensError,
  parseCompactReserveTokensDraft,
} from '@shared/compactionSettings';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';
import { NewSessionBadge } from './NewSessionBadge';

const errorText = (error: CompactReserveTokensError): string => {
  if (error === 'locked') return 'The pi settings file is busy. Try saving again shortly.';
  if (error === 'invalid-file')
    return 'The pi settings file is invalid. It has not been overwritten.';
  return 'Could not access the pi settings file. Try again.';
};

/** 独立 pi 全局设置，不复制进应用 settings store；空白表示删除覆盖。 */
export function CompactReserveTokensSection() {
  const { t } = useI18n();
  const [saved, setSaved] = useState<number | null>(null);
  const [draft, setDraft] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadVersion, setLoadVersion] = useState(0);
  const mounted = useRef(false);
  const busy = useRef(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: loadVersion 是读取失败后显式重试的触发器。
  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    void window.electronAPI.compaction.getReserveTokens().then(
      (result) => {
        if (cancelled) return;
        if (!result.ok) {
          setError(errorText(result.error));
          return;
        }
        setSaved(result.value);
        setDraft(result.value === null ? '' : String(result.value));
        setLoaded(true);
      },
      () => {
        if (!cancelled) setError('Could not access the pi settings file. Try again.');
      }
    );
    return () => {
      cancelled = true;
      mounted.current = false;
    };
  }, [loadVersion]);

  const commit = async () => {
    if (!loaded || busy.current) return;
    const value = parseCompactReserveTokensDraft(draft);
    if (value === undefined) {
      setError('Enter a whole number between {{min}} and {{max}}, or leave it empty.');
      return;
    }
    setError(null);
    if (value === saved) return;
    busy.current = true;
    setSaving(true);
    try {
      const result = await window.electronAPI.compaction.setReserveTokens(value);
      if (!mounted.current) return;
      if (!result.ok) {
        setError(errorText(result.error));
        return;
      }
      setSaved(value);
      setDraft(value === null ? '' : String(value));
    } catch {
      if (mounted.current) setError('Could not access the pi settings file. Try again.');
    } finally {
      busy.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <section
      className="space-y-[10px] border-t border-line pt-[20px]"
      data-settings-row="general.compactReserveTokens"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h4 className="font-medium text-[calc(14rem/14)]">
            {t('Compaction reserve tokens')}
            <NewSessionBadge />
          </h4>
          <p className="mt-0.5 text-muted-foreground text-[calc(12rem/14)]">
            {t(
              'Compaction runs when context exceeds the model window minus this value. Larger values compact earlier. Do not set it close to the window of small-context models. Leave empty for the default. Applies to newly started or recreated sessions.'
            )}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Input
            className="w-28"
            inputMode="numeric"
            aria-label={t('Compaction reserve tokens')}
            placeholder={String(COMPACT_RESERVE_TOKENS_DEFAULT)}
            disabled={!loaded || saving}
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void commit();
              }
            }}
          />
          <Button
            size="sm"
            variant="outline"
            disabled={!loaded || saving || parseCompactReserveTokensDraft(draft) === saved}
            onClick={() => void commit()}
          >
            {t('Save')}
          </Button>
        </div>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error, { min: COMPACT_RESERVE_TOKENS_MIN, max: COMPACT_RESERVE_TOKENS_MAX })}
        </p>
      )}
      {!loaded && error && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setError(null);
            setLoadVersion((version) => version + 1);
          }}
        >
          {t('Retry')}
        </Button>
      )}
    </section>
  );
}
