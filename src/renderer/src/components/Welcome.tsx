import { useState } from 'react'
import { ArrowLeft, FolderOpen, Plus } from 'lucide-react'
import Logo from './Logo'

interface WelcomeProps {
  onReady: (dir: string) => void
  /** 从已有图库切过来时，可以不做任何操作直接返回 */
  onBack?: () => void
  backLabel?: string
  /** 上次的索引目录失效时的说明（原图还在，索引需要重建） */
  notice?: string | null
}

export default function Welcome({ onReady, onBack, backLabel, notice }: WelcomeProps) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const createLibrary = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy(true)
    try {
      const path = await window.api.createLibrary(dir)
      onReady(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openLibrary = async (): Promise<void> => {
    const dir = await window.api.pickLibraryDir()
    if (!dir) return
    setBusy(true)
    try {
      const path = await window.api.openLibrary(dir)
      onReady(path)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="h-full grid place-items-center bg-[var(--bg)]">
      <div className="w-[440px] text-center">
        {onBack && (
          <div className="flex justify-start mb-4">
            <button className="btn btn-ghost h-7 px-2 text-[11.5px]" onClick={onBack}>
              <ArrowLeft size={13} /> 返回{backLabel ? `「${backLabel}」` : '当前图库'}
            </button>
          </div>
        )}
        <div className="mx-auto mb-6 w-[64px] h-[64px]">
          <Logo size={64} />
        </div>
        <h1 className="text-[22px] font-semibold tracking-wide m-0">月巢</h1>
        <p className="text-[13px] text-[var(--muted)] mt-2 mb-8">
          本地优先的素材巢 · 图片、相机与文字都归在这里
        </p>

        <div className="flex flex-col gap-2">
          <button className="btn btn-primary h-[38px] justify-center" onClick={createLibrary} disabled={busy}>
            <Plus size={16} /> 新建图库
          </button>
          <button className="btn h-[38px] justify-center" onClick={openLibrary} disabled={busy}>
            <FolderOpen size={16} /> 打开已有图库
          </button>
        </div>

        {notice && (
          <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel-2)] px-3 py-2.5 text-left text-[11.5px] leading-5 text-[var(--danger-text)]">
            上次的索引目录里找不到 library.db：
            <span className="break-all">{notice}</span>
            <div className="mt-1 text-[var(--muted)]">
              索引可能被移动或删除了（把索引放在应用安装目录时，升级安装会把它清掉）。
              原图都还在图库里——打开图库后点「刷新图库」就能重建索引，但标签、评分等元数据无法恢复。
            </div>
          </div>
        )}

        {error && <div className="mt-4 text-[12px] text-[var(--danger)]">{error}</div>}

        <p className="mt-8 text-[11.5px] text-[var(--faint)] leading-5">
          图库就是一个普通文件夹
          <br />
          里面保存索引数据库与缩略图缓存，原图仍留在原位置
        </p>
      </div>
    </div>
  )
}
