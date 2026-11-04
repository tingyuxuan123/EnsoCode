export type Extension = {
  id: string;
  name: string;
  slug: string;
  description: string;
  type: "skill" | "mcp";
  icon: string;
  source: string;
  installed: boolean;
  enabled: boolean;
  ready?: boolean;
  featured?: boolean;
  path?: string;
  detail: string;
};

export const initialExtensions: Extension[] = [
  {
    id: "design", name: "Vetta UI Design", slug: "vetta-ui-design", type: "skill",
    icon: "icon-[lucide--frame]", source: "内置技能", installed: true, enabled: true,
    description: "在设计画布里制作界面、原型与演示稿。",
    path: "resources/design/skills/vetta-ui-design/SKILL.md",
    detail: "把想法变成可预览的界面。支持应用页面、落地页、演示文稿和海报；设计由可编辑的 React 源文件组成，保存在项目里的 .vetd 文档中。",
  },
  {
    id: "diffs", name: "代码与 Diff", slug: "diffs", type: "skill",
    icon: "icon-[lucide--file-diff]", source: "项目技能", installed: true, enabled: true,
    description: "用 @pierre/diffs 构建代码查看与改动审阅。",
    path: ".agents/skills/diffs/SKILL.md",
    detail: "为代码预览、差异对比与审阅界面提供实现指导，涵盖语法高亮、工作线程、行注释与选择。",
  },
  {
    id: "cdp", name: "EnsoCode 真机验证", slug: "enso-cdp", type: "skill",
    icon: "icon-[lucide--scan-line]", source: "项目技能", installed: true, enabled: true,
    description: "检查开发版窗口、会话状态与真实输入。",
    path: ".agents/skills/enso-cdp/SKILL.md",
    detail: "通过只连接本机的 CDP 工具核验开发版应用的真实行为。正式安装版不开放开发调试端口。",
  },
  {
    id: "motion", name: "界面动效", slug: "transitions-dev", type: "skill",
    icon: "icon-[lucide--orbit]", source: "项目技能", installed: true, enabled: true,
    description: "为弹窗、下拉菜单和流式状态设计动效。",
    path: ".agents/skills/transitions-dev/SKILL.md",
    detail: "用一致的动效令牌为交互提供反馈，包含出现、收起、状态切换与流式内容。",
  },
  {
    id: "knowledge", name: "项目知识", slug: "project-knowledge", type: "skill",
    icon: "icon-[lucide--book-open]", source: "项目技能", installed: true, enabled: true,
    description: "检索工程约定、历史决策与真实踩坑经验。",
    path: ".agents/skills/project-knowledge/SKILL.md",
    detail: "在非平凡修改前找到项目规则，修复后将可复用的根因与回归防线写回工程知识库。",
  },
  {
    id: "find", name: "发现技能", slug: "find-skills", type: "skill",
    icon: "icon-[lucide--compass]", source: "用户技能", installed: true, enabled: false,
    description: "按当前任务查找适合的可安装技能。",
    path: "~/.agents/skills/find-skills/SKILL.md",
    detail: "当你需要新的工作方式时，先查找已有技能，再判断是否需要安装。",
  },
  {
    id: "uniapp", name: "uni-app x 文档", slug: "uniappx", type: "mcp",
    icon: "icon-[lucide--smartphone]", source: "手动添加", installed: true, enabled: true, ready: true,
    description: "查询组件、API、UTS 语法与跨端开发文档。",
    detail: "连接 uni-app x 文档工具，按组件、API 和 CSS 属性检索官方开发资料。",
  },
  {
    id: "tmui", name: "tmui4x 组件库", slug: "tmui4x", type: "mcp",
    icon: "icon-[lucide--blocks]", source: "手动添加", installed: true, enabled: true, ready: false,
    description: "检索组件、插件和原生图表的使用方式。",
    detail: "为组件实现查询 tmui4x 2.0 文档。此连接在设计演示中展示为等待授权。",
  },
  {
    id: "polish", name: "动效精修", slug: "transitions-polish", type: "skill", featured: true,
    icon: "icon-[lucide--sliders-horizontal]", source: "精选示例", installed: false, enabled: false,
    description: "调整已有动效的时长、缓动与展开节奏。",
    detail: "在界面已经能动起来之后，检查时序、距离和缓动，让交互反馈更一致。",
  },
  {
    id: "pdf", name: "PDF 文档", slug: "pdf-documents", type: "skill", featured: true,
    icon: "icon-[lucide--file-text]", source: "精选示例", installed: false, enabled: false,
    description: "阅读、整理并生成结构清晰的 PDF。",
    detail: "这是精选目录的设计示例，用于演示添加与详情流程，不代表已接入在线技能市场。",
  },
  {
    id: "spreadsheet", name: "电子表格", slug: "spreadsheets", type: "skill", featured: true,
    icon: "icon-[lucide--table-2]", source: "精选示例", installed: false, enabled: false,
    description: "清理表格数据，分析结果并输出报表。",
    detail: "这是精选目录中的表格处理示例，所有添加操作仅保存在设计预览中。",
  },
  {
    id: "playwright", name: "Playwright", slug: "playwright", type: "mcp", featured: true,
    icon: "icon-[lucide--mouse-pointer-2]", source: "精选示例", installed: false, enabled: false,
    description: "打开网页、操作界面并验证关键流程。",
    detail: "为网页测试建立浏览器工具连接。此处为目录建议稿，不进行真实安装或启动。",
  },
  {
    id: "github", name: "GitHub", slug: "github", type: "mcp", featured: true,
    icon: "icon-[mdi--github]", source: "精选示例", installed: false, enabled: false,
    description: "查看仓库、Issue 与 Pull Request。",
    detail: "把代码协作上下文带进任务。在实际实现中需要明确凭证范围，此处不请求账号授权。",
  },
  {
    id: "postgres", name: "PostgreSQL", slug: "postgresql", type: "mcp", featured: true,
    icon: "icon-[lucide--database]", source: "精选示例", installed: false, enabled: false,
    description: "连接数据库，检查表结构与查询结果。",
    detail: "数据库连接的目录示例。实际实现应区分只读权限与写入权限，此处不访问数据库。",
  },
];

export const projectRows = [
  { name: "EnsoCode", group: "个人", open: true },
  { name: "open-vetta", group: "个人", open: false },
  { name: "demo-web", group: "工作", open: false },
];
