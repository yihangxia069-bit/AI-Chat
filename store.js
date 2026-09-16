import { cloneProject, createCharacterCard } from "./state.js";

const P = "colProject";
const C = "colCharacter";
const RC = "colRoleCards";
const S = "colSnapshots";
const B = "colBackup";
const F = "colFavorites";
const MAX_SNAPSHOTS = 8;
const MAX_FAVORITES = 24;

export function fingerprint(obj) {
  const s = JSON.stringify(obj);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

function kvReady() {
  return typeof root !== "undefined" && root && root.kv;
}

export async function saveProject(project, label = "manual") {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  const coreChanged = project.meta.coreFingerprint && project.meta.coreFingerprint !== fingerprint(project.characterCore);
  project.meta.coreFingerprint = fingerprint(project.characterCore);
  project.meta.lastSavedAt = Date.now();
  project.meta.saveCount = (project.meta.saveCount || 0) + 1;
  project.meta.lastSaveLabel = label;
  if (label !== "autosave") await backupProject(project.code);
  await root.kv[P].set(project.code, cloneProject(project));
  return { ok: true, coreChanged, at: project.meta.lastSavedAt };
}

async function backupProject(code) {
  try {
    const prev = await root.kv[P].get(code);
    if (prev) await root.kv[B].set(code, { ts: Date.now(), data: prev });
  } catch (e) {}
}

export async function loadBackup(code) {
  if (!kvReady()) return null;
  try {
    const b = await root.kv[B].get(code);
    return b ? b.data : null;
  } catch (e) {
    return null;
  }
}

export async function saveCharacter(project) {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  const coreChanged = project.meta.coreFingerprint && project.meta.coreFingerprint !== fingerprint(project.characterCore);
  project.meta.coreFingerprint = fingerprint(project.characterCore);
  const card = createCharacterCard(project);
  await root.kv[C].set(project.code, card);
  await root.kv[RC].set(project.code, card);
  return { ok: true, coreChanged, at: Date.now() };
}

export async function loadProject(code) {
  if (!kvReady()) return null;
  const p = await root.kv[P].get(code);
  return p || null;
}

export async function loadCharacter(code) {
  if (!kvReady()) return null;
  return (await root.kv[C].get(code)) || null;
}

export async function listCharacters() {
  if (!kvReady()) return [];
  const maps = new Map();
  const sources = [RC, C];
  for (const bucket of sources) {
    try {
      const entries = await root.kv[bucket].entries();
      for (const [key, v] of entries) {
        if (!v) continue;
        const code = v.code || key;
        maps.set(code, { code, name: v.name || code, savedAt: v.savedAt || 0 });
      }
    } catch (e) {}
  }
  return [...maps.values()].sort((a, b) => String(a.code).localeCompare(String(b.code)));
}

export async function saveCharacterCard(card) {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  if (!card || !card.code || !card.characterCore) return { ok: false, error: "无效角色卡" };
  const data = cloneProject(card);
  data.format = "COL_CHARACTER_CARD";
  data.formatVersion = 1;
  data.savedAt = Date.now();
  await root.kv[C].set(data.code, data);
  await root.kv[RC].set(data.code, data);
  return { ok: true, at: data.savedAt, code: data.code };
}

export function exportCharacterCard(project) {
  return JSON.stringify(createCharacterCard(project), null, 2);
}

export function importCharacterCard(text) {
  const c = JSON.parse(text);
  if (!c || !c.code || !c.characterCore || !Array.isArray(c.characterCore.groups)) throw new Error("不是有效的 COL 角色卡");
  c.characterCore.locked = true;
  return c;
}

export async function savedAt(code) {
  const p = await loadProject(code);
  return p ? p.meta.lastSavedAt : null;
}

export async function snapshot(project, label) {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  const key = String(Date.now());
  await root.kv[S].set(key, { label: label || "snapshot", ts: Date.now(), data: cloneProject(project) });
  const keys = (await root.kv[S].keys()).sort();
  while (keys.length > MAX_SNAPSHOTS) await root.kv[S].delete(keys.shift());
  return { ok: true, key };
}

export async function listSnapshots() {
  if (!kvReady()) return [];
  const entries = await root.kv[S].entries();
  return entries
    .map(([k, v]) => ({ key: k, label: v.label, ts: v.ts, size: JSON.stringify(v.data || {}).length }))
    .sort((a, b) => b.ts - a.ts);
}

export async function restoreSnapshot(key) {
  if (!kvReady()) return null;
  const v = await root.kv[S].get(key);
  return v ? v.data : null;
}

export function exportJson(project) {
  return JSON.stringify(project, null, 2);
}

export function importJson(text) {
  const p = JSON.parse(text);
  if (!p || !p.characterCore || !p.overrides) throw new Error("不是有效的 COL 项目文件");
  return p;
}

export async function addFavorite(entry) {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  const key = String(Date.now());
  await root.kv[F].set(key, { key, ts: Date.now(), ...entry });
  const keys = (await root.kv[F].keys()).sort();
  while (keys.length > MAX_FAVORITES) await root.kv[F].delete(keys.shift());
  return { ok: true, key };
}

export async function listFavorites() {
  if (!kvReady()) return [];
  const entries = await root.kv[F].entries();
  return entries
    .map(([k, v]) => ({
      key: k,
      ts: v.ts || Number(k) || 0,
      label: v.label || "",
      dataUrl: v.dataUrl || "",
      prompt: v.prompt || "",
      negativePrompt: v.negativePrompt || "",
      seed: v.seed,
      resolution: v.resolution || "",
      layers: v.layers || [],
    }))
    .sort((a, b) => b.ts - a.ts);
}

export async function deleteFavorite(key) {
  if (!kvReady()) return { ok: false, error: "存储插件未就绪" };
  await root.kv[F].delete(key);
  return { ok: true };
}

