// Bot 模式演示数据：成员、群聊、话题、看板、委派、例程、收件箱。标签取自 src/shared/i18n.ts。
export type Member = {
  id: string;
  name: string;
  title: string;
  duty: string;
  color: string;
  model: string;
  status: ('工作中' | '排队' | '空闲' | '已搁置')[];
  statusText: string;
  budget?: string;
  memory?: number;
};

export const members: Member[] = [
  { id: 'm1', name: '阿岚', title: '主理人', duty: '拆任务、定优先级、汇总交付', color: 'bg-primary', model: 'Claude Sonnet 4.5', status: ['工作中'], statusText: '正在整理本周竞品摘要', budget: '今日 $1.20 / $3.00', memory: 42 },
  { id: 'm2', name: '小满', title: '研究员', duty: '检索竞品与用户反馈，输出对比表', color: 'bg-warning', model: 'Gemini 2.5 Pro', status: ['排队'], statusText: '排队中，等有空闲会话名额后开始', budget: '今日 $0.35 / $2.00', memory: 18 },
  { id: 'm3', name: '老周', title: '数据', duty: '抓取指标、维护看板数据', color: 'bg-success', model: 'GPT-5 Codex', status: ['空闲'], statusText: '空闲', memory: 7 },
  { id: 'm4', name: '阿米', title: '写手', duty: '把结论写成可发的周报', color: 'bg-danger', model: 'Claude Opus 4.1', status: ['已搁置'], statusText: '已搁置 · 1 小时后提醒', memory: 25 },
];

export type Group = { id: string; name: string; owner: string; members: string[]; workspace: string; running?: boolean; unread?: number; threads: { id: string; name: string; unread?: number; active?: boolean }[] };

export const groups: Group[] = [
  {
    id: 'g1',
    name: '竞品周报',
    owner: '阿岚',
    members: ['m1', 'm2', 'm3', 'm4'],
    workspace: '~/githubproject/reports',
    running: true,
    threads: [
      { id: 't1', name: '第 43 周', active: true },
      { id: 't2', name: '第 42 周' },
      { id: 't3', name: '渠道对比', unread: 3 },
    ],
  },
  { id: 'g2', name: '发布检查', owner: '老周', members: ['m3', 'm1'], workspace: '独立工作区', unread: 2, threads: [{ id: 't4', name: '主话题', active: true }] },
];

export const archivedGroups = [{ id: 'g3', name: '旧官网改版' }];

/** 群里的一条消息：成员发言、任务事件、委派、审批 */
export type GroupEvent =
  | { kind: 'member'; member: string; time: string; text: string; working?: boolean }
  | { kind: 'user'; time: string; text: string; at?: string }
  | { kind: 'task'; id: string; title: string; to: string; status: string }
  | { kind: 'delegation'; from: string; to: string; title: string; status: string; need?: string }
  | { kind: 'routine'; title: string; member: string; result: string };

export const groupTimeline: GroupEvent[] = [
  { kind: 'user', time: '09:12', text: '这周竞品周报，重点看三家在「多成员协作」上的动作，周五前给我一版可以发的。' },
  { kind: 'member', member: '阿岚', time: '09:12', text: '收到。我拆成三块：竞品动作、我们对比、可发版本。小满先做检索，老周补数据，我来汇总。', working: true },
  { kind: 'task', id: '#12', title: '整理三家竞品本周动作', to: '小满', status: '进行中' },
  { kind: 'delegation', from: '阿岚', to: '小满', title: '检索三家的多成员协作更新', status: '卡住了', need: '要不要把上一代产品也算进来' },
  { kind: 'member', member: '小满', time: '09:41', text: '检索到 12 条相关更新，其中 4 条需要确认口径。已把摘要投到看板 #12，等你回复那条卡住的问题。', working: false },
  { kind: 'routine', title: '每日竞品快照', member: '小满', result: '成功 · 抓取 3 个站点' },
  { kind: 'member', member: '老周', time: '10:05', text: '指标表已更新，周环比 +12%，数据在共享工作区的 metrics/43w.csv。' },
];

export const inbox = [
  { id: 'i1', kind: 'approval', member: '小满', title: '需要审批 · 访问外部站点 competitors.example.com', detail: '运行浏览器工具抓取公开页面，会把页面快照存入共享工作区。', need: '允许 / 本会话总是允许 / 拒绝', time: '2 分钟' },
  { id: 'i2', kind: 'question', member: '小满', title: '要不要把上一代产品也算进来', detail: '委派「检索三家的多成员协作更新」卡住等你回复。', need: '回复后接着做', time: '8 分钟' },
  { id: 'i3', kind: 'budget', member: '阿米', title: '阿米 今日预算已用完', detail: '已达每日成本上限，本地时间零点前新消息会被拒绝。', need: '调整预算或等明天', time: '26 分钟' },
  { id: 'i4', kind: 'routine', member: '小满', title: '例程提案 · 每周一 09:00 抓取竞品更新', detail: '成员提议建立例程，需要你批准后才会按时间触发。', need: '批准 / 拒绝', time: '1 小时' },
  { id: 'i5', kind: 'memory', member: '老周', title: '记忆写入 · 「周报口径以自然周为准」', detail: '成员想把这条结论写进群组记忆，需要你确认。', need: '写入 / 忽略', time: '2 小时' },
];

export const board = [
  { id: '#12', title: '整理三家竞品本周动作', assignee: '小满', column: '进行中', accept: '摘要中包含三家 8 月之后的更新', stuck: '等你回复口径' },
  { id: '#13', title: '更新周环比指标表', assignee: '老周', column: '待验收', accept: 'metrics/43w.csv 与看板一致' },
  { id: '#14', title: '写可发的周报正文', assignee: '阿米', column: '待办', accept: '' },
  { id: '#15', title: '核对渠道对比数据', assignee: '', column: '待办', accept: '' },
  { id: '#11', title: '抓取三家价格页', assignee: '老周', column: '已完成', accept: '命令打印 ALL_CRAWLED' },
  { id: '#10', title: '整理上一周结论', assignee: '阿米', column: '已完成', accept: '' },
  { id: '#9', title: '旧版报告迁到新模板', assignee: '阿米', column: '已取消', accept: '' },
  { id: '#16', title: '等外部接口恢复后补抓', assignee: '小满', column: '卡住', accept: '', stuck: '卡住·缺：接口凭证' },
];

export const runs = [
  { from: '阿岚', to: '小满', title: '检索三家的多成员协作更新', status: '卡住了', time: '09:20', need: '要不要把上一代产品算进来', logs: ['browser.open competitors.example.com/a', 'browser.snapshot → 42 nodes', 'ask_user: 口径确认'] },
  { from: '阿岚', to: '老周', title: '更新周环比指标表', status: '已完成', time: '09:35', logs: ['read metrics/42w.csv', 'write metrics/43w.csv', 'ALL_METRICS_OK'] },
  { from: '阿岚', to: '阿米', title: '写周报正文初稿', status: '失败', time: '10:02', need: '单回合 Token 上限', logs: ['write reports/43w.md', 'stopped: over max tokens per turn'] },
  { from: '老周', to: '小满', title: '补抓价格页', status: '已取消', time: '10:20', logs: ['queued'] },
  { from: '阿岚', to: '老周', title: '归档上周素材', status: '中断', time: '昨天', logs: ['应用重启时任务未完成，已停止，不会自动重做。'] },
];

export const routines = [
  { id: 'r1', title: '每日竞品快照', chat: '竞品周报', member: '小满', schedule: '工作日 09:00', next: '明天 09:00', state: '已启用', last: '今天 09:00 · 成功', missed: 0, mode: '定时' },
  { id: 'r2', title: '周报提醒', chat: '竞品周报', member: '阿岚', schedule: '每周五 16:00', next: '周五 16:00', state: '已启用', last: '上周五 16:00 · 成功', missed: 0, mode: '定时' },
  { id: 'r3', title: '接口健康检查', chat: '发布检查', member: '老周', schedule: '每 2 小时', next: '不会触发（已暂停）', state: '已暂停', last: '昨天 22:00 · 失败', missed: 3, mode: '定时' },
  { id: 'r4', title: '整理本周结论', chat: '竞品周报', member: '阿米', schedule: '手动', next: '仅手动运行', state: '已启用', last: '尚未运行', missed: 0, mode: '手动' },
];

export const artifacts = [
  { id: 'a1', name: 'reports/43w-draft.md', kind: 'markdown', from: '竞品周报 / 小满', size: '12 KB', time: '10:05' },
  { id: 'a2', name: 'metrics/43w.csv', kind: 'table', from: '竞品周报 / 老周', size: '3 KB', time: '10:05' },
  { id: 'a3', name: 'slides/43w.html', kind: 'html', from: '竞品周报 / 阿米', size: '28 KB', time: '昨天' },
];

export const personas = ['用数据说话，先给结论，再补依据。', '遇到不确定的口径先问清楚，不猜。', '写作风格克制，避免形容词堆叠。'];
export const templates = [
  { id: 'tpl1', title: '三人内容小队', desc: '主理人 + 研究员 + 写手，适合作品牌周报与选题', members: 3 },
  { id: 'tpl2', title: '发布前自检组', desc: '数据 + 校验，适合每次发版前的检查清单', members: 2 },
  { id: 'tpl3', title: '投放素材组', desc: '研究员 + 设计 + 写手，独立工作区', members: 3 },
];
