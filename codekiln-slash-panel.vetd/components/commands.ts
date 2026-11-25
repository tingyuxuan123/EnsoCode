import vettaMark from "../assets/vetta-design-mark.png";

export type Candidate = {
  name: string;
  label: string;
  icon: string | { image: string };
  description: string;
  syntax: string;
  builtin?: "design" | "image" | "plugin";
  prompt?: string;
  keywords?: string;
  example?: string;
  options?: readonly { name: string; label: string }[];
};

export const groups: readonly { label: string; items: readonly Candidate[] }[] = [
  {
    label: "系统内置",
    items: [
      {
        name: "/skill:vetta-ui-design",
        label: "Vetta 设计",
        icon: { image: vettaMark },
        builtin: "design",
        description: "在 Vetta 画布上制作可编辑的界面、幻灯片和交互原型。",
        syntax: "/skill:vetta-ui-design",
        example: "为桌面会话的命令菜单设计可编辑原型",
      },
      {
        name: "图像生成",
        label: "图像生成",
        icon: "icon-[lucide--image-plus]",
        builtin: "image",
        keywords: "generate image",
        description: "描述画面、风格和尺寸，在会话中生成一张图片。适合插画、海报和壁纸。",
        syntax: "描述画面、风格与尺寸",
        prompt: "帮我生成一张图片：",
        example: "画一张 16:9 的极简山脉壁纸",
      },
      {
        name: "制作插件",
        label: "制作插件",
        icon: "icon-[lucide--puzzle]",
        builtin: "plugin",
        keywords: "create author plugin",
        description: "从一个实际用途出发，描述插件要做什么，再从最小可用功能开始制作。",
        syntax: "说明插件的用途和入口",
        prompt: "帮我制作一个 CodeKiln 插件：",
        example: "把选中的代码片段保存到本地笔记",
      },
    ],
  },
  {
    label: "会话命令",
    items: [
      {
        name: "/goal",
        label: "设定会话目标",
        icon: "icon-[lucide--target]",
        description: "设定这段会话要达成的目标。需要中断时，可以暂停；回来后再继续。",
        syntax: "/goal <目标>",
        options: [
          { name: "pause", label: "暂停当前目标" },
          { name: "resume", label: "继续已暂停的目标" },
          { name: "clear", label: "清除当前目标" },
        ],
      },
      {
        name: "/compact",
        label: "压缩上下文",
        icon: "icon-[lucide--minimize-2]",
        description: "压缩当前会话的上下文。可以补充摘要重点，告诉 Agent 哪些信息要保留。",
        syntax: "/compact [摘要重点]",
        example: "/compact 保留已确认的设计决策",
      },
      {
        name: "/plan",
        label: "进入计划模式",
        icon: "icon-[lucide--clipboard-list]",
        description: "让 Agent 先做只读调研，提交计划供你审批，再进入实施。",
        syntax: "/plan [任务]",
        options: [{ name: "off", label: "退出计划模式" }],
      },
    ],
  },
  {
    label: "项目技能",
    items: [
      {
        name: "/skill:project-knowledge",
        label: "项目知识库",
        icon: "icon-[lucide--book-open]",
        description: "查阅 CodeKiln 的工程约定、架构边界和历史排障记录，再开始跨模块改动。",
        syntax: "/skill:project-knowledge",
      },
      {
        name: "/skill:diffs",
        label: "代码差异",
        icon: "icon-[lucide--git-compare-arrows]",
        description: "为使用 @pierre/diffs 的界面设计或调整代码差异、批注和审阅视图。",
        syntax: "/skill:diffs",
      },
      {
        name: "/skill:transitions-dev",
        label: "界面动效",
        icon: "icon-[lucide--sparkles]",
        description: "为菜单、弹层和反馈状态设计可用于实际界面的过渡动效。",
        syntax: "/skill:transitions-dev",
      },
    ],
  },
];
