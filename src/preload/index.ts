import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Api,
  AppDialogRequest,
  AutoBackupResult,
  AutoTagProgress,
  ClipDownloadProgress,
  ClipProgress,
  ClipStatus,
  FilterState,
  ImportOptions,
  ImportProgress,
  LibraryChange
} from '../shared/types'

const api: Api = {
  pickLibraryDir: () => ipcRenderer.invoke('library:pick'),
  createLibrary: (dir: string) => ipcRenderer.invoke('library:create', dir),
  openLibrary: (dir: string) => ipcRenderer.invoke('library:open', dir),
  lastLibrary: () => ipcRenderer.invoke('library:last'),
  getLibraryStorage: () => ipcRenderer.invoke('library:storage'),
  pickIndexDir: () => ipcRenderer.invoke('library:index:pick'),
  moveIndexDir: (target) => ipcRenderer.invoke('library:index:move', target),

  listItems: (filter: FilterState, offset?: number, limit?: number) =>
    ipcRenderer.invoke('items:list', filter, offset, limit),
  getItem: (id: number) => ipcRenderer.invoke('items:get', id),
  updateItem: (id: number, patch) => ipcRenderer.invoke('items:update', id, patch),
  deleteItems: (ids: number[]) => ipcRenderer.invoke('items:delete', ids),
  trashMissing: () => ipcRenderer.invoke('items:trashMissing'),
  restoreItems: (ids: number[]) => ipcRenderer.invoke('items:restore', ids),
  copyImage: (id: number) => ipcRenderer.invoke('clipboard:copyImage', id),
  stackItems: (ids: number[]) => ipcRenderer.invoke('items:stack', ids),
  unstack: (stackId: number) => ipcRenderer.invoke('items:unstack', stackId),
  rescan: () => ipcRenderer.invoke('items:rescan'),
  stats: () => ipcRenderer.invoke('stats:get'),

  listTags: () => ipcRenderer.invoke('tags:list'),
  createTag: (name: string, color?: string) => ipcRenderer.invoke('tags:create', name, color),
  deleteTag: (id: number) => ipcRenderer.invoke('tags:delete', id),
  setTag: (itemIds: number[], tagId: number, add: boolean) =>
    ipcRenderer.invoke('tags:set', itemIds, tagId, add),

  listFolders: () => ipcRenderer.invoke('folders:list'),
  createFolder: (name: string) => ipcRenderer.invoke('folders:create', name),
  deleteFolder: (id: number) => ipcRenderer.invoke('folders:delete', id),
  addToFolder: (itemIds: number[], folderId: number) =>
    ipcRenderer.invoke('folders:add', itemIds, folderId),
  removeFromFolder: (itemIds: number[], folderId: number) =>
    ipcRenderer.invoke('folders:remove', itemIds, folderId),

  listSmart: () => ipcRenderer.invoke('smart:list'),
  saveSmart: (name: string, filter: FilterState) => ipcRenderer.invoke('smart:save', name, filter),
  deleteSmart: (id: number) => ipcRenderer.invoke('smart:delete', id),

  pickImages: () => ipcRenderer.invoke('import:pickImages'),
  pickFolder: () => ipcRenderer.invoke('import:pickFolder'),
  importPaths: (paths: string[], options?: Partial<ImportOptions>) =>
    ipcRenderer.invoke('import:paths', paths, options),
  pauseImport: () => ipcRenderer.invoke('import:pause'),
  resumeImport: () => ipcRenderer.invoke('import:resume'),
  cancelImport: () => ipcRenderer.invoke('import:cancel'),
  importStatus: () => ipcRenderer.invoke('import:status'),
  getImportOptions: () => ipcRenderer.invoke('import:options:get'),
  saveImportOptions: (options: Partial<ImportOptions>) =>
    ipcRenderer.invoke('import:options:save', options),
  listDirTree: () => ipcRenderer.invoke('dirs:tree'),
  syncLibrary: () => ipcRenderer.invoke('library:sync'),
  pendingImport: () => ipcRenderer.invoke('import:pending'),
  discardPendingImport: () => ipcRenderer.invoke('import:pending:discard'),

  findDuplicates: () => ipcRenderer.invoke('duplicates:find'),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
  restoreLibrary: () => ipcRenderer.invoke('library:restore'),
  exportCsv: () => ipcRenderer.invoke('library:exportCsv'),
  getAutoBackup: () => ipcRenderer.invoke('settings:autoBackup:get'),
  saveAutoBackup: (patch) => ipcRenderer.invoke('settings:autoBackup:save', patch),
  pickAutoBackupDir: () => ipcRenderer.invoke('settings:autoBackup:pickDir'),
  clipStatus: () => ipcRenderer.invoke('clip:status'),
  getClipAutoIndex: () => ipcRenderer.invoke('clip:autoIndex:get'),
  saveClipAutoIndex: (enabled: boolean) => ipcRenderer.invoke('clip:autoIndex:save', enabled),
  clipIndex: () => ipcRenderer.invoke('clip:index'),
  clipCancel: () => ipcRenderer.invoke('clip:cancel'),
  clipSearchText: (query: string, filter: FilterState, limit?: number) =>
    ipcRenderer.invoke('clip:searchText', query, filter, limit),
  clipSimilar: (itemId: number, limit?: number) =>
    ipcRenderer.invoke('clip:similar', itemId, limit),
  clipDownloadModel: () => ipcRenderer.invoke('clip:download'),
  autoTagCategories: () => ipcRenderer.invoke('clip:autoTagCategories'),
  getAutoTagSettings: () => ipcRenderer.invoke('clip:autoTagSettings:get'),
  saveAutoTagSettings: (patch) => ipcRenderer.invoke('clip:autoTagSettings:save', patch),
  autoTagStatus: () => ipcRenderer.invoke('clip:autoTagStatus'),
  autoTag: () => ipcRenderer.invoke('clip:autoTag'),
  clearAutoTags: () => ipcRenderer.invoke('clip:autoTagClear'),
  showInFolder: (path: string) => ipcRenderer.invoke('shell:showItem', path),
  pickRelocateDir: () => ipcRenderer.invoke('relocate:pick'),
  planRelocate: (dir) => ipcRenderer.invoke('relocate:plan', dir),
  lastRelocateDir: () => ipcRenderer.invoke('relocate:last'),
  applyRelocate: (pairs) => ipcRenderer.invoke('relocate:apply', pairs),
  listGear: () => ipcRenderer.invoke('gear:list'),
  saveGear: (item) => ipcRenderer.invoke('gear:save', item),
  deleteGear: (id: string) => ipcRenderer.invoke('gear:delete', id),
  gearCatalog: () => ipcRenderer.invoke('gear:catalog'),
  gearSuggestions: () => ipcRenderer.invoke('gear:suggestions'),
  gearScenarios: () => ipcRenderer.invoke('gear:scenarios'),
  recommendGear: (scenario) => ipcRenderer.invoke('gear:recommend', scenario),
  gearUsage: () => ipcRenderer.invoke('gear:usage'),
  listKits: () => ipcRenderer.invoke('gear:kits'),
  saveKit: (kit) => ipcRenderer.invoke('gear:kitSave', kit),
  deleteKit: (id: string) => ipcRenderer.invoke('gear:kitDelete', id),
  getTheme: () => ipcRenderer.invoke('settings:theme:get'),
  saveTheme: (mode) => ipcRenderer.invoke('settings:theme:save', mode),
  getSkin: () => ipcRenderer.invoke('settings:skin:get'),
  saveSkin: (id) => ipcRenderer.invoke('settings:skin:save', id),
  getLayout: () => ipcRenderer.invoke('settings:layout:get'),
  saveLayout: (patch) => ipcRenderer.invoke('settings:layout:save', patch),
  getThumbQuality: () => ipcRenderer.invoke('settings:thumbQuality:get'),
  saveThumbQuality: (quality) => ipcRenderer.invoke('settings:thumbQuality:save', quality),
  thumbCacheStats: () => ipcRenderer.invoke('thumbs:cacheStats'),
  clearThumbCache: (target) => ipcRenderer.invoke('thumbs:cacheClear', target),
  getThumbCacheLimit: () => ipcRenderer.invoke('settings:thumbCacheLimit:get'),
  saveThumbCacheLimit: (mb) => ipcRenderer.invoke('settings:thumbCacheLimit:save', mb),
  llmStatus: () => ipcRenderer.invoke('llm:status'),
  llmSaveConfig: (patch) => ipcRenderer.invoke('llm:config:save', patch),
  llmSaveKey: (key) => ipcRenderer.invoke('llm:key:save', key),
  llmClearKey: () => ipcRenderer.invoke('llm:key:clear'),
  llmTest: () => ipcRenderer.invoke('llm:test'),
  llmRun: (capabilityId, input) => ipcRenderer.invoke('llm:run', capabilityId, input),
  llmScore: (itemIds) => ipcRenderer.invoke('llm:quality', itemIds),
  startDrag: (itemId: number) => ipcRenderer.send('shell:startDrag', itemId),
  confirm: (message: string, detail?: string) => ipcRenderer.invoke('ui:confirm', message, detail),
  replyDialog: (id, result) => ipcRenderer.send('ui:dialog-reply', id, result),
  onDialogRequest: (cb) => {
    const handler = (_e: unknown, request: AppDialogRequest): void => cb(request)
    ipcRenderer.on('ui:dialog-request', handler)
    return () => ipcRenderer.removeListener('ui:dialog-request', handler)
  },

  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  onImportProgress: (cb: (p: ImportProgress) => void) => {
    const handler = (_e: unknown, payload: ImportProgress): void => cb(payload)
    ipcRenderer.on('import:progress', handler)
    return () => ipcRenderer.removeListener('import:progress', handler)
  },
  onLibraryChanged: (cb: (info: LibraryChange) => void) => {
    const handler = (_e: unknown, payload: LibraryChange): void => cb(payload)
    ipcRenderer.on('library:changed', handler)
    return () => ipcRenderer.removeListener('library:changed', handler)
  },
  onAutoBackup: (cb: (result: AutoBackupResult) => void) => {
    const handler = (_e: unknown, payload: AutoBackupResult): void => cb(payload)
    ipcRenderer.on('backup:auto', handler)
    return () => ipcRenderer.removeListener('backup:auto', handler)
  },
  onClipIndex: (cb: (progress: ClipProgress) => void) => {
    const handler = (_e: unknown, payload: ClipProgress): void => cb(payload)
    ipcRenderer.on('clip:index-progress', handler)
    return () => ipcRenderer.removeListener('clip:index-progress', handler)
  },
  onClipIndexEnd: (cb: () => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('clip:index-end', handler)
    return () => ipcRenderer.removeListener('clip:index-end', handler)
  },
  onClipAutoStatus: (cb: (status: ClipStatus) => void) => {
    const handler = (_e: unknown, payload: ClipStatus): void => cb(payload)
    ipcRenderer.on('clip:auto-status', handler)
    return () => ipcRenderer.removeListener('clip:auto-status', handler)
  },
  onClipDownload: (cb: (progress: ClipDownloadProgress) => void) => {
    const handler = (_e: unknown, payload: ClipDownloadProgress): void => cb(payload)
    ipcRenderer.on('clip:download-progress', handler)
    return () => ipcRenderer.removeListener('clip:download-progress', handler)
  },
  onAutoTagProgress: (cb: (progress: AutoTagProgress) => void) => {
    const handler = (_e: unknown, payload: AutoTagProgress): void => cb(payload)
    ipcRenderer.on('clip:autotag-progress', handler)
    return () => ipcRenderer.removeListener('clip:autotag-progress', handler)
  }
}

contextBridge.exposeInMainWorld('api', api)
