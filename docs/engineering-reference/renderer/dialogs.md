# 弹窗规范

## 三件套结构

弹窗内容必须由这三个组件承载，**内边距是它们给的**：

```tsx
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent className="max-w-2xl">
    <DialogHeader>
      <DialogTitle>{t('Edit Provider')}</DialogTitle>
      <DialogDescription>{t('...')}</DialogDescription>
    </DialogHeader>

    <DialogPanel className="space-y-4">
      {/* 正文。自带 ScrollArea，内容超高会滚动 */}
    </DialogPanel>

    <DialogFooter>
      <Button variant="outline" size="sm" onClick={onClose}>{t('Cancel')}</Button>
      <Button size="sm" onClick={handleSave}>{t('Save')}</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

`DialogContent` / `DialogPopup` 只提供容器边框、6px 圆角与层级，**不提供正文内边距**。
里面直接放裸 div 会紧贴边框；正文必须经 `DialogPanel`，说明文字必须留在 `DialogHeader` 内。

各段职责：

- `DialogHeader` —— `px-[20px] py-[16px] pr-[48px] border-b border-line`，只放标题和描述；
  右侧 48px 给关闭按钮留位，标题 16px、说明 12px。
- `DialogPanel` —— `px-[20px] py-[16px]` + 内置 `ScrollArea`，长内容可加 `max-h-[50vh]`；
  没有带顶部分隔线的 footer 时，正文下内边距为 20px。
- `DialogFooter` —— 默认 `px-[20px] py-[12px] border-t border-line`，无额外底色，按钮靠右；
  左右分置时加 `className="sm:justify-between"`
- `DialogDescription` —— 只负责说明文字样式，不再加 padding；`ScrollArea` 包装层也不重复加 padding。

这些尺寸使用固定像素，避免应用 14px 根字号把 `p-6` / `px-6` 缩成非设计尺寸。
调用处通常只加排版间距（如 `space-y-4`），不要给 popup、说明文字或滚动包装层再叠同一层内边距。
回归约束见 `src/tooling/dialogLayout.test.ts`：保留裸内容扫描，并检查每个 slot 及 `bare` 正文的 padding 责任。

多阶段弹窗（扫描中 / 选择 / 出错 / 完成）**每个阶段都要各自包一层 `DialogPanel`**，
参照 `LocalAssetImportDialog.tsx`。

已在外层 `DialogPanel` 滚动区里的向导分步页使用 `DialogPanel bare`，保留排版但不再嵌套
`ScrollArea`。正文内需要独立限高的列表使用 `useScrollChain`，到顶/到底后把滚轮交给最近的
外层 viewport。监听按 DOM callback ref 挂载并清理，不能只在首次 effect 里读取 ref：
模型列表可能在异步拉取完成后才出现，首次渲染时还没有 DOM。

## 层级

层级令牌在 `src/renderer/lib/z-index.ts`，不要写数字字面量。

弹窗内的下拉、浮层**必须显式提升层级**，否则会沉到弹窗内容之下：

```tsx
<SelectPopup zIndex={Z_INDEX.DROPDOWN_IN_MODAL}>
```

弹窗（以及任何）`Select` 必须传 `items`（`Record<value, label>` 或 `{ value, label }[]`）。
Base UI 的 `SelectValue` 关着 popup 时读不到 `SelectItem` 文案，缺 `items` 就会把原始 value 画在触发器上。
对照 `GeneralSettings` / `AppearanceSettings` / `McpEditDialog` / `ProviderEditDialog`。

因为 `SelectPopup` 默认用 `Z_INDEX.DROPDOWN`(40)，而 `MODAL_CONTENT` 是 51。
症状是点开下拉看不见选项。嵌套弹窗里的下拉用 `DROPDOWN_IN_NESTED_MODAL`。

## 危险操作要变色

会造成不可逆或外溢影响的操作，整块提示区和主按钮都要转为警示色，
让用户在点下去之前就知道代价。范例是 `InstructionEditDialog.tsx` 的「直接修改原文件」开关：

- 关：琥珀色边框 + `Info` 图标 + 按钮「保存为本地副本」
- 开：`border-destructive/32 bg-destructive/8` + `TriangleAlert` 图标
  + `variant="destructive"` 的按钮「覆盖原文件」

提示文案要写清**具体会发生什么**（哪个文件被覆盖、谁会受影响），不要只写"此操作不可撤销"。

## 异步操作的状态

拉取、测试、保存这类异步动作，用一个 `busy` 状态标记当前动作，
禁用相关按钮并换成 `Loader2` 旋转图标：

```tsx
const [busy, setBusy] = React.useState<'fetch' | 'test' | null>(null);
...
<Button disabled={busy !== null} onClick={handleFetchModels}>
  {busy === 'fetch' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ListPlus ... />}
  {busy === 'fetch' ? t('Fetching') : t('Fetch models')}
</Button>
```

结果用一行状态提示，成功绿色 + `CircleCheck`，失败 `text-destructive` + `CircleX`，
文本 `truncate` 防止长错误信息撑破布局。

## 编辑弹窗的表单状态

编辑类弹窗的约定（见 `ProviderEditDialog.tsx`、`InstructionEditDialog.tsx`）：

- props 是 `{ entity: T | null; onClose: () => void }`，`open` 由 `entity !== null` 推导。
- `useEffect` 依赖 `entity`，在里面重置**全部**本地状态，包括错误、忙碌、开关等，
  否则关掉再开会带上一次的残留。
- 保存时才写回 store，取消不留痕。
