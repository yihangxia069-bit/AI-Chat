import * as S from "./state.js";
import * as P from "./prompt.js";
import * as C from "./checks.js";
import * as Store from "./store.js";
import * as AI from "./ai.js";

let project = S.createDefaultProject();
let loadedFromSave = false;
let busy = false;
let lastBuilt = null;
let lastChecks = null;
let lastUserText = "";
let lastMainInstruction = "";
let autosaveTimer = null;
let storageSuspect = false;
let favorites = [];
let activeFavKey = null;
let progressTimer = null;
let candidates = [];
let candidatesBuilt = null;

const $ = (id) => document.getElementById(id);

function el(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v;
    else if (k === "text") n.textContent = v;
    else if (k === "html") n.innerHTML = v;
    else if (k.startsWith("on")) n.addEventListener(k.slice(2), v);
    else if (v === true) n.setAttribute(k, "");
    else n.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null && c !== false) n.append(c);
  return n;
}

function statusline(elm, text, cls = "") {
  elm.textContent = text || "";
  elm.className = "status-line" + (cls ? " " + cls : "");
}

function errMsg(e) {
  return e && e.message ? e.message : String(e);
}

function setBusy(on, text) {
  busy = on;
  $("mainSendBtn").disabled = on;
  $("renderBtn").disabled = on;
  $("favThisBtn").disabled = on;
  if (on) statusline($("mainStatus"), text || "处理中…", "busy");
}

function scheduleAutosave() {
  if (storageSuspect) return;
  clearTimeout(autosaveTimer);
  autosaveTimer = setTimeout(async () => {
    try {
      await Store.saveProject(project, "autosave");
      renderStatus();
    } catch (e) {}
  }, 1200);
}

function touch() {
  lastBuilt = P.buildImagePrompt(project);
  renderAll();
  scheduleAutosave();
}

/* =========================================================
   Render
   ========================================================= */

function renderAll() {
  lastBuilt = P.buildImagePrompt(project);
  $("projCode").textContent = project.code;
  $("charName").textContent = project.name;
  $("taskInput").value = project.task || "";
  renderCore();
  renderFields();
  renderCast();
  renderMemory();
  renderChangeLog();
  renderRef();
  renderResult();
  renderHealth();
  renderLayers();
  renderRules();
  renderFavorites();
  renderChat("main");
  renderStatus();
}

function renderCore() {
  const ctn = $("coreFields");
  ctn.textContent = "";
  const locked = project.characterCore.locked;
  const wrap = $("coreWrap");
  const state = locked ? "locked" : "open";
  if (wrap.dataset.lockState !== state) {
    wrap.dataset.lockState = state;
    wrap.open = !locked;
  }
  $("coreCountBadge").textContent = project.characterCore.groups.length + " 组";
  const badge = $("coreLockBadge");
  badge.textContent = locked ? "🔒 已锁定" : "🔓 已解锁";
  badge.className = "badge locked" + (locked ? "" : " open");
  $("coreLockBtn").textContent = locked ? "解锁" : "重新锁定";
  for (const g of project.characterCore.groups) {
    if (locked) {
      ctn.append(
        el("div", { class: "field" }, [
          el("div", { class: "field-head" }, [
            el("span", { class: "name", text: g.label }),
            el("span", { class: "spacer" }),
            el("span", { class: "badge core", text: "基准 · 已锁定" }),
          ]),
          el("div", { class: "core-line", text: g.text }),
          el("div", { class: "sub-lbl", text: "提示词片段 · " + g.prompt }),
        ])
      );
      continue;
    }
    const ta = el("textarea", { class: "input", rows: 2 });
    ta.value = g.text;
    const pa = el("textarea", { class: "input", rows: 2, readonly: locked });
    pa.value = g.prompt;
    const commit = () => {
      if (g.text === ta.value && g.prompt === pa.value) return;
      const note = `${g.label}: 内容被编辑`;
      g.text = ta.value;
      g.prompt = pa.value;
      S.pushChange(project, { kind: "core-edit", path: "characterCore." + g.id, note, layersChanged: ["core"] });
      touch(note);
    };
    if (!locked) {
      ta.addEventListener("blur", commit);
      pa.addEventListener("blur", commit);
    }
    ctn.append(
      el("div", { class: "field" + (locked ? "" : " is-override") }, [
        el("div", { class: "field-head" }, [
          el("span", { class: "name", text: g.label }),
          el("span", { class: "spacer" }),
          el("span", { class: "badge core", text: locked ? "基准 · 已锁定" : "基准 · 可编辑" }),
        ]),
        el("div", { class: "sub-lbl", text: "显示描述" }),
        ta,
        el("div", { class: "sub-lbl", text: "提示词片段（英文，用于图像生成）" }),
        pa,
      ])
    );
  }
}

function fieldRow(key) {
  const meta = S.OVERRIDE_META[key];
  const e = S.effectiveOf(project, key);
  const def = S.sourceDefault(project, key);
  const ta = el("textarea", { class: "input", rows: 2 });
  ta.value = e.text || "";
  const pa = el("textarea", { class: "input", rows: 2 });
  pa.value = e.prompt || "";
  const rv = el("span", { class: "rv", text: e.updatedAt ? "更新 " + S.fmtTime(e.updatedAt) : "" });

  const srcBadge =
    e.source === "override"
      ? el("span", { class: "badge ov", text: "覆盖" })
      : e.source === "core"
      ? el("span", { class: "badge core", text: "基准" })
      : el("span", { class: "badge def", text: "默认" });

  const saveAsOverride = () => {
    S.setOverride(project, key, { value: ta.value, prompt: pa.value }, "手动编辑");
    S.pushChange(project, {
      kind: "manual",
      path: "overrides." + key,
      note: `手动设置覆盖：${(ta.value || "").slice(0, 80)}`,
      layersChanged: P.diffLayers(P.layerSnapshot(lastBuilt), P.buildImagePrompt(project)).map((d) => d.id),
    });
    touch();
  };
  const saveAsDefault = () => {
    const dk = meta.defaultKey;
    const cur = project.defaults[dk] || {};
    project.defaults[dk] = { ...cur, text: ta.value, prompt: pa.value };
    S.pushChange(project, {
      kind: "default-edit",
      path: "defaults." + dk,
      note: `更新默认值（${meta.cn}）`,
      layersChanged: P.diffLayers(P.layerSnapshot(lastBuilt), P.buildImagePrompt(project)).map((d) => d.id),
    });
    touch();
  };
  const resetOverride = () => {
    if (S.effectiveOf(project, key).source !== "override") return;
    S.clearOverride(project, key);
    S.pushChange(project, {
      kind: "reset",
      path: "overrides." + key,
      note: `恢复默认（${meta.cn}）`,
      layersChanged: P.diffLayers(P.layerSnapshot(lastBuilt), P.buildImagePrompt(project)).map((d) => d.id),
    });
    touch();
  };

  const defLine =
    e.source === "override"
      ? el("div", { class: "sub-lbl", text: "默认 = " + (def.text || "（空）").slice(0, 120) })
      : el("div", {
          class: "sub-lbl",
          text:
            key === "currentHairstyle"
              ? "默认由角色基准定义（发型覆盖只改变造型编排，不得改动发色、发长与刘海）"
              : "此值即为默认层",
        });

  return el("div", { class: "field" + (e.isOverride ? " is-override" : "") }, [
    el("div", { class: "field-head" }, [
      el("span", { class: "name", text: meta.label }),
      el("span", { class: "cn", text: meta.cn }),
      el("span", { class: "spacer" }),
      srcBadge,
    ]),
    el("div", { class: "sub-lbl", text: "显示描述" }),
    ta,
    el("div", { class: "sub-lbl", text: "提示词片段" }),
    pa,
    defLine,
    el("div", { class: "field-actions" }, [
      el("button", { class: "mini", text: "保存为覆盖", onclick: saveAsOverride }),
      el("button", { class: "mini", text: "保存到默认", onclick: saveAsDefault }),
      el("button", { class: "mini", text: "恢复默认", onclick: resetOverride }),
      rv,
    ]),
  ]);
}

function renderFields() {
  const w = $("wardrobeFields");
  w.textContent = "";
  for (const k of ["currentOutfit", "currentOuterOutfit", "currentAccessories"]) w.append(fieldRow(k));
  const l = $("lookFields");
  l.textContent = "";
  for (const k of ["currentHairstyle", "currentPose", "currentExpression", "currentBackground"]) l.append(fieldRow(k));
  const pf = $("partnerFields");
  pf.textContent = "";
  pf.append(fieldRow("currentPartner"));
}

function renderCast() {
  const mode = S.castModeOf(project);
  const seg = $("castSeg");
  if (seg)
    for (const b of seg.querySelectorAll("button[data-mode]")) {
      const on = b.dataset.mode === mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  const badge = $("castBadge");
  if (badge) {
    badge.textContent = mode === "multi" ? "多人 · 参与渲染" : "单人 · 不渲染";
    badge.className = "badge " + (mode === "multi" ? "ov" : "def");
  }
  const hint = $("castHint");
  if (hint) {
    const p = S.effectiveOf(project, "currentPartner");
    const extra = S.castCountOf(project);
    hint.textContent =
      mode === "multi"
        ? `主角 + ${extra} 位其他人物（第二人物层 · ${p.source === "override" ? "覆盖" : "默认"}）同时出镜；负面提示词里限制多人的用词已自动移除。${
            extra + 1 >= 3 ? "3 人以上同框时模型不稳定，建议用「候选 ×4」连拍挑一张。" : ""
          }`
        : "画面里只有主角一个人（第二人物层不参与组装）。";
  }
  const countInput = $("castCount");
  if (countInput) {
    countInput.value = String(S.castCountOf(project) || 1);
    countInput.disabled = mode !== "multi";
  }
  const countHint = $("castCountHint");
  if (countHint) {
    const extra = S.castCountOf(project);
    const total = extra + 1;
    countHint.textContent =
      mode === "multi"
        ? `同框共 ${total} 人：主角 + ${extra} 位其他人（提示词开头会写成 ${total} people）。写第二人物文字时别写别的人数。${
            total >= 3 ? "注意：3 人以上同框很不稳定，建议先试 2 人。" : ""
          }`
        : "切到「多人」后这里才能改（1..5）。";
  }
}

function renderMemory() {
  const ctn = $("memoryFields");
  ctn.textContent = "";
  $("revBadge").textContent = "版本 " + project.meta.revision;
  for (const f of S.MEMORY_FIELDS) {
    const ta = el("textarea", { class: "input", rows: 2 });
    ta.value = project.memory[f.key] || "";
    ta.addEventListener("blur", () => {
      if ((project.memory[f.key] || "") === ta.value) return;
      project.memory[f.key] = ta.value;
      S.pushChange(project, { kind: "memory", path: "memory." + f.key, note: "手动更新记忆字段", layersChanged: [] });
      touch();
    });
    ctn.append(
      el("div", { class: "field" }, [
        el("div", { class: "field-head" }, [
          el("span", { class: "name", text: f.label }),
          el("span", { class: "cn", text: f.cn }),
        ]),
        ta,
      ])
    );
  }
}

function renderChangeLog() {
  const ctn = $("changeLogEl");
  ctn.textContent = "";
  const rows = project.memory.changeLog.slice(-40).reverse();
  if (!rows.length) ctn.append(el("div", { class: "row", text: "（无）" }));
  for (const c of rows) {
    ctn.append(
      el("div", { class: "row " + (c.kind || "") }, [
        el("span", { class: "t", text: S.fmtTime(c.ts) }),
        el("span", { class: "k", text: S.kindLabel(c.kind) }),
        el("span", { class: "n", title: c.path || "", text: `${c.path ? S.pathLabel(c.path) : ""} ${c.note || ""}`.trim() }),
      ])
    );
  }
}

function renderRules() {
  const ctn = $("rulesList");
  ctn.textContent = "";
  for (const s of S.RULE_SLOTS) {
    const ta = el("textarea", { class: "input", rows: 2 });
    ta.value = project.rules[s.key] || "";
    ta.addEventListener("blur", () => {
      if ((project.rules[s.key] || "") === ta.value) return;
      project.rules[s.key] = ta.value;
      S.pushChange(project, { kind: "rule-edit", path: "rules." + s.key, note: "手动修改规则", layersChanged: [] });
      touch();
    });
    ctn.append(
      el("div", { class: "field" }, [
        el("div", { class: "field-head" }, [
          el("span", { class: "name", text: s.label }),
          el("span", { class: "spacer" }),
          el("span", { class: "badge def", title: "规则槽：" + s.key, text: "已注入" }),
        ]),
        ta,
      ])
    );
  }
}

function renderRef() {
  $("refImg").src = project.referenceImage.url;
  $("refUrlInput").value = project.referenceImage.url;
}

function renderResult() {
  const img = $("renderImg");
  if (project.render.lastDataUrl) {
    img.src = project.render.lastDataUrl;
    img.hidden = false;
    $("renderPlaceholder").hidden = true;
  } else {
    img.hidden = true;
    $("renderPlaceholder").hidden = false;
  }
  $("renderStateBadge").textContent = project.render.updatedAt
    ? `${S.fmtTime(project.render.updatedAt)} · ${project.render.resolution}`
    : "未渲染";
  $("lockSeedChk").checked = !!project.render.lockSeed;
  $("seedInput").value = project.render.seed;
  $("resSelect").value = project.render.resolution;
  $("renderMeta").textContent = project.render.updatedAt
    ? `上次渲染 ${S.fmtTime(project.render.updatedAt)} · 种子 ${project.render.lockSeed ? project.render.seed : "随机"} · ${project.render.resolution} · ${S.castModeOf(project) === "multi" ? "多人" : "单人"} · 提示词 ${(project.render.lastPrompt || "").length} 字符 · 层 ${(lastBuilt ? lastBuilt.layers.map((l) => l.label) : []).join(" → ")}`
    : "未渲染";
  renderFavState();
}

function favoriteOfCurrent() {
  const url = project.render.lastDataUrl;
  if (!url) return null;
  return favorites.find((f) => f.dataUrl === url) || null;
}

function renderFavState() {
  const elm = $("favStateEl");
  if (!elm) return;
  const hit = favoriteOfCurrent();
  const btn = $("favThisBtn");
  if (hit) {
    elm.textContent = `当前结果已在收藏中（${S.fmtTime(hit.ts)}），点缩略图可切回。`;
    elm.className = "note fav-state on";
    btn.textContent = "★ 已收藏";
    btn.classList.add("on");
  } else {
    elm.textContent = project.render.lastDataUrl ? "当前结果尚未收藏。" : "";
    elm.className = "note fav-state";
    btn.textContent = "★ 收藏";
    btn.classList.remove("on");
  }
}

function renderFavorites() {
  const ctn = $("favGrid");
  ctn.textContent = "";
  $("favCountBadge").textContent = favorites.length + " 张";
  if (!favorites.length) {
    ctn.append(el("div", { class: "empty", text: "（还没有收藏。渲染后在「结果」里点「★ 收藏」即可保存一张）" }));
    renderFavState();
    return;
  }
  for (const f of favorites) {
    const btn = el("button", {
      class: "fav" + (f.key === activeFavKey ? " active" : ""),
      title: `${S.fmtTime(f.ts)} · 种子 ${f.seed == null ? "随机" : f.seed} · ${f.resolution || "—"}`,
      onclick: () => selectFavorite(f),
    });
    btn.append(
      el("img", { src: f.dataUrl, alt: S.fmtTime(f.ts) + " 的收藏结果" }),
      el("span", { class: "fav-t", text: S.fmtTime(f.ts) })
    );
    btn.append(
      el("span", {
        class: "fav-x",
        text: "✕",
        onclick: (ev) => {
          ev.stopPropagation();
          removeFavorite(f);
        },
      })
    );
    ctn.append(btn);
  }
  renderFavState();
}

function renderStatus() {
  const n = S.countOverrides(project);
  $("sbCode").textContent = project.code;
  $("sbOverrides").textContent = n;
  $("sbRev").textContent = project.meta.revision;
  $("sbSaved").textContent = project.meta.lastSavedAt ? S.fmtTime(project.meta.lastSavedAt) : "未保存";
  const tokens = P.estimateTokens(lastMainInstruction || P.buildMainInstruction({ project, log: AI.chatLog(project, "main"), userText: lastUserText }));
  const ideal = AI.meta().idealMaxContextTokens || 6000;
  $("sbTokens").textContent = `~${tokens}/${ideal}`;
  $("sbRender").textContent = project.render.updatedAt ? `种子 ${project.render.lockSeed ? project.render.seed : "随机"}` : "—";
  const last = project.memory.changeLog[project.memory.changeLog.length - 1];
  $("sbLastAction").textContent = last ? `${S.kindLabel(last.kind)} · ${(last.note || "").slice(0, 60)}` : "—";
  const state = loadedFromSave ? "项目已加载" : "项目已加载 · 出厂默认";
  $("loadState").textContent = state;
  $("sbLoad").textContent = state;
  $("loadDot").className = "dot";
  $("sbDot").className = "dot";
}

function renderHealth() {
  lastChecks = C.runChecks(project, lastBuilt);
  const ctn = $("checksList");
  ctn.textContent = "";
  const lbl = C.healthLabel(lastChecks.score);
  const hb = $("healthBadge");
  hb.textContent = `体检 ${lastChecks.score} · ${lbl.text}`;
  hb.className = "health-badge " + lbl.cls;
  $("healthScore").textContent = `${lastChecks.score} / 100 · ${lastChecks.fails} 项失败 · ${lastChecks.warns} 项警告`;
  $("healthScore").className = "badge " + (lbl.cls === "ok" ? "" : lbl.cls === "warn" ? "locked" : "locked open");
  const stText = { pass: "通过", warn: "警告", fail: "失败" };
  for (const c of lastChecks.list) {
    const row = el("div", { class: "check " + c.status }, [
      el("span", { class: "st", text: stText[c.status] || c.status }),
      el("span", {}, [
        el("span", { class: "lbl2", text: c.label + "：" }),
        el("span", { class: "det", text: c.detail }),
      ]),
    ]);
    const patchKey = c.patch && c.patch.kind === "state" && c.patch.path && c.patch.path.startsWith("overrides.")
      ? c.patch.path.split(".").pop()
      : null;
    if (patchKey && S.OVERRIDE_META[patchKey]) {
      row.append(
        el("button", {
          class: "mini fixlink",
          text: "一键修复",
          onclick: () => {
            S.clearOverride(project, patchKey);
            S.pushChange(project, { kind: "reset", path: c.patch.path, note: "体检一键修复：" + c.label, layersChanged: [S.OVERRIDE_META[patchKey].layer] });
            touch();
          },
        })
      );
    }
    ctn.append(row);
  }
}

function renderLayers() {
  const b = lastBuilt;
  $("layerCountBadge").textContent = b.layers.length + " 层";
  const ctn = $("layerView");
  ctn.textContent = "";
  const srcText = { override: "覆盖", core: "基准", default: "默认" };
  for (const l of b.layers) {
    ctn.append(
      el("div", { class: "layer " + (l.id === "core" ? "core" : "") + (l.changedSinceRender ? " changed" : "") + (l.skipped ? " skipped" : "") }, [
        el("div", { class: "lv-head" }, [
          el("span", { class: "lv-id", title: "层 id：" + l.id, text: l.label }),
          el("span", { class: "spacer" }),
          el("span", {
            class: "badge " + (l.source === "override" ? "ov" : l.source === "core" ? "core" : "def"),
            text: srcText[l.source] || l.source,
          }),
          l.skipped ? el("span", { class: "badge skipped", title: l.skipReason || "", text: l.skipLabel || "未写入提示词" }) : null,
          l.changedSinceRender ? el("span", { class: "badge changed", text: "已变化" }) : null,
        ]),
        el("div", { class: "lv-txt", text: l.text || "（空）" }),
      ])
    );
  }
  $("promptPre").textContent = b.prompt;
  $("negPre").textContent = b.negativePrompt;
}

function msgNode(m) {
  if (m.kind === "action") {
    const a = m.data || {};
    const nApplied = (a.applied || []).length;
    const nPending = (a.pending || []).length;
    const head = el("div", { class: "ac-head" }, [
      el("span", {
        class: nApplied ? "ok" : nPending ? "warn" : "blocked",
        text: nApplied
          ? `✔ 已应用 ${nApplied} 项修改`
          : nPending
          ? `⏸ 未修改状态 · ${nPending} 项待确认`
          : "⚠ 未修改状态",
      }),
      el("span", { class: "cn", text: S.fmtTime(m.ts) }),
    ]);
    const rows = [];
    for (const ap of a.applied || []) {
      rows.push(
        el("div", { class: "diff" }, [
          el("b", { title: ap.path, text: S.pathLabel(ap.path) + " " }),
          el("span", { class: "val", text: `\n${(ap.to || "（恢复默认）").slice(0, 220)}` }),
          ap.reason ? el("div", { class: "cn", text: "原因：" + ap.reason }) : null,
          ap.prompt ? el("div", { class: "cn", text: "提示词片段：" + ap.prompt.slice(0, 200) }) : null,
        ])
      );
    }
    for (const p of a.pending || []) {
      const row = el("div", { class: "diff" }, [
        el("b", { title: p.path, text: "⏸ 待确认 " + S.pathLabel(p.path) + " " }),
        el("span", { class: "val", text: `\n${(p.value || "（恢复默认）").slice(0, 220)}` }),
        el("div", { class: "cn", text: p.why || "该改动超出本次请求范围" }),
        p.reason ? el("div", { class: "cn", text: "AI 理由：" + p.reason }) : null,
      ]);
      row.append(
        el("div", { class: "field-actions" }, [
          el("button", {
            class: "mini",
            text: "确认应用",
            onclick: () => {
              const r = AI.applyActions(
                project,
                [{ path: p.path, value: p.value, prompt: p.prompt, reason: p.reason }],
                "user-approved",
                { force: true }
              );
              a.pending = (a.pending || []).filter((x) => x !== p);
              a.applied = [...(a.applied || []), ...r.applied];
              a.layersChanged = [...new Set([...(a.layersChanged || []), ...r.layersChanged])];
              statusline($("mainStatus"), `已按你的确认应用：${p.path}`);
              touch();
            },
          }),
          el("button", {
            class: "mini",
            text: "忽略",
            onclick: () => {
              a.pending = (a.pending || []).filter((x) => x !== p);
              S.pushChange(project, { kind: "rejected", path: p.path, note: "用户拒绝了待确认的改动", layersChanged: [] });
              touch();
            },
          }),
          el("span", { class: "spacer" }),
        ])
      );
      rows.push(row);
    }
    for (const b of a.blocked || []) rows.push(el("div", { class: "diff", title: b.path, text: `✖ 已阻止 ${S.pathLabel(b.path)}：${b.reason}` }));
    const nSkipped = (a.skipped || []).length;
    if (nSkipped)
      rows.push(
        el("div", {
          class: "cn",
          text: `忽略 ${nSkipped} 项与当前状态相同的改动（${(a.skipped || []).map((s) => S.pathLabel(s.path)).join("、")}）——未修改的层只有被真正修改才会写入。`,
        })
      );
    if (a.layersChanged && a.layersChanged.length)
      rows.push(el("div", { class: "layers", text: "受影响层：" + a.layersChanged.map(S.layerLabel).join("、") }));
    const card = el("div", { class: "action-card" + (nPending ? " warn" : "") }, [head, ...rows]);
    if (a.layersChanged && a.layersChanged.length) {
      card.append(
        el("div", { class: "fix-actions" }, [
          el("button", { class: "mini", text: "渲染角色图验证", onclick: () => doRender() }),
          el("button", { class: "mini", text: "查看提示词层", onclick: () => { const d = $("advArea").querySelectorAll("details")[3]; if (d) d.open = true; renderLayers(); } }),
        ])
      );
    }
    return card;
  }
  if (m.kind === "note") return el("div", { class: "msg sys", text: m.text });
  return el("div", { class: "msg " + (m.role === "user" ? "user" : "ai") }, [
    el("span", { class: "who", text: (m.role === "user" ? "你" : "AI") + " · " + S.fmtTime(m.ts) }),
    el("span", { text: m.text }),
  ]);
}

function renderChat(which = "main") {
  const ctn = $("mainChat");
  ctn.textContent = "";
  const arr = project.chats[which] || [];
  if (!arr.length) {
    ctn.append(
      el("div", {
        class: "msg sys",
        text: "AI 已就绪。它每次回复前都会读取角色基准、默认常服、当前覆盖、项目记忆与当前任务，并且只会修改你明确要求的那一项；人物形象已锁定，任何改动形象的写法都会被直接拦截。",
      })
    );
  }
  for (const m of arr) ctn.append(msgNode(m));
  ctn.scrollTop = ctn.scrollHeight;
}

function appendLive(which, who) {
  const ctn = $("mainChat");
  const node = el("div", { class: "msg ai" }, [
    el("span", { class: "who", text: who }),
    el("span", { text: "…" }),
  ]);
  ctn.append(node);
  ctn.scrollTop = ctn.scrollHeight;
  return (t) => {
    node.lastChild.textContent = t || "…";
    ctn.scrollTop = ctn.scrollHeight;
  };
}

/* =========================================================
   Render progress
   ========================================================= */

function startRenderProgress() {
  const wrap = $("renderProgress");
  const fill = $("pbFill");
  const text = $("pbText");
  wrap.hidden = false;
  wrap.classList.remove("done", "fail");
  fill.style.width = "0%";
  const t0 = Date.now();
  const stages = [
    [0, "组装提示词层…"],
    [0.8, "提交给生成服务（首次使用可能需要预热）…"],
    [4, "正在生成图像…"],
    [12, "仍在生成…（高分辨率会更慢）"],
    [25, "仍在等待生成结果…"],
    [45, "等待时间较长，生成队列可能繁忙…"],
  ];
  let pct = 0;
  clearInterval(progressTimer);
  progressTimer = setInterval(() => {
    const sec = (Date.now() - t0) / 1000;
    let stage = stages[0][1];
    for (const [at, s] of stages) if (sec >= at) stage = s;
    const target = 92 * (1 - Math.exp(-sec / 14));
    if (target > pct) pct = target;
    fill.style.width = pct.toFixed(1) + "%";
    text.textContent = `${stage} ${sec.toFixed(0)}s`;
  }, 120);
  return (ok, label) => {
    clearInterval(progressTimer);
    progressTimer = null;
    wrap.classList.add(ok ? "done" : "fail");
    fill.style.width = "100%";
    text.textContent = label || (ok ? "完成" : "失败");
    if (ok) setTimeout(() => (wrap.hidden = true), 1200);
  };
}

function stopRenderProgress() {
  clearInterval(progressTimer);
  progressTimer = null;
  $("renderProgress").hidden = true;
}

/* =========================================================
   Actions
   ========================================================= */

async function sendMain(text) {
  if (busy) return;
  const t = (text || "").trim();
  if (!t) return;
  lastUserText = t;
  renderChat("main");
  const setLive = appendLive("main", "AI · 生成中");
  setBusy(true, "AI 正在读取角色卡与当前 Overrides…");
  $("mainInput").value = "";
  try {
    const res = await AI.runMainTurn({
      project,
      userText: t,
      onPartial: (visible) => setLive(visible),
      onStatus: (s) => statusline($("mainStatus"), s, "busy"),
    });
    if (res.action) {
      project.chats.main.push({
        ts: Date.now(),
        role: "ai",
        kind: "action",
        data: {
          applied: res.applied,
          blocked: res.blocked,
          pending: res.pending,
          skipped: res.skipped,
          layersChanged: res.layersChanged,
          repaired: res.repaired,
        },
      });
    } else {
      project.chats.main.push({
        ts: Date.now(),
        role: "ai",
        kind: "note",
        text: "AI 未返回可解析的结构化修改（<action>）。本次没有修改任何状态。可再发一次，或在「系统体检与提示词视图」里查看原因。",
      });
    }
    lastMainInstruction = res.instruction;
    const pend = (res.pending || []).length;
    const skip = (res.skipped || []).length;
    const parts = [];
    parts.push(res.applied.length ? `已应用 ${res.applied.length} 项修改` : "未修改状态");
    if (pend) parts.push(`待确认 ${pend} 项`);
    if (res.blocked.length) parts.push(`阻止 ${res.blocked.length} 项`);
    if (skip) parts.push(`忽略 ${skip} 项重复改动`);
    if (res.repaired) parts.push("结构化输出已重试修复");
    statusline($("mainStatus"), parts.join("，"));
    if (!res.applied.length && res.blocked.length && !pend) {
      statusline($("mainStatus"), `全部修改被拒绝：${res.blocked.map((b) => b.reason).join("；")}`);
    }
  } catch (e) {
    project.chats.main.push({ ts: Date.now(), role: "ai", kind: "note", text: "调用失败：" + errMsg(e) });
    statusline($("mainStatus"), "调用失败：" + errMsg(e));
  } finally {
    setBusy(false);
    touch();
    AI.maybeCompact(project, "main", () =>
      P.buildMainInstruction({ project, log: AI.chatLog(project, "main"), userText: lastUserText })
    );
  }
}

async function doRender() {
  if (busy) return;
  setBusy(true, "正在渲染角色图…");
  const done = startRenderProgress();
  try {
    const { built, dataUrl } = await AI.renderCharacter(project, {
      onStatus: (s) => statusline($("mainStatus"), s, "busy"),
    });
    done(true, "渲染完成");
    activeFavKey = null;
    await refreshFavorites();
    statusline($("mainStatus"), "渲染完成。满意的话点「★ 收藏」把它存进收藏。");
  } catch (e) {
    done(false, "渲染失败：" + errMsg(e));
    statusline($("mainStatus"), "渲染失败：" + errMsg(e));
  } finally {
    setBusy(false);
    touch();
  }
}

function renderCandidates() {
  const wrap = $("candidatesWrap");
  wrap.hidden = !candidates.length;
  const ctn = $("candidatesEl");
  ctn.textContent = "";
  candidates.forEach((url, i) => {
    const on = project.render.lastDataUrl === url;
    const pick = el("button", {
      class: "pick",
      text: on ? "当前基准" : "选用",
      onclick: () => useCandidate(i),
    });
    ctn.append(el("figure", { class: "cand" + (on ? " on" : "") }, [el("img", { src: url, alt: `候选 ${i + 1}` }), pick]));
  });
}

function useCandidate(i) {
  const url = candidates[i];
  const built = candidatesBuilt || P.buildImagePrompt(project);
  if (!url) return;
  project.render.lastDataUrl = url;
  project.render.lastPrompt = built.prompt;
  project.render.lastNegative = built.negativePrompt;
  project.render.lastLayers = P.layerSnapshot(built);
  project.render.updatedAt = Date.now();
  S.pushChange(project, {
    kind: "render",
    path: "render",
    note: `选用候选 ${i + 1}/${candidates.length}`,
    layersChanged: [],
  });
  activeFavKey = null;
  statusline($("mainStatus"), `已选用候选 ${i + 1} 作为当前结果。满意的话点「★ 收藏」。`);
  touch();
}

// 生成服务即使固定 seed 也不是确定性的（同一提示词、同一 seed 每次结果都不同），
// 所以多人 / 复杂构图出现「崩坏」时，最实际的解法是连拍几张再挑一张。
async function doCandidates(n = 4) {
  if (busy) return;
  n = Math.min(30, Math.max(1, Math.round(Number(n) || 4)));
  const built = P.buildImagePrompt(project);
  const opts = {
    prompt: built.prompt,
    negativePrompt: built.negativePrompt,
    resolution: project.render.resolution || "512x768",
  };
  if (project.render.lockSeed && Number.isFinite(project.render.seed)) opts.seed = project.render.seed;
  setBusy(true, "正在连拍候选…");
  const done = startRenderProgress();
  candidates = [];
  candidatesBuilt = built;
  try {
    for (let i = 0; i < n; i++) {
      statusline($("mainStatus"), `连拍候选 ${i + 1}/${n}…（每一张都需要十几秒）`, "busy");
      const res = await root.generateImage(opts);
      const url = res && res.dataUrl ? res.dataUrl : String(res);
      candidates.push(url);
      renderCandidates();
    }
    done(true, `候选完成（${candidates.length} 张）`);
    statusline($("mainStatus"), `已连拍 ${candidates.length} 张候选，在「结果」里挑一张点「选用」。`);
  } catch (e) {
    done(false, "候选失败：" + errMsg(e));
    statusline($("mainStatus"), "候选渲染失败：" + errMsg(e));
  } finally {
    setBusy(false);
    touch();
  }
}

// 重置为出厂 COL-001。重置前先自动存一份快照——「重置」是破坏性操作，
// 自动快照让用户永远能在「快照」面板里一键回到重置前的状态。
async function resetProject(label) {
  const snapLabel = label || "重置前自动快照 " + S.fmtTime(Date.now());
  let key = null;
  try {
    const r = await Store.snapshot(project, snapLabel);
    key = r && r.key ? r.key : null;
  } catch (e) {
    key = null;
  }
  project = S.createDefaultProject();
  loadedFromSave = false;
  stopRenderProgress();
  candidates = [];
  candidatesBuilt = null;
  activeFavKey = null;
  S.pushChange(project, {
    kind: "reset",
    path: "project",
    note: key ? `重置为出厂 COL-001（重置前快照：${snapLabel}）` : "重置为出厂 COL-001（快照失败，未备份）",
    layersChanged: [],
  });
  touch();
  try {
    await refreshSnapshots();
  } catch (e) {}
  return key;
}

async function favoriteCurrent() {
  if (!project.render.lastDataUrl) return statusline($("mainStatus"), "还没有渲染结果可收藏，先渲染一张角色图。");
  if (favoriteOfCurrent()) return statusline($("mainStatus"), "这张结果已经在收藏里了。");
  const r = await Store.addFavorite({
    label: `${S.fmtTime(Date.now())} · 种子 ${project.render.lockSeed ? project.render.seed : "随机"} · ${project.render.resolution}`,
    dataUrl: project.render.lastDataUrl,
    prompt: project.render.lastPrompt || "",
    negativePrompt: project.render.lastNegative || "",
    seed: project.render.lockSeed ? project.render.seed : null,
    resolution: project.render.resolution,
    layers: (lastBuilt ? lastBuilt.layers.map((l) => l.id) : []),
  });
  if (!r.ok) return statusline($("mainStatus"), r.error);
  activeFavKey = r.key;
  await refreshFavorites();
  statusline($("mainStatus"), "已收藏当前结果，可在「1 · 收藏」里切回。");
}

function selectFavorite(f) {
  activeFavKey = f.key;
  project.render.lastDataUrl = f.dataUrl;
  project.render.lastPrompt = f.prompt || "";
  project.render.lastNegative = f.negativePrompt || "";
  if (f.resolution) project.render.resolution = f.resolution;
  project.render.updatedAt = f.ts || Date.now();
  S.pushChange(project, { kind: "favorite", path: "render", note: "切换收藏结果：" + S.fmtTime(f.ts), layersChanged: [] });
  statusline($("mainStatus"), "已切回收藏的结果（" + S.fmtTime(f.ts) + "）。");
  touch();
}

async function removeFavorite(f) {
  if (!confirm("删除这张收藏？")) return;
  await Store.deleteFavorite(f.key);
  if (activeFavKey === f.key) activeFavKey = null;
  await refreshFavorites();
}

async function refreshFavorites() {
  try {
    favorites = await Store.listFavorites();
  } catch (e) {
    favorites = [];
  }
  renderFavorites();
}

async function refreshSnapshots() {
  const ctn = $("snapshotsEl");
  ctn.textContent = "（加载中…）";
  try {
    const list = await Store.listSnapshots();
    ctn.textContent = "";
    if (!list.length) ctn.append(el("div", { class: "snap", text: "（无快照）" }));
    for (const s of list) {
      ctn.append(
        el("div", { class: "snap" }, [
          el("span", { text: S.fmtTime(s.ts) }),
          el("span", { text: s.label }),
          el("span", { class: "spacer" }),
          el("button", {
            class: "mini",
            text: "恢复",
            onclick: async () => {
              if (!confirm("恢复该快照？当前未保存的修改会被覆盖。")) return;
              const data = await Store.restoreSnapshot(s.key);
              if (data) {
                project = data;
                project.meta.loadedAt = Date.now();
                S.pushChange(project, { kind: "restore", path: "snapshot", note: "从快照恢复", layersChanged: [] });
                touch();
              }
            },
          }),
        ])
      );
    }
  } catch (e) {
    ctn.textContent = "快照不可用：" + errMsg(e);
  }
}

async function doLoad() {
  try {
    const p = await Store.loadProject(S.PROJECT_CODE);
    if (p) {
      project = S.migrate(p);
      loadedFromSave = true;
      project.meta.loadedAt = Date.now();
      S.pushChange(project, { kind: "load", path: "project", note: "加载 COL-001（角色卡 + 覆盖 + 记忆 + 任务）", layersChanged: [] });
      project.chats.main.push({
        ts: Date.now(),
        role: "ai",
        kind: "note",
        text: "已恢复 COL-001：角色卡、当前覆盖、项目记忆、当前任务已载入，AI 已获得这些信息作为当前上下文。",
      });
      storageSuspect = false;
      statusline($("mainStatus"), "已加载档案 COL-001。");
    } else {
      project = S.createDefaultProject();
      loadedFromSave = false;
      S.pushChange(project, { kind: "load", path: "project", note: "无存档，载入出厂 COL-001", layersChanged: [] });
      statusline($("mainStatus"), "KV 中没有存档，已载入出厂 COL-001。");
    }
  } catch (e) {
    statusline($("mainStatus"), "加载失败：" + errMsg(e));
  }
  touch();
  refreshSnapshots();
}

async function doSaveCharacter() {
  const r = await Store.saveCharacter(project);
  if (!r.ok) return statusline($("mainStatus"), r.error);
    S.pushChange(project, { kind: "save", path: "character", note: "保存角色卡（人物形象基准未被修改）" + (r.coreChanged ? " ⚠ 基准指纹变化" : ""), layersChanged: [] });
    renderStatus();
  statusline($("mainStatus"), "已保存角色卡。" + (r.coreChanged ? " ⚠ 检测到人物形象基准变化。" : ""));
}

async function doSaveProject() {
  const r = await Store.saveProject(project, "manual");
  if (!r.ok) return statusline($("mainStatus"), r.error);
  storageSuspect = false;
  S.pushChange(project, { kind: "save", path: "project", note: "保存项目（角色基准 + 覆盖 + 记忆 + 变更日志）" + (r.coreChanged ? " ⚠ 基准指纹变化" : ""), layersChanged: [] });
  touch();
  statusline($("mainStatus"), "已保存项目。" + (r.coreChanged ? " ⚠ 检测到人物形象基准变化。" : ""));
  refreshSnapshots();
}

function exportJson() {
  const blob = new Blob([Store.exportJson(project)], { type: "application/json" });
  const a = el("a", { href: URL.createObjectURL(blob), download: `${project.code}-project.json` });
  document.body.append(a);
  a.click();
  a.remove();
}

/* =========================================================
   Events
   ========================================================= */

function wire() {
  $("mainSendBtn").onclick = () => sendMain($("mainInput").value);
  $("mainInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) sendMain($("mainInput").value);
  });
  $("quickBar").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-q]");
    if (b) sendMain(b.dataset.q);
  });
  $("loadBtn").onclick = doLoad;
  $("saveCharBtn").onclick = doSaveCharacter;
  $("saveProjBtn").onclick = doSaveProject;
  $("renderBtn").onclick = doRender;
  $("candidatesBtn").onclick = () => doCandidates(Number($("candidatesCount").value) || 4);
  $("castSeg").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b || busy) return;
    const mode = b.dataset.mode;
    const from = S.castModeOf(project);
    if (from === mode) return;
    project.cast = { mode, count: S.castCountOf(project) || Number(project.cast && project.cast.count) || 1 };
    S.pushChange(project, {
      kind: "manual",
      path: "cast.mode",
      note: `人物数量模式：${from === "multi" ? "多人" : "单人"} → ${mode === "multi" ? "多人" : "单人"}`,
      layersChanged: P.diffLayers(P.layerSnapshot(lastBuilt), P.buildImagePrompt(project)).map((d) => d.id),
    });
    statusline(
      $("mainStatus"),
      mode === "multi"
        ? "已切换为多人模式：「第二人物」层会一起渲染，记得写清对方的外形与动作。"
        : "已切换为单人模式：画面里只会有她一个人。"
    );
    touch();
  });
  $("castCount").addEventListener("change", (e) => {
    if (busy) return;
    const max = S.CAST_COUNT_MAX;
    const from = S.castCountOf(project) || Number(project.cast && project.cast.count) || 1;
    let to = Math.round(Number(e.target.value));
    if (!Number.isFinite(to)) to = from;
    to = Math.min(max, Math.max(1, to));
    e.target.value = String(to);
    if (to === from) return;
    project.cast = { mode: S.castModeOf(project), count: to };
    S.pushChange(project, {
      kind: "manual",
      path: "cast.count",
      note: `同框人数（除主角外）：${from} → ${to}`,
      layersChanged: [],
    });
    statusline($("mainStatus"), `同框共 ${to + 1} 人（主角 + ${to}）。请让第二人物/姿势文字里的人数和它一致。`);
    touch();
  });
  $("favThisBtn").onclick = favoriteCurrent;
  $("favRefreshBtn").onclick = refreshFavorites;
  $("runChecksBtn").onclick = () => touch();
  $("copyPromptBtn").onclick = async () => {
    try {
      await navigator.clipboard.writeText(lastBuilt.prompt + "\n\n[NEGATIVE] " + lastBuilt.negativePrompt);
      $("copyPromptBtn").textContent = "已复制";
      setTimeout(() => ($("copyPromptBtn").textContent = "复制"), 1200);
    } catch (e) {}
  };
  $("ctxToggle").onclick = () => {
    const pre = $("ctxPre");
    pre.hidden = !pre.hidden;
    if (!pre.hidden) {
      pre.textContent = lastMainInstruction || P.buildMainInstruction({ project, log: AI.chatLog(project, "main"), userText: lastUserText });
    }
  };
  $("taskInput").addEventListener("blur", () => {
    if (project.task === $("taskInput").value) return;
    project.task = $("taskInput").value;
    S.pushChange(project, { kind: "task", path: "task", note: "更新当前任务", layersChanged: [] });
    touch();
  });
  $("refUrlInput").addEventListener("blur", () => {
    if (project.referenceImage.url === $("refUrlInput").value) return;
    project.referenceImage.url = $("refUrlInput").value;
    S.pushChange(project, { kind: "manual", path: "referenceImage.url", note: "更新参考图", layersChanged: [] });
    touch();
  });
  $("lockSeedChk").onchange = () => {
    project.render.lockSeed = $("lockSeedChk").checked;
    renderStatus();
  };
  $("seedInput").onchange = () => {
    project.render.seed = Number($("seedInput").value) || 0;
    renderStatus();
  };
  $("resSelect").onchange = () => {
    project.render.resolution = $("resSelect").value;
    renderStatus();
  };
  $("coreLockBtn").onclick = () => {
    if (project.characterCore.locked) {
      if (!confirm("解锁角色基准？解锁后 AI 与手动编辑都可能改动人物形象（发色、刘海、面部、羽翼等），通常会破坏角色一致性。")) return;
      project.characterCore.locked = false;
      S.pushChange(project, { kind: "core-unlock", path: "characterCore.locked", note: "⚠ 角色基准已解锁，人物形象可被改动", layersChanged: ["core"] });
    } else {
      project.characterCore.locked = true;
      S.pushChange(project, { kind: "core-lock", path: "characterCore.locked", note: "重新锁定角色基准", layersChanged: ["core"] });
    }
    touch();
  };
  $("clearChatBtn").onclick = () => {
    if (!confirm("清空对话记录？（角色卡与项目记忆不受影响）")) return;
    project.chats.main = [];
    project.chats.mainSummary = "";
    touch();
  };
  $("clearLogBtn").onclick = () => {
    if (!confirm("清空变更日志？")) return;
    project.memory.changeLog = [];
    touch();
  };
  $("snapshotBtn").onclick = async () => {
    await Store.snapshot(project, "手动快照 " + new Date().toLocaleString());
    refreshSnapshots();
  };
  $("exportBtn").onclick = exportJson;
  $("importBtn").onclick = () => $("importFile").click();
  $("importFile").onchange = async () => {
    const f = $("importFile").files[0];
    if (!f) return;
    try {
      project = Store.importJson(await f.text());
      project = S.migrate(project);
      S.pushChange(project, { kind: "import", path: "project", note: "导入项目 JSON", layersChanged: [] });
      touch();
    } catch (e) {
      alert("导入失败：" + e.message);
    }
  };
  $("resetBtn").onclick = async () => {
    if (!confirm("重置为出厂 COL-001？当前所有修改将丢失（系统会先自动存一份快照，可在「快照」面板里恢复）。")) return;
    const key = await resetProject();
    alert(key ? "已重置为出厂 COL-001。修改前的状态已自动存为快照，可在「快照」面板一键恢复。" : "已重置为出厂 COL-001（快照失败，未能备份）。");
  };
  document.querySelectorAll("#tabbar .tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll("#tabbar .tab").forEach((x) => x.classList.toggle("active", x === t));
      document.querySelectorAll(".studio-body > .panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === t.dataset.tab));
    };
  });
}

/* =========================================================
   Boot
   ========================================================= */

async function boot() {
  wire();
  $("panelCard").classList.add("active");
  const ok = await AI.waitForPlugins();

  let loaded = null;
  let loadErr = null;
  try {
    loaded = await Store.loadProject(S.PROJECT_CODE);
  } catch (e) {
    loadErr = errMsg(e);
    storageSuspect = true;
    loaded = await Store.loadBackup(S.PROJECT_CODE).catch(() => null);
  }

  if (loaded && loaded.characterCore) {
    project = S.migrate(loaded);
    loadedFromSave = true;
    project.meta.loadedAt = Date.now();
    S.pushChange(project, { kind: "load", path: "project", note: "页面加载时自动恢复 COL-001", layersChanged: [] });
    project.chats.main.push({
      ts: Date.now(),
      role: "ai",
      kind: "note",
      text: "已恢复 COL-001：角色卡、当前覆盖、项目记忆、当前任务已作为 AI 的当前上下文载入。人物形象保持锁定。",
    });
  } else if (loadErr) {
    project.chats.main.push({
      ts: Date.now(),
      role: "ai",
      kind: "note",
      text: `⚠ 读取存档失败（${loadErr}）。当前显示出厂 COL-001，并且已暂停自动保存以避免覆盖原存档；请点击“保存项目”手动重试。`,
    });
  } else {
    project.chats.main.push({
      ts: Date.now(),
      role: "ai",
      kind: "note",
      text: "未发现存档，已载入出厂 COL-001。修改会持续自动保存到本机。",
    });
  }

  if (!ok) {
    project.chats.main.push({ ts: Date.now(), role: "ai", kind: "note", text: "⚠ AI 插件未就绪：角色卡与状态系统可用，但聊天与渲染暂时不可用。" });
  }
  renderAll();
  refreshFavorites();
  refreshSnapshots();
  window.__colStudio = {
    get project() {
      return project;
    },
    get favorites() {
      return favorites;
    },
    sendMain,
    doRender,
    refreshFavorites,
    favoriteCurrent,
    runChecks: () => C.runChecks(project),
    appearanceViolations: (t) => C.appearanceViolations(t),
    favoriteOfCurrent,
    buildPrompt: () => P.buildImagePrompt(project),
    buildInstruction: () => P.buildMainInstruction({ project, log: AI.chatLog(project, "main"), userText: "" }),
    inferTargets: (t) => {
      const s = AI.inferTargets(t);
      return { layers: [...s.layers], resetAll: s.resetAll, defaults: s.defaults, any: s.any };
    },
    applyActions: (changes, opts) => AI.applyActions(project, changes, "manual-test", opts || {}),
    castModeOf: () => S.castModeOf(project),
    castCountOf: () => S.castCountOf(project),
    setCastMode: (m) => {
      const keep = S.castCountOf(project) || Number(project.cast && project.cast.count) || 1;
      project.cast = { mode: m === "multi" ? "multi" : "single", count: keep };
      touch();
      return S.castModeOf(project);
    },
    setCastCount: (n) => {
      const to = Math.min(S.CAST_COUNT_MAX, Math.max(1, Math.round(Number(n) || 1)));
      project.cast = { mode: S.castModeOf(project), count: to };
      touch();
      return S.castCountOf(project);
    },
    render: renderAll,
    touch: () => touch(),
    save: async () => {
      await Store.saveProject(project, "manual");
      renderStatus();
      return project.meta.lastSavedAt;
    },
    reset: (label) => resetProject(label),
    resetProject: (label) => resetProject(label),
  };
}

boot();
