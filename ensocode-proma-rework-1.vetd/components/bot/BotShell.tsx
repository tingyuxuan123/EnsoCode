import { useState, type ReactNode } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router';
import { MenuItem, MenuPanel, MenuSeparator, useDismiss } from '../Controls';
import { Notice } from '../Workbench';
import { archivedGroups, groups, inbox, members, type Group, type Member } from './data';

const ICON = 'relative flex size-8 shrink-0 items-center justify-center rounded-control text-muted hover:bg-hover hover:text-surface-foreground';

export function Avatar({ member, size = 'md' }: { member: Pick<Member, 'name' | 'color'>; size?: 'sm' | 'md' | 'lg' }) {
  const box = size === 'sm' ? 'size-6 text-[11px]' : size === 'lg' ? 'size-12 text-[17px]' : 'size-8 text-[13px]';
  return <span className={`${box} ${member.color} flex shrink-0 items-center justify-center rounded-full font-medium text-white`}>{member.name.slice(-1)}</span>;
}

/** 群聊头像：成员头像叠放（BotAvatar / GroupAvatar） */
function GroupAvatar({ group, size = 'md' }: { group: Group; size?: 'sm' | 'md' }) {
  const people = group.members.slice(0, 2).map((id) => members.find((member) => member.id === id)).filter(Boolean) as Member[];
  if (!people.length) return <span className="flex size-8 items-center justify-center rounded-full bg-control text-muted"><span className="icon-[lucide--users] size-4" /></span>;
  return (
    <span className="flex shrink-0 -space-x-2">
      {people.map((person) => <span key={person.id} className="rounded-full ring-2 ring-sidebar"><Avatar member={person} size="sm" /></span>)}
    </span>
  );
}

/** 会话行（ChatRow）：头像 + 标题 + 状态/时间 + 预览 + 未读 / 待处理标记 */
function ChatRow({ to, active, avatar, title, meta, preview, unread, pending, menu }: { to: string; active?: boolean; avatar: ReactNode; title: string; meta?: string; preview?: string; unread?: boolean; pending?: boolean; menu?: ReactNode }) {
  return (
    <Link to={to} className={`group flex items-start gap-2 rounded-control px-2 py-1.5 ${active ? 'bg-selected' : 'hover:bg-hover'}`}>
      <span className="relative mt-0.5 shrink-0">
        {avatar}
        {pending && <span className="absolute -right-0.5 -top-0.5 size-2 rounded-full bg-danger ring-2 ring-sidebar" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={`min-w-0 flex-1 truncate text-[13px] ${active ? 'font-medium text-surface-foreground' : 'text-surface-foreground/90'}`}>{title}</span>
          {unread && <span className="size-1.5 shrink-0 rounded-full bg-primary" />}
          {meta && <span className="shrink-0 whitespace-nowrap text-[10px] text-faint">{meta}</span>}
          {menu}
        </span>
        {preview && <span className="mt-0.5 block truncate text-[11px] text-muted">{preview}</span>}
      </span>
    </Link>
  );
}

function SectionHeader({ title, count, onAdd, addLabel }: { title: string; count: number; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="flex items-center gap-1 px-2 pb-1 pt-2 text-[11px] text-faint">
      {title}
      <span className="tabular-nums">{count}</span>
      {onAdd && <button onClick={onAdd} title={addLabel} aria-label={addLabel} className="ml-auto flex size-5 items-center justify-center rounded text-muted hover:bg-hover hover:text-surface-foreground"><span className="icon-[lucide--plus] size-3.5" /></button>}
    </div>
  );
}

/**
 * Bot 模式侧栏（bots/BotSidebar.tsx）：上方滚动区只有两个分区 —— 群聊、成员（各自带 + 入口）；
 * 底部一行图标在 264 宽下依次是 折叠 / 搜索 / 从目标开始 / 新建成员 / 新建群聊 / 从模板创建团队 /
 * 收件箱（有计数）/ 已归档（有计数）/ 设置；更窄时创建入口收进「更多操作」菜单。
 */
export function BotSidebar() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [menu, setMenu] = useState('');
  const [more, setMore] = useState(false);
  const ref = useDismiss<HTMLDivElement>(Boolean(menu), () => setMenu(''));
  const moreRef = useDismiss<HTMLDivElement>(more, () => setMore(false));
  const pending = inbox.length;

  const rowMenu = (kind: 'group' | 'member', id: string, name: string) => (
    <button onClick={(event) => { event.preventDefault(); setMenu(id); }} aria-label="更多操作" title="更多操作" className="ml-0.5 hidden size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-control group-hover:flex"><span className="icon-[lucide--ellipsis] size-3.5" /></button>
  );

  return (
    <aside aria-label="Bot 成员与群聊" className="@container flex w-[264px] shrink-0 flex-col border-r border-t border-line bg-sidebar">
      <div ref={ref} className="relative min-h-0 flex-1 overflow-y-auto px-2 pb-2 pt-2">
        <SectionHeader title="群聊" count={groups.length} onAdd={() => navigate('/bot-new-group')} addLabel="新建群聊" />
        {!groups.length && <p className="px-2 py-1 text-[11px] text-muted">还没有群聊</p>}
        {groups.map((group) => (
          <ChatRow
            key={group.id}
            to="/bot-group"
            active={pathname === '/bot-group' && group.id === 'g1'}
            avatar={<GroupAvatar group={group} />}
            title={group.name}
            meta={group.running ? '工作中' : group.unread ? '排队' : ''}
            preview={group.threads[0]?.name ? `# ${group.threads[0].name}` : ''}
            unread={Boolean(group.unread)}
            menu={rowMenu('group', group.id, group.name)}
          />
        ))}

        <SectionHeader title="成员" count={members.filter((member) => !member.status.includes('已搁置')).length} onAdd={() => navigate('/bot-new-member')} addLabel="新建成员" />
        {!members.length && <p className="px-2 py-1 text-[11px] text-muted">还没有成员</p>}
        {members.filter((member) => !member.status.includes('已搁置')).map((member) => (
          <ChatRow
            key={member.id}
            to="/bot-chat"
            active={pathname === '/bot-chat' && member.id === 'm1'}
            avatar={<Avatar member={member} />}
            title={member.name}
            meta={member.status.includes('工作中') ? '工作中' : member.status.includes('排队') ? '排队' : member.status[0]}
            preview={member.statusText}
            menu={rowMenu('member', member.id, member.name)}
          />
        ))}

        {members.some((member) => member.status.includes('已搁置')) && (
          <>
            <SectionHeader title="已搁置" count={members.filter((member) => member.status.includes('已搁置')).length} />
            {members.filter((member) => member.status.includes('已搁置')).map((member) => (
              <ChatRow key={member.id} to="/bot-chat" avatar={<span className="opacity-75"><Avatar member={member} /></span>} title={member.name} meta="提醒 1 小时后" preview={member.statusText} />
            ))}
          </>
        )}

        {menu && (
          <MenuPanel label="会话操作" className="left-8 top-16 w-48">
            <MenuItem icon="icon-[lucide--pin]" label="置顶" onClick={() => setMenu('')} />
            <MenuItem icon="icon-[lucide--arrow-up]" label="上移" onClick={() => setMenu('')} />
            <MenuItem icon="icon-[lucide--arrow-down]" label="下移" onClick={() => setMenu('')} />
            <MenuItem icon="icon-[lucide--mail]" label="标为未读" onClick={() => setMenu('')} />
            <MenuSeparator />
            <MenuItem icon="icon-[lucide--clock]" label="稍后提醒" hint="1 小时后 / 3 小时后 / 明天 9:00" onClick={() => setMenu('')} />
            <MenuItem icon="icon-[lucide--copy]" label="克隆群聊" hint="复制成员与共享工作区设置" onClick={() => setMenu('')} />
            <MenuSeparator />
            <MenuItem icon="icon-[lucide--archive]" label="归档聊天" onClick={() => setMenu('')} />
            <MenuItem icon="icon-[lucide--trash-2]" label="删除群聊" danger onClick={() => setMenu('')} />
          </MenuPanel>
        )}
      </div>

      <div ref={moreRef} className="relative flex shrink-0 items-center justify-between border-t border-line p-2">
        <button className={ICON} title="折叠侧边栏" aria-label="折叠侧边栏" onClick={() => navigate('/bot')}><span className="icon-[lucide--panel-left-close] size-4" /></button>
        <div className="flex items-center gap-0.5">
          <button className={ICON} title="搜索会话" aria-label="搜索会话" onClick={() => navigate('/bot-search')}><span className="icon-[lucide--search] size-4" /></button>
          {/* 264 宽下创建入口收进「更多操作」，与源码 18.5rem 断点一致 */}
          <button className={`${ICON} @min-[18.5rem]:hidden`} title="更多操作" aria-label="更多操作" aria-expanded={more} onClick={() => setMore(!more)}><span className="icon-[lucide--ellipsis] size-4" /></button>
          <button className={`${ICON} hidden @min-[18.5rem]:flex`} title="从目标开始" aria-label="从目标开始" onClick={() => navigate('/bot-goal')}><span className="icon-[lucide--target] size-4" /></button>
          <button className={`${ICON} hidden @min-[18.5rem]:flex`} title="新建成员" aria-label="新建成员" onClick={() => navigate('/bot-new-member')}><span className="icon-[lucide--user-plus] size-4" /></button>
          <button className={`${ICON} hidden @min-[18.5rem]:flex`} title="新建群聊" aria-label="新建群聊" onClick={() => navigate('/bot-new-group')}><span className="icon-[lucide--users] size-4" /></button>
          <button className={`${ICON} hidden @min-[18.5rem]:flex`} title="从模板创建团队" aria-label="从模板创建团队" onClick={() => navigate('/bot-new-team')}><span className="icon-[lucide--layout-template] size-4" /></button>
          <button className={ICON} title="收件箱" aria-label="收件箱" onClick={() => navigate('/bot-inbox')}>
            <span className="icon-[lucide--inbox] size-4" />
            {pending > 0 && <span className="absolute -right-1 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-danger px-1 text-[10px] text-white">{pending}</span>}
          </button>
          <button className={ICON} title={`已归档 (${archivedGroups.length})`} aria-label="已归档" onClick={() => navigate('/bot')}><span className="icon-[lucide--archive] size-4" /></button>
          <Link to="/settings-bots" className={ICON} title="设置" aria-label="设置"><span className="icon-[lucide--settings-2] size-4" /></Link>
        </div>
        {more && (
          <MenuPanel label="更多操作" className="bottom-10 right-2 w-48">
            <MenuItem icon="icon-[lucide--target]" label="从目标开始" onClick={() => { setMore(false); navigate('/bot-goal'); }} />
            <MenuItem icon="icon-[lucide--user-plus]" label="新建成员" onClick={() => { setMore(false); navigate('/bot-new-member'); }} />
            <MenuItem icon="icon-[lucide--users]" label="新建群聊" onClick={() => { setMore(false); navigate('/bot-new-group'); }} />
            <MenuItem icon="icon-[lucide--layout-template]" label="从模板创建团队" onClick={() => { setMore(false); navigate('/bot-new-team'); }} />
          </MenuPanel>
        )}
      </div>
      <Notice />
    </aside>
  );
}

/** Bot 模式外壳：图标轨（AppRail）由根布局渲染，这里只放 Bot 侧栏 + 内容区 */
export function BotShell() {
  return (
    <>
      <BotSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden border-t border-line bg-surface">
        <Outlet />
      </div>
    </>
  );
}
