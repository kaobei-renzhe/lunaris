import { useCallback, useEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent } from 'react'
import type {
  ClipDownloadProgress,
  ClipProgress,
  ClipStatus,
  FilterState,
  Folder,
  ImportProgress,
  Item,
  SmartFolder,
  Stats,
  Tag,
  ThemeMode
} from '@shared/types'
import Sidebar from './components/Sidebar'
import Toolbar from './components/Toolbar'
import Gallery from './components/Gallery'
import DetailPanel from './components/DetailPanel'
import Lightbox from './components/Lightbox'
import DuplicatesDialog from './components/DuplicatesDialog'
import AutoBackupDialog from './components/AutoBackupDialog'
import AutoTagDialog from './components/AutoTagDialog'
import RelocateDialog from './components/RelocateDialog'
import EquipmentDialog from './components/EquipmentDialog'
import SettingsDialog from './components/SettingsDialog'
import Welcome from './components/Welcome'
import { formatBytes } from './lib/format'
import { applyTheme, cacheTheme, watchSystemTheme } from './lib/theme'

const EMPTY_STATS: Stats = { total: 0, missing: 0, tags: 0, folders: 0, bytes: 0 }
const PAGE = 200

interface Toast {
  text: string
  undo?: boolean
}

export default function App() {
  const [library, setLibrary] = useState<string | null>(null)
  const [booting, setBooting] = useState(true)
  const [items, setItems] = useState<Item[]>([])
  const [total, setTotal] = useState(0)
  const [tags, setTags] = useState<Tag[]>([])
  const [folders, setFolders] = useState<Folder[]>([])
  const [smarts, setSmarts] = useState<SmartFolder[]>([])
  const [stats, setStats] = useState<Stats>(EMPTY_STATS)
  const [filter, setFilter] = useState<FilterState>({ sort: 'added' })
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [activeId, setActiveId] = useState<number | null>(null)
  const [lightboxId, setLightboxId] = useState<number | null>(null)
  const [thumbSize, setThumbSize] = useState(230)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [duplicatesOpen, setDuplicatesOpen] = useState(false)
  const [autoBackupOpen, setAutoBackupOpen] = useState(false)
  const [autoTagOpen, setAutoTagOpen] = useState(false)
  const [relocateOpen, setRelocateOpen] = useState(false)
  const [equipmentOpen, setEquipmentOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [theme, setTheme] = useState<ThemeMode>('system')
  const [lastRelocateDir, setLastRelocateDir] = useState<string | null>(null)
  const [semanticMode, setSemanticMode] = useState(false)
  const [clipStatus, setClipStatus] = useState<ClipStatus | null>(null)
  const [clipProgress, setClipProgress] = useState<ClipProgress | null>(null)
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

  filterRef.current = { ...filter, expandedGroups }
  totalRef.current = total

  const bump = useCallback(() => setTick((v) => v + 1), [])

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

  const refreshMeta = useCallback(async () => {
    const [nextTags, nextFolders, nextSmarts, nextStats] = await Promise.all([
      window.api.listTags(),
      window.api.listFolders(),
      window.api.listSmart(),
      window.api.stats()
    ])
    setTags(nextTags)
    setFolders(nextFolders)
    setSmarts(nextSmarts)
    setStats(nextStats)
  }, [])

  useEffect(() => {
    window.api
      .lastLibrary()
      .then((dir) => {
        if (dir) setLibrary(dir)
      })
      .catch(() => undefined)
      .finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    window.api
      .getTheme()
      .then((mode) => {
        setTheme(mode)
        cacheTheme(mode)
        applyTheme(mode)
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    applyTheme(theme)
    return watchSystemTheme(() => {
      if (theme === 'system') applyTheme('system')
    })
  }, [theme])

  const changeTheme = useCallback((mode: ThemeMode) => {
    setTheme(mode)
    cacheTheme(mode)
    applyTheme(mode)
  }, [])

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

  const runImport = useCallback(
    async (paths: string[]) => {
      if (!paths.length) return
      try {
        const result = await window.api.importPaths(paths)
        const relinked = result.relinked > 0 ? ` · 找回 ${result.relinked}` : ''
        notify(`导入完成 · 新增 ${result.added}${relinked} · 跳过 ${result.skipped} · 失败 ${result.failed}`)
      } catch (error) {
        notify(`导入失败：${(error as Error).message}`)
      } finally {
        setProgress(null)
        setTick((v) => v + 1)
      }
    },
    [notify]
  )

  const importFiles = useCallback(async () => {
    const paths = await window.api.pickImages()
    await runImport(paths)
  }, [runImport])

  const importFolder = useCallback(async () => {
    const dir = await window.api.pickFolder()
    if (dir) await runImport([dir])
  }, [runImport])

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
      void runImport(paths)
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
  }, [library, runImport])

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
        if (lightboxId) setLightboxId(null)
        else if (activeId) setActiveId(null)
        else setSelectedIds([])
        return
      }
      // 灯箱打开时，键盘交给灯箱自己，别把后面的列表也动了
      if (lightboxId) return
      if (typing) return

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        if (semanticMode || similar) {
          // 语义/相似模式下列表就是结果集，直接全选
          setSelectedIds(itemsRef.current.map((i) => i.id))
          return
        }
        void window.api.filteredIds(filterRef.current).then(setSelectedIds)
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
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        moveSelection(1)
        return
      }
      if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        moveSelection(-1)
        return
      }
      if (e.key === ' ' && activeId) {
        e.preventDefault()
        setLightboxId(activeId)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    selectedIds,
    lightboxId,
    activeId,
    semanticMode,
    similar,
    deleteSelected,
    rateSelected,
    setFlagSelected,
    moveSelection,
    undoLast
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
      setClipProgress({ done: 0, total: 0, current: '' })
      const result = await window.api.clipIndex()
      notify(
        `语义索引完成 · 新增 ${result.indexed} 张${result.failed ? ` · 失败 ${result.failed}` : ''}`
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
    (filter.tagIds ?? []).join(','),
    filter.colorFamily ?? '',
    filter.orientation ?? '',
    filter.minRating ?? 0,
    filter.flag ?? 0,
    filter.missing ? 'missing' : '',
    semanticMode ? 'sem' : '',
    similar ? `sim${similar.id}` : ''
  ].join('|')

  if (booting) {
    return (
      <div className="h-full grid place-items-center text-[var(--faint)] text-[13px]">正在唤醒月巢…</div>
    )
  }

  if (!library) {
    return (
      <Welcome
        onReady={(dir) => {
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
    <div className="h-full flex flex-col relative">
      <div className="flex-1 flex min-h-0">
        <Sidebar
          library={library}
          stats={stats}
          tags={tags}
          folders={folders}
          smarts={smarts}
          filter={filter}
          onFilter={(next) => {
            setFilter(next)
            setSelectedIds([])
            setActiveId(null)
          }}
          onImportFiles={importFiles}
          onImportFolder={importFolder}
          onRescan={rescan}
          onDuplicates={() => setDuplicatesOpen(true)}
          onSwitch={() => setLibrary(null)}
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
          onSettings={() => setSettingsOpen(true)}
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
            semanticMode={semanticMode}
            clipStatus={clipStatus}
            onToggleSemantic={() => void toggleSemantic()}
            onAddToFolder={addSelectedToFolder}
            onDeleteSelected={deleteSelected}
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
            loading={loading}
            loadingMore={loadingMore}
            hasMore={!similar && !semanticMode && items.length < total}
            resetKey={listResetKey}
            focusId={activeId}
            expandedGroups={expandedGroups}
            onExpandGroup={toggleGroup}
            onLoadMore={loadMore}
            onSelect={handleSelect}
            onOpen={(id) => setLightboxId(id)}
            onImportFiles={importFiles}
            hasFilter={
              Boolean(filter.query) ||
              Boolean(filter.folderId) ||
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
          <DetailPanel
            item={activeItem}
            tags={tags}
            folders={folders}
            onClose={() => setActiveId(null)}
            onRefresh={bump}
            onOpenLightbox={() => setLightboxId(activeItem.id)}
            onPushUndo={pushUndo}
            onUnstack={unstackItem}
            onFindSimilar={() => void findSimilar(activeItem.id)}
          />
        )}
      </div>

      {dragging && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-[rgba(9,11,15,0.82)] backdrop-blur-sm pointer-events-none">
          <div className="px-10 py-8 rounded-2xl border-2 border-dashed border-[var(--accent)] text-center">
            <div className="text-[16px] text-[var(--accent-2)] font-medium">松手就收进月巢</div>
            <div className="text-[12px] text-[var(--muted)] mt-1">支持文件夹递归导入</div>
          </div>
        </div>
      )}

      {progress && progress.total > 0 && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-40 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-[var(--muted)] truncate pr-3">正在索引 {progress.current || '…'}</span>
            <span className="text-[var(--text)] tabular-nums">
              {progress.done}/{progress.total}
            </span>
          </div>
          <div className="h-[4px] rounded-full bg-[var(--panel-3)] overflow-hidden">
            <div
              className="h-full bg-[var(--accent)] transition-[width] duration-200"
              style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
            />
          </div>
        </div>
      )}

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
        <div className="absolute bottom-[86px] left-1/2 -translate-x-1/2 z-40 w-[360px] rounded-xl border border-[var(--border)] bg-[var(--panel)] px-4 py-3 shadow-2xl">
          <div className="flex items-center justify-between text-[12px] mb-2">
            <span className="text-[var(--muted)] truncate pr-3">
              语义索引 {clipProgress.current || ''}
            </span>
            <span className="text-[var(--text)] tabular-nums">
              {clipProgress.done}/{clipProgress.total}
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
        </div>
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
          onClose={() => setLightboxId(null)}
          onNavigate={(next) => {
            const item = items[next]
            if (item) setLightboxId(item.id)
          }}
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
          onClose={() => setSettingsOpen(false)}
        />
      )}
    </div>
  )
}
