import { isValidPresetPort, presetPortOf, withPresetPort } from '@shared/presetProviders';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useI18n } from '@/i18n';

/**
 * 预设服务商只开放端口：主机与路径固定，用户能改的只有端口号。
 *
 * 为什么不复用 `ProviderEditDialog`：`ProviderApiForm` 在「地址变了但没重新输入 key」
 * 时会禁用保存（`needsReentry`）。预设的 key 是 Main 侧的 secret reference，用户既看不到
 * 也输不了，走通用表单改端口会被永久挡住。这里只做「改端口 → 拉模型 → 成功才保存」。
 */

interface PresetProviderPortDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 展示名，用于标题 */
  name: string;
  /** 当前生效的地址 */
  baseUrl: string;
  /** 正在提交（拉模型 + 落盘），期间禁用按钮 */
  saving: boolean;
  /** 返回是否保存成功；成功才关闭弹窗 */
  onSubmit: (nextBaseUrl: string) => Promise<boolean>;
}

export function PresetProviderPortDialog({
  open,
  onOpenChange,
  name,
  baseUrl,
  saving,
  onSubmit,
}: PresetProviderPortDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState(() => presetPortOf(baseUrl));

  // 每次打开都从当前地址重取端口，避免上次取消留下的草稿被当成现值
  React.useEffect(() => {
    if (open) setDraft(presetPortOf(baseUrl));
  }, [open, baseUrl]);

  const valid = isValidPresetPort(draft);
  const prefix = React.useMemo(() => {
    try {
      const url = new URL(baseUrl);
      return `${url.protocol}//${url.hostname}:`;
    } catch {
      return '';
    }
  }, [baseUrl]);

  const submit = async () => {
    if (saving) return;
    const next = withPresetPort(baseUrl, draft);
    if (!next) return;
    if (await onSubmit(next)) onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('Change port')}</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel>{t('Port')}</FieldLabel>
          <div className="flex items-center gap-2">
            {prefix && (
              <span className="shrink-0 font-mono text-[calc(12rem/14)] text-muted-foreground">
                {prefix}
              </span>
            )}
            <Input
              value={draft}
              // 只留数字，最长 5 位：端口不存在别的合法形态
              onChange={(event) => setDraft(event.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              autoFocus
              aria-label={t('Port')}
              aria-invalid={!valid}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void submit();
                }
              }}
            />
          </div>
          {!valid && (
            <p className="text-[calc(12rem/14)] text-destructive">
              {t('Port must be an integer between 1 and 65535')}
            </p>
          )}
        </Field>
        <DialogFooter>
          <Button variant="outline" size="sm" disabled={saving} onClick={() => onOpenChange(false)}>
            {t('Cancel')}
          </Button>
          <Button size="sm" disabled={!valid || saving} onClick={() => void submit()}>
            {t('Save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
