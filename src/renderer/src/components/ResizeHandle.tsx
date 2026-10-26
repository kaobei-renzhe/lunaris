import { useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'

interface ResizeHandleProps {
  title: string
  onStart: () => void
  /** deltaX：相对按下位置的横向位移，往右为正 */
  onDrag: (deltaX: number) => void
  onCommit: () => void
  onReset: () => void
}

/** 两栏之间的拖拽手柄：拖动改宽度，双击复位 */
export default function ResizeHandle({ title, onStart, onDrag, onCommit, onReset }: ResizeHandleProps) {
  const startX = useRef(0)
  const dragging = useRef(false)

  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    startX.current = event.clientX
    dragging.current = true
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      /* 合成事件没有真实指针，忽略 */
    }
    // 拖动期间别选中文字、也别让光标闪回默认
    document.body.style.userSelect = 'none'
    document.body.style.cursor = 'col-resize'
    onStart()
  }

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    onDrag(event.clientX - startX.current)
  }

  const end = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!dragging.current) return
    dragging.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
    onCommit()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={title}
      title={title}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      className="group relative w-[6px] shrink-0 cursor-col-resize select-none"
    >
      <span className="absolute inset-y-0 left-1/2 -translate-x-1/2 w-px bg-[var(--border)] transition-colors group-hover:w-[2px] group-hover:bg-[var(--accent)]" />
    </div>
  )
}
