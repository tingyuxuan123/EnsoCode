export const frame = { width: 390, height: 844, title: "手机 · 会话抽屉" };

import { Link } from 'react-router';
import { StatusDot } from '../components/Controls';
import { projects } from '../components/data';

/** 会话抽屉（SessionDrawer）：项目分组、会话、状态点、相对时间、新建；桌面才有的加项目/导入不在手机端 */
export default function PhoneSessions() {
  return (
    <div className="relative flex h-full flex-col bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4">
        <span className="text-[15px] font-semibold">会话</span>
        <Link to="/phone-chat" className="ml-auto text-[12px] text-primary">关闭</Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <button className="mb-2 flex h-10 w-full items-center gap-2 rounded-control bg-control/50 px-3 text-[13px]"><span className="icon-[lucide--circle-plus] size-4 text-primary" />新建会话</button>
        {projects.map((project) => (
          <section key={project.id} className="mb-2">
            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] text-faint"><span className="icon-[lucide--folder] size-3" />{project.name}</div>
            {project.sessions.length ? project.sessions.map((session) => (
              <Link key={session.id} to="/phone-chat" className="flex min-h-10 items-center gap-2 rounded-control px-2 text-[13px] text-muted hover:bg-hover">
                <StatusDot tone={session.dot} />
                <span className="min-w-0 flex-1 truncate">{session.title}</span>
                <span className="shrink-0 text-[11px] text-faint">{session.time}</span>
              </Link>
            )) : <p className="px-2 py-1 text-[12px] text-faint">没有会话</p>}
          </section>
        ))}
      </div>
      <div className="flex h-12 shrink-0 items-center gap-3 border-t border-line px-4 text-[12px]">
        <Link to="/phone-chat" className="flex items-center gap-1.5 text-muted"><span className="icon-[lucide--message-square] size-4" />编程</Link>
        <Link to="/phone-bots" className="flex items-center gap-1.5 text-muted"><span className="icon-[lucide--bot] size-4" />Bot</Link>
        <Link to="/phone-config" className="ml-auto flex items-center gap-1.5 text-muted"><span className="icon-[lucide--settings-2] size-4" />设置</Link>
      </div>
    </div>
  );
}
