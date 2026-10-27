import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BrowserWindow, ClipboardItem, app, clipboard, dialog, ipcMain, nativeImage, nativeTheme, shell } from 'electron'
import sharp from 'sharp'
import { getIndexPath, getLibraryPath, openLibrary, resolveIndexDir } from './db'
import {
  importPaths,
  rebuildThumbs,
  cancelImport,
  clearPendingImport,
  getPendingImport,
  importStatus,
  pauseImport,
  resumeImport
} from './importer'
import { regroup } from './grouping'
import { buildCsv, createBackup, restoreBackup } from './backup'
import { log } from './logger'
import {
  getAutoBackup,
  getClipAutoIndex,
  getImportOptions,
  getIndexDirFor,
  getLayout,
  getSkin,
  getTheme,
  getThumbCacheLimitMB,
  getThumbQuality,
  libraryKey,
  readConfig,
  saveAutoBackup,
  saveClipAutoIndex,
  saveImportOptions,
  saveLayout,
  saveSkin,
  saveTheme,
  saveThumbCacheLimitMB,
  saveThumbQuality,
  setIndexDirFor,
  updateConfig
} from './settings'
import { startAutoBackup } from './scheduler'
import { clipStatus, cancelClipIndex, indexEmbeddings, invalidateClipCache, searchByText, searchSimilar } from './embeddings'
import { autoTagStatus, clearAutoTags, getAutoTagSettings, listAutoTagCategories, runAutoTag, saveAutoTagSettings } from './autoTag'
import { downloadModel } from './clip/download'
import { resetModel } from './clip/embedder'
import { startAutoClipIndex, stopAutoClipIndex } from './clip/autoIndex'
import { applyRelocate, buildRelocatePlan, getLastRelocateDir, rememberRelocateDir } from './relocate'
import { deleteGear, deleteKit, gearCatalog, gearScenarios, gearSuggestions, gearUsage, listGear, listKits, recommendGear, saveGear, saveKit } from './gear'
import { startWatching, stopWatching } from './watcher'
import { clearThumbCache, pruneHighCache, thumbCacheStats } from './thumbs'
import { syncLibrary } from './sync'
import { moveIndexTo } from './libraryStore'
import {
  getStatus as getLlmStatus,
  removeApiKey,
  runCapability,
  saveApiKey,
  scorePhotos,
  testConnection,
  updateConfig as updateLlmConfig
} from './llm'
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
  listFolders,
  listItems,
  listDirTree,
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
  trashMissing,
  unstack,
  updateItem
} from './repo'
import type { AutoBackupSettings } from './settings'
import type {
  AppDialogOptions,
  AppDialogResult,
  AutoTagSettings,
  FilterState,
  GearSpec,
  ImportOptions,
  RelocatePair,
  ScenarioId,
  ThemeMode,
  IndexMoveResult
} from '../shared/types'
import { SUPPORTED_EXT_LIST } from '../shared/formats'
import type { LayoutSizes } from '../shared/layout'
import type { ThumbQualityPref, ThumbCacheTarget } from '../shared/thumbs'
import type { LlmConfig, LlmErrorCode, LlmRunOutcome } from '../shared/llm'
import { SKINS, type SkinId } from '../shared/skins'

const IMAGE_FILTERS = [
  {
    name: '图片与 RAW',
    extensions: SUPPORTED_EXT_LIST.map((ext) => ext.slice(1))
  }
]

function activeWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows()[0] ?? null
}

let dialogSeq = 1
const pendingDialogs = new Map<number, (result: AppDialogResult) => void>()

/** 请求界面用自己的弹窗渲染；窗口不在时退回系统弹窗，避免流程卡死 */
function askDialog(options: AppDialogOptions): Promise<AppDialogResult> {
  const win = activeWindow()
  // 界面还没加载完就发事件会丢，这时退回系统弹窗
  if (!win || win.webContents.isLoading()) {
    const buttons = options.onlyConfirm ? [options.confirmText ?? '知道了'] : [options.cancelText ?? '取消', options.confirmText ?? '确定']
    return dialog
      .showMessageBox({
        type: options.kind === 'error' ? 'error' : options.kind === 'info' ? 'info' : 'warning',
        buttons,
        defaultId: options.onlyConfirm ? 0 : 1,
        cancelId: 0,
        message: options.title,
        detail: options.detail
      })
      .then((result) => ({
        confirmed: options.onlyConfirm ? true : result.response === 1,
        checked: Boolean(options.checkboxChecked)
      }))
  }

  const id = dialogSeq++
  return new Promise((resolve) => {
    pendingDialogs.set(id, resolve)
    win.webContents.send('ui:dialog-request', { id, ...options })
  })
}

/** 暂停/继续/取消后立刻把最新状态推给界面，不用等下一个文件处理完 */
function pushImportStatus(): void {
  const status = importStatus()
  if (status) activeWindow()?.webContents.send('import:progress', status)
}

/** 切换界面风格时同步原生控件深浅与窗口底色，避免露出白底 */
function applySkinNative(id: SkinId): void {
  const def = SKINS.find((skin) => skin.id === id) ?? SKINS[0]
  nativeTheme.themeSource = def.mode === 'auto' ? getTheme() : def.mode
  const background =
    def.mode === 'auto'
      ? nativeTheme.shouldUseDarkColors
        ? '#0b0d11'
        : '#f6f7fa'
      : def.base
  for (const win of BrowserWindow.getAllWindows()) win.setBackgroundColor(background)
}

function restartWatcher(): void {
  startWatching((info) => {
    activeWindow()?.webContents.send('library:changed', info)
  })
}

export function stopLibraryWatcher(): void {
  stopWatching()
  stopAutoClipIndex()
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
    // 新建的图库从零开始，索引就用这个文件夹，别沿用同路径下的旧映射
    setIndexDirFor(dir, null)
    openLibrary(dir)
    regroup()
    invalidateClipCache()
    updateConfig({ library: dir })
    restartWatcher()
    return dir
  })

  ipcMain.handle('library:open', async (_e, dir: string) => {
    if (!existsSync(dir)) throw new Error('图库目录不存在')
    // 用户主动打开一个带 library.db 的目录时，以目录内的索引为准
    if (existsSync(join(dir, 'library.db'))) setIndexDirFor(dir, null)
    openLibrary(dir)
    regroup()
    invalidateClipCache()
    updateConfig({ library: dir })
    restartWatcher()
    return dir
  })

  ipcMain.handle('library:last', async () => {
    const config = readConfig()
    if (!config.library) return { dir: null }
    const indexDir = resolveIndexDir(config.library)
    if (!existsSync(join(indexDir, 'library.db'))) {
      // 索引目录不在了：把原因带回界面，别让用户以为图库凭空消失
      const mapped = getIndexDirFor(config.library)
      const missing = libraryKey(mapped) !== libraryKey(config.library) ? mapped : undefined
      void log.warn('library', '上次的索引目录里没有 library.db', {
        library: config.library,
        indexDir
      })
      return { dir: null, indexMissing: missing }
    }
    // 重启后需要重新打开上次使用的图库，否则渲染层拿不到数据
    openLibrary(config.library)
    regroup()
    invalidateClipCache()
    restartWatcher()
    return { dir: config.library }
  })

  /** 索引（db + 缩略图 + 预览）当前放在哪 */
  ipcMain.handle('library:storage', () => {
    const library = getLibraryPath()
    if (!library) return null
    return { library, indexDir: getIndexPath() || library }
  })

  const moveIndex = (target: string | null): IndexMoveResult => {
    try {
      const result = moveIndexTo(target)
      return { ok: true, indexDir: result.indexDir, files: result.files, cleaned: result.cleaned }
    } catch (error) {
      return { ok: false, message: (error as Error).message }
    }
  }

  ipcMain.handle('library:index:pick', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择索引存放文件夹（只放索引与缓存，不动原图）',
      properties: ['openDirectory', 'createDirectory']
    })
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, cancelled: true }
    return moveIndex(picked.filePaths[0])
  })

  ipcMain.handle('library:index:move', (_e, target: string | null) => moveIndex(target ?? null))

  ipcMain.handle('items:list', (_e, filter: FilterState, offset?: number, limit?: number) =>
    listItems(filter ?? {}, offset ?? 0, limit ?? 200)
  )
  ipcMain.handle('items:get', (_e, id: number) => getItem(id))
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
  ipcMain.handle('items:trashMissing', () => {
    const ids = trashMissing()
    if (ids.length) regroup()
    return ids
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

  ipcMain.handle('import:paths', async (_e, paths: string[], options?: Partial<ImportOptions>) => {
    const win = activeWindow()
    // 记住这次的扫描选项，下次导入自动沿用
    const settings = saveImportOptions(options ?? {})
    const result = await importPaths(
      paths ?? [],
      (progress) => {
        win?.webContents.send('import:progress', progress)
      },
      true,
      settings
    )
    // 新导入的目录要纳入监听范围
    restartWatcher()
    return result
  })

  ipcMain.handle('import:pause', () => {
    pauseImport()
    pushImportStatus()
  })

  ipcMain.handle('import:resume', () => {
    resumeImport()
    pushImportStatus()
  })

  ipcMain.handle('import:cancel', () => {
    cancelImport()
    pushImportStatus()
  })

  ipcMain.handle('import:status', () => importStatus())

  ipcMain.handle('import:options:get', () => getImportOptions())

  ipcMain.handle('import:options:save', (_e, patch: Partial<ImportOptions>) =>
    saveImportOptions(patch ?? {})
  )

  ipcMain.handle('import:pending', () => getPendingImport())

  ipcMain.handle('import:pending:discard', () => {
    clearPendingImport()
  })

  ipcMain.handle('dirs:tree', () => listDirTree())

  ipcMain.handle('library:sync', async () => {
    const win = activeWindow()
    const result = await syncLibrary((progress) => {
      win?.webContents.send('import:progress', progress)
    }, getImportOptions())
    // 新出现的目录也要纳入监听
    restartWatcher()
    return result
  })

  ipcMain.handle('duplicates:find', () => findDuplicates())

  ipcMain.handle('library:backup', async () => {
    const choice = await askDialog({
      title: '备份整个图库',
      detail: '会把索引数据库（标签、评分、备注、文件夹、堆叠）打包成 zip，原图不会被复制。',
      confirmText: '开始备份',
      checkboxLabel: '同时打包缩略图与预览（体积更大，恢复后无需重新生成）',
      checkboxChecked: true
    })
    if (!choice.confirmed) return null

    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const result = await dialog.showSaveDialog({
      title: '保存图库备份',
      defaultPath: join(app.getPath('documents'), `image-nest-backup-${stamp}.zip`),
      filters: [{ name: 'Zip 压缩包', extensions: ['zip'] }]
    })
    if (result.canceled || !result.filePath) return null
    return createBackup(result.filePath, choice.checked)
  })

  ipcMain.handle('library:restore', async () => {
    const picked = await dialog.showOpenDialog({
      title: '选择月相备份文件',
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
      await askDialog({
        kind: 'error',
        title: '不能恢复到当前正在使用的图库',
        detail: '请选择另一个文件夹，或先用左上角「切换图库」关掉当前图库再恢复。',
        onlyConfirm: true,
        confirmText: '知道了'
      })
      return null
    }

    if (existsSync(join(dir, 'library.db'))) {
      const confirm = await askDialog({
        kind: 'warning',
        title: '目标文件夹已经有图库',
        detail: '继续会覆盖其中的 library.db 与缓存文件，请确认没有需要的旧数据。',
        confirmText: '覆盖',
        danger: true
      })
      if (!confirm.confirmed) return null
    }

    restoreBackup(picked.filePaths[0], dir)
    // 恢复出来的库文件就在这个目录里，清掉可能存在的旧索引映射
    setIndexDirFor(dir, null)
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
    const thumb = thumbPathFor(itemId, 'low')
    const iconPath = existsSync(thumb) ? thumb : thumbPathFor(itemId, 'mid')
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
  ipcMain.handle('gear:suggestions', () => gearSuggestions())
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
    // 固定深浅的皮肤会覆盖主题设置，这里统按当前皮肤刷新原生外观
    applySkinNative(getSkin())
    return next
  })

  ipcMain.handle('settings:skin:get', () => getSkin())

  ipcMain.handle('settings:skin:save', (_e, id: SkinId) => {
    const next = saveSkin(id)
    applySkinNative(next)
    return next
  })

  ipcMain.handle('settings:layout:get', () => getLayout())

  ipcMain.handle('settings:layout:save', (_e, patch: Partial<LayoutSizes>) => saveLayout(patch ?? {}))

  ipcMain.handle('settings:thumbQuality:get', () => getThumbQuality())

  ipcMain.handle('settings:thumbQuality:save', (_e, pref: ThumbQualityPref) => saveThumbQuality(pref))

  ipcMain.handle('thumbs:cacheStats', () => thumbCacheStats())

  ipcMain.handle('thumbs:cacheClear', (_e, target: ThumbCacheTarget) =>
    clearThumbCache(target === 'all' ? 'all' : 'high')
  )

  ipcMain.handle('settings:thumbCacheLimit:get', () => getThumbCacheLimitMB())

  ipcMain.handle('settings:thumbCacheLimit:save', async (_e, mb: number) => {
    const limit = saveThumbCacheLimitMB(mb)
    // 调小上限时立刻生效，不用等下次浏览触发
    const freed = await pruneHighCache(true)
    return { limit, freed }
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
  ipcMain.handle('clip:autoIndex:get', () => getClipAutoIndex())

  ipcMain.handle('clip:autoIndex:save', (_e, enabled: boolean) => saveClipAutoIndex(enabled))

  ipcMain.handle('clip:index', async () => {
    const win = activeWindow()
    try {
      return await indexEmbeddings((progress) => {
        win?.webContents.send('clip:index-progress', progress)
      })
    } finally {
      // 成功、取消、异常都要让界面收起进度卡片
      win?.webContents.send('clip:index-end')
    }
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

  // 闲时自动建立语义索引：系统空闲 2 分钟后才会开始，小批量慢慢跑
  startAutoClipIndex((status) => {
    activeWindow()?.webContents.send('clip:auto-status', status)
  })

  ipcMain.handle('ui:confirm', async (_e, message: string, detail?: string) => {
    const result = await askDialog({ title: message, detail, confirmText: '确定' })
    return result.confirmed
  })

  // 大模型：渲染层只碰状态与能力调用，密钥始终留在主进程
  ipcMain.handle('llm:status', () => getLlmStatus())
  ipcMain.handle('llm:config:save', (_e, patch: Partial<LlmConfig>) => updateLlmConfig(patch ?? {}))
  ipcMain.handle('llm:key:save', (_e, key: string) => saveApiKey(String(key ?? '')))
  ipcMain.handle('llm:key:clear', () => removeApiKey())
  ipcMain.handle('llm:test', () => testConnection())
  // 用信封返回：IPC 抛出的 Error 会丢掉 code，渲染层就没法区分"未配置"和"限流"
  const envelope = async <T>(run: () => Promise<T>): Promise<LlmRunOutcome> => {
    try {
      return { ok: true, data: await run() }
    } catch (error) {
      const code = (error as { code?: LlmErrorCode }).code ?? 'unknown'
      return { ok: false, code, message: (error as Error)?.message || '调用失败' }
    }
  }

  ipcMain.handle('llm:run', (_e, id: string, input: unknown) =>
    envelope(() => runCapability(String(id ?? ''), input))
  )
  // 评分与其它能力不同：结果要落库，所以单独开一个通道
  ipcMain.handle('llm:quality', (_e, itemIds: number[]) =>
    envelope(() => scorePhotos(Array.isArray(itemIds) ? itemIds : []))
  )

  ipcMain.on('ui:dialog-reply', (_e, id: number, result: AppDialogResult) => {
    const resolve = pendingDialogs.get(id)
    if (!resolve) return
    pendingDialogs.delete(id)
    resolve({ confirmed: Boolean(result?.confirmed), checked: Boolean(result?.checked) })
  })
}
