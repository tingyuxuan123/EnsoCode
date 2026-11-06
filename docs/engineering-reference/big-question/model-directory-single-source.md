---
title: 统一模型目录：清单是派生数据，settings 只存稀疏覆盖
tags: [model, settings, oauth, architecture, vitest-mock]
---

# 统一模型目录：清单是派生数据，settings 只存稀疏覆盖

## 事故根因

模型清单曾同时存在四份各自腐化的子集：登录时冻结进 `settings.json` 的全量拷贝
（`ProviderSetupWizard` 一次性写入，**没有任何增量同步机制**）、worker 运行时注册表、
provider 模块级发现缓存（main/worker 各一份）、settings store。典型事故：静态表新增的
`gemini-3.8-flash` 永远进不了老账号的冻结清单，subagent 选模器自然没有它（issue #124 第 4 点）。

## 架构决策（feat/unified-model-catalog）

- **清单 = 派生数据**：Main 侧 `src/main/services/modelDirectory.ts` 是唯一权威源
  （runtime catalog + 动态发现缓存 + xAI 旁路探测 + settings 自定义 provider 合成），
  Renderer 经 `modelDirectory:get/changed` 订阅，worker 经 `set-model-directory` 命令拿快照。
- **settings.json 的 OAuth 条目 models 只存稀疏覆盖表**：`enabled:false` / 用户别名 /
  能力覆盖，以及已被选型引用的旧模型 ID。物化统一走 `materializeProviders`（`src/shared/modelDirectory.ts`），
  目录缺失时原样兜底。自定义 provider 的 models 仍是用户数据，不收缩。
- **写回陷阱**：物化会往每行注入目录 label，保存时必须用
  `extractModelOverrides(models, baseline, referencedModelIds(settings, providerId))`，
  既剥离目录 label，又保留用户选型；否则可能膨胀全量清单或丢失旧动态默认模型。
- **冷态守卫**：目录分区缺失或 0 模型时，`revalidateDefaultModel` 必须 defer 绝不写回
  （虚拟默认模型要解析全部成员引用逐个查）。否则升级首启会把 OAuth 默认模型误判
  `model-missing` 写没。
- **非空静态表不代表发现完成**：重启时按 ID 合并 live 与缓存，live 元数据优先，
  不因静态 fallback 缺席就删缓存动态 ID。首次升级没有缓存时，迁移保留已引用裸 ID，
  不等在线发现来挽救已经被写没的默认选择。回归覆盖 `modelDirectory.test.ts` 的重启、
  `defaultModel.test.ts` 的 v15 无缓存水合及 `ProviderEditDialog.directory.test.ts` 的目录晚到。

## 测试配套（重要）

`oauthProviders`（登录完成）、`settings`（写成功）会后台动态 import modelDirectory，
其静态链 `modelDirectory → ipc/settings → services/oauthProviders` 会在**不确定时机**
把 oauthProviders 拉回 vitest 模块注册表，踩掉后续测试用 `resetModules + doMock` 搭的
fake runtime（报 `unknown oauth provider`）。凡跑这条链的测试文件必须显式
`vi.mock('./modelDirectory', () => ({ refreshModelDirectory: async () => {}, ... }))`
（参照 `oauthProviders.test.ts`、`settings.test.ts`、`agentHost.test.ts`、
`capabilityGateway.test.ts` 的既有 mock 块）。

登录/登出还会动态导入 `agentHost` 失效代码搜索配置，同样能在测试重置模块时把
旧 OAuth runtime 拉回缓存。通知测试 mock 此后台依赖，并在切换 fake runtime 前后
等待动态导入收束；代码搜索的失效行为由 `oauthProviders.codeSearch.test.ts` 独立验收。
