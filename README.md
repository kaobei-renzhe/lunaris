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
- 虚拟化瀑布流 + 无限加载，缩略图尺寸可调
- 灯箱大图、详情面板（尺寸、EXIF、备注、来源链接）
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

首次启动会引导你新建或打开一个图库文件夹——它就是一个普通目录，里面会多出 `library.db` 和 `thumbnails/`，原始图片不会被移动。

## 语义搜图说明

语义功能依赖本地模型，模型文件约 **190MB**，没有随仓库分发，需要在侧栏「语义索引」里首次点击时自动下载（来源：HuggingFace 镜像上的 `Xenova/chinese-clip-vit-base-patch16`，支持断点续传与大小校验）。下载完成后完全离线运行，图片不会离开本机。

## 数据与隐私

- 图片、缩略图、索引数据库全部在本地，应用不上传任何内容
- 配置写在系统用户数据目录（Electron `userData`）里的 `config.json` / `gear.json`
- 「备份图库」生成的就是一个可以拷走的 zip，恢复时解到新文件夹即可

## 目录结构

```
src/
├── main/        主进程：数据库、导入、缩略图、备份、查重、CLIP、装备推荐
├── preload/     contextBridge 暴露的 window.api
├── renderer/    React 界面
└── shared/      主进程与渲染层共用的类型与格式常量
build/           图标与打包资源
```

## 已知限制

- 目前只有 Windows 打包配置；macOS / Linux 需要自行补充 electron-builder 目标
- RAW 只读取内嵌预览，不做 RAW 解码，因此不支持在应用内调整显影参数
- 语义搜索与自动分类需要先建立向量索引，首次索引耗时与图库规模相关

## 许可证

[MIT](LICENSE)

## 致谢

- [Chinese-CLIP](https://github.com/OFA-Sys/Chinese-CLIP) 提供中文图文模型
- [Xenova/chinese-clip-vit-base-patch16](https://huggingface.co/Xenova/chinese-clip-vit-base-patch16) 提供 ONNX 转换版本
- [Electron](https://www.electronjs.org/)、[React](https://react.dev/)、[better-sqlite3](https://github.com/WiseLibs/better-sqlite3)、[sharp](https://sharp.pixelplumbing.com/)
