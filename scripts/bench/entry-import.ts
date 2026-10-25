import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { closeLibrary, openLibrary } from '../../src/main/db'
import { importPaths } from '../../src/main/importer'

// 必须在任何 getPath 之前切换 userData，避免污染真实配置
const userData = process.env.BENCH_USER_DATA
if (userData) app.setPath('userData', userData)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

function emit(payload: Record<string, unknown>): void {
  console.log('BENCH_RESULT ' + JSON.stringify(payload))
}

async function main(): Promise<void> {
  const library = process.env.BENCH_LIB
  const images = process.env.BENCH_IMAGES
  if (!library || !images) throw new Error('缺少 BENCH_LIB / BENCH_IMAGES 环境变量')

  mkdirSync(library, { recursive: true })
  openLibrary(library)

  let peakRss = process.memoryUsage().rss
  const sampler = setInterval(() => {
    peakRss = Math.max(peakRss, process.memoryUsage().rss)
  }, 50)

  const startedAt = Date.now()
  let result
  try {
    result = await importPaths([images], () => undefined, false, {
      recursive: true,
      skipDuplicates: true
    })
  } finally {
    clearInterval(sampler)
  }
  const elapsedMs = Date.now() - startedAt
  closeLibrary()

  emit({
    kind: 'import',
    elapsedMs,
    peakRssMb: Math.round(peakRss / 1048576),
    ...result
  })
  app.quit()
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error('BENCH_ERROR ' + (error as Error).message)
    app.exit(1)
  })
