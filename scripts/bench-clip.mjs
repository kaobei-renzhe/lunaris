// 语义检索性能实测：造 N 条向量 → 走真实 searchSimilar → 报告冷/热耗时与内存
// 用法：npm run bench:clip            （5k / 30k / 60k 三档）
//      npm run bench:clip -- --quick  （只跑 5k / 30k）
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { arch, cpus, platform, release, totalmem } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const benchDir = join(root, '.cache', 'bench')
const userDataDir = join(benchDir, 'clip-userData')
const jsDir = join(benchDir, 'js')

const scales = process.argv.includes('--quick') ? [5000, 30000] : [5000, 30000, 60000]

const tscJs = join(root, 'node_modules', 'typescript', 'bin', 'tsc')

function electronBinary() {
  const dist = join(root, 'node_modules', 'electron', 'dist')
  if (process.platform === 'win32') return join(dist, 'electron.exe')
  if (process.platform === 'darwin') return join(dist, 'Electron.app', 'Contents', 'MacOS', 'Electron')
  return join(dist, 'electron')
}

function readVersion() {
  try {
    return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version
  } catch {
    return 'unknown'
  }
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    timeout: 10 * 60 * 1000
  })
  if (result.error) throw result.error
  return result
}

function parseResult(stdout) {
  const text = stdout || ''
  const line = text.split(/\r?\n/).find((entry) => entry.startsWith('BENCH_RESULT '))
  if (!line) {
    const errorLine = text.split(/\r?\n/).find((entry) => entry.startsWith('BENCH_ERROR '))
    throw new Error(errorLine || '基准没有输出结果')
  }
  return JSON.parse(line.slice('BENCH_RESULT '.length))
}

function main() {
  console.log('[clip] 编译基准入口…')
  const compile = run(process.execPath, [tscJs, '-p', 'tsconfig.bench.json'], {})
  if (compile.status !== 0) {
    process.stdout.write(compile.stdout || '')
    process.stderr.write(compile.stderr || '')
    throw new Error('tsc 编译基准入口失败')
  }

  rmSync(userDataDir, { recursive: true, force: true })
  mkdirSync(userDataDir, { recursive: true })

  const entry = join(jsDir, 'scripts', 'bench', 'entry-clip.js')
  const results = []
  for (const scale of scales) {
    const library = join(benchDir, `clip-library-${scale}`)
    rmSync(library, { recursive: true, force: true })
    mkdirSync(library, { recursive: true })
    const env = {
      BENCH_LIB: library,
      BENCH_USER_DATA: userDataDir,
      BENCH_N: String(scale),
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1'
    }
    console.log(`[clip] ${scale} 条向量 · 造库并首次检索…`)
    const seeded = parseResult(run(electronBinary(), [entry], { ...env, BENCH_SEED: '1' }).stdout)
    console.log(`[clip] ${scale} 条向量 · 读快照冷启动…`)
    const snapshot = parseResult(run(electronBinary(), [entry], { ...env, BENCH_SEED: '0' }).stdout)
    results.push({ n: scale, dim: seeded.dim, seeded, snapshot })
  }

  const payload = {
    version: readVersion(),
    createdAt: new Date().toISOString(),
    machine: {
      platform: `${platform()} ${release()} ${arch()}`,
      cpu: cpus()[0]?.model ?? 'unknown',
      cores: cpus().length,
      totalMemGb: Math.round((totalmem() / 1024 ** 3) * 10) / 10
    },
    results
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const outFile = join(benchDir, `clip-${stamp}.json`)
  mkdirSync(benchDir, { recursive: true })
  writeFileSync(outFile, JSON.stringify(payload, null, 2), 'utf8')

  console.log('\n===== 语义检索基准 =====')
  console.log(`${payload.machine.cpu} · ${payload.machine.cores} 核 · ${payload.machine.totalMemGb} GB`)
  console.log('向量数\t冷启动(读库)\t冷启动(快照)\t热检索\t内存增量\t向量体积\t排名一致\t增量追加\t快照失效')
  for (const item of results) {
    const { seeded, snapshot } = item
    console.log(
      `${item.n}\t${seeded.coldMs} ms\t${snapshot.coldMs} ms\t${seeded.warmMedianMs} ms\t` +
        `${seeded.rssDeltaMb} MB\t${seeded.vectorBytesMb} MB\t` +
        `${seeded.matchTop && snapshot.matchTop ? '是' : '否'}\t` +
        `${seeded.appendOk && seeded.appendDuplicateFree ? '是' : '否'}\t` +
        `${snapshot.staleOk ? '是' : '否'}`
    )
  }
  console.log(`结果已写入 ${outFile}`)
}

main()
