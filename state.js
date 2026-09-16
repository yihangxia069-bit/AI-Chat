export const PROJECT_CODE = "COL-001";
export const CHARACTER_NAME = "哥伦比娅";
export const REFERENCE_IMAGE = "https://user.uploads.dev/file/03ac25f879c88864d24dcfa6fd0275c9.jpg";

export const OVERRIDE_KEYS = [
  "currentOutfit",
  "currentOuterOutfit",
  "currentHairstyle",
  "currentPose",
  "currentExpression",
  "currentBackground",
  "currentAccessories",
  "currentPartner",
];

export const OVERRIDE_META = {
  currentOutfit: { label: "当前服装", cn: "基础层", defaultKey: "outfit", layer: "base", group: "wardrobe" },
  currentOuterOutfit: { label: "外层服装", cn: "叠加在基础层之上", defaultKey: "outerOutfit", layer: "outer", group: "wardrobe" },
  currentAccessories: { label: "配饰", cn: "附加装饰层", defaultKey: "accessories", layer: "accessories", group: "wardrobe" },
  currentHairstyle: { label: "发型", cn: "只改造型编排，不改发色/发长", defaultKey: "hairstyle", layer: "hair", group: "look" },
  currentPose: { label: "姿势", cn: "身体姿态层", defaultKey: "pose", layer: "pose", group: "look" },
  currentExpression: { label: "表情", cn: "神情层（不得改动面部身份特征）", defaultKey: "expression", layer: "expression", group: "look" },
  currentBackground: { label: "背景", cn: "场景层", defaultKey: "background", layer: "background", group: "look" },
  currentPartner: { label: "第二人物", cn: "多人模式下与主角同时出镜的另一个人（不参与形象锁定判定）", defaultKey: "partner", layer: "partner", group: "cast" },
};

export const CAST_MODES = [
  { id: "single", label: "单人", cn: "只有主角出镜（默认）" },
  { id: "multi", label: "多人", cn: "主角 + 「第二人物」层同时出镜" },
];

export function castModeOf(project) {
  return project && project.cast && project.cast.mode === "multi" ? "multi" : "single";
}

// 「第二人物」可以是**一组人**：cast.count = 除主角之外的人数（1..CAST_COUNT_MAX），
// 决定提示词开头的 `N people (1girl, 2boys)` 人数标记，以及负面提示词里的人数量词。
export const CAST_COUNT_MAX = 5;

export function castCountOf(project) {
  if (castModeOf(project) !== "multi") return 0;
  const raw = project && project.cast ? Number(project.cast.count) : NaN;
  if (!Number.isFinite(raw)) return 1;
  const n = Math.round(raw);
  if (n < 1) return 1;
  return Math.min(CAST_COUNT_MAX, n);
}

const CN_DIGITS = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const EN_DIGITS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

// 从「第二人物 / 姿势 / 背景」文本里读出**画面总人数**（含主角）。
// 用途：旧存档迁移时把 cast.count 推断出来；体检时用来发现「count 和文本写的人数打架」
// （那是实测过的崩坏原因：开头写 2 people、正文写三个人，模型会把人物糊成一团）。
export function spokenCastCount(project) {
  const texts = ["currentPartner", "currentPose", "currentBackground"]
    .map((k) => effectiveOf(project, k))
    .map((e) => [e && e.text, e && e.prompt].filter(Boolean).join(", "))
    .join(", ");
  if (!texts.trim()) return 0;
  const num = (tok) => CN_DIGITS[tok] || EN_DIGITS[String(tok).toLowerCase()] || Number(tok) || 0;
  let total = 0;
  let extra = 0;
  for (const m of texts.matchAll(/([一两二三四五六七八九十]|\d+)\s*(?:个|名|位)?\s*人(?!物)/g))
    total = Math.max(total, num(m[1]));
  for (const m of texts.matchAll(/\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:people|persons|figures|characters)\b/gi))
    total = Math.max(total, num(m[1]));
  for (const m of texts.matchAll(/([一两二三四五六七八九十]|\d+)\s*(?:个|名|位)?\s*(?:成年|高大|半裸)?\s*(?:男|女)(?:性|人|子)?/g))
    extra = Math.max(extra, num(m[1]));
  for (const m of texts.matchAll(
    /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:adult\s+|tall\s+|muscular\s+|naked\s+|dark\w*\s+)*(?:men|women|boys|girls|males|females|characters)\b/gi
  ))
    extra = Math.max(extra, num(m[1]));
  return Math.max(total, extra > 0 ? extra + 1 : 0);
}

export const LAYER_ORDER = ["core", "base", "outer", "accessories", "hair", "pose", "expression", "background", "partner"];

export const MEMORY_FIELDS = [
  { key: "lastSummary", label: "当前进度小结", cn: "记忆字段" },
  { key: "lastUserRequest", label: "上一次用户请求", cn: "记忆字段" },
  { key: "lastAIAction", label: "上一次 AI 动作", cn: "记忆字段" },
  { key: "unfinishedTask", label: "未完成任务", cn: "记忆字段" },
  { key: "nextTask", label: "下一步任务", cn: "记忆字段" },
];

export const RULE_SLOTS = [
  { key: "identity", label: "项目身份" },
  { key: "coreLock", label: "角色基准锁定" },
  { key: "overrideIsolation", label: "单项隔离" },
  { key: "outfitLayering", label: "服装层级" },
  { key: "appearanceIsolation", label: "人物形象隔离" },
  { key: "promptAssembly", label: "提示词组装" },
  { key: "castMode", label: "单人与多人场景" },
  { key: "memoryUpdate", label: "记忆更新" },
  { key: "outputFormat", label: "输出格式" },
];

export const KIND_LABELS = {
  project: "项目",
  load: "载入",
  save: "保存",
  autosave: "自动保存",
  manual: "手动编辑",
  "main-ai": "AI 修改",
  "user-approved": "用户确认",
  "core-edit": "基准内容编辑",
  "core-lock": "基准重新锁定",
  "core-unlock": "基准解锁",
  "rule-edit": "规则编辑",
  "default-edit": "默认值修改",
  memory: "记忆更新",
  task: "任务更新",
  reset: "恢复默认",
  render: "渲染",
  favorite: "收藏",
  import: "导入",
  restore: "快照恢复",
  rejected: "已忽略",
  blocked: "已阻止",
  pending: "待确认",
  noop: "无变化",
  error: "错误",
};

export function kindLabel(kind) {
  return KIND_LABELS[kind] || kind || "—";
}

export const LAYER_LABELS = {
  core: "身份基准",
  base: "基础常服 / 当前服装",
  outer: "外层服装",
  accessories: "配饰",
  hair: "发型覆盖",
  pose: "姿势",
  expression: "表情",
  background: "背景",
  partner: "第二人物",
};

export function layerLabel(id) {
  return LAYER_LABELS[id] || id || "—";
}

const DEFAULT_CN = {
  outfit: "基础常服",
  outerOutfit: "外层服装",
  accessories: "配饰",
  hairstyle: "发型",
  pose: "姿势",
  expression: "表情",
  background: "背景",
  partner: "第二人物",
};

export function pathLabel(path) {
  const p = String(path || "");
  if (!p) return "—";
  if (p.startsWith("overrides.")) {
    const k = p.slice("overrides.".length);
    return OVERRIDE_META[k] ? OVERRIDE_META[k].label : p;
  }
  if (p.startsWith("defaults.")) {
    const k = p.slice("defaults.".length);
    return "默认 · " + (DEFAULT_CN[k] || k);
  }
  if (/characterCore/i.test(p)) return "角色基准锁定状态";
  if (p === "referenceImage.url") return "参考基准图";
  if (p === "cast.mode") return "人物数量模式";
  if (p === "cast.count") return "同框人数";
  if (p === "task") return "当前任务";
  if (p === "project") return "项目";
  if (p === "character") return "角色卡";
  if (p === "render") return "渲染结果";
  if (p === "snapshot") return "快照";
  return p;
}

function coreGroups() {
  return [
    {
      id: "hair",
      label: "发型 / 发色",
      text: "蓝黑色长直发，长度过腰；自中段（背部中间）起向发尾渐变为深猩红／酒红，发尾最浓。",
      prompt: "very long straight blue-black hair reaching past the waist, with a deep crimson-burgundy gradient starting around the mid-length (mid-back) and strongest at the hair tips",
      anchor: "blue-black long straight hair with a crimson-burgundy gradient over the lower half",
      keywords: ["blue-black hair", "long straight", "crimson-burgundy gradient"],
      negative: "short hair, bob cut, blonde hair, white hair, silver hair, pink hair, flat single-color hair, gradient only at the very tips",
    },
    {
      id: "bangs",
      label: "刘海",
      text: "整齐钝感直刘海，覆盖额头、止于眼上方；中央有极浅的分缝，两侧另有细长发丝贴着脸颊垂过下巴。",
      prompt: "neat straight blunt bangs covering the forehead and stopping just above the eyes, with a very slight centre part and two long thin strands framing the face down past the chin",
      anchor: "straight blunt bangs covering the forehead",
      keywords: ["blunt bangs", "covering the forehead"],
      negative: "middle part, curtain bangs, exposed forehead, side-swept bangs, thin sparse bangs",
    },
    {
      id: "braids",
      label: "脸侧编发",
      text: "两条细长编发，耳后左右各一条，垂直垂落过胸；编发表面缠有白色缎带交叉纹样。",
      prompt: "two thin long braids, one on each side, hanging vertically from behind the ears down past the chest, with a white ribbon lattice crossing over the outer surface of each braid, flush against the dark hair",
      anchor: "two thin long braids hanging from behind the ears",
      keywords: ["thin long braids", "one on each side"],
      negative: "tight scalp braids, single braid, thick rope braids",
    },
    {
      id: "lace",
      label: "编发蕾丝结构",
      text: "两条编发里各穿有一条细白色缎带，从头到尾交叉穿插在编发中形成可见的交叉纹理（白色在深色头发上很显眼；不是发尾的蝴蝶结，也不是服装系带）。",
      prompt: "each braid has a thin white cord laced crosswise through it along its whole length, forming a visible cross-woven lattice down the plait (not a bow at the end, and not lacing on her clothing)",
      anchor: "a thin white cord laced crosswise down each braid",
      keywords: ["white cord laced crosswise", "lattice down the plait"],
      negative: "ribbon bow at the ends of braids, hair tie bow, plain braids without any ribbon, no ribbon on braids, lace-up neckline, corset lacing on clothing, laced bodice",
    },
    {
      id: "wings",
      label: "头部羽翼装饰",
      text: "耳朵两侧各夹着两枚小小的白色羽毛发夹：每侧耳朵上方一枚、下方一枚，四枚都小而精致，每枚约耳朵大小，略微朝外翘。",
      prompt: "four small white feather hair clips: on each side of her head there is one small white feather clip just above the ear and one just below it, all four small and delicate, each about the size of her ear, tilted slightly outward",
      anchor: "two small white feather hair clips on each side, one above and one below the ear",
      keywords: ["feather hair clips", "above the ear"],
      negative:
        "back wings, angel wings, large wings, wings attached to the shoulders, large wings on the head, wings as big as the head, spread wings, feathered wings, big white feathers, feathers larger than the head, wing-like ornaments, headphones, headphones on head",
    },
    {
      id: "face",
      label: "面部",
      text: "浅色皮肤，闭眼，脸颊带柔和粉色红晕。",
      prompt: "fair pale skin, eyes closed, soft pink blush on the cheeks",
      anchor: "pale skin with closed eyes and soft pink blush",
      keywords: ["eyes closed", "pale skin"],
      negative: "open eyes, wide eyes",
    },
    {
      id: "aura",
      label: "气质",
      text: "安静、梦幻、略带疏离感的气质。",
      prompt: "quiet dreamy detached aura, serene ethereal mood",
      anchor: "quiet dreamy detached aura",
      keywords: ["dreamy", "detached"],
      negative: "aggressive expression, angry, action pose",
    },
  ];
}

function defaultRules() {
  return {
    identity: "你正在处理 COL-001。你不是在重新创造一个角色，你是在持续编辑一个已经存在的角色项目。",
    coreLock:
      "角色基准（形象身份）是锁定的，任何时候都不得修改其内容，也不得改写、替换或弱化其中的形象特征（黑色长直发与猩红渐变发尾、整齐直刘海、脸侧编发与白色交叉蕾丝、脑后四枚头部羽翼、闭眼与浅色皮肤、安静梦幻的气质）。",
    overrideIsolation:
      "当前覆盖是本次修改。用户没有要求修改的项目必须保持原样。每次只修改用户明确要求的那一项，其余字段一律不得出现在 changes 中。",
    outfitLayering:
      "服装层级为 基础常服 → 外层服装 → 配饰。“穿上/套上/加一件”外套或配件时只写入外层或配饰，保留基础常服；只有用户明确说“更换默认常服”时才修改默认基础常服。",
    appearanceIsolation:
      "严格禁止随意改动人物形象：发型、服装、姿势、表情、背景的修改都不得影响面部、发色与发长、刘海结构、编发蕾丝与脑后四枚羽翼装饰。修改某一层时，其它层必须逐字保持不变。任何与角色基准冲突的写法都会被系统直接拒绝。",
    promptAssembly:
      "图像提示词按固定顺序组装：身份基准 → 基础常服 → 外层服装 → 配饰 → 发型 → 姿势 → 表情 → 背景。只有被修改的层允许变化。",
    castMode:
      "人物数量模式分「单人」与「多人」。多人模式下「第二人物」（overrides.currentPartner）可以是**一组人**，同框人数由 cast.count 指定（除主角外 1..5 人），提示词开头据此写成「N people (1girl, 2boys)」这类人数标记，姿势 / 构图 / 背景必须与这个人数一致；负面提示词里限制多人的用词会被自动移除并替换成「人数超出 / 复制主角」这类负面词。单人模式下第二人物不参与渲染。",
    memoryUpdate:
      "完成重要修改后更新项目记忆的五个字段（当前进度小结、上一次用户请求、上一次 AI 动作、未完成任务、下一步任务），并向变更日志追加一条记录。",
    outputFormat:
      "先输出给用户看的自然语言回复，然后在最后输出一个 <action> 区块，内含一个 JSON 对象。只允许修改 JSON 中列出的字段，JSON 之外的任何承诺都不算数。",
  };
}

const LEGACY_RULES = {
  coreLock:
    "Character Core 是锁定身份，任何时候都不得修改其内容，也不得改写、替换或弱化其中的核心特征（发色渐变、刘海、编发蕾丝、四枚头部羽翼、闭眼）。",
  overrideIsolation:
    "Current Overrides 是当前修改。用户没有要求修改的项目必须保持原样。每次只修改用户明确要求的那一项，其余字段一律不得出现在 changes 中。",
  outfitLayering:
    "服装层级为 Base Outfit → Outer Outfit → Accessories。“穿上/套上/加一件”外套或配件时写入 currentOuterOutfit 或 currentAccessories，保留 Base Outfit；只有用户明确说“更换默认常服”时才修改 defaults.outfit。",
  appearanceIsolation:
    "发型、服装、配饰的修改不得影响面部、发色根部、刘海结构与头部羽翼装饰。修改某一层时，其它层必须逐字保持不变。",
  promptAssembly:
    "图像 Prompt 按固定顺序组装：Identity Core → Base → Outer → Accessories → Hairstyle → Pose → Expression → Background。只有被修改的层允许变化。",
  castMode:
    "人物数量模式分「单人」与「多人」。多人模式会额外渲染「第二人物」（overrides.currentPartner）并解除负面提示词里限制多人的用词；单人模式下第二人物不会被渲染。要让画面里出现第二个人（例如男方），必须同时把 cast.mode 改成 multi，并把对方的外形写进 overrides.currentPartner。",
  memoryUpdate:
    "完成重要修改后更新 Project Memory：lastSummary、lastUserRequest、lastAIAction、unfinishedTask、nextTask，并向 changeLog 追加一条记录。",
};

const LEGACY_HAIRSTYLE_TEXTS = [
  "由 Character Core 定义：黑色长直发 + 猩红渐变发尾 + 整齐直刘海 + 两条脸侧松散编发（白色交叉蕾丝）。",
  "由角色基准定义：黑色长直发 + 猩红渐变发尾 + 整齐直刘海 + 两条脸侧松散编发（白色交叉蕾丝）。",
];

const HAIRSTYLE_TEXT =
  "由角色基准定义：蓝黑色长直发 + 深猩红／酒红渐变发尾 + 整齐钝感直刘海 + 两条耳后细长编发（带白色缎带交叉蕾丝）+ 耳高四枚羽翼装饰。";

// 旧版角色基准描述（每个分组可能有多个历史版本）：只有当某个分组的 text / prompt /
// keywords / negative 仍然**逐字等于**某个历史版本时才替换为新版（对齐参考图）。
// 用户自己改过的内容一律不动。以后再次调整描述时，把被替换掉的旧值追加进对应数组即可。
const LEGACY_CORE = {
  hair: [
    {
      text: "黑色长直发，长度过腰；发尾具有明显的猩红红色渐变（中下段开始转红，发尾最浓）。",
      prompt:
        "very long straight black hair reaching past the waist, with a sharp crimson red gradient starting around the mid-back and strongest at the hair tips",
      keywords: ["black hair", "straight", "crimson"],
      negative: "short hair, bob cut, blonde hair, white hair, silver hair, pink hair, flat single-color hair",
    },
  ],
  bangs: [
    {
      text: "整齐直刘海（钝感齐刘海），覆盖额头，止于眉眼上方。",
      prompt: "neat straight blunt bangs covering the forehead",
      keywords: ["bangs"],
      negative: "middle part, curtain bangs, exposed forehead, side-swept bangs",
    },
  ],
  braids: [
    {
      text: "两条脸侧松散编发，自然垂在脸颊两侧，不紧贴头皮。",
      prompt: "two loose braids hanging down along both sides of the face",
      keywords: ["braid", "sides of the face"],
      negative: "tight scalp braids, single braid",
    },
  ],
  lace: [
    {
      text: "编发中存在明显白色交叉蕾丝结构（白色细缎带交叉编织，呈束身衣式交叉纹样）。",
      prompt:
        "a clearly visible white crisscross lace ribbon structure woven through the face-framing braids, corset-style cross lacing",
      keywords: ["crisscross lace"],
      negative: "plain braids without lace",
    },
    {
      text: "编发外侧有清晰可见的白色缎带／蕾丝交叉纹样（贴在编发表面，属于编发装饰，不是服装上的系带）。",
      prompt:
        "a clearly visible white crisscross ribbon lattice running across the outer surface of the side braids, flush against the dark hair, part of the braid itself — NOT lacing on her clothing",
      keywords: ["white crisscross ribbon"],
      negative: "plain braids without lace, lace-up neckline, corset lacing on clothing, laced bodice",
    },
    {
      text: "两条编发表面各缠着一条细白色缎带，以交叉 X 形纹样顺着编发向下缠绕（白色缎带在深色头发上非常显眼；属于编发装饰，不是服装系带）。",
      prompt:
        "each side braid is wrapped with a thin white ribbon down its length in a clear crisscross X pattern, the white ribbon standing out vividly against the dark hair",
      keywords: ["white ribbon", "crisscross X pattern"],
      negative: "plain braids without any ribbon, no ribbon on braids, lace-up neckline, corset lacing on clothing, laced bodice",
    },
  ],
  wings: [
    {
      text: "脑后、耳朵高度附近存在四枚白色羽翼状装饰，左右各两枚，从头部后方横向展开；属于头部装饰，不属于背部翅膀。",
      prompt:
        "four small white feathered wing ornaments mounted at ear height behind the head, two on each side, spreading outward horizontally from the back of the head — head-mounted hair ornaments, NOT back wings",
      keywords: ["feathered wing ornaments", "two on each side"],
      negative: "back wings, large wings behind the body, angel wings, wings attached to the shoulders",
    },
    {
      text: "头部两侧、耳朵高度附近有白色羽翼状装饰共四枚（左右各两枚），斜向外上方展开：上一对较大、羽毛呈弧形，下一对略小、更靠近下颌；属于头部装饰，不是背部翅膀。",
      prompt:
        "four small white feathered wing ornaments, one pair on each side of the head at ear height, angled diagonally outward and slightly upward; the upper pair larger with curved feathers, the lower pair slightly smaller and closer to the jawline — head-mounted hair ornaments, NOT back wings, NOT headphones",
      keywords: ["feathered wing ornaments", "one pair on each side"],
      negative:
        "back wings, large wings behind the body, angel wings, wings attached to the shoulders, headphones, headphones on head",
    },
    {
      text: "头部两侧、耳朵高度各有一对小小的白色羽毛发饰（羽毛呈小羽翼形状、每枚约耳朵大小，像发夹一样夹在头发上），斜向外上方：上一对略大、下一对略小更靠近下颌；是小发饰，不是翅膀。",
      prompt:
        "four small white feather hair ornaments shaped like tiny wings (small feather hair accessories clipped into her hair, each about the size of an ear), one pair on each side of the head at ear height, tilted diagonally outward and slightly upward; the upper pair slightly larger, the lower pair a little smaller and closer to the jawline — small hair accessories, NOT wings",
      keywords: ["feather hair ornaments", "one pair on each side"],
      negative:
        "back wings, large wings behind the body, angel wings, wings attached to the shoulders, large wings on the head, wings as big as the head, spread wings, headphones, headphones on head",
    },
    {
      text: "头部两侧、耳朵高度各有一对小小的白色羽毛发饰（白色小羽毛，每枚约耳朵大小，夹在头发上），斜向外上方：上一对略大、下一对略小更靠近下颌；是小发饰，不是翅膀。",
      prompt:
        "four small white feather-shaped hair accessories (tiny white feathers, each about the size of an ear) clipped into the hair, one pair on each side of her head at ear height, tilted diagonally outward and slightly upward; the upper pair slightly larger, the lower pair a little smaller and closer to the jawline — small feather hair accessories only",
      keywords: ["feather-shaped hair accessories", "one pair on each side"],
      negative:
        "back wings, angel wings, large wings, wings attached to the shoulders, large wings on the head, wings as big as the head, spread wings, wing-like ornaments, headphones, headphones on head",
    },
    {
      text: "头部两侧、耳朵高度各夹着两枚小小的白色羽毛发夹（白色小羽毛，每枚约耳朵大小），斜向外上方：上面那枚略大、下面那枚略小更靠近下颌；是小发夹，不是翅膀。",
      prompt:
        "four small delicate white feather hairpins (hair clips made of small white feathers, each roughly the size of her ear) pinned into her hair, two on the left side and two on the right side of her head at ear height, tilted diagonally outward and slightly upward; the upper one slightly larger, the lower one a little smaller and nearer the jawline",
      keywords: ["feather hairpins", "two on the left side"],
      negative:
        "back wings, angel wings, large wings, wings attached to the shoulders, large wings on the head, wings as big as the head, spread wings, feathered wings, big white feathers, feathers larger than the head, wing-like ornaments, headphones, headphones on head",
    },
  ],
};

export function migrate(project) {
  if (!project) return project;
  const defaults = defaultRules();
  if (project.rules) {
    for (const [key, legacy] of Object.entries(LEGACY_RULES)) {
      if (project.rules[key] === legacy) project.rules[key] = defaults[key];
    }
    if (typeof project.rules.coreLock === "string" && /Character Core/.test(project.rules.coreLock)) {
      project.rules.coreLock = defaults.coreLock;
    }
  }
  const fresh = coreGroups();
  if (project.characterCore && Array.isArray(project.characterCore.groups)) {
    for (const g of project.characterCore.groups) {
      const ref = fresh.find((x) => x.id === g.id);
      if (!ref) continue;
      for (const old of LEGACY_CORE[g.id] || []) {
        if (g.text === old.text) g.text = ref.text;
        if (g.prompt === old.prompt) g.prompt = ref.prompt;
        if (Array.isArray(g.keywords) && Array.isArray(old.keywords) && g.keywords.join("|") === old.keywords.join("|"))
          g.keywords = ref.keywords;
        if (g.negative === old.negative) g.negative = ref.negative;
      }
      if (!g.anchor) g.anchor = ref.anchor;
    }
  }
  // 发型覆盖里如果还留着旧版「羽翼在脑后 / 猩红渐变」的措辞（模板化短语），
  // 就按新的参考图描述改写——只替换这几句确切的旧措辞，其它内容一律不动。
  const ov = project.overrides && project.overrides.currentHairstyle;
  if (ov && typeof ov.prompt === "string") {
    const fixed = ov.prompt
      .replace(
        /the four white feathered wing ornaments at the back of the head/gi,
        "the four small white feather ornaments at ear height on both sides of the head"
      )
      .replace(/the crimson red gradient at the ends of the hair/gi, "the deep crimson-burgundy gradient at the ends of the hair");
    if (fixed !== ov.prompt) {
      ov.prompt = fixed;
      if (project.memory && Array.isArray(project.memory.changeLog)) {
        project.memory.changeLog.push({
          ts: Date.now(),
          revision: project.memory.changeLog.length + 1,
          kind: "core-edit",
          path: "overrides.currentHairstyle",
          note: "对齐参考图：修正发型覆盖里关于羽翼位置与渐变发色的旧措辞",
          layersChanged: ["hair"],
        });
      }
    }
  }
  // 旧的 guardLines / 配饰默认值里把头部羽翼装饰写成了 wing(s)，这正是模型画出「大翅膀」的
  // 主要诱因。这里按确切短语改写为「小羽毛发夹」的表述；只替换命中短语，其它内容不动。
  const gp = project.promptPolicy;
  if (gp && Array.isArray(gp.guardLines)) {
    gp.guardLines = gp.guardLines.map((line) =>
      String(line)
        .replace(/braid lace and head-mounted wing ornaments/gi, "braid ribbon detail and the small white feather hair clips at ear height")
        .replace(/head-mounted wing ornaments/gi, "the small white feather hair clips at ear height")
    );
  }
  const acc = project.defaults && project.defaults.accessories;
  if (acc && typeof acc.prompt === "string") {
    acc.prompt = acc.prompt.replace(
      /head-mounted feather wings/gi,
      "small white feather hair clips at ear height"
    );
  }
  const hs = project.defaults && project.defaults.hairstyle;
  if (hs) {
    if (LEGACY_HAIRSTYLE_TEXTS.includes(hs.text) || /Character Core/.test(String(hs.text || "")))
      hs.text = HAIRSTYLE_TEXT;
    if (/Character Core/.test(String(hs.prompt || ""))) hs.prompt = hs.prompt.replace(/Character Core/g, "角色基准");
  }
  if (project.referenceImage && /Character Core/.test(String(project.referenceImage.note || "")))
    project.referenceImage.note = project.referenceImage.note.replace(/Character Core/g, "角色基准");
  // 旧存档补全：人物数量模式、第二人物层、以及所有缺失的规则槽。
  if (!project.cast || (project.cast.mode !== "single" && project.cast.mode !== "multi"))
    project.cast = { mode: "single" };
  if (project.cast && !Number.isFinite(Number(project.cast.count))) {
    // 旧存档没有同框人数：按文本里写的人数推断（「三人」「two men」→ 额外 2 人），
    // 推断不出来就按 1 人。这样旧存档一加载就不会再出现「开头 2 people、正文三个人」的矛盾。
    const spoken = spokenCastCount(project);
    project.cast.count = spoken > 1 ? Math.min(CAST_COUNT_MAX, spoken - 1) : 1;
  }
  if (project.cast)
    project.cast.count = Math.min(CAST_COUNT_MAX, Math.max(1, Math.round(Number(project.cast.count) || 1)));
  if (project.defaults && !project.defaults.partner)
    project.defaults.partner = cloneProject(createDefaultProject().defaults.partner);
  if (project.overrides && !project.overrides.currentPartner)
    project.overrides.currentPartner = { value: "", prompt: "", source: "default", updatedAt: null, note: "" };
  if (project.rules) {
    for (const [key, val] of Object.entries(defaults))
      if (!String(project.rules[key] || "").trim()) project.rules[key] = val;
  }
  return project;
}

export function createDefaultProject() {
  const t = Date.now();
  return {
    code: PROJECT_CODE,
    name: CHARACTER_NAME,
    version: 1,
    task: "建立 COL-001：确认角色基准与默认常服，保持角色形象一致性。",
    characterCore: { locked: true, groups: coreGroups() },
    cast: { mode: "single", count: 1 },
    referenceImage: {
      url: REFERENCE_IMAGE,
      note: "角色视觉身份的唯一基准图。角色基准以其为准，不得随意改动。",
    },
    defaults: {
      outfit: {
        text: "白色高领长袖衬衫，领口系黑色细缎带蝴蝶结；外罩白色蕾丝胸衣式马甲，前襟有银色搭扣；深蓝黑色高腰 A 字长裙，裙摆内衬猩红色缎面，及踝；不透明白色过膝长袜，袜口有扇形蕾丝边；黑色低跟系带短靴。整体完整、得体、不透明。",
        prompt:
          "a fully opaque modest outfit: white high-neck long-sleeve blouse with a slim black ribbon bow at the collar, a white lace corset-style bodice with silver clasps layered over it, an ankle-length high-waisted dark navy-black A-line skirt with crimson satin inner lining at the hem, opaque white thigh-high stockings with scalloped lace bands, black low-heeled lace-up ankle boots",
      },
      outerOutfit: { text: "", prompt: "" },
      accessories: {
        text: "白色蕾丝颈饰，中央嵌一枚猩红宝石；耳侧羽翼下方各悬一条细银链。",
        prompt:
          "a white lace choker with a single crimson gem at the center, a thin silver chain hanging below each side of the small white feather hair clips at ear height",
      },
      hairstyle: {
        text: "由角色基准定义：黑色长直发 + 猩红渐变发尾 + 整齐直刘海 + 两条脸侧松散编发（白色交叉蕾丝）。",
        prompt: "（由角色基准定义）",
        fromCore: true,
      },
      pose: {
        text: "正面站立，双臂自然垂于身侧，安静。",
        prompt: "standing upright, front-facing, arms relaxed loosely at her sides, calm idle stance",
      },
      expression: {
        text: "闭眼，安静、梦幻、略带疏离感。",
        prompt: "eyes closed, serene dreamy detached expression, soft pink blush",
      },
      background: {
        text: "纯净浅灰／米白色背景，简洁无杂物，柔和漫射光。",
        prompt: "plain light grey off-white studio backdrop, clean and uncluttered, soft diffused lighting",
      },
      partner: {
        text: "成年男性，身形高大，短发，深色上衣长裤；与主角互动、姿态与主角配合。仅在多人模式下渲染。",
        prompt:
          "an adult man, tall and broad-shouldered, short dark hair, plain dark shirt and trousers — a separate character with his own design, interacting with the woman",
      },
    },
    overrides: OVERRIDE_KEYS.reduce((acc, k) => {
      acc[k] = { value: "", prompt: "", source: "default", updatedAt: null, note: "" };
      return acc;
    }, {}),
    memory: {
      lastSummary: "已经建立哥伦比娅的角色基准。",
      lastUserRequest: "建立 COL-001。",
      lastAIAction: "载入角色基准与默认常服。",
      unfinishedTask: "检查默认常服与角色基准的一致性。",
      nextTask: "继续处理角色服装。",
      changeLog: [
        { ts: t, kind: "project", path: "-", note: "创建 COL-001，载入角色基准与默认常服。" },
      ],
    },
    rules: defaultRules(),
    promptPolicy: {
      style:
        "clean modern anime illustration, crisp line art, smooth soft shading, soft diffused lighting, high detail, official character reference sheet quality",
      frame: "upper body portrait, centered, facing the viewer",
      guardLines: [
        "reference identity: keep exactly the same face, bangs, hair gradient, braid ribbon detail and the small white feather hair clips at ear height",
        "only the layer named in the change is different; every other layer is copied verbatim from the previous state",
        "fully opaque, complete clothing",
      ],
      negativePrompt: "blurry, low quality, jpeg artifacts, extra limbs, bad anatomy, deformed hands, text, watermark, signature",
    },
    render: { seed: 771, lockSeed: true, resolution: "512x768", lastPrompt: "", lastNegative: "", lastDataUrl: "", updatedAt: null },
    chats: { main: [] },
    meta: { createdAt: t, updatedAt: t, lastSavedAt: null, loadedAt: null, saveCount: 0, revision: 0 },
  };
}

export function cloneProject(p) {
  return JSON.parse(JSON.stringify(p));
}

export function getPath(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

export function setPath(obj, path, value) {
  const parts = path.split(".");
  const last = parts.pop();
  const target = parts.reduce((o, k) => {
    if (o[k] == null) o[k] = {};
    return o[k];
  }, obj);
  target[last] = value;
  return obj;
}

export function sourceDefault(project, key) {
  const meta = OVERRIDE_META[key];
  return project.defaults[meta.defaultKey] || { text: "", prompt: "" };
}

export function effectiveOf(project, key) {
  const meta = OVERRIDE_META[key];
  const ov = project.overrides[key];
  const def = sourceDefault(project, key);
  const isOverride = !!(ov && ov.source === "override");
  const coreDriven = key === "currentHairstyle";
  return {
    key,
    label: meta.label,
    cn: meta.cn,
    layer: meta.layer,
    text: isOverride ? ov.value : def.text,
    prompt: isOverride ? ov.prompt || "" : def.prompt || "",
    source: isOverride ? "override" : coreDriven ? "core" : "default",
    updatedAt: ov ? ov.updatedAt : null,
    isOverride,
  };
}

export function effectiveAll(project) {
  return OVERRIDE_KEYS.map((k) => effectiveOf(project, k));
}

export function setOverride(project, key, data, note = "") {
  const ov = project.overrides[key];
  const prev = ov.source === "override" ? { ...ov } : null;
  ov.value = data.value == null ? "" : String(data.value);
  ov.prompt = data.prompt == null ? "" : String(data.prompt);
  ov.source = "override";
  ov.updatedAt = Date.now();
  ov.note = note;
  return prev;
}

export function clearOverride(project, key) {
  const ov = project.overrides[key];
  ov.value = "";
  ov.prompt = "";
  ov.source = "default";
  ov.updatedAt = Date.now();
  ov.note = "reset to default";
}

export function buildCoreText(project, lang = "text") {
  if (!project.characterCore.locked) return "";
  const field = lang === "prompt" ? "prompt" : "text";
  return project.characterCore.groups
    .map((g) => g[field])
    .filter(Boolean)
    .join(/\n/);
}

export function pushChange(project, entry) {
  const log = project.memory.changeLog;
  log.push({ ts: Date.now(), revision: project.meta.revision, ...entry });
  if (log.length > 300) log.splice(0, log.length - 300);
  project.meta.revision += 1;
  project.meta.updatedAt = Date.now();
}

export function updateMemory(project, patch) {
  for (const f of MEMORY_FIELDS) {
    if (patch && typeof patch[f.key] === "string" && patch[f.key].trim()) {
      project.memory[f.key] = patch[f.key].trim();
    }
  }
}

export function countOverrides(project) {
  return OVERRIDE_KEYS.filter((k) => project.overrides[k].source === "override").length;
}

export function fmtTime(ts) {
  if (!ts) return "—";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
