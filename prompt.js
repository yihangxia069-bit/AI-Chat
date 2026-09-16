import {
  OVERRIDE_KEYS,
  RULE_SLOTS,
  MEMORY_FIELDS,
  effectiveAll,
  effectiveOf,
  buildCoreText,
  castModeOf,
  castCountOf,
} from "./state.js";

// 单人 / 多人模式相关常量。这些负面短语只在「单人」模式下有意义
// （它们会压制第二个人与多人互动），多人模式下必须从最终负面提示词里剔除。
const SOLO_ONLY_NEGATIVES = ["multiple characters", "action pose"];
// 描述「脱衣 / 裸体 / 内衣」这类场景的词：命中时不能再用「完整衣物」这条守护句，
// 否则守护句会和用户的服装描述互相打架（模型会退回到穿好衣服的构图）。
const UNDRESS_RE =
  /裸|赤裸|全裸|一丝不挂|赤身|光着|脱(光|去|掉|下)|褪去|仅余|只剩|半裸|无上衣|不穿|未穿|没穿|除去衣物|no (panties|underwear|bra|clothes|shirt)|without (any )?(clothes|clothing|underwear|panties|bra)|stripped|nude|naked|topless|bottomless|undress|bare (skin|chest|breasts|torso)/i;
const UNDRESS_GUARD =
  "the clothing state is exactly as described — any garment that is described as removed is completely gone, with no torn, half-on or floating fabric left behind and no extra clothing added back, and everything she does wear is fully opaque, never sheer or transparent";

// 发型覆盖和「锁定身份」的冲突检测。盘发 / 扎发 / 短发会把角色基准里的
// 「very long straight hair reaching past the waist」和「两条细长编发」收起来；
// 两层同时进入提示词时模型只能随机取舍——这正是「她根本不像她」的头号原因。
// 这里不禁止用户改发型，而是把身份层里冲突的那一句改写成「盘起来也依然是同一头头发」，
// 并保证「发尾酒红渐变 + 耳侧四枚白色羽饰」在任何发型下都逐字写进提示词。
const UPDO_RE =
  /\b(low bun|high bun|chignon|updo|up-do|ponytail|twin tails|twin-tails|hair up|half[- ]up|braided updo|messy bun|bun hairstyle)\b|盘发|发髻|丸子头|扎起|束发|马尾/i;
const SHORT_HAIR_RE = /\b(short hair|bob cut|pixie cut|bob hairstyle|shoulder[- ]length)\b|短发|波波头|齐肩/i;

export function hairstyleConflict(project) {
  const hair = effectiveOf(project, "currentHairstyle");
  const text = hair.source === "override" ? [hair.value, hair.prompt].filter(Boolean).join(" ") : "";
  return { active: !!text, updo: UPDO_RE.test(text), short: SHORT_HAIR_RE.test(text), text };
}

// 盘发状态下的身份层改写：保留「同一头头发」的说法，但不和发型层打架。
const UPDO_HAIR_LINE =
  "her blue-black hair is gathered up into a bun at the nape for this look, and it is still exactly the same hair — a deep crimson-burgundy gradient covers the lower part of it and is strongest at the hair ends";
// 供发型覆盖层复用的一句「身份签名」：渐变发尾 + 耳侧四枚羽饰。
const SIGNATURE_SHORT =
  "still the very same blue-black hair with the deep crimson-burgundy gradient over the lower half and the four small white feather clips at ear height, one above and one below each ear";
// 提示词开头的「身份签名」：把最容易被画丢、也最能让人一眼认出的两个特征
// （发尾酒红渐变、耳侧四枚白色羽饰）放在最前面，避免被多人场景的描述稀释。
const SIGNATURE_LINE =
  "the woman is always the same character — long blue-black hair with a deep crimson-burgundy gradient toward the hair ends, neat straight blunt bangs, eyes closed, and four small white feather clips at ear height, one above and one below each ear";

// 组装身份层：盘发覆盖生效时，把 hair 分组替换成与发型自洽的版本。
function corePrompts(project) {
  const conflict = hairstyleConflict(project);
  return project.characterCore.groups
    .map((g) => (conflict.updo && g.id === "hair" ? UPDO_HAIR_LINE : g.prompt))
    .filter(Boolean);
}

// 多人模式下的主角身份行：只用「一眼能认出她」的短特征。
// 同一 seed 下各渲染 3-6 张的对照实验：写完整身份散文时「1 女 + 2 男」只有 3/22 张正确
// （模型会把两套衣服 / 两套发型分别画在两个「她」身上），换成这一行紧凑身份后是 11/16。
// 渐变发尾、整齐直刘海、闭眼、两条耳后编发、耳侧四枚白色羽饰都逐字保留。
const MULTI_IDENTITY_HEAD =
  "long blue-black hair with a deep crimson-burgundy gradient toward the hair ends, neat straight blunt bangs, eyes closed, fair pale skin";
const MULTI_IDENTITY_DETAIL =
  "two thin long braids hanging from behind the ears with a thin white cord laced crosswise, four small white feather hair clips pinned at ear height, one above and one just below each ear";
const MULTI_IDENTITY_AURA = "quiet dreamy detached aura";

// 紧凑身份行里逐字出现的形象特征（七个核心分组各至少一条）。
// 「角色基准特征完整性」体检在多人模式下按这张表核对，
// 而不是拿单人模式的 400 字散文去比对——多人模式的身份行本来就是压缩版。
export const MULTI_IDENTITY_TOKENS = [
  ["blue-black hair", "发型 / 发色"],
  ["crimson-burgundy gradient", "发型 / 发色"],
  ["blunt bangs", "刘海"],
  ["thin long braids", "脸侧编发"],
  ["white cord laced crosswise", "编发蕾丝结构"],
  ["white feather hair clips", "头部羽翼装饰"],
  ["eyes closed", "面部"],
  ["fair pale skin", "面部"],
  ["dreamy detached", "气质"],
];

export function multiIdentityTokens() {
  return MULTI_IDENTITY_TOKENS.map(([keyword, group]) => ({ keyword, group }));
}

function multiIdentity(project) {
  const conflict = hairstyleConflict(project);
  const head = conflict.updo
    ? "blue-black hair gathered up into a bun at the nape, still with the deep crimson-burgundy gradient toward the hair ends, neat straight blunt bangs, eyes closed, fair pale skin"
    : MULTI_IDENTITY_HEAD;
  return `${head}, ${MULTI_IDENTITY_DETAIL}, ${MULTI_IDENTITY_AURA}`;
}

// 多人模式的人数是**显式状态**（cast.count）而不是从文本里猜的：
// 猜错了会出现「提示词开头写 2 people、正文却描述三个人」这种自相矛盾，
// 模型无法满足两边，结果就是身体糊在一起、或者把同一个人画两遍。
// 这里只从「第二人物」文本里判断性别构成，用来写 `3 people (1girl, 2boys)` 标记。
export function castInfo(project) {
  const extra = castCountOf(project);
  if (!extra) return { extra: 0, total: 1, males: 0, girls: 1, token: "1girl, solo", frame: null };
  const partner = effectiveOf(project, "currentPartner");
  const raw = [partner.text, partner.prompt].filter(Boolean).join(", ");
  // 先抹掉「指代主角」的词（the woman / her / 主角 / 她 / 名字），
  // 否则主角自己会被算成画面里的一个女性，导致 `3 people (2girls, 1boy)` 这种错标记。
  const t = raw
    .replace(/\bthe\s+(woman|girl|heroine|female\s+character)\b/gi, " ")
    .replace(/\b(her|hers|herself)\b/gi, " ")
    .replace(/主角|哥伦比娅|她/g, " ");
  const maleRe =
    /(?:(one|two|three|four|five|six|[一两二三四五六七八九]|\d+)\s*)?(?:(?:adult|tall|muscular|naked|dark\w*|shirtless|半裸|高大|成年|健壮)\s*)*(men|man|boys|boy|males|male|guys|guy|男性|男人|男子|男生|男方)(?!\w)/gi;
  const femaleRe =
    /(?:(one|two|three|four|five|six|[一两二三四五六七八九]|\d+)\s*)?(?:(?:adult|tall|muscular|naked|dark\w*|shirtless|半裸|高大|成年|健壮)\s*)*(women|woman|girls|girl|females|female|ladies|lady|女性|女人|女子|女生|女方)(?!\w)/gi;
  const count = (re) => {
    const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
    let n = 0;
    for (const m of t.matchAll(re)) {
      const tok = m[1];
      n += tok ? Number(tok) || words[String(tok).toLowerCase()] || 1 : 1;
    }
    return n;
  };
  const maleCount = count(maleRe);
  const femaleCount = count(femaleRe);
  // 只有男 → 全是男；只有女 → 全是女；都没有 → 默认按「男方」处理；都有 → 按比例分配。
  let males;
  if (maleCount + femaleCount === 0) males = extra;
  else if (maleCount === 0) males = 0;
  else males = Math.min(extra, Math.max(1, Math.round((extra * maleCount) / (maleCount + femaleCount))));
  const girls = 1 + (extra - males);
  const total = 1 + extra;
  const gender = [];
  gender.push(girls === 1 ? "1girl" : `${girls}girls`);
  if (males === 1) gender.push("1boy");
  else if (males > 1) gender.push(`${males}boys`);
  return {
    extra,
    total,
    males,
    girls,
    token: `${total} people (${gender.join(", ")})`,
    frame: `medium shot, all ${total} people fully visible in the same frame, close physical interaction between them, each of them a clearly distinct person`,
  };
}

// 人数相关的负面词：必须和 castInfo 的数字一致，否则会互相抵消
// （旧版固定写 `a third person, more than two people`，三人场景里正好把要画的人一起压掉）。
export function castNegatives(cast) {
  const parts = [
    "two copies of the same girl",
    "duplicate identical face",
    "the other people copying her features",
    "merged bodies",
    "conjoined bodies",
    "bodies fused together",
  ];
  if (cast.girls <= 1) parts.push("a second woman", "another girl", "two women", "2girls", "duplicate of the heroine");
  parts.push(`more than ${cast.total} people`, `an extra person beyond the ${cast.total} in the scene`, "a crowd", "extra people");
  if (cast.males > 0) parts.push("feminine male face", "a woman instead of a man", "androgynous male face", "effeminate men");
  return parts.join(", ");
}

// 多人模式下的一行「其他人是谁」：明确写清性别构成与「不是她」，
// 实测（三个人只写 count、不写这行）模型会把主角画两遍、或者把男性画成女性。
function castOtherLine(cast) {
  if (cast.males > 0 && cast.girls <= 1)
    return cast.males === 1
      ? "the other person is an adult male with a masculine face and short hair, clearly not a woman, with his own distinct face and body"
      : `the other ${cast.males} people are adult males with masculine faces and short hair, clearly not women, each with his own distinct face and body`;
  if (cast.girls > 1)
    return "the other people are separate characters with their own distinct faces and bodies — do not copy the woman's features onto them and do not add any further people";
  return "the other people are separate characters with their own distinct faces and bodies — do not copy the woman's features onto them";
}

export const ACTION_SPEC = `输出格式（严格遵守，顺序固定）：
1) 先用中文自然语言回复用户（2-6 句，说明你做了什么、为什么）。
2) 然后输出一个 <action> 区块，内含一个 JSON 对象，除此之外不要再输出任何内容。

<action>
{
  "changes": [
    { "path": "overrides.currentPose", "value": "中文显示描述", "prompt": "english prompt fragment", "reason": "为什么改这一项" }
  ],
  "memory": { "lastSummary": "...", "lastUserRequest": "...", "lastAIAction": "...", "unfinishedTask": "...", "nextTask": "..." },
  "task": "当前任务的一句话描述（可省略）",
  "render": false
}
</action>

changes 规则：
- 只写用户本条消息明确要求修改的项，未要求的项一律不要出现。
- 允许的 path：${OVERRIDE_KEYS.map((k) => "overrides." + k).join(" | ")} | defaults.outfit | defaults.outerOutfit | defaults.accessories | defaults.pose | defaults.expression | defaults.background | defaults.partner | cast.mode | cast.count | referenceImage.url | task。
- 人物数量由 cast.mode + cast.count 控制：single＝画面里只有主角；multi＝主角 + cast.count 个额外人物同框（cast.count 是除主角外的人数，1..5）。只要用户想让画面里出现其他人（男方、两个人、一群人），就必须把 cast.mode 写成 multi，用 cast.count 写清一共几个额外人物，并把他们的外形写进 overrides.currentPartner。只写 overrides.currentPartner 而不写 cast.mode，系统会自动切到 multi；但只改姿势/背景而模式仍是 single，画面里就不会出现其他人。
- 人数必须自洽：cast.count、overrides.currentPartner 文本、overrides.currentPose 文本里的「几个人」必须一致。系统会按 cast.count 生成「N people (1girl, 2boys)」这类标记，文本里写别的人数会让提示词自相矛盾（模型会把人物画糊、多画一个人）。
- overrides.currentPartner 描述的是「其他人」，不受角色形象锁定约束（那是主角的身份）——不要把它写成主角本人，也不要给它套用主角的发色/刘海/羽翼等特征。
- 禁止修改 characterCore（角色基准＝锁定的形象身份）。任何试图修改 characterCore 的 changes 都会被系统拒绝。
- 严格禁止随意改动人物形象：不得改变发色、发长、刘海结构、面部、闭眼状态、脑后四枚羽翼装饰与整体气质；不得移除或替换上述任何一项。出现这类写法（例如 “不同发色/短发/睁眼/背后大翅膀/换一张脸”）的 changes 会被系统直接拦截。
- value 为 "" 且 prompt 为 "" 表示把该项恢复为默认（不要用 null）。
- prompt 必须是英文（用于图像生成），value 用中文（用于界面显示）。
- 修改 defaults.outfit 只能发生在用户明确说“更换默认常服 / 修改基础常服”时；“套上、加上、穿上”某件外层衣物一律写入 overrides.currentOuterOutfit。
- 系统会做范围校验：用户本条消息没有点名的层，即使你写了 changes 也不会立即生效，只会作为「待确认」展示。所以不要写与本次请求无关的层。
- 不得以“与新版不兼容 / 已经不适用”为理由删除、覆盖或取消用户此前设置的其它覆盖。要移除某一层，必须是用户明确要求移除。
- 不要复述当前状态。与当前取值相同的 changes 会被系统当作噪音忽略，并计入“未修改”。`;

export const MAIN_PERSONA = `你是 COL Character Studio 的主 AI（角色编辑助理）。你在处理项目 COL-001。

你正在处理 COL-001。
你不是在重新创造一个角色。
你是在持续编辑一个已经存在的角色项目。

「角色基准」（Character Core）是锁定的形象身份。
「当前覆盖」是本次修改。
用户没有要求修改的项目必须保持原样。
当用户修改某一项时，只修改该项。
完成重要修改后更新项目状态。

最高优先级的硬约束（违反即被系统拦截）：
- 严格禁止随意改动人物形象。发色、发长、刘海结构、面部、闭眼状态、编发蕾丝、脑后四枚头部羽翼装饰、整体气质都属于锁定身份。
- 任何一层（服装、外层、配饰、姿势、表情、背景）的修改都不得连带改变上述形象特征，也不得通过把某项设为空值而变相移除它们。

工作方式：
- 用中文回复用户（用户使用其他语言时跟随用户）。
- 把用户的自然语言转成结构化修改，而不是重写整个角色。
- 服装层级：基础常服 → 外层服装 → 配饰。用户说“套上/加上”某件衣服时，是加在外层，不是重做整套角色。
- 只有用户明确说“更换默认常服”时，才修改 defaults.outfit。
- 单项修改：用户这次只说了姿势，就只改姿势；他此前设置的外套、发型、配饰等覆盖必须原样保留，即使你觉得它们“和新版本不搭”。
- 「单人 / 多人」是场景级开关：多人模式下会额外渲染「第二人物」（overrides.currentPartner），同框人数由 cast.count（除主角外 1..5 人）指定，此时姿势、构图、背景都要按这个人数量写（不要继续写 solo、单人特写、单人正面站姿这类只适合单人的描述）。
- 人数只能有一个来源：cast.count。不要在文本里写下和它冲突的人数（例如 count=2 却写「三个人」），那会让提示词自相矛盾、模型把人物画糊。
- 你不生成图片，你维护角色状态；系统会根据状态自动组装 Prompt。`;

function rulesBlock(project) {
  return RULE_SLOTS.map((s) => `- [${s.key}] ${project.rules[s.key] || ""}`).join("\n");
}

function coreBlock(project) {
  return project.characterCore.groups
    .map((g) => `- (${g.label}) ${g.text}\n  prompt: ${g.prompt}`)
    .join("\n");
}

function wardrobeBlock(project) {
  const d = project.defaults;
  const lines = [];
  lines.push(`[基础常服]\n  显示: ${d.outfit.text || "（空）"}\n  prompt: ${d.outfit.prompt || "（空）"}`);
  if (d.outerOutfit.text || d.outerOutfit.prompt) {
    lines.push(`[外层服装]\n  显示: ${d.outerOutfit.text}\n  prompt: ${d.outerOutfit.prompt}`);
  }
  lines.push(
    `[配饰]\n  显示: ${d.accessories.text || "（空）"}\n  prompt: ${d.accessories.prompt || "（空）"}`
  );
  return lines.join("\n");
}

function castBlock(project) {
  const mode = castModeOf(project);
  const p = effectiveOf(project, "currentPartner");
  const cast = castInfo(project);
  const tag = p.source === "override" ? "覆盖" : "默认";
  if (mode !== "multi")
    return "- 当前模式：单人（single）——画面中只有主角一个人。\n- 要让画面里出现其他人（男方 / 一群人）：把 cast.mode 写成 multi，用 cast.count 指定**同框的额外人数**，并把他们的外形写进 overrides.currentPartner。";
  return `- 当前模式：多人（multi）——画面中主角 + ${cast.extra} 个额外人物，共 ${cast.total} 人；构图、姿势、背景都按 ${cast.total} 个人来写（不要写 solo / 单人特写）。
- 每个人都要有独立的脸和身材：overrides.currentPartner 里要写清一共几个人、各自的性别/体型/着装（系统会据此生成 \`${cast.token}\` 人数标记）。
- 人数以 cast.count 为准（当前 ${cast.extra} 个额外人物），文本里的「两个人」「三个人」必须和它一致，否则提示词会自相矛盾、模型会把人物画糊。
- 第二人物 [${tag}] 显示: ${p.text || "（空）"}
  prompt: ${p.prompt || "（空）"}`;
}

export function overridesBlock(project) {
  return effectiveAll(project)
    .map((e) => {
      const tag = e.source === "override" ? "覆盖" : e.source === "core" ? "基准" : "默认";
      return `- ${e.key} [${tag}] 显示: ${e.text || "（空）"}\n  prompt: ${e.prompt || "（空）"}`;
    })
    .join("\n");
}

function memoryBlock(project) {
  return MEMORY_FIELDS.map((f) => `- ${f.key}: ${project.memory[f.key] || "（空）"}`).join("\n");
}

function changeLogBlock(project, n = 12) {
  const log = project.memory.changeLog.slice(-n);
  if (!log.length) return "（无）";
  return log
    .map((c) => `- rev${c.revision ?? "-"} ${c.kind || ""} ${c.path || ""} ${c.note || ""}`.trim())
    .join("\n");
}

export function buildMainInstruction({ project, log = [], userText = "", taskText = "" }) {
  return `${MAIN_PERSONA}

<CHARACTER_CARD code="${project.code}" name="${project.name}">
<Character Core locked="${project.characterCore.locked}">
${coreBlock(project)}
</Character Core>

<Default Outfit>
${wardrobeBlock(project)}
</Default Outfit>

<Default Look>
- Hairstyle: ${project.defaults.hairstyle.text}
- Pose: ${project.defaults.pose.text}
- Expression: ${project.defaults.expression.text}
- Background: ${project.defaults.background.text}
</Default Look>

<Reference Image>${project.referenceImage.url}</Reference Image>

<Cast>
${castBlock(project)}
</Cast>
</CHARACTER_CARD>

<PROJECT_RULES>
${rulesBlock(project)}
</PROJECT_RULES>

${ACTION_SPEC}

<CHAT_LOG>
${log.length ? log.map((m) => `${m.role === "user" ? "User" : "AI"}: ${m.text}`).join("\n\n") : "（尚无对话）"}
</CHAT_LOG>

<LIVE_STATE>
<Current Overrides>
${overridesBlock(project)}
</Current Overrides>
<Project Memory>
${memoryBlock(project)}
</Project Memory>
<Recent Changes>
${changeLogBlock(project)}
</Recent Changes>
</LIVE_STATE>

<TASK>${project.task}

${
  taskText ||
  `用户最新消息: ${userText}

请回复用户，并输出 <action> 区块。只允许修改用户明确要求的项。`
}</TASK>`;
}

function lockedPhrases(project, ids) {
  return project.characterCore.groups
    .filter((g) => !ids || ids.includes(g.id))
    .map((g) => g.anchor || (g.keywords || []).join(", ") || g.prompt)
    .filter(Boolean)
    .join("; ");
}

export function buildRetryInstruction(project, replyText) {
  return `你是 COL Character Studio 的结构化转换器。下面是一段主 AI 的回复。请把它隐含的修改意图转换成严格的 JSON。

${ACTION_SPEC}

<CHAT_LOG>
User: （略）
AI: ${replyText}
</CHAT_LOG>

<TASK>只输出一个 JSON 对象（不要标签，不要解释文字）。如果回复中没有明确要求修改任何项，输出 {"changes": []}。</TASK>`;
}

export function buildImagePrompt(project) {
  const core = project.characterCore.locked;
  const conflict = hairstyleConflict(project);
  const cast = castInfo(project);
  const partner = effectiveOf(project, "currentPartner");
  const hasPartner = cast.extra > 0 && !!(partner.prompt || partner.text);
  const layers = [];
  const push = (id, label, text, source, extra = {}) => {
    layers.push({ id, label, text: (text || "").trim(), source, ...extra });
  };

  push("core", "身份基准（锁定）", core ? corePrompts(project).join(", ") : "", "core", { locked: true });

  const base = effectiveOf(project, "currentOutfit");
  push("base", "基础常服 / 当前服装", base.prompt || base.text, base.source);

  const outer = effectiveOf(project, "currentOuterOutfit");
  if (outer.text || outer.prompt) push("outer", "外层服装", outer.prompt || outer.text, outer.source);

  const acc = effectiveOf(project, "currentAccessories");
  if (acc.text || acc.prompt) push("accessories", "配饰", acc.prompt || acc.text, acc.source);

  const hair = effectiveOf(project, "currentHairstyle");
  if (hair.source === "override") {
    const base = hair.prompt || hair.text;
    const keep = core ? lockedPhrases(project, ["hair", "bangs", "braids", "lace", "wings"]) : "";
    // 发型覆盖层里紧跟着写一句身份签名：渐变发尾 + 耳侧四枚羽饰。
    // 实测这是「换了发型之后她就不像她了」最有效的补救。
    const hairText = [base, core ? SIGNATURE_SHORT : null, keep ? `while keeping unchanged: ${keep}` : null]
      .filter(Boolean)
      .join(", ");
    push("hair", "发型覆盖", hairText, hair.source, { base });
  }

  const pose = effectiveOf(project, "currentPose");
  push("pose", "姿势", pose.prompt || pose.text, pose.source);

  const expr = effectiveOf(project, "currentExpression");
  push("expression", "表情", expr.prompt || expr.text, expr.source);

  const bg = effectiveOf(project, "currentBackground");
  push("background", "背景", bg.prompt || bg.text, bg.source);

  if (hasPartner)
    push(
      "partner",
      cast.extra > 1 ? `其他人物（${cast.extra} 人）` : "第二人物",
      `${partner.prompt || partner.text} — ${
        cast.extra > 1
          ? `these are ${cast.extra} separate characters, each with their own distinct face and design (do not copy her features onto them)`
          : "a separate second character standing close to her, with his own distinct face and design (do not copy her features onto him)"
      }`,
      partner.source
    );

  const prev = project.render.lastLayers || {};
  for (const l of layers) l.changedSinceRender = project.render.updatedAt ? prev[l.id] !== l.text : false;

  // 多人模式只保留「最外层」那件衣服。实测：把内衣 / 比基尼和泳装两层都写进三人提示词时，
  // 模型会把两套衣服分别穿在两个「她」身上——4 张里 4 张都多出一个女人（甚至 5 个人）。
  // 只留最外层（泳装 / 外套 / 连衣裙）后，同一 seed 下「1 女 + 2 男」的正确率是 4/4。
  if (hasPartner) {
    const baseLayer = layers.find((l) => l.id === "base");
    const outerLayer = layers.find((l) => l.id === "outer");
    if (baseLayer && outerLayer) {
      baseLayer.skipped = true;
      baseLayer.skipReason = "多人模式：为避免模型把两套衣服画成两个「她」，只渲染最外层服装（" + outerLayer.label + "）。";
      baseLayer.skipLabel = "多人模式未写入";
    }
  }

  const anchor = core ? lockedPhrases(project) : "";
  const coreText = core ? corePrompts(project).join(", ") : "";

  const partnerLayer = hasPartner ? layers.find((l) => l.id === "partner") : null;
  const midLayers = partnerLayer ? layers.filter((l) => l.id !== "partner") : layers;
  const femaleId = coreText || anchor;
  const dressText = [base, outer, pose, partner]
    .map((e) => [e && e.text, e && e.prompt].filter(Boolean).join(", "))
    .join(", ");
  const undress = UNDRESS_RE.test(dressText);
  const guardLines = (project.promptPolicy.guardLines || [])
    .filter((line) => !(undress && /opaque|clothing|garment/i.test(line)))
    .concat(undress ? [UNDRESS_GUARD] : []);

  const prompt = hasPartner
    ? [
        // 多人模式下 prompt 的结构和单人不同（实测这一版顺序才能稳定画出「1 女 + N 男」）：
        // 1) 人数标记 → 2) 主角身份签名（发型渐变 / 刘海 / 耳侧四枚羽饰，尽早出现，
        //   否则会被后面两位男性的描述稀释，导致「她不像她」）→ 3) 其他人是谁
        //   → 4) 构图 → 5) 主角完整身份 → 6) 服装 / 发型 / 姿势 / 背景 → 7) 风格与守护句。
        `${cast.token}, anime illustration`,
        core ? SIGNATURE_LINE : null,
        partnerLayer ? `the other ${cast.extra > 1 ? `people (${cast.extra} of them, separate from the heroine)` : "person"}: ${partnerLayer.text}` : null,
        castOtherLine(cast),
        cast.frame,
        // 多人模式的主角身份行用紧凑版（multiIdentity）：实测把 400 字身份散文写进
        // 三人提示词时，模型几乎总是多画一个「她」（原来的正确率只有 3/22）；
        // 换成紧凑身份后「1 女 + 2 男」的正确率是 11/16。渐变发尾与耳侧四枚羽饰仍逐字保留。
        femaleId ? `the woman: ${multiIdentity(project)}` : null,
        ...midLayers.filter((l) => l.id !== "core" && !l.skipped).map((l) => l.text).filter(Boolean),
        project.promptPolicy.style,
        ...guardLines,
      ]
        .filter(Boolean)
        .join(", ")
    : [
        "1girl, solo, anime illustration",
        core ? SIGNATURE_LINE : null,
        anchor ? `identity lock — keep exactly the same character design, do not change any of: ${anchor}` : null,
        ...midLayers.map((l) => l.text).filter(Boolean),
        project.promptPolicy.style,
        project.promptPolicy.frame,
        ...guardLines,
        coreText
          ? `identity re-asserted — these features must match the reference exactly and must not be altered: ${coreText}`
          : null,
      ]
        .filter(Boolean)
        .join(", ");

  const negatives = [project.promptPolicy.negativePrompt];
  if (core) {
    negatives.push(
      `different character, inconsistent character design, changed face, different hairstyle, different hair color${
        hasPartner ? "" : ", multiple characters"
      }`
    );
    for (const g of project.characterCore.groups) {
      if (!g.negative) continue;
      // 盘发 / 扎发时「渐变只能出现在最末端」这条负面词会和发型覆盖里的
      // 「发尾渐变」互相抵消，结果是整头头发都没有渐变（就是用户说的「渐变头发不见了」）。
      const neg = conflict.updo ? g.negative.replace(/,?\s*gradient only at the very tips/gi, "") : g.negative;
      negatives.push(neg);
    }
    // 耳侧四枚白色羽饰是最容易被画丢、也最能一眼认出她的特征，单独加一层负面保护。
    negatives.push("plain hair with no ornaments, missing hair clips, no feather ornament, hair with nothing in it");
  }
  if (hasPartner) negatives.push(castNegatives(cast));
  let negativePrompt = negatives.filter(Boolean).join(", ");
  if (hasPartner) {
    for (const phrase of SOLO_ONLY_NEGATIVES) {
      negativePrompt = negativePrompt
        .replace(new RegExp(`,\\s*${phrase.replace(/ /g, "\\s+")}(?=,|$)`, "gi"), "")
        .replace(new RegExp(`^${phrase.replace(/ /g, "\\s+")},\\s*`, "i"), "");
    }
  }

  return {
    prompt,
    negativePrompt,
    layers,
    changedLayers: layers.filter((l) => l.changedSinceRender).map((l) => l.id),
  };
}

export function layerSnapshot(built) {
  const snap = {};
  for (const l of built.layers) snap[l.id] = l.text;
  return snap;
}

export function diffLayers(prev, next) {
  const ids = new Set([...Object.keys(prev || {}), ...next.layers.map((l) => l.id)]);
  const out = [];
  for (const id of ids) {
    const a = (prev || {})[id];
    const l = next.layers.find((x) => x.id === id);
    const b = l ? l.text : undefined;
    if (a !== b) out.push({ id, from: a, to: b });
  }
  return out;
}

export function estimateTokens(text) {
  if (!text) return 0;
  let cjk = 0;
  for (const ch of text) if (ch.charCodeAt(0) > 0x2e80) cjk++;
  return Math.round(cjk * 1.1 + (text.length - cjk) / 4);
}

export function extractJsonBlock(raw, tag) {
  if (!raw) return null;
  const tagged = tag ? raw.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i")) : null;
  const candidates = [];
  if (tagged) candidates.push(tagged[1]);
  const fence = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((m) => m[1]);
  candidates.push(...fence.reverse());
  const braced = lastBalancedObject(raw);
  if (braced) candidates.push(braced);
  for (const c of candidates) {
    const parsed = tryParse(c);
    if (parsed) return parsed;
  }
  return null;
}

function tryParse(text) {
  if (!text) return null;
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch (e) {}
  const repaired = trimmed
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":');
  try {
    return JSON.parse(repaired);
  } catch (e) {}
  const braced = lastBalancedObject(repaired);
  if (braced) {
    try {
      return JSON.parse(braced);
    } catch (e) {}
  }
  return repairTruncated(repaired);
}

function computeClosers(body) {
  const stack = [];
  let inStr = false;
  let esc = false;
  for (const ch of body) {
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") stack.push("}");
    else if (ch === "[") stack.push("]");
    else if (ch === "}" || ch === "]") {
      if (stack.pop() !== ch) return null;
    }
  }
  if (inStr) return null;
  return stack.reverse().join("");
}

export function repairTruncated(text) {
  const start = text.indexOf("{");
  if (start < 0) return null;
  const s = text.slice(start);
  const cuts = [];
  for (let i = s.length - 1; i > 0 && cuts.length < 400; i--) {
    const c = s[i];
    if (c === "}" || c === "]" || c === '"' || /[0-9a-zA-Z]/.test(c)) cuts.push(i + 1);
  }
  for (const cut of cuts) {
    const body = s.slice(0, cut);
    const closers = computeClosers(body);
    if (closers === null) continue;
    const candidates = [body + closers, body.replace(/,\s*$/, "") + closers];
    for (const cand of candidates) {
      try {
        return JSON.parse(cand);
      } catch (e) {}
    }
  }
  return null;
}

function lastBalancedObject(text) {
  let start = -1;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let last = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        last = text.slice(start, i + 1);
        start = -1;
      }
    }
  }
  return last;
}

export function stripActionBlock(text) {
  if (!text) return "";
  return text
    .replace(/<fix>[\s\S]*?<\/fix>/gi, "")
    .replace(/<action>[\s\S]*?<\/action>/gi, "")
    .replace(/<action>[\s\S]*$/i, "")
    .replace(/<fix>[\s\S]*$/i, "")
    .replace(/```(?:json)?[\s\S]*$/i, "")
    .trim();
}
