import {
  GOAL_TEMPLATES_MAX,
  type GoalSuggestedMember,
  type GoalSuggestion,
} from '@shared/bots/goalSuggest';
import { ArrowLeft, Loader2, Sparkles, Target } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/i18n';
import { useBotsStore } from '@/stores/bots';
import { useTeamTemplates } from '@/stores/bots/templateLibrary';
import { suggestErrorText } from './BotAbilities';
import { BotAvatar } from './BotAvatar';
import { AVATAR_PALETTE } from './BotFields';

export interface GoalPick {
  firstMessage: string;
  botId?: string;
  member?: GoalSuggestedMember;
  templateId?: string;
}

/** 目标式引导：优先已有成员，确认后打开私聊或创建对话框；首条消息只回填草稿 */
export function GoalOnboarding({ onPick }: { onPick: (pick: GoalPick) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const lang = locale === 'zh' ? 'zh' : 'en';
  const templates = useTeamTemplates();
  const bots = useBotsStore((s) => s.bots);
  const [goal, setGoal] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestion, setSuggestion] = useState<GoalSuggestion | null>(null);
  const [firstMessage, setFirstMessage] = useState('');

  const recommend = async () => {
    if (!goal.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await window.electronAPI.bots.suggestGoal({
        goal: goal.trim(),
        language: lang,
        ...(bots.length
          ? { members: bots.map(({ id, name, title, scope }) => ({ id, name, title, scope })) }
          : {}),
        templates: templates
          .slice(0, GOAL_TEMPLATES_MAX)
          .map(({ id, data }) => ({ id, title: data.title, summary: data.summary })),
      });
      if (!result.ok) {
        setError(suggestErrorText(result, t));
        return;
      }
      setSuggestion(result.suggestion);
      setFirstMessage(result.suggestion.firstMessage);
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (pick: GoalPick) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await onPick(pick);
    } catch {
      setError(t('Could not open chat. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (!suggestion) {
    return (
      <div className="w-full max-w-[520px] rounded-md border bg-background p-1.5 text-left focus-within:border-brand/60">
        <Textarea
          unstyled
          className="flex w-full text-[13.5px] leading-6 [&_textarea]:min-h-[64px] [&_textarea]:resize-none [&_textarea]:px-2.5 [&_textarea]:py-2"
          value={goal}
          autoFocus
          rows={3}
          placeholder={t('e.g. Track competitor news every week and send me a summary')}
          onChange={(event) => setGoal(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) void recommend();
          }}
        />
        {error && <p className="px-2.5 text-destructive text-xs">{error}</p>}
        <div className="flex justify-end px-1 pb-1">
          <Button size="sm" disabled={!goal.trim() || busy} onClick={() => void recommend()}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}
            {t('Recommend')}
          </Button>
        </div>
      </div>
    );
  }

  const template =
    suggestion.kind === 'team'
      ? templates.find((item) => item.id === suggestion.templateId)?.data
      : undefined;
  const member =
    suggestion.kind === 'existing'
      ? bots.find((bot) => bot.id === suggestion.botId)
      : suggestion.kind === 'member'
        ? { ...suggestion.member, avatar: { color: AVATAR_PALETTE[0] } }
        : undefined;

  return (
    <div className="w-full max-w-lg space-y-3 text-left">
      <div data-slot="bot-card" className="rounded-md border bg-card p-3">
        <p className="mb-2 flex items-center gap-1.5 text-muted-foreground text-xs">
          <Target className="h-3.5 w-3.5" />
          {suggestion.kind === 'team' ? t('Recommended: a team') : t('Recommended: one member')}
        </p>
        {member ? (
          <div className="flex items-start gap-2.5">
            <BotAvatar bot={member} />
            <div className="min-w-0">
              <p className="font-medium text-sm">
                {member.name}
                <span className="ml-2 font-normal text-muted-foreground text-xs">
                  {member.title}
                </span>
              </p>
              {member.scope && <p className="text-muted-foreground text-xs">{member.scope}</p>}
            </div>
          </div>
        ) : (
          template && (
            <div className="space-y-1.5">
              <div className="-space-x-1.5 flex">
                {template.members.map((member) => (
                  <BotAvatar
                    key={member.key}
                    size="sm"
                    bot={{ name: member.name, avatar: { color: member.color } }}
                  />
                ))}
              </div>
              <p className="font-medium text-sm">{template.title}</p>
              <p className="text-muted-foreground text-xs">{template.summary}</p>
            </div>
          )
        )}
        {suggestion.reason && (
          <p className="mt-2 text-muted-foreground text-xs">{suggestion.reason}</p>
        )}
      </div>
      <div className="space-y-1">
        <p className="text-muted-foreground text-xs">
          {t('First message (put into the input box, not sent)')}
        </p>
        <Textarea
          value={firstMessage}
          rows={3}
          onChange={(event) => setFirstMessage(event.target.value)}
        />
      </div>
      {error && <p className="text-destructive text-xs">{error}</p>}
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => {
            setSuggestion(null);
            setError(null);
          }}
        >
          <ArrowLeft />
          {t('Back')}
        </Button>
        <div className="flex gap-2">
          {suggestion.kind === 'existing' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void confirm({ firstMessage })}
            >
              {t('Create new instead')}
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || (suggestion.kind === 'existing' && !member)}
            onClick={() =>
              void confirm(
                suggestion.kind === 'existing'
                  ? { firstMessage, botId: suggestion.botId }
                  : suggestion.kind === 'member'
                    ? { firstMessage, member: suggestion.member }
                    : { firstMessage, templateId: suggestion.templateId }
              )
            }
          >
            {suggestion.kind === 'existing'
              ? t('Use this member')
              : suggestion.kind === 'member'
                ? t('Create this member')
                : t('Create this team')}
          </Button>
        </div>
      </div>
    </div>
  );
}
