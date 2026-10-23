import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  Api,
  AutoBackupResult,
  AutoTagProgress,
  ClipDownloadProgress,
  ClipProgress,
  FilterState,
  ImportProgress,
  LibraryChange
} from '../shared/types'

const api: Api = {
  pickLibraryDir: () => ipcRenderer.invoke('library:pick'),
  createLibrary: (dir: string) => ipcRenderer.invoke('library:create', dir),
  openLibrary: (dir: string) => ipcRenderer.invoke('library:open', dir),
  lastLibrary: () => ipcRenderer.invoke('library:last'),

  listItems: (filter: FilterState, offset?: number, limit?: number) =>
    ipcRenderer.invoke('items:list', filter, offset, limit),
  getItem: (id: number) => ipcRenderer.invoke('items:get', id),
  filteredIds: (filter: FilterState) => ipcRenderer.invoke('items:filteredIds', filter),
  updateItem: (id: number, patch) => ipcRenderer.invoke('items:update', id, patch),
  deleteItems: (ids: number[]) => ipcRenderer.invoke('items:delete', ids),
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
  importPaths: (paths: string[]) => ipcRenderer.invoke('import:paths', paths),

  findDuplicates: () => ipcRenderer.invoke('duplicates:find'),
  backupLibrary: () => ipcRenderer.invoke('library:backup'),
  restoreLibrary: () => ipcRenderer.invoke('library:restore'),
  exportCsv: () => ipcRenderer.invoke('library:exportCsv'),
  getAutoBackup: () => ipcRenderer.invoke('settings:autoBackup:get'),
  saveAutoBackup: (patch) => ipcRenderer.invoke('settings:autoBackup:save', patch),
  pickAutoBackupDir: () => ipcRenderer.invoke('settings:autoBackup:pickDir'),
  clipStatus: () => ipcRenderer.invoke('clip:status'),
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
  gearScenarios: () => ipcRenderer.invoke('gear:scenarios'),
  recommendGear: (scenario) => ipcRenderer.invoke('gear:recommend', scenario),
  gearUsage: () => ipcRenderer.invoke('gear:usage'),
  listKits: () => ipcRenderer.invoke('gear:kits'),
  saveKit: (kit) => ipcRenderer.invoke('gear:kitSave', kit),
  deleteKit: (id: string) => ipcRenderer.invoke('gear:kitDelete', id),
  getTheme: () => ipcRenderer.invoke('settings:theme:get'),
  saveTheme: (mode) => ipcRenderer.invoke('settings:theme:save', mode),
  startDrag: (itemId: number) => ipcRenderer.send('shell:startDrag', itemId),
  confirm: (message: string, detail?: string) => ipcRenderer.invoke('ui:confirm', message, detail),

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
