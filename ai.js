import {
  OVERRIDE_KEYS,
  OVERRIDE_META,
  setOverride,
  clearOverride,
  getPath,
  setPath,
  pushChange,
  updateMemory,
  effectiveOf,
  castModeOf,
  castCountOf,
  spokenCastCount,
  CAST_COUNT_MAX,
} from "./state.js";
import {
  buildMainInstruction,
  buildRetryInstruction,
  buildImagePrompt,
  layerSnapshot,
  diffLayers,
  extractJsonBlock,
  stripActionBlock,
  estimateTokens,
} from "./prompt.js";
import { appearanceViolations } from "./checks.js";
import * as Store from "./store.js";

const ALLOWED_PATHS = [
  ...OVERRIDE_KEYS.map((k) => "overrides." + k),
  "defaults.outfit",
  "defaults.outerOutfit",
  "defaults.accessories",
  "defaults.pose",
  "defaults.expression",
  "defaults.background",
  "defaults.partner",
  "cast.mode",
  "cast.count",
  "referenceImage.url",
  "task",
];

const SCOPE_PATTERNS = [
  { key: "currentOuterOutfit", re: /外套|大衣|风衣|披风|斗篷|斗蓬|罩衫|开衫|针织衫|毛衣|卫衣|夹克|小西装|西装外套|披肩|披着|长袍|外衣|套上|套一件|coat|overcoat|jacket|cloak|cape|robe|outerwear|blazer|cardigan|sweater|hoodie/i },
  { key: "currentHairstyle", re: /发型|头发|发色|刘海|编发|盘发|马尾|丸子|扎(发|起)|散发|披发|辫|长直发|剪短|hairstyle|hair ?style|haircut|bun|ponytail|braid|bangs|updo/i },
  { key: "currentExpression", re: /表情|神情|笑容|微笑|哭泣|流泪|生气|害羞|脸红|挑眉|皱眉|闭眼|睁眼|冷酷|温柔地看|expression|smile|frown|blush|tears/i },
  { key: "currentBackground", re: /背景|场景|环境|房间|教室|街道|花园|夜景|室内|室外|雨中|海边|森林|background|scenery|environment|room|street|garden/i },
  { key: "currentAccessories", re: /配饰|饰品|首饰|项链|颈饰|choker|耳环|耳饰|戒指|手链|丝带|蝴蝶结|发饰|accessor|necklace|earring|bracelet|ribbon/i },
  { key: "currentOutfit", re: /服装|衣服|常服|服饰|穿上|穿着|换了?一?套|内衣|内裤|胸罩|裙子|衬衫|短裤|长裤|丝袜|裤袜|皮鞋|靴子|制服|泳装|比基尼|睡衣|outfit|clothes|clothing|dress|skirt|shirt|blouse|lingerie|underwear|bra\b|panties|stocking|legging|boot|swimsuit|bikini|nightgown/i },
  { key: "currentPose", re: /姿势|姿态|动作|坐|站|躺|跪|趴|蹲|手臂|胳膊|双腿|抬起|转身|抱住|手放|做爱|性爱|交合|发生关系|同房|上床|进入她|插入|抽插|骑在|压在|pose|posture|stance|sitting|standing|lying|kneel|arm|leg|sex|intercourse|thrust/i },
  { key: "currentPartner", re: /第二人物|另一个人|另一个角色|另一个人物|男方|男性|男人|男的|多人|双人|两个人|三人|一群|另一个人|做爱|性爱|交合|发生关系|同房|上床|partner|second character|another (man|person)|two people|sex|intercourse/i },
];

export function waitForPlugins(timeoutMs = 15000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const tick = () => {
      if (typeof root !== "undefined" && root && typeof root.generateText === "function") return resolve(true);
      if (Date.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(tick, 150);
    };
    tick();
  });
}

export function meta() {
  try {
    return root.generateText({ getMetaObject: true });
  } catch (e) {
    return { countTokens: estimateTokens, idealMaxContextTokens: 6000 };
  }
}

export function chatLog(project, which) {
  const arr = project.chats[which] || [];
  const out = [];
  const summary = project.chats[which + "Summary"];
  if (summary) out.push({ role: "ai", text: `[历史摘要] ${summary}` });
  for (const m of arr) {
    if (m.kind !== "msg") continue;
    out.push({ role: m.role, text: m.text });
  }
  return out;
}

function appendChat(project, which, msg) {
  project.chats[which].push({ ts: Date.now(), ...msg });
  const arr = project.chats[which];
  if (arr.length > 120) arr.splice(0, arr.length - 120);
}

async function callModel({ instruction, onPartial }) {
  const res = await root.generateText({
    instruction,
    onChunk: (d) => {
      if (onPartial) onPartial(stripActionBlock(d.fullTextSoFar), d.fullTextSoFar);
    },
  });
  const full = res && res.text != null ? res.text : String(res);
  return full;
}

export function validatePath(path) {
  if (typeof path !== "string" || !path.trim()) return { ok: false, reason: "path 为空" };
  const p = path.trim();
  if (/characterCore/i.test(p)) return { ok: false, reason: "角色基准（人物形象）是锁定身份，已拒绝写入" };
  if (ALLOWED_PATHS.includes(p)) return { ok: true, path: p };
  return { ok: false, reason: `未授权的 path：${p}` };
}

export function inferTargets(userText) {
  const t = String(userText || "");
  const resetAll = /恢复默认|恢复原样|重置|还原|清除(全部|所有)?(覆盖|修改)|全部恢复|回到默认|撤销|reset|revert/i.test(t);
  const bare = t.replace(/保留[^，。；！？\n]{0,18}|保持[^，。；！？\n]{0,18}|不要(改|动|换)[^，。；！？\n]{0,14}|不改[^，。；！？\n]{0,14}/g, " ");
  const layers = new Set();
  for (const p of SCOPE_PATTERNS) if (p.re.test(bare)) layers.add(p.key);
  const defaultsNoun = /(默认|基础)(常服|服装|衣服|装束|造型|外观)|default outfit|base outfit/i.test(bare);
  const defaultsVerb = /换|改|设|更新|变|调|永久|permanent/i.test(bare);
  const defaults = /设为默认|永久(改成|换|改为)|default outfit|base outfit|permanent/i.test(bare) || (defaultsNoun && defaultsVerb);
  const multiRe = /多人|双人|两个?人|三人|四个人|一群人|另一个人|另一个角色|男方|男性|男人|男的|和(一个)?(他|男人)|一起(做|睡|躺)|做爱|性爱|make love|sex|second (character|person)|two people/i;
  const singleRe = /单人|一个人|只有她|她一个人|独自|单独|solo/i;
  const castMode = multiRe.test(bare) ? "multi" : singleRe.test(bare) ? "single" : null;
  // 人数：用户原话里的「三个人 / 两个男人 / three people」→ 额外人数（除主角外）
  const castCount = castCountMentioned(bare);
  return { layers, resetAll, defaults, castMode, castCount, any: layers.size > 0 || resetAll };
}

// 从用户原话里读「同框人数」：返回**额外人数**（除主角外），读不出来返回 null。
function castCountMentioned(text) {
  const t = String(text || "");
  const cn = { 一: 1, 两: 2, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };
  const en = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
  const num = (tok) => cn[tok] || en[String(tok).toLowerCase()] || Number(tok) || 0;
  let total = 0;
  for (const m of t.matchAll(/([一两二三四五六]|\d+)\s*(?:个|名|位)?\s*人(?!物)/g)) total = Math.max(total, num(m[1]));
  for (const m of t.matchAll(/\b(\d+|one|two|three|four|five|six)\s+(?:people|persons|figures|characters)\b/gi))
    total = Math.max(total, num(m[1]));
  const totalPeople = total;
  if (totalPeople > 1) return Math.min(CAST_COUNT_MAX, totalPeople - 1);
  let extra = 0;
  for (const m of t.matchAll(/([一两二三四五六]|\d+)\s*(?:个|名|位)?\s*(?:成年|高大|半裸)?\s*(?:男|女)(?:性|人|子)?/g))
    extra = Math.max(extra, num(m[1]));
  for (const m of t.matchAll(/\b(\d+|one|two|three|four|five|six)\s+(?:adult\s+|tall\s+|muscular\s+|naked\s+|dark\w*\s+)*(?:men|women|boys|girls|males|females|characters)\b/gi))
    extra = Math.max(extra, num(m[1]));
  return extra > 0 ? Math.min(CAST_COUNT_MAX, extra) : null;
}

function isNoop(eff, value, promptText) {
  const a = String(eff.text || "").trim();
  const b = String(eff.prompt || "").trim();
  const v = String(value || "").trim();
  const p = String(promptText || "").trim();
  if (!v && !p) return false;
  const sameText = !v || v === a;
  const samePrompt = !p || p === b;
  return sameText && samePrompt;
}

function ensureCast(project, mode) {
  const raw = Number(project && project.cast ? project.cast.count : 1);
  const count = Number.isFinite(raw) ? Math.min(CAST_COUNT_MAX, Math.max(1, Math.round(raw))) : 1;
  project.cast = { mode, count };
}

export function applyActions(project, changes, source = "main-ai", opts = {}) {
  const inferred = inferTargets(opts.userText);
  const scope = opts.force
    ? { layers: null, resetAll: true, defaults: true, any: false, castMode: inferred.castMode, castCount: inferred.castCount }
    : inferred;
  const before = buildImagePrompt(project);
  const applied = [];
  const blocked = [];
  const pending = [];
  const skipped = [];
  let defaultsTouched = false;
  const refMentioned = /参考图|基准图|reference image|reference url|这张图|换成这张/i.test(String(opts.userText || ""));

  const appearanceBlock = (path, value, promptText) => {
    // 「第二人物」描述的是另一个人，不属于主角的形象锁定范围。
    if (path.endsWith("currentPartner")) return null;
    if (!project.characterCore.locked) return null;
    const hard = appearanceViolations(`${value} ${promptText}`).filter((v) => v.severity === "fail");
    if (!hard.length) return null;
    return {
      path,
      reason: `违反人物形象锁定：${hard.map((v) => v.label).join("、")}。${hard[0].message}人物形象由角色基准锁定，禁止随意改动。`,
      rule: hard[0].id,
    };
  };

  for (const ch of Array.isArray(changes) ? changes : []) {
    const v = validatePath(ch.path);
    if (!v.ok) {
      blocked.push({ path: ch.path || "?", reason: v.reason });
      continue;
    }
    const path = v.path;
    const value = ch.value == null ? "" : String(ch.value).trim();
    const promptText = ch.prompt == null ? "" : String(ch.prompt).trim();
    const reason = ch.reason || "";
    let from = null;
    let to = null;

    if (path.startsWith("overrides.")) {
      const key = path.slice("overrides.".length);
      if (!OVERRIDE_META[key]) {
        blocked.push({ path, reason: "未知的 override 字段" });
        continue;
      }
      const eff = effectiveOf(project, key);
      if ((!value && !promptText && !eff.isOverride) || isNoop(eff, value, promptText)) {
        skipped.push({ path, to: eff.text, reason: reason || "与当前取值相同" });
        continue;
      }
      const violation = appearanceBlock(path, value, promptText);
      if (violation) {
        blocked.push(violation);
        continue;
      }
      if (!scope.resetAll && scope.layers && !scope.layers.has(key)) {
        pending.push({
          path,
          value,
          prompt: promptText,
          reason,
          from: eff.text,
          why: `本次请求没有点名「${OVERRIDE_META[key].cn}」，已暂缓写入（点确认才会生效）`,
        });
        continue;
      }
      from = eff.text;
      if (!value && !promptText) {
        clearOverride(project, key);
        to = effectiveOf(project, key).text;
      } else {
        setOverride(project, key, { value, prompt: promptText }, reason);
        to = value;
      }
    } else if (path.startsWith("defaults.")) {
      const cur = getPath(project, path) || {};
      const eff = { text: cur.text || "", prompt: cur.prompt || "" };
      if (isNoop(eff, value, promptText)) {
        skipped.push({ path, to: eff.text, reason: reason || "与默认层当前取值相同" });
        continue;
      }
      if (!value && !promptText) {
        blocked.push({ path, reason: "不允许把默认层清空" });
        continue;
      }
      const violation = appearanceBlock(path, value, promptText);
      if (violation) {
        blocked.push(violation);
        continue;
      }
      if (!scope.defaults) {
        pending.push({
          path,
          value,
          prompt: promptText,
          reason,
          from: eff.text,
          why: "修改默认层必须由你明确确认（用户原文未出现「更换默认常服 / 设为默认」）",
        });
        continue;
      }
      from = eff.text;
      setPath(project, path, { ...cur, text: value || cur.text, prompt: promptText || cur.prompt });
      to = value;
      defaultsTouched = true;
    } else if (path === "cast.mode") {
      const want = /multi|多人|双人|两个|2/i.test(value) ? "multi" : "single";
      const cur = castModeOf(project);
      if (cur === want) {
        skipped.push({ path, to: want, reason: "人物数量模式未变化" });
        continue;
      }
      if (!opts.force && scope.castMode !== want) {
        pending.push({
          path,
          value: want,
          prompt: "",
          reason,
          from: cur,
          why: "本次请求没有点名「单人 / 多人」，已暂缓切换人物数量模式（点确认才会生效）",
        });
        continue;
      }
      from = cur;
      ensureCast(project, want);
      to = want;
    } else if (path === "cast.count") {
      const parsed = Number(String(value).replace(/[^\d.]/g, ""));
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > CAST_COUNT_MAX) {
        blocked.push({ path, reason: `同框人数必须是 1..${CAST_COUNT_MAX} 的整数（除主角之外的人数）` });
        continue;
      }
      const want = Math.round(parsed);
      const cur = castCountOf(project) || 1;
      if (cur === want) {
        skipped.push({ path, to: String(want), reason: "同框人数未变化" });
        continue;
      }
      if (!opts.force && scope.castCount !== want) {
        pending.push({
          path,
          value: String(want),
          prompt: "",
          reason,
          from: String(cur),
          why: "本次请求没有点名人数，已暂缓修改同框人数（点确认才会生效）",
        });
        continue;
      }
      from = String(cur);
      ensureCast(project, castModeOf(project));
      project.cast.count = want;
      to = String(want);
    } else if (path === "task") {
      if (project.task === value) {
        skipped.push({ path, to: value, reason: "task 未变化" });
        continue;
      }
      from = project.task;
      project.task = value;
      to = value;
    } else if (path === "referenceImage.url") {
      if (project.referenceImage.url === value) {
        skipped.push({ path, to: value, reason: "参考图未变化" });
        continue;
      }
      if (!refMentioned && !opts.force) {
        pending.push({
          path,
          value,
          prompt: "",
          reason,
          from: project.referenceImage.url,
          why: "更换参考基准图会改变人物形象的判定基准，必须由你明确要求（本次请求未提到参考图）",
        });
        continue;
      }
      from = project.referenceImage.url;
      project.referenceImage.url = value;
      to = value;
    }
    applied.push({ path, from, to, prompt: promptText, reason });
  }

  // 「第二人物」一旦被写入，就必须切到多人模式，否则它永远不会出现在画面里。
  const partnerApplied = applied.some((a) => a.path === "overrides.currentPartner" && String(a.to || "").trim());
  if (partnerApplied && castModeOf(project) === "single" && (opts.force || scope.castMode === "multi")) {
    ensureCast(project, "multi");
    applied.push({
      path: "cast.mode",
      from: "single",
      to: "multi",
      prompt: "",
      reason: "已写入「第二人物」，自动切换为多人模式",
    });
  }
  // 同框人数跟着「第二人物」文本走：文本写「两名成年男性 / 三个人」时，
  // 如果 cast.count 还是旧值，提示词开头的人数和正文就会打架（实测会导致人物糊在一起）。
  if (partnerApplied && castModeOf(project) === "multi") {
    const spoken = spokenCastCount(project);
    if (spoken > 1) {
      const want = Math.min(CAST_COUNT_MAX, spoken - 1);
      const cur = castCountOf(project) || 1;
      if (cur !== want) {
        project.cast = { mode: "multi", count: want };
        applied.push({
          path: "cast.count",
          from: String(cur),
          to: String(want),
          prompt: "",
          reason: `按「第二人物 / 姿势」文本里写的人数（共 ${spoken} 人）自动同步同框人数，避免提示词自相矛盾`,
        });
      }
    }
  }

  const after = buildImagePrompt(project);
  const layers = diffLayers(layerSnapshot(before), after).map((d) => d.id);
  if (applied.length) {
    pushChange(project, {
      kind: source,
      path: applied.map((a) => a.path).join(", "),
      note: applied.map((a) => a.reason || a.to).join(" / ").slice(0, 240),
      layersChanged: layers,
    });
  }
  for (const b of blocked) {
    pushChange(project, { kind: "blocked", path: b.path, note: b.reason, layersChanged: [] });
  }
  for (const p of pending) {
    pushChange(project, { kind: "pending", path: p.path, note: p.why, layersChanged: [] });
  }
  if (skipped.length) {
    pushChange(project, {
      kind: "noop",
      path: skipped.map((s) => s.path).join(", "),
      note: `忽略 ${skipped.length} 项与当前状态相同的改动（AI 复述了未被修改的层）`,
      layersChanged: [],
    });
  }
  return { applied, blocked, pending, skipped, layersChanged: layers, defaultsTouched, built: after, scope };
}

export async function runMainTurn({ project, userText, onPartial, onStatus }) {
  const log = chatLog(project, "main");
  appendChat(project, "main", { role: "user", text: userText, kind: "msg" });
  if (onStatus) onStatus("主 AI 正在读取角色卡与当前 Overrides…");

  const instruction = buildMainInstruction({ project, log, userText });
  const full = await callModel({ instruction, onPartial });
  const reply = stripActionBlock(full);
  let action = extractJsonBlock(full, "action");
  let repaired = false;

  if (!action) {
    if (onStatus) onStatus("结构化输出解析失败，正在让主 AI 重新生成 JSON…");
    const retryFull = await callModel({ instruction: buildRetryInstruction(project, reply || full) });
    action = extractJsonBlock(retryFull, null) || extractJsonBlock(retryFull, "action");
    repaired = !!action;
  }

  appendChat(project, "main", { role: "ai", text: reply || "(无文本回复)", kind: "msg" });

  let result = { applied: [], blocked: [], pending: [], skipped: [], layersChanged: [] };
  if (action) {
    updateMemory(project, action.memory);
    if (action.task && String(action.task).trim()) project.task = String(action.task).trim();
    const touchesDefaults = (Array.isArray(action.changes) ? action.changes : []).some((c) =>
      String((c && c.path) || "").startsWith("defaults.")
    );
    if (touchesDefaults) {
      try {
        await Store.snapshot(project, "auto · 修改默认层之前");
      } catch (e) {}
    }
    result = applyActions(project, action.changes, "main-ai", { userText });
  } else {
    pushChange(project, { kind: "error", path: "-", note: "主 AI 未返回可解析的 <action> 区块，本次未修改任何状态。", layersChanged: [] });
  }

  return { reply, action, repaired, ...result, instruction };
}

export async function renderCharacter(project, { onStatus } = {}) {
  const built = buildImagePrompt(project);
  const opts = {
    prompt: built.prompt,
    negativePrompt: built.negativePrompt,
    resolution: project.render.resolution || "512x768",
  };
  if (project.render.lockSeed && Number.isFinite(project.render.seed)) opts.seed = project.render.seed;
  if (onStatus) onStatus("正在渲染角色图（受当前提示词层与种子控制）…");
  const res = await root.generateImage(opts);
  const dataUrl = await normalizeImageResult(res);
  project.render.lastPrompt = built.prompt;
  project.render.lastNegative = built.negativePrompt;
  project.render.lastDataUrl = dataUrl;
  project.render.lastLayers = layerSnapshot(built);
  project.render.updatedAt = Date.now();
  pushChange(project, {
    kind: "render",
    path: "render",
    note: `渲染角色图（种子 ${project.render.lockSeed ? project.render.seed : "随机"}；层：${built.layers.map((l) => l.label).join(" → ")}）`,
    layersChanged: [],
  });
  return { dataUrl, built };
}


// 将 Perchance 生图插件可能返回的多种结果统一转换为可直接放进 <img src> 的地址。
// 某些运行环境返回 dataUrl / url，有些版本可能返回包含 <img> 的 HTML 字符串。
// 如果最终拿到的只是普通文字，则明确报错，而不是把文字误当成图片地址。
async function normalizeImageResult(res) {
  // Perchance 的 text-to-image-plugin 不同版本/环境可能返回：
  // data URL、URL、<img> HTML、HTMLImageElement、HTMLCanvasElement，
  // 或带 data 数组的结果对象。统一转换成 <img src> 可以直接使用的地址。
  if (typeof res === "string") {
    const text = res.trim();
    if (/^(data:image\/|https?:\/\/)/i.test(text)) return text;
    const fromHtml = extractImageSrc(text);
    if (fromHtml) return fromHtml;
  }

  if (res && typeof res === "object") {
    const direct = res.dataUrl || res.dataURL || res.url || res.imageUrl || res.src;
    if (typeof direct === "string" && /^(data:image\/|https?:\/\/)/i.test(direct.trim())) return direct.trim();

    // 某些版本把图片放在 data[0].url / data[0].dataUrl。
    if (Array.isArray(res.data)) {
      for (const item of res.data) {
        const u = item && (item.dataUrl || item.dataURL || item.url || item.imageUrl || item.src);
        if (typeof u === "string" && /^(data:image\/|https?:\/\/)/i.test(u.trim())) return u.trim();
      }
    }

    if (res.html && typeof res.html === "string") {
      const fromHtml = extractImageSrc(res.html);
      if (fromHtml) return fromHtml;
    }

    // 官方插件返回 canvas 的情况下，直接转成 data URL。
    const canvas = res.canvas || (typeof HTMLCanvasElement !== "undefined" && res instanceof HTMLCanvasElement ? res : null);
    if (canvas && typeof canvas.toDataURL === "function") {
      return canvas.toDataURL("image/png");
    }

    // 也兼容返回 HTMLImageElement / 其他带 src 的图片对象。
    const image = res.image || (typeof HTMLImageElement !== "undefined" && res instanceof HTMLImageElement ? res : null);
    if (image) {
      if (typeof image === "string" && /^(data:image\/|https?:\/\/)/i.test(image.trim())) return image.trim();
      if (typeof image.src === "string" && /^(data:image\/|https?:\/\/)/i.test(image.src.trim())) return image.src.trim();
    }
  }

  throw new Error("生图服务已经返回结果，但当前版本的结果格式无法转换成图片。请重新加载页面后再试；如果仍然出现此提示，请检查 text-to-image 插件是否正常加载。");
}

function extractImageSrc(html) {
  if (!html || typeof html !== "string") return "";
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i);
  return m && /^(data:image\/|https?:\/\/)/i.test(m[1].trim()) ? m[1].trim() : "";
}

export async function maybeCompact(project, which, buildInstruction) {
  const { countTokens, idealMaxContextTokens } = meta();
  const arr = project.chats[which] || [];
  if (arr.length <= 10) return false;
  const instruction = buildInstruction();
  if (countTokens(instruction) < idealMaxContextTokens * 0.85) return false;
  const n = Math.max(2, Math.floor(arr.length / 2));
  const boundary = arr[n - 1].text.slice(-24);
  const log = chatLog(project, which);
  const summarizeTask = `把对话日志中最早的 ${n} 条消息压缩成简短摘要，最后一条以「${boundary}」结尾。保留：角色决策、被修改的字段、被拒绝的修改、未完成任务。只输出摘要正文，不要输出 <action> 或 JSON。`;
  const instruction2 = buildMainInstruction({
    project,
    log,
    userText: "（压缩历史）",
    taskText: summarizeTask,
  });
  try {
    const res = await root.generateText({ instruction: instruction2 });
    const summary = String(res && res.text != null ? res.text : res).trim();
    if (summary) {
      const prev = project.chats[which + "Summary"];
      project.chats[which + "Summary"] = prev ? prev + "\n" + summary : summary;
      project.chats[which] = arr.slice(n);
    }
  } catch (e) {}
  return true;
}
