import { existsSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 打包后清理 release：只保留最新版本的安装包与 blockmap。
 * 由 `npm run dist` 自动调用。
 */
const dir = join(process.cwd(), 'release')
if (!existsSync(dir)) process.exit(0)

const versionOf = (name) => {
  const match = name.match(/(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1).map(Number) : [0, 0, 0]
}

const compare = (a, b) => {
  const left = versionOf(a)
  const right = versionOf(b)
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] - right[i]
  }
  return 0
}

const entries = readdirSync(dir)
const installers = entries
  .filter((name) => /^月相 Setup \d+\.\d+\.\d+\.exe$/.test(name))
  .sort(compare)

if (installers.length <= 1) {
  process.exit(0)
}

const keep = installers[installers.length - 1]
const keepVersion = versionOf(keep).join('.')

for (const name of installers) {
  if (name === keep) continue
  rmSync(join(dir, name), { force: true })
  rmSync(join(dir, `${name}.blockmap`), { force: true })
}

for (const name of entries) {
  if (!/^lunaris-\d+\.\d+\.\d+-x64\.nsis\.7z$/.test(name)) continue
  if (versionOf(name).join('.') === keepVersion) continue
  rmSync(join(dir, name), { force: true })
}

console.log(`[release] 只保留最新安装包：${keep}`)
