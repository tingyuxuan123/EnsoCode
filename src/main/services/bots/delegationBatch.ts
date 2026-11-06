import type { Delegation } from '../../../shared/types/bot';

type NameOf = (botId: string) => string;
export const TASK_FOLLOWUP_PREFIX = 'task-followup:';

export const isActiveDelegation = (record: Delegation) =>
  record.state === 'queued' || record.state === 'running';
export const escapeXml = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

/** 批次 = 同一父会话同一轮（batchId）发起的委派；无 batchId 的记录各自成批 */
const batchKey = (record: Delegation) =>
  `${record.parentConversationId}\n${record.batchId ?? record.id}`;

export function delegationBatches(records: readonly Delegation[]): Delegation[][] {
  const batches = new Map<string, Delegation[]>();
  for (const record of records) {
    const key = batchKey(record);
    batches.set(key, [...(batches.get(key) ?? []), record]);
  }
  return [...batches.values()]
    .map((batch) => batch.sort((a, b) => a.createdAt - b.createdAt))
    .sort((a, b) => a[0].createdAt - b[0].createdAt);
}

/** 单委派沿用 delegationId；多委派用持久化的 batchId，重启后仍稳定 */
export const batchDeliveryId = (batch: readonly Delegation[]) =>
  batch.length > 1 ? (batch[0].batchId ?? batch[0].id) : batch[0].id;

/** 没送达或执行结束前没跑完的追加，写在结果末尾 */
const missedAppends = (record: Delegation) => {
  const missed = record.appends?.filter((item) => item.ok === false) ?? [];
  return missed.length
    ? `\n\n[Appended requests not handled in this run (not delivered, or the run ended first):\n${missed
        .map((item) => `- ${item.text.length > 200 ? `${item.text.slice(0, 200)}…` : item.text}`)
        .join('\n')}]`
    : '';
};

const blockedBody = (record: Delegation) =>
  `Blocked. Needs: ${record.blocked?.need ?? ''}${record.blocked?.waitFor === 'human' ? ' (waiting for a human)' : ''}${record.result ? `\n\n${record.result}` : ''}`;

export const delegationResultBody = (record: Delegation) =>
  (record.state === 'completed'
    ? (record.result ?? '')
    : record.state === 'blocked'
      ? blockedBody(record)
      : record.failure === 'check' && record.result
        ? `${record.error ?? 'check'}\n\n${record.result}`
        : (record.error ?? record.failure ?? record.state)) + missedAppends(record);

export function batchResultText(
  batch: readonly Delegation[],
  nameOf: NameOf,
  awaitingHumanRecovery?: ReadonlySet<string>
): string {
  const items = batch.map(
    (record) =>
      `<delegation-result id="${record.id}" from="${escapeXml(nameOf(record.targetBotId))}" status="${record.state}">${
        awaitingHumanRecovery?.has(record.id)
          ? 'Awaiting human recovery. Do not retry or re-delegate this task.'
          : escapeXml(delegationResultBody(record))
      }</delegation-result>`
  );
  return batch.length > 1
    ? [
        `<delegation-results id="${batchDeliveryId(batch)}">`,
        ...items,
        '</delegation-results>',
      ].join('\n')
    : items[0];
}

const stateLabel = (record: Delegation) =>
  record.state === 'completed'
    ? '已完成'
    : record.state === 'canceled'
      ? '已取消'
      : record.state === 'blocked'
        ? '已交回（缺信息）'
        : record.failure === 'timeout'
          ? '已超时'
          : record.failure === 'interrupted'
            ? '已中断'
            : record.failure === 'check'
              ? '验收未通过'
              : '执行失败';

/** 批次里还有未到终态的成员时，提示谁结束了、这批还在等谁；「卡住」只留给 blocked 进度行 */
export function batchWaitingNotice(
  batch: readonly Delegation[],
  finished: Delegation,
  nameOf: NameOf
): string | null {
  const waiting = batch.filter((record) => record.id !== finished.id && isActiveDelegation(record));
  if (!waiting.length) return null;
  return `${nameOf(finished.targetBotId)} ${stateLabel(finished)}，这批还在等 ${waiting
    .map((record) => nameOf(record.targetBotId))
    .join('、')}`;
}

/** 某父会话某一轮新建委派的目标成员 */
export const turnDelegationTargets = (
  records: readonly Delegation[],
  parentConversationId: string,
  turnKey: string
): string[] => [
  ...new Set(
    records
      .filter(
        (record) =>
          record.parentConversationId === parentConversationId && record.batchId === turnKey
      )
      .map((record) => record.targetBotId)
  ),
];
