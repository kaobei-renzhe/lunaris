import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { get } from 'node:https'
import { downloadTargetDir, MODEL_FILE, VOCAB_FILE } from './embedder'

const BASE = 'https://hf-mirror.com/Xenova/chinese-clip-vit-base-patch16/resolve/main/'

export interface DownloadProgress {
  received: number
  total: number
  file: string
}

const FILES = [
  { name: MODEL_FILE, url: `${BASE}onnx/${MODEL_FILE}`, size: 190_842_404 },
  { name: VOCAB_FILE, url: `${BASE}${VOCAB_FILE}`, size: 109_540 }
]

let inFlight: Promise<string> | null = null

function fetchTo(
  url: string,
  dest: string,
  onChunk: (received: number) => void,
  redirects = 0,
  startOffset = 0
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (redirects > 5) {
      reject(new Error('下载重定向过多'))
      return
    }
    const headers: Record<string, string> = { 'User-Agent': 'image-nest' }
    if (startOffset > 0) headers.Range = `bytes=${startOffset}-`

    const request = get(url, { headers }, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume()
        const next = new URL(response.headers.location, url).toString()
        fetchTo(next, dest, onChunk, redirects + 1, startOffset).then(resolve, reject)
        return
      }
      // 服务器忽略 Range 时不能追加写，交给上层清空重下
      if (startOffset > 0 && status === 200) {
        response.resume()
        reject(new Error('服务器不支持断点续传'))
        return
      }
      if (status !== 200 && status !== 206) {
        response.resume()
        reject(new Error(`下载失败：HTTP ${status}`))
        return
      }

      let received = 0
      const stream = createWriteStream(dest, { flags: startOffset > 0 ? 'a' : 'w' })
      response.on('data', (chunk: Buffer) => {
        received += chunk.length
        onChunk(received)
      })
      response.pipe(stream)
      stream.on('finish', () => stream.close(() => resolve()))
      stream.on('error', reject)
      response.on('error', reject)
    })
    request.on('error', reject)
    request.setTimeout(120_000, () => request.destroy(new Error('下载超时')))
  })
}

async function doDownload(onProgress: (progress: DownloadProgress) => void): Promise<string> {
  const dir = downloadTargetDir()
  mkdirSync(dir, { recursive: true })
  const total = FILES.reduce((sum, file) => sum + file.size, 0)
  let base = 0

  for (const file of FILES) {
    const target = join(dir, file.name)
    if (existsSync(target) && statSync(target).size === file.size) {
      base += file.size
      onProgress({ received: base, total, file: file.name })
      continue
    }

    const part = `${target}.part`
    let startOffset = existsSync(part) ? statSync(part).size : 0
    if (startOffset >= file.size) {
      rmSync(part, { force: true })
      startOffset = 0
    }

    const attempt = (offset: number): Promise<void> =>
      fetchTo(
        file.url,
        part,
        (received) => onProgress({ received: base + offset + received, total, file: file.name }),
        0,
        offset
      )

    try {
      try {
        await attempt(startOffset)
      } catch (error) {
        if (startOffset === 0) throw error
        // 续传失败就整份重来
        rmSync(part, { force: true })
        await attempt(0)
      }
      const size = statSync(part).size
      if (size !== file.size) {
        throw new Error(`下载不完整：${file.name}（${size}/${file.size} 字节）`)
      }
      renameSync(part, target)
    } catch (error) {
      rmSync(part, { force: true })
      throw error
    }
    base += file.size
  }

  return dir
}

export function downloadModel(
  onProgress: (progress: DownloadProgress) => void
): Promise<string> {
  // 连点两次时复用同一个下载任务，避免互删 .part
  if (inFlight) return inFlight
  inFlight = doDownload(onProgress).finally(() => {
    inFlight = null
  })
  return inFlight
}

export function modelDownloadComplete(): boolean {
  const dir = downloadTargetDir()
  return FILES.every((file) => {
    const path = join(dir, file.name)
    return existsSync(path) && statSync(path).size === file.size
  })
}

export function modelDirForDisplay(): string {
  return join(dirname(downloadTargetDir()), 'chinese-clip')
}
