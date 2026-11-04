/** AI 处理范围：星级门槛 + 文件夹范围（空数组表示不限） */
export interface AiScope {
  minRating: number
  folderIds: number[]
}

/** 从主进程读当前范围；读失败就当作不限，别把功能卡死 */
export async function loadAiScope(): Promise<AiScope> {
  const [minRating, folderIds] = await Promise.all([
    window.api.getAiScoreMinRating().catch(() => 0),
    window.api.getAiFolderIds().catch(() => [] as number[])
  ])
  return { minRating, folderIds }
}

export function inAiScope(
  item: { rating: number; folderIds: number[] },
  scope: AiScope
): boolean {
  if (scope.minRating > 0 && item.rating < scope.minRating) return false
  if (scope.folderIds.length > 0) {
    if (!scope.folderIds.some((id) => item.folderIds.includes(id))) return false
  }
  return true
}

/** 单张的 AI 入口被隐藏时，告诉用户原因 */
export function outOfScopeText(
  item: { rating: number; folderIds: number[] },
  scope: AiScope
): string {
  if (scope.minRating > 0 && item.rating < scope.minRating) {
    return `这张${item.rating > 0 ? `只有 ${item.rating} 星` : '还没标星'}，低于「AI 处理范围」要求的 ${scope.minRating} 星`
  }
  return '这张不在「AI 处理范围」选中的文件夹里'
}
