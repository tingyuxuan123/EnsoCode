import {
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  CHAT_FONT_WEIGHTS,
  CHAT_TYPOGRAPHY_PARTS,
  type ChatTypographyEntry,
  type ChatTypographyPart,
  chatTypographyVariables,
  normalizeChatTypography,
} from '@shared/chatTypography';
import { useEffect, useState } from 'react';
import { Markdown } from '@/components/chat/Markdown';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useI18n } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';

const LABELS: Record<ChatTypographyPart, string> = {
  body: 'Chat body',
  headings: 'Chat headings',
  table: 'Chat tables',
  codeBlock: 'Code blocks',
  inlineCode: 'Inline code',
};
const WEIGHT_ITEMS = CHAT_FONT_WEIGHTS.map((value) => ({
  value: String(value),
  label: String(value),
}));

function TypographyRow({
  part,
  value,
  onChange,
}: {
  part: ChatTypographyPart;
  value: ChatTypographyEntry;
  onChange: (value: ChatTypographyEntry) => void;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = useState(String(value.fontSize));
  useEffect(() => setDraft(String(value.fontSize)), [value.fontSize]);
  const label = t(LABELS[part]);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-sm font-medium">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min={CHAT_FONT_SIZE_MIN}
          max={CHAT_FONT_SIZE_MAX}
          step={1}
          className="w-20"
          aria-label={`${label} ${t('Font size')}`}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            const fontSize = Number(event.target.value);
            if (
              Number.isInteger(fontSize) &&
              fontSize >= CHAT_FONT_SIZE_MIN &&
              fontSize <= CHAT_FONT_SIZE_MAX
            )
              onChange({ ...value, fontSize });
          }}
          onBlur={() => setDraft(String(value.fontSize))}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur();
          }}
        />
        <span className="text-xs text-muted-foreground">px</span>
        <Select
          items={WEIGHT_ITEMS}
          value={String(value.fontWeight)}
          onValueChange={(weight) => {
            const fontWeight = CHAT_FONT_WEIGHTS.find((item) => String(item) === weight);
            if (fontWeight) onChange({ ...value, fontWeight });
          }}
        >
          <SelectTrigger className="w-24" aria-label={`${label} ${t('Font weight')}`}>
            <SelectValue />
          </SelectTrigger>
          <SelectPopup>
            {WEIGHT_ITEMS.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
      </div>
    </div>
  );
}

export function ChatTypographySettings() {
  const { t } = useI18n();
  const typography = useSettingsStore((state) => state.chatTypography);
  const setTypography = useSettingsStore((state) => state.setChatTypography);
  return (
    <section
      className="space-y-3 border-t border-line pt-5"
      data-settings-row="appearance.chatTypography"
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium">{t('Chat typography')}</h4>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setTypography(normalizeChatTypography(undefined))}
        >
          {t('Restore default typography')}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {t(
          'Adjust chat text proportionally in Code and Bot. File previews and the interface are unchanged.'
        )}
      </p>
      {CHAT_TYPOGRAPHY_PARTS.map((part) => (
        <TypographyRow
          key={part}
          part={part}
          value={typography[part]}
          onChange={(value) => setTypography({ ...typography, [part]: value })}
        />
      ))}
      <div
        data-chat-typography-preview=""
        style={chatTypographyVariables(typography)}
        className="rounded-md border bg-muted/20 p-3"
      >
        <p className="mb-2 text-xs text-muted-foreground">{t('Preview')}</p>
        <div className="text-[calc(15rem/14)] [&_h1]:text-[calc(18rem/14)] [&_h2]:text-[calc(18rem/14)] [&_h3]:text-[calc(16rem/14)]">
          <Markdown
            text={`# ${t('Chat headings')}\n\n${t('Chat body')} · **${t('Font weight')}** · \`inline code\`\n\n| ${t('Chat tables')} | Value |\n| --- | --- |\n| text | 123 |\n\n\`\`\`js\nconst message = "Hello";\n\`\`\``}
          />
        </div>
      </div>
    </section>
  );
}
