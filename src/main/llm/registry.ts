import type { LlmCapabilityId } from '../../shared/llm'
import type { LlmContentPart, LlmMessage } from './types'

export interface CapabilityChatOptions {
  json?: boolean
  maxTokens?: number
  temperature?: number
}

export interface CapabilityContext {
  /** 发一轮对话，返回纯文本；JSON 能力自己用 extractJson 解析 */
  chat: (messages: LlmMessage[], options?: CapabilityChatOptions) => Promise<string>
  /** 取一张已压到合适尺寸的图片，作为多模态输入 */
  image: (itemId: number) => Promise<LlmContentPart>
}

export interface LlmCapability<TInput = unknown, TOutput = unknown> {
  id: LlmCapabilityId
  title: string
  description: string
  /** 单次调用允许的最大图片数，用于成本保护；不填表示不限制 */
  maxItems?: number
  run: (ctx: CapabilityContext, input: TInput) => Promise<TOutput>
}

const registry = new Map<string, LlmCapability<never, unknown>>()

/** 能力注册：新增能力只需实现 LlmCapability 并在 index.ts 里注册一行 */
export function registerCapability<TInput, TOutput>(capability: LlmCapability<TInput, TOutput>): void {
  registry.set(capability.id, capability as unknown as LlmCapability<never, unknown>)
}

export function getCapability(id: string): LlmCapability<never, unknown> | null {
  return registry.get(id) ?? null
}

export function listCapabilities(): Array<Pick<LlmCapability, 'id' | 'title' | 'description' | 'maxItems'>> {
  return [...registry.values()].map(({ id, title, description, maxItems }) => ({
    id,
    title,
    description,
    maxItems
  }))
}
