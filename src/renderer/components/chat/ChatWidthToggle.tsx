import { FoldHorizontal, UnfoldHorizontal } from 'lucide-react';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';

/** 切换聊天区内容列宽（阅读宽度 / 全宽）；放进聊天卡片顶栏右侧，紧贴受其影响的容器。 */
export function ChatWidthToggle({ className }: { className?: string }) {
  const { t } = useI18n();
  const chatWide = useSettingsStore((s) => Boolean(s.chatWide));
  const label = chatWide ? t('Use reading width') : t('Use full chat width');

  return (
    <button
      type="button"
      data-slot="chat-width-toggle"
      aria-pressed={chatWide}
      aria-label={label}
      title={label}
      onClick={() => useSettingsStore.getState().setChatWide(!chatWide)}
      className={cn(
        'flex size-[calc(26rem/14)] shrink-0 items-center justify-center rounded-[calc(6rem/14)] transition-colors hover:bg-secondary/60 hover:text-foreground',
        chatWide ? 'text-foreground' : 'text-muted-foreground',
        className
      )}
    >
      {chatWide ? (
        <FoldHorizontal className="size-[calc(14rem/14)]" />
      ) : (
        <UnfoldHorizontal className="size-[calc(14rem/14)]" />
      )}
    </button>
  );
}
