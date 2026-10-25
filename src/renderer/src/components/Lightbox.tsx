import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'
import { ChevronLeft, ChevronRight, Minus, Plus, RotateCcw, RotateCw, X } from 'lucide-react'
import type { Item } from '@shared/types'
import { photoUrl } from '../lib/format'

interface LightboxProps {
  items: Item[]
  index: number
  onClose: () => void
  onNavigate: (index: number) => void
}

/** 适应窗口时四周留出的边距 */
const FIT_PADDING = 48
/** 相对原图的最大放大倍率（按屏幕物理像素算，8 倍已经能看清单个像素） */
const MAX_ZOOM = 8
const MIN_ZOOM = 0.02

export default function Lightbox({ items, index, onClose, onNavigate }: LightboxProps) {
  const item = items[index]
  const stageRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ w: 0, h: 0 })
  const [natural, setNatural] = useState({ w: 0, h: 0 })
  /** null 表示「适应窗口」，数字表示手动缩放后的比例 */
  const [manualZoom, setManualZoom] = useState<number | null>(null)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [dragging, setDragging] = useState(false)
  /** 查看时的旋转角度（顺时针），不改文件也不写库 */
  const [rotation, setRotation] = useState(0)
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number; moved: boolean } | null>(
    null
  )

  /** 旋转 90/270 度后，图像的横向和纵向尺寸互换 */
  const upright = rotation % 180 === 0
  const shownW = upright ? natural.w : natural.h
  const shownH = upright ? natural.h : natural.w

  /**
   * 比例 = 一个图像像素对应多少 CSS 像素。
   * 适应窗口时不让小图被放大糊掉，所以上限压到 1。
   */
  const fitScale = useMemo(() => {
    if (!shownW || !viewport.w) return 0
    const raw = Math.min((viewport.w - FIT_PADDING) / shownW, (viewport.h - FIT_PADDING) / shownH)
    return Math.min(1, Math.max(MIN_ZOOM, raw))
  }, [shownW, shownH, viewport.w, viewport.h])

  const zoom = manualZoom === null ? fitScale : Math.max(manualZoom, fitScale)
  /**
   * 屏幕缩放比；100% 指 1 个图像像素铺满 1 个物理像素，高分屏上才不会看着发虚。
   * 拖到另一块不同缩放的显示器时要跟着更新。
   */
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  const maxZoom = MAX_ZOOM / dpr

  useEffect(() => {
    const query = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = (): void => setDpr(window.devicePixelRatio || 1)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [dpr])

  const clampPan = useCallback(
    (next: { x: number; y: number }, scale: number) => {
      const maxX = Math.max(0, (shownW * scale - viewport.w) / 2)
      const maxY = Math.max(0, (shownH * scale - viewport.h) / 2)
      return {
        x: Math.min(maxX, Math.max(-maxX, next.x)),
        y: Math.min(maxY, Math.max(-maxY, next.y))
      }
    },
    [shownW, shownH, viewport.w, viewport.h]
  )

  // 滚轮监听挂在原生事件上，需要随时读到最新的 zoom / pan
  const liveRef = useRef({ zoom, pan })
  liveRef.current = { zoom, pan }

  /** 以光标位置为锚点缩放：锚点下方的画面对应同一个图像像素 */
  const zoomAt = useCallback(
    (target: number, clientX: number, clientY: number) => {
      const stage = stageRef.current
      if (!stage || !natural.w) return
      const rect = stage.getBoundingClientRect()
      const { zoom: prev, pan: prevPan } = liveRef.current
      if (prev <= 0) return
      const next = Math.min(maxZoom, Math.max(fitScale, target))
      if (Math.abs(next - prev) < 1e-4) return
      const mx = clientX - rect.left - rect.width / 2
      const my = clientY - rect.top - rect.height / 2
      const ix = (mx - prevPan.x) / prev
      const iy = (my - prevPan.y) / prev
      const nextPan = clampPan({ x: mx - ix * next, y: my - iy * next }, next)
      // 立刻同步到 liveRef：同一帧内的连续滚轮事件不会被 React 的批量渲染拖慢
      liveRef.current = { zoom: next, pan: nextPan }
      setManualZoom(next)
      setPan(nextPan)
    },
    [clampPan, fitScale, maxZoom, natural.w]
  )

  const zoomCenter = useCallback(
    (target: number) => {
      const stage = stageRef.current
      if (!stage) return
      const rect = stage.getBoundingClientRect()
      zoomAt(target, rect.left + rect.width / 2, rect.top + rect.height / 2)
    },
    [zoomAt]
  )

  const zoomStep = useCallback(
    (factor: number) => zoomCenter(liveRef.current.zoom * factor),
    [zoomCenter]
  )

  const resetFit = useCallback(() => {
    setManualZoom(null)
    setPan({ x: 0, y: 0 })
  }, [])

  /** 旋转 90 度（delta 为负则逆时针）；旋转后先回正位置，避免图片飘出画面 */
  const rotateBy = useCallback((delta: number) => {
    setRotation((prev) => (prev + delta + 360) % 360)
    setPan({ x: 0, y: 0 })
  }, [])

  // 舞台尺寸（窗口缩放时要重算适应比例）
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const sync = (): void => setViewport({ w: stage.clientWidth, h: stage.clientHeight })
    sync()
    const observer = new ResizeObserver(sync)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  // 滚轮缩放：React 的 onWheel 是 passive 的，拦不住页面滚动，这里用原生监听
  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const onWheel = (event: WheelEvent): void => {
      if (!natural.w) return
      event.preventDefault()
      const factor = Math.exp(-event.deltaY * 0.0016)
      zoomAt(liveRef.current.zoom * factor, event.clientX, event.clientY)
    }
    stage.addEventListener('wheel', onWheel, { passive: false })
    return () => stage.removeEventListener('wheel', onWheel)
  }, [natural.w, zoomAt])

  // 切换图片时回到「适应窗口」，并且清掉上一张的旋转
  useEffect(() => {
    setManualZoom(null)
    setPan({ x: 0, y: 0 })
    setRotation(0)
  }, [item?.id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'ArrowLeft') {
        if (index > 0) onNavigate(index - 1)
        return
      }
      if (e.key === 'ArrowRight') {
        if (index < items.length - 1) onNavigate(index + 1)
        return
      }
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault()
        rotateBy(e.shiftKey ? -90 : 90)
        return
      }
      if (e.key === '+' || e.key === '=') {
        zoomStep(1.25)
        return
      }
      if (e.key === '-' || e.key === '_') {
        zoomStep(1 / 1.25)
        return
      }
      if (e.key === '0') resetFit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onNavigate, resetFit, rotateBy, zoomStep])

  if (!item) return null

  const ready = natural.w > 0 && zoom > 0
  const canPan = zoom > fitScale + 1e-4
  const percent = ready ? `${Math.round(zoom * dpr * 100)}%` : '—'
  /**
   * 显示尺寸与偏移都对齐到「整物理像素」：
   * CSS 像素宽度取整会在 1.75 倍屏上变成 2999.5 物理像素，浏览器就会把图整体重采样一遍，
   * 100% 查看时反而变糊；这里换算成整数物理像素再折回 CSS。
   */
  const snap = (value: number): number => Math.round(value * dpr) / dpr
  /** 旋转后要占的画面尺寸 */
  const displayW = ready ? Math.round(shownW * zoom * dpr) / dpr : 0
  const displayH = ready ? Math.round(shownH * zoom * dpr) / dpr : 0
  /** 图片自身的布局尺寸（旋转前），90/270 度时与 displayW/H 互换 */
  const layerW = ready ? Math.round(natural.w * zoom * dpr) / dpr : 0
  const layerH = ready ? Math.round(natural.h * zoom * dpr) / dpr : 0
  const layerLeft = snap((displayW - layerW) / 2)
  const layerTop = snap((displayH - layerH) / 2)
  const offsetX = ready ? snap((viewport.w - displayW) / 2 + pan.x) : 0
  const offsetY = ready ? snap((viewport.h - displayH) / 2 + pan.y) : 0

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>): void => {
    // 双击左右箭头是"翻页"，不该被当成缩放开关
    if ((event.target as HTMLElement).closest('button')) return
    if (manualZoom === null) zoomAt(1 / dpr, event.clientX, event.clientY)
    else resetFit()
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      panX: pan.x,
      panY: pan.y,
      moved: false
    }
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    if (!drag) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    // 超过阈值才算拖动，否则留给「点空白关闭」
    if (!drag.moved && Math.hypot(dx, dy) > 4) {
      drag.moved = true
      setDragging(true)
    }
    if (!drag.moved) return
    setPan(clampPan({ x: drag.panX + dx, y: drag.panY + dy }, zoom))
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current
    dragRef.current = null
    setDragging(false)
    if (drag && !drag.moved && event.target === event.currentTarget) onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[rgba(5,7,10,0.94)]">
      <div className="h-[46px] shrink-0 px-4 flex items-center gap-3 text-[12.5px]">
        <span className="truncate text-[var(--text)]">{item.name}</span>
        <span className="text-[var(--faint)] tabular-nums">
          {index + 1} / {items.length}
        </span>
        <button className="btn btn-ghost h-7 px-2 ml-auto" onClick={onClose} title="关闭 (Esc)">
          <X size={15} />
        </button>
      </div>

      <div
        ref={stageRef}
        className="flex-1 min-h-0 relative overflow-hidden select-none"
        style={{ cursor: dragging ? 'grabbing' : canPan ? 'grab' : 'default' }}
        onDoubleClick={onDoubleClick}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {/* 图片按目标物理像素尺寸渲染，浏览器按这个尺寸重新采样，放大时才不糊；
            旋转放在内层图片上，外层盒子用旋转后的尺寸参与居中与平移 */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div
            className="absolute left-0 top-0"
            style={
              ready
                ? {
                    width: `${displayW}px`,
                    height: `${displayH}px`,
                    transform: `translate3d(${offsetX}px, ${offsetY}px, 0)`
                  }
                : { width: '100%', height: '100%' }
            }
          >
            <img
              src={photoUrl(item.id)}
              alt={item.name}
              draggable={false}
              onLoad={(event) => {
                const img = event.currentTarget
                setNatural({ w: img.naturalWidth, h: img.naturalHeight })
              }}
              className="absolute select-none pointer-events-auto"
              style={
                ready
                  ? {
                      left: `${layerLeft}px`,
                      top: `${layerTop}px`,
                      width: `${layerW}px`,
                      height: `${layerH}px`,
                      maxWidth: 'none',
                      maxHeight: 'none',
                      transform: `rotate(${rotation}deg)`
                    }
                  : {
                      maxWidth: '100%',
                      maxHeight: '100%',
                      left: '50%',
                      top: '50%',
                      transform: 'translate(-50%, -50%)'
                    }
              }
            />
          </div>
        </div>

        {index > 0 && (
          <button
            className="absolute left-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/8 hover:bg-white/16 grid place-items-center text-white/80"
            onClick={() => onNavigate(index - 1)}
            title="上一张"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {index < items.length - 1 && (
          <button
            className="absolute right-3 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-white/8 hover:bg-white/16 grid place-items-center text-white/80"
            onClick={() => onNavigate(index + 1)}
            title="下一张"
          >
            <ChevronRight size={20} />
          </button>
        )}
      </div>

      <div className="h-[34px] shrink-0 px-4 flex items-center gap-3 text-[11px] text-[var(--faint)] border-t border-white/8">
        <span>
          {item.width} × {item.height}
        </span>
        {item.exif?.camera && <span>{item.exif.camera}</span>}
        {item.exif?.lens && <span className="truncate max-w-[280px]">{item.exif.lens}</span>}
        {item.exif?.aperture && <span>{item.exif.aperture}</span>}
        {item.exif?.shutter && <span>{item.exif.shutter}</span>}
        {item.exif?.iso && <span>ISO {item.exif.iso}</span>}
        <span className="ml-auto truncate">滚轮缩放 · 双击 100% · R 旋转 · ← → 切换 · Esc 关闭</span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            className="w-6 h-6 rounded grid place-items-center hover:bg-white/12 text-white/70"
            onClick={() => rotateBy(-90)}
            title="向左旋转 (Shift+R)"
          >
            <RotateCcw size={13} />
          </button>
          <button
            className="w-6 h-6 rounded grid place-items-center hover:bg-white/12 text-white/70"
            onClick={() => rotateBy(90)}
            title="向右旋转 (R)"
          >
            <RotateCw size={13} />
          </button>
          <span className="w-[34px] text-center tabular-nums text-[var(--faint)]">{rotation}°</span>
          <button
            className="w-6 h-6 rounded grid place-items-center hover:bg-white/12 text-white/70"
            onClick={() => zoomStep(1 / 1.25)}
            title="缩小 (-)"
          >
            <Minus size={13} />
          </button>
          <span className="w-[42px] text-center tabular-nums text-[var(--text)]">{percent}</span>
          <button
            className="w-6 h-6 rounded grid place-items-center hover:bg-white/12 text-white/70"
            onClick={() => zoomStep(1.25)}
            title="放大 (+)"
          >
            <Plus size={13} />
          </button>
          <button
            className="h-6 px-2 rounded hover:bg-white/12 text-white/70"
            onClick={resetFit}
            title="适应窗口 (0)"
          >
            适应
          </button>
        </div>
      </div>
    </div>
  )
}
