import type { SkinId } from './skins'
import type { LayoutSizes } from './layout'
import type {
  ThumbCacheClearResult,
  ThumbCacheLimitResult,
  ThumbCacheStats,
  ThumbCacheTarget,
  ThumbQualityPref
} from './thumbs'
import type { LlmConfig, LlmRunOutcome, LlmStatus, LlmTestResult, PhotoQualitySaved } from './llm'

export interface ExifData {
  camera?: string
  lens?: string
  iso?: number
  aperture?: string
  shutter?: string
  focal?: string
  takenAt?: string
}

export interface Tag {
  id: number
  name: string
  color: string
  count: number
}

export interface Folder {
  id: number
  name: string
  count: number
}

export type ColorFamily =
  | 'black'
  | 'gray'
  | 'white'
  | 'red'
  | 'orange'
  | 'yellow'
  | 'green'
  | 'cyan'
  | 'blue'
  | 'purple'
  | 'pink'

export type Orientation = 'landscape' | 'portrait' | 'square'

/**
 * 旗标筛选取值：0 = 不限，>0 = 留用，<0 = 淘汰。
 * 下面两个是负向筛选，用不会和旗标值冲突的正数表示：
 * - FLAG_FILTER_NOT_REJECTED：非淘汰（留用 + 未标记）
 * - FLAG_FILTER_NOT_PICKED：非留用（只含未标记，明确排除淘汰）
 */
export const FLAG_FILTER_NOT_REJECTED = 2
export const FLAG_FILTER_NOT_PICKED = 3

export interface FilterState {
  query?: string
  tagIds?: number[]
  folderId?: number | null
  /** 按源目录筛选（含子目录） */
  dir?: string | null
  minRating?: number
  colorFamily?: ColorFamily | null
  orientation?: Orientation | null
  flag?: number
  expandBursts?: boolean
  expandedGroups?: string[]
  missing?: boolean
  /** 只看导入失败的异常文件 */
  errors?: boolean
  /** 大模型评分下限（0-100），0 或不填表示不限 */
  minAiScore?: number
  /** 只看还没被大模型评过分的 */
  unscored?: boolean
  /** 只保留这些 id（AI 智能筛选的结果），空数组等于不限制 */
  onlyIds?: number[]
  sort?: 'added' | 'name' | 'mtime' | 'rating' | 'size' | 'ai'
}

export interface RelocatePair {
  id: number
  name: string
  oldPath: string
  newPath: string
}

export interface RelocatePending extends RelocatePair {
  reason: string
  score: number
}

export interface RelocatePlan {
  matched: RelocatePair[]
  pending: RelocatePending[]
  mapped: number
  unmatched: number
  conflicts: number
  scanned: number
}

export interface RelocateResult {
  relinked: number
  failed: number
}

export type GearCategory = 'body' | 'lens' | 'tripod' | 'flash' | 'light' | 'gimbal' | 'other'
export type SensorSize = 'ff' | 'apsc' | 'm43' | 'compact'
export type ScenarioId =
  | 'portrait'
  | 'landscape'
  | 'street'
  | 'event'
  | 'astro'
  | 'macro'
  | 'video'
  | 'travel'
  | 'product'
  | 'sports'
  | 'indoor'
  | 'lowlight'
  | 'timelapse'

export interface GearSpec {
  category: GearCategory
  brand: string
  model: string
  note?: string
  mount?: string
  sensor?: SensorSize
  megapixels?: number
  ibis?: boolean
  burst?: number
  video4k?: boolean
  weight?: number
  focalMin?: number
  focalMax?: number
  aperture?: number
  macro?: boolean
  stabilized?: boolean
  payload?: number
  power?: number
}

export interface GearItem extends GearSpec {
  id: string
  createdAt: number
}

export interface GearPlan {
  scenario: ScenarioId
  body: GearItem | null
  lens: GearItem | null
  accessories: GearItem[]
  extras: GearItem[]
  score: number
  reasons: string[]
  warnings: string[]
  missing: string[]
}

export interface GearKit {
  id: string
  name: string
  scenario: ScenarioId
  bodyId: string | null
  lensId: string | null
  accessoryIds: string[]
  createdAt: number
}

export interface GearUsage {
  total: number
  matched: number
  byGear: Record<string, number>
}

export interface GearRecommendation {
  scenario: ScenarioId
  plans: GearPlan[]
  missing: string[]
}

/** 从照片 EXIF 里发现的器材，可直接一键加入装备 */
export interface GearSuggestion extends GearSpec {
  /** 库中有多少张照片用到这件器材 */
  count: number
  /** 是否来自内置目录（false 表示仅从 EXIF 推断，参数可能不全） */
  catalogued: boolean
}

export interface ScenarioOption {
  id: ScenarioId
  name: string
  hint: string
}

/** 大模型质量评分（已落库的那份） */
export interface ItemQuality {
  composition: number
  exposure: number
  color: number
  sharpness: number
  overall: number
  comment: string
  /** 产生这份评分的模型名，便于换模型后判断结果是否过时 */
  model: string
  updatedAt: number
}

export interface Item {
  id: number
  path: string
  name: string
  ext: string
  size: number
  width: number
  height: number
  mtime: number
  addedAt: number
  rating: number
  note: string
  url: string | null
  flag: number
  pairCount: number
  burstCount: number
  stackId: number | null
  stackCount: number
  groupKey: string | null
  groupCount: number
  dominant: string | null
  palette: string[]
  exif: ExifData | null
  missing: number
  /** 导入失败的原因，null 表示正常 */
  error: string | null
  tags: Tag[]
  folderIds: number[]
  /** 大模型评分，没评过为 null */
  quality: ItemQuality | null
}

/** 索引（library.db / 缩略图 / 预览）当前存放位置 */
export interface LibraryStorage {
  library: string
  indexDir: string
}

/** 移动索引位置的结果（失败不抛异常，走 message） */
export interface IndexMoveResult {
  ok: boolean
  indexDir?: string
  /** 复制过去的文件数 */
  files?: number
  /** 旧位置是否清理干净 */
  cleaned?: boolean
  message?: string
  cancelled?: boolean
}

export interface SmartFolder {
  id: number
  name: string
  filter: FilterState
}

export interface Stats {
  total: number
  missing: number
  tags: number
  folders: number
  bytes: number
  /** 导入失败、等待处理的文件数 */
  errors: number
}

/** 导入配置，会记住上次的选择 */
export interface ImportOptions {
  /** 递归扫描子目录 */
  recursive: boolean
  /** 跳过内容重复的照片 */
  skipDuplicates: boolean
}

export interface ImportProgress {
  phase: 'scanning' | 'importing' | 'paused'
  total: number
  done: number
  remaining: number
  added: number
  skipped: number
  failed: number
  current: string
  paused: boolean
}

export interface ImportErrorInfo {
  path: string
  name: string
  message: string
}

export interface ImportResult {
  added: number
  skipped: number
  failed: number
  relinked: number
  scanned: number
  cancelled: boolean
  errors: ImportErrorInfo[]
  /** 本次导入涉及的根目录，用于导入后按原文件夹展示 */
  roots: string[]
}

/** 媒体库里的源目录树节点 */
export interface ImportDirNode {
  path: string
  name: string
  /** 本目录直接包含的图片数 */
  count: number
  /** 含子目录的图片总数 */
  total: number
  children: ImportDirNode[]
}

/** 手动「刷新图库」的结果 */
export interface SyncResult {
  /** 扫描到的图片文件数 */
  scanned: number
  added: number
  missing: number
  restored: number
  refreshed: number
  failed: number
  /** 已经不存在的源目录（需要重新定位或重新导入） */
  missingRoots: string[]
}

/** 上次被中断（关软件/崩溃）的导入任务，用于下次启动时继续 */
export interface PendingImport {
  paths: string[]
  options: ImportOptions
  startedAt: number
  total: number
  done: number
}

export interface DuplicateGroup {
  hash: string
  items: Item[]
}

/** 启动时恢复上次图库的结果 */
export interface LastLibraryResult {
  dir: string | null
  /** 上次把索引放在别处，但那个目录里已经没有 library.db 了 */
  indexMissing?: string
}

export interface Api {
  pickLibraryDir: () => Promise<string | null>
  createLibrary: (dir: string) => Promise<string>
  openLibrary: (dir: string) => Promise<string>
  lastLibrary: () => Promise<LastLibraryResult>
  /** 索引（library.db / 缩略图 / 预览）当前放在哪 */
  getLibraryStorage: () => Promise<LibraryStorage | null>
  /** 左栏 / 右栏宽度（记住用户拖过的值） */
  getLayout: () => Promise<LayoutSizes>
  saveLayout: (patch: Partial<LayoutSizes>) => Promise<LayoutSizes>
  /** 瀑布流缩略图清晰度 */
  getThumbQuality: () => Promise<ThumbQualityPref>
  saveThumbQuality: (pref: ThumbQualityPref) => Promise<ThumbQualityPref>
  /** 三档缩略图各占多少磁盘 */
  thumbCacheStats: () => Promise<ThumbCacheStats>
  /** 清理缩略图缓存（high = 只删高清档） */
  clearThumbCache: (target?: ThumbCacheTarget) => Promise<ThumbCacheClearResult>
  /** 高清缓存上限（MB），0 = 不限 */
  getThumbCacheLimit: () => Promise<number>
  saveThumbCacheLimit: (mb: number) => Promise<ThumbCacheLimitResult>
  /** 选一个文件夹并把索引搬过去 */
  pickIndexDir: () => Promise<IndexMoveResult>
  /** target 为 null 表示搬回图库目录 */
  moveIndexDir: (target: string | null) => Promise<IndexMoveResult>
  listItems: (
    filter: FilterState,
    offset?: number,
    limit?: number
  ) => Promise<{ items: Item[]; total: number }>
  getItem: (id: number) => Promise<Item | null>
  updateItem: (
    id: number,
    patch: { rating?: number; note?: string; url?: string; flag?: number }
  ) => Promise<void>
  deleteItems: (ids: number[]) => Promise<void>
  restoreItems: (ids: number[]) => Promise<void>
  copyImage: (id: number) => Promise<boolean>
  stackItems: (ids: number[]) => Promise<number>
  unstack: (stackId: number) => Promise<void>
  rescan: () => Promise<{ missing: number; restored: number }>
  stats: () => Promise<Stats>
  listTags: () => Promise<Tag[]>
  createTag: (name: string, color?: string) => Promise<Tag>
  deleteTag: (id: number) => Promise<void>
  setTag: (itemIds: number[], tagId: number, add: boolean) => Promise<void>
  listFolders: () => Promise<Folder[]>
  createFolder: (name: string) => Promise<Folder>
  deleteFolder: (id: number) => Promise<void>
  addToFolder: (itemIds: number[], folderId: number) => Promise<void>
  removeFromFolder: (itemIds: number[], folderId: number) => Promise<void>
  listSmart: () => Promise<SmartFolder[]>
  saveSmart: (name: string, filter: FilterState) => Promise<SmartFolder>
  deleteSmart: (id: number) => Promise<void>
  pickImages: () => Promise<string[]>
  pickFolder: () => Promise<string | null>
  importPaths: (paths: string[], options?: Partial<ImportOptions>) => Promise<ImportResult>
  pauseImport: () => Promise<void>
  resumeImport: () => Promise<void>
  cancelImport: () => Promise<void>
  importStatus: () => Promise<ImportProgress | null>
  getImportOptions: () => Promise<ImportOptions>
  saveImportOptions: (options: Partial<ImportOptions>) => Promise<ImportOptions>
  listDirTree: () => Promise<ImportDirNode[]>
  syncLibrary: () => Promise<SyncResult>
  pendingImport: () => Promise<PendingImport | null>
  discardPendingImport: () => Promise<void>
  findDuplicates: () => Promise<DuplicateGroup[]>
  backupLibrary: () => Promise<{ path: string; size: number } | null>
  restoreLibrary: () => Promise<string | null>
  exportCsv: () => Promise<{ path: string; count: number } | null>
  getAutoBackup: () => Promise<AutoBackupSettings>
  saveAutoBackup: (patch: Partial<AutoBackupSettings>) => Promise<AutoBackupSettings>
  pickAutoBackupDir: () => Promise<string | null>
  onAutoBackup: (cb: (result: AutoBackupResult) => void) => () => void
  clipStatus: () => Promise<ClipStatus>
  getClipAutoIndex: () => Promise<boolean>
  saveClipAutoIndex: (enabled: boolean) => Promise<boolean>
  onClipAutoStatus: (cb: (status: ClipStatus) => void) => () => void
  clipIndex: () => Promise<{ indexed: number; failed: number; cancelled: boolean }>
  clipCancel: () => Promise<void>
  clipSearchText: (
    query: string,
    filter: FilterState,
    limit?: number
  ) => Promise<{ items: Item[]; scores: number[] }>
  clipSimilar: (itemId: number, limit?: number) => Promise<{ items: Item[]; scores: number[] }>
  clipDownloadModel: () => Promise<string>
  onClipIndex: (cb: (progress: ClipProgress) => void) => () => void
  /** 语义索引结束（完成 / 取消 / 出错都会发），用来收起进度卡片 */
  onClipIndexEnd: (cb: () => void) => () => void
  onClipDownload: (cb: (progress: ClipDownloadProgress) => void) => () => void
  autoTagCategories: () => Promise<AutoTagCategory[]>
  getAutoTagSettings: () => Promise<AutoTagSettings>
  saveAutoTagSettings: (patch: Partial<AutoTagSettings>) => Promise<AutoTagSettings>
  autoTagStatus: () => Promise<AutoTagStatus>
  autoTag: () => Promise<AutoTagResult>
  clearAutoTags: () => Promise<{ removed: number }>
  onAutoTagProgress: (cb: (progress: AutoTagProgress) => void) => () => void
  showInFolder: (path: string) => Promise<void>
  pickRelocateDir: () => Promise<RelocatePlan | null>
  planRelocate: (dir: string) => Promise<RelocatePlan>
  lastRelocateDir: () => Promise<string | null>
  applyRelocate: (pairs: RelocatePair[]) => Promise<RelocateResult>
  listGear: () => Promise<GearItem[]>
  saveGear: (item: GearSpec & { id?: string }) => Promise<GearItem>
  deleteGear: (id: string) => Promise<void>
  gearCatalog: () => Promise<GearSpec[]>
  gearSuggestions: () => Promise<GearSuggestion[]>
  gearScenarios: () => Promise<ScenarioOption[]>
  recommendGear: (scenario: ScenarioId) => Promise<GearRecommendation>
  gearUsage: () => Promise<GearUsage>
  listKits: () => Promise<GearKit[]>
  saveKit: (kit: {
    name: string
    scenario: ScenarioId
    bodyId?: string
    lensId?: string
    accessoryIds?: string[]
  }) => Promise<GearKit>
  deleteKit: (id: string) => Promise<void>
  getTheme: () => Promise<ThemeMode>
  saveTheme: (mode: ThemeMode) => Promise<ThemeMode>
  getSkin: () => Promise<SkinId>
  saveSkin: (id: SkinId) => Promise<SkinId>
  llmStatus: () => Promise<LlmStatus>
  llmSaveConfig: (patch: Partial<LlmConfig>) => Promise<LlmStatus>
  llmSaveKey: (key: string) => Promise<LlmStatus>
  llmClearKey: () => Promise<LlmStatus>
  llmTest: () => Promise<LlmTestResult>
  llmRun: (capabilityId: string, input: unknown) => Promise<LlmRunOutcome>
  /** 评分并落库，返回每张的分数与实际写入条数 */
  llmScore: (itemIds: number[]) => Promise<LlmRunOutcome<PhotoQualitySaved>>
  startDrag: (itemId: number) => void
  confirm: (message: string, detail?: string) => Promise<boolean>
  replyDialog: (id: number, result: AppDialogResult) => void
  getPathForFile: (file: File) => string
  onImportProgress: (cb: (p: ImportProgress) => void) => () => void
  onLibraryChanged: (cb: (info: LibraryChange) => void) => () => void
  onDialogRequest: (cb: (request: AppDialogRequest) => void) => () => void
}

/** 主进程要弹的确认框参数，界面用应用内弹窗渲染 */
export interface AppDialogOptions {
  kind?: 'question' | 'warning' | 'error' | 'info'
  title: string
  detail?: string
  confirmText?: string
  cancelText?: string
  /** 危险操作（删除、覆盖）把确认按钮标红 */
  danger?: boolean
  /** 只给一个确认按钮，没有取消 */
  onlyConfirm?: boolean
  checkboxLabel?: string
  checkboxChecked?: boolean
}

export interface AppDialogRequest extends AppDialogOptions {
  id: number
}

export interface AppDialogResult {
  confirmed: boolean
  checked: boolean
}

export interface LibraryChange {
  added: number
  missing: number
}

export type ThemeMode = 'system' | 'dark' | 'light'

export interface AutoBackupSettings {
  enabled: boolean
  intervalDays: number
  keep: number
  directory: string | null
  lastRunAt: number
}

export interface AutoBackupResult {
  ok: boolean
  path?: string
  size?: number
  error?: string
}

export interface ClipStatus {
  modelReady: boolean
  indexed: number
  total: number
  running: boolean
  dim: number
}

export interface ClipProgress {
  done: number
  total: number
  current: string
}

export interface ClipDownloadProgress {
  received: number
  total: number
  file: string
}

export interface AutoTagCategory {
  name: string
  color: string
}

export interface AutoTagSettings {
  threshold: number
  categories: string[]
}

export interface AutoTagProgress {
  phase: 'prepare' | 'scan'
  done: number
  total: number
  current: string
}

export interface AutoTagResult {
  total: number
  assigned: number
  counts: Record<string, number>
}

export interface AutoTagStatus {
  tagged: number
  indexed: number
  total: number
}
