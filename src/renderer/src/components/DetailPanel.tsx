import { X } from 'lucide-react'
import type { Folder, Item, Tag } from '@shared/types'
import PhotoInspector from './inspector/PhotoInspector'
import type { PushUndo } from './inspector/ui'

interface DetailPanelProps {
  item: Item
  tags: Tag[]
  folders: Folder[]
  onClose: () => void
  onRefresh: () => void
  onOpenLightbox: () => void
  onPushUndo: PushUndo
  onUnstack: (stackId: number) => void
  onFindSimilar: () => void
  onAdvice: () => void
  onScore: () => void
  aiScoring: boolean
  /** 大模型总开关是否就绪；没就绪时相册里不出现任何 AI 入口 */
  aiReady: boolean
  /** 能力级开关：只有总开关就绪且该能力开启时才渲染入口 */
  canScore: boolean
  canAdvice: boolean
  /** 读片对话能力是否开启 */
  canStudy: boolean
}

export default function DetailPanel({
  item,
  tags,
  folders,
  onClose,
  onRefresh,
  onOpenLightbox,
  onPushUndo,
  onUnstack,
  onFindSimilar,
  onAdvice,
  onScore,
  aiScoring,
  aiReady,
  canScore,
  canAdvice,
  canStudy
}: DetailPanelProps) {
  return (
    <aside
      className="flex min-h-0 shrink-0 flex-col overflow-x-hidden border-l border-[var(--border)] bg-[var(--panel)]"
      style={{ width: 'var(--detail-w, 320px)' }}
    >
      <div className="flex h-[42px] shrink-0 items-center gap-2 border-b border-[var(--border)] px-3">
        <div className="truncate text-[12.5px] font-medium" title={item.name}>
          {item.name}
        </div>
        <button className="btn btn-ghost ml-auto h-6 px-1.5" onClick={onClose} title="关闭">
          <X size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1">
        <PhotoInspector
          item={item}
          host="library"
          showPreview
          info={{
            tags,
            folders,
            onRefresh,
            onPushUndo,
            onOpenLightbox,
            onFindSimilar,
            onUnstack
          }}
          perf={
            aiReady && (canScore || canAdvice)
              ? { aiScoring, canScore, canAdvice, onScore, onAdvice }
              : undefined
          }
          facet={{ onChanged: onRefresh }}
          study={{ aiReady, canAsk: canStudy }}
        />
      </div>
    </aside>
  )
}
