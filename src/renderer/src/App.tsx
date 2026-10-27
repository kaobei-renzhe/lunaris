import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import type {
  ClipDownloadProgress,
  ClipProgress,
  ClipStatus,
  FilterState,
  Folder,
  ImportDirNode,
  ImportOptions,
  ImportProgress,
  ImportResult,
  Item,
  PendingImport,
  SmartFolder,
  Stats,
  Tag
} from '@shared/types'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Gallery from './components/Gallery'
import DetailPanel from './components/DetailPanel'
import ResizeHandle from './components/ResizeHandle'
import Lightbox from './components/Lightbox'
import { findRenderedNeighbor, type Direction } from './lib/spatialNav'
import DuplicatesDialog from './components/DuplicatesDialog'
import AutoBackupDialog from './components/AutoBackupDialog'
import AutoTagDialog from './components/AutoTagDialog'
import RelocateDialog from './components/RelocateDialog'
import EquipmentDialog from './components/EquipmentDialog'
import SettingsDialog, { type SettingsTab } from './components/SettingsDialog'
import AdviceDialog from './components/AdviceDialog'
import SmartFilterDialog from './components/SmartFilterDialog'
import ImportDialog from './components/ImportDialog'
import ImportStatusCard from './components/ImportStatusCard'
import ResumeImportCard from './components/ResumeImportCard'
import Welcome from './components/Welcome'
import { formatBytes, folderName } from './lib/format'
import { useLayoutSizes } from './hooks/useLayoutSizes'
import { useAppearance } from './hooks/useAppearance'
import { useLightbox } from './hooks/useLightbox'

const EMPTY_STATS: Stats = { total: 0, missing: 0, tags: 0, folders: 0, bytes: 0, errors: 0 }
const PAGE = 200

interface Toast {
  text: string
  undo?: boolean
}

export default function App() {
  const [library, setLibrary] = useState<string | null>(null)
  /** 从图库切到欢迎页时记住原图库，方便一键返回 */
  const [switchingFrom, setSwitchingFrom] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<Tag[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [smarts, setSmarts] = useState<SmartFolder[]>([])
  const [dirTree, setDirTree] = useState<ImportDirNode[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [filter, setFilter] = useState<FilterState>({ sort: 'added' })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [thumbSize, setThumbSize] = useState(230)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importRunning, setImportRunning] = useState(false)
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    recursive: true,
    skipDuplicates: true
  })
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [autoBackupOpen, setAutoBackupOpen] = useState(false)
  const [autoTagOpen, setAutoTagOpen] = useState(false)
  const [relocateOpen, setRelocateOpen] = useState(false)
  const [equipmentOpen, setEquipmentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('appearance')
  /** 上次的索引目录里没有 library.db：在欢迎页上说清楚，别让用户以为图库没了 */
  const [indexMissing, setIndexMissing] = useState<string | null>(null)
  const [adviceOpen, setAdviceOpen] = useState(false)
  const [aiScoring, setAiScoring] = useState(false)
  /** 大模型是否可用：关掉开关或没存 Key 时，相册里的 AI 入口只引导去设置，不发请求 */
  const [aiReady, setAiReady] = useState(false)
  /** 每个能力自己的开关，关掉后对应入口直接隐藏 */
  const [aiCaps, setAiCaps] = useState<Record<string, boolean>>({})
  const [smartFilterOpen, setSmartFilterOpen] = useState(false)
  /** AI 筛选用的规则文案，仅用于工具栏 chip 展示；筛选条件本身在 filter.onlyIds 里 */
  const [aiRule, setAiRule] = useState<string | null>(null)
  const [lastRelocateDir, setLastRelocateDir] = useState<string | null>(null)
  const [semanticMode, setSemanticMode] = useState(false)
  const [clipStatus, setClipStatus] = useState<ClipStatus | null>(null)
  const [clipProgress, setClipProgress] = useState<ClipProgress | null>(null)
  const [clipCardMinimized, setClipCardMinimized] = useState(false)
  const [clipDownload, setClipDownload] = useState<ClipDownloadProgress | null>(null)
  const [similar, setSimilar] = useState<{ id: number; name: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const [expandedGroups, setExpandedGroups] = useState<string[]>([])
  const [tick, setTick] = useState(0)
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const itemsRef = useRef<Item[]>([])
  const totalRef = useRef(0)
  const filterRef = useRef(filter)
  const loadingMoreRef = useRef(false)
  const undoRef = useRef<Array<{ label: string; run: () => Promise<void> }>>([])
  const aiScoringRef = useRef(false)
  const shellRef = useRef<HTMLDivElement>(null)

  filterRef.current = { ...filter, expandedGroups }
  totalRef.current = total

  const bump = useCallback(() => setTick((v) => v + 1), [])

  /** 打开设置；从 AI 弹窗点「去设置」时直接落到「大模型」分类 */
  const openSettings = useCallback((tab: SettingsTab = 'appearance') => {
    setSettingsTab(tab)
    setSettingsOpen(true)
  }, [])

  const { layoutRef, resizeRef, resizeLayout, commitResize, resetLayout } = useLayoutSizes(shellRef, library)

  const applyItems = useCallback((list: Item[]) => {
    itemsRef.current = list
    setItems(list)
  }, [])

  const notify = useCallback((text: string) => setToast({ text }), [])

  const pushUndo = useCallback(
    (label: string, run: () => Promise<void>, showToast = true) => {
      undoRef.current.push({ label, run })
      if (undoRef.current.length > 20) undoRef.current.shift()
      if (showToast) setToast({ text: label, undo: true })
    },
    []
  )

  const undoLast = useCallback(async () => {
    const entry = undoRef.current.pop()
    if (!entry) {
      notify('没有可撤销的操作')
      return
    }
    try {
      await entry.run()
      setTick((v) => v + 1)
      notify(`已撤销：${entry.label}`)
    } catch (error) {
      notify(`撤销失败：${(error as Error).message}`)
    }
  }, [notify])

  /** 退出大图后把焦点交回图库：选中这一张，并让瀑布流滚回它 */
  const restoreSelection = useCallback((id: number) => {
    setActiveId(id)
    setSelectedIds([id])
  }, [])

  const { lightboxId, revealTick, openLightbox, closeLightbox } = useLightbox(restoreSelection)

  const refreshMeta = useCallback(async () => {
    const [nextTags, nextFolders, nextSmarts, nextStats, nextDirs] = await Promise.all([
      window.api.listTags(),
      window.api.listFolders(),
      window.api.listSmart(),
      window.api.stats(),
      window.api.listDirTree()
    ])
    setTags(nextTags)
    setFolders(nextFolders)
    setSmarts(nextSmarts)
    setStats(nextStats)
    setDirTree(nextDirs)
  }, [])

  useEffect(() => {
    void window.api.getImportOptions().then(setImportOptions)
  }, [])

  // 打开图库时看看上次有没有被中断的导入任务
  useEffect(() => {
    if (!library) {
      setPendingImport(null)
      return
    }
    let cancelled = false
    void window.api
      .pendingImport()
      .then((task) => {
        if (!cancelled) setPendingImport(task)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [library])

  useEffect(() => {
    window.api
      .lastLibrary()
      .then((result) => {
        if (result?.dir) setLibrary(result.dir)
        else if (result?.indexMissing) setIndexMissing(result.indexMissing)
      })
      .catch(() => undefined)
      .finally(() => setBooting(false))
  }, [])

  const { theme, changeTheme, skin, changeSkin, thumbQuality, changeThumbQuality } = useAppearance()

  useEffect(() => {
    if (!library) return
    // 找相似模式下列表由该操作接管
    if (similar) return
    let cancelled = false
    setLoading(true)
    const keep = Math.max(PAGE, itemsRef.current.length)
    const timer = setTimeout(async () => {
      try {
        const query = (filter.query ?? '').trim()
        if (semanticMode && query) {
          const result = await window.api.clipSearchText(query, { ...filter, query: '' }, 200)
          if (cancelled) return
          applyItems(result.items)
          setTotal(result.items.length)
          return
        }
        const result = await window.api.listItems({ ...filter, expandedGroups }, 0, keep)
        if (cancelled) return
        applyItems(result.items)
        setTotal(result.total)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }, semanticMode ? 320 : 120)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [library, filter, expandedGroups, tick, applyItems, semanticMode, similar])

  useEffect(() => {
    if (!library) return
    void refreshMeta()
  }, [library, tick, refreshMeta])

  useEffect(() => {
    if (!library) return
    void window.api.clipStatus().then(setClipStatus)
  }, [library, tick])

  useEffect(() => {
    if (!library) return
    void window.api.lastRelocateDir().then(setLastRelocateDir)
  }, [library, tick])

  useEffect(() => window.api.onClipIndex(setClipProgress), [])
  // 索引结束（完成 / 取消 / 出错）后收起进度卡片，并刷新侧栏的已索引数量
  useEffect(
    () =>
      window.api.onClipIndexEnd(() => {
        setClipProgress(null)
        void window.api.clipStatus().then(setClipStatus).catch(() => undefined)
      }),
    []
  )
  useEffect(() => window.api.onClipAutoStatus(setClipStatus), [])
  useEffect(() => window.api.onClipDownload(setClipDownload), [])

  useEffect(() => window.api.onImportProgress(setProgress), [])

  useEffect(
    () =>
      window.api.onLibraryChanged((info) => {
        setToast({ text: `检测到文件变化 · 新增 ${info.added} · 丢失 ${info.missing}` })
        setTick((v) => v + 1)
      }),
    []
  )

  useEffect(
    () =>
      window.api.onAutoBackup((result) => {
        setToast({
          text: result.ok
            ? `自动备份完成 · ${formatBytes(result.size ?? 0)}`
            : `自动备份失败：${result.error ?? '未知错误'}`
        })
      }),
    []
  )

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4200)
    return () => clearTimeout(timer)
  }, [toast])

  const startImport = useCallback(
    async (paths: string[], override?: ImportOptions) => {
      if (!paths.length) return
      const options = override ?? importOptions
      if (override) setImportOptions(override)
      setPendingImport(null)
      setImportOpen(false)
      setImportResult(null)
      setProgress(null)
      setImportRunning(true)
      try {
        const result = await window.api.importPaths(paths, options)
        setImportResult(result)
        // 只导入了一个文件夹时，视图直接切到它，按原目录结构展示
        if (result.roots.length === 1) {
          setFilter((prev) => ({ sort: prev.sort, dir: result.roots[0] }))
        }
        setTick((v) => v + 1)
      } catch (error) {
        const text = (error as Error).message
          .replace(/^Error invoking remote method '[^']+':\s*/, '')
          .replace(/^Error:\s*/, '')
        notify(`导入失败：${text}`)
      } finally {
        setImportRunning(false)
        setProgress(null)
      }
    },
    [importOptions, notify]
  )

  const importFiles = useCallback(async () => {
    const paths = await window.api.pickImages()
    await startImport(paths)
  }, [startImport])

  const importFolder = useCallback(async () => {
    const dir = await window.api.pickFolder()
    if (dir) await startImport([dir])
  }, [startImport])

  const openImportDialog = useCallback(() => setImportOpen(true), [])

  const resumePendingImport = useCallback(() => {
    if (!pendingImport) return
    // 继续时强制跳过已导入的照片，只处理剩下的
    void startImport(pendingImport.paths, { ...pendingImport.options, skipDuplicates: true })
  }, [pendingImport, startImport])

  const discardPendingImport = useCallback(() => {
    void window.api.discardPendingImport()
    setPendingImport(null)
    notify('已忽略上次未完成的导入')
  }, [notify])

  const syncLibrary = useCallback(async () => {
    if (importRunning) {
      notify('正在导入，等当前任务结束再刷新')
      return
    }
    setImportOpen(false)
    setImportResult(null)
    setProgress(null)
    setImportRunning(true)
    try {
      const result = await window.api.syncLibrary()
      const parts = [
        `扫描 ${result.scanned}`,
        `新增 ${result.added}`,
        `丢失 ${result.missing}`,
        `恢复 ${result.restored}`,
        `刷新 ${result.refreshed}`
      ]
      if (result.failed > 0) parts.push(`失败 ${result.failed}`)
      const roots =
        result.missingRoots.length > 0
          ? ` · ${result.missingRoots.length} 个源目录已不在原位，可用「重新定位」接回`
          : ''
      notify(`刷新完成 · ${parts.join(' · ')}${roots}`)
      setTick((value) => value + 1)
    } catch (error) {
      const text = (error as Error).message
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^Error:\s*/, '')
      notify(`刷新失败：${text}`)
    } finally {
      setImportRunning(false)
      setProgress(null)
    }
  }, [importRunning, notify])

  const loadMore = useCallback(async () => {
    if (semanticMode || similar) return
    if (loadingMoreRef.current) return
    const current = itemsRef.current
    if (current.length >= totalRef.current) return
    loadingMoreRef.current = true
    setLoadingMore(true)
    try {
      const result = await window.api.listItems(filterRef.current, current.length, PAGE)
      const seen = new Set(current.map((i) => i.id))
      const merged = [...current, ...result.items.filter((i) => !seen.has(i.id))]
      applyItems(merged)
      setTotal(result.total)
    } finally {
      loadingMoreRef.current = false
      setLoadingMore(false)
    }
  }, [applyItems])

  useEffect(() => {
    const onDragEnter = (e: DragEvent): void => {
      e.preventDefault()
      dragDepth.current += 1
      if (library) setDragging(true)
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDragLeave = (e: DragEvent): void => {
      e.preventDefault()
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      if (!library) return
      // 库内拖拽（整理到文件夹/标签）不当作导入
      if (e.dataTransfer?.types.includes('application/x-imagenest-items')) return
      const files = Array.from(e.dataTransfer?.files ?? [])
      const paths = files.map((f) => window.api.getPathForFile(f)).filter(Boolean)
      void startImport(paths)
    }
    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [library, startImport])

  const deleteSelected = useCallback(async () => {
    const ids = selectedIds.length ? [...selectedIds] : activeId ? [activeId] : []
    if (!ids.length) return
    await window.api.deleteItems(ids)
    setSelectedIds([])
    setActiveId(null)
    pushUndo(`已移除 ${ids.length} 张，按 Ctrl+Z 撤销`, async () => {
      await window.api.restoreItems(ids)
      setTick((v) => v + 1)
    })
    bump()
  }, [selectedIds, activeId, pushUndo, bump])

  /** 丢失视图里一次性清理所有丢失记录：只动索引，不动磁盘，可撤销 */
  const clearMissing = useCallback(async () => {
    const snapshot = await window.api.stats()
    if (!snapshot.missing) {
      notify('没有可清理的丢失记录')
      return
    }
    const ok = await window.api.confirm(
      '清理丢失记录',
      `将移除 ${snapshot.missing} 条文件已丢失的索引记录。磁盘上的原图不受影响，清理后可按 Ctrl+Z 撤销。`
    )
    if (!ok) return
    const ids = await window.api.trashMissing()
    if (!ids.length) return
    setSelectedIds([])
    setActiveId(null)
    pushUndo(`已清理 ${ids.length} 条丢失记录，按 Ctrl+Z 撤销`, async () => {
      await window.api.restoreItems(ids)
      setTick((v) => v + 1)
    })
    bump()
  }, [notify, pushUndo, bump])

  const rateSelected = useCallback(
    async (rating: number) => {
      const ids = selectedIds.length ? selectedIds : activeId ? [activeId] : []
      if (!ids.length) return
      const before = itemsRef.current
        .filter((i) => ids.includes(i.id))
        .map((i) => ({ id: i.id, rating: i.rating }))
      await Promise.all(ids.map((id) => window.api.updateItem(id, { rating })))
      pushUndo(
        `评分改为 ${rating} 星`,
        async () => {
          for (const prev of before) await window.api.updateItem(prev.id, { rating: prev.rating })
        },
        false
      )
      bump()
    },
    [selectedIds, activeId, pushUndo, bump]
  )

  const setFlagSelected = useCallback(
    async (flag: number) => {
      const ids = selectedIds.length ? selectedIds : activeId ? [activeId] : []
      if (!ids.length) return
      const before = itemsRef.current
        .filter((i) => ids.includes(i.id))
        .map((i) => ({ id: i.id, flag: i.flag }))
      await Promise.all(ids.map((id) => window.api.updateItem(id, { flag })))
      pushUndo(
        `旗标：${flag > 0 ? '留用' : flag < 0 ? '淘汰' : '清除'}`,
        async () => {
          for (const prev of before) await window.api.updateItem(prev.id, { flag: prev.flag })
        },
        false
      )
      bump()
    },
    [selectedIds, activeId, pushUndo, bump]
  )

  /**
   * 大模型评分：一次最多 12 张（能力侧也会拦），结果由主进程直接落库，
   * 这里只负责刷新列表，让卡片角标与详情面板立刻读到分数。
   */
  const scoreItems = useCallback(
    async (ids: number[]) => {
      if (!ids.length || aiScoringRef.current) return
      const picked = ids.slice(0, 12)
      aiScoringRef.current = true
      setAiScoring(true)
      try {
        const outcome = await window.api.llmScore(picked)
        if (!outcome.ok) {
          notify(outcome.message)
          return
        }
        const { results, failed, persisted } = outcome.data
        const average = results.length
          ? Math.round(results.reduce((sum, item) => sum + item.overall, 0) / results.length)
          : 0
        const extra = [
          failed.length ? `${failed.length} 张失败` : '',
          ids.length > picked.length ? `只评了前 ${picked.length} 张` : ''
        ]
          .filter(Boolean)
          .join('，')
        notify(`已评分 ${persisted} 张，平均 ${average} 分${extra ? `（${extra}）` : ''}`)
        bump()
      } catch (error) {
        // IPC 层本身出错（例如主进程没准备好）时也要给用户回执，不能静默失败
        notify(`评分失败：${(error as Error).message}`)
      } finally {
        aiScoringRef.current = false
        setAiScoring(false)
      }
    },
    [notify, bump]
  )

  const clearAiFilter = useCallback(() => {
    setAiRule(null)
    setFilter((prev) => ({ ...prev, onlyIds: undefined }))
  }, [])

  // 设置面板开关/换 Key 后回到主界面要立刻反映到 AI 入口的可用状态
  useEffect(() => {
    if (!library) return
    void window.api
      .llmStatus()
      .then((status) => {
        setAiReady(status.config.enabled && status.hasKey && Boolean(status.config.model.trim()))
        setAiCaps(
          Object.fromEntries(status.capabilities.map((capability) => [capability.id, capability.enabled]))
        )
      })
      .catch(() => {
        setAiReady(false)
        setAiCaps({})
      })
  }, [library, settingsOpen])

  // AI 评分入口被关掉（或总开关关闭）时，把隐藏起来的 AI 排序与筛选项一并复位，
  // 免得不显示却还在偷偷过滤结果
  const aiScoreAvailable = aiReady && aiCaps['photo.quality'] !== false
  useEffect(() => {
    if (aiScoreAvailable) return
    if ((filter.sort ?? 'added') !== 'ai' && !filter.minAiScore && !filter.unscored) return
    setFilter((prev) => ({
      ...prev,
      sort: prev.sort === 'ai' ? 'added' : prev.sort,
      minAiScore: 0,
      unscored: false
    }))
  }, [aiScoreAvailable, filter.sort, filter.minAiScore, filter.unscored])

  const applyAiFilter = useCallback(
    (rule: string, ids: number[]) => {
      setAiRule(rule)
      setFilter((prev) => ({ ...prev, onlyIds: ids }))
      setSmartFilterOpen(false)
      setSelectedIds([])
      setActiveId(null)
      notify(`AI 筛出 ${ids.length} 张：${rule}`)
    },
    [notify]
  )

  // 从侧栏或其它入口换掉整套筛选条件时，AI 规则文案也要跟着消失，避免 chip 与结果不一致
  useEffect(() => {
    if (aiRule && !filter.onlyIds?.length) setAiRule(null)
  }, [aiRule, filter.onlyIds])

  const stackSelected = useCallback(async () => {
    if (selectedIds.length < 2) return
    try {
      await window.api.stackItems(selectedIds)
      notify(`已堆叠 ${selectedIds.length} 张`)
      setSelectedIds([])
      bump()
    } catch (error) {
      notify(`堆叠失败：${(error as Error).message}`)
    }
  }, [selectedIds, notify, bump])

  const unstackItem = useCallback(
    async (stackId: number) => {
      await window.api.unstack(stackId)
      setExpandedGroups((prev) => prev.filter((key) => key !== `s${stackId}`))
      notify('已拆开堆叠')
      bump()
    },
    [notify, bump]
  )

  const toggleGroup = useCallback((key: string) => {
    setExpandedGroups((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    )
  }, [])

  const moveSelection = useCallback(
    (delta: number) => {
      const list = itemsRef.current
      if (!list.length) return
      const index = activeId ? list.findIndex((i) => i.id === activeId) : -1
      const next = list[Math.min(list.length - 1, Math.max(0, index + delta))] ?? list[0]
      setActiveId(next.id)
      setSelectedIds([next.id])
    },
    [activeId]
  )

  /** 方向键：按瀑布流卡片的真实位置走（↑↓ 同列、←→ 跨列），找不到邻居时退回顺序移动 */
  const moveSelectionBy = useCallback(
    (direction: Direction) => {
      const list = itemsRef.current
      const currentId = activeId ?? selectedIds[0]
      if (!list.length || !currentId) return
      const neighbor = findRenderedNeighbor(currentId, direction)
      const index = neighbor === null ? -1 : list.findIndex((item) => item.id === neighbor)
      if (index >= 0) {
        setActiveId(list[index].id)
        setSelectedIds([list[index].id])
        return
      }
      moveSelection(direction === 'up' || direction === 'left' ? -1 : 1)
    },
    [activeId, selectedIds, moveSelection]
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const el = document.activeElement as HTMLElement | null
      const typing =
        !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !typing) {
        e.preventDefault()
        void undoLast()
        return
      }

      if (e.key === 'Escape') {
        if (lightboxId) closeLightbox()
        else if (activeId) setActiveId(null)
        else setSelectedIds([])
        return
      }
      // 灯箱打开时，键盘交给灯箱自己，别把后面的列表也动了
      if (lightboxId) return
      if (typing) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        // 只全选"当前已加载"的图片：不去主进程拉全库 id，避免一次选中上万张后再逐条发 IPC
        e.preventDefault()
        const loaded = itemsRef.current
        if (loaded.length === 0) return
        setSelectedIds(loaded.map((item) => item.id))
        notify(`已选中当前加载的 ${loaded.length} 张`)
        return
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') {
        const id = selectedIds[0] ?? activeId
        if (!id) return
        e.preventDefault()
        void window.api.copyImage(id).then((ok) => {
          setToast({ text: ok ? '已复制图片到剪贴板' : '复制失败，试试其它图片' })
        })
        return
      }
      if (e.key === 'Delete' && (selectedIds.length || activeId)) {
        e.preventDefault()
        void deleteSelected()
        return
      }
      if (/^[0-5]$/.test(e.key) && (selectedIds.length || activeId)) {
        e.preventDefault()
        void rateSelected(Number(e.key))
        return
      }
      if ((e.key === 'p' || e.key === 'P') && (selectedIds.length || activeId)) {
        e.preventDefault()
        void setFlagSelected(1)
        return
      }
      if ((e.key === 'x' || e.key === 'X') && (selectedIds.length || activeId)) {
        e.preventDefault()
        void setFlagSelected(-1)
        return
      }
      if ((e.key === 'u' || e.key === 'U') && (selectedIds.length || activeId)) {
        e.preventDefault()
        void setFlagSelected(0)
        return
      }
      // 方向键按瀑布流实际位置走；j / k 仍保持顺序切换
      const arrow: Direction | null =
        e.key === 'ArrowLeft'
          ? 'left'
          : e.key === 'ArrowRight'
            ? 'right'
            : e.key === 'ArrowUp'
              ? 'up'
              : e.key === 'ArrowDown'
                ? 'down'
                : null
      if (arrow) {
        e.preventDefault()
        moveSelectionBy(arrow)
        return
      }
      if (e.key === 'j') {
        e.preventDefault()
        moveSelection(1)
        return
      }
      if (e.key === 'k') {
        e.preventDefault()
        moveSelection(-1)
        return
      }
      if (e.key === ' ' && activeId) {
        e.preventDefault()
        openLightbox(activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedIds,
    lightboxId,
    activeId,
    closeLightbox,
    openLightbox,
    deleteSelected,
    rateSelected,
    setFlagSelected,
    moveSelection,
    moveSelectionBy,
    undoLast,
    notify
  ])

  const handleSelect = (id: number, e: ReactMouseEvent): void => {
    const additive = e.ctrlKey || e.metaKey
    if (e.shiftKey && selectedIds.length > 0) {
      const from = items.findIndex((i) => i.id === selectedIds[selectedIds.length - 1])
      const to = items.findIndex((i) => i.id === id)
      if (from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from]
        setSelectedIds(items.slice(start, end + 1).map((i) => i.id))
        return
      }
    }
    if (additive) {
      setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    } else {
      setSelectedIds([id])
      setActiveId(id)
    }
  }

  const addSelectedToFolder = async (folderId: number): Promise<void> => {
    const ids = selectedIds.length ? selectedIds : activeId ? [activeId] : []
    if (!ids.length) return
    await window.api.addToFolder(ids, folderId)
    pushUndo(
      `已加入「${folders.find((f) => f.id === folderId)?.name ?? ''}」`,
      async () => {
        await window.api.removeFromFolder(ids, folderId)
      },
      false
    )
    notify(`已加入「${folders.find((f) => f.id === folderId)?.name ?? ''}」`)
    bump()
  }

  const handleDropItems = async (
    ids: number[],
    target: { folderId?: number; tagId?: number }
  ): Promise<void> => {
    if (!ids.length) return
    if (target.folderId) {
      await window.api.addToFolder(ids, target.folderId)
      pushUndo(`已加入「${folders.find((f) => f.id === target.folderId)?.name ?? ''}」`, async () => {
        await window.api.removeFromFolder(ids, target.folderId as number)
      })
    }
    if (target.tagId) {
      await window.api.setTag(ids, target.tagId, true)
      pushUndo(`已打上「${tags.find((t) => t.id === target.tagId)?.name ?? ''}」`, async () => {
        await window.api.setTag(ids, target.tagId as number, false)
      })
    }
    bump()
  }

  const saveSmart = async (name: string): Promise<void> => {
    if (!name.trim()) return
    await window.api.saveSmart(name.trim(), filter)
    notify(`已保存智能文件夹「${name.trim()}」`)
    bump()
  }

  const createFolder = async (name: string): Promise<void> => {
    if (!name.trim()) return
    try {
      await window.api.createFolder(name.trim())
      bump()
    } catch (error) {
      const text = (error as Error).message
        .replace(/^Error invoking remote method '[^']+':\s*/, '')
        .replace(/^Error:\s*/, '')
      notify(`新建文件夹失败：${text}`)
    }
  }

  const rescan = async (): Promise<void> => {
    const result = await window.api.rescan()
    notify(`扫描完成 · 丢失 ${result.missing} · 恢复 ${result.restored}`)
    bump()
  }

  const backupLibrary = async (): Promise<void> => {
    try {
      const result = await window.api.backupLibrary()
      if (result) notify(`备份完成 · ${formatBytes(result.size)}`)
    } catch (error) {
      notify(`备份失败：${(error as Error).message}`)
    }
  }

  const restoreLibrary = async (): Promise<void> => {
    try {
      const dir = await window.api.restoreLibrary()
      if (!dir) return
      setLibrary(dir)
      setFilter({ sort: 'added' })
      setSelectedIds([])
      setActiveId(null)
      setExpandedGroups([])
      setSemanticMode(false)
      setSimilar(null)
      notify('已从备份恢复')
      bump()
    } catch (error) {
      notify(`恢复失败：${(error as Error).message}`)
    } finally {
      // 恢复时补齐缩略图会走导入进度条，结束后要收起来
      setProgress(null)
    }
  }

  const exportCsv = async (): Promise<void> => {
    try {
      const result = await window.api.exportCsv()
      if (result) notify(`已导出 ${result.count} 条素材清单`)
    } catch (error) {
      notify(`导出失败：${(error as Error).message}`)
    }
  }

  const downloadClipModel = async (): Promise<boolean> => {
    try {
      setClipDownload({ received: 0, total: 0, file: '' })
      await window.api.clipDownloadModel()
      setToast({ text: '语义模型下载完成' })
      setClipStatus(await window.api.clipStatus())
      return true
    } catch (error) {
      notify(`模型下载失败：${(error as Error).message}`)
      return false
    } finally {
      setClipDownload(null)
    }
  }

  const startClipIndex = async (): Promise<void> => {
    try {
      setClipCardMinimized(false)
      setClipProgress({ done: 0, total: 0, current: '' })
      const result = await window.api.clipIndex()
      notify(
        result.cancelled
          ? `语义索引已停止 · 本次新增 ${result.indexed} 张`
          : `语义索引完成 · 新增 ${result.indexed} 张${result.failed ? ` · 失败 ${result.failed}` : ''}`
      )
      setClipStatus(await window.api.clipStatus())
      bump()
    } catch (error) {
      notify(`语义索引失败：${(error as Error).message}`)
    } finally {
      setClipProgress(null)
    }
  }

  const ensureClipIndex = async (): Promise<void> => {
    const status = await window.api.clipStatus()
    setClipStatus(status)
    if (!status.modelReady) {
      const ok = await window.api.confirm(
        '语义搜索需要先下载模型',
        '中文 CLIP 模型约 182MB，只会下载一次，保存到本机。继续吗？'
      )
      if (!ok) return
      if (!(await downloadClipModel())) return
    }
    await startClipIndex()
  }

  const toggleSemantic = async (): Promise<void> => {
    if (semanticMode) {
      setSemanticMode(false)
      return
    }
    const status = await window.api.clipStatus()
    setClipStatus(status)

    if (!status.modelReady) {
      const ok = await window.api.confirm(
        '语义搜索需要先下载模型',
        '中文 CLIP 模型约 182MB，只会下载一次，保存到本机。继续吗？'
      )
      if (!ok) return
      const ready = await downloadClipModel()
      if (!ready) return
    }

    const fresh = await window.api.clipStatus()
    setClipStatus(fresh)
    setSemanticMode(true)
    if (fresh.total > fresh.indexed && !fresh.running) {
      notify('正在后台建立语义索引，完成后就能搜了')
      void startClipIndex()
    }
  }

  const findSimilar = async (id: number): Promise<void> => {
    try {
      const item = itemsRef.current.find((entry) => entry.id === id)
      const result = await window.api.clipSimilar(id, 200)
      setSimilar({ id, name: item?.name ?? '当前图片' })
      applyItems(result.items)
      setTotal(result.items.length)
      setSelectedIds([])
      setActiveId(null)
    } catch (error) {
      notify(`找相似失败：${(error as Error).message}`)
    }
  }

  const exitSimilar = (): void => {
    setSimilar(null)
    bump()
  }

  const activeItem = items.find((i) => i.id === activeId) ?? null
  const lightboxIndex = items.findIndex((i) => i.id === lightboxId)
  // 条件/排序/模式变化时让瀑布流回到顶部
  const listResetKey = [
    filter.sort ?? '',
    filter.query ?? '',
    filter.folderId ?? '',
    filter.dir ?? '',
    filter.errors ? 'errors' : '',
    (filter.tagIds ?? []).join(','),
    filter.colorFamily ?? '',
    filter.orientation ?? '',
    filter.minRating ?? 0,
    filter.flag ?? 0,
    filter.missing ? 'missing' : '',
    (filter.onlyIds ?? []).join(','),
    semanticMode ? 'sem' : '',
    similar ? `sim${similar.id}` : ''
  ].join('|')

  if (booting) {
    return (
      <div className="h-full grid place-items-center text-[var(--faint)] text-[13px]">正在唤醒月相…</div>
    )
  }

  if (!library) {
    return (
      <Welcome
        onBack={
          switchingFrom
            ? () => {
                const back = switchingFrom
                setSwitchingFrom(null)
                setLibrary(back)
                setTick((value) => value + 1)
              }
            : undefined
        }
        backLabel={switchingFrom ? folderName(switchingFrom) : undefined}
        notice={indexMissing}
        onReady={(dir) => {
          setSwitchingFrom(null)
          setIndexMissing(null)
          setLibrary(dir)
          setFilter({ sort: 'added' })
          setSelectedIds([])
          setActiveId(null)
          setSemanticMode(false)
          setSimilar(null)
        }}
      />
    )
  }

  return (
    <div ref={shellRef} className="h-full flex flex-col relative">
      <div className="flex-1 flex min-h-0">
        <Sidebar
          library={library}
          stats={stats}
          tags={tags}
          folders={folders}
          smarts={smarts}
          dirTree={dirTree}
          filter={filter}
          onFilter={(next) => {
            setFilter(next)
            setSelectedIds([])
            setActiveId(null)
          }}
          onImportFiles={openImportDialog}
          onImportFolder={openImportDialog}
          onSync={() => void syncLibrary()}
          onRescan={rescan}
          onDuplicates={() => setDuplicatesOpen(true)}
          onSwitch={() => {
            setSwitchingFrom(library)
            setLibrary(null)
          }}
          onBackup={backupLibrary}
          onRestore={restoreLibrary}
          onExport={exportCsv}
          onAutoBackup={() => setAutoBackupOpen(true)}
          clipStatus={clipStatus}
          onIndexClip={() => void ensureClipIndex()}
          onAutoTag={() => setAutoTagOpen(true)}
          onRelocate={() => setRelocateOpen(true)}
          lastRelocateDir={lastRelocateDir}
          onEquipment={() => setEquipmentOpen(true)}
          onSettings={() => openSettings('appearance')}
          onCreateFolder={createFolder}
          onDropItems={handleDropItems}
          onDeleteFolder={async (id) => {
            const ok = await window.api.confirm('删除这个文件夹？', '图片本身不会被删除。')
            if (ok) {
              await window.api.deleteFolder(id)
              if (filter.folderId === id) setFilter({ ...filter, folderId: null })
              bump()
            }
          }}
          onDeleteTag={async (id) => {
            const ok = await window.api.confirm('删除这个标签？', '标签会从所有图片上移除。')
            if (ok) {
              await window.api.deleteTag(id)
              setFilter({ ...filter, tagIds: (filter.tagIds ?? []).filter((t) => t !== id) })
              bump()
            }
          }}
          onDeleteSmart={async (id) => {
            await window.api.deleteSmart(id)
            bump()
          }}
        />

        <ResizeHandle
          title="拖动调整左栏宽度，双击复位"
          onStart={() => {
            resizeRef.current = { side: 'sidebar', origin: layoutRef.current.sidebar }
          }}
          onDrag={(delta) => resizeLayout('sidebar', delta)}
          onCommit={commitResize}
          onReset={resetLayout}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <Toolbar
            filter={filter}
            onFilter={setFilter}
            total={total}
            loading={loading}
            selectedIds={selectedIds}
            folders={folders}
            thumbSize={thumbSize}
            onThumbSize={setThumbSize}
            onRateSelected={rateSelected}
            onFlagSelected={setFlagSelected}
            onStackSelected={stackSelected}
            onScoreSelected={() => void scoreItems(selectedIds)}
            aiScoring={aiScoring}
            aiRule={aiRule}
            onOpenSmartFilter={() => setSmartFilterOpen(true)}
            onClearAi={clearAiFilter}
            aiReady={aiReady}
            canScore={aiCaps['photo.quality'] !== false}
            canSmartFilter={aiCaps['photo.smartFilter'] !== false}
            semanticMode={semanticMode}
            clipStatus={clipStatus}
            onToggleSemantic={() => void toggleSemantic()}
            onAddToFolder={addSelectedToFolder}
            onDeleteSelected={deleteSelected}
            onClearMissing={clearMissing}
            onClearSelection={() => setSelectedIds([])}
            onSaveSmart={saveSmart}
          />
          {similar && (
            <div className="shrink-0 px-4 py-2 border-b border-[var(--border)] bg-[var(--panel-2)] flex items-center gap-3 text-[12px]">
              <span className="text-[var(--text)]">
                与「{similar.name}」相似 · {total} 张
              </span>
              <button className="btn h-6 px-2 text-[11px] ml-auto" onClick={exitSimilar}>
                返回全部
              </button>
            </div>
          )}
          <Gallery
            items={items}
            total={total}
            selectedIds={selectedIds}
            thumbSize={thumbSize}
            quality={thumbQuality}
            loading={loading}
            loadingMore={loadingMore}
            hasMore={!similar && !semanticMode && items.length < total}
            resetKey={listResetKey}
            focusId={lightboxId ?? activeId}
            focusTick={revealTick}
            expandedGroups={expandedGroups}
            onExpandGroup={toggleGroup}
            onLoadMore={loadMore}
            onSelect={handleSelect}
            onOpen={openLightbox}
            onImportFiles={openImportDialog}
            hasFilter={
              Boolean(filter.query) ||
              Boolean(filter.folderId) ||
              Boolean(filter.dir) ||
              Boolean(filter.errors) ||
              (filter.tagIds?.length ?? 0) > 0 ||
              Boolean(filter.colorFamily) ||
              Boolean(filter.orientation) ||
              Boolean(filter.flag) ||
              Boolean(filter.missing) ||
              (filter.minRating ?? 0) > 0
            }
          />
        </div>

        {activeItem && (
          <ResizeHandle
            title="拖动调整右栏宽度，双击复位"
            onStart={() => {
              resizeRef.current = { side: 'detail', origin: layoutRef.current.detail }
            }}
            onDrag={(delta) => resizeLayout('detail', delta)}
            onCommit={commitResize}
            onReset={resetLayout}
          />
        )}

        {activeItem && (
          <DetailPanel
            item={activeItem}
            tags={tags}
            folders={folders}
            onClose={() => setActiveId(null)}
            onRefresh={bump}
            onOpenLightbox={() => openLightbox(activeItem.id)}
            onPushUndo={pushUndo}
            onUnstack={unstackItem}
            onFindSimilar={() => void findSimilar(activeItem.id)}
            onAdvice={() => setAdviceOpen(true)}
            onScore={() => void scoreItems([activeItem.id])}
            aiScoring={aiScoring}
            aiReady={aiReady}
            canScore={aiCaps['photo.quality'] !== false}
            canAdvice={aiCaps['photo.advice'] !== false}
          />
        )}
      </div>

      {dragging && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[rgba(9,11,15,0.82)] backdrop-blur-sm pointer-events-none">
          <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-[var(--accent)] text-center">
            <div className="text-[16px] text-[var(--accent-2)] font-medium">松手就收进图库</div>
            <div className="text-[12px] text-[var(--muted)] mt-1">支持文件夹递归导入</div>
          </div>
        </div>
      )}

      {pendingImport && !importRunning && !importResult && (
        <ResumeImportCard
          pending={pendingImport}
          onResume={resumePendingImport}
          onDiscard={discardPendingImport}
        />
      )}

      <ImportStatusCard
        progress={progress}
        running={importRunning}
        result={importResult}
        onPause={() => void window.api.pauseImport()}
        onResume={() => void window.api.resumeImport()}
        onCancel={() => {
          void window.api.cancelImport()
          notify('正在停止导入…')
        }}
        onDismiss={() => setImportResult(null)}
      />

      {clipDownload && (
        <div className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-40 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-[var(--muted)] truncate pr-3">正在下载语义模型</span>
            <span className="text-[var(--text)] tabular-nums">
              {clipDownload.total
                ? `${Math.round((clipDownload.received / clipDownload.total) * 100)}%`
                : '…'}
            </span>
          </div>
          <div className="h-[4px] rounded-full bg-[var(--panel-3)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-200"
              style={{
                width: `${
                  clipDownload.total
                    ? Math.round((clipDownload.received / clipDownload.total) * 100)
                    : 0
                }%`
              }}
            />
          </div>
        </div>
      )}

      {clipProgress && !clipDownload && (
        clipCardMinimized ? (
          <div className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-40 flex items-center gap-2 rounded-full border border-[var(--border)] bg-[var(--panel)] px-3 py-1.5 shadow-2xl">
            <span className="text-[11.5px] text-[var(--muted)]">语义索引</span>
            <span className="text-[11.5px] text-[var(--text)] tabular-nums">
              {clipProgress.total ? `${clipProgress.done}/${clipProgress.total}` : '准备中…'}
              {clipProgress.total
                ? ` · ${Math.round((clipProgress.done / clipProgress.total) * 100)}%`
                : ''}
            </span>
            <button
              className="btn btn-ghost h-5 px-1"
              title="展开进度"
              onClick={() => setClipCardMinimized(false)}
            >
              <ChevronUp size={12} />
            </button>
          </div>
        ) : (
          <div className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-40 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
            <div className="flex items-center justify-between text-[12px] mb-2">
              <span className="text-[var(--muted)] truncate pr-3">
                语义索引 {clipProgress.current || (clipProgress.total ? '' : '准备中…')}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="text-[var(--text)] tabular-nums">
                  {clipProgress.total ? `${clipProgress.done}/${clipProgress.total}` : '—'}
                </span>
                <button
                  className="btn btn-ghost h-5 px-1"
                  title="最小化，处理别的事"
                  onClick={() => setClipCardMinimized(true)}
                >
                  <ChevronDown size={12} />
                </button>
              </span>
            </div>
            <div className="h-[4px] rounded-full bg-[var(--panel-3)] overflow-hidden">
              <div
                className="h-full bg-[var(--accent)] transition-[width] duration-200"
                style={{
                  width: `${
                    clipProgress.total
                      ? Math.round((clipProgress.done / clipProgress.total) * 100)
                      : 0
                  }%`
                }}
              />
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <button
                className="btn btn-ghost btn-danger h-6 px-2 text-[11px]"
                onClick={() => {
                  void window.api.clipCancel()
                  notify('正在停止语义索引…')
                }}
              >
                停止索引
              </button>
              <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                只占用 2 个 CPU 线程
              </span>
            </div>
          </div>
        )
      )}

      {toast && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel)] px-4 py-2 text-[12.5px] text-[var(--text)] shadow-xl">
          <span>{toast.text}</span>
          {toast.undo && (
            <button
              className="text-[var(--accent-2)] hover:underline"
              onClick={() => void undoLast()}
            >
              撤销
            </button>
          )}
        </div>
      )}

      {lightboxId !== null && lightboxIndex >= 0 && (
        <Lightbox
          items={items}
          index={lightboxIndex}
          onClose={closeLightbox}
          onNavigate={(next) => {
            const item = items[next]
            if (item) openLightbox(item.id)
          }}
        />
      )}

      {importOpen && (
        <ImportDialog
          options={importOptions}
          onOptions={setImportOptions}
          onPickFolder={importFolder}
          onPickFiles={importFiles}
          onClose={() => setImportOpen(false)}
        />
      )}

      {duplicatesOpen && (
        <DuplicatesDialog
          onClose={() => setDuplicatesOpen(false)}
          onRemove={async (ids) => {
            await window.api.deleteItems(ids)
            pushUndo(`已移除 ${ids.length} 张重复图片`, async () => {
              await window.api.restoreItems(ids)
              bump()
            })
            bump()
          }}
        />
      )}

      {autoBackupOpen && (
        <AutoBackupDialog
          onClose={() => setAutoBackupOpen(false)}
          onSaved={(settings) => {
            notify(
              settings.enabled
                ? `自动备份已开启 · 每 ${settings.intervalDays} 天 · 保留 ${settings.keep} 份`
                : '自动备份已关闭'
            )
          }}
        />
      )}

      {autoTagOpen && (
        <AutoTagDialog
          onClose={() => setAutoTagOpen(false)}
          onFinished={(message) => {
            notify(message)
            bump()
          }}
        />
      )}

      {relocateOpen && (
        <RelocateDialog
          onClose={() => {
            setRelocateOpen(false)
            // 选过文件夹但没应用就关掉时，侧栏也要更新
            void window.api.lastRelocateDir().then(setLastRelocateDir)
          }}
          onFinished={(message) => {
            setRelocateOpen(false)
            // 接回后「文件丢失」视图通常空了，直接回到全部图片
            setFilter({ sort: filter.sort })
            notify(message)
            bump()
          }}
        />
      )}

      {equipmentOpen && <EquipmentDialog onClose={() => setEquipmentOpen(false)} />}

      {settingsOpen && (
        <SettingsDialog
          theme={theme}
          onChange={changeTheme}
          skin={skin}
          onSkin={changeSkin}
          thumbQuality={thumbQuality}
          onThumbQuality={changeThumbQuality}
          onClose={() => setSettingsOpen(false)}
          initialTab={settingsTab}
        />
      )}

      {adviceOpen && activeItem && (
        <AdviceDialog
          item={activeItem}
          onClose={() => setAdviceOpen(false)}
          onOpenSettings={() => openSettings('llm')}
        />
      )}

      {smartFilterOpen && (
        <SmartFilterDialog
          items={items}
          total={total}
          onApply={applyAiFilter}
          onClose={() => setSmartFilterOpen(false)}
          onOpenSettings={() => openSettings('llm')}
        />
      )}
    </div>
  )
}
