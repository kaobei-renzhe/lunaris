import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  BookOpen,
  Crop,
  Loader2,
  MessageSquare,
  Send,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type {
  Item,
  NoteMode,
  NoteRegion,
  NoteThread,
  PhotoNote,
  SocraticReply,
  SocraticTurn
} from '@shared/types'
import { formatDate } from '../../lib/format'
import { llmHint } from '../../lib/llmHint'

export interface StudyTabProps {
  item: Item
  compact?: boolean
  /** 大模型总开关就绪 */
  aiReady?: boolean
  /** 读片对话能力是否开启 */
  canAsk?: boolean
  /** 这张不在 AI 处理范围内：隐藏所有 AI 入口，只留手工笔记 */
  scopeBlocked?: boolean
  scopeHint?: string
  /** 灯箱用：把最新线程同步出去，圈选层跟着增删刷新 */
  onNotesChange?: (threads: NoteThread[]) => void
  /** 灯箱用：已框好、还没提交的区域 */
  region?: NoteRegion | null
  /** 灯箱用：是否正在框选 */
  drawing?: boolean
  onRegionChange?: (region: NoteRegion | null) => void
  onDrawingChange?: (next: boolean) => void
  /** 灯箱用：点了图上的框要定位到哪条线程（根笔记 id） */
  focusThreadId?: number | null
  onThreadFocused?: () => void
}

const KIND_LABEL: Record<PhotoNote['kind'], string> = {
  question: '提问',
  answer: '回答',
  insight: '提炼',
  intent: '意图',
  tech: '技法'
}

function noteKindLabel(note: PhotoNote): string {
  if (note.author === 'ai') return note.kind === 'answer' ? '解释' : '反问'
  return KIND_LABEL[note.kind]
}

function modeLabel(mode: NoteMode): string {
  return mode === 'study' ? '研读' : '复盘'
}

function errorText(error: unknown): string {
  return String((error as Error)?.message ?? error)
    .replace(/^Error invoking remote method '[^']+':\s*/, '')
    .replace(/^Error:\s*/, '')
}

function threadHistory(thread: NoteThread): SocraticTurn[] {
  return [
    { role: 'me', text: thread.root.body },
    ...thread.replies.map((note) => ({ role: note.author, text: note.body }))
  ]
}

export default function StudyTab({
  item,
  compact,
  aiReady = false,
  canAsk = false,
  scopeBlocked = false,
  scopeHint = '',
  onNotesChange,
  region = null,
  drawing = false,
  onRegionChange,
  onDrawingChange,
  focusThreadId = null,
  onThreadFocused
}: StudyTabProps) {
  const [threads, setThreads] = useState<NoteThread[] | null>(null)
  /** 线程卡片，点圈选框时要把对应的滚进视野 */
  const cardRefs = useRef(new Map<number, HTMLDivElement>())
  const [flashId, setFlashId] = useState<number | null>(null)
  const [mode, setMode] = useState<NoteMode>(item.reference === 1 ? 'study' : 'review')
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [aiError, setAiError] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiThreadId, setAiThreadId] = useState<number | null>(null)
  const [followFor, setFollowFor] = useState<number | null>(null)
  const [followDraft, setFollowDraft] = useState('')
  const [followBusy, setFollowBusy] = useState(false)

  // 参考片默认研读，自己的片子默认复盘；换照片/改标记时回到对应默认
  useEffect(() => {
    setMode(item.reference === 1 ? 'study' : 'review')
    setDraft('')
    setFollowFor(null)
    setFollowDraft('')
    setAiError('')
  }, [item.id, item.reference])

  const load = useCallback(async (): Promise<void> => {
    try {
      const list = await window.api.notes.list(item.id)
      setThreads(list)
      onNotesChange?.(list)
      setError('')
    } catch (err) {
      setThreads([])
      onNotesChange?.([])
      setError(`读取笔记失败：${errorText(err)}`)
    }
  }, [item.id, onNotesChange])

  useEffect(() => {
    setThreads(null)
    void load()
  }, [load])

  // 从图上的框跳过来：滚到对应线程并闪一下，然后让灯箱把焦点清掉
  useEffect(() => {
    if (!focusThreadId || !threads) return
    const card = cardRefs.current.get(focusThreadId)
    if (card) {
      card.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      setFlashId(focusThreadId)
    }
    onThreadFocused?.()
  }, [focusThreadId, threads, onThreadFocused])

  useEffect(() => {
    if (flashId === null) return
    const timer = setTimeout(() => setFlashId(null), 1600)
    return () => clearTimeout(timer)
  }, [flashId])

  const ordered = useMemo(
    () => [...(threads ?? [])].sort((a, b) => b.root.createdAt - a.root.createdAt),
    [threads]
  )

  const submit = async (): Promise<void> => {
    const body = draft.trim()
    if (!body || busy || aiBusy) return
    setBusy(true)
    setError('')
    setAiError('')
    try {
      await window.api.notes.create({
        itemId: item.id,
        kind: 'question',
        mode,
        body,
        author: 'me',
        region: region ?? null
      })
      setDraft('')
      // 区域已经跟着笔记落库了，灯箱上的待提交虚线框该收了，免得和实线框叠在一起
      if (region) onRegionChange?.(null)
      await load()
    } catch (err) {
      setError(`保存笔记失败：${errorText(err)}`)
    } finally {
      setBusy(false)
    }
  }

  const askAi = async (args: {
    question: string
    parentId: number | null
    thread: NoteThread | null
    mode: NoteMode
    region: NoteRegion | null
    skip: boolean
  }): Promise<void> => {
    const question = args.question.trim()
    if (!question || aiBusy) return
    setAiBusy(true)
    setAiThreadId(args.thread?.root.id ?? null)
    setAiError('')
    setError('')
    const isRoot = args.parentId === null
    try {
      // 历史必须在保存本轮问题之前取，否则同一句会进两次上下文
      const history = args.thread ? threadHistory(args.thread) : []
      const userNote = await window.api.notes.create({
        itemId: item.id,
        parentId: args.parentId,
        kind: 'question',
        mode: args.mode,
        body: question,
        author: 'me',
        // 区域只挂在根笔记上：一个线程一个框，追问沿用这个框
        region: isRoot ? args.region : null
      })
      if (isRoot && args.region) onRegionChange?.(null)

      const outcome = await window.api.llmRun('photo.socratic', {
        itemId: item.id,
        question,
        history,
        mode: args.mode,
        region: args.region,
        skipSocratic: args.skip
      })
      if (!outcome.ok) {
        setAiError(llmHint(outcome.code, outcome.message))
        await load()
        return
      }

      const reply = outcome.data as SocraticReply
      await window.api.notes.create({
        itemId: item.id,
        parentId: args.parentId ?? userNote.id,
        kind: reply.stage === 'probe' ? 'question' : 'answer',
        mode: args.mode,
        body: reply.text,
        author: 'ai'
      })
      await load()
    } catch (err) {
      setAiError(`AI 反问失败：${errorText(err)}`)
      await load()
    } finally {
      setAiBusy(false)
      setAiThreadId(null)
    }
  }

  const submitWithAi = async (skip: boolean): Promise<void> => {
    const body = draft.trim()
    if (!body || aiBusy) return
    setDraft('')
    await askAi({ question: body, parentId: null, thread: null, mode, region, skip })
  }

  const submitFollow = async (thread: NoteThread): Promise<void> => {
    const body = followDraft.trim()
    if (!body || followBusy || aiBusy) return
    setFollowBusy(true)
    setError('')
    setAiError('')
    try {
      await window.api.notes.create({
        itemId: item.id,
        parentId: thread.root.id,
        kind: 'question',
        mode: thread.root.mode,
        body,
        author: 'me'
      })
      setFollowDraft('')
      setFollowFor(null)
      await load()
    } catch (err) {
      setError(`保存追问失败：${errorText(err)}`)
    } finally {
      setFollowBusy(false)
    }
  }

  const submitFollowWithAi = async (thread: NoteThread, skip: boolean): Promise<void> => {
    const body = followDraft.trim()
    if (!body || aiBusy) return
    setFollowDraft('')
    setFollowFor(null)
    await askAi({
      question: body,
      parentId: thread.root.id,
      thread,
      mode: thread.root.mode,
      // 追问沿用这个线程自己的框；没有就用当前框选的
      region: thread.root.region ?? region ?? null,
      skip
    })
  }

  const remove = async (thread: NoteThread): Promise<void> => {
    const ok = await window.api.confirm(
      '删除这条研读笔记？',
      '下面的追问会一起删除，不会影响照片、标签和备注。'
    )
    if (!ok) return
    try {
      await window.api.notes.remove(thread.root.id)
      await load()
    } catch (err) {
      setError(`删除失败：${errorText(err)}`)
    }
  }

  const aiAvailable = aiReady && canAsk && !scopeBlocked
  const rootThinking = aiBusy && aiThreadId === null

  return (
    <div className={compact ? 'space-y-2.5 p-2.5' : 'space-y-3 p-3'}>
      <div className="flex items-center gap-1">
        <span className="text-[10.5px] text-[var(--faint)]">模式</span>
        <div className="ml-auto flex rounded-md border border-[var(--border)] p-0.5">
          {(['study', 'review'] as NoteMode[]).map((entry) => (
            <button
              key={entry}
              className={`h-6 rounded px-2 text-[10.5px] transition-colors ${
                mode === entry
                  ? 'bg-[var(--accent-soft)] text-[var(--accent-text)]'
                  : 'text-[var(--faint)] hover:text-[var(--text)]'
              }`}
              onClick={() => setMode(entry)}
              title={entry === 'study' ? '学别人怎么拍' : '复盘自己的片子'}
            >
              {modeLabel(entry)}
            </button>
          ))}
        </div>
      </div>

      <div className="text-[10px] leading-4 text-[var(--faint)]">
        {!aiReady
          ? '大模型未启用，仍可手工记笔记；到「设置 → 大模型」配置后就能让老师反问。'
          : scopeBlocked
            ? `${scopeHint || '这张不在「AI 处理范围」内'}，AI 对话不可用；手工记笔记不受影响。`
            : !canAsk
              ? '读片对话能力已关闭，仍可手工记笔记。'
              : 'AI 会先反问，最多两轮；也可以直接让它给答案。'}
      </div>

      {error && (
        <div className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-soft)] px-2.5 py-2 text-[10.5px] leading-4 text-[var(--danger-text)]">
          {error}
        </div>
      )}
      {aiError && (
        <div className="rounded-lg border border-[var(--warn)]/40 bg-[var(--panel-2)] px-2.5 py-2 text-[10.5px] leading-4 text-[var(--warn)]">
          <div className="flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            <span>{aiError}</span>
          </div>
        </div>
      )}

      {threads === null ? (
        <div className="py-6 text-center text-[11px] text-[var(--faint)]">读取笔记…</div>
      ) : ordered.length === 0 ? (
        <div className="grid place-items-center rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-7 text-center">
          <div>
            <BookOpen size={22} className="mx-auto mb-1.5 text-[var(--faint)] opacity-60" />
            <div className="text-[11.5px] text-[var(--muted)]">还没有研读笔记</div>
            <div className="mt-1 text-[10px] leading-4 text-[var(--faint)]">
              在下面写第一条：这块为什么吸引你、用了什么手法、下次怎么用。
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-2.5">
          {ordered.map((thread) => {
            // 只数反问轮次；「直接给答案」的那条是解释，不该占用 2 轮配额
            const aiTurns = thread.replies.filter(
              (note) => note.author === 'ai' && note.kind === 'question'
            ).length
            const thinking = aiBusy && aiThreadId === thread.root.id
            return (
              <div
                key={thread.root.id}
                ref={(el) => {
                  if (el) cardRefs.current.set(thread.root.id, el)
                  else cardRefs.current.delete(thread.root.id)
                }}
                className={`rounded-lg border bg-[var(--panel-2)] px-2.5 py-2 ${
                  flashId === thread.root.id
                    ? 'border-[var(--accent)] shadow-[0_0_0_2px_var(--accent-soft)]'
                    : 'border-[var(--border)]'
                }`}
              >
                <div className="flex items-center gap-1.5 text-[9.5px] text-[var(--faint)]">
                  <span className="rounded bg-[var(--accent-soft)] px-1 py-0.5 text-[var(--accent-text)]">
                    {modeLabel(thread.root.mode)}
                  </span>
                  <span>{noteKindLabel(thread.root)}</span>
                  {thread.root.region && <span>· 框选区域</span>}
                  {aiTurns > 0 && <span>· 反问 {Math.min(aiTurns, 2)}/2</span>}
                  <span className="ml-auto tabular-nums">{formatDate(thread.root.createdAt)}</span>
                  <button
                    className="grid h-5 w-5 place-items-center rounded text-[var(--faint)] hover:bg-[var(--panel)] hover:text-[var(--danger-text)]"
                    onClick={() => void remove(thread)}
                    title="删除这条笔记"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>

                <div className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-5 text-[var(--text)]">
                  {thread.root.body}
                </div>

                {thread.replies.length > 0 && (
                  <div className="mt-2 space-y-1.5 border-l border-[var(--border)] pl-2">
                    {thread.replies.map((reply) => (
                      <div key={reply.id}>
                        <div className="flex items-center gap-1 text-[9px] text-[var(--faint)]">
                          <span className={reply.author === 'ai' ? 'text-[var(--accent-2)]' : ''}>
                            {reply.author === 'ai' ? 'AI' : '我'}
                          </span>
                          <span>{noteKindLabel(reply)}</span>
                          <span className="ml-auto tabular-nums">{formatDate(reply.createdAt)}</span>
                        </div>
                        <div
                          className={`mt-0.5 whitespace-pre-wrap text-[11px] leading-4 ${
                            reply.author === 'ai'
                              ? 'text-[var(--accent-text)]'
                              : 'text-[var(--text)]'
                          }`}
                        >
                          {reply.body}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {thinking && (
                  <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[var(--muted)]">
                    <Loader2 size={11} className="animate-spin" /> 老师正在想…
                  </div>
                )}

                {followFor === thread.root.id ? (
                  <div className="mt-2">
                    <textarea
                      className="input h-[48px] w-full resize-none py-1.5 text-[11px] leading-5"
                      placeholder="继续追问，或补一句自己的观察…"
                      value={followDraft}
                      autoFocus
                      onChange={(event) => setFollowDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                          event.preventDefault()
                          void submitFollow(thread)
                        }
                      }}
                    />
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      <button
                        className="btn h-6 px-2 text-[10.5px]"
                        disabled={followBusy || aiBusy || !followDraft.trim()}
                        onClick={() => void submitFollow(thread)}
                      >
                        记下
                      </button>
                      {aiAvailable && (
                        <>
                          <button
                            className="btn h-6 px-2 text-[10.5px]"
                            disabled={aiBusy || !followDraft.trim()}
                            onClick={() => void submitFollowWithAi(thread, false)}
                          >
                            <Sparkles size={11} /> 问 AI
                          </button>
                          <button
                            className="btn btn-ghost h-6 px-2 text-[10.5px]"
                            disabled={aiBusy || !followDraft.trim()}
                            onClick={() => void submitFollowWithAi(thread, true)}
                          >
                            直接给答案
                          </button>
                        </>
                      )}
                      <button
                        className="btn btn-ghost ml-auto h-6 px-1.5"
                        onClick={() => {
                          setFollowFor(null)
                          setFollowDraft('')
                        }}
                        title="取消"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--faint)] hover:text-[var(--text)]"
                    onClick={() => {
                      setFollowFor(thread.root.id)
                      setFollowDraft('')
                    }}
                  >
                    <MessageSquare size={11} /> 追问
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}

      <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] p-2">
        {(onDrawingChange || region) && (
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5">
            {onDrawingChange && (
              <button
                className={`btn h-6 px-2 text-[10.5px] ${
                  drawing ? 'border-[var(--accent)] text-[var(--accent-2)]' : ''
                }`}
                onClick={() => onDrawingChange(!drawing)}
                title="在图上拖拽圈出一块区域，提问时带上它"
              >
                <Crop size={11} /> {drawing ? '在图上框选…' : '框选区域'}
              </button>
            )}
            {region ? (
              <span className="flex items-center gap-1 text-[10px] text-[var(--accent-text)]">
                已框选一块区域 · {Math.round(region.w * 100)}% × {Math.round(region.h * 100)}%
                <button
                  className="grid h-5 w-5 place-items-center rounded text-[var(--faint)] hover:bg-[var(--panel)] hover:text-[var(--text)]"
                  onClick={() => onRegionChange?.(null)}
                  title="清除框选"
                >
                  <X size={11} />
                </button>
              </span>
            ) : (
              !drawing && <span className="text-[10px] text-[var(--faint)]">不框就按整张图提问</span>
            )}
          </div>
        )}
        <textarea
          className="input h-[70px] w-full resize-none py-1.5 text-[11.5px] leading-5"
          placeholder={
            mode === 'study'
              ? '从这张图里看到了什么？想学哪一手？'
              : '当时想拍成什么样？哪里没做到？'
          }
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void submit()
            }
          }}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[9.5px] text-[var(--faint)]">Ctrl + Enter 保存</span>
          <div className="ml-auto flex flex-wrap items-center gap-1">
            <button
              className="btn h-7 px-2 text-[10.5px]"
              disabled={busy || aiBusy || !draft.trim()}
              onClick={() => void submit()}
            >
              <Send size={11} /> {busy ? '保存中…' : '记下来'}
            </button>
            {aiAvailable && (
              <>
                <button
                  className="btn h-7 px-2 text-[10.5px]"
                  disabled={aiBusy || !draft.trim()}
                  onClick={() => void submitWithAi(false)}
                  title="让老师先反问，最多两轮"
                >
                  {rootThinking ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : (
                    <Sparkles size={11} />
                  )}
                  {rootThinking ? '老师思考中…' : 'AI 反问'}
                </button>
                <button
                  className="btn btn-ghost h-7 px-2 text-[10.5px]"
                  disabled={aiBusy || !draft.trim()}
                  onClick={() => void submitWithAi(true)}
                  title="跳过反问，直接给答案"
                >
                  直接告诉我
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      <div className="text-[9.5px] leading-4 text-[var(--faint)]">
        {aiAvailable
          ? 'AI 会先反问，最多两轮；也可以直接要答案。手工笔记和 AI 回复都存在同一个线程里。'
          : '现在写的是纯文字笔记，不依赖大模型。'}
      </div>
    </div>
  )
}
