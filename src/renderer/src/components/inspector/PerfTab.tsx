import { Gauge, Sparkles } from 'lucide-react'
import type { Item } from '@shared/types'
import { formatDate, scoreColor } from '../../lib/format'
import { Section } from './ui'

export interface PerfTabProps {
  item: Item
  aiScoring: boolean
  canScore: boolean
  canAdvice: boolean
  /** 这张不在 AI 处理范围内：不渲染任何 AI 按钮，只说明原因 */
  scopeBlocked?: boolean
  scopeHint?: string
  onScore: () => void
  onAdvice: () => void
}

export default function PerfTab({
  item,
  aiScoring,
  canScore,
  canAdvice,
  scopeBlocked = false,
  scopeHint = '',
  onScore,
  onAdvice
}: PerfTabProps) {
  return (
    <div className="p-3">
      {item.quality ? (
        <Section title="AI 评分">
          <div className="flex items-baseline gap-1.5">
            <span
              className="text-[22px] font-semibold leading-none tabular-nums"
              style={{ color: scoreColor(item.quality.overall) }}
            >
              {item.quality.overall}
            </span>
            <span className="text-[10.5px] text-[var(--faint)]">/ 100</span>
          </div>
          <div className="mt-2 space-y-1.5">
            {(
              [
                ['构图', item.quality.composition],
                ['曝光', item.quality.exposure],
                ['色彩', item.quality.color],
                ['清晰度', item.quality.sharpness]
              ] as Array<[string, number]>
            ).map(([label, value]) => (
              <div key={label} className="flex items-center gap-2">
                <span className="w-[42px] shrink-0 text-[10.5px] text-[var(--faint)]">{label}</span>
                <span className="h-[4px] flex-1 overflow-hidden rounded-full bg-[var(--panel-2)]">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.max(0, Math.min(100, value))}%`,
                      background: scoreColor(value)
                    }}
                  />
                </span>
                <span className="w-[22px] shrink-0 text-right text-[10.5px] tabular-nums text-[var(--muted)]">
                  {value}
                </span>
              </div>
            ))}
          </div>
          {item.quality.comment && (
            <div className="mt-2 text-[11px] leading-4 text-[var(--muted)]">
              {item.quality.comment}
            </div>
          )}
          <div className="mt-1.5 text-[10px] leading-4 text-[var(--faint)]">
            {item.quality.model || '未知模型'} · {formatDate(item.quality.updatedAt)}
          </div>
        </Section>
      ) : (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-3 text-[11.5px] leading-5 text-[var(--faint)]">
          这张还没有 AI 评分。
        </div>
      )}

      {scopeBlocked ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-2.5 py-2 text-[10.5px] leading-4 text-[var(--faint)]">
          {scopeHint || '这张不在「AI 处理范围」内'}，所以这里不显示 AI 评分和后期建议。想用的话，去「设置 → 语义索引 → AI 处理范围」放宽条件。
        </div>
      ) : (
        (canScore || canAdvice) && (
          <div className={`mt-3 grid gap-1.5 ${canScore && canAdvice ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {canScore && (
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={onScore}
                disabled={aiScoring}
                title="用大模型评估构图、曝光、色彩、清晰度，结果存进图库（会消耗 token）"
              >
                <Gauge size={12} color="var(--accent-2)" />
                {aiScoring ? '评分中…' : item.quality ? '重新评分' : 'AI 评分'}
              </button>
            )}
            {canAdvice && (
              <button
                className="btn h-7 px-2 text-[11.5px]"
                onClick={onAdvice}
                title="让大模型给出修图方向、参数调整与风格参考（会消耗 token）"
              >
                <Sparkles size={12} color="var(--accent-2)" /> AI 后期建议
              </button>
            )}
          </div>
        )
      )}

      <div className="mt-3 text-[10px] leading-4 text-[var(--faint)]">
        评分和评语只存在月相里，不会写进 XMP；写进照片旁边的是你自己打的星级、旗标和标签。
      </div>
    </div>
  )
}
