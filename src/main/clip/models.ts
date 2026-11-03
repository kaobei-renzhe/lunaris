import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { EmbeddingModelId } from '../../shared/types'

export interface ModelFileSpec {
  name: string
  url: string
  /** 精确字节数，用来判断下载是否完整 */
  size: number
}

export interface EmbeddingModelSpec {
  id: EmbeddingModelId
  label: string
  note: string
  /** 写进 embeddings.model 的标识；换模型必须换 tag，否则新旧向量会混在一起 */
  tag: string
  dirName: string
  dim: number
  imageSize: number
  /** Chinese-CLIP 按短边缩放后中心裁切；SigLIP 的官方预处理是直接拉伸到方形 */
  resizeFit: 'cover' | 'fill'
  /** 对齐官方预处理的 resample：SigLIP 用双线性，Chinese-CLIP 沿用 sharp 默认的 lanczos3 */
  resizeKernel: 'lanczos3' | 'linear'
  mean: [number, number, number]
  std: [number, number, number]
  /** 文本塔最大长度（含 EOS） */
  maxTextLength: number
  files: ModelFileSpec[]
}

const HF_MIRROR = 'https://hf-mirror.com'
const CHINESE_CLIP_BASE = `${HF_MIRROR}/Xenova/chinese-clip-vit-base-patch16/resolve/main/`
const SIGLIP2_BASE = `${HF_MIRROR}/onnx-community/siglip2-base-patch16-224-ONNX/resolve/main/`

/**
 * 两个模型都保留：
 * - Chinese-CLIP 中文原生、体积小，是现在的默认；
 * - SigLIP 2 多语言、零样本分类更强，但体积接近两倍，换过去要重建索引。
 * 体积与实际下载文件一致，改动模型来源时记得同步更新。
 */
export const EMBEDDING_MODELS: Record<EmbeddingModelId, EmbeddingModelSpec> = {
  'chinese-clip': {
    id: 'chinese-clip',
    label: 'Chinese-CLIP',
    note: '中文原生、体积小；语义检索稳，零样本分类一般',
    tag: 'chinese-clip-vit-base-patch16-int8',
    dirName: 'chinese-clip',
    dim: 512,
    imageSize: 224,
    resizeFit: 'cover',
    resizeKernel: 'lanczos3',
    mean: [0.48145466, 0.4578275, 0.40821073],
    std: [0.26862954, 0.26130258, 0.27577711],
    maxTextLength: 52,
    files: [
      {
        name: 'model_quantized.onnx',
        url: `${CHINESE_CLIP_BASE}onnx/model_quantized.onnx`,
        size: 190_842_404
      },
      { name: 'vocab.txt', url: `${CHINESE_CLIP_BASE}vocab.txt`, size: 109_540 }
    ]
  },
  siglip2: {
    id: 'siglip2',
    label: 'SigLIP 2',
    note: '多语言，通用基准更强；本地图库实测中文类目弱于 Chinese-CLIP，建议只做对比',
    tag: 'siglip2-base-patch16-224-int8',
    dirName: 'siglip2',
    dim: 768,
    imageSize: 224,
    resizeFit: 'fill',
    resizeKernel: 'linear',
    mean: [0.5, 0.5, 0.5],
    std: [0.5, 0.5, 0.5],
    maxTextLength: 64,
    files: [
      {
        name: 'vision_model_int8.onnx',
        url: `${SIGLIP2_BASE}onnx/vision_model_int8.onnx`,
        size: 94_553_333
      },
      {
        name: 'text_model_int8.onnx',
        url: `${SIGLIP2_BASE}onnx/text_model_int8.onnx`,
        size: 283_438_275
      },
      { name: 'tokenizer.json', url: `${SIGLIP2_BASE}tokenizer.json`, size: 34_363_039 }
    ]
  }
}

export function isEmbeddingModelId(value: unknown): value is EmbeddingModelId {
  return typeof value === 'string' && value in EMBEDDING_MODELS
}

export function modelSpec(id: EmbeddingModelId): EmbeddingModelSpec {
  return EMBEDDING_MODELS[id]
}

export function modelTotalBytes(id: EmbeddingModelId): number {
  return modelSpec(id).files.reduce((sum, file) => sum + file.size, 0)
}

/** 改名前的 userData 目录名，见 index.ts 的 LEGACY_APP_DIRS */
const LEGACY_APP_DIRS = ['image-nest', 'moonnest', '月巢']

/** 模型文件放哪；IMAGENEST_* 环境变量方便开发时指向临时目录 */
export function modelDirFor(id: EmbeddingModelId): string {
  return join(app.getPath('userData'), 'models', modelSpec(id).dirName)
}

function candidates(id: EmbeddingModelId): string[] {
  const list: string[] = []
  const env = id === 'siglip2' ? process.env.IMAGENEST_SIGLIP2_DIR : process.env.IMAGENEST_CLIP_DIR
  if (env) list.push(env)
  list.push(modelDirFor(id))
  // Chinese-CLIP 老版本下过的模型直接复用，免得改名后的新装再拉一遍
  if (id === 'chinese-clip') {
    const appData = app.getPath('appData')
    for (const name of LEGACY_APP_DIRS) list.push(join(appData, name, 'models', 'chinese-clip'))
    // 开发时可能把模型放在仓库里，省得反复下载
    list.push(join(app.getAppPath(), 'models', 'chinese-clip'))
  }
  return list
}

/** 返回第一个文件齐全且大小对得上的目录 */
export function resolveModelDir(id: EmbeddingModelId): string | null {
  for (const dir of candidates(id)) {
    const complete = modelSpec(id).files.every((file) => {
      const path = join(dir, file.name)
      if (!existsSync(path)) return false
      try {
        return statSync(path).size === file.size
      } catch {
        return false
      }
    })
    if (complete) return dir
  }
  return null
}
