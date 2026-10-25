import { app } from 'electron'
import { closeLibrary, openLibrary } from '../../src/main/db'
import { filteredIds, listItems, stats } from '../../src/main/repo'

const userData = process.env.BENCH_USER_DATA
if (userData) app.setPath('userData', userData)
app.disableHardwareAcceleration()
app.commandLine.appendSwitch('disable-gpu')

function emit(payload: Record<string, unknown>): void {
  console.log('BENCH_RESULT ' + JSON.stringify(payload))
}

function time<T>(run: () => T): { value: T; ms: number } {
  const startedAt = process.hrtime.bigint()
  const value = run()
  const ms = Number(process.hrtime.bigint() - startedAt) / 1e6
  return { value, ms: Math.round(ms * 10) / 10 }
}

async function main(): Promise<void> {
  const library = process.env.BENCH_LIB
  if (!library) throw new Error('缺少 BENCH_LIB 环境变量')
  openLibrary(library)

  const firstPage = time(() => listItems({ sort: 'added' }, 0, 200))
  const ratedPage = time(() => listItems({ sort: 'added', minRating: 3 }, 0, 200))
  const allIds = time(() => filteredIds({ sort: 'added' }))
  const overview = time(() => stats())

  const payload: Record<string, unknown> = {
    kind: 'query',
    total: overview.value.total,
    firstPageMs: firstPage.ms,
    firstPageItems: firstPage.value.items.length,
    ratedPageMs: ratedPage.ms,
    filteredIdsMs: allIds.ms,
    filteredIdsCount: allIds.value.size,
    statsMs: overview.ms
  }

  // 语义检索需要模型已下载，默认跳过，避免把下载时间算进基准
  if (process.env.BENCH_CLIP === '1') {
    const { searchByText } = await import('../../src/main/embeddings.js')
    const clipStart = Date.now()
    try {
      const result = await searchByText('海边的日落', { sort: 'added' }, 200)
      payload.clipMs = Date.now() - clipStart
      payload.clipHits = result.items.length
    } catch (error) {
      payload.clipError = (error as Error).message
    }
  }

  closeLibrary()
  emit(payload)
  app.quit()
}

app
  .whenReady()
  .then(main)
  .catch((error) => {
    console.error('BENCH_ERROR ' + (error as Error).message)
    app.exit(1)
  })
