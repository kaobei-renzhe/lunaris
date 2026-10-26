import { useEffect, useState } from 'react'
import {
  Check,
  Cpu,
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
import type { LibraryStorage, ThemeMode } from '@shared/types'
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
  onClose: () => void
  /** 打开时默认停在哪个分类（AI 弹窗的「去设置」直接落到大模型） */
  initialTab?: SettingsTab
}

const TABS: Array<{ id: SettingsTab; label: string; hint: string; Icon: typeof Monitor }> = [
  { id: 'appearance', label: '外观', hint: '主题与界面风格', Icon: Palette },
  { id: 'llm', label: '大模型', hint: '服务商、密钥、能力开关', Icon: Sparkles },
  { id: 'semantic', label: '语义索引', hint: '闲时自动建立向量索引', Icon: Cpu },
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
  onClose,
  initialTab = 'appearance'
}: SettingsDialogProps) {
  const [tab, setTab] = useState<SettingsTab>(initialTab)
  const [saving, setSaving] = useState(false)
  const [skinSaving, setSkinSaving] = useState(false)
  const [autoClip, setAutoClip] = useState<boolean | null>(null)
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

  useEffect(() => {
    void window.api
      .getClipAutoIndex()
      .then(setAutoClip)
      .catch(() => setAutoClip(true))
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
  }, [])

  const limitLabel = (mb: number): string =>
    THUMB_CACHE_LIMIT_OPTIONS.find((option) => option.value === mb)?.label ?? `${mb} MB`

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
                          只有你在相册里点 AI 按钮时才会调用，每次都会消耗服务商的 token 额度。
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
                <div className="text-[12.5px]">语义索引</div>
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
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
