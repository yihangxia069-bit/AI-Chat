import {
  OVERRIDE_KEYS,
  OVERRIDE_META,
  RULE_SLOTS,
  MEMORY_FIELDS,
  effectiveAll,
  sourceDefault,
  countOverrides,
  effectiveOf,
  castModeOf,
  spokenCastCount,
} from "./state.js";
import { buildImagePrompt, castInfo, multiIdentityTokens } from "./prompt.js";

const OPAQUE_RE =
  /\b(bikini|lingerie|nude|naked|topless|see-through|see through|transparent|sheer|translucent|micro ?bikini)\b|比基尼|内衣|(?<!不)透明|半透明|裸/i;

const CONTRADICTIONS = [
  {
    id: "hair-length",
    label: "发长与角色基准冲突",
    re: /\b(short hair|bob cut|pixie cut|bob hairstyle|shoulder[- ]length)\b|短发|波波头|齐肩短发/i,
    fields: ["currentHairstyle"],
    severity: "fail",
    lock: true,
    message: "发型覆盖把「长直发」改成了短发，与 角色基准 冲突（发型覆盖只应改变造型编排，如盘发/双马尾/编发方式）。",
    patch: { kind: "state", path: "overrides.currentHairstyle", value: "", prompt: "", label: "清除发型覆盖" },
  },
  {
    id: "hair-color",
    label: "发色与角色基准冲突",
    re: /\b(blonde|blond hair|white hair|silver hair|pink hair|brown hair|purple hair|blue hair)\b|金发|银发|白发|粉发/i,
    fields: ["currentHairstyle"],
    severity: "fail",
    lock: true,
    message: "发型覆盖改变了发色，角色基准 锁定黑色头发 + 猩红渐变发尾。",
    patch: { kind: "state", path: "overrides.currentHairstyle", value: "", prompt: "", label: "清除发型覆盖" },
  },
  {
    id: "hair-arrangement",
    label: "发型编排与角色基准的长直发共存风险",
    re: /\b(low bun|high bun|chignon|updo|up-do|ponytail|twin tails|hair up|bun hairstyle)\b|盘发|丸子头|扎起|马尾/i,
    fields: ["currentHairstyle"],
    severity: "warn",
    message:
      "该发型覆盖把长发收了起来，但角色基准层仍逐字包含「very long straight hair … past the waist」，两层会同时进入图像提示词，模型可能随机取舍——这正是「她不像她」最常见的来源。系统已自动把身份层里的这一句改写成「盘起来也依然是同一头头发」，并在发型层末尾强制补上「发尾酒红渐变 + 耳侧四枚白色羽饰」的身份签名，同时剔除与它冲突的负面词。想要最稳定的形象还原，建议清除发型覆盖、回到默认长发。",
    patch: { kind: "state", path: "overrides.currentHairstyle", value: "", prompt: "", label: "清除发型覆盖（恢复默认长发）" },
  },
  {
    id: "bangs",
    label: "刘海与角色基准冲突",
    re: /\b(no bangs|forehead exposed|middle part|curtain bangs|side[- ]swept bangs)\b|中分|无刘海|露出额头/i,
    fields: ["currentHairstyle"],
    severity: "warn",
    lock: true,
    message: "发型覆盖涉及刘海结构，角色基准锁定「整齐直刘海」。",
  },
  {
    id: "eyes",
    label: "眼睛状态与角色基准冲突",
    re: /\b(eyes open|open eyes|wide eyes|staring|gazing)\b|睁眼|张开眼睛/i,
    fields: ["currentExpression"],
    severity: "fail",
    lock: true,
    message: "表情覆盖与角色基准的「闭眼」冲突。若确实要睁眼，应先明确解锁角色基准。",
    patch: { kind: "state", path: "overrides.currentExpression", value: "", prompt: "", label: "清除表情覆盖" },
  },
  {
    id: "wings-removed",
    label: "头部羽翼被移除",
    re: /\b(no wings|without wings|remove the wings|no head ornaments|wings removed)\b|去掉羽翼|没有羽翼|移除翅膀/i,
    fields: ["currentHairstyle", "currentAccessories", "currentOutfit", "currentOuterOutfit"],
    severity: "fail",
    lock: true,
    message: "覆盖文本试图移除头部四枚白色羽翼装饰，这是角色基准锁定的形象特征。",
    patch: { kind: "state", value: "", prompt: "", label: "清除该层覆盖" },
  },
  {
    id: "wings-back",
    label: "羽翼位置被改写",
    re: /\b(back wings|angel wings|large wings behind|large wings on the head|wings on the back|feathered wings behind (the|her) body)\b|背部羽翼|背后翅膀|大翅膀/i,
    fields: ["currentHairstyle", "currentAccessories", "currentOutfit", "currentOuterOutfit", "currentBackground"],
    severity: "warn",
    lock: true,
    message: "羽翼是「脑后耳朵高度、左右各两枚」的头部装饰，不是背部翅膀。",
  },
  {
    id: "outfit-opaque",
    label: "默认基础常服疑似不完整/不透明",
    re: OPAQUE_RE,
    fields: ["defaults.outfit"],
    severity: "warn",
    message:
      "默认的基础常服（属于角色身份的一部分）必须是完整、得体、不透明的服装。当前生效的服装覆盖不在此检查范围内——覆盖由用户逐次指定。",
  },
  {
    id: "outfit-rebuild",
    label: "服装被整层重写",
    re: /\b(instead of (her|the) outfit|replace the (base|entire|whole)|redesign the character|from scratch|completely new outfit)\b|重新设计|从头设计/i,
    fields: ["currentOutfit", "currentOuterOutfit", "currentAccessories"],
    severity: "warn",
    message: "检测到「重做整套角色」式表述。加外套应写入 currentOuterOutfit 并保留 Base Outfit。",
  },
  {
    id: "face-rewrite",
    label: "覆盖尝试改写面部",
    re: /\b(different face|new face|change her face|change the face|alter the face)\b|换脸|改变脸型|修改五官/i,
    // 「第二人物」是另一个人，不参与主角面部/形象的锁定检查
    fields: OVERRIDE_KEYS.filter((k) => k !== "currentPartner"),
    severity: "fail",
    lock: true,
    message: "面部属于 角色基准，锁定不可修改。",
    patch: { kind: "state", value: "", prompt: "", label: "清除该层覆盖" },
  },
  {
    id: "scene-manipulation",
    label: "背景覆盖污染角色层",
    re: /\b(holding|wearing|dressed|clothing|outfit|hair)\b/i,
    fields: ["currentBackground"],
    severity: "warn",
    message: "Background 层里出现了角色描述，层职责被污染（背景层不应包含角色/服装/头发描述）。",
  },
];

function fieldLabel(field) {
  if (field.startsWith("overrides.")) {
    const k = field.slice("overrides.".length);
    return OVERRIDE_META[k] ? OVERRIDE_META[k].label : field;
  }
  if (field.startsWith("defaults.")) return "默认 · " + field.slice("defaults.".length);
  return field;
}

function textOf(project, fieldKey) {
  if (fieldKey === "defaults.outfit") return [project.defaults.outfit.text, project.defaults.outfit.prompt];
  if (fieldKey === "defaults.outerOutfit") return [project.defaults.outerOutfit.text, project.defaults.outerOutfit.prompt];
  if (fieldKey === "defaults.accessories") return [project.defaults.accessories.text, project.defaults.accessories.prompt];
  const ov = project.overrides[fieldKey];
  if (!ov) return [];
  if (ov.source !== "override") return [];
  return [ov.value, ov.prompt];
}

export function appearanceViolations(text) {
  const blob = String(text || "");
  if (!blob.trim()) return [];
  const out = [];
  for (const rule of CONTRADICTIONS) {
    if (!rule.lock) continue;
    if (rule.re.test(blob)) out.push({ id: rule.id, label: rule.label, severity: rule.severity, message: rule.message });
  }
  return out;
}

export function checkAppearanceLock(project) {
  const violations = [];
  for (const k of OVERRIDE_KEYS) {
    // 「第二人物」描述的是另一个人，不检查主角的形象锁定规则。
    if (k === "currentPartner") continue;
    for (const h of appearanceViolations(textOf(project, k).join(" "))) violations.push({ ...h, field: k });
  }
  if (!project.characterCore.locked) {
    return {
      id: "appearance-lock",
      label: "人物形象锁定",
      status: "warn",
      detail: violations.length
        ? `角色基准处于解锁状态，且发现 ${violations.length} 处形象改动写法（${violations
            .map((v) => `${OVERRIDE_META[v.field].label}·${v.label}`)
            .join("；")}）。建议重新锁定角色基准。`
        : "角色基准当前处于解锁状态，人物形象可被改动。建议重新锁定。",
    };
  }
  if (violations.length) {
    const hard = violations.filter((v) => v.severity === "fail");
    return {
      id: "appearance-lock",
      label: "人物形象锁定",
      status: hard.length ? "fail" : "warn",
      detail: `发现 ${violations.length} 处会改动人物形象的写法：${violations
        .map((v) => `${OVERRIDE_META[v.field].label}·${v.label}`)
        .join("；")}。形象特征由角色基准锁定，禁止随意改动。`,
      patch: { kind: "state", path: "overrides." + (hard.length ? hard[0].field : violations[0].field), value: "", prompt: "", label: "清除该层覆盖" },
    };
  }
  return { id: "appearance-lock", label: "人物形象锁定", status: "pass", detail: "形象特征已锁定，且未发现与角色基准冲突的覆盖写法。" };
}

function coreKeywords(project) {
  const out = [];
  for (const g of project.characterCore.groups) {
    for (const k of g.keywords || []) out.push({ keyword: k, group: g.label });
  }
  return out;
}

export function checkCorePresence(project, built) {
  const hay = (built.prompt + " " + built.negativePrompt).toLowerCase();
  // 多人模式的身份行是压缩版（multiIdentity），不是单人模式那套完整散文，
  // 所以按紧凑身份表的字面特征核对，否则会出现「明明写了却报丢特征」的假失败。
  const multi = !!(built.layers || []).find((l) => l.id === "partner");
  const list = coreKeywords(project).length && multi ? multiIdentityTokens() : coreKeywords(project);
  const missing = list.filter((k) => !hay.includes(String(k.keyword).toLowerCase()));
  if (!project.characterCore.locked) {
    return {
      id: "core-lock",
      label: "角色基准锁定",
      status: "warn",
      detail: "角色基准当前处于解锁状态，主 AI 可能改写角色身份。",
    };
  }
  return {
    id: "core-presence",
    label: "角色基准特征完整性",
    status: missing.length ? "fail" : "pass",
    detail: missing.length
      ? `图像提示词丢失了 ${missing.length} 个形象特征组：${[...new Set(missing.map((m) => m.group))].join("、")}`
      : multi
      ? `多人模式的紧凑身份行覆盖了全部 ${list.length} 个核心特征（发型渐变 / 刘海 / 编发蕾丝 / 耳侧羽饰 / 闭眼浅肤 / 气质）。`
      : `${list.length} 个核心特征全部存在于提示词中。`,
  };
}

export function checkContradictions(project) {
  const hits = [];
  for (const rule of CONTRADICTIONS) {
    for (const field of rule.fields) {
      const parts = textOf(project, field);
      const blob = parts.filter(Boolean).join(" ");
      if (blob && rule.re.test(blob)) {
        hits.push({
          id: rule.id,
          label: rule.label,
          status: rule.severity,
          detail: `${rule.message}（来源：${fieldLabel(field)}）`,
          field,
          patch: rule.patch ? { ...rule.patch, path: rule.patch.path || "overrides." + field } : undefined,
        });
        break;
      }
    }
  }
  return hits;
}

export function checkLayerIntegrity(project, built) {
  const prev = project.render.lastLayers;
  if (!project.render.updatedAt || !prev) {
    return {
      id: "layer-integrity",
      label: "层完整性（未授权层变化）",
      status: "pass",
      detail: "尚未渲染，暂无可比基准。",
    };
  }
  const changed = built.layers.filter((l) => prev[l.id] !== l.text).map((l) => l.id);
  if (!changed.length) {
    return {
      id: "layer-integrity",
      label: "层完整性（未授权层变化）",
      status: "pass",
      detail: "当前提示词与上次渲染逐层一致。",
    };
  }
  const authorized = new Set();
  for (const c of project.memory.changeLog) {
    if ((c.ts || 0) >= (project.render.updatedAt || 0)) (c.layersChanged || []).forEach((l) => authorized.add(l));
  }
  const orphan = changed.filter((l) => l.id !== undefined && !authorized.has(l) && l !== "core");
  return {
    id: "layer-integrity",
    label: "层完整性（未授权层变化）",
    status: orphan.length ? "fail" : "pass",
    detail: orphan.length
      ? `这些层自上次渲染后被改动，但没有任何 changeLog 授权：${orphan.join(", ")}（典型症状：换服装时发型/脸部一起变化）。`
      : `被改动的层（${changed.join(", ")}）都有对应的修改记录。`,
  };
}

export function checkOutfitLayering(project) {
  const base = project.defaults.outfit;
  const outer = project.overrides.currentOuterOutfit;
  const cur = project.overrides.currentOutfit;
  const issues = [];
  if (!base.text.trim() && !base.prompt.trim()) issues.push("默认基础常服为空，角色失去基础常服。");
  if (outer.source === "override" && /\b(instead of|replace|no longer wear|remove her)\b|换成|不要原来的|取代/i.test(outer.value + outer.prompt))
    issues.push("外层服装的覆盖文本像是要替换基础常服，而不是叠加在外层。");
  const active = [
    cur.source === "override" ? "当前服装（覆盖）" : "当前服装（默认）",
    outer.source === "override" ? "外层（覆盖）" : null,
    project.overrides.currentAccessories.source === "override" ? "配饰（覆盖）" : null,
  ].filter(Boolean);
  return {
    id: "outfit-layering",
    label: "服装层级 基础常服 → 外层服装 → 配饰",
    status: issues.length ? "fail" : "pass",
    detail: issues.length ? issues.join(" ") : `层级完整：${active.join(" → ")}。外层未被误写成基础常服的替换。`,
  };
}

export function checkOverrideHygiene(project) {
  const redundant = [];
  for (const k of OVERRIDE_KEYS) {
    const ov = project.overrides[k];
    if (ov.source !== "override") continue;
    const def = sourceDefault(project, k);
    if (ov.value.trim() && ov.value.trim() === (def.text || "").trim() && (ov.prompt || "").trim() === (def.prompt || "").trim())
      redundant.push(k);
  }
  const n = countOverrides(project);
  if (redundant.length) {
    return {
      id: "override-hygiene",
      label: "覆盖层卫生",
      status: "warn",
      detail: `这些覆盖与默认值完全相同，属于无效覆盖（会让 AI 误判“用户要求了修改”）：${redundant.join(", ")}`,
    };
  }
  if (n >= 5) {
    return {
      id: "override-hygiene",
      label: "覆盖层卫生",
      status: "warn",
      detail: `同时激活 ${n} 项覆盖，提示词已被大量覆盖影响，角色一致性风险上升。建议把确认后的改动固化进默认值，或逐项恢复默认。`,
    };
  }
  return { id: "override-hygiene", label: "覆盖层卫生", status: "pass", detail: `激活中的覆盖：${n} 项。` };
}

// 图像提示词必须是英文：中文片段（例如「三人 intimate interaction」）会明显削弱
// 该层对画面的影响，模型基本当噪音忽略，还可能把构图理解错。
const CJK_RE = /[\u4e00-\u9fff]/;

export function checkPromptLanguage(project, built) {
  const bad = (built.layers || []).filter((l) => l.text && CJK_RE.test(l.text));
  if (!bad.length)
    return { id: "prompt-language", label: "图像提示词语言", status: "pass", detail: "所有层都提供了英文 prompt，最终提示词为纯英文。" };
  return {
    id: "prompt-language",
    label: "图像提示词里混入了中文",
    status: "warn",
    detail: `这些层缺少英文 prompt（或 prompt 里混有中文），中文字符对图像模型几乎没有约束力：${bad
      .map((l) => l.label)
      .join("、")}。请在对话里让 AI 把该层改写成英文 prompt。`,
  };
}

// 多人模式下的服装层处理。实测（同一 seed，各 4 张）：让主角同时穿「内衣 + 泳装」两层时，
// 4/4 张都会多出一个女人（两套衣服分别穿在两个人身上）；只渲染最外层服装后 4/4 张正确。
// 同样地，只穿内衣 / 比基尼的三人场景 6/6 张都多出一个女人——这是模型层面的问题，
// 所以这里只做「提示 + 舍弃内层」，不改用户设置的文本。
const LINGERIE_RE = /\b(bikini|lingerie|underwear|panties|bra|negligee|see-through|sheer)\b|内衣|比基尼|内裤/i;

export function checkMultiOutfit(project, built) {
  const skipped = (built.layers || []).filter((l) => l.skipped && (l.id === "base" || l.id === "outer"));
  if (skipped.length)
    return {
      id: "multi-outfit",
      label: "多人模式服装层",
      status: "pass",
      detail: `为避免模型把两套衣服分别画到两个「她」身上，已只渲染最外层服装：${skipped
        .map((l) => l.label)
        .join("、")} 没有写入提示词（层本身仍保留在层列表里，切回单人模式即恢复）。`,
    };
  if (castModeOf(project) !== "multi")
    return { id: "multi-outfit", label: "多人模式服装层", status: "pass", detail: "单人模式：服装层级不受多人分身的限制。" };
  const base = effectiveOf(project, "currentOutfit");
  if (LINGERIE_RE.test([base.text, base.prompt].filter(Boolean).join(" ")))
    return {
      id: "multi-outfit",
      label: "多人模式：内衣类服装容易让她被画成两个人",
      status: "warn",
      detail:
        "实测同一 seed 下，主角只穿内衣 / 比基尼的三人场景 6 张全部多出一个女人（模型把服装拆给了另一个「她」）。多人模式建议改用完整服装（连衣裙 / 泳装 / 外套），或先用单人模式渲染形象。",
    };
  return { id: "multi-outfit", label: "多人模式服装层", status: "pass", detail: "服装层没有触发多人分身的风险写法。" };
}

export function checkPromptOrder(project, built) {
  // skipped 的层是系统有意不写入提示词的（例如多人模式下被舍弃的内层服装），
  // 它们仍然留在层列表里供用户查看，但不参与顺序校验。
  const present = built.layers.filter((l) => l.text && !l.skipped);
  const ids = built.layers.filter((l) => !l.skipped).map((l) => l.id);
  const names = built.layers.map((l) => l.label).join(" → ");
  // 多人模式下核心身份文本是按组拼进「the woman: …」那一段的（组间用逗号），
  // 所以整块 `core.text`（组间是换行）不一定能整段匹配到——退化成按分句/分组定位。
  const H = String(built.prompt || "").replace(/\\n/g, " ").replace(/\s+/g, " ");
  const locate = (text) => {
    const raw = String(text || "");
    if (!raw) return -1;
    const t = raw.replace(/\\n/g, " ").replace(/\s+/g, " ").trim();
    if (!t) return -1;
    if (H.includes(t)) return H.indexOf(t);
    const chunks = t.split(/[,;]/).map((s) => s.trim()).filter((s) => s.length > 8);
    for (const c of chunks) if (H.includes(c)) return H.indexOf(c);
    return -1;
  };
  const partnerLayer = present.find((l) => l.id === "partner");
  const hoisted = castModeOf(project) === "multi" && !!partnerLayer;
  const partnerAt = hoisted ? locate(partnerLayer.text) : -1;
  const positions = present
    .filter((l) => !(hoisted && l.id === "partner"))
    .map((l) => ({ id: l.id, at: locate(l.text) }));
  const expected = ["core", "base", "outer", "accessories", "hair", "pose", "expression", "background", "partner"].filter((id) => ids.includes(id));
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  const missingPos = positions.some((p) => p.at < 0) || (hoisted && partnerAt < 0);
  const outOfOrder = positions.some((p, i) => i > 0 && positions[i - 1].at > p.at);
  const hoistOk = !hoisted || partnerAt < (positions[0] ? positions[0].at : Infinity);
  const orderOk = ids.join(">") === expected.join(">");
  const ok = !missingPos && !outOfOrder && !dupes.length && orderOk && hoistOk && positions[0] && positions[0].id === "core";
  return {
    id: "prompt-order",
    label: "提示词组装顺序",
    status: ok ? "pass" : "fail",
    detail: ok
      ? `身份基准在最前，层序正确：${names}${hoisted ? "（多人模式：第二人物已前置锚定）" : ""}`
      : missingPos
      ? `有层文本没有出现在最终提示词中（层被覆盖或重复拼接）。层序：${names}`
      : outOfOrder
      ? `层在最终提示词中出现顺序与层序不一致（这会导致模型把后来层的内容当作身份特征）。层序：${names}`
      : `层序异常：${names}${dupes.length ? "，重复层：" + dupes.join(",") : ""}`,
  };
}

export function checkMemory(project) {
  const empty = MEMORY_FIELDS.filter((f) => !String(project.memory[f.key] || "").trim()).map((f) => f.key);
  if (empty.length)
    return { id: "memory", label: "项目记忆完整性", status: "warn", detail: `这些记忆字段为空：${empty.join(", ")}。` };
  return { id: "memory", label: "项目记忆完整性", status: "pass", detail: "五个记忆字段均已填写。" };
}

export function checkRules(project) {
  const empty = RULE_SLOTS.filter((s) => !String(project.rules[s.key] || "").trim()).map((s) => s.key);
  if (empty.length)
    return { id: "rules", label: "规则库完整性", status: "warn", detail: `这些规则槽为空：${empty.join(", ")}。` };
  return { id: "rules", label: "规则库完整性", status: "pass", detail: `${RULE_SLOTS.length} 个规则槽均已定义。` };
}

export function checkRenderStaleness(project, built) {
  const changed = built.changedLayers || [];
  if (!project.render.updatedAt)
    return { id: "render-stale", label: "渲染同步状态", status: "warn", detail: "项目还没有渲染基准图，无法判断视觉一致性。" };
  if (changed.length)
    return {
      id: "render-stale",
      label: "渲染同步状态",
      status: "warn",
      detail: `自上次渲染后以下层已变化：${changed.join(", ")}。重新渲染可验证视觉一致性（种子${project.render.lockSeed ? "已锁定 " + project.render.seed : "未锁定"}）。`,
    };
  return { id: "render-stale", label: "渲染同步状态", status: "pass", detail: "当前提示词与上次渲染一致。" };
}

export function checkReference(project) {
  const ok = !!String(project.referenceImage.url || "").trim();
  return {
    id: "reference",
    label: "参考基准图",
    status: ok ? "pass" : "fail",
    detail: ok ? project.referenceImage.url : "参考图为空，角色身份失去视觉基准。",
  };
}

export function checkCastMode(project, built) {
  const mode = castModeOf(project);
  const partner = effectiveOf(project, "currentPartner");
  const cast = castInfo(project);
  const hasPartnerText = !!(String(partner.text || "").trim() || String(partner.prompt || "").trim());
  const ids = built.layers.map((l) => l.id);
  if (mode === "multi") {
    if (!hasPartnerText)
      return {
        id: "cast-mode",
        label: "单人 / 多人模式",
        status: "fail",
        detail: "当前是多人模式，但「第二人物」描述为空，画面里会出现一个没有设定的人。请在「第二人物」层填写对方的外形。",
      };
    if (!ids.includes("partner"))
      return {
        id: "cast-mode",
        label: "单人 / 多人模式",
        status: "fail",
        detail: "当前是多人模式，但最终提示词里没有「第二人物」层（层组装异常）。",
      };
    if (/multiple characters/i.test(built.negativePrompt))
      return {
        id: "cast-mode",
        label: "单人 / 多人模式",
        status: "fail",
        detail: "多人模式下负面提示词仍含「multiple characters」，会把其他人一起压掉。",
      };
    // 文本里写的「三个人」「two men」必须和 cast.count 对得上，否则提示词会自相矛盾
    // （开头写 2 people、正文写三个人），模型会把人物糊在一起 —— 这是实测过的崩坏原因。
    const saidCount = spokenCastCount(project);
    if (saidCount && saidCount !== cast.total)
      return {
        id: "cast-mode",
        label: "单人 / 多人模式",
        status: "fail",
        detail: `「同框人数」设为 ${cast.total} 人（主角 + ${cast.extra}），但第二人物 / 姿势文本里写的是 ${saidCount} 人（检测到「${saidCount}」相关词）。提示词开头会写 ${cast.token}，两边矛盾会让模型把人物画糊、多画一个人。请把「同框人数」改成 ${saidCount}，或改掉文本里的人数。`,
      };
    if (!new RegExp(`^${cast.total} people`, "i").test(built.prompt))
      return {
        id: "cast-mode",
        label: "单人 / 多人模式",
        status: "warn",
        detail: `提示词开头的人数标记和「同框人数」不一致（应为 \`${cast.token}\`）。`,
      };
    const warn3 =
      cast.total >= 3
        ? {
            status: "warn",
            detail: `共 ${cast.total} 人：该图像模型对 3 人以上的同框构图不稳定（同一 seed 下也可能出现人物糊在一起 / 主角被画成两个人）。如果多次渲染都不理想，建议改成 2 人同框，或让其他人的身体与主角分开、只做局部特写。`,
          }
        : null;
    return {
      id: "cast-mode",
      label: "单人 / 多人模式",
      status: warn3 ? "warn" : "pass",
      detail:
        warn3?.detail ||
        `多人：主角 + ${cast.extra} 个额外人物（${partner.source === "override" ? "覆盖" : "默认"}），共 ${cast.total} 人（${cast.token}），负面提示词已移除限制多人的用词。`,
    };
  }
  if (hasPartnerText && partner.source === "override")
    return {
      id: "cast-mode",
      label: "单人 / 多人模式",
      status: "warn",
      detail: "当前是单人模式：已填写的「第二人物」不会被渲染。要让画面里出现其他人，请把模式切到「多人」。",
    };
  return { id: "cast-mode", label: "单人 / 多人模式", status: "pass", detail: "单人：画面中只有主角一个人。" };
}

export function runChecks(project, builtIn) {
  const built = builtIn || buildImagePrompt(project);
  const list = [
    checkAppearanceLock(project),
    checkCastMode(project, built),
    checkMultiOutfit(project, built),
    checkCorePresence(project, built),
    checkReference(project),
    checkPromptOrder(project, built),
    checkPromptLanguage(project, built),
    checkLayerIntegrity(project, built),
    ...checkContradictions(project),
    checkOutfitLayering(project),
    checkOverrideHygiene(project),
    checkMemory(project),
    checkRules(project),
    checkRenderStaleness(project, built),
  ];
  const fails = list.filter((c) => c.status === "fail").length;
  const warns = list.filter((c) => c.status === "warn").length;
  const passes = list.filter((c) => c.status === "pass").length;
  const score = Math.max(0, Math.round((passes / list.length) * 100 - fails * 10 - warns * 3));
  return { list, fails, warns, passes, score, built };
}

export function healthLabel(score) {
  if (score >= 90) return { text: "健康", cls: "ok" };
  if (score >= 70) return { text: "需要注意", cls: "warn" };
  return { text: "存在冲突", cls: "fail" };
}
