# 研读 Tab 接入方案

> 承接 `docs/照片研读与复盘方案.md`，但按现在的 **PhotoInspector** 架构重新落点。
> 本轮只做 P1：纯文字笔记 + 圈选 + 提问 + AI 反问 + 研读/复盘双模式。
> 不新增侧栏入口，不另做一套面板，全部长在 `StudyTab` 里。

---

## 0. 结论先放

后端其实已经准备好了：

- `src/main/notes.ts`：笔记 CRUD、线程分组、级联删除、参考片标记，已写好
- `src/main/llm/capabilities/socratic.ts`：反问能力，最多两轮，已注册
- `photo_notes` 表与 `items.reference` 列已经建好

现在缺的只有三块：

1. **IPC / preload / Api 类型**：渲染层还调不到笔记
2. **`StudyTab` 本身**：现在只是占位
3. **灯箱圈选层**：要和灯箱图片共用一套坐标

> 关键变化：旧方案里的 `StudyPanel` 不再需要。PhotoInspector 已经把右侧面板和默认 Tab 做好了，研读直接填 `StudyTab`。

---

## 1. 三处宿主怎么分工

| 宿主 | 研读 Tab 能做什么 | 圈选 |
| --- | --- | --- |
| 主图库右栏 | 看笔记、写纯文字笔记、整图提问 | 不做，提示去灯箱 |
| 人像工作台右栏 | 同上 | 不做 |
| 灯箱 | 完整功能 | 支持拖框 |

这样不用把灯箱的坐标换算复制三份；文字笔记在所有入口都能用，圈选只在真正有大图的地方出现。

---

## 2. 数据与类型缺口

### 2.1 `Item.reference`

`items.reference` 已经有列，但 `Item` 类型和 `mapItems` 还没带出来。研读/复盘默认模式依赖它，必须先补：

```ts
// shared/types.ts
export interface Item {
  // …
  reference: number   // 1 = 参考片（默认研读），0 = 自己的片子（默认复盘）
}
```

`repo.ts` 的 `mapItems` 加一行 `reference: r.reference`。

### 2.2 Api 增加 notes 命名空间

沿用现有 `window.api`，但笔记方法多，建议收成一组：

```ts
export interface NotesApi {
  list: (itemId: number) => Promise<NoteThread[]>
  count: (itemId: number) => Promise<number>
  create: (input: CreateNoteInput) => Promise<PhotoNote>
  update: (id: number, patch: Partial<Pick<PhotoNote, 'body' | 'kind' | 'tags'>>) => Promise<PhotoNote | null>
  remove: (id: number) => Promise<void>
  setReference: (itemId: number, value: boolean) => Promise<void>
}

export interface Api {
  // …
  notes: NotesApi
}
```

**不需要 `notes.ask`**：现有 `llmRun('photo.socratic', input)` 已经能跑反问能力，直接复用，少开一个通道、少一套错误码映射。

---

## 3. 主进程与 IPC

### 3.1 IPC 通道

```ts
ipcMain.handle('notes:list', (_e, itemId) => listThreads(Number(itemId)))
ipcMain.handle('notes:count', (_e, itemId) => countNotes(Number(itemId)))
ipcMain.handle('notes:create', (_e, input: CreateNoteInput) => createNote(input))
ipcMain.handle('notes:update', (_e, id, patch) => updateNote(Number(id), patch ?? {}))
ipcMain.handle('notes:delete', (_e, id) => deleteNote(Number(id)))
ipcMain.handle('notes:setReference', (_e, itemId, v) => {
  setItemReference(Number(itemId), Boolean(v))
  scheduleXmpWrite([Number(itemId)])   // 参考片标记也要同步到 XMP
})
```

`scheduleXmpWrite` 来自 `src/main/xmp.ts`；这一行别漏，否则「参考片」只会在月相里生效。

### 3.2 preload

```ts
notes: {
  list: (itemId) => ipcRenderer.invoke('notes:list', itemId),
  count: (itemId) => ipcRenderer.invoke('notes:count', itemId),
  create: (input) => ipcRenderer.invoke('notes:create', input),
  update: (id, patch) => ipcRenderer.invoke('notes:update', id, patch),
  remove: (id) => ipcRenderer.invoke('notes:delete', id),
  setReference: (itemId, value) => ipcRenderer.invoke('notes:setReference', itemId, value)
}
```

---

## 4. StudyTab 设计

### 4.1 Props

`PhotoInspector` 增加可选 `study` 配置；只有传给它的宿主才拿到圈选能力。

```ts
export interface StudyTabProps {
  item: Item
  compact?: boolean

  /** 大模型是否就绪；未就绪时只隐藏 AI 输入，手工笔记仍可用 */
  aiReady: boolean
  canAsk: boolean

  /** 灯箱里才传：当前圈选区域与框选状态 */
  region?: NoteRegion | null
  drawing?: boolean
  onRegionChange?: (region: NoteRegion | null) => void
  onDrawingChange?: (drawing: boolean) => void

  /** 外部要求滚动到某条线程（点图上的框时） */
  focusThreadId?: number | null
  onThreadFocused?: () => void
}
```

- 主图库 / 工作台：只传 `aiReady`、`canAsk`，`onDrawingChange` 不传 → 隐藏「框选」按钮。
- 灯箱：全传。

### 4.2 内部结构

```
StudyTab
├── 顶部：研读 / 复盘 切换 · 「框选」按钮 · 「直接告诉我」开关
├── 线程列表
│   └── ThreadItem：根问题 + 回复（折叠）+ 追问输入
├── 新笔记输入框
└── AI 状态：未配置时一行灰字，不挡手工笔记
```

不要做独立滚动容器，StudyTab 外层已经由 PhotoInspector 提供 `overflow-y-auto`。

### 4.3 线程渲染

- `notes.list(itemId)` 返回 `NoteThread[]`，根笔记 + 回复直接渲染
- 根笔记显示区域标签「框 1」/「整图」、模式、时间
- AI 气泡用 `stage` 区分：
  - `probe` → 标「反问」、浅色气泡
  - `explain` → 标「解释」、正常气泡
- 用户自己的问题用普通气泡
- 删除根笔记时二次确认，提示「下面的追问会一起删除」

### 4.4 提问与落库顺序

```ts
// 1. 先保存用户问题，AI 失败也不丢
const question = await window.api.notes.create({
  itemId: item.id,
  parentId,                 // 新线程为 null，追问为根笔记 id
  kind: 'question',
  mode,
  body,
  region: region ?? null,
  author: 'me'
})

// 2. 把线程历史转成 SocraticTurn[]
const history = thread ? [...thread.replies].map((n) => ({
  role: n.author,
  text: n.body
})) : []

// 3. 调现有大模型通道
const outcome = await window.api.llmRun('photo.socratic', {
  itemId: item.id,
  region,
  question: body,
  history,
  mode,
  skipSocratic
})

// 4. 成功才保存 AI 回复；失败保留问题并显示重试
if (outcome.ok) {
  await window.api.notes.create({
    itemId: item.id,
    parentId: question.parentId ?? question.id,
    kind: outcome.data.stage === 'probe' ? 'question' : 'answer',
    mode,
    body: outcome.data.text,
    author: 'ai'
  })
}
```

注意父子关系：新线程的 AI 回复要挂在 **用户问题 id** 下，追问的 AI 回复挂在 **根线程 id** 下。不要把所有回复都挂成同级，否则线程会散。

### 4.5 轮次与成本

- 轮次上限已经在 `socratic.ts` 里硬保证，前端只负责把 `history` 传全
- 输入框上方显示「反问 1/2」；到 2 次后按钮文案变成「给我答案」
- 「直接告诉我」按钮：`skipSocratic: true`，本轮必出解释
- AI 未配置：
  - 不显示「提问」按钮
  - 输入框仍然可以「只记笔记」
  - 顶部一行灰字「未启用大模型，仍可手工记笔记」

---

## 5. 灯箱圈选层

### 5.1 不要把框放在外层

灯箱现在的图层：

```
stage
└ 外层 div（overflow-hidden, pointer-events-none）
  └ 内层 div width=displayW height=displayH translate3d(offsetX, offsetY)
    └ img left=layerLeft top=layerTop width=layerW height=layerH rotate(deg)
```

`RegionLayer` 必须复制 img 的定位样式，和它并排：

```tsx
<div
  className="absolute"
  style={{
    left: layerLeft,
    top: layerTop,
    width: layerW,
    height: layerH,
    transform: `rotate(${rotation}deg)`,
    pointerEvents: 'auto'
  }}
>
  {notesWithRegion.map((note) => (
    <div
      key={note.id}
      style={{
        left: `${note.region.x * 100}%`,
        top: `${note.region.y * 100}%`,
        width: `${note.region.w * 100}%`,
        height: `${note.region.h * 100}%`
      }}
    />
  ))}
</div>
```

放进外层用百分比定位会错位，缩放/平移后尤其明显。

### 5.2 拖框换算

以图片实际显示区域为基准：

```ts
const rect = imageRef.current.getBoundingClientRect()
const region = {
  x: (clientX - rect.left) / rect.width,
  y: (clientY - rect.top) / rect.height,
  w: dragW / rect.width,
  h: dragH / rect.height
}
```

- 夹到 0–1
- 宽或高 < 0.02 视为误触丢弃
- `rotation !== 0` 时禁用框选，提示「转正后再框」；不要硬算旋转矩阵

### 5.3 灯箱与 StudyTab 的状态边界

灯箱持有：

```ts
const [inspectorOpen, setInspectorOpen] = useState(false)
const [drawing, setDrawing] = useState(false)
const [region, setRegion] = useState<NoteRegion | null>(null)
const [focusThreadId, setFocusThreadId] = useState<number | null>(null)
```

向下传给 `PhotoInspector` 的 `study`：

```tsx
study={{
  aiReady,
  canAsk,
  region,
  drawing,
  onRegionChange: setRegion,
  onDrawingChange: setDrawing,
  focusThreadId,
  onThreadFocused: () => setFocusThreadId(null)
}}
```

点图上的框 → `setFocusThreadId(note.id)`，StudyTab 滚动到对应线程并高亮。

### 5.4 快捷键

灯箱已有 `← → R +/- 0`，新增：

| 键 | 行为 |
| --- | --- |
| `N` | 开关档案侧栏（并自动落到研读 Tab） |
| `F` | 开关框选（侧栏展开且研读 Tab 激活时） |
| `Esc` | 正在框选时取消；否则关侧栏 |

按键处理里先判断 `event.defaultPrevented`，别覆盖输入框里的 Esc。

---

## 6. 信息 Tab 的入口

两处小改，解决「该写哪」：

1. **参考片勾选框**：信息 Tab 顶部加「这是参考片」，调用 `notes.setReference`；切换后研读 Tab 默认模式跟着变。
2. **笔记数入口**：信息 Tab 底部加一行「研读笔记 · N 条 →」，点击切到研读 Tab。N 用 `notes.count(itemId)` 自取，不进全局 stats。

---

## 7. 施工顺序

| # | 改哪里 | 做什么 | 怎么验证 |
| --- | --- | --- | --- |
| 1 | `shared/types.ts` | `Item.reference`、`NotesApi` | typecheck |
| 2 | `repo.ts` | `mapItems` 带出 reference | 选中照片能拿到 reference |
| 3 | `ipc.ts` / `preload` | 6 个 notes handler | `window.api.notes.list(1)` 有返回 |
| 4 | `StudyTab.tsx` | 线程列表 + 纯文字笔记 + 删除 | AI 关掉也能写能读能删 |
| 5 | `StudyTab.tsx` | 接 `llmRun('photo.socratic')` | 连问三轮，第三轮必解释 |
| 6 | `PhotoInspector` | 透传 `study` 配置 | 三个宿主都能打开研读 Tab |
| 7 | `Lightbox.tsx` | 圈选状态 + RegionLayer 只渲染已有框 | 手动插一条带 region 的笔记，框位置对齐 |
| 8 | `Lightbox.tsx` | 拖拽新建框 | 缩放/平移后框仍贴住画面 |
| 9 | `Lightbox.tsx` | N / F / Esc 与焦点联动 | 不与翻页、旋转冲突 |
| 10 | `InfoTab.tsx` | 参考片勾选 + 笔记数入口 | 切换后默认模式变化 |

第 7 步单独拆出来：**先只显示、不拖拽**，确认坐标系对了再上交互。坐标没对齐就做拖拽，后面全是玄学 bug。

---

## 8. 边界与风险

| 情况 | 处理 |
| --- | --- |
| 大模型未配置 | 手工笔记照常；AI 区域显示灰字，不挡输入 |
| AI 调用失败 | 用户问题已落库；显示错误 + 重试，不重复创建问题 |
| 连续追问超过 2 轮 | 后端硬保证 `stage=explain`，前端按钮文案同步 |
| 删除根笔记 | 级联删除追问，二次确认 |
| 图片旋转后框选 | 禁用框选，提示转正 |
| 灯箱缩放/平移 | 框层复制 img 定位样式，自动跟随 |
| 切换照片 | 清空 region、drawing、focusThreadId |
| 灯箱从工作台打开 | 行为与主图库一致，不另做逻辑 |
| 笔记很长 | notes.ts 已限制 4000 字，前端不需要再加 |
| 参考片标记 | 同步写 XMP，别只改库 |

**最容易翻车**：把 `RegionLayer` 放进外层 div 用百分比定位；以及 AI 失败时把用户问题也丢了。这两条在验收时重点看。

---

## 9. 验收标准（P1）

- [ ] 主图库、人像工作台、灯箱的研读 Tab 是同一套组件，行为一致
- [ ] 大模型未配置时，纯文字笔记仍可新建、查看、删除
- [ ] AI 最多反问两次，第三次必给解释
- [ ] 「直接告诉我」立即跳过反问
- [ ] 灯箱能拖框，框在缩放/平移后仍贴住画面；旋转时禁止框选
- [ ] 点图上的框，右侧滚动到对应线程
- [ ] 删除根笔记，下面追问一起消失
- [ ] 参考片勾选后，研读 Tab 默认模式变成「研读」，并同步写 XMP
- [ ] 老的 `items.note`、facet 标签、档案面板其他 Tab 行为不变

---

## 10. 明确不做（P2/P3）

- 原则库、间隔重复复习
- FlowUs / Markdown 导出
- 只裁圈选区域送模型（P1 仍送整图 + 区域描述）
- 笔记全文搜索
- 多图对比研读

这些等 P1 跑顺、确认真有人用之后再开。
