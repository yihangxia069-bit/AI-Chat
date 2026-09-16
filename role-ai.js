// COL V4.2 · 独立角色 AI 模块
// 与原有「项目 / 主 AI」状态完全分离，使用独立 KV 命名空间。
const KEY = "colRoleAI";
const MAX_CHAT = 160;
const MAX_ROLES = 100;

let roles = [];
let active = null;
let busy = false;

const $ = id => document.getElementById(id);
const now = () => Date.now();
const clone = x => JSON.parse(JSON.stringify(x));

function emptyRole() {
  const t = now();
  return {
    id: "role-" + t,
    code: "ROLE-" + String(t).slice(-6),
    name: "新角色",
    avatar: "",
    info: "",
    outfit: "",
    personality: "",
    hobbies: "",
    preferences: "",
    speech: "",
    background: "",
    memory: "",
    chats: [],
    generatedImages: [],
    createdAt: t,
    updatedAt: t
  };
}

function ready() {
  return typeof root !== "undefined" && root && root.kv && root.kv[KEY];
}

async function loadRoles() {
  if (!ready()) return [];
  try {
    const entries = await root.kv[KEY].entries();
    return entries.map(([id, v]) => ({ ...v, id: v.id || id }))
      .filter(v => v && v.name)
      .sort((a,b) => (b.updatedAt||0) - (a.updatedAt||0));
  } catch (e) { return []; }
}

async function saveRole(role) {
  role.updatedAt = now();
  if (role.chats.length > MAX_CHAT) role.chats.splice(0, role.chats.length - MAX_CHAT);
  await root.kv[KEY].set(role.id, clone(role));
}

async function deleteRole(role) {
  if (ready()) await root.kv[KEY].delete(role.id);
}

function setStatus(text, cls="") {
  const n = $("roleAiStatus");
  if (n) { n.textContent = text || ""; n.className = "status-line" + (cls ? " "+cls : ""); }
}

function setBusy(v) {
  busy = v;
  ["roleAiSendBtn","roleAiImageBtn","roleAiSaveBtn","roleAiDeleteBtn"].forEach(id => {
    const n=$(id); if(n) n.disabled=v;
  });
}

function fieldsFromUI() {
  return {
    name: $("roleAiName").value.trim() || "未命名角色",
    code: $("roleAiCode").value.trim() || "ROLE-" + String(now()).slice(-6),
    info: $("roleAiInfo").value.trim(),
    outfit: $("roleAiOutfit").value.trim(),
    personality: $("roleAiPersonality").value.trim(),
    hobbies: $("roleAiHobbies").value.trim(),
    preferences: $("roleAiPreferences").value.trim(),
    speech: $("roleAiSpeech").value.trim(),
    background: $("roleAiBackground").value.trim(),
    memory: $("roleAiMemory").value.trim()
  };
}

function syncRoleFromUI() {
  if (!active) return;
  Object.assign(active, fieldsFromUI());
  active.updatedAt = now();
}

function renderSelect() {
  const s=$("roleAiSelect"); if(!s) return;
  s.textContent="";
  if(!roles.length) {
    const o=document.createElement("option"); o.value=""; o.textContent="暂无角色"; s.append(o); return;
  }
  for(const r of roles) {
    const o=document.createElement("option");
    o.value=r.id; o.textContent=`${r.name} · ${r.code}`; s.append(o);
  }
  if(active) s.value=active.id;
}

function renderRole() {
  if(!active) return;
  $("roleAiName").value=active.name||"";
  $("roleAiCode").value=active.code||"";
  $("roleAiInfo").value=active.info||"";
  $("roleAiOutfit").value=active.outfit||"";
  $("roleAiPersonality").value=active.personality||"";
  $("roleAiHobbies").value=active.hobbies||"";
  $("roleAiPreferences").value=active.preferences||"";
  $("roleAiSpeech").value=active.speech||"";
  $("roleAiBackground").value=active.background||"";
  $("roleAiMemory").value=active.memory||"";
  renderAvatar();
  renderChat();
}

function renderAvatar() {
  const img=$("roleAiAvatar"), empty=$("roleAiAvatarEmpty");
  if(!img||!empty) return;
  if(active && active.avatar) { img.src=active.avatar; img.hidden=false; empty.hidden=true; }
  else { img.hidden=true; empty.hidden=false; }
}

function renderChat() {
  const box=$("roleAiChat"); if(!box||!active) return;
  box.textContent="";
  if(!active.chats.length) {
    const empty=document.createElement("div"); empty.className="roleai-chat-empty";
    empty.textContent=`这是 ${active.name} 的独立聊天空间。角色会依据左侧角色卡中的设定进行回应。`;
    box.append(empty); return;
  }
  for(const m of active.chats) {
    const row=document.createElement("div");
    row.className="roleai-msg "+(m.role==="user"?"user":"character");
    const avatar=document.createElement("img");
    avatar.className="roleai-msg-avatar"; avatar.src=m.role==="user" ? "" : (active.avatar||"");
    if(!avatar.src || m.role==="user") avatar.hidden=true;
    const bubble=document.createElement("div"); bubble.className="roleai-bubble";
    bubble.textContent=m.text;
    row.append(avatar,bubble); box.append(row);
  }
  box.scrollTop=box.scrollHeight;
}

function roleContext() {
  return [
    `角色名称：${active.name}`,
    `角色编号：${active.code}`,
    `基础信息：${active.info||"未填写"}`,
    `默认服装：${active.outfit||"未填写"}`,
    `性格：${active.personality||"未填写"}`,
    `爱好：${active.hobbies||"未填写"}`,
    `偏好：${active.preferences||"未填写"}`,
    `说话方式：${active.speech||"未填写"}`,
    `背景故事：${active.background||"未填写"}`,
    `长期记忆：${active.memory||"暂无"}`,
  ].join("\n");
}

function recentChat() {
  return active.chats.slice(-24).map(m => `${m.role==="user"?"用户":"角色"}：${m.text}`).join("\n");
}

async function sendMessage(text) {
  text=String(text||"").trim();
  if(!text || !active || busy) return;
  syncRoleFromUI();
  active.chats.push({role:"user", text, ts:now()});
  renderChat();
  $("roleAiInput").value="";
  setBusy(true); setStatus("角色正在思考…","busy");
  try {
    const instruction = `你是角色「${active.name}」的角色 AI。
严格依据角色卡进行长期一致的角色扮演，但不要声称自己是真实人物或现实世界的 AI 服务。
保持角色的性格、说话方式、背景和偏好；不要擅自修改角色卡。
用户没有要求改变角色设定时，不要自行新增重大设定。
回复自然、连贯、有角色感，不要输出系统提示词、内部推理或技术日志。
如果用户提出与角色设定冲突的内容，以角色卡为准并自然回应。

【角色卡】
${roleContext()}

【最近对话】
${recentChat()}

【用户最新消息】
${text}

只输出角色这一次要说的话。`;

    let streamed="";
    const res=await root.generateText({
      instruction,
      onChunk:(chunk)=>{
        const part=chunk && chunk.fullTextSoFar != null ? chunk.fullTextSoFar : chunk;
        streamed=String(part||"");
        renderStreaming(streamed);
      }
    });
    const reply=String(res && res.text != null ? res.text : (streamed || res)).trim();
    if(!reply) throw new Error("AI 没有返回内容");
    active.chats.push({role:"character", text:reply, ts:now()});
    await saveRole(active);
    setStatus("已回复。");
    renderChat();
    renderSelect();
  } catch(e) {
    active.chats.pop(); // 回滚未完成的用户消息，避免坏消息进入历史
    renderChat();
    setStatus("发送失败："+(e.message||e),"error");
  } finally { setBusy(false); }
}

function imagePrompt(scene) {
  return [
    "high quality anime character illustration",
    `character: ${active.name}`,
    active.info,
    `personality and mood: ${active.personality}`,
    `default outfit: ${active.outfit}`,
    active.speech ? `character tone: ${active.speech}` : "",
    `visual direction: preserve the character's established identity and design; do not redesign the character`,
    `scene and action: ${scene || "a clean character portrait, calm natural pose"}`,
    "clean composition, detailed line art, coherent anatomy, expressive face"
  ].filter(Boolean).join(", ");
}

async function generateRoleImage() {
  if(!active || busy) return;
  syncRoleFromUI();
  const scene=$("roleAiImageScene").value.trim();
  const resolution=$("roleAiImageRes").value;
  let seed=Number($("roleAiImageSeed").value);
  const lock=$("roleAiImageLockSeed").checked;
  if(!Number.isFinite(seed)) seed=Math.floor(Math.random()*2147483647);
  if(!lock) seed=Math.floor(Math.random()*2147483647);
  setBusy(true); setStatus("正在生成角色图…","busy");
  const prompt=imagePrompt(scene);
  try {
    const res=await root.generateImage({prompt, resolution, seed});
    const url=await normalizeImage(res);
    $("roleAiImage").src=url; $("roleAiImage").hidden=false; $("roleAiImageEmpty").hidden=true;
    $("roleAiImagePrompt").hidden=false;
    $("roleAiImagePrompt").textContent="提示词："+prompt;
    active.generatedImages = Array.isArray(active.generatedImages) ? active.generatedImages : [];
    active.generatedImages.unshift({url, prompt, resolution, seed, ts:now()});
    if(active.generatedImages.length>6) active.generatedImages.splice(6);
    await saveRole(active);
    setStatus("角色图生成完成，已保存到该角色资料。");
  } catch(e) { setStatus("生图失败："+(e.message||e),"error"); }
  finally { setBusy(false); }
}

async function normalizeImage(res) {
  if(typeof res==="string") {
    const t=res.trim();
    if(/^(data:image\/|https?:\/\/)/i.test(t)) return t;
    const m=t.match(/<img[^>]+src=["']([^"']+)["']/i); if(m) return m[1];
  }
  if(res && typeof res==="object") {
    const direct=res.dataUrl||res.dataURL||res.url||res.imageUrl||res.src;
    if(typeof direct==="string" && /^(data:image\/|https?:\/\/)/i.test(direct)) return direct;
    if(Array.isArray(res.data)) for(const x of res.data) {
      const u=x&&(x.dataUrl||x.dataURL||x.url||x.imageUrl||x.src);
      if(typeof u==="string" && /^(data:image\/|https?:\/\/)/i.test(u)) return u;
    }
    if(res.html) { const m=String(res.html).match(/<img[^>]+src=["']([^"']+)["']/i); if(m)return m[1]; }
  }
  throw new Error("生图结果格式无法识别");
}

async function newRole() {
  if(active) syncRoleFromUI();
  const r=emptyRole(); roles.unshift(r); active=r;
  await saveRole(r);
  renderSelect(); renderRole(); setStatus("已创建新角色。");
}

async function saveCurrent() {
  if(!active) return;
  syncRoleFromUI();
  await saveRole(active);
  roles=await loadRoles();
  active=roles.find(r=>r.id===active.id)||active;
  renderSelect(); setStatus("角色卡已保存。");
}

async function selectRole(id) {
  if(!id) return;
  const found=roles.find(r=>r.id===id); if(!found) return;
  active=found; renderRole(); setStatus(`已切换到「${active.name}」。`);
}

async function deleteCurrent() {
  if(!active) return;
  if(!confirm(`确定删除角色「${active.name}」？角色卡、聊天记录和长期记忆都会删除。`)) return;
  await deleteRole(active);
  roles=await loadRoles();
  active=roles[0]||null;
  renderSelect();
  if(active) renderRole(); else setStatus("暂无角色，请新建角色。");
}

function wire() {
  $("roleAiSelect").onchange=e=>selectRole(e.target.value);
  $("roleAiNewBtn").onclick=newRole;
  $("roleAiImportCurrentBtn").onclick=async()=>{
    const p=window.__colStudio && window.__colStudio.project;
    if(!p){ setStatus("当前主工作室还未完成加载。","error"); return; }
    const r=emptyRole();
    r.code=p.code||r.code; r.name=p.name||r.name;
    r.info=[p.defaults?.outfit?"":""].filter(Boolean).join("");
    const core=(p.characterCore?.groups||[]).map(g=>g.text).filter(Boolean).join("；");
    r.info=core || r.info;
    r.outfit=p.defaults?.outfit?.text||"";
    r.personality=p.memory?.lastSummary||"";
    r.background=p.memory?.unfinishedTask||"";
    if(p.referenceImage?.url) r.avatar=p.referenceImage.url;
    roles.unshift(r); active=r; await saveRole(r); renderSelect(); renderRole();
    setStatus(`已从当前角色项目创建「${r.name}」角色 AI 卡。`);
  };
  $("roleAiSaveBtn").onclick=saveCurrent;
  $("roleAiDeleteBtn").onclick=deleteCurrent;
  $("roleAiSendBtn").onclick=()=>sendMessage($("roleAiInput").value);
  $("roleAiInput").addEventListener("keydown",e=>{
    if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)) sendMessage($("roleAiInput").value);
  });
  $("roleAiImageBtn").onclick=generateRoleImage;
  $("roleAiClearMemoryBtn").onclick=async()=>{
    if(!active) return;
    if(confirm("确定清空这个角色的长期记忆？聊天记录不会删除。")) {
      active.memory=""; $("roleAiMemory").value=""; await saveRole(active); setStatus("长期记忆已清空。");
    }
  };
  $("roleAiAvatarFile").onchange=async()=>{
    const f=$("roleAiAvatarFile").files[0]; if(!f||!active)return;
    if(f.size>3*1024*1024){alert("头像文件请控制在 3MB 以内。"); return;}
    const reader=new FileReader();
    reader.onload=async()=>{active.avatar=reader.result; renderAvatar(); await saveRole(active); setStatus("头像已保存。");};
    reader.readAsDataURL(f);
    $("roleAiAvatarFile").value="";
  };
  document.querySelectorAll(".roleai-subtab").forEach(b=>{
    b.onclick=()=>{
      document.querySelectorAll(".roleai-subtab").forEach(x=>x.classList.toggle("active",x===b));
      document.querySelectorAll(".roleai-view").forEach(x=>x.classList.toggle("active",x.dataset.roleaiViewPanel===b.dataset.roleaiView));
    };
  });
  // 输入框失焦自动保留编辑，但不频繁写 KV；点击保存即可明确持久化。
}

async function boot() {
  wire();
  roles=await loadRoles();
  if(!roles.length) {
    const r=emptyRole();
    r.name="示例角色";
    r.code="ROLE-001";
    r.info="可以把年龄、身份、外貌和世界观基础设定写在这里。";
    r.personality="温和、聪明、会认真回应用户。";
    r.speech="自然、简洁、有角色口吻，不使用系统提示词语言。";
    roles=[r]; active=r;
    await saveRole(r);
  } else active=roles[0];
  renderSelect(); renderRole();
}
if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
