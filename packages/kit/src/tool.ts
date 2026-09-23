/**
 * 工具定义构造器 —— 我们自己造，不 import `@deepseek-ai/dsh-tools`。
 *
 * 依据（在 DSH 0.1.5-rc.2 上核对）：`ctx.tools.register(definition)` 只要求
 * `name` / `output{schema, render, presentationMeta?}` / `timeoutMs?` / `execute`，
 * 而 `parameters` 与 `output.schema` 都是**标准 JSON Schema**。
 * 官方的 `defineTool` 只是把紧凑写法转成 JSON Schema、并在执行前校验参数 —— 这里做同样两件事。
 *
 * @module @yozica/dsh-plugin-kit/tool
 */
import type { JsonSchema, ToolContent, ToolDefinition, ToolExec } from './types.js';

/** 参数的紧凑写法：一个字段一条 */
export interface ParamSpec {
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object';
  required?: boolean;
  description?: string;
  /** `type: 'array'` 时的元素类型 */
  items?: ParamSpec;
  /** `type: 'object'` 时直接给 JSON Schema 子集（逃生口） */
  schema?: JsonSchema;
}

/** 一个字段的紧凑写法 → JSON Schema 片段 */
function fieldSchema(spec: ParamSpec): JsonSchema {
  if (spec.type === 'object' && spec.schema !== undefined) return spec.schema;
  const schema: JsonSchema = { type: spec.type };
  if (spec.description !== undefined) schema.description = spec.description;
  if (spec.type === 'array')
    schema.items = spec.items ? fieldSchema(spec.items) : { type: 'string' };
  return schema;
}

/** 参数的紧凑写法 → 一个 object 型 JSON Schema */
export function parametersSchema(parameters: Record<string, ParamSpec>): JsonSchema {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [name, spec] of Object.entries(parameters)) {
    properties[name] = fieldSchema(spec);
    if (spec.required === true) required.push(name);
  }
  const schema: JsonSchema = { type: 'object', properties, additionalProperties: false };
  if (required.length > 0) schema.required = required;
  return schema;
}

/**
 * 把参数的紧凑写法转成 JSON Schema 并组装成宿主认得的工具定义。
 *
 * 两个泛型让**插件自己的代码**有类型：`Args` 是参数形状（工具里能直接 `args.path`），
 * `Result` 是返回值形状（`output.render` 的 `value` 跟着它走，`execute` 的返回也被检查）。
 * 宿主那侧看到的仍是 `ToolDefinition`（`args: unknown`）。
 */
export function defineTool<Args extends Record<string, unknown>, Result = unknown>(definition: {
  name: string;
  description: string;
  parameters: Record<string, ParamSpec>;
  output: {
    schema: Record<string, ParamSpec>;
    render: (args: Args, value: Result) => ToolContent[];
  };
  timeoutMs?: number;
  execute: (args: Args, exec: ToolExec) => Promise<Result>;
}): ToolDefinition {
  const parameters = parametersSchema(definition.parameters);
  const outputSchema = parametersSchema(definition.output.schema);
  const render = definition.output.render as unknown as ToolDefinition['output']['render'];
  const tool: ToolDefinition = {
    name: definition.name,
    description: definition.description,
    parameters,
    output: { schema: outputSchema, render },
    execute: async (args: unknown, exec: ToolExec) => {
      validateArgs(parameters, args, definition.name);
      return definition.execute(args as Args, exec);
    },
  };
  if (definition.timeoutMs !== undefined) tool.timeoutMs = definition.timeoutMs;
  return tool;
}

/**
 * 参数校验：必填 + 基本类型。错了就抛一句**模型看得懂**的话（它自己会改参数重试）。
 *
 * 只做"值不值得继续"的判断，不做完整 JSON Schema 校验 —— 深校验交给工具自己。
 */
export function validateArgs(schema: JsonSchema, args: unknown, toolName: string): void {
  if (typeof args !== 'object' || args === null) {
    throw new TypeError(`${toolName}: 参数必须是一个对象`);
  }
  const record = args as Record<string, unknown>;
  for (const name of schema.required ?? []) {
    if (record[name] === undefined || record[name] === null) {
      throw new TypeError(`${toolName}: 缺少必填参数 "${name}"`);
    }
  }
  for (const [name, field] of Object.entries(schema.properties ?? {})) {
    const value = record[name];
    if (value === undefined || value === null) continue;
    const ok =
      field.type === 'string'
        ? typeof value === 'string'
        : field.type === 'integer'
          ? Number.isInteger(value)
          : field.type === 'number'
            ? typeof value === 'number'
            : field.type === 'boolean'
              ? typeof value === 'boolean'
              : field.type === 'array'
                ? Array.isArray(value)
                : typeof value === 'object';
    if (!ok) throw new TypeError(`${toolName}: 参数 "${name}" 应该是 ${field.type}`);
  }
}
