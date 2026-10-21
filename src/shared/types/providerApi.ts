import type { ModelApiKind, ModelThinkingLevelOverride } from './llm';

/** 拉取模型 / 连通性测试所需的最小 provider 配置 */
export interface ProviderApiConfig {
  api: ModelApiKind;
  apiKey: string;
  baseUrl: string;
}

/** 拉取模型列表时从响应里识别出的单个模型（元数据字段可能缺失） */
export interface FetchedModel {
  id: string;
  contextWindow?: number;
  maxTokens?: number;
  /** 端点声明的显示名（display_name / name）。只回填空标签，不覆盖用户改过的名字 */
  label?: string;
  /** 端点声明的推理能力（reasoning / supports_reasoning） */
  reasoning?: boolean;
  /**
   * 端点声明的档位支持集（reasoning_levels / support_efforts / supported_reasoning_levels）。
   * 缺省 = 未知；只有 off 档或全是脏值时同样按未知处理，不写空数组。
   */
  thinkingLevels?: ModelThinkingLevelOverride[];
  /** 端点声明的图片输入能力（modalities.input / supports_image_in）。false 表示明确不支持 */
  supportsImage?: boolean;
}

export interface ListModelsResult {
  ok: boolean;
  models: FetchedModel[];
  error?: string;
}

export interface TestProviderResult {
  ok: boolean;
  latencyMs: number;
  /** 成功时为使用的模型，失败时为错误信息 */
  message: string;
}
