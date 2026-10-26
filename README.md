# 月巢 · MoonNest

<p align="center">
  <img src="build/icon.png" width="120" alt="MoonNest logo" />
</p>

<p align="center">
  本地优先的图片素材库：把照片、RAW 和设备管理收进一个「巢」里。
</p>

<p align="center">
  <img alt="platform" src="https://img.shields.io/badge/platform-Windows-4b6cb7" />
  <img alt="electron" src="https://img.shields.io/badge/Electron-45-2b2e3a" />
  <img alt="react" src="https://img.shields.io/badge/React-19-149eca" />
  <img alt="license" src="https://img.shields.io/badge/license-MIT-green" />
</p>

---

## 这是什么

月巢是一个类似 Eagle 的本地图片管理工具：图片始终留在你自己的磁盘上，应用只维护一份索引数据库和缩略图缓存。除了常规的标签、文件夹、筛选、查重，还针对摄影工作流做了 RAW 内嵌预览、RAW + JPEG 配对、连拍堆叠、P/X/U 旗标，以及基于本地 Chinese-CLIP 模型的中文语义搜图和自动分类。

## 功能

**导入与浏览**

- 拖拽导入、选择文件 / 文件夹导入，导入过程带进度
- 监听图库目录，外部新增或删除的文件会自动同步
- 虚拟化瀑布流 + 无限加载，缩略图尺寸可调；清晰度默认「自动」——按卡片大小、构图方向和屏幕像素密度挑档（260 / 720 / 1440），也能手动锁定低 / 中 / 高，改完立即生效并记住
- 灯箱大图（滚轮缩放、拖动平移、双击 100%、R 键旋转，大图按目标尺寸重新采样，放大不糊）、详情面板（尺寸、EXIF、备注、来源链接）
- 支持 JPEG / PNG / WebP / GIF / BMP / TIFF / AVIF，以及 NEF、CR2、CR3、ARW、DNG、RAF、RW2 等 20+ 种 RAW（读取内嵌预览）

**整理**

- 标签、文件夹、智能文件夹（把当前筛选条件存下来）
- 星级评分与 P / X / U 旗标
- RAW + JPEG 自动配对、连拍自动堆叠，也可以手动堆叠与单组展开
- 拖拽把图片放进文件夹或标签
- 软删除 + 20 步撤销

**查找**

- 关键词搜索（SQLite FTS5 trigram），可按评分、旗标、颜色、日期组合筛选
- 语义搜图：用中文描述找图（如「海边的日落」），也可以「找相似」
- 自动分类：零样本模型把图片归到人像、风景、街拍等 14 个类目
- AI 辅助（可选、默认关闭）：照片质量评分、单张后期建议、一句话智能筛选（详见下方「AI 功能」）

**维护**

- 感知哈希查重（dHash + 汉明距离分桶），一键清理重复
- 文件丢失检测与重新定位：目录映射 → 同名同大小 → 画面指纹 → EXIF 时间逐层匹配
- 图库备份 / 恢复（zip），支持按天定时自动备份并保留最近 N 份
- 导出 CSV 素材清单

**设备与搭配**

- 管理机身、镜头、三脚架、闪光灯、补光灯、云台
- 13 种拍摄场景（人像、风光、街拍、婚礼、星空、微距、视频、旅行、产品、运动、室内闪光、弱光手持、延时）自动推荐搭配，区分「必带 / 可选」配件
- 读取照片 EXIF 统计每件设备的实际出片量
- 把推荐存成「我的方案」，一键复制成文字清单

**其他**

- 深色 / 浅色 / 跟随系统三种主题
- 中文界面，Windows 安装包（NSIS）

## 技术栈

| 领域 | 选型 |
| --- | --- |
| 桌面框架 | Electron 45、electron-vite 6、Vite 8 |
| 界面 | React 19、TypeScript 7、Tailwind CSS v4、lucide-react |
| 数据 | better-sqlite3（WAL、FTS5 trigram、在线快照备份） |
| 图像 | sharp（缩略图 / RAW 预览 / TIFF 转码）、exifr（EXIF） |
| 语义 | onnxruntime-node + Chinese-CLIP ViT-B/16（int8 ONNX） |
| 大模型 | OpenAI 兼容接口 / Anthropic（可自定义 baseUrl），Key 走系统加密 |
| 打包 | electron-builder（NSIS） |

架构上分为三层：主进程负责数据库、文件与模型；preload 通过 `contextBridge` 暴露受控的 `window.api`；渲染层只做界面。缩略图和大图通过自定义协议 `thumb://`、`photo://` 直读，不走 IPC 传字节。

## 快速开始

**环境要求**：Node.js ≥ 20、Windows 10/11（当前只提供 Windows 打包配置）。

```bash
npm install
npm run dev        # 开发模式
npm run typecheck  # 类型检查
npm run build      # 构建到 out/
npm run dist       # 构建并打包 Windows 安装包到 release/
```

首次启动会引导你新建或打开一个图库文件夹——它就是一个普通目录，里面会多出 `library.db` 和 `thumbnails/`，原始图片不会被移动。如果不想让这些索引文件待在照片目录里，可以在「设置 → 存储位置」里把索引与缓存搬到别的文件夹（原图始终不动）。

## 语义搜图说明

语义功能依赖本地模型，模型文件约 **190MB**，没有随仓库分发，需要在侧栏「语义索引」里首次点击时自动下载（来源：HuggingFace 镜像上的 `Xenova/chinese-clip-vit-base-patch16`，支持断点续传与大小校验）。下载完成后完全离线运行，图片不会离开本机。索引时只读 720px 缩略图、限制 libvips 线程数，并会按批让出 CPU；几万张的图库建议挂着「闲时自动索引」慢慢跑。

## AI 功能（可选，默认关闭）

接入你自己的大模型服务，做三件事：

| 能力 | 在哪用 | 说明 |
| --- | --- | --- |
| 照片质量评分 | 详情面板「AI 评分」/ 选中多张后工具栏「AI 评分」 | 构图、曝光、色彩、清晰度四维 + 总分（0–100）与一句评语；结果存进图库，可按 AI 评分排序、筛选 |
| 后期优化建议 | 详情面板「AI 后期建议」 | 单张输出修图方向、参数幅度（如曝光 `-0.3EV`）与风格参考，可一键复制 |
| 智能筛选 | 工具栏「AI 筛选」 | 一句话规则（如「画面里有海、低饱和冷色调」）批量挑图，命中项带逐张理由，可一键「只看这些」 |

支持 **OpenAI 兼容接口**（DeepSeek、Kimi、通义、智谱、Ollama 等，填各自的 baseUrl 与模型名）和 **Anthropic**。

### 怎么开启

设置 → 大模型：打开总开关 → 选服务商 → 填接口地址与模型名 → 粘贴 API Key → 点「测试连接」确认链路。API Key 用系统加密保存（Windows DPAPI），界面上只显示 `sk-…abcd` 这样的掩码。

### 不会偷偷花钱

- **总开关默认关闭**；打开后还有三个能力各自的小开关，可以只留想用的那个。
- **关掉就不显示**：总开关没开时，相册里**完全不出现** AI 按钮（评分、建议、AI 筛选，以及排序与筛选里的 AI 选项都藏起来），不会用灰按钮占位；某个能力单独关掉后，对应入口也直接消失；即使绕过界面直接调用，主进程仍会拒绝。
- **没有任何后台自动调用**：评分要你手动点、建议要先点「生成建议」、筛选要先点「开始筛选」，弹窗上都会标注会消耗 token。
- **关闭时自动复位**：关掉「照片质量评分」或总开关时，排序里的「AI 评分」和筛选里的 AI 评分条件会一起隐藏，并把已选中的 AI 排序/筛选复位为「最新导入 / 全部」，避免条件看不见却还在过滤结果。
- **控制单次成本**：图片送进模型前统一压到长边 1024、JPEG q82；一次最多评 12 张、筛 30 张。

### 数据会去哪

只有你手动点 AI 按钮时，才会把压缩后的图片和提示词发给你**自己配置的**服务商；请求由主进程发出，界面拿不到 Key。不开启这块功能时，应用完全离线。

## 数据与隐私

- 图片、缩略图、索引数据库全部在本地；唯一的例外是上面「AI 功能」——只有你开启并手动点按钮时，压缩后的图片才会发给你自己配置的模型服务商
- 索引（`library.db`、`thumbnails/`、`previews/`）默认放在图库目录里，可在「设置 → 存储位置」搬到任意文件夹；原图位置不会被改动。同一处还能看到低/中/高三档缩略图各占多少、给高清档设上限（超出自动淘汰最久没看的），或随时手动清理
- 配置写在系统用户数据目录（Electron `userData`）里的 `config.json` / `gear.json`
- 「备份图库」生成的就是一个可以拷走的 zip，恢复时解到新文件夹即可

## 目录结构

```
src/
├── main/        主进程：数据库、导入、缩略图、备份、查重、CLIP、装备推荐、大模型接入
│   └── llm/     大模型：厂商适配、密钥、能力注册（评分/建议/筛选）
├── preload/     contextBridge 暴露的 window.api
├── renderer/    React 界面
└── shared/      主进程与渲染层共用的类型与格式常量
build/           图标与打包资源
```

## 已知限制

- 目前只有 Windows 打包配置；macOS / Linux 需要自行补充 electron-builder 目标
- RAW 只读取内嵌预览，不做 RAW 解码，因此不支持在应用内调整显影参数
- 语义搜索与自动分类需要先建立向量索引，首次索引耗时与图库规模相关
- AI 功能依赖服务商：模型必须支持看图；一次评分最多 12 张、智能筛选最多 30 张（只覆盖当前已加载的前 30 张，不是全库）
- AI 评分不会自动失效：原图被替换或换了模型后，旧分数仍然保留，需要手动「重新评分」

## 许可证

[MIT](LICENSE)

## 致谢

- [Chinese-CLIP](https://github.com/OFA-Sys/Chinese-CLIP) 提供中文图文模型
- [Xenova/chinese-clip-vit-base-patch16](https://huggingface.co/Xenova/chinese-clip-vit-base-patch16) 提供 ONNX 转换版本
- [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[sharp](https://sharp.pixelplumbing.com/)
