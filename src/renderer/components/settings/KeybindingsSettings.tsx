import { RotateCcw, X } from 'lucide-react';
import * as React from 'react';
import { Kbd } from '@/components/ui/kbd';
import { useI18n } from '@/i18n';
import {
  ACTION_HINT_KEYS,
  ACTION_LABEL_KEYS,
  DEFAULT_KEYBINDINGS,
  effectiveKeybindings,
  eventToBinding,
  formatBinding,
  KEYBINDING_ACTIONS,
  type KeybindingAction,
} from '@/lib/keybindings';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

export function KeybindingsSettings() {
  const { t } = useI18n();
  return (
    <div className="space-y-[24px]" data-slot="settings-page">
      <div data-settings-row="shortcuts.root">
        <h3 className="text-[calc(18rem/14)] font-semibold leading-[calc(26rem/14)]">
          {t('Shortcuts')}
        </h3>
        <p className="text-[calc(13rem/14)] text-muted-foreground">
          {t('Click a shortcut to rebind it. Backspace removes it; Esc cancels.')}
        </p>
      </div>
      <KeybindingsSection />
    </div>
  );
}

/** 快捷键改绑:点击当前键位进入录制,按下新组合保存;Esc 取消;与其它动作冲突时拒绝并提示 */
function KeybindingsSection() {
  const { t } = useI18n();
  const keybindings = useSettingsStore((s) => s.keybindings);
  const setKeybinding = useSettingsStore((s) => s.setKeybinding);
  const resetKeybinding = useSettingsStore((s) => s.resetKeybinding);
  const [capturing, setCapturing] = React.useState<KeybindingAction | null>(null);
  const [conflictWith, setConflictWith] = React.useState<KeybindingAction | null>(null);
  const bindings = effectiveKeybindings(keybindings);

  const capture = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!capturing) return;
    if (e.key === 'Escape') {
      setCapturing(null);
      setConflictWith(null);
      return;
    }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      setKeybinding(capturing, '');
      setCapturing(null);
      setConflictWith(null);
      return;
    }
    const binding = eventToBinding(e, {
      allowBare: capturing === 'send-message' || capturing === 'voice-hold',
    });
    if (!binding) return;
    const taken = KEYBINDING_ACTIONS.find(
      (action) => action !== capturing && bindings[action] === binding
    );
    if (taken) {
      setConflictWith(taken);
      return;
    }
    if (binding === DEFAULT_KEYBINDINGS[capturing]) resetKeybinding(capturing);
    else setKeybinding(capturing, binding);
    setCapturing(null);
    setConflictWith(null);
  };

  return (
    <div className="divide-y divide-line overflow-hidden rounded-[6px] border border-line">
      {KEYBINDING_ACTIONS.map((action) => {
        const isCapturing = capturing === action;
        const isCustom = keybindings[action] !== undefined;
        const binding = bindings[action];
        return (
          <div key={action} className="flex items-center gap-3 px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-[calc(13rem/14)]">{t(ACTION_LABEL_KEYS[action])}</p>
              {ACTION_HINT_KEYS[action] && (
                <p className="text-muted-foreground text-[calc(12rem/14)]">
                  {t(ACTION_HINT_KEYS[action])}
                </p>
              )}
            </div>
            {isCapturing && conflictWith && (
              <span className="text-[calc(12rem/14)] text-destructive">
                {t('Already used by "{{label}}"', { label: t(ACTION_LABEL_KEYS[conflictWith]) })}
              </span>
            )}
            {binding && !isCapturing && (
              <button
                type="button"
                title={t('Remove shortcut')}
                onClick={() => setKeybinding(action, '')}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
            {isCustom && !isCapturing && (
              <button
                type="button"
                title={t('Reset to default')}
                onClick={() => resetKeybinding(action)}
                className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setCapturing(action);
                setConflictWith(null);
              }}
              onKeyDown={isCapturing ? capture : undefined}
              onBlur={() => {
                if (isCapturing) {
                  setCapturing(null);
                  setConflictWith(null);
                }
              }}
              // biome-ignore lint/a11y/noAutofocus: 进入录制态即聚焦以捕获按键是预期交互
              autoFocus={isCapturing}
              className={cn(
                'rounded-[6px] px-1 py-0.5 transition-colors',
                isCapturing ? 'ring-1 ring-ring' : 'hover:bg-muted'
              )}
            >
              {isCapturing ? (
                <span className="text-[calc(12rem/14)] text-muted-foreground">
                  {t('Press shortcut…')}
                </span>
              ) : binding ? (
                <Kbd>{formatBinding(binding)}</Kbd>
              ) : (
                <span className="text-[calc(12rem/14)] text-muted-foreground">
                  {t('No shortcut')}
                </span>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}
