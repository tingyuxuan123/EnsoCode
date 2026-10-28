import type { TodoItem } from '@shared/types/agent';
import { Circle, CircleCheck, CircleDot } from 'lucide-react';
import { useMemo } from 'react';
import { latestUnfinishedTodos } from '@/lib/pinnedTodos';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';

/** ✓/●/○ 清单；时间线 todo 行与输入框上方「当前进度」弹层共用 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="space-y-[8px] text-[calc(13rem/14)] leading-[calc(20rem/14)]">
      {todos.map((todo) => (
        <li key={todo.content} className="flex items-start gap-[10px]">
          {todo.status === 'completed' ? (
            <CircleCheck className="mt-[3px] size-[calc(14rem/14)] shrink-0 text-success" />
          ) : todo.status === 'in_progress' ? (
            <CircleDot className="mt-[3px] size-[calc(14rem/14)] shrink-0 text-primary" />
          ) : (
            <Circle className="mt-[3px] size-[calc(14rem/14)] shrink-0 text-faint" />
          )}
          <span
            className={cn(
              todo.status === 'completed'
                ? 'text-muted-foreground line-through decoration-border'
                : todo.status === 'in_progress'
                  ? 'font-medium'
                  : 'text-muted-foreground'
            )}
          >
            {todo.content}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * 输入框上方「当前进度」按钮的数据：最新清单仍有未完成项时返回，否则 null。
 * 受「固定未完成待办」设置控制；关闭后不显示按钮。
 */
export function usePinnedTodos(conversationId: string): { id: string; todos: TodoItem[] } | null {
  const enabled = useSettingsStore((s) => s.pinUnfinishedTodos);
  const messages = useSessionsStore((s) => s.conversations[conversationId]?.messages);
  return useMemo(
    () => (enabled && messages ? latestUnfinishedTodos(messages) : null),
    [enabled, messages]
  );
}
