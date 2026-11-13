import type {
  Api,
  Context,
  Model,
  ModelsApiStreamOptions,
  ProviderRequestOptions,
} from '@earendil-works/pi-ai';
import type { ModelRuntime } from '@earendil-works/pi-coding-agent';

export function stableToolOrder(context: Context): Context {
  const tools = context.tools;
  if (!tools || tools.every((tool, index) => index === 0 || tools[index - 1].name <= tool.name)) {
    return context;
  }
  return {
    ...context,
    tools: [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)),
  };
}

const installed = new WeakMap<
  ModelRuntime,
  Partial<Pick<ModelRuntime, 'stream' | 'streamSimple'>>
>();

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

function sortDeclarations(values: unknown[]): unknown[] {
  const name = (value: unknown): string | undefined => {
    const item = record(value);
    const key = item?.name ?? record(item?.function)?.name ?? record(item?.toolSpec)?.name;
    return typeof key === 'string' ? key : undefined;
  };
  // 保留供应商原生工具（无函数名）的槽位，只排序函数声明。
  const named = values.filter((value) => name(value) !== undefined);
  const sorted = [...named].sort((a, b) =>
    name(a)! < name(b)! ? -1 : name(a)! > name(b)! ? 1 : 0
  );
  if (named.every((value, index) => value === sorted[index])) return values;
  let index = 0;
  return values.map((value) => (name(value) === undefined ? value : sorted[index++]));
}

function stablePayload(payload: unknown): unknown {
  const source = record(payload);
  if (!source) return payload;
  let next = source;
  if (Array.isArray(source.tools)) {
    const nested = source.tools.map((tool) => {
      const item = record(tool);
      if (!item || !Array.isArray(item.functionDeclarations)) return tool;
      const declarations = sortDeclarations(item.functionDeclarations);
      return declarations === item.functionDeclarations
        ? tool
        : { ...item, functionDeclarations: declarations };
    });
    const tools = sortDeclarations(nested);
    if (tools.some((tool, index) => tool !== (source.tools as unknown[])[index]))
      next = { ...next, tools };
  }
  // Bedrock 与 Gemini 的公开 payload 嵌套，不碰 input/messages 等用户内容。
  for (const key of ['toolConfig', 'config']) {
    const child = record(source[key]);
    if (!child) continue;
    const sorted = stablePayload(child);
    if (sorted !== child) next = { ...next, [key]: sorted };
  }
  return next;
}

function payloadHook<TModel>(
  previous: ProviderRequestOptions<TModel>['onPayload']
): NonNullable<ProviderRequestOptions<TModel>['onPayload']> {
  return async (payload, model) => stablePayload((await previous?.(payload, model)) ?? payload);
}

/** 包公开出口，不改注册顺序或权限；MCP 恢复顺序不同也保持请求 tools 前缀稳定。 */
export function installStableToolOrder(runtime: ModelRuntime): void {
  const bound = installed.get(runtime) ?? {};
  if (typeof runtime.stream === 'function' && runtime.stream !== bound.stream) {
    const original = runtime.stream.bind(runtime);
    const ordered = (model: Model<Api>, context: Context, options?: ModelsApiStreamOptions<Api>) =>
      original(model, stableToolOrder(context), {
        ...options,
        onPayload: payloadHook(options?.onPayload),
      } as ModelsApiStreamOptions<Api>);
    // 与 stream guard 一致：仅擦除 API 泛型关联，实际选项/模型不变。
    runtime.stream = (model, context, options) =>
      ordered(model, context, options as ModelsApiStreamOptions<Api>);
    bound.stream = runtime.stream;
    installed.set(runtime, bound);
  }
  if (typeof runtime.streamSimple === 'function' && runtime.streamSimple !== bound.streamSimple) {
    const original = runtime.streamSimple.bind(runtime);
    runtime.streamSimple = (model, context, options) =>
      original(model, stableToolOrder(context), {
        ...options,
        onPayload: payloadHook(options?.onPayload),
      });
    bound.streamSimple = runtime.streamSimple;
    installed.set(runtime, bound);
  }
}
