# COL Character Studio

一个 Perchance 生成器：**角色 AI 工作室**。它不是画图工具，也不是提示词生成器，而是一个围绕
「一个持续存在的角色项目」组织的编辑环境：**角色卡 + 主 AI 聊天**。

当前项目：`COL-001` · 角色「哥伦比娅」。

- 角色卡（左）＝ 收藏 / 角色 / 结果 —— 这个角色是什么、上一张图长什么样
- AI 聊天（右）＝ 现在要做什么 —— 主 AI 对话 + 所有进阶面板（折叠在底部）
- 底部状态栏 ＝ 项目状态

页面代码运行在 perchance 的 iframe 里，唯一对外可见的 URL 是
`https://perchance.org/${window.generatorName}`。

> 历史：早期版本有一个独立的第三栏「场外调试 AI」。该面板已删除；其中真正有价值的
> **确定性体检**（`src/checks.js`）保留下来，现在折叠在 AI 聊天面板底部的
> 「系统体检与 Prompt 视图」里，修复动作改由主 AI / 手动编辑承担。

### 界面语言约定（重要）

**整个界面一律中文。** 只有以下四类允许出现拉丁字母，不要「顺手翻译」它们：

1. 品牌与技术标识：`COL` / `COL-001`；
2. 数据格式名：`JSON`；
3. **图像 prompt 片段**（英文提示词本身，界面上以「提示词片段 ·」前缀标注）；
4. 用户自己的内容：参考图 URL、聊天记录、变更日志里用户/AI 写入的原文。

新增任何 UI 文案请用中文。所有面向用户的错误/状态/按钮/标题都由 `src/*.js` 动态生成，
不要在 HTML 里塞英文兜底文本。

---

## 1. 文件结构

```
main.pjs            perchance-js 代码：$meta + 三个插件 import（无逻辑）
index.html          <body> 内容：双栏布局骨架 + 所有控件 id + 入口 <script>
src/styles.css      全部样式（暗色 studio 主题、响应式网格、标签页、进度条）
src/state.js        数据模型：默认项目、Character Core 分组、覆盖字段元数据、规则槽、纯函数、migrate()
src/prompt.js       Prompt 组装（含身份锚定）+ 主 AI 的 instruction 构造 + JSON 抽取与修复
src/checks.js       确定性体检（人物形象锁定 / 一致性冲突 / 层完整性 / 覆盖卫生 / Prompt 顺序 …）
src/ai.js           唯一的 AI 调用层（generateText / generateImage）+ 写入闸门 applyActions（含形象锁定闸门）
src/store.js        kv-plugin 持久化（项目 / 角色卡 / 快照 / 备份 / 收藏）
src/app.js          UI：渲染、事件、动作编排、boot
```

`index.html` 只用相对路径引用 `src/*`，`src/app.js` 用相对路径 import 同目录模块，
所以把这一整棵树按原样放进 Perchance 编辑器的文件面板即可运行（`main.pjs` 与 `index.html`
是编辑器里的两个特殊文件，其余文件放在 `src/` 下）。

**没有依赖打包、没有构建步骤、没有外部服务。**

---

## 2. 数据模型（`src/state.js`）

一个 project 对象就是全部状态（JSON 可序列化）：

| 字段 | 作用 |
| --- | --- |
| `code` / `name` | `COL-001` / 哥伦比娅 |
| `task` | Current Task（一句话当前任务） |
| `characterCore` | `{ locked, groups[] }` — **锁定身份** |
| `referenceImage` | 角色视觉基准图 URL |
| `defaults` | 默认常服 / 外层 / 配饰 / 姿态 / 表情 / 背景 / 第二人物 |
| `overrides` | 7 项 Current Overrides（见下） |
| `cast` | `{ mode: "single" \| "multi", count }` — 单人 / 多人模式 + 除主角外的人数（1..`CAST_COUNT_MAX`=5，见第 4 节） |
| `memory` | Project Memory 五个字段 + changeLog |
| `rules` | 8 个规则槽，原样注入主 AI 上下文 |
| `promptPolicy` | 风格 / 取景 / 硬约束行 / 负面提示词 |
| `render` | 种子、分辨率、上次渲染的 prompt / negative / 各层快照 |
| `chats` | `main` 一组聊天记录（`mainSummary` 为压缩摘要） |
| `meta` | revision、保存时间、Core 指纹 |

**Character Core 的 7 个分组**（locked 时不可编辑、不可被 AI 修改）：
`hair` 发长发色渐变、`bangs` 齐刘海、`braids` 脸侧编发、`lace` 编发白色交叉蕾丝、
`wings` 脑后耳朵高度四枚白色羽翼装饰（左右各两枚、横向展开，**不是背部翅膀**）、
`face` 浅色皮肤 / 闭眼 / 红晕、`aura` 安静梦幻疏离。

每组分 `text`（中文界面显示）与 `prompt`（英文，进入图像 Prompt），外加 `keywords`（体检用）与
`negative`（Core 锁定时并入负面提示词）。

**Current Overrides 的 8 项**（`OVERRIDE_KEYS`）：
`currentOutfit`（base）、`currentOuterOutfit`（outer）、`currentAccessories`（accessories）、
`currentHairstyle`（hair）、`currentPose`（pose）、`currentExpression`（expression）、
`currentBackground`（background）、`currentPartner`（partner，只有多人模式才进画面）。

每项覆盖是 `{ value, prompt, source: "default" | "override", updatedAt, note }`。
`effectiveOf()` = 有覆盖用覆盖，否则用默认；`currentHairstyle` 默认来源标记为 `core`。

**旧存档迁移 `migrate(project)`**：把早期英文版的默认规则文本、默认发型文本换成中文。
采用**逐槽比对**（`LEGACY_RULES` / `LEGACY_HAIRSTYLE_TEXT`），只有当某个槽**仍然等于**旧默认串时
才替换，所以用户自己改过的内容不会被覆盖。在 `boot()`、`加载 COL-001`、导入 JSON 三条路径上调用。
（`createDefaultProject()` 不再产出旧字符串，迁移表里存的是显式副本。）

### 服装层级（本项目的核心约定）

```
Base Outfit  →  Outer Outfit  →  Accessories
```

「给她套上这件大衣」＝ **保留 Base Outfit，写入 `currentOuterOutfit`**，不是重做整套角色。
只有用户明确说「更换默认常服 / 设为默认」才会写 `defaults.outfit`。

---

## 3. 两个区域各自的职责

### A. 角色卡（`#panelCard` · `data-sec`）

1. **`fav` · 收藏** — **不再自动收藏**。渲染成功后状态行提示「满意的话点「★ 收藏」把它存进收藏」，
   由用户手动点 `★ 收藏`（`#favThisBtn`）决定要不要存（kv `colFavorites`，最多 24 张，超出丢弃最旧）。
   按钮下方 `#favStateEl` 显示「当前结果已在收藏中（时间）」或「当前结果尚未收藏。」，
   已收藏时按钮变金并显示 `★ 已收藏`（`favoriteOfCurrent()` 按 dataUrl 判重，不会重复收藏）。
   缩略图网格：点击 = 切回那张结果（写回 `project.render.last*` 并记一条 `favorite` Change Log），
   `✕` = 删除（二次确认）。缩略图的 `title` / `alt` 用中文动态生成
   （`时间 · 种子 N｜随机 · 分辨率`），不使用存档里的 label 字符串。
2. **`char` · 角色** — 参考图（身份基准）+ 参考图 URL 输入 + Character Core 概览。
   锁定时 Core 收在一个折叠行 `Character Core · 身份基准（N 组）` 里，展开为只读行；
   `解锁` 需二次确认，解锁后自动展开并变成可编辑 textarea（blur 提交，记入 Change Log）。
   分组标题下方有一行 `.lock-note` 提示：形象已锁定，AI 只能改动覆盖层，不会改动这七组。
3. **`result` · 结果** — 渲染进度条 → 预览图 → `渲染角色图` / `连拍候选` + 张数输入（`#candidatesCount`，1-30）
   / `★ 收藏` → 候选网格（`#candidatesWrap`：同一提示词连拍 n 张，每张点「选用」即写回当前结果）
   → 人物数量（`单人 / 多人` 段控 + `#castCount` 同框人数 + 一行说明 `#castHint`）→ 种子锁 + 种子 + 分辨率
   → 元信息行（时间 / seed / 分辨率 / Prompt 字符数 / 层链，层链末尾会带 `· 单人` / `· 多人`）。

   **连拍（`doCandidates`）**：生成服务即使固定 seed 也不是确定性的，所以「多人 / 复杂构图崩坏」的
   实际解法是连拍几张再挑一张。`doCandidates` 依次调用 `root.generateImage`（沿用当前 seed / 分辨率），
   结果堆进 `candidates` 数组渲染成网格，点「选用」写回 `render.last*` 并记 `favorite`-类日志。
   张数被 `Math.min(30, …)` 夹住（>30 张会白等很久）。

   **重置为出厂 COL-001**（`#resetBtn` → `resetProject()`）：**先自动存一份快照**
   （label `重置前自动快照 HH:MM:SS`）再清空，所以「重置」永远可回退（在「数据」折叠区的快照列表里点
   「恢复」）。重置内容 = `createDefaultProject()`：单人或 1 人、无任何覆盖、出厂任务与规则；
   日志记一条 `kind: "reset"`，并把快照时间写进 note。

窗口变窄到一定程度时，两个面板变成标签页（`角色卡` / `AI 聊天`），一次只显示一个。

### B. AI 聊天（`#panelChat`）

上部是对话本身：`Current Task` 输入框 → 聊天记录 → 快捷指令（套上大衣 / 换姿势 / 换发型 /
查看常服 / 切换成多人场景 / 回到单人场景 / 全部恢复默认 / 检查一致性）→ 输入框 → 状态行。

底部 `#advArea` 是五个折叠区（**默认全部收起**），承载所有进阶/手动功能：

| 折叠区 | 内容 |
| --- | --- |
| 服装与外观 · 手动编辑 | Base / Outer / Accessories 三层字段 + Look（发型/姿势/表情/背景）+ 第二人物（多人模式，带 `#castBadge` 当前模式徽章） |
| Project Memory 与 Change Log | 五个记忆字段 + 变更日志（含 blocked / pending / noop / favorite 等类别） |
| 规则库 Rules | 8 个规则槽，原样注入主 AI 上下文 |
| 系统体检与 Prompt 视图 | 体检分数与清单（第一项固定为「人物形象锁定」）、逐层 Prompt 构建视图（已变化 标记）、最终 / 负面 Prompt |
| 数据 | 保存快照（最多 8）、导出 / 导入 JSON、重置为出厂 COL-001 |

快照列表每行 = `时间 · label · 恢复`（恢复前二次确认；恢复后写一条 `kind: "restore"` 日志，
并靠 1.2s 防抖自动保存落盘 —— 自动化脚本改完状态请显式调 `window.__colStudio.save()`）。

每个覆盖字段行有三颗按钮：`保存为覆盖` / `保存到默认` / `恢复默认`，并显示来源徽章
（`默认` / `覆盖` / `基准`）与最后更新时间。手动修改不会被 AI 的写入闸门拦截。

用户消息发出后：

1. 组 instruction（`buildMainInstruction`）：`MAIN_PERSONA` → `<CHARACTER_CARD>`（Core、默认层、
   Reference Image）→ `<PROJECT_RULES>` → `ACTION_SPEC` → `<CHAT_LOG>` → `<LIVE_STATE>`
   （Current Overrides / Project Memory / Recent Changes）→ `<TASK>`。
2. 流式调用 `root.generateText`（`onChunk` 实时显示，自动剥掉 `<action>` 区块）。
3. 从回复尾部抽取 `<action>` JSON（`extractJsonBlock`，失败会自动重试一次纯 JSON）。
4. 经过**写入闸门** `applyActions()` 才落到 state（见第 5 节）。
5. 更新 Project Memory、追加 Change Log、自动保存。

### 渲染进度条

`startRenderProgress()`（`src/app.js`）在按下 `渲染角色图` 时启动：每 120ms 按
`92 * (1 - e^(-t/14))` 收敛到 92%，并随耗时切换阶段文案（组装 Prompt 层 → 提交给生成服务 →
正在生成图像 → 仍在生成 → 仍在等待 → 等待时间较长），每段都带已用秒数。返回的 `done(ok, label)`
在成功时补到 100% 并淡出（1.2s），失败时停在当前位置并变红常驻。`stopRenderProgress()`
在重置/重置项目时清掉。

---

## 4. Prompt 组装（`src/prompt.js`）

`buildImagePrompt(project)` 按固定顺序拼层：

```
core → base → outer → accessories → hair → pose → expression → background [→ partner]
```

- 每层取 `prompt || text`（有英文 prompt 就用英文）。
- `hair` 层只在发型是 override 时才出现（否则由 Core 表达发型）。
- 前缀固定 `1girl, solo, anime illustration`（多人模式下换成
  `2 people (1girl, 1boy), one woman and one adult man in the same scene, anime illustration`），
  随后是 `promptPolicy.style` / `.frame` / `.guardLines`。
- **身份锚定（防「人物形象有变」）**：Core 锁定且没有任何 Core 分组被覆盖时，
  prompt 会以 `identity lock — keep exactly the same character design, do not change any of:
  <Core 关键词>` **开头**，并以 `identity re-asserted — these features must match the reference
  exactly and must not be altered: <Core 完整 prompt>` **结尾**，把身份特征夹在首尾两端。
  `发型覆盖` 层还会追加 `, while keeping unchanged: <发/刘海/编发/蕾丝/羽翼 关键词>`，
  除非该覆盖文本本身已经提到了其中 ≥3 个关键词。
- 负面提示词 = `promptPolicy.negativePrompt` + （Core 锁定时）每个 Core 分组的 `negative`
  + 固定追加 `different character, inconsistent character design, changed face,
  different hairstyle, different hair color`（单人模式还会再加 `multiple characters`）。
- 返回 `{ prompt, negativePrompt, layers, changedLayers }`；`changedLayers` 是相对
  `render.lastLayers` 变化的层，用于「同步状态」体检与 CHANGED 标记。

### 单人 / 多人模式（`project.cast.mode`）

`cast.mode` 只有两个取值：`"single"`（默认）与 `"multi"`。它决定「画面里有几个人」，
是**唯一**能让第二个人出现在图里的开关；`cast.count`（`CAST_COUNT_MAX = 5`）是**除主角外**的人数，
只由 `castCountOf()` 读取（`Number.isFinite` 校验 → `Math.round` → 夹在 1..5），
`cast.mode === "single"` 时它一律返回 0。

- **只有 `cast.mode === "multi"` 且 `overrides.currentPartner`（第二人物）有内容时**，
  才会往 layers 里追加 `partner` 层；单人模式下即使 `currentPartner` 有残留文本也不会渲染，
  只会让 `cast-mode` 体检给一条 warn。
- `partner` 层的文本 = 用户/AI 写的第二人物描述 + 固定的英文补语
  （1 人时 `— a separate second character standing close to her, with his own distinct face and
  design (do not copy her features onto him)`；多人时 `— these are N separate characters, each with
  their own distinct face and design (do not copy her features onto them)`）。
- **人数标记由 `castInfo(project)` 统一算**，不再从文本里猜总数：它会先抹掉 partner 文本里
  指代主角的词（`the woman / her / 主角 / 她`），再用中英文正则数男方/女方，得到
  `{ extra, total, males, girls, token, frame }`。`token` = `N people (1girl, Nboys)`。
  默认（没有任何性别词）按「男方」处理，即 `males = extra`——旧的 `2 people (1girl, 1boy)` 硬编码
  已被取代。`castOtherLine(cast)` 再补一句「其他人是谁」：`the other N people are adult males with
  masculine faces and short hair, clearly not women, …`。
- **负面词也要按人数生成**：`castNegatives(cast)` 固定给
  `two copies of the same girl, duplicate identical face, the other people copying her features,
  merged bodies, conjoined bodies, bodies fused together`，并按人数追加
  `more than N people, an extra person beyond the N in the scene, a crowd, extra people`；
  `girls <= 1` 时再加 `a second woman, another girl, two women, 2girls, duplicate of the heroine`，
  `males > 0` 时再加 `feminine male face, a woman instead of a man, androgynous male face,
  effeminate men`（不写这些，模型会把男主角画成女孩）。
  注意负面词里**不要**写 `extra head`：它会连第二个人该有的头一起压掉。
- **构图替换**：多人模式下不用 `promptPolicy.frame`（`upper body portrait, centered, facing the
  viewer` 会强行把画面拉成单人头像），改用 `cast.frame`
  （`medium shot, all N people fully visible in the same frame, close physical interaction between
  them, each of them a clearly distinct person`）。
- **第二人物前置锚定**：`partner` 层在 `layers` 里仍排在最后（层序语义不变），但在**拼装字符串**
  时它的描述被提到 `cast.token` 之后（`the other people (N of them, separate from the heroine): …`），
  否则男人的描述被女性身份描述和 `identity re-asserted` 淹掉，模型会画出「两个女孩」。
- **第二人物不参与身份锁定**：`applyActions` 的 `appearanceBlock()` 对
  `currentPartner` 直接返回 `null`，`checkAppearanceLock()` 也跳过它（它是另一个人，
  当然不该长成哥伦比娅）。
- **负面词要按模式过滤**：`SOLO_ONLY_NEGATIVES`（`multiple characters, action pose`）是「单人专用」
  负面词，会压制第二个人和双人互动，所以在多人模式下从最终负面提示词里逐条剔除
  （`multiple characters` 同时也不再追加进 core 那行负面词）。
- **脱衣场景的守护句**：`promptPolicy.guardLines` 里的 `fully opaque, complete clothing`
  在检测到**真实脱衣/裸体线索**时（`UNDRESS_RE`：`裸 / 脱光 / 褪去 / 仅余 / 不穿 / 只穿内衣却写「仅余」/ nude / top*less`，
  命中服装/外层/第二人物/姿势文本）会被替换为 `UNDRESS_GUARD`
  （「说脱掉的就是彻底脱掉、不要又加回衣服」+ 保留 `fully opaque` 不透明要求）。
  只写「内衣 / underwear」不触发替换——内衣也是衣服，需要完整不透明地画出来；
  但「仅余内衣 / 不穿内裤」这类**缺少**衣物的写法会触发，否则「完整衣物」会和描述互相打架、
  模型退回穿好衣服的构图。
- 纯单人文本（如「一个人」「独自」）命中 `inferTargets()` 的 `singleRe` 时会自动切回 single；
  命中 `multiRe`（`多人|双人|男人|做爱|…`）时切到 multi，并在 AI 写入非空 `currentPartner`
  后自动把 `cast.mode` 置为 `multi`（无需用户手动切）。
- 相关体检：`checkCastMode()`（多人但第二人物为空 / 缺 `partner` 层 / 负面词里还留着
  `multiple characters` → fail；单人但留着 `currentPartner` → warn）。

#### 多人模式的提示词顺序（照着改，别凭直觉调）

多人模式的 prompt **不是**单人那张层序的直接拼接，而是：

```
N people (1girl, Nboys), anime illustration
→ SIGNATURE_LINE（身份签名：渐变发尾 / 齐刘海 / 闭眼 / 耳侧四枚白色羽饰）
→ the other people (N of them, separate from the heroine): <partner 文本>
→ castOtherLine → cast.frame
→ the woman: <multiIdentity 紧凑身份行>
→ 其余层（base〔可能被跳过〕/ outer / accessories / hair / pose / expression / background）
→ promptPolicy.style → guardLines
```

- **`SIGNATURE_LINE` 要放在最前面**：渐变发尾 + 耳侧四枚白色羽饰是最容易画丢、也最能一眼认出她的
  两个特征，写在人数标记之后、其他人的描述之前；放到后面会被两位男性的描述稀释。
- **`the woman:` 那一行用紧凑身份 `multiIdentity()`**，不用 400 字的身份散文。
  2026-09-15 的对照实验（种子 771，512x768，同一句三人提示词）：写完整身份散文时
  「1 女 + 2 男」只有 **3/22** 张正确（模型会把两套衣服 / 两套发型分别画在两个「她」身上，
  甚至画出 5-6 个人）；换成紧凑身份行后 **11/16**。`multiIdentity()` 仍逐字保留
  蓝黑发 + 酒红渐变、齐刘海、闭眼浅肤、两条耳后细长编发 + 白色交叉细绳、耳侧四枚白色羽饰、气质。
- **`core` 层本身不进多人 prompt**（它被 `SIGNATURE_LINE` + `the woman:` 取代），
  但**仍然留在层列表里**，所以「层完整性」体检照常看得见它。
- **只渲染最外层服装（关键）**：多人模式下如果同时存在 `base`（基础常服）与 `outer`（外层服装）
  两个非空服装层，`base` 会被标记 `skipped = true`（`skipReason` 说明原因、`skipLabel = "多人模式未写入"`），
  **不写进 prompt，但保留在层列表里**（界面用一条灰掉 + 划线的行显示，徽章是红色的「多人模式未写入」，
  切回单人模式即恢复）。原因：把内衣/比基尼和泳装两层都写进三人提示词时，模型会把两套衣服
  分别穿在**两个「她」**身上——实测 4 张里 4 张多出一个女人（甚至 5 个人）；
  只留最外层后同一 seed 下「1 女 + 2 男」是 **4/4**。
  单层服装（只写了 base 或只写了 outer）不受影响。
- **盘发 / 扎发 × 身份锁的自相矛盾要被消解**：`hairstyleConflict(project)` 从发型覆盖里识别
  盘发（`UPDO_RE`）与短发（`SHORT_HAIR_RE`）。命中盘发时 `corePrompts()` 把 `hair` 分组整句
  换成 `UPDO_HAIR_LINE`（「盘起来也依然是同一头头发、渐变覆盖下半段、发尾最浓」），
  并在负面词里**删掉** `gradient only at the very tips`——它和发型覆盖里的「发尾渐变」
  互相抵消，结果就是用户报的「渐变头发不见了」。`multiIdentity()` 也有对应的盘发版本。
  **这一条是「她根本不像她」的头号原因**（发型覆盖 + 身份层同时进 prompt，模型只能随机取舍）。
- 发型覆盖层里固定追加一句 `SIGNATURE_SHORT`（同一头头发 + 渐变 + 四枚白色羽饰），
  再加 `, while keeping unchanged: <发/刘海/编发/蕾丝/羽翼 关键词>`。

#### 实测记录（2026-09-15，种子 771，512x768，`root.generateImage`）

- 单人模式下描述「和一个男人在房间里做爱，脱光衣服」时，第二个人会与主角**糊在一起**
  （变成同一个人的重影）——这正是加多人模式的原因。切到多人模式后同一句提示词渲染出
  **两个可分辨的人**（男性短发、赤裸上身、独立面孔）+ 昏暗卧室床铺。
- 修复后（紧凑身份 + 只渲染最外层 + 多人顺序 + 正面签名）连拍 4 张：
  **4/4 都是「1 女 + 2 男」**，渐变发尾 4/4、两条编发 4/4、闭眼 4/4、
  耳侧白色羽饰 3/4 张是四枚（1 张只画出两枚——分辨率下小发夹的数量模型数不准，属于模型限制）。
- **3 人以上不要用 768x768**：同一提示词在 768x768 下会画出 5-6 个人，512x768 才稳定。
- 一句必须在正面的提示词之外的教训：**多人同框本质上是概率性的**（固定 seed 也不确定），
  所以界面上给了「连拍候选 + 张数」而不是追求一次命中。

### 用词规则（实测得出，改 prompt 前先读这里）

在**没有任何 image-to-image 能力**的前提下（见第 10 节），提示词用词直接决定形象会不会漂移。
下面几条是拿锁定种子反复渲染 + 视觉比对得出的结论；改动它们时请用同样方式重新验证
（`window.__colStudio.buildPrompt(project)` 拿到 prompt，直接 `root.generateImage({...})`
渲染多张，再用 vision 比对）。

- **正面提示词里不要出现 `wing` 这个词。** 一旦出现（哪怕是 `wing ornaments`、
  `NOT wings`、`head-mounted wings`），模型就会画出一对巨大的翅膀。头部装饰现在一律表述为
  `small white feather hair clips / feather-shaped hair accessories`，
  「翅膀」只出现在**负面提示词**里（`back wings, angel wings, large wings, …`）。
  `guardLines` 与默认配饰里旧的 `head-mounted wing ornaments` / `feather wings`
  已在 `migrate()` 里改写为羽毛发夹的说法。
- 「四枚」要写清位置关系（`one above the ear and one below it on each side`）；
  只写 `two on each side` 时模型常只画两枚。
- 头部装饰的**尺寸**要给参照物（`each about the size of her ear`），否则会画成扇子/翅膀。
- 编发上的白色交叉缎带：写 `a thin white cord laced crosswise through it along its whole length`
  （关键词 `laced crosswise` + `down the plait`）。只写 `crisscross ribbon`，
  模型会在发尾画一个蝴蝶结。**不要**在编发里用 `corset-style cross lacing` ——
  这个词会溢出到服装上，在胸口画出一片系带；`lace-up neckline / corset lacing on clothing`
  已进负面词。
- 渐变要同时给起点和终点（`starting around the mid-length (mid-back)` +
  `strongest at the hair tips`），否则红色会跑到最底端或跑到肩膀。
- **同一个种子不代表同样正确**：种子 20250815 下这组提示词只画出两枚羽翼、且编发没有缎带；
  种子 771 下四枚羽翼位置全对（上下各一），但编发上的**交叉**缎带仍画不出来（缎带只落在发尾打成结）；
  91234 下缎带出现但渐变偏靠发尾。锁种子是为了前后可比，
  但**换种子是修细节最省力的手段**（一个描述字都不用改）。
- **项目默认锁定种子 = 771**（2026-09-15 由 20250815 改过来，用户确认后写入 `project.render.seed`）。
  当时的实测结论：771 在「四枚耳高羽翼」这一项上是三个种子里唯一全对的，因此选它当基准种子。
  若以后改动了 prompt 用词，请重新用 3 个种子渲染 + vision 比对，再决定是否换种子。
- **多人模式（2 人以上）另有三条铁律**，来自 2026-09-15 的对照实验（同一 seed 各渲染 3-6 张，
  vision 逐张判定「画面里有几个女人」）：
  1. **身份描述要短**。把单人那 400 字身份散文写进三人提示词，模型会把它当成「另一个人」，
     正确率 3/22；改用 `multiIdentity()` 的紧凑身份行（约 60 词）后 11/16。
     短不等于丢特征：渐变发尾 / 刘海 / 编发 / 白色交叉细绳 / 四枚耳侧羽饰 / 闭眼 / 气质仍逐字在。
  2. **服装只写一层**。两层衣服（内衣 + 泳装）写进三人提示词会让模型把两套衣服分别穿到
     两个「她」身上（4/4 张错）；只保留最外层后 4/4 张正确。代码里就是 `base` 层被 `skipped`。
  3. **服饰层不要拆成多个从句**。「泳装」+「白丝」被拆成两句短语时（`wearing X, wearing Y`）
     模型会分给两个人（0/4）；合并进同一个 `wearing …` 从句才对。
- **小装饰的数量不可控**：耳侧四枚白色羽饰在 512x768 下有时只画出两枚。可以让它更显眼
  （别写小尺寸参照物）、或者靠连拍挑一张；不要期待 100%。

---

## 5. 写入闸门（`applyActions`，`src/ai.js`）

**这是本项目最重要的安全机制**，也是修「AI 擅自改服装」的地方。所有 AI 产出的 changes
都要经过它，按顺序做四道检查：

1. **路径白名单** `validatePath()` — 只允许
   `overrides.*` / `defaults.*` / `referenceImage.url` / `task`；
   任何含 `characterCore` 的路径直接拒绝（`blocked`）。
2. **噪音过滤** `isNoop()` — 与当前生效取值相同的改动直接丢弃并记一条 `noop`
   （Changelog 里写作「忽略 N 项与当前状态相同的改动」）。防止 AI 复述当前状态时
   把默认层「提升」成覆盖，从而悄悄改变 Prompt。
3. **意图范围闸门** `inferTargets(userText)` — 从用户原话里扫出本次点名的层
   （关键词表 `SCOPE_PATTERNS`），用户没点名的层即使出现在 changes 里也**不写入**，
   而是进入 `pending`（待确认）。`恢复默认 / 重置 / 全部恢复` 视为全量放行，
   这样「全部恢复默认」这类指令仍然一次生效。
   → 这条专治「我只说了换内衣，AI 顺手把大衣覆盖删了」。
   `inferTargets` 只扫「裸句」：先剥掉 `保留 / 保持 / 不要改` 从句，再去匹配关键词，
   所以「套上新大衣，保持服装和发型不变」只点名 `currentOuterOutfit`。
4. **默认层需明确授权** — 任何 `defaults.*` 写入，若用户原话没有出现
   「更换默认常服 / 基础常服 / 设为默认 / 永久改成 …」，一律进入 `pending`，
   必须由用户点「确认应用」才写入；写入前还会自动存一个快照
   （`auto · 修改默认层之前`）。
5. **人物形象锁定闸门** `appearanceBlock()` — Core 锁定时，任何改动只要在语义上
   与锁定的身份冲突，**直接硬拦**（`blocked`，reason 形如
   `违反人物形象锁定：发型长度/发色…`），不写 state、不留 pending。
   判定用 `checks.js` 导出的 `appearanceViolations(text)`：把改动文本（value + prompt）
   去匹配两条规则——
   - 与某个 Core 分组的 `keywords` 矛盾（例如「金色 / 短发 / 睁眼 / 没有羽翼 / 背后翅膀」），
   - 或该分组被整体覆盖，而改动文本里又出现了「去掉 / 没有 / 改成 / 换成 …」这类否定改写词。
   （判定用的是 `CONTRADICTIONS` 里的正则表，`lock: true` 的那几条才会拦写入；
   正则同时覆盖中英文写法，例如 `short hair|短发`、`eyes open|睁眼`、
   `back wings|背后翅膀|大翅膀`。）
   `referenceImage.url` 的改动同样受保护：用户原话没有点名参考图时进入 `pending`，
   不会因为 AI 顺手「更新参考图」而把身份基准换掉。解锁 Core 后此闸门关闭。
   → 这条专治「AI 擅自改人物形象」。实测：换发色 / 换发型长度 / 睁眼 / 去掉羽翼 全部被拦，
   而合法的 `currentPose` 改动仍然正常写入。

`pending` 在聊天里渲染成一张带 `确认应用` / `忽略` 按钮的卡片；确认后走
`applyActions(..., { force: true })`，仍然保留路径白名单与噪音过滤。

第 5 道的两个例外（都是 2026-09-15 为多人模式加的）：

- `currentPartner` **不参与**形象锁定判定（它是另一个人，不该长成哥伦比娅）。
- AI 写入了非空的 `currentPartner` 且用户原话命中多人词时，`cast.mode` 会被自动置为
  `"multi"`；用户说「一个人 / 独自 / 单人」则自动切回 `"single"`。切模式本身也走
  Changelog（`kind: "manual"`，`path: "cast.mode"`）。

---

## 6. 持久化（`src/store.js`，kv-plugin）

五个 kv 文件夹：`colProject`（主存档）、`colCharacter`（角色卡快照）、
`colSnapshots`（最多 8 个人工/自动快照）、`colBackup`（上一次非自动保存的完整备份）、
`colFavorites`（渲染收藏，最多 24）。

- 页面加载时自动 `loadProject("COL-001")`。
- 改动后 1.2s 防抖自动保存（label `autosave`，不覆盖备份槽）。
- **读取失败 ≠ 没有存档**：读取抛错时会尝试备份槽，置 `storageSuspect = true` 并
  **暂停自动保存**，避免用出厂默认覆盖用户存档；需要用户手动点「保存项目」才恢复。
- 导出 / 导入 JSON 走 `exportJson` / `importJson`（会校验 `characterCore` 与 `overrides`）。

---

## 7. 插件

`main.pjs` 里只有三行 import（其余全在 `src/`）：

```pjs
generateText = {import:ai-text-plugin}
generateImage = {import:text-to-image-plugin}
kv = {import:kv-plugin}
```

代码里一律通过 `root.generateText` / `root.generateImage` / `root.kv` 访问。
`waitForPlugins()` 会等 `root.generateText` 就绪；未就绪时角色卡与状态系统仍可用，
只有 AI 与渲染不可用（会在聊天里给出提示）。

---

## 8. 怎么跑

1. 在 Perchance 编辑器里打开本生成器：`main.pjs` + `index.html` 照原样，其余文件放在 `src/`。
2. 预览即用。首次进入会自动载入出厂 `COL-001` 并写入本机 kv。
3. 「加载 COL-001」从存档恢复；「保存角色」只存角色卡；「保存项目」存完整项目。
4. 想验证视觉一致性：`渲染角色图` → 改动一项 → 再 `渲染角色图`（种子锁定）。

测试钩子：`window.__colStudio` 暴露 `project`（getter）、`favorites`、`sendMain`、`doRender`、
`refreshFavorites`、`favoriteCurrent`、`favoriteOfCurrent`、`runChecks`、`buildPrompt`、
`buildInstruction`、`inferTargets`、`applyActions`、`appearanceViolations`、`castModeOf`、
`setCastMode`、`castCountOf`、`setCastCount`、`render`、`reset`，以及三个给自动化用的口子：
`touch()`（只排一次防抖自动保存 —— **`page_refresh` 会把它吃掉**，脚本改完状态请改用
`await save()` 立即落盘）、`save()`（`Store.saveProject` + 刷新状态栏）、
`resetProject(label)`（= 界面上「重置为出厂 COL-001」：先自动快照再清空，返回快照 key）。

```js
// 自动化改状态：必须先 { force: true }（否则会被意图范围闸门拦成 pending），再 save() 落盘
await window.__colStudio.applyActions(changes, { force: true, userText: "…" });
await window.__colStudio.save();
```

例：直接验证写入闸门
`window.__colStudio.applyActions([{ path: "overrides.currentHairstyle", value: "金色齐肩短发", prompt: "short blonde bob hair" }], { userText: "换个发型" })`
应返回 `blocked:[{ reason: "违反人物形象锁定：…" }]`。

---

## 9. 体检分数怎么算

`runChecks()` 固定跑 13 项检查（顺序即界面顺序），`src/checks.js`：

```
分数 = round(通过项数 / 13 * 100) - 失败项数 * 10 - 警告项数 * 3
```

每项分 `pass` / `warn` / `fail` 三档；界面用 `healthLabel()` 显示：≥90「健康」、
≥70「需要注意」、更低「存在冲突」。

13 项按顺序是：`appearance-lock`（人物形象锁定，第一项固定）→ `cast-mode`（单人 / 多人模式）
→ **`multi-outfit`（多人模式服装层）** → `core-presence`（角色基准特征完整性）
→ `reference`（参考图）→ `prompt-order`（Prompt 层顺序）→ **`prompt-language`（图像提示词语言）**
→ `layer-integrity`（层完整性）→ `outfit-layering`（服装层）→ `override-hygiene`（覆盖层卫生）
→ `memory` → `rules` → `render-stale`（渲染同步状态）。后加的两项（加粗）是 2026-09-15 为多人模式加的：

- `multi-outfit`：有人一起出镜且同时存在两层服装时，`base` 被跳过 → **pass**，detail 说明原因；
  多人模式里唯一的服装层是内衣/比基尼类 → **warn**（那种搭配模型倾向于把两人画成一个）；
  单人模式 → pass。
- `prompt-language`：只要有任何一层写进 prompt 的文本含中文（CJK 正则）→ warn 并列出层名。
  中文词混进英文提示词会污染出图（之前的「三人」token 就是这么进的）。

- **多人 + 未渲染**的常态是 **79 分**（11 通过 / 13，2 条警告 ×3）：`cast-mode`
  （「共 3 人：该模型对 3 人以上的同框构图不稳定…」）与 `render-stale`（还没渲染过基准图）。
  单人模式、渲染过一次之后通常也是 79（同样是 2 条设计使然的警告）。
- `cast-mode` 在多人模式下的那条警告是**故意**保留的：多人同框本来就是概率性的，
  它提示「失败就改成 2 人同框或让其他人的身体与主角分开」，而不是一个待修的 bug。
- 分数只衡量**项目内部一致性**（层是否完整、覆盖有没有污染、提示词与上次渲染是否同步），
  **不代表出图像不像参考图**——形象一致性只能渲染后肉眼比对。

---

## 10. 已知限制 / 下一步

- **参考图对渲染结果没有影响（平台限制，不是本项目的 bug）**：`text-to-image-plugin` 的
  `referenceImage` 参数被平台**有意停用、当前完全无效**
  （见 `imports/text-to-image-plugin/main.pjs` 第 547 行附近的注释，2026-08-25 平台负责人确认；
  参数会被解析和发送，但对一般流量被忽略）。因此平台侧**无法做 image-to-image**，
  「同一个人」只能靠**纯文本**表达。这就是「人物形象有变」的根本原因，也是为什么我们把
  力气全部花在 prompt 首尾身份锚定 + 形象锁定闸门 + 负面提示词上。
  想要真正意义上的同人一致性，必须改用带 image 输入的外部管线。
- 因此**改动形象类设置后要重渲**。用 3 个种子（20250815 / 771 / 91234）实测了加固后的 prompt：
  刘海（齐钝覆盖额头 + 中央极浅分缝 + 两缕贴脸长发）、编发（两条细长、自耳后垂直垂落过胸）
  在三个种子下都正确；头部羽毛装饰在去掉「wing」用词后也不再画成大翅膀（尺寸终于变成耳高小发夹）；
  编发缎带在 771 / 91234 下出现（但多为发尾打结，**贯穿整条编发的交叉系带仍未稳定出现**），
  20250815 下连缎带都没有；四枚（而非两枚）只有 771 全对。当前默认种子即 771。
  结论：**描述已尽量对齐参考图，剩余差异主要靠换种子解决**，不要再靠堆词。
- 细节保真度还受分辨率与取景影响：512×768 的上半身取景下，编发缎带这类小装饰很容易糊掉，
  单人想更准可以试 768×768（或把取景改宽一点，让编发/羽翼在画面里更大）；
  **但多人同框必须留在 512×768** —— 768×768 下同一提示词会画出 5-6 个人（实测）。
- 关键词范围闸门是启发式的，用户说话很绕时可能把合法改动也放进 `pending`
  （不会丢，只是在聊天里等一次确认）。
- 收藏存的是 dataUrl（kv/IndexedDB），24 张上限是为了避免存档过大；
  如果以后要跨设备共享，应该改成上传后用 URL 引用。
- 多人模式（`cast.mode = "multi"`）支持**除主角外 1..5 人**（`cast.count`），画面上限共 6 人；
  但第二人物仍是 `currentPartner` **单值文本**（要描述「两位成年男性」就把这句写在里面，
  代码会把它当一组人来数）。人数与性别由 `castInfo()` 从这段文本里推断，所以文本里的人称/数量
  要和 `cast.count` 一致（`spokenCastCount()` 会读中文/英文数字，`cast-mode` 体检据此提示）。
  实测两人能分开出图，但第二个人仍可能被模型沾上主角的部分外观（长发/羽翼），
  已经用 `castNegatives()` 和前置锚定压制，不能保证 100%。
- 多人模式改变的是**提示词结构**（层顺序 + 负面词过滤 + 只渲染最外层服装 + 紧凑身份行），
  所以切换模式、改 `cast.count`、切回单人都会触发「渲染同步状态」警告，
  需要重新渲染一次作为新基准。
- **「重置为出厂 COL-001」是可恢复的**：它先自动写一份快照（`colSnapshots`，上限 8，超出丢最旧）
  再清空。如果将来改 `resetProject()`，务必保留「先快照」这个顺序。
- 生成服务**即使固定 seed 也不确定**（同一 prompt + seed 每次结果不同），所以：
  基础种子 771 拿来保证前后可比，遇到小细节不对就**连拍几张挑一张**（界面上的「连拍候选」），
  而不是继续往提示词里堆词。
- 如果想做多角色（多个**项目**，不是画面里的多个人），`PROJECT_CODE` / `createDefaultProject()`
  需要参数化，kv 槽位也要按 code 分片。

## 6. 角色卡系统（COL）

V4 起，COL 不再把 `COL-001` 当成唯一可用角色。角色卡与项目状态分开：

- 「保存角色卡」只保存 Character Core、参考图、默认档案、规则与 Prompt Policy，不保存当前覆盖、聊天进度等工作状态。
- 「保存项目」保存完整工作状态，包括当前覆盖、AI 聊天、Project Memory、Change Log、渲染结果等。
- 顶部角色卡选择框可以载入任意已保存角色卡；如果该角色已经有同 code 的项目存档，会优先恢复项目，从而直接继续上次工作。
- 「导入角色卡」接受 `COL_CHARACTER_CARD` JSON；导入后会自动保存到角色卡库并立即载入。
- 「导出角色卡」只导出角色身份档案，不把聊天记录和临时修改混进去，方便在另一份 COL 生成器里复用。

图像生成仍由 `generateImage = {import:text-to-image-plugin}` 提供；主 AI 负责理解自然语言、修改当前角色状态并构建图像 Prompt，最终由渲染按钮调用生图服务。


## V4.2 新增：独立「角色 AI」

V4.2 在原有「角色卡 + 主 AI + 生图」之外新增一个完全独立的「角色 AI」页面，不改写原项目的数据结构。

角色 AI 使用独立 KV 命名空间 `colRoleAI`，每个角色独立保存：

- 角色名称 / 编号 / 头像
- 基础信息
- 默认服装
- 性格
- 爱好
- 偏好
- 说话方式
- 背景故事
- 长期记忆
- 独立聊天记录
- 最近生成的角色图

「导入当前角色」可以把当前主工作室的角色项目复制成一张角色 AI 卡；之后角色 AI 的聊天和记忆与主工作室互不干扰。

### 角色 AI 聊天

聊天使用 Perchance 当前已配置的 `generateText` 插件，并支持流式回调形成打字效果。角色上下文由角色卡字段 + 长期记忆 + 最近对话自动组成。

### 角色 AI 生图

生图页面与原来的角色渲染页面分开。提示词自动包含角色信息、默认服装、性格气质以及用户输入的场景/动作。生成结果会保存到该角色资料的最近图片记录中。

### 关于「免费 + 无限」

代码层不会把后端写死，也不会虚构云端服务的「无限额度」。当前项目继续使用 Perchance 提供的 `generateText` / `generateImage` 接口；实际免费额度、排队、速率限制和模型可用性由运行环境决定。

如果以后接入本地模型，只需要替换 `role-ai.js` 中的文本/图像调用层即可，角色卡与聊天数据不需要重做。
