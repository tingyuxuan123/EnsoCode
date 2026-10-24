import type { TodoItem } from '@shared/types/agent';
import { Check, Circle, CircleDot } from 'lucide-react';
import { useMemo } from 'react';
import { latestUnfinishedTodos } from '@/lib/pinnedTodos';
import { cn } from '@/lib/utils';
import { useSessionsStore } from '@/stores/sessions';
import { useSettingsStore } from '@/stores/settings';

/** ✓/●/○ 清单；时间线 todo 行与输入框上方「当前进度」弹层共用 */
export function TodoList({ todos }: { todos: TodoItem[] }) {
  return (
    <ul className="space-y-0.5 text-xs">
      {todos.map((todo) => (
        <li key={todo.content} className="flex items-start gap-1.5">
          {todo.status === 'completed' ? (
            <Check className="mt-0.5 h-3 w-3 shrink-0 text-green-600 dark:text-green-500" />
          ) : todo.status === 'in_progress' ? (
            <CircleDot className="mt-0.5 h-3 w-3 shrink-0 text-blue-500" />
          ) : (
            <Circle className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/50" />
          )}
          <span
            className={cn(
              todo.status === 'completed'
                ? 'text-muted-foreground line-through'
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
