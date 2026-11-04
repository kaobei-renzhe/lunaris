# XMP 侧车 与 facet 计数：一个该做，一个不用做

> 结论先放：**② XMP 值得做，③ facet 计数不用动。**
> ③ 是我拍脑袋的判断，拿真实库跑了一遍发现自己错了，下面把数据摆出来。

---

# 第一部分 · XMP 侧车（建议做）

## 1. 核心原则：只写「人的判断」，不写「机器的中间产物」

这一条定错了，后面全白做。

| 该写进 XMP | 不该写 |
| --- | --- |
| 星级（你打的） | AI 评分 78 分（换个模型就是 82） |
| 旗标 P/X/U（你选的） | AI 评语（模型的临时输出） |
| 标签、facet 分类（你归的） | 语义向量、感知哈希（纯本地实现细节） |
| 短备注（你写的） | 研读笔记（太长，会撑大文件拖慢 Lightroom） |
| 参考片标记 | 缓存路径、索引目录 |

**判断标准一句话**：换一台电脑、换一个 app，这条信息还有意义吗？有 → 写。没有 → 别写。

AI 评分就是典型的"没有意义"——它是本机某个模型在某天的产物，写进 XMP 反而会误导以后打开这个文件的 Lightroom 用户。

---

## 2. 字段映射

| 月相字段 | XMP 字段 | 说明 |
| --- | --- | --- |
| `rating` 0–5 | `xmp:Rating` | 标准字段，所有软件都认 |
| `flag` P/X/U | `xmp:Label` + `moonphoto:Flag` | 见 2.1 |
| `tags` 普通标签 | `dc:subject` | 标准关键词 |
| `tags` 带 facet_id | `lr:hierarchicalSubject` | 层级标签 `景别\|特写`，见 2.2 |
| `note` | `dc:description` | 标准备注 |
| `reference` | `moonphoto:Reference` | 私有字段，别的软件忽略 |

### 2.1 旗标：双写

`xmp:Label` 是颜色标签，各软件理解不一样；月相的 P/X/U 是三态，没法一一对应。所以**双写**：

```
P（精选）→ xmp:Label="青色"  + moonphoto:Flag="pick"
X（排除）→ xmp:Label="红色"  + moonphoto:Flag="reject"
U（待定）→ 都不写
```

- 别的软件看到 `xmp:Label`，至少知道这张被标记过（Capture One 就是这么用的）
- 月相自己读 `moonphoto:Flag` 精确还原，不受颜色语义影响

私有命名空间别的软件会安静忽略，不会有兼容问题。

### 2.2 facet 分类：这条最漂亮

主人在人像工作台建的 9 个维度，正好能映射成 Lightroom 的**层级关键字**：

```
facet「景别」+ 值「特写」  →  lr:hierarchicalSubject: 景别|特写
facet「色调」+ 值「暖调」  →  lr:hierarchicalSubject: 色调|暖调
facet「场景」+ 值「街头」  →  lr:hierarchicalSubject: 场景|街头
```

换到 Lightroom 里，左侧关键字面板会长成一棵**两级树**，和月相的维度一模一样。**主人辛苦打的分类，直接变成 LR 里能用的结构。**

这是这套方案里最有价值的一点。

---

## 3. 同步策略

### 3.1 方向：月相为主

```
月相改星级/标签  →  写 XMP（延迟合并）
导入新照片      →  如果有 XMP，读进来
外部软件改了    →  检测 mtime 变化，提示是否导入
```

### 3.2 写入时机

| 场景 | 策略 |
| --- | --- |
| 单张改星级 | 防抖 2 秒后写（拖滑块不会写 100 次） |
| 批量打标签 | 队列串行写，带进度条 |
| 导入时 | 不写，只读 |
| 手动「导出全部 XMP」 | 全量写，用于迁移/备份到别的软件 |

**绝不做"每次改动立刻同步写"**：3 万张里选 500 张打标签，会把磁盘 IO 打满。

### 3.3 冲突：外部改过怎么办

`items` 表加一列记 XMP 的 mtime：

```sql
ALTER TABLE items ADD COLUMN xmp_mtime INTEGER NOT NULL DEFAULT 0;
```

拿文件的 `stat().mtimeMs` 和这个比：

- 一致 → 没人在外面动过，安全
- XMP 更新 → 有外部修改，弹一次提示：「这张在别的软件里改过，要导入吗？」给「导入 / 忽略 / 以后都忽略」
- 不做自动覆盖，**用户的判断不能被悄悄改掉**

---

## 4. 实现

### 4.1 读：`exifr.sidecar()` 现成可用

```ts
import exifr from 'exifr'
const data = await exifr.sidecar('/path/to/DSC_0001.NEF')
// data.Rating / data.Label / data.subject / data.description
```

`exifr` 已经在依赖里，`sidecar` 是它导出的一个独立 async 函数，会自动找同名 `.xmp` / `.XMP`。**不用引新依赖。**

### 4.2 写：模板字符串，不引 XMP 库

XMP 就是一个固定结构的 RDF/XML，手写模板最省事（现成的 xmp-toolkit 要编 C++，重）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="月相 Lunaris 0.3">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:lr="http://ns.adobe.com/lightroom/1.0/"
    xmlns:moonphoto="https://lunaris.app/ns/1.0/"
    xmp:Rating="4"
    xmp:Label="青色"
    moonphoto:Flag="pick"
    moonphoto:Version="1">
   <dc:description>
    <rdf:Alt><rdf:li xml:lang="x-default">客户要的封面图</rdf:li></rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag><rdf:li>街头</rdf:li><rdf:li>逆光</rdf:li></rdf:Bag>
   </dc:subject>
   <lr:hierarchicalSubject>
    <rdf:Bag><rdf:li>景别|特写</rdf:li><rdf:li>色调|暖调</rdf:li></rdf:Bag>
   </lr:hierarchicalSubject>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
```

⚠️ 三个必须注意的细节：

1. **文件名的扩展名用小写 `.xmp`**。Adobe 官方例子是大写 `.XMP`，但 Windows 不区分大小写，且 Lightroom 两种都能读。统一小写能避免同一目录出现 `.xmp` 和 `.XMP` 两个文件。
2. **XML 特殊字符必须转义**：标签里的 `&`、`<`、`>` 要转成 `&amp;` `&lt;` `&gt;`。用户标签叫「A&B 咖啡」的时候会炸。
3. **写文件用原子替换**：先写 `.xmp.tmp` 再 `rename`，避免写到一半断电留下半个文件，Lightroom 直接读崩。

### 4.3 RAW + JPEG 配对的情况

月相有 RAW/JPEG 配对功能。一个 `DSC_0001.NEF` + `DSC_0001.JPG`：

- 两边的 XMP 文件名会**撞车**（都要 `.xmp`）
- 行业惯例：XMP 只对应 RAW，JPEG 作为附属
- **策略**：只写 RAW 的 XMP，JPEG 那张跳过并记日志

---

## 5. 风险

| 风险 | 应对 |
| --- | --- |
| 只读盘 / 网络盘写不进去 | 捕获异常，静默跳过 + 记日志，不影响主流程 |
| 和 Lightroom 同时在用 | 靠 mtime 冲突检测，绝不静默覆盖 |
| 用户标签里有 XML 特殊字符 | 统一转义函数，写前过滤 |
| 3 万张全量写很慢 | 只提供"手动全量导出"，跑在后台线程 + 进度条 |
| 用户不想要 XMP | 设置里一个总开关，默认关闭；开了才写 |

**默认关闭**这一条很重要——写别人的照片目录是有副作用的操作，必须用户明确同意。

---

# 第二部分 · facet 计数：实测后撤回

## 1. 我之前的判断

> `listFacets` 里那段 `LEFT JOIN + SUM`，3 万张还行，10 万张就会拖慢工作台打开速度。

**这句话是我拍脑袋说的。** 现在拿主人的真实库跑了一遍。

## 2. 实测数据

用 `E:\照片\img_cache\library.db`（真实库，不是造的）：

```
第 1 次：0.9 ms，59 行
第 2 次：0.1 ms，59 行
第 3 次：0.1 ms，59 行

数据规模：items 31894，item_tags 31813，facets 9
```

**0.1 毫秒。** 不是"还行"，是根本不存在。

## 3. 为什么这么快

查询计划显示每一层都走了索引：

```
SCAN f USING INDEX sqlite_autoindex_facets_1
SEARCH t USING INDEX idx_tags_facet (facet_id=?)
SEARCH it USING INDEX idx_item_tags_tag (tag_id=?)
SEARCH i USING INTEGER PRIMARY KEY (rowid=?)
```

- facets 只有 9 行，全扫也没成本
- `tags.facet_id` 有 `idx_tags_facet`
- `item_tags.tag_id` 有 `idx_item_tags_tag`
- `items` 用主键 rowid 直接定位

真正的耗时在 `USE TEMP B-TREE FOR GROUP BY`，但结果集只有 59 行，建临时 B 树就是眨眼的功夫。

**按线性外推，10 万张大约 0.3–0.5 ms，100 万张也就几毫秒。** 这条根本不用优化。

## 4. 结论

**不做任何优化。** 加缓存、加计数器表、加触发器，全都是在给一个不存在的问题写代码——而且会引入"缓存不一致"这个真实的新问题。

我之前那句"隐性技术债"是错的，撤回。

## 5. 那真正该盯哪里

如果以后真觉得慢，先做 profiling 再动手，别猜。按经验，这类素材库的瓶颈通常在这几处（**但都需要实测确认**）：

| 候选 | 怎么测 |
| --- | --- |
| 瀑布流列表查询（多条件叠加） | 用真实筛选条件跑 `EXPLAIN QUERY PLAN` |
| 首次生成缩略图 | 看导入 500 张的总耗时分布 |
| FTS 全文搜索（trigram 分词较慢） | 搜一个常见词，量耗时 |
| 语义搜索的向量扫描 | 3 万条 × 512 维，全量算余弦相似度可能真的慢 |
| 大批量导入时的事务切分 | 看导入过程中 UI 是否卡顿 |

**语义搜索那条我最怀疑**——如果现在是把所有向量读进内存暴力算，3 万条还行，10 万条就会明显卡。但这也得测了才算数。

---

# 一句话总结

- **XMP**：做，但默认关闭、只写人的判断、facet 映射成层级关键字（这条最赚）
- **facet 计数**：不做，实测 0.1ms，我之前判断错了
