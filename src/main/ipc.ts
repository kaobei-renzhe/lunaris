import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BrowserWindow, ClipboardItem, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import sharp from 'sharp'
import { getLibraryPath, openLibrary } from './db'
import { importPaths, rebuildThumbs } from './importer'
import { regroup } from './grouping'
import { buildCsv, createBackup, restoreBackup } from './backup'
import { getAutoBackup, getTheme, readConfig, saveAutoBackup, saveTheme, updateConfig } from './settings'
import { startAutoBackup } from './scheduler'
import { clipStatus, cancelClipIndex, indexEmbeddings, invalidateClipCache, searchByText, searchSimilar } from './embeddings'
import { autoTagStatus, clearAutoTags, getAutoTagSettings, listAutoTagCategories, runAutoTag, saveAutoTagSettings } from './autoTag'
import { downloadModel } from './clip/download'
import { resetModel } from './clip/embedder'
import { applyRelocate, buildRelocatePlan, getLastRelocateDir, rememberRelocateDir } from './relocate'
import { deleteGear, deleteKit, gearCatalog, gearScenarios, gearUsage, listGear, listKits, recommendGear, saveGear, saveKit } from './gear'
import { startWatching, stopWatching } from './watcher'
import {
  addToFolder,
  createFolder,
  createStack,
  createTag,
  deleteFolder,
  deleteSmart,
  deleteTag,
  findDuplicates,
  getItem,
  getItemFile,
  filteredIds,
  listFolders,
  listItems,
  listSmart,
  listTags,
  removeFromFolder,
  rescan,
  restoreItems,
  saveSmart,
  setTag,
  stats,
  thumbPathFor,
  trashItems,
  unstack,
  updateItem
} from './repo'
import type { AutoBackupSettings } from './settings'
import type { AutoTagSettings, FilterState, GearSpec, RelocatePair, ScenarioId, ThemeMode } from '../shared/types'
import { SUPPORTED_EXT_LIST } from '../shared/formats'

const IMAGE_FILTERS = [
  {
    name: '图片与 RAW',
    extensions: SUPPORTED_EXT_LIST.map((ext) => ext.slice(1))
  }
]

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

function restartWatcher(): void {
  startWatching((info) => {
    activeWindow()?.webContents.send('library:changed', info)
  })
}

export function stopLibraryWatcher(): void {
  stopWatching()
}

export function registerIpc(): void {
  ipcMain.handle('library:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择图库文件夹',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('library:create', async (_e, dir: string) => {
    mkdirSync(dir, { recursive: true })
    openLibrary(dir)
    regroup()
    invalidateClipCache()
    updateConfig({ library: dir })
    restartWatcher()
    return dir
  })

  ipcMain.handle('library:open', async (_e, dir: string) => {
    if (!existsSync(dir)) throw new Error('图库目录不存在')
    openLibrary(dir)
    regroup()
    invalidateClipCache()
    updateConfig({ library: dir })
    restartWatcher()
    return dir
  })

  ipcMain.handle('library:last', async () => {
    const config = readConfig()
    if (config.library && existsSync(join(config.library, 'library.db'))) {
      // 重启后需要重新打开上次使用的图库，否则渲染层拿不到数据
      openLibrary(config.library)
      regroup()
      invalidateClipCache()
      restartWatcher()
      return config.library
    }
    return null
  })

  ipcMain.handle('items:list', (_e, filter: FilterState, offset?: number, limit?: number) =>
    listItems(filter ?? {}, offset ?? 0, limit ?? 200)
  )
  ipcMain.handle('items:get', (_e, id: number) => getItem(id))
  ipcMain.handle('items:filteredIds', (_e, filter: FilterState) => [...filteredIds(filter ?? {})])
  ipcMain.handle(
    'items:update',
    (_e, id: number, patch: { rating?: number; note?: string; url?: string; flag?: number }) => {
      updateItem(id, patch)
    }
  )
  ipcMain.handle('items:delete', (_e, ids: number[]) => {
    trashItems(ids)
    regroup()
  })
  ipcMain.handle('items:restore', (_e, ids: number[]) => {
    restoreItems(ids)
    regroup()
  })
  ipcMain.handle('items:stack', (_e, ids: number[]) => createStack(ids))
  ipcMain.handle('items:unstack', (_e, stackId: number) => {
    unstack(stackId)
    regroup()
  })
  ipcMain.handle('clipboard:copyImage', async (_e, id: number) => {
    const file = getItemFile(id)
    if (!file) return false
    // 统一转 PNG 再写剪贴板，兼容 jpg/webp/RAW 提取出的预览
    const png = await sharp(file, { failOn: 'none' }).png().toBuffer()
    const item = new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })
    await clipboard.write([item])
    return true
  })
  ipcMain.handle('items:rescan', () => rescan())
  ipcMain.handle('stats:get', () => stats())

  ipcMain.handle('tags:list', () => listTags())
  ipcMain.handle('tags:create', (_e, name: string, color?: string) => createTag(name, color))
  ipcMain.handle('tags:delete', (_e, id: number) => deleteTag(id))
  ipcMain.handle('tags:set', (_e, itemIds: number[], tagId: number, add: boolean) =>
    setTag(itemIds, tagId, add)
  )

  ipcMain.handle('folders:list', () => listFolders())
  ipcMain.handle('folders:create', (_e, name: string) => createFolder(name))
  ipcMain.handle('folders:delete', (_e, id: number) => deleteFolder(id))
  ipcMain.handle('folders:add', (_e, itemIds: number[], folderId: number) =>
    addToFolder(itemIds, folderId)
  )
  ipcMain.handle('folders:remove', (_e, itemIds: number[], folderId: number) =>
    removeFromFolder(itemIds, folderId)
  )

  ipcMain.handle('smart:list', () => listSmart())
  ipcMain.handle('smart:save', (_e, name: string, filter: FilterState) => saveSmart(name, filter))
  ipcMain.handle('smart:delete', (_e, id: number) => deleteSmart(id))

  ipcMain.handle('import:pickImages', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择图片',
      properties: ['openFile', 'multiSelections'],
      filters: IMAGE_FILTERS
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('import:pickFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要导入的文件夹',
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('import:paths', async (_e, paths: string[]) => {
    const win = activeWindow()
    const result = await importPaths(paths, (progress) => {
      win?.webContents.send('import:progress', progress)
    })
    // 新导入的目录要纳入监听范围
    restartWatcher()
    return result
  })

  ipcMain.handle('duplicates:find', () => findDuplicates())

  ipcMain.handle('library:backup', async () => {
    const choice = await dialog.showMessageBox({
      type: 'question',
      buttons: ['开始备份', '取消'],
      defaultId: 0,
      cancelId: 1,
      message: '备份整个图库',
      detail: '会把索引数据库（标签、评分、备注、文件夹、堆叠）打包成 zip，原图不会被复制。',
      checkboxLabel: '同时打包缩略图与预览（体积更大，恢复后无需重新生成）',
      checkboxChecked: true
    })
    if (choice.response !== 0) return null

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result = await dialog.showSaveDialog({
      title: '保存图库备份',
      defaultPath: join(app.getPath('documents'), `image-nest-backup-${stamp}.zip`),
      filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return null
    return createBackup(result.filePath, choice.checkboxChecked)
  })

  ipcMain.handle('library:restore', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择月巢备份文件',
      properties: ['openFile'],
      filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
    })
    if (picked.canceled || !picked.filePaths[0]) return null

    const target = await dialog.showOpenDialog({
      title: '选择恢复到的文件夹（建议新建一个空文件夹）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (target.canceled || !target.filePaths[0]) return null
    const dir = target.filePaths[0]

    // 不能覆盖当前正在使用的图库：数据库连接还开着（WAL），强行写 library.db 有损坏风险
    const current = getLibraryPath()
    if (current && resolve(dir).toLowerCase() === resolve(current).toLowerCase()) {
      await dialog.showMessageBox({
        type: 'error',
        message: '不能恢复到当前正在使用的图库',
        detail: '请选择另一个文件夹，或先用左上角「切换图库」关掉当前图库再恢复。'
      })
      return null
    }

    if (existsSync(join(dir, 'library.db'))) {
      const confirm = await dialog.showMessageBox({
        type: 'warning',
        buttons: ['取消', '覆盖'],
        defaultId: 0,
        cancelId: 0,
        message: '目标文件夹已经有图库',
        detail: '继续会覆盖其中的 library.db 与缓存文件，请确认没有需要的旧数据。'
      })
      if (confirm.response !== 1) return null
    }

    restoreBackup(picked.filePaths[0], dir)
    openLibrary(dir)
    // 恢复的是另一套数据，旧的向量缓存必须丢弃
    invalidateClipCache()
    regroup()
    updateConfig({ library: dir })
    restartWatcher()

    // 备份可能没打包缩略图，这里补齐，避免恢复后整页破图
    const win = activeWindow()
    await rebuildThumbs((progress) => win?.webContents.send('import:progress', progress))
    return dir
  })

  ipcMain.handle('library:exportCsv', async () => {
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result = await dialog.showSaveDialog({
      title: '导出素材清单',
      defaultPath: join(app.getPath('documents'), `image-nest-list-${stamp}.csv`),
      filters: [{ name: 'CSV 表格', extensions: ['csv'] }]
    })
    if (result.canceled || !result.filePath) return null
    const { content, count } = buildCsv()
    writeFileSync(result.filePath, content, 'utf8')
    return { path: result.filePath, count }
  })

  ipcMain.handle('shell:showItem', (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  // Alt + 拖拽卡片：交给系统原生拖拽，可直接拖到资源管理器 / 其它应用
  ipcMain.on('shell:startDrag', (event, itemId: number) => {
    const file = getItemFile(itemId)
    if (!file || !existsSync(file)) return
    const thumb = thumbPathFor(itemId, true)
    const iconPath = existsSync(thumb) ? thumb : thumbPathFor(itemId)
    const icon = existsSync(iconPath) ? nativeImage.createFromPath(iconPath) : nativeImage.createEmpty()
    event.sender.startDrag({ file, icon })
  })

  ipcMain.handle('relocate:last', () => getLastRelocateDir())

  ipcMain.handle('relocate:plan', (_e, dir: string) => buildRelocatePlan(dir))

  ipcMain.handle('relocate:pick', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择图片现在所在的文件夹',
      properties: ['openDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return null
    const dir = picked.filePaths[0]
    const plan = await buildRelocatePlan(dir)
    rememberRelocateDir(dir)
    return plan
  })

  ipcMain.handle('relocate:apply', (_e, pairs: RelocatePair[]) => applyRelocate(pairs ?? []))

  ipcMain.handle('gear:list', () => listGear())
  ipcMain.handle('gear:save', (_e, item: GearSpec & { id?: string }) => saveGear(item))
  ipcMain.handle('gear:delete', (_e, id: string) => deleteGear(id))
  ipcMain.handle('gear:catalog', () => gearCatalog())
  ipcMain.handle('gear:scenarios', () => gearScenarios())
  ipcMain.handle('gear:recommend', (_e, scenario: ScenarioId) => recommendGear(scenario))
  ipcMain.handle('gear:usage', () => gearUsage())
  ipcMain.handle('gear:kits', () => listKits())
  ipcMain.handle(
    'gear:kitSave',
    (
      _e,
      kit: { name: string; scenario: ScenarioId; bodyId?: string; lensId?: string; accessoryIds?: string[] }
    ) => saveKit(kit)
  )
  ipcMain.handle('gear:kitDelete', (_e, id: string) => deleteKit(id))

  ipcMain.handle('settings:autoBackup:get', () => getAutoBackup())

  ipcMain.handle('settings:theme:get', () => getTheme())

  ipcMain.handle('settings:theme:save', (_e, mode: ThemeMode) => {
    const next = saveTheme(mode)
    nativeTheme.themeSource = next
    const background = nativeTheme.shouldUseDarkColors ? '#0b0d11' : '#f6f7fa'
    for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background)
    return next
  })

  ipcMain.handle('settings:autoBackup:save', (_e, patch: Partial<AutoBackupSettings>) =>
    saveAutoBackup(patch)
  )

  ipcMain.handle('settings:autoBackup:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择自动备份保存位置',
      properties: ['openDirectory', 'createDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('clip:status', () => clipStatus())

  ipcMain.handle('clip:index', async () => {
    const win = activeWindow()
    return indexEmbeddings((progress) => {
      win?.webContents.send('clip:index-progress', progress)
    })
  })

  ipcMain.handle('clip:cancel', () => {
    cancelClipIndex()
  })

  ipcMain.handle('clip:searchText', (_e, query: string, filter: FilterState, limit?: number) =>
    searchByText(query, filter ?? {}, limit ?? 200)
  )

  ipcMain.handle('clip:similar', (_e, itemId: number, limit?: number) =>
    searchSimilar(itemId, limit ?? 200)
  )

  ipcMain.handle('clip:download', async () => {
    const win = activeWindow()
    const dir = await downloadModel((progress) => {
      win?.webContents.send('clip:download-progress', progress)
    })
    resetModel()
    return dir
  })

  ipcMain.handle('clip:autoTagCategories', () => listAutoTagCategories())

  ipcMain.handle('clip:autoTagSettings:get', () => getAutoTagSettings())

  ipcMain.handle('clip:autoTagSettings:save', (_e, patch: Partial<AutoTagSettings>) =>
    saveAutoTagSettings(patch ?? {})
  )

  ipcMain.handle('clip:autoTagStatus', () => autoTagStatus())

  ipcMain.handle('clip:autoTag', async () => {
    const win = activeWindow()
    return runAutoTag((progress) => win?.webContents.send('clip:autotag-progress', progress))
  })

  ipcMain.handle('clip:autoTagClear', () => clearAutoTags())

  startAutoBackup((result) => {
    activeWindow()?.webContents.send('backup:auto', result)
  })

  ipcMain.handle('ui:confirm', async (_e, message: string, detail?: string) => {
    const win = activeWindow()
    const result = win
      ? await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['取消', '确定'],
          defaultId: 0,
          cancelId: 0,
          message,
          detail
        })
      : await dialog.showMessageBox({
          type: 'warning',
          buttons: ['取消', '确定'],
          defaultId: 0,
          cancelId: 0,
          message,
          detail
        })
    return result.response === 1
  })
}
