import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'
import { BertTokenizer } from './tokenizer'

export const MODEL_TAG = 'chinese-clip-vit-base-patch16-int8'
export const MODEL_FILE = 'model_quantized.onnx'
export const VOCAB_FILE = 'vocab.txt'

const IMAGE_SIZE = 224
const MEAN = [0.48145466, 0.4578275, 0.40821073]
const STD = [0.26862954, 0.26130258, 0.27577711]

export function downloadTargetDir(): string {
  return join(app.getPath('userData'), 'models', 'chinese-clip')
}

function candidates(): string[] {
  const list: string[] = []
  if (process.env.IMAGENEST_CLIP_DIR) list.push(process.env.IMAGENEST_CLIP_DIR)
  list.push(downloadTargetDir())
  list.push(join(app.getAppPath(), 'models', 'chinese-clip'))
  return list
}

export function resolveModelDir(): string | null {
  for (const dir of candidates()) {
    if (existsSync(join(dir, MODEL_FILE)) && existsSync(join(dir, VOCAB_FILE))) return dir
  }
  return null
}

export function isModelReady(): boolean {
  return resolveModelDir() !== null
}

interface Loaded {
  session: ort.InferenceSession
  tokenizer: BertTokenizer
  dir: string
}

let loaded: Promise<Loaded> | null = null

async function ensureLoaded(): Promise<Loaded> {
  if (!loaded) {
    loaded = (async () => {
      const dir = resolveModelDir()
      if (!dir) throw new Error('语义模型还没下载')
      const session = await ort.InferenceSession.create(join(dir, MODEL_FILE))
      const tokenizer = new BertTokenizer(join(dir, VOCAB_FILE))
      return { session, tokenizer, dir }
    })().catch((error) => {
      loaded = null
      throw error
    })
  }
  return loaded
}

export function resetModel(): void {
  loaded = null
}

function zeroImage(): ort.Tensor {
  return new ort.Tensor('float32', new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE), [1, 3, IMAGE_SIZE, IMAGE_SIZE])
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

/**
 * 这个 ONNX 是「双塔合并」模型，必须同时喂三个输入；
 * 另一路用零图 / 空文本占位，实际输出互不影响。
 */
export async function embedText(text: string): Promise<Float32Array> {
  const { session, tokenizer } = await ensureLoaded()
  const { ids, mask } = tokenizer.encode(text)
  const output = await session.run({
    input_ids: new ort.Tensor('int64', ids, [1, ids.length]),
    attention_mask: new ort.Tensor('int64', mask, [1, mask.length]),
    pixel_values: zeroImage()
  })
  return unit(output.text_embeds.data as Float32Array)
}

export async function embedImage(filePath: string): Promise<Float32Array> {
  const { session } = await ensureLoaded()
  const { data } = await sharp(filePath, { failOn: 'none' })
    .rotate()
    .resize(IMAGE_SIZE, IMAGE_SIZE, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const floats = new Float32Array(3 * IMAGE_SIZE * IMAGE_SIZE)
  for (let i = 0; i < IMAGE_SIZE * IMAGE_SIZE; i++) {
    for (let c = 0; c < 3; c++) {
      floats[c * IMAGE_SIZE * IMAGE_SIZE + i] = (data[i * 3 + c] / 255 - MEAN[c]) / STD[c]
    }
  }

  const output = await session.run({
    input_ids: new ort.Tensor('int64', BigInt64Array.from([101n, 102n]), [1, 2]),
    attention_mask: new ort.Tensor('int64', BigInt64Array.from([1n, 1n]), [1, 2]),
    pixel_values: new ort.Tensor('float32', floats, [1, 3, IMAGE_SIZE, IMAGE_SIZE])
  })
  return unit(output.image_embeds.data as Float32Array)
}
