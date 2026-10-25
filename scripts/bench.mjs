// 基准脚本：生成固定图片集 → 走真实导入管线 → 记录耗时/内存与查询延迟
// 用法：npm run bench            （完整跑一遍并写入 .cache/bench/<时间>.json）
//      npm run bench -- --reuse  （复用上次生成的图片，省时间）
import { spawnSync } from 'node:child_process'
import { randomFillSync } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { cpus, totalmem, platform, release, arch } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

const root = process.cwd()
const benchDir = join(root, '.cache', 'bench')
const imageDir = join(benchDir, 'images')
const libraryDir = join(benchDir, 'library')
const userDataDir = join(benchDir, 'userData')
const jsDir = join(benchDir, 'js')

const reuse = process.argv.includes('--reuse')

// 固定规模，保证不同版本之间的数字可比
const PLAN = [
  ...Array.from({ length: 3 }, () => ({ width: 6000, height: 4000 })),
  ...Array.from({ length: 9 }, () => ({ width: 4000, height: 3000 })),
  ...Array.from({ length: 18 }, () => ({ width: 2000, height: 1500 }))
]

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

async function ensureImages() {
  mkdirSync(imageDir, { recursive: true })
  const expected = PLAN.map((_, index) => join(imageDir, `img-${String(index + 1).padStart(3, '0')}.jpg`))

  await Promise.all(
    PLAN.map(async (size, index) => {
      const file = expected[index]
      if (reuse && existsSync(file) && statSync(file).size > 0) return
      // 随机像素：解码代价接近真实照片，且不同图内容不同，不会被内容查重误杀
      const buffer = Buffer.allocUnsafe(size.width * size.height * 3)
      randomFillSync(buffer)
      await sharp(buffer, { raw: { width: size.width, height: size.height, channels: 3 } })
        .jpeg({ quality: 82 })
        .toFile(file)
    })
  )

  // 两个完全相同的副本，用来验证内容查重是否会跳过
  const duplicates = ['dup-a.jpg', 'dup-b.jpg']
  for (const name of duplicates) {
    const target = join(imageDir, name)
    if (!reuse || !existsSync(target)) copyFileSync(expected[0], target)
  }

  return expected.length + duplicates.length
}

function run(command, args, env, withOutput) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10 * 60 * 1000
  })
  if (withOutput) process.stdout.write(result.stdout || '')
  if (result.error) throw result.error
  return result
}

/** 直接调本地二进制，避免走 shell 带来的转义与弃用告警 */
const tscJs = join(root, 'node_modules', 'typescript', 'bin', 'tsc')
function electronBinary() {
  const dist = join(root, 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return join(dist, 'electron.exe')
  if (process.platform === 'darwin') return join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return join(dist, 'electron')
}

function parseResult(stdout, kind) {
  const line = (stdout || '')
    .split(/\r?\n/)
    .find((entry) => entry.startsWith('BENCH_RESULT '))
  if (!line) {
    const errorLine = (stdout || '').split(/\r?\n/).find((entry) => entry.startsWith('BENCH_ERROR '))
    throw new Error(errorLine || `${kind} 没有输出结果`)
  }
  return JSON.parse(line.slice('BENCH_RESULT '.length))
}

async function main() {
  console.log('[bench] 准备图片…')
  const imageCount = await ensureImages()
  console.log(`[bench] 图片就绪：${imageCount} 张`)

  // 每次跑干净的库，避免上一轮数据影响计数
  rmSync(libraryDir, { recursive: true, force: true })
  rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(libraryDir, { recursive: true })
  mkdirSync(userDataDir, { recursive: true })

  console.log('[bench] 编译基准入口…')
  const compile = run(process.execPath, [tscJs, '-p', 'tsconfig.bench.json'], {}, false)
  if (compile.status !== 0) {
    process.stdout.write(compile.stdout || '')
    process.stderr.write(compile.stderr || '')
    throw new Error('tsc 编译基准入口失败')
  }

  const entryDir = join(jsDir, 'scripts', 'bench')
  const env = {
    BENCH_LIB: libraryDir,
    BENCH_IMAGES: imageDir,
    BENCH_USER_DATA: userDataDir,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
  }

  console.log('[bench] 跑导入管线（含缩略图、色彩、dHash、查重）…')
  const imported = parseResult(
    run(electronBinary(), [join(entryDir, 'entry-import.js')], env, false).stdout,
    'import'
  )

  console.log('[bench] 跑查询…')
  const queried = parseResult(
    run(electronBinary(), [join(entryDir, 'entry-query.js')], env, false).stdout,
    'query'
  )

  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 19)
  const payload = {
    version: readVersion(),
    createdAt: stamp,
    machine: {
      platform: `${platform()} ${release()} ${arch()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10
    },
    images: PLAN.map((size) => `${size.width}x${size.height}`),
    import: imported,
    query: queried
  }

  const outFile = join(benchDir, `${stamp}.json`)
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')

  console.log('\n===== 基准结果 =====')
  console.log(`版本 ${payload.version} · ${payload.machine.cpu} · ${payload.machine.cores} 核`)
  console.log(
    `导入：${imported.scanned} 张 / 新增 ${imported.added} / 跳过 ${imported.skipped} / 失败 ${imported.failed}` +
      ` · ${imported.elapsedMs} ms · 每张 ${Math.round(imported.elapsedMs / Math.max(1, imported.scanned))} ms` +
      ` · 峰值内存 ${imported.peakRssMb} MB`
  )
  console.log(
    `查询：首页 200 张 ${queried.firstPageMs} ms · 全部 id ${queried.filteredIdsMs} ms（${queried.filteredIdsCount} 条）` +
      ` · 评分筛选 ${queried.ratedPageMs} ms`
  )
  console.log(`结果已写入 ${outFile}`)
}

main().catch((error) => {
  console.error('[bench] 失败：' + error.message)
  process.exitCode = 1
})
