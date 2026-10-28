import { formatCost, formatTokens } from '@shared/usage/format';
import * as React from 'react';
import { Button } from '@/components/ui/button';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/utils';

export interface RankingRow {
  key: string;
  name: string;
  cost: number | null;
  tokens: number;
  /** 第三列（消息数 / 会话数） */
  count: number;
}

interface RankingTableProps {
  title: string;
  countLabel: string;
  rows: RankingRow[];
  emptyLabel: string;
  limit?: number;
}

/** 排行表：名称 + 占比条 | 费用 | Tokens | 计数。占比按表内 tokens 总量。 */
export function RankingTable({
  title,
  countLabel,
  rows,
  emptyLabel,
  limit = 8,
}: RankingTableProps) {
  const { t } = useI18n();
  const [expanded, setExpanded] = React.useState(false);
  const total = rows.reduce((sum, row) => sum + row.tokens, 0);
  const overflow = rows.length > limit;
  const visible = overflow && !expanded ? rows.slice(0, limit) : rows;
  return (
    <section className="min-w-0" data-slot="usage-ranking">
      <div className="mb-[6px] flex items-center justify-between gap-2">
        <h4 className="text-[calc(13rem/14)] font-medium">{title}</h4>
        {overflow && (
          <span className="text-[calc(11rem/14)] text-muted-foreground">
            {expanded
              ? t('{{total}} items', { total: rows.length })
              : t('Top {{count}} of {{total}}', { count: limit, total: rows.length })}
          </span>
        )}
      </div>
      <div
        className="min-w-0 overflow-x-auto rounded-[6px] border border-line"
        data-slot="usage-ranking-frame"
      >
        {visible.length === 0 ? (
          <p className="py-6 text-center text-[calc(12rem/14)] text-muted-foreground">
            {emptyLabel}
          </p>
        ) : (
          <table className="w-full min-w-[21rem] table-fixed text-[calc(12rem/14)]">
            <colgroup>
              <col />
              <col className="w-[calc(64rem/14)]" />
              <col className="w-[calc(56rem/14)]" />
              <col className="w-[calc(64rem/14)]" />
            </colgroup>
            <thead>
              <tr className="border-b border-line text-[calc(11rem/14)] text-muted-foreground">
                <th className="px-[12px] py-[6px] text-left font-normal">{t('Name')}</th>
                <th className="px-[8px] py-[6px] text-right font-normal">{t('Cost')}</th>
                <th className="px-[8px] py-[6px] text-right font-normal">{t('Token')}</th>
                <th className="pr-[12px] py-[6px] text-right font-normal whitespace-nowrap">
                  {countLabel}
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => {
                const share = total > 0 ? row.tokens / total : 0;
                return (
                  <tr key={row.key}>
                    <td className="relative overflow-hidden px-[12px] py-[6px]">
                      <span
                        aria-hidden
                        className="absolute inset-y-[4px] left-0 rounded-r-[3px] bg-primary/10"
                        style={{ width: `${share * 100}%` }}
                      />
                      <div className="relative truncate" title={row.name}>
                        {row.name || t('(no project)')}
                      </div>
                    </td>
                    <td
                      className={cn(
                        'px-[8px] py-[6px] text-right tabular-nums whitespace-nowrap',
                        row.cost === null && 'text-muted-foreground'
                      )}
                    >
                      {formatCost(row.cost)}
                    </td>
                    <td
                      className="px-[8px] py-[6px] text-right tabular-nums whitespace-nowrap"
                      title={`${formatTokens(row.tokens)} · ${(share * 100).toFixed(0)}%`}
                      aria-label={`${formatTokens(row.tokens)} · ${(share * 100).toFixed(0)}%`}
                    >
                      {formatTokens(row.tokens)}
                    </td>
                    <td
                      className="truncate pr-[12px] py-[6px] text-right tabular-nums"
                      title={String(row.count)}
                    >
                      {row.count}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="border-t border-line px-[12px] py-[6px] text-[calc(11rem/14)] text-faint">
          {t('{{total}} items', { total: rows.length })}
        </p>
      </div>
      {overflow && (
        <Button
          variant="ghost"
          size="xs"
          className="mt-2 w-full text-muted-foreground"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? t('Collapse') : t('Show all')}
        </Button>
      )}
    </section>
  );
}
