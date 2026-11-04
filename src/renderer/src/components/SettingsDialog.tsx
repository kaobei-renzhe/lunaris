import { useEffect, useState } from 'react'
import {
  Check,
  Cpu,
  FileText,
  HardDrive,
  Image as ImageIcon,
  Monitor,
  Moon,
  Palette,
  Settings as SettingsIcon,
  Sparkles,
  Sun,
  X
} from 'lucide-react'
import type {
  EmbeddingModelId,
  EmbeddingModelInfo,
  Folder,
  LibraryStorage,
  ThemeMode,
  XmpProgress,
  XmpSettings
} from '@shared/types'
import type { LlmConfig, LlmStatus, LlmTestResult } from '@shared/llm'
import { findSkin, SKINS, type SkinId } from '@shared/skins'
import {
  THUMB_CACHE_LIMIT_DEFAULT,
  THUMB_CACHE_LIMIT_OPTIONS,
  THUMB_QUALITY_OPTIONS,
  type ThumbCacheStats,
  type ThumbQualityPref
} from '@shared/thumbs'
import { formatBytes } from '../lib/format'

/** 设置面板的左侧分类 */
export type SettingsTab = 'appearance' | 'llm' | 'semantic' | 'storage'

interface SettingsDialogProps {
  theme: ThemeMode
  onChange: (mode: ThemeMode) => void
  skin: SkinId
  onSkin: (id: SkinId) => void
  /** 瀑布流缩略图清晰度，改完立即生效 */
  thumbQuality: ThumbQualityPref
  onThumbQuality: (pref: ThumbQualityPref) => void
  /** 全部文件夹，用来选 AI 处理的文件夹范围 */
  folders: Folder[]
  onClose: () => void
  /** 打开时默认停在哪个分类（AI 弹窗的「去设置」直接落到大模型） */
  initialTab?: SettingsTab
}

const TABS: Array<{ id: SettingsTab; label: string; hint: string; Icon: typeof Monitor }> = [
  { id: 'appearance', label: '外观', hint: '主题与界面风格', Icon: Palette },
  { id: 'llm', label: '大模型', hint: '服务商、密钥、能力开关', Icon: Sparkles },
  { id: 'semantic', label: '语义索引', hint: '闲着时自动给照片建索引，方便搜图', Icon: Cpu },
  { id: 'storage', label: '存储位置', hint: '索引与缓存放在哪', Icon: HardDrive }
]

const THEME_OPTIONS: Array<{
  value: ThemeMode
  label: string
  hint: string
  Icon: typeof Monitor
}> = [
  { value: 'system', label: '跟随系统', hint: '系统换成深色或浅色时，我也跟着变', Icon: Monitor },
  { value: 'dark', label: '深色模式', hint: '深灰背景，夜里看图不刺眼', Icon: Moon },
  { value: 'light', label: '浅色模式', hint: '亮色背景，白天看着更清爽', Icon: Sun }
]

export default function SettingsDialog({
  theme,
  onChange,
  skin,
  onSkin,
  thumbQuality,
  onThumbQuality,
  folders,
  onClose,
  initialTab = 'appearance'
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [saving, setSaving] = useState(false)
  const [skinSaving, setSkinSaving] = useState(false)
  const [autoClip, setAutoClip] = useState<boolean | null>(null)
  const [embeddingModels, setEmbeddingModels] = useState<EmbeddingModelInfo[] | null>(null)
  const [modelBusy, setModelBusy] = useState<EmbeddingModelId | null>(null)
  const [modelMsg, setModelMsg] = useState<string | null>(null)
  const [scoreMinRating, setScoreMinRating] = useState<number | null>(null)
  const [scoreCounts, setScoreCounts] = useState<{ matched: number; total: number } | null>(null)
  /** AI 处理的文件夹范围；null = 还没读回来 */
  const [scopeFolders, setScopeFolders] = useState<number[] | null>(null)
  const [scoreBusy, setScoreBusy] = useState(false)
  const [llm, setLlm] = useState<LlmStatus | null>(null)
  const [llmDraft, setLlmDraft] = useState({ baseUrl: '', model: '' })
  const [keyDraft, setKeyDraft] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<LlmTestResult | null>(null)
  const [storage, setStorage] = useState<LibraryStorage | null>(null)
  const [indexBusy, setIndexBusy] = useState(false)
  const [indexMsg, setIndexMsg] = useState<string | null>(null)
  const [thumbStats, setThumbStats] = useState<ThumbCacheStats | null>(null)
  const [thumbBusy, setThumbBusy] = useState(false)
  const [thumbMsg, setThumbMsg] = useState<string | null>(null)
  const [thumbLimit, setThumbLimit] = useState<number | null>(null)
  const [limitBusy, setLimitBusy] = useState(false)
  const [xmp, setXmp] = useState<XmpSettings | null>(null)
  const [xmpBusy, setXmpBusy] = useState(false)
  const [xmpMsg, setXmpMsg] = useState<string | null>(null)
  const [xmpProgress, setXmpProgress] = useState<XmpProgress | null>(null)

  useEffect(() => {
    void window.api
      .getClipAutoIndex()
      .then(setAutoClip)
      .catch(() => setAutoClip(true))
    void window.api
      .listEmbeddingModels()
      .then(setEmbeddingModels)
      .catch(() => setEmbeddingModels(null))
    void window.api
      .getAiScoreMinRating()
      .then(setScoreMinRating)
      .catch(() => setScoreMinRating(0))
    void window.api
      .getAiFolderIds()
      .then(setScopeFolders)
      .catch(() => setScopeFolders([]))
    void window.api
      .aiScoreCandidates()
      .then(setScoreCounts)
      .catch(() => setScoreCounts(null))
    void window.api
      .llmStatus()
      .then(setLlm)
      .catch(() => setLlm(null))
    void window.api
      .getLibraryStorage()
      .then(setStorage)
      .catch(() => setStorage(null))
    void window.api
      .thumbCacheStats()
      .then(setThumbStats)
      .catch(() => setThumbStats(null))
    void window.api
      .getThumbCacheLimit()
      .then(setThumbLimit)
      .catch(() => setThumbLimit(THUMB_CACHE_LIMIT_DEFAULT))
    void window.api
      .getXmpSettings()
      .then(setXmp)
      .catch(() => setXmp({ enabled: false, ignoreExternal: false }))
  }, [])

  useEffect(() => window.api.onXmpProgress(setXmpProgress), [])

  const limitLabel = (mb: number): string =>
    THUMB_CACHE_LIMIT_OPTIONS.find((option) => option.value === mb)?.label ?? `${mb} MB`

  /** 改 AI 评分的星级门槛：存主进程配置，顺手刷新当前范围内可评分的张数 */
  const changeScoreRating = async (value: number): Promise<void> => {
    if (scoreBusy) return
    setScoreBusy(true)
    try {
      const saved = await window.api.saveAiScoreMinRating(value)
      setScoreMinRating(saved)
      setScoreCounts(await window.api.aiScoreCandidates())
    } catch {
      /* 保存失败保持原值，下次打开设置再读 */
    } finally {
      setScoreBusy(false)
    }
  }

  /** 改 AI 处理的文件夹范围：空数组表示全部文件夹 */
  const changeScopeFolders = async (next: number[]): Promise<void> => {
    if (scoreBusy) return
    setScoreBusy(true)
    try {
      const saved = await window.api.saveAiFolderIds(next)
      setScopeFolders(saved)
      setScoreCounts(await window.api.aiScoreCandidates())
    } catch {
      /* 保存失败保持原值 */
    } finally {
      setScoreBusy(false)
    }
  }

  /** 点一下切换选中：已选就取消，没选就加上 */
  const toggleFolder = (id: number): number[] => {
    const current = scopeFolders ?? []
    return current.includes(id) ? current.filter((value) => value !== id) : [...current, id]
  }

  /** 改上限：调小时主进程会立刻按最久未用淘汰一次 */
  const changeLimit = async (mb: number): Promise<void> => {
    if (limitBusy) return
    setLimitBusy(true)
    setThumbMsg(null)
    try {
      const result = await window.api.saveThumbCacheLimit(mb)
      setThumbLimit(result.limit)
      setThumbStats(await window.api.thumbCacheStats())
      setThumbMsg(
        result.freed > 0
          ? `上限已设为 ${limitLabel(result.limit)}，顺带清理了 ${formatBytes(result.freed)}`
          : `上限已设为 ${limitLabel(result.limit)}`
      )
    } catch {
      setThumbMsg('设置上限失败，稍后再试')
    } finally {
      setLimitBusy(false)
    }
  }

  /** 存 XMP 开关；关闭只影响后续自动写入，不删已有侧车 */
  const changeXmp = async (patch: Partial<XmpSettings>): Promise<void> => {
    if (!xmp) return
    try {
      const next = await window.api.saveXmpSettings(patch)
      setXmp(next)
      setXmpMsg(
        patch.enabled === false
          ? '已关闭 XMP 侧车，已有 .xmp 文件不会删除'
          : patch.enabled === true
            ? '已开启 XMP 侧车，之后改星级/旗标/标签会自动写入'
            : '设置已保存'
      )
    } catch {
      setXmpMsg('保存 XMP 设置失败')
    }
  }

  const exportAllXmp = async (): Promise<void> => {
    if (xmpBusy) return
    const ok = await window.api.confirm(
      '为所有照片写 XMP 侧车？',
      '会在原图旁边生成 .xmp 文件，不改原图；RAW + JPEG 配对只写 RAW。图库很大时需要等一会儿。'
    )
    if (!ok) return
    setXmpBusy(true)
    setXmpMsg(null)
    setXmpProgress(null)
    try {
      const result = await window.api.xmpExportAll()
      setXmpMsg(
        `已写 ${result.written} 张${result.skipped ? ` · 跳过 ${result.skipped} 张` : ''}${
          result.failed ? ` · 失败 ${result.failed} 张（多为只读盘）` : ''
        }`
      )
    } catch (error) {
      setXmpMsg(`导出 XMP 失败：${(error as Error).message}`)
    } finally {
      setXmpBusy(false)
      setXmpProgress(null)
    }
  }

  const checkXmp = async (): Promise<void> => {
    if (xmpBusy) return
    setXmpBusy(true)
    setXmpMsg(null)
    setXmpProgress(null)
    try {
      const result = await window.api.xmpCheckConflicts()
      if (result.ignored) {
        setXmpMsg('已设置忽略外部修改，不再检查')
        return
      }
      if (result.conflicts.length === 0) {
        setXmpMsg(`检查了 ${result.scanned} 张，没有发现外部修改`)
        return
      }
      const ok = await window.api.confirm(
        `发现 ${result.conflicts.length} 张在别的软件里改过，要导入吗？`,
        '会覆盖星级、旗标、备注，标签只增不减；不导入就保持月相现在的判断。'
      )
      if (!ok) {
        setXmpMsg(`发现 ${result.conflicts.length} 张外部修改，已跳过`)
        return
      }
      const imported = await window.api.xmpImportConflicts(
        result.conflicts.map((item) => item.itemId)
      )
      setXmpMsg(
        `已导入 ${imported.imported} 张${imported.failed ? ` · ${imported.failed} 张失败` : ''}`
      )
    } catch (error) {
      setXmpMsg(`检查外部修改失败：${(error as Error).message}`)
    } finally {
      setXmpBusy(false)
      setXmpProgress(null)
    }
  }

  /** 清理缩略图缓存：high 只删高清档，all 连中/低档一起删 */
  const clearThumbs = async (target: 'high' | 'all'): Promise<void> => {
    if (thumbBusy) return
    if (target === 'all') {
      const ok = await window.api.confirm(
        '删除全部缩略图缓存？',
        '低 / 中 / 高三档都会被删掉，之后按需重新生成。图库很大时首次浏览会明显变慢，原图不受影响。'
      )
      if (!ok) return
    }
    setThumbBusy(true)
    setThumbMsg(null)
    try {
      const result = await window.api.clearThumbCache(target)
      setThumbMsg(
        result.removed > 0
          ? `已清理 ${result.removed} 个文件，释放 ${formatBytes(result.freed)}`
          : '没有需要清理的文件'
      )
      setThumbStats(await window.api.thumbCacheStats())
    } catch {
      setThumbMsg('清理失败，稍后再试')
    } finally {
      setThumbBusy(false)
    }
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  /** 索引搬家：undefined = 弹目录选择框，null = 放回图库目录 */
  const moveIndex = async (target: string | null | undefined): Promise<void> => {
    if (indexBusy) return
    setIndexBusy(true)
    setIndexMsg(null)
    try {
      const result =
        target === undefined ? await window.api.pickIndexDir() : await window.api.moveIndexDir(target)
      if (result.cancelled) return
      if (!result.ok) {
        setIndexMsg(result.message ?? '移动失败')
        return
      }
      setStorage(await window.api.getLibraryStorage())
      const detail = [
        result.files ? `${result.files} 个文件` : '',
        result.cleaned === false ? '旧文件没清理干净，可手动删除' : ''
      ]
        .filter(Boolean)
        .join('，')
      setIndexMsg(`已移动到新位置${detail ? `（${detail}）` : ''}`)
    } catch (error) {
      setIndexMsg(`移动失败：${(error as Error).message}`)
    } finally {
      setIndexBusy(false)
    }
  }

  useEffect(() => {
    if (!llm) return
    setLlmDraft({ baseUrl: llm.config.baseUrl, model: llm.config.model })
  }, [llm?.config.baseUrl, llm?.config.model])

  const patchLlm = async (patch: Partial<LlmConfig>): Promise<void> => {
    const next = await window.api.llmSaveConfig(patch)
    setLlm(next)
  }

  const saveLlmKey = async (): Promise<void> => {
    if (!keyDraft.trim() || keyBusy) return
    setKeyBusy(true)
    try {
      setLlm(await window.api.llmSaveKey(keyDraft.trim()))
      setKeyDraft('')
      setTestResult(null)
    } finally {
      setKeyBusy(false)
    }
  }

  const clearLlmKey = async (): Promise<void> => {
    setKeyBusy(true)
    try {
      setLlm(await window.api.llmClearKey())
      setTestResult(null)
    } finally {
      setKeyBusy(false)
    }
  }

  const runLlmTest = async (): Promise<void> => {
    if (testing) return
    setTesting(true)
    try {
      setTestResult(await window.api.llmTest())
      setLlm(await window.api.llmStatus())
    } finally {
      setTesting(false)
    }
  }

  const toggleAutoClip = async (): Promise<void> => {
    if (autoClip === null) return
    const next = await window.api.saveClipAutoIndex(!autoClip)
    setAutoClip(next)
  }

  const refreshModels = async (): Promise<void> => {
    try {
      setEmbeddingModels(await window.api.listEmbeddingModels())
    } catch {
      /* 读取失败保留旧值，下次打开设置再刷新 */
    }
  }

  const switchModel = async (id: EmbeddingModelId, label: string): Promise<boolean> => {
    setModelBusy(id)
    setModelMsg(null)
    try {
      const status = await window.api.selectEmbeddingModel(id)
      setModelMsg(
        status.total > status.indexed
          ? `已切换到 ${label}，还有 ${status.total - status.indexed} 张照片需要重建索引`
          : `已切换到 ${label}`
      )
      await refreshModels()
      return true
    } catch (error) {
      setModelMsg(`切换失败：${(error as Error).message}`)
      return false
    } finally {
      setModelBusy(null)
    }
  }

  const downloadAndSwitchModel = async (model: EmbeddingModelInfo): Promise<void> => {
    if (modelBusy) return
    setModelBusy(model.id)
    setModelMsg(null)
    try {
      await window.api.clipDownloadModel(model.id)
      const ok = await switchModel(model.id, model.label)
      if (ok) {
        setModelMsg(
          `已下载并切换到 ${model.label}；点侧栏「语义索引」或等闲时自动建立索引后就能用`
        )
      }
    } catch (error) {
      setModelMsg(`下载失败：${(error as Error).message}`)
    } finally {
      setModelBusy(null)
    }
  }

  const useExistingModel = async (model: EmbeddingModelInfo): Promise<void> => {
    if (modelBusy || model.active) return
    const ok = await window.api.confirm(
      `切换到 ${model.label}？`,
      '旧模型的索引会保留，但新模型需要重新建立语义索引才能用于搜图与自动分类。'
    )
    if (ok) await switchModel(model.id, model.label)
  }

  const pick = async (mode: ThemeMode): Promise<void> => {
    if (mode === theme || saving) return
    setSaving(true)
    try {
      onChange(await window.api.saveTheme(mode))
    } finally {
      setSaving(false)
    }
  }

  const pickSkin = async (id: SkinId): Promise<void> => {
    if (id === skin || skinSaving) return
    setSkinSaving(true)
    onSkin(id)
    try {
      onSkin(await window.api.saveSkin(id))
    } finally {
      setSkinSaving(false)
    }
  }

  const activeSkin = findSkin(skin)

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60" onClick={onClose}>
      <div
        className="w-[760px] h-[560px] max-h-[86vh] flex flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="h-[48px] px-4 flex items-center gap-2 border-b border-[var(--border)] shrink-0">
          <SettingsIcon size={15} color="var(--accent-2)" />
          <span className="text-[13.5px] font-medium">设置</span>
          <button className="btn btn-ghost h-7 px-1.5 ml-auto" onClick={onClose}>
            <X size={15} />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex">
          <nav className="w-[172px] shrink-0 border-r border-[var(--border)] p-2 space-y-1 overflow-y-auto">
            {TABS.map(({ id, label, hint, Icon }) => {
              const active = tab === id
              return (
                <button
                  key={id}
                  className={`w-full text-left rounded-lg px-2.5 py-2 transition-colors ${
                    active
                      ? 'bg-[var(--accent-soft)]'
                      : 'hover:bg-[var(--panel-2)]'
                  }`}
                  onClick={() => setTab(id)}
                  aria-current={active ? 'page' : undefined}
                >
                  <div className="flex items-center gap-2">
                    <Icon size={14} color={active ? 'var(--accent-2)' : 'var(--muted)'} />
                    <span
                      className={`text-[12.5px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                    >
                      {label}
                    </span>
                  </div>
                  <div className="mt-0.5 pl-[22px] text-[10px] leading-4 text-[var(--faint)]">{hint}</div>
                </button>
              )
            })}
          </nav>

          <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">
            {tab === 'appearance' && (
              <>
                <div>
                  <div className="text-[12.5px] mb-2">主题</div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {THEME_OPTIONS.map(({ value, label, hint, Icon }) => {
                      const active = theme === value
                      return (
                        <button
                          key={value}
                          className={`rounded-lg border px-2.5 py-2.5 text-left transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]'
                          }`}
                          disabled={saving}
                          onClick={() => void pick(value)}
                        >
                          <div className="flex items-center gap-1.5">
                            <Icon size={14} color={active ? 'var(--accent-2)' : 'var(--muted)'} />
                            <span
                              className={`text-[12px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                            >
                              {label}
                            </span>
                          </div>
                          <div className="mt-1 text-[10.5px] leading-4 text-[var(--faint)]">{hint}</div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-[11px] leading-4 text-[var(--faint)]">
                    选择后会立刻生效，下次启动也沿用这次的选择。
                  </div>
                </div>

                <div>
                  <div className="text-[12.5px] mb-2">界面风格</div>
                  <div className="grid grid-cols-3 gap-2">
                    {SKINS.map((item) => {
                      const active = item.id === skin
                      return (
                        <button
                          key={item.id}
                          className={`rounded-lg border p-2 text-left transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]'
                          }`}
                          disabled={skinSaving}
                          onClick={() => void pickSkin(item.id)}
                        >
                          <div className="flex gap-1.5">
                            {item.swatches.map((color) => (
                              <span
                                key={color}
                                className="h-7 flex-1 rounded-[5px] border border-white/10"
                                style={{ background: color }}
                              />
                            ))}
                          </div>
                          <div className="mt-1.5 flex items-center gap-1">
                            <span
                              className={`text-[12px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                            >
                              {item.name}
                            </span>
                            {active && <Check size={12} color="var(--accent-2)" />}
                          </div>
                          <div className="mt-0.5 text-[10.5px] leading-4 text-[var(--faint)]">{item.hint}</div>
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-[11px] leading-4 text-[var(--faint)]">
                    「{activeSkin.name}」已应用。除「经典」外，其余风格会固定深/浅，上方的主题开关对它们不起作用。
                  </div>
                </div>

                <div>
                  <div className="text-[12.5px] mb-2">照片清晰度</div>
                  <div className="space-y-1.5">
                    {THUMB_QUALITY_OPTIONS.map((item) => {
                      const active = item.id === thumbQuality
                      return (
                        <button
                          key={item.id}
                          className={`w-full flex items-start gap-2 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)]'
                              : 'border-[var(--border)] bg-[var(--panel-2)] hover:border-[var(--border-strong)]'
                          }`}
                          onClick={() => onThumbQuality(item.id)}
                        >
                          <ImageIcon
                            size={14}
                            className="mt-0.5 shrink-0"
                            color={active ? 'var(--accent-2)' : 'var(--muted)'}
                          />
                          <div className="min-w-0 flex-1">
                            <span
                              className={`text-[12px] ${active ? 'text-[var(--accent-text)]' : 'text-[var(--text)]'}`}
                            >
                              {item.label}
                            </span>
                            <div className="mt-0.5 text-[10.5px] leading-4 text-[var(--faint)]">{item.hint}</div>
                          </div>
                          {active && <Check size={13} color="var(--accent-2)" className="mt-0.5 shrink-0" />}
                        </button>
                      )
                    })}
                  </div>
                  <div className="mt-2 text-[11px] leading-4 text-[var(--faint)]">
                    只影响瀑布流里的小图，点开来看的始终是原图。选「自动」会按卡片大小和屏幕像素密度挑档，
                    缩略图拉大或竖构图自动上高清；切换后立刻重新加载，偏好自动记住。
                  </div>
                </div>
              </>
            )}

            {tab === 'llm' && (
              <>
                <div className="flex items-center gap-1.5">
                  <span className="text-[12.5px]">模型服务</span>
                  {llm && (
                    <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                      {llm.encryption === 'os' ? '密钥由系统加密保存' : '系统加密不可用'}
                    </span>
                  )}
                </div>

                {!llm ? (
                  <div className="text-[11px] text-[var(--faint)]">读取配置中…</div>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-3 space-y-2.5">
                    <div className="flex items-start gap-3">
                      <div className="min-w-0">
                        <div className="text-[12.5px]">启用大模型能力</div>
                        <div className="text-[10.5px] leading-4 text-[var(--faint)] mt-0.5">
                          默认关闭。关闭时相册里不会出现任何 AI 按钮，也不会发出网络请求；开启后也不会自己跑，
                          只有你在相册里点 AI 按钮时才会调用，每次调用都会消耗你账户里的 token。
                        </div>
                      </div>
                      <button
                        className={`ml-auto mt-0.5 w-[38px] h-[21px] rounded-full relative shrink-0 transition-colors ${
                          llm.config.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                        }`}
                        onClick={() => void patchLlm({ enabled: !llm.config.enabled })}
                        aria-pressed={llm.config.enabled}
                        title={llm.config.enabled ? '关闭大模型能力' : '开启大模型能力'}
                      >
                        <span
                          className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-all ${
                            llm.config.enabled ? 'left-[19px]' : 'left-[2px]'
                          }`}
                        />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">服务商</span>
                        <select
                          className="input h-7 text-[11.5px] w-full mt-1"
                          value={llm.config.provider}
                          onChange={(event) =>
                            void patchLlm({ provider: event.target.value as LlmConfig['provider'] })
                          }
                        >
                          <option value="openai-compatible">OpenAI 兼容</option>
                          <option value="anthropic">Anthropic</option>
                        </select>
                      </label>
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">接口地址</span>
                        <input
                          className="input h-7 text-[11.5px] w-full mt-1"
                          value={llmDraft.baseUrl}
                          placeholder="https://api.example.com/v1"
                          onChange={(event) => setLlmDraft({ ...llmDraft, baseUrl: event.target.value })}
                          onBlur={() => {
                            if (llmDraft.baseUrl.trim() !== llm.config.baseUrl) {
                              void patchLlm({ baseUrl: llmDraft.baseUrl.trim() })
                            }
                          }}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">模型名称</span>
                        <input
                          className="input h-7 text-[11.5px] w-full mt-1"
                          value={llmDraft.model}
                          placeholder="例如 gpt-4o-mini / qwen-vl-max"
                          onChange={(event) => setLlmDraft({ ...llmDraft, model: event.target.value })}
                          onBlur={() => {
                            if (llmDraft.model.trim() !== llm.config.model) {
                              void patchLlm({ model: llmDraft.model.trim() })
                            }
                          }}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">超时（秒）</span>
                        <input
                          type="number"
                          min={5}
                          max={300}
                          className="input h-7 text-[11.5px] w-full mt-1"
                          defaultValue={Math.round(llm.config.timeoutMs / 1000)}
                          onBlur={(event) => {
                            const seconds = Number(event.target.value)
                            if (Number.isFinite(seconds)) {
                              void patchLlm({ timeoutMs: Math.round(seconds * 1000) })
                            }
                          }}
                        />
                      </label>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">温度</span>
                        <input
                          type="number"
                          min={0}
                          max={2}
                          step={0.1}
                          className="input h-7 text-[11.5px] w-full mt-1"
                          defaultValue={llm.config.temperature}
                          onBlur={(event) => {
                            const value = Number(event.target.value)
                            if (Number.isFinite(value)) void patchLlm({ temperature: value })
                          }}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">最大输出 tokens</span>
                        <input
                          type="number"
                          min={16}
                          max={32000}
                          step={64}
                          className="input h-7 text-[11.5px] w-full mt-1"
                          defaultValue={llm.config.maxTokens}
                          onBlur={(event) => {
                            const value = Number(event.target.value)
                            if (Number.isFinite(value)) void patchLlm({ maxTokens: value })
                          }}
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10.5px] text-[var(--faint)]">失败重试</span>
                        <select
                          className="input h-7 text-[11.5px] w-full mt-1"
                          value={llm.config.maxRetries}
                          onChange={(event) => void patchLlm({ maxRetries: Number(event.target.value) })}
                        >
                          <option value={0}>不重试</option>
                          <option value={1}>1 次</option>
                          <option value={2}>2 次</option>
                          <option value={3}>3 次</option>
                        </select>
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="password"
                        className="input h-7 text-[11.5px] flex-1"
                        placeholder={llm.hasKey ? `已保存 ${llm.keyHint ?? ''}` : '粘贴 API Key'}
                        value={keyDraft}
                        onChange={(event) => setKeyDraft(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void saveLlmKey()
                        }}
                      />
                      <button
                        className="btn h-7 px-2 text-[11.5px]"
                        disabled={!keyDraft.trim() || keyBusy || llm.encryption === 'unavailable'}
                        onClick={() => void saveLlmKey()}
                      >
                        保存
                      </button>
                      {llm.hasKey && (
                        <button
                          className="btn btn-ghost h-7 px-2 text-[11.5px]"
                          disabled={keyBusy}
                          onClick={() => void clearLlmKey()}
                        >
                          清除
                        </button>
                      )}
                    </div>

                    {llm.encryption === 'unavailable' && (
                      <div className="text-[10.5px] leading-4 text-[var(--danger-text)]">
                        系统加密不可用，已拒绝保存明文密钥；请先在系统里启用凭据保护。
                      </div>
                    )}

                    <div className="flex items-center gap-2 pt-1">
                      <button
                        className="btn h-7 px-2 text-[11.5px]"
                        disabled={testing || !llm.config.enabled || !llm.hasKey || !llm.config.model}
                        onClick={() => void runLlmTest()}
                      >
                        {testing ? '测试中…' : '测试连接'}
                      </button>
                      {testResult && (
                        <span
                          className={`text-[10.5px] leading-4 ${
                            testResult.ok ? 'text-[var(--success)]' : 'text-[var(--danger-text)]'
                          }`}
                        >
                          {testResult.message}（{testResult.latencyMs} ms）
                        </span>
                      )}
                      {!testResult && llm.lastCall && (
                        <span className="ml-auto text-[10.5px] text-[var(--faint)]">
                          上次：{llm.lastCall.ok ? '成功' : '失败'} · {llm.lastCall.latencyMs} ms
                        </span>
                      )}
                    </div>

                    <div className="pt-1.5 border-t border-[var(--border)]">
                      <div className="text-[10.5px] text-[var(--faint)] mb-1.5">
                        单独开关（关掉后相册里的入口会隐藏，也不会发请求）
                      </div>
                      <div className="space-y-2">
                        {llm.capabilities.map((capability) => (
                          <div key={capability.id} className="flex items-start gap-2">
                            <div className="min-w-0">
                              <div className="text-[11.5px] text-[var(--text)]">
                                {capability.title}
                                {capability.maxItems ? (
                                  <span className="text-[10px] text-[var(--faint)]">
                                    {' '}
                                    · 一次最多 {capability.maxItems} 张
                                  </span>
                                ) : null}
                              </div>
                              <div className="text-[10px] leading-4 text-[var(--faint)]">
                                {capability.description}
                              </div>
                            </div>
                            <button
                              className={`ml-auto mt-0.5 w-[34px] h-[19px] rounded-full relative shrink-0 transition-colors ${
                                capability.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                              }`}
                              onClick={() =>
                                void patchLlm({
                                  capabilities: {
                                    ...llm.config.capabilities,
                                    [capability.id]: !capability.enabled
                                  }
                                })
                              }
                              aria-pressed={capability.enabled}
                              title={capability.enabled ? '关闭这个能力' : '开启这个能力'}
                            >
                              <span
                                className={`absolute top-[2px] w-[15px] h-[15px] rounded-full bg-white transition-all ${
                                  capability.enabled ? 'left-[17px]' : 'left-[2px]'
                                }`}
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                <div className="text-[11px] leading-4 text-[var(--faint)]">
                  支持 OpenAI 兼容接口（DeepSeek / Kimi / 通义 / 智谱 / Ollama）与 Anthropic。请求在主进程发出，
                  渲染层拿不到密钥与图片原始数据。
                </div>
              </>
            )}

            {tab === 'semantic' && (
              <>
                <div className="text-[12.5px]">语义模型</div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] divide-y divide-[var(--border)]">
                  {embeddingModels ? (
                    embeddingModels.map((model) => (
                      <div key={model.id} className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="text-[12.5px]">{model.label}</span>
                          {model.active && (
                            <span className="text-[9.5px] px-1.5 py-[1px] rounded border border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent-text)]">
                              使用中
                            </span>
                          )}
                          {!model.ready && (
                            <span className="text-[9.5px] px-1.5 py-[1px] rounded border border-[var(--border)] bg-[var(--panel)] text-[var(--faint)]">
                              未下载
                            </span>
                          )}
                          <span className="ml-auto text-[10.5px] text-[var(--faint)] tabular-nums">
                            {formatBytes(model.bytes)} · {model.dim} 维
                          </span>
                        </div>
                        <div className="text-[10.5px] text-[var(--faint)] mt-0.5 leading-4">
                          {model.note}
                        </div>
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[10.5px] text-[var(--faint)] tabular-nums">
                            已索引 {model.indexed}/{model.total}
                          </span>
                          <div className="ml-auto">
                            {model.active && model.ready ? null : model.ready ? (
                              <button
                                className="btn h-6 px-2 text-[11px]"
                                disabled={modelBusy !== null}
                                onClick={() => void useExistingModel(model)}
                              >
                                切换使用
                              </button>
                            ) : (
                              <button
                                className="btn h-6 px-2 text-[11px]"
                                disabled={modelBusy !== null}
                                onClick={() => void downloadAndSwitchModel(model)}
                              >
                                {modelBusy === model.id ? '下载中…' : '下载并使用'}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="px-3 py-2 text-[11px] text-[var(--faint)]">读取中…</div>
                  )}
                </div>
                {modelMsg && (
                  <div className="text-[10.5px] leading-4 text-[var(--accent-text)]">{modelMsg}</div>
                )}
                <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                  切换模型不会删除旧索引，但新模型需要重建语义索引才能搜图与自动分类。
                  SigLIP 2 的相似度分布和 Chinese-CLIP 不同，阈值要重新试跑；本地实测它的中文类目弱于
                  Chinese-CLIP，建议先小范围对比再决定。
                </div>

                <div className="mt-2 text-[12.5px]">语义索引</div>
                <div className="flex items-start gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="text-[12.5px]">闲时自动建立语义索引</div>
                    <div className="text-[10.5px] text-[var(--faint)] mt-0.5 leading-4">
                      电脑「插着电源」且空闲 2 分钟后才会开始，每批 16 张、跑完歇一会，你一操作就停；
                      索引只占用 2 个 CPU 线程，不会把机器占满。
                    </div>
                  </div>
                  <button
                    className={`ml-auto mt-0.5 w-[38px] h-[21px] rounded-full relative shrink-0 transition-colors ${
                      autoClip ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                    }`}
                    onClick={() => void toggleAutoClip()}
                    aria-pressed={Boolean(autoClip)}
                    disabled={autoClip === null}
                    title={autoClip ? '关闭闲时自动索引' : '开启闲时自动索引'}
                  >
                    <span
                      className={`absolute top-[2px] w-[17px] h-[17px] rounded-full bg-white transition-all ${
                        autoClip ? 'left-[19px]' : 'left-[2px]'
                      }`}
                    />
                  </button>
                </div>
                <div className="text-[11px] leading-4 text-[var(--faint)]">
                  手动点侧栏「语义索引」仍会一次性把剩余照片跑完，中断后可以再点一次继续。
                </div>

                <div className="mt-2 text-[12.5px]">AI 处理范围</div>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {[{ value: 0, label: '全部照片' }]
                      .concat([1, 2, 3, 4, 5].map((n) => ({ value: n, label: '★'.repeat(n) })))
                      .map((option) => {
                        const active = (scoreMinRating ?? 0) === option.value
                        return (
                          <button
                            key={option.value}
                            className={`h-[26px] px-2 rounded-md border text-[11.5px] transition-colors ${
                              active
                                ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                                : 'border-[var(--border)] bg-[var(--panel)] text-[var(--faint)]'
                            }`}
                            disabled={scoreBusy || scoreMinRating === null}
                            aria-pressed={active}
                            onClick={() => void changeScoreRating(option.value)}
                          >
                            {option.label}
                          </button>
                        )
                      })}
                  </div>
                  <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                    AI 只处理达到这个星级的照片，默认 ★★★；没标星的照片算不达标。选「全部照片」就不限星级。
                  </div>
                  <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                    范围内的照片才会出现 AI 评分、AI 后期建议和读片入口；不达标就把按钮藏起来，已有的评分和笔记照常能看。
                  </div>
                  <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                    当前有 {scoreCounts ? `${scoreCounts.matched} / ${scoreCounts.total} 张` : '读取中…'}在范围内
                    {`（星级：${scoreMinRating ? `≥ ${scoreMinRating} 星` : '不限'}；文件夹：${
                      (scopeFolders ?? []).length > 0 ? `${(scopeFolders ?? []).length} 个` : '全部'
                    }）`}
                  </div>

                  <div className="mt-1 text-[10.5px] leading-4 text-[var(--faint)]">文件夹范围</div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      className={`h-[26px] px-2 rounded-md border text-[11.5px] transition-colors ${
                        (scopeFolders ?? []).length === 0
                          ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                          : 'border-[var(--border)] bg-[var(--panel)] text-[var(--faint)]'
                      }`}
                      onClick={() => void changeScopeFolders([])}
                      disabled={scopeFolders === null}
                    >
                      全部文件夹
                    </button>
                    {folders.map((folder) => {
                      const active = (scopeFolders ?? []).includes(folder.id)
                      return (
                        <button
                          key={folder.id}
                          className={`h-[26px] px-2 rounded-md border text-[11.5px] transition-colors ${
                            active
                              ? 'border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--text)]'
                              : 'border-[var(--border)] bg-[var(--panel)] text-[var(--faint)]'
                          }`}
                          onClick={() => void changeScopeFolders(toggleFolder(folder.id))}
                          disabled={scopeFolders === null}
                          title={`${folder.name} · ${folder.count} 张`}
                        >
                          {folder.name}
                        </button>
                      )
                    })}
                    {folders.length === 0 && (
                      <span className="text-[10.5px] text-[var(--faint)]">
                        还没有文件夹。先在左侧新建文件夹，就能在这里限定范围
                      </span>
                    )}
                  </div>
                  <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                    不选就是所有文件夹；选了以后，只有这些文件夹里的照片能用到 AI。
                  </div>
                </div>
              </>
            )}

            {tab === 'storage' && (
              <>
                <div className="text-[12.5px]">索引与缓存</div>
                {!storage ? (
                  <div className="text-[11px] text-[var(--faint)]">读取中…</div>
                ) : (
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 space-y-2">
                    <div>
                      <div className="text-[10.5px] text-[var(--faint)]">图库目录（原图所在）</div>
                      <div className="text-[11px] leading-4 break-all text-[var(--text)]">{storage.library}</div>
                    </div>
                    <div>
                      <div className="text-[10.5px] text-[var(--faint)]">
                        索引与缓存（library.db、缩略图、预览）
                      </div>
                      <div className="text-[11px] leading-4 break-all text-[var(--text)]">{storage.indexDir}</div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        className="btn h-7 px-2 text-[11.5px]"
                        disabled={indexBusy}
                        onClick={() => void moveIndex(undefined)}
                        title="把 library.db 与缩略图缓存搬到别的文件夹，原图不动"
                      >
                        {indexBusy ? '移动中…' : '更改位置…'}
                      </button>
                      {storage.indexDir !== storage.library && (
                        <button
                          className="btn btn-ghost h-7 px-2 text-[11.5px]"
                          disabled={indexBusy}
                          onClick={() => void moveIndex(null)}
                        >
                          放回图库目录
                        </button>
                      )}
                    </div>
                    <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                      只移动索引与缩略图，原图始终留在图库目录。索引较大时需要等一会儿，期间别关闭程序。
                    </div>
                    {indexMsg && (
                      <div className="text-[10.5px] leading-4 text-[var(--accent-text)]">{indexMsg}</div>
                    )}
                  </div>
                )}

                <div className="mt-1">
                  <div className="text-[12.5px] mb-2">缩略图缓存</div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 space-y-2">
                    {!thumbStats ? (
                      <div className="text-[11px] text-[var(--faint)]">统计中…</div>
                    ) : (
                      <>
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            { label: '低 260px', data: thumbStats.low },
                            { label: '中 720px', data: thumbStats.mid },
                            { label: '高 1440px', data: thumbStats.high }
                          ].map(({ label, data }) => (
                            <div key={label}>
                              <div className="text-[10.5px] text-[var(--faint)]">{label}</div>
                              <div className="text-[11.5px] text-[var(--text)] tabular-nums">
                                {formatBytes(data.bytes)}
                              </div>
                              <div className="text-[10px] text-[var(--faint)] tabular-nums">{data.count} 张</div>
                            </div>
                          ))}
                        </div>
                        <div className="flex items-center gap-2 pt-0.5">
                          <span className="text-[11px] text-[var(--muted)]">高清上限</span>
                          <select
                            className="input h-7 px-1.5 text-[11.5px] ml-auto"
                            value={thumbLimit ?? THUMB_CACHE_LIMIT_DEFAULT}
                            onChange={(e) => void changeLimit(Number(e.target.value))}
                            disabled={limitBusy || thumbLimit === null}
                            title="超过上限时自动删最久没看的高清图"
                          >
                            {THUMB_CACHE_LIMIT_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <button
                            className="btn h-7 px-2 text-[11.5px]"
                            disabled={thumbBusy || thumbStats.high.count === 0}
                            onClick={() => void clearThumbs('high')}
                            title="只删 1440px 那档，日常浏览不受影响"
                          >
                            {thumbBusy ? '清理中…' : '清理高清缓存'}
                          </button>
                          <button
                            className="btn btn-ghost h-7 px-2 text-[11.5px]"
                            disabled={thumbBusy}
                            onClick={() => void clearThumbs('all')}
                            title="三档全删，之后按需重新生成"
                          >
                            全部重建
                          </button>
                        </div>
                        <div className="text-[10.5px] leading-4 text-[var(--faint)]">
                          高清档是「自动」清晰度按需生成的，清掉它最划算；清完后正在看的画面会重新生成。
                          超过上限时自动淘汰最久没看的高清图，中/低档不动。想长期省磁盘，先把清晰度锁成
                          「低」或「中」再清。「全部重建」连中/低档一起删，大图库首次滚动会明显变慢。原图始终不动。
                        </div>
                        {thumbMsg && (
                          <div className="text-[10.5px] leading-4 text-[var(--accent-text)]">{thumbMsg}</div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-1">
                  <div className="mb-2 flex items-center gap-1.5 text-[12.5px]">
                    <FileText size={13} /> XMP 侧车
                  </div>
                  <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5">
                    {!xmp ? (
                      <div className="text-[11px] text-[var(--faint)]">读取中…</div>
                    ) : (
                      <>
                        <div className="flex items-start gap-2">
                          <div className="min-w-0">
                            <div className="text-[12px]">启用 XMP 侧车</div>
                            <div className="mt-0.5 text-[10.5px] leading-4 text-[var(--faint)]">
                              把星级、旗标、标签、短备注写到原图旁边的 .xmp；只写人的判断，不写 AI
                              评分。默认关闭。
                            </div>
                          </div>
                          <button
                            className={`relative ml-auto mt-0.5 h-[21px] w-[38px] shrink-0 rounded-full transition-colors ${
                              xmp.enabled ? 'bg-[var(--accent)]' : 'bg-[var(--border-strong)]'
                            }`}
                            onClick={() => void changeXmp({ enabled: !xmp.enabled })}
                            aria-pressed={xmp.enabled}
                            title={xmp.enabled ? '关闭 XMP 侧车' : '开启 XMP 侧车'}
                          >
                            <span
                              className={`absolute top-[2px] h-[17px] w-[17px] rounded-full bg-white transition-all ${
                                xmp.enabled ? 'left-[19px]' : 'left-[2px]'
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex items-start gap-2 border-t border-[var(--border)] pt-2">
                          <div className="min-w-0">
                            <div className="text-[12px]">忽略外部修改</div>
                            <div className="mt-0.5 text-[10.5px] leading-4 text-[var(--faint)]">
                              Lightroom 等软件改过侧车时不再提示导入，月相保持自己的判断。
                            </div>
                          </div>
                          <button
                            className={`relative ml-auto mt-0.5 h-[21px] w-[38px] shrink-0 rounded-full transition-colors ${
                              xmp.ignoreExternal
                                ? 'bg-[var(--accent)]'
                                : 'bg-[var(--border-strong)]'
                            } ${xmp.enabled ? '' : 'opacity-40'}`}
                            onClick={() =>
                              void changeXmp({ ignoreExternal: !xmp.ignoreExternal })
                            }
                            aria-pressed={xmp.ignoreExternal}
                            disabled={!xmp.enabled}
                            title={xmp.ignoreExternal ? '恢复外部修改提示' : '忽略外部修改'}
                          >
                            <span
                              className={`absolute top-[2px] h-[17px] w-[17px] rounded-full bg-white transition-all ${
                                xmp.ignoreExternal ? 'left-[19px]' : 'left-[2px]'
                              }`}
                            />
                          </button>
                        </div>

                        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-2">
                          <button
                            className="btn h-7 px-2 text-[11.5px]"
                            disabled={xmpBusy}
                            onClick={() => void exportAllXmp()}
                            title="为所有照片生成 .xmp，用于迁移到 Lightroom 等软件"
                          >
                            导出全部 XMP
                          </button>
                          <button
                            className="btn btn-ghost h-7 px-2 text-[11.5px]"
                            disabled={xmpBusy || !xmp.enabled}
                            onClick={() => void checkXmp()}
                            title="对比侧车 mtime，导入外部软件的修改"
                          >
                            检查外部修改
                          </button>
                          <span className="text-[10px] text-[var(--faint)]">
                            开启后导入新照片会读取同名 XMP
                          </span>
                        </div>

                        {xmpProgress && (
                          <div>
                            <div className="flex items-center justify-between text-[10.5px] text-[var(--faint)]">
                              <span>
                                {xmpProgress.phase === 'write'
                                  ? '正在写 XMP'
                                  : '正在检查外部修改'}
                              </span>
                              <span className="tabular-nums">
                                {xmpProgress.done}/{xmpProgress.total}
                              </span>
                            </div>
                            <div className="mt-1 h-[4px] overflow-hidden rounded-full bg-[var(--panel-3)]">
                              <div
                                className="h-full bg-[var(--accent)] transition-[width] duration-200"
                                style={{
                                  width: `${
                                    xmpProgress.total
                                      ? Math.round((xmpProgress.done / xmpProgress.total) * 100)
                                      : 0
                                  }%`
                                }}
                              />
                            </div>
                            <div className="mt-1 truncate text-[10px] text-[var(--faint)]">
                              {xmpProgress.current}
                            </div>
                          </div>
                        )}

                        {xmpMsg && (
                          <div className="text-[10.5px] leading-4 text-[var(--accent-text)]">
                            {xmpMsg}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
