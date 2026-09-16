import { cloneProject } from "./state.js";

const P = "colProject";
const C = "colCharacter";
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

function kvReady(){
  window.root=window.root||{};
  if(root.kv) return true;
  const makeNS=(p)=>({
    async get(k){const v=localStorage.getItem(p+k);return v?JSON.parse(v):null;},
    async set(k,v){localStorage.setItem(p+k,JSON.stringify(v));},
    async delete(k){localStorage.removeItem(p+k);},
    async keys(){return Object.keys(localStorage).filter(x=>x.startsWith(p)).map(x=>x.slice(p.length));},
    async entries(){const ks=await this.keys();return Promise.all(ks.map(async k=>[k,await this.get(k)]));}
  });
  root.kv={colProject:makeNS("colProject:"),colCharacter:makeNS("colCharacter:"),colSnapshots:makeNS("colSnapshots:"),colBackup:makeNS("colBackup:"),colFavorites:makeNS("colFavorites:")};
  return true;
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
  await root.kv[C].set(project.code, {
    code: project.code,
    name: project.name,
    characterCore: cloneProject(project.characterCore),
    referenceImage: cloneProject(project.referenceImage),
    defaults: cloneProject(project.defaults),
    savedAt: Date.now(),
  });
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

