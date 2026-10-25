import { BrowserWindow, app, dialog } from 'electron'
import type { RenderProcessGoneDetails } from 'electron'
import { checkpoint } from './db'
import { flushLogs, log } from './logger'

/** 把任意 throw 出来的东西转成可读描述，避免日志里只有 [object Object] */
function describe(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) {
    return { name: reason.name, message: reason.message, stack: reason.stack?.split('\n').slice(0, 8).join(' | ') }
  }
  return { value: typeof reason === 'string' ? reason : JSON.stringify(reason) }
}

async function handleFatal(error: unknown): Promise<void> {
  await log.error('crash', '主进程未捕获异常，即将退出', describe(error))
  await flushLogs()
  // 进程状态已不可信：收尾数据库后直接退出，不做"继续运行"
  checkpoint()
  app.exit(1)
}

async function handleRendererGone(details: RenderProcessGoneDetails): Promise<void> {
  await log.error('crash', '渲染进程异常退出', {
    reason: details.reason,
    exitCode: details.exitCode
  })

  if (details.reason === 'clean-exit') return

  const win = BrowserWindow.getAllWindows()[0]
  if (!win || win.isDestroyed()) return

  // 界面已经不在了，只能用系统弹窗让用户选择；这是唯一允许的系统弹窗场景
  const choice = await dialog.showMessageBox(win, {
    type: 'error',
    buttons: ['重新加载', '退出'],
    defaultId: 0,
    cancelId: 1,
    message: '界面进程意外退出',
    detail: `原因：${details.reason}（代码 ${details.exitCode}）。重新加载不会丢失图库数据。`
  })
  if (choice.response === 0) {
    win.reload()
    return
  }
  app.quit()
}

/**
 * 进程级崩溃兜底：主进程异常、未处理拒绝、渲染进程/子进程退出都留痕。
 * 必须在 app ready 之前安装，才能覆盖启动阶段的异常。
 */
export function installCrashGuards(): void {
  process.on('uncaughtException', (error) => {
    void handleFatal(error)
  })

  // 未处理的 Promise 拒绝通常不致命，记录后继续，避免一个后台任务失败就杀掉应用
  process.on('unhandledRejection', (reason) => {
    void log.error('crash', '未处理的 Promise 拒绝', describe(reason))
  })

  app.on('render-process-gone', (_event, _contents, details) => {
    void handleRendererGone(details)
  })

  app.on('child-process-gone', (_event, details) => {
    void log.error('crash', '子进程退出', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode
    })
  })
}
