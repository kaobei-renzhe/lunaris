import { join } from 'node:path'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { getEmbeddingModel } from '../settings'
import type { EmbeddingModelId } from '../../shared/types'
import { EMBEDDING_MODELS, modelSpec, resolveModelDir as resolveDir, type EmbeddingModelSpec } from './models'
import { BertTokenizer } from './tokenizer'
import { SiglipTokenizer } from './siglipTokenizer'

interface LoadedChinese {
  kind: 'combined'
  session: ort.InferenceSession
  tokenizer: BertTokenizer
}

interface LoadedSiglip {
  kind: 'split'
  vision: ort.InferenceSession
  text: ort.InferenceSession
  tokenizer: SiglipTokenizer
}

type Loaded = LoadedChinese | LoadedSiglip

const loaded = new Map<EmbeddingModelId, Promise<Loaded>>()

export function activeModel(): EmbeddingModelSpec {
  return EMBEDDING_MODELS[getEmbeddingModel()]
}

export function activeModelId(): EmbeddingModelId {
  return getEmbeddingModel()
}

export function resolveModelDir(id: EmbeddingModelId = activeModelId()): string | null {
  return resolveDir(id)
}

function sessionOptions(): ort.InferenceSession.SessionOptions {
  return {
    // 限制线程数：语义索引是后台功能，别把整机 CPU 吃满
    intraOpNumThreads: 2,
    interOpNumThreads: 1,
    executionMode: 'sequential'
  }
}

async function ensureLoaded(id: EmbeddingModelId): Promise<Loaded> {
  const existing = loaded.get(id)
  if (existing) return existing
  const promise = (async () => {
    const spec = modelSpec(id)
    const dir = resolveModelDir(id)
    if (!dir) throw new Error(`${spec.label} 模型还没下载`)

    if (id === 'chinese-clip') {
      const session = await ort.InferenceSession.create(
        join(dir, 'model_quantized.onnx'),
        sessionOptions()
      )
      return {
        kind: 'combined',
        session,
        tokenizer: new BertTokenizer(join(dir, 'vocab.txt'))
      } satisfies LoadedChinese
    }

    const [vision, text] = await Promise.all([
      ort.InferenceSession.create(join(dir, 'vision_model_int8.onnx'), sessionOptions()),
      ort.InferenceSession.create(join(dir, 'text_model_int8.onnx'), sessionOptions())
    ])
    return {
      kind: 'split',
      vision,
      text,
      tokenizer: new SiglipTokenizer(join(dir, 'tokenizer.json'))
    } satisfies LoadedSiglip
  })().catch((error) => {
    loaded.delete(id)
    throw error
  })
  loaded.set(id, promise)
  return promise
}

export function resetModel(id?: EmbeddingModelId): void {
  if (id) loaded.delete(id)
  else loaded.clear()
}

function unit(vector: Float32Array): Float32Array {
  let sum = 0
  for (let i = 0; i < vector.length; i++) sum += vector[i] * vector[i]
  const norm = Math.sqrt(sum) || 1
  for (let i = 0; i < vector.length; i++) vector[i] /= norm
  return vector
}

export function dot(a: Float32Array, b: Float32Array): number {
  let sum = 0
  const length = Math.min(a.length, b.length)
  for (let i = 0; i < length; i++) sum += a[i] * b[i]
  return sum
}

/** 优先拿模型导出的 pooled embedding，兼容不同导出命名 */
function pooledOutput(output: ort.InferenceSession.OnnxValueMapType, names: string[]): Float32Array {
  for (const name of names) {
    const tensor = output[name]
    if (tensor && 'data' in tensor) {
      const data = tensor.data
      if (data instanceof Float32Array) return data
    }
  }
  // 没有 pooled 输出时退到 last_hidden_state 的第一个 token
  const hidden = output.last_hidden_state
  if (hidden && 'dims' in hidden && hidden.data instanceof Float32Array) {
    const dim = Number(hidden.dims[hidden.dims.length - 1])
    return hidden.data.slice(0, dim)
  }
  throw new Error('模型没有返回可用的向量输出')
}

function imageTensor(spec: EmbeddingModelSpec, data: Buffer): ort.Tensor {
  const size = spec.imageSize
  const floats = new Float32Array(3 * size * size)
  for (let i = 0; i < size * size; i++) {
    for (let c = 0; c < 3; c++) {
      floats[c * size * size + i] = (data[i * 3 + c] / 255 - spec.mean[c]) / spec.std[c]
    }
  }
  return new ort.Tensor('float32', floats, [1, 3, size, size])
}

export async function embedText(text: string, id: EmbeddingModelId = activeModelId()): Promise<Float32Array> {
  const spec = modelSpec(id)
  const model = await ensureLoaded(id)

  if (model.kind === 'combined') {
    const { ids, mask } = model.tokenizer.encode(text)
    const output = await model.session.run({
      input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
      attention_mask: new ort.Tensor('int64', mask, [1, mask.length]),
      // 双塔合并模型必须一起喂零图占位，实际不会影响文本向量
      pixel_values: new ort.Tensor(
        'float32',
        new Float32Array(3 * spec.imageSize * spec.imageSize),
        [1, 3, spec.imageSize, spec.imageSize]
      )
    })
    return unit(pooledOutput(output, ['text_embeds']))
  }

  const { ids, mask } = model.tokenizer.encode(text, spec.maxTextLength)
  const output = await model.text.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    attention_mask: new ort.Tensor('int64', mask, [1, mask.length])
  })
  return unit(pooledOutput(output, ['text_embeds', 'pooler_output']))
}

export async function embedImage(
  filePath: string,
  id: EmbeddingModelId = activeModelId()
): Promise<Float32Array> {
  const spec = modelSpec(id)
  const model = await ensureLoaded(id)
  const { data } = await sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize(spec.imageSize, spec.imageSize, {
      fit: spec.resizeFit,
      kernel: spec.resizeKernel
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  if (model.kind === 'combined') {
    const output = await model.session.run({
      input_ids: new ort.Tensor('int64', BigInt64Array.from([101n, 102n]), [1, 2]),
      attention_mask: new ort.Tensor('int64', BigInt64Array.from([1n, 1n]), [1, 2]),
      pixel_values: imageTensor(spec, data)
    })
    return unit(pooledOutput(output, ['image_embeds']))
  }

  const output = await model.vision.run({
    pixel_values: imageTensor(spec, data)
  })
  return unit(pooledOutput(output, ['image_embeds', 'pooler_output']))
}
