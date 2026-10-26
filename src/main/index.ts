import { existsSync } from 'node:fs'
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

function createWindow(): void {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: windowBackground(),
    autoHideMenuBar: true,
    title: '月巢',
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

const customUserData = process.env.IMAGENEST_USER_DATA
if (customUserData) app.setPath('userData', customUserData)

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
