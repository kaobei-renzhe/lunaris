import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, nativeTheme, net, protocol } from 'electron'
import { registerIpc, stopLibraryWatcher } from './ipc'
import { getLightboxFile, thumbPathFor } from './repo'
import { ensureThumb, pruneHighCache, touchHighThumb } from './thumbs'
import { isThumbQuality } from '../shared/thumbs'
import { closeLibrary } from './db'
import { getSkin, getTheme } from './settings'
import { log } from './logger'
import { installCrashGuards } from './crash'
import { SKINS } from '../shared/skins'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'thumb',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  },
  {
    scheme: 'photo',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

// 越早安装越好：启动阶段的异常也要能落盘
installCrashGuards()

function parseId(request: Request): number {
  const url = new URL(request.url)
  return Number(url.pathname.replace(/^\/+/, ''))
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function currentSkin() {
  return SKINS.find((skin) => skin.id === getSkin()) ?? SKINS[0]
}

/** 首帧窗口底色：固定风格用皮肤底色，经典跟随深浅 */
function windowBackground(): string {
  const skin = currentSkin()
  if (skin.mode !== 'auto') return skin.base
  return nativeTheme.shouldUseDarkColors ? '#0b0d11' : '#f6f7fa'
}

/**
 * 调试开关：LUNARIS_HEADLESS=1 时窗口创建出来但不显示（照常渲染，可走调试端口截图），
 * 免得跑一次调试就把界面弹到最前面打断手头的事。
 */
const headless = process.env.LUNARIS_HEADLESS === '1'

function createWindow(): void {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    title: '月相',
    show: !headless,
    // 隐藏态也要出帧，否则调试端口截到的是空白
    paintWhenInitiallyHidden: true,
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 沙箱实测：preload 仍能拿到 ipcRenderer / contextBridge / webUtils.getPathForFile
      sandbox: true
    }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const debugPort = process.env.IMAGENEST_DEBUG_PORT
if (debugPort) app.commandLine.appendSwitch('remote-debugging-port', debugPort)

const customUserData = process.env.IMAGENEST_USER_DATA ?? process.env.LUNARIS_USER_DATA

/**
 * 改名（月巢 / image-nest → 月相 / lunaris）后 Electron 的 userData 目录跟着变了，
 * 首次启动时把旧目录里的配置、装备库与日志搬过来，老图库不用重新配置一遍。
 * 只在目标目录还没有 config.json（即没配过）时执行，搬完就不管了。
 */
const LEGACY_APP_DIRS = ['image-nest', 'moonnest', '月巢']

function migrateLegacyUserData(): void {
  const target = app.getPath('userData')
  if (existsSync(join(target, 'config.json'))) return
  const appData = app.getPath('appData')
  for (const name of LEGACY_APP_DIRS) {
    const legacy = join(appData, name)
    if (legacy === target) continue
    if (!existsSync(join(legacy, 'config.json'))) continue
    try {
      mkdirSync(target, { recursive: true })
      // 只搬业务数据；Cache / GPU 缓存这些重建即可，没必要带
      for (const item of ['config.json', 'gear.json', 'logs']) {
        const from = join(legacy, item)
        if (existsSync(from)) cpSync(from, join(target, item), { recursive: true, force: false })
      }
      void log.info('app', '已从旧版本迁移配置', { from: legacy, to: target })
    } catch (error) {
      void log.warn('app', '迁移旧配置失败，按全新配置启动', { from: legacy, error: String(error) })
    }
    return
  }
}

if (customUserData) app.setPath('userData', customUserData)
else migrateLegacyUserData()

app.whenReady().then(() => {
  void log.info('app', '启动', {
    version: app.getVersion(),
    electron: process.versions.electron,
    userData: app.getPath('userData')
  })
  const skin = currentSkin()
  nativeTheme.themeSource = skin.mode === 'auto' ? getTheme() : skin.mode

  protocol.handle('thumb', async (request) => {
    try {
      const id = parseId(request)
      const raw = new URL(request.url).searchParams.get('q')
      const quality = isThumbQuality(raw) ? raw : 'mid'
      // 三档都按需补：高档是常态，中/低档只在缓存被清理或缺失时才真正生成
      await ensureThumb(id, quality)
      // 高清还没生成好 / 小图缺失时逐级回退，界面不会出现空白
      for (const fallback of [quality, 'mid', 'low'] as const) {
        const file = thumbPathFor(id, fallback)
        if (existsSync(file)) {
          if (fallback === 'high') {
            touchHighThumb(id)
            void pruneHighCache()
          }
          return net.fetch(pathToFileURL(file).toString())
        }
      }
      return notFound()
    } catch {
      return notFound()
    }
  })

  protocol.handle('photo', async (request) => {
    try {
      const id = parseId(request)
      const file = getLightboxFile(id)
      if (file && existsSync(file)) return net.fetch(pathToFileURL(file).toString())
      const fallback = thumbPathFor(id)
      if (existsSync(fallback)) return net.fetch(pathToFileURL(fallback).toString())
      return notFound()
    } catch {
      return notFound()
    }
  })

  registerIpc()
  createWindow()

  // 上次退出时可能留下超限的高清缓存，等图库打开后收一次
  setTimeout(() => void pruneHighCache(true), 20000)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', () => {
  void log.info('app', '准备退出，收尾数据库')
  // closeLibrary 内部会 checkpoint，异常退出后下次打开也会再收一次
  closeLibrary()
})

app.on('window-all-closed', () => {
  void log.info('app', '窗口全部关闭，退出')
  stopLibraryWatcher()
  closeLibrary()
  app.quit()
})
