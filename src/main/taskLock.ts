/**
 * 轻量任务锁：语义索引和自动分类都吃同一份向量数据，
 * 用共享标记保证两者不会同时跑（避免按半套索引分类）。
 */
let indexing = false
let tagging = false

export function isIndexing(): boolean {
  return indexing
}

export function isTagging(): boolean {
  return tagging
}

export function beginIndexing(): void {
  indexing = true
}

export function endIndexing(): void {
  indexing = false
}

export function beginTagging(): void {
  tagging = true
}

export function endTagging(): void {
  tagging = false
}
