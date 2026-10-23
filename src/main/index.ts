import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { BrowserWindow, app, nativeTheme, net, protocol } from 'electron'
import { registerIpc, stopLibraryWatcher } from './ipc'
import { getLightboxFile, thumbPathFor } from './repo'
import { closeLibrary } from './db'
import { getTheme } from './settings'

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

function parseId(request: Request): number {
  const url = new URL(request.url)
  return Number(url.pathname.replace(/^\/+/, ''))
}

function notFound(): Response {
  return new Response('Not found', { status: 404 })
}

function createWindow(): void {
  const iconPath = join(app.getAppPath(), 'build', 'icon.png')
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0d11' : '#f6f7fa',
    autoHideMenuBar: true,
    title: '月巢',
    ...(existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
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
  nativeTheme.themeSource = getTheme()

  protocol.handle('thumb', async (request) => {
    try {
      const id = parseId(request)
      const small = new URL(request.url).searchParams.get('s') === '1'
      const file = thumbPathFor(id, small)
      if (!existsSync(file)) return notFound()
      return net.fetch(pathToFileURL(file).toString())
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

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  stopLibraryWatcher()
  closeLibrary()
  app.quit()
})
