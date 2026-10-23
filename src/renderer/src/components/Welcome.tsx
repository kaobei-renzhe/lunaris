import { useState } from 'react'
import { FolderOpen, Plus } from 'lucide-react'
import Logo from './Logo'

export default function Welcome({ onReady }: { onReady: (dir: string) => void }) {
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
