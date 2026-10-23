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

export interface FilterState {
  query?: string
  tagIds?: number[]
  folderId?: number | null
  minRating?: number
  colorFamily?: ColorFamily | null
  orientation?: Orientation | null
  flag?: number
  expandBursts?: boolean
  expandedGroups?: string[]
  missing?: boolean
  sort?: 'added' | 'name' | 'mtime' | 'rating' | 'size'
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

export interface ScenarioOption {
  id: ScenarioId
  name: string
  hint: string
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
  tags: Tag[]
  folderIds: number[]
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
}

export interface ImportProgress {
  total: number
  done: number
  current: string
}

export interface ImportResult {
  added: number
  skipped: number
  failed: number
  relinked: number
}

export interface DuplicateGroup {
  hash: string
  items: Item[]
}

export interface Api {
  pickLibraryDir: () => Promise<string | null>
  createLibrary: (dir: string) => Promise<string>
  openLibrary: (dir: string) => Promise<string>
  lastLibrary: () => Promise<string | null>
  listItems: (
    filter: FilterState,
    offset?: number,
    limit?: number
  ) => Promise<{ items: Item[]; total: number }>
  getItem: (id: number) => Promise<Item | null>
  filteredIds: (filter: FilterState) => Promise<number[]>
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
  importPaths: (paths: string[]) => Promise<ImportResult>
  findDuplicates: () => Promise<DuplicateGroup[]>
  backupLibrary: () => Promise<{ path: string; size: number } | null>
  restoreLibrary: () => Promise<string | null>
  exportCsv: () => Promise<{ path: string; count: number } | null>
  getAutoBackup: () => Promise<AutoBackupSettings>
  saveAutoBackup: (patch: Partial<AutoBackupSettings>) => Promise<AutoBackupSettings>
  pickAutoBackupDir: () => Promise<string | null>
  onAutoBackup: (cb: (result: AutoBackupResult) => void) => () => void
  clipStatus: () => Promise<ClipStatus>
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
  startDrag: (itemId: number) => void
  confirm: (message: string, detail?: string) => Promise<boolean>
  getPathForFile: (file: File) => string
  onImportProgress: (cb: (p: ImportProgress) => void) => () => void
  onLibraryChanged: (cb: (info: LibraryChange) => void) => () => void
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
