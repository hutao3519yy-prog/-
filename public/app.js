const $ = (selector) => document.querySelector(selector);
const state = {
  analysis: null,
  script: null,
  cast: [],
  castAssignments: [],
  mode: "auto",
  style: "auto",
  styles: [],
  expandedStyle: "",
  manualMode: true,
  generationMode: localStorage.getItem("generationMode") || "chatgpt",
  titleConfirmed: false,
};

const MEMORY_ISOLATION_PROMPT = "上下文隔离约束：请忽略当前 ChatGPT 对话中此前所有与其他剧本、角色、海报、风格、人物关系、名称、参考图和记忆有关的内容；本次生成只能依据当前资源包内的 prompt.txt、README.md、metadata.json、characters/ 角色图、references/ 安全区图和 style-reference/ 风格图。不得引用、混合、延续或改写旧对话中的人物身份、剧情设定、剧名、视觉风格、构图、角色关系或任何历史记忆；如果旧记忆与当前资源包冲突，必须以当前资源包为唯一准绳。";
const VARIANT_PAIRING_PROMPT = "多版输出规则：生成数量指“构图方案数量”，不是每个比例各自随机变化。每一个构图方案必须输出两张图：一张9:16，一张3:4；如果生成2版海报，总计输出4张图，即方案1的9:16与3:4、方案2的9:16与3:4。不同方案之间必须是明显不同的构图版本；同一方案的9:16与3:4保留同一创意核心和人物关系，但必须针对画幅重新安排人物尺度、标题位置、留白和安全区，不能只是同一张图简单裁切，也不能让两个比例看起来完全同构图。";
const PHOTOREAL_QUALITY_PROMPT = "真人实拍电影海报质感，极致真人写实，超写实摄影，不要CG渲染感。保持竖版海报画幅，但使用变形宽银幕电影质感：IMAX胶片摄影机质感，Panavision C系列变形镜头观感，真实摄影棚或实景置景灯光，电影胶片颗粒，真实镜头眩光，真实景深，真实皮肤毛孔、细小瑕疵、汗毛、发丝和织物纹理；面部不能油腻、不能蜡像、不能塑料皮、不能过度磨皮，皮肤高光必须像真实摄影反光而不是3D材质；杜绝游戏CG感、动画感、二次元感、廉价影楼感、AI网红精修感、过度锐化、假HDR、假散景、油画感、硅胶脸、手指变形和AI伪影。";
const TITLE_SAFE_PROMPT = "剧名安全区硬约束：剧名完整外接框必须全部位于纵向58%-74%的中央标题区内，包含文字、描边、投影、发光、花纹、下划线和装饰笔画；剧名最上边不得高于58%，最下边不得低于74%，并且必须与78%数据裁切区至少保留4%画布高度缓冲。横向完整外接框必须位于画布中央70%宽度内，左右各至少15%留边。长剧名必须自动缩小字号、压缩字距或拆成2-3行，宁可缩小也绝不能越过安全区。禁止任何标题文字、英文副标题、装饰线、Logo或随机文案进入顶部0%-15.6%、底部78%-100%或左右安全边距外。";

const toast = (message) => {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  setTimeout(() => node.classList.remove("show"), 2200);
};

function loading(show, title, sub) {
  $("#loading").classList.toggle("hidden", !show);
  if (title) $("#loadingTitle").textContent = title;
  if (sub) $("#loadingSub").textContent = sub;
}

function go(panelId) {
  const studio = document.querySelector(".studio");
  studio?.classList.add("is-switching");
  document.querySelectorAll(".panel").forEach((panel) => {
    const active = panel.id === panelId;
    panel.classList.toggle("active-panel", active);
    panel.classList.toggle("panel-entering", active);
  });
  document.querySelectorAll(".rail-step").forEach((step) => step.classList.toggle("active", step.dataset.target === panelId));
  window.setTimeout(() => studio?.classList.remove("is-switching"), 520);
  window.scrollTo({ top: document.querySelector(".workspace").offsetTop - 85, behavior: "smooth" });
}

function installClickFeedback() {
  document.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("button, .brand-mark, .upload-icon, .cast-upload, .dropzone, .style-card, .mode, .safe-guide, .section-label > span");
    if (!target) return;
    target.classList.add("is-pressing");
    window.setTimeout(() => target.classList.remove("is-pressing"), 260);

    if (!target.matches("button, .style-card, .mode, .cast-upload, .dropzone")) return;
    const rect = target.getBoundingClientRect();
    const ripple = document.createElement("span");
    const size = Math.max(rect.width, rect.height);
    ripple.className = "ui-ripple";
    ripple.style.width = `${size}px`;
    ripple.style.height = `${size}px`;
    ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
    ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
    target.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 620);
  });
}

installClickFeedback();

async function jsonFetch(url, options) {
  const response = await fetch(url, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "请求失败，请稍后重试。 ");
  return data;
}

function escapeHtml(value = "") {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function getUserApiKey() {
  return $("#apiKeyInput")?.value.trim() || "";
}

function usingApiMode() {
  return state.generationMode === "api" && getUserApiKey();
}

function appendApiKey(form) {
  if (state.generationMode === "api") form.append("apiKey", getUserApiKey());
}

function renderApiMode() {
  const isApi = state.generationMode === "api";
  $("#modeChatGpt")?.classList.toggle("active", !isApi);
  $("#modeApi")?.classList.toggle("active", isApi);
  $("#apiKeyField")?.classList.toggle("hidden", !isApi);
  const hint = $("#apiModeHint");
  if (hint) {
    hint.textContent = isApi
      ? "API Key 只保存在当前浏览器，并仅随本次分析/生图请求发送。"
      : "不会使用站长 API；导出资源包后在 ChatGPT 中生成。";
  }
  const status = $("#modelStatus");
  if (status) {
    status.classList.toggle("connected", isApi && Boolean(getUserApiKey()));
    status.innerHTML = `<i></i>${isApi ? (getUserApiKey() ? "User API Mode" : "API Key Required") : "ChatGPT Manual Mode"}`;
  }
}

$("#modeChatGpt")?.addEventListener("click", () => {
  state.generationMode = "chatgpt";
  localStorage.setItem("generationMode", state.generationMode);
  renderApiMode();
});

$("#modeApi")?.addEventListener("click", () => {
  state.generationMode = "api";
  localStorage.setItem("generationMode", state.generationMode);
  renderApiMode();
  $("#apiKeyInput")?.focus();
});

$("#apiKeyInput")?.addEventListener("input", renderApiMode);
$("#clearApiKey")?.addEventListener("click", () => {
  $("#apiKeyInput").value = "";
  renderApiMode();
  toast("API Key 已清除");
});

renderApiMode();

fetch("/api/status").then((r) => r.json()).then((data) => {
  state.manualMode = Boolean(data.manualMode);
  renderApiMode();
});

fetch("/api/styles").then((r) => r.json()).then(({ styles }) => {
  state.styles = styles;
  if (!state.styles.some((style) => style.id === state.style)) state.style = "auto";
  renderStyles();
});

document.querySelectorAll(".rail-step").forEach((button) => button.addEventListener("click", () => go(button.dataset.target)));
document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => go(button.dataset.back)));

const scriptInput = $("#scriptInput");
scriptInput.addEventListener("change", () => {
  state.script = scriptInput.files[0];
  if (!state.script) return;
  $("#scriptFile").textContent = `已选择 · ${state.script.name}`;
  $("#scriptFile").classList.remove("hidden");
});

const drop = $("#scriptDrop");
["dragenter", "dragover"].forEach((event) => drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.add("drag"); }));
["dragleave", "drop"].forEach((event) => drop.addEventListener(event, (e) => { e.preventDefault(); drop.classList.remove("drag"); }));
drop.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (!file) return;
  const transfer = new DataTransfer(); transfer.items.add(file); scriptInput.files = transfer.files; scriptInput.dispatchEvent(new Event("change"));
});

$("#analyzeBtn").addEventListener("click", async () => {
  if (!state.script) return toast("请先选择 Word 剧本");
  if (state.generationMode === "api" && !getUserApiKey()) return toast("请先填写你的 OpenAI API Key");
  const form = new FormData();
  form.append("script", state.script); form.append("instruction", $("#instruction").value);
  appendApiKey(form);
  loading(true, "AI 正在阅读剧本", "寻找故事中最有力量的那一帧…");
  try {
    state.analysis = await jsonFetch("/api/analyze", { method: "POST", body: form });
    state.titleConfirmed = false;
    $("#prompt").value = state.analysis.prompt;
    renderAnalysis();
    go("castPanel");
    if (state.analysis.demo) toast("已用演示模式完成分析");
    if (state.analysis.manualMode) toast("已切换为 ChatGPT 手动生成模式");
  } catch (error) { toast(error.message); } finally { loading(false); }
});

function renderAnalysis() {
  const a = state.analysis;
  const summary = $("#analysisSummary");
  summary.innerHTML = `<h3>${escapeHtml(a.title)}</h3><p>${escapeHtml(a.logline || "已完成故事视觉分析")}</p><div class="story-tags"><span>${escapeHtml(a.genre || "短剧")}</span><span>${escapeHtml(a.tone || "电影级视觉")}</span><span>${a.characters?.length || 0} 位核心人物</span></div>`;
  summary.classList.remove("hidden");
  renderTitleConfirm();
  if (a.recommendedStyle && state.styles.some((style) => style.id === a.recommendedStyle)) state.style = a.recommendedStyle;
  renderStyles();
  renderCast();
}

function renderTitleConfirm() {
  const card = $("#titleConfirm");
  const input = $("#titleInput");
  const status = $("#titleConfirmStatus");
  if (!state.analysis) {
    card.classList.add("hidden");
    return;
  }
  card.classList.remove("hidden");
  input.value = state.analysis.title || "";
  card.classList.toggle("confirmed", state.titleConfirmed);
  status.textContent = state.titleConfirmed ? "剧名已确认，后续导出和生成都会使用这个名称。" : "请确认解析出的剧名，不正确可直接修改。";
}

$("#titleConfirm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!state.analysis) return toast("请先完成剧本分析");
  const title = $("#titleInput").value.trim();
  if (!title) return toast("剧名不能为空");
  state.analysis.title = title;
  state.titleConfirmed = true;
  renderAnalysis();
  loading(true, "正在同步剧名", "把确认后的剧名写入导演提示词…");
  await refreshPrompt();
  loading(false);
  toast("剧名已确认");
});

$("#titleInput").addEventListener("input", () => {
  if (!state.analysis) return;
  const changed = $("#titleInput").value.trim() !== (state.analysis.title || "");
  if (changed && state.titleConfirmed) {
    state.titleConfirmed = false;
    $("#titleConfirm").classList.remove("confirmed");
    $("#titleConfirmStatus").textContent = "剧名已修改，请再次确认后进入导演板。";
  }
});

function renderStyles() {
  const library = $("#styleLibrary");
  if (!library) return;
  library.innerHTML = state.styles.map((style) => {
    const refs = style.refs?.length ? style.refs : (style.thumb ? [style.thumb] : []);
    const stack = refs.length
      ? refs.slice(0, 3).map((src, index) => `<figure class="style-stack-card style-stack-card-${index + 1}"><img src="${src}" alt="${style.name}"></figure>`).join("")
      : `<div class="style-card-blank" aria-hidden="true"><span>ORIGINAL</span></div>`;
    const spread = refs.length
      ? refs.map((src, index) => `<figure><img src="${src}" alt="${style.name} reference ${index + 1}"></figure>`).join("")
      : "";
    const active = state.style === style.id;
    const expanded = state.expandedStyle === style.id;
    return `<article class="style-tile ${active ? "active" : ""} ${expanded ? "expanded" : ""}" data-style="${style.id}">
      <button class="style-card ${active ? "active" : ""}" data-style="${style.id}" type="button" aria-expanded="${expanded}">
        <div class="style-media"><div class="style-stack">${stack}</div><i>${escapeHtml(style.group || "Style")}</i><strong>${expanded ? "−" : "+"}</strong></div>
        <span><small>${escapeHtml(style.tag)}</small><b>${escapeHtml(style.name)}</b><em>${escapeHtml(style.description)}</em></span>
      </button>
      <div class="style-spread" aria-hidden="${!expanded}">${spread}</div>
    </article>`;
  }).join("");
  library.querySelectorAll(".style-card").forEach((button) => button.addEventListener("click", async () => {
    state.style = button.dataset.style;
    state.expandedStyle = state.expandedStyle === button.dataset.style ? "" : button.dataset.style;
    renderStyles();
    await refreshPrompt();
  }));
}

$("#castInput").addEventListener("change", (event) => {
  const files = [...event.target.files];
  state.cast.push(...files);
  state.castAssignments.push(...files.map(() => ""));
  syncCharactersFromFiles();
  renderCast();
  refreshPrompt();
  event.target.value = "";
});

function normalizeName(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/角色卡|定妆照|参考图|参考|人物图|头像|海报|图片|照片/g, "")
    .replace(/[^\u4e00-\u9fa5a-zA-Z0-9]/g, "")
    .trim();
}

function fileRoleName(file) {
  return normalizeName(file?.name || "");
}

function isUsefulFileCharacterName(name = "") {
  return /^[\u4e00-\u9fa5a-zA-Z0-9]{1,16}$/.test(name)
    && !["角色卡", "定妆照", "参考图", "人物图", "图片", "照片", "海报"].includes(name);
}

function getFileCharacterNames() {
  return [...new Set(state.cast.map(fileRoleName).filter(isUsefulFileCharacterName))];
}

function getCharacterOptions() {
  const current = state.analysis?.characters || [];
  const names = [...new Set([...getFileCharacterNames(), ...current.map((character) => character.name).filter(Boolean)])];
  return names.map((name, index) => {
    const existing = current.find((character) => normalizeName(character.name) === normalizeName(name));
    return existing || {
      name,
      role: index === 0 ? "核心主角" : index === 1 ? "关键主角" : "重要人物",
      visual: "面部、发型、服装和气质严格参照同名上传角色图",
      priority: index + 1,
    };
  });
}

function syncCharactersFromFiles() {
  if (!state.analysis) return;
  const characters = state.analysis.characters || [];
  getFileCharacterNames().forEach((name) => {
    if (!characters.some((character) => normalizeName(character.name) === name)) {
      characters.push({
        name,
        role: characters.length === 0 ? "核心主角" : characters.length === 1 ? "关键主角" : "重要人物",
        visual: "面部、发型、服装和气质严格参照同名上传角色图",
        priority: characters.length + 1,
      });
    }
  });
  state.analysis.characters = characters;
}

function bindingFromName(file, index, name, fallbackRole = "上传角色图") {
  const characters = getCharacterOptions();
  const character = characters.find((item) => normalizeName(item.name) === normalizeName(name));
  return {
    file,
    originalName: file.name,
    characterName: character?.name || name || `人物${index + 1}`,
    role: character?.role || fallbackRole,
    visual: character?.visual || "面部、发型、服装和气质严格参照该角色图",
    priority: character?.priority || index + 1,
  };
}

function bindingFromFileName(file, index) {
  const fileName = fileRoleName(file);
  return {
    file,
    originalName: file.name,
    characterName: fileName || `人物${index + 1}`,
    role: "文件名角色",
    visual: "面部、发型、服装和气质严格参照该角色图",
    priority: index + 1,
  };
}

function getCastBindings() {
  const characters = getCharacterOptions();
  const used = new Set();
  return state.cast.map((file, index) => {
    const fileName = fileRoleName(file);
    const assignedName = state.castAssignments[index];
    if (assignedName) return bindingFromName(file, index, assignedName, "手动指定角色");
    if (isUsefulFileCharacterName(fileName)) return bindingFromFileName(file, index);
    let characterIndex = -1;
    if (characterIndex < 0) characterIndex = characters.findIndex((character, candidateIndex) => {
      if (used.has(candidateIndex)) return false;
      const characterName = normalizeName(character.name);
      return characterName && (fileName.includes(characterName) || characterName.includes(fileName));
    });
    if (characterIndex < 0 && isUsefulFileCharacterName(fileName)) {
      return {
        file,
        originalName: file.name,
        characterName: fileName,
        role: "上传角色图",
        visual: "面部、发型、服装和气质严格参照该角色图",
        priority: index + 1,
      };
    }
    if (characterIndex < 0 && characters[index] && !used.has(index)) characterIndex = index;
    if (characterIndex >= 0) used.add(characterIndex);
    const character = characters[characterIndex];
    return {
      file,
      originalName: file.name,
      characterName: character?.name || `人物${index + 1}`,
      role: character?.role || "",
      visual: character?.visual || "",
      priority: character?.priority || index + 1,
    };
  });
}

function renderCast() {
  syncCharactersFromFiles();
  const characters = getCharacterOptions();
  $("#castGrid").innerHTML = getCastBindings().map((binding, index) => {
    const label = state.castAssignments[index] ? binding.characterName : `文件名：${fileRoleName(binding.file) || binding.characterName}`;
    return `<div class="cast-item"><img src="${URL.createObjectURL(binding.file)}"><span>图 ${index + 1} · ${label}</span><select class="cast-select" data-index="${index}"><option value="" ${state.castAssignments[index] ? "" : "selected"}>自动匹配（按文件名）</option>${characters.map((character) => `<option value="${character.name}" ${state.castAssignments[index] === character.name ? "selected" : ""}>${character.name}</option>`).join("")}</select></div>`;
  }).join("");
  const updateAssignment = (select) => {
    state.castAssignments[Number(select.dataset.index)] = select.value;
    renderCast();
    refreshPrompt();
  };
  document.querySelectorAll(".cast-select").forEach((select) => {
    select.addEventListener("change", () => updateAssignment(select));
    select.addEventListener("input", () => updateAssignment(select));
  });
}

$("#toDirectorBtn").addEventListener("click", async () => {
  if (!state.analysis) return toast("请先完成剧本分析");
  if (!state.titleConfirmed) return toast("请先确认剧名是否正确");
  if (!state.cast.length) toast("尚未上传人物图，也可以先预览构图");
  loading(true, "正在同步角色提示词", "把当前角色卡写入导演提示词…");
  await refreshPrompt();
  loading(false);
  go("directorPanel");
});

document.querySelectorAll(".mode").forEach((button) => button.addEventListener("click", async () => {
  document.querySelectorAll(".mode").forEach((item) => item.classList.remove("active"));
  button.classList.add("active"); state.mode = button.dataset.mode;
  await refreshPrompt();
}));

async function refreshPrompt() {
  if (!state.analysis) return;
  try {
    const boundCharacters = getCastBindings().map((binding) => ({
      name: binding.characterName,
      role: binding.role || "上传角色图",
      visual: binding.visual || "面部、发型、服装和气质严格参照同名上传角色图",
      priority: binding.priority,
    }));
    const effectiveMode = state.mode === "auto" && boundCharacters.length > 2 ? "ensemble" : state.mode;
    const data = await jsonFetch("/api/prompt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...state.analysis, characters: boundCharacters.length ? boundCharacters : state.analysis.characters, instruction: $("#instruction").value, mode: effectiveMode, style: state.style }) });
    $("#prompt").value = data.prompt;
  } catch (error) { toast(error.message); }
}

$("#copyPrompt").addEventListener("click", async () => { await navigator.clipboard.writeText($("#prompt").value); toast("提示词已复制"); });

function buildChatGptPackage() {
  const bindings = getCastBindings();
  const variantCount = Number($("#variants").value || 1);
  const imageLines = state.cast.length
    ? bindings.map((binding, index) => `图${index + 1}：${binding.characterName}；参考文件名：${String(index + 1).padStart(2, "0")}-${binding.characterName}${binding.role ? `；角色身份：${binding.role}` : ""}`).join("\n")
    : "未上传人物参考图；请根据下方导演提示词直接生成。";
  return `请使用 GPT Image 生成短剧海报。\n\n${MEMORY_ISOLATION_PROMPT}\n\n必须分别输出两套画幅：\n1. 9:16 竖版短剧封面\n2. 3:4 竖版海报\n\n${VARIANT_PAIRING_PROMPT}\n本次生成数量：${variantCount} 个构图方案，总计 ${variantCount * 2} 张图片。请按顺序输出：方案1-9:16、方案1-3:4、方案2-9:16、方案2-3:4，以此类推。\n\n我会上传人物参考图，请严格按照以下映射保持人物面孔、性别、发型、服装气质一致，不要交换角色：\n${imageLines}\n\n画质强制要求：${PHOTOREAL_QUALITY_PROMPT}\n\n剧名安全区强制要求：${TITLE_SAFE_PROMPT}\n\n导演提示词：\n${$("#prompt").value}`;
}

function safeZipName(value = "asset") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60) || "asset";
}

function characterExportName(binding, index) {
  const ext = binding.originalName.match(/\.[a-z0-9]+$/i)?.[0] || ".png";
  return `${String(index + 1).padStart(2, "0")}-${safeZipName(binding.characterName || `人物${index + 1}`)}${ext}`;
}

function getExportedCharacterNames() {
  return getCastBindings().map(characterExportName);
}

function buildChatGptChecklist() {
  const characterFiles = getExportedCharacterNames();
  const style = state.styles.find((item) => item.id === state.style);
  const styleLine = state.style === "auto"
    ? "当前为“剧本自动原创”，不用上传风格参考图。"
    : `上传 style-reference/ 中的风格图：${style?.name || state.style}`;
  return `ChatGPT 操作清单

1. 解压刚导出的 ZIP 资源包。
2. 在 ChatGPT 中上传 characters/ 里的角色图：
${characterFiles.length ? characterFiles.map((name) => `   - ${name}`).join("\n") : "   - 未上传角色图"}
3. ${styleLine}
4. 可选上传 references/poster-safe-zone-9x16.png 和 references/poster-safe-zone-3x4.png，帮助模型理解两种画幅的裁切区。
5. 打开 prompt.txt，复制全文发给 ChatGPT；即使在已有历史的对话框中，也必须让 ChatGPT 只依据本资源包生成。
6. 对 ChatGPT 说：请严格读取我上传的人物参考图，按“构图方案数量 × 9:16/3:4”输出。`;
}

function renderChatGptChecklist() {
  const node = $("#chatGptChecklist");
  const characterFiles = getExportedCharacterNames();
  const style = state.styles.find((item) => item.id === state.style);
  const styleText = state.style === "auto"
    ? "剧本自动原创，无需上传风格参考图"
    : `上传 style-reference/ 中的 ${style?.name || "风格参考图"}`;
  node.innerHTML = `<div><b>ChatGPT 操作清单</b><p>导出后按下面顺序上传和粘贴，最稳。</p></div><ol><li>解压刚导出的 ZIP 资源包。</li><li>上传 characters/ 里的角色图：${characterFiles.length ? characterFiles.join("、") : "暂无角色图"}</li><li>${styleText}。</li><li>可选上传 references/ 里的 9:16 与 3:4 安全区规范图。</li><li>打开 prompt.txt，复制全文发给 ChatGPT；已有历史对话也只按本资源包生成。</li><li>要求 ChatGPT 按“构图方案数量 × 9:16/3:4”输出，例如 2 版就是 4 张图。</li></ol><button id="copyChecklist" class="secondary" type="button">复制操作清单</button>`;
  node.classList.remove("hidden");
  $("#copyChecklist").addEventListener("click", async () => {
    await navigator.clipboard.writeText(buildChatGptChecklist());
    toast("操作清单已复制");
  });
}

async function copyChatGptPackage() {
  if (!state.analysis) {
    toast("请先导入并分析剧本");
    return false;
  }
  await navigator.clipboard.writeText(buildChatGptPackage());
  toast("ChatGPT 生成包已复制");
  return true;
}

$("#copyChatGpt").addEventListener("click", copyChatGptPackage);
$("#openChatGpt").addEventListener("click", async (event) => {
  event.preventDefault();
  if (await copyChatGptPackage()) window.open("https://chatgpt.com/", "_blank", "noopener");
});

async function addFetchedZipAsset(zip, source, target) {
  try {
    const response = await fetch(source);
    if (!response.ok) return;
    zip.file(target, await response.blob());
  } catch (_error) {
    // Reference assets are useful but not required for ChatGPT generation.
  }
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
    link.remove();
  }, 60000);
}

async function exportChatGptPackageLocally() {
  if (!window.JSZip) throw new Error("打包组件未加载，请刷新页面后重试。");
  const zip = new window.JSZip();
  const bindings = getCastBindings();
  const title = state.analysis.title || "短剧海报项目";
  const style = state.styles.find((item) => item.id === state.style);
  const exportedBindings = bindings.map((binding, index) => ({
    characterName: binding.characterName,
    role: binding.role,
    originalName: binding.originalName,
    exportName: characterExportName(binding, index),
  }));

  const guide = `# ${title} - ChatGPT Image 生成包

## 使用方式
1. 打开 ChatGPT。
2. 上传本包中的 \`characters/\` 人物参考图。
3. 如选择了具体风格，也上传 \`style-reference/\` 中的风格图。
4. 可选上传 \`references/\` 中的 9:16 与 3:4 安全区规范图，帮助 ChatGPT 理解裁切区。
5. 复制 \`prompt.txt\` 的全文发给 ChatGPT；即使在已有历史的对话框中，也必须让 ChatGPT 只依据本资源包生成。
6. 要求 ChatGPT 分别生成 9:16 和 3:4 两套图。

## 上下文隔离
${MEMORY_ISOLATION_PROMPT}

## 人物图映射
${exportedBindings.length ? exportedBindings.map((item, index) => `图${index + 1}：${item.characterName || `人物${index + 1}`}；原文件：${item.originalName || "未命名"}`).join("\n") : "未上传人物参考图。"}
`;

  zip.file("README.md", guide);
  zip.file("prompt.txt", buildChatGptPackage());
  zip.file("metadata.json", JSON.stringify({
    title,
    styleId: state.style,
    ratios: ["9:16", "3:4"],
    bindings: exportedBindings,
    exportMode: "browser-local",
  }, null, 2));

  bindings.forEach((binding, index) => {
    zip.file(`characters/${exportedBindings[index].exportName}`, binding.file);
  });

  await addFetchedZipAsset(zip, "/assets/poster-safe-zone.png", "references/poster-safe-zone-9x16.png");
  await addFetchedZipAsset(zip, "/assets/poster-safe-zone-3x4.png", "references/poster-safe-zone-3x4.png");
  if (style && state.style !== "auto") {
    const refs = style.refs?.length ? style.refs : (style.thumb ? [style.thumb] : []);
    await Promise.all(refs.map((source, index) => {
      const ext = source.match(/\.[a-z0-9]+$/i)?.[0] || ".jpg";
      return addFetchedZipAsset(zip, source, `style-reference/${String(index + 1).padStart(2, "0")}-${safeZipName(style.name)}${ext}`);
    }));
  }

  const blob = await zip.generateAsync({ type: "blob", compression: "STORE" });
  downloadBlob(blob, `${safeZipName(title)}-ChatGPT生成包.zip`);
}

$("#exportChatGpt").addEventListener("click", async () => {
  if (!state.analysis) return toast("请先导入并分析剧本");
  if (state.cast.length > 20) return toast("人物参考图最多 20 张，请减少后再导出");
  const totalSize = state.cast.reduce((sum, file) => sum + file.size, 0);
  if (totalSize > 300 * 1024 * 1024) return toast("人物图总大小超过 300MB，请压缩后再导出资源包");
  loading(true, "正在整理 ChatGPT 资源包", "在浏览器本地打包，不上传人物图…");
  try {
    await exportChatGptPackageLocally();
    renderChatGptChecklist();
    toast("资源包已导出");
  } catch (error) {
    toast(error.message);
  } finally {
    loading(false);
  }
});

$("#generateBtn").addEventListener("click", async () => {
  if (!state.analysis) return toast("请先导入并分析剧本");
  if (state.generationMode !== "api") return toast("当前为 ChatGPT 手动模式，请复制或导出生成包后在 ChatGPT 中生成");
  if (!getUserApiKey()) return toast("请先填写你的 OpenAI API Key");
  const form = new FormData();
  form.append("prompt", $("#prompt").value); form.append("variants", $("#variants").value); form.append("title", state.analysis.title);
  form.append("characterNames", JSON.stringify(getCastBindings().map((binding) => binding.characterName)));
  appendApiKey(form);
  state.cast.forEach((file) => form.append("characters", file));
  loading(true, "正在生成电影级海报", "构图、光影与人物一致性正在同步完成…");
  try {
    const data = await jsonFetch("/api/generate", { method: "POST", body: form });
    $("#resultGrid").innerHTML = data.images.map((image, index) => {
      const ratio = image.ratio || "9:16";
      const variant = image.variant || Math.floor(index / 2) + 1;
      return `<article class="poster"><img src="${image.url}" alt="方案 ${variant} · ${ratio} 海报"><div class="poster-actions"><span>方案 ${String(variant).padStart(2, "0")} · ${ratio}</span><a href="${image.url}" download="${state.analysis.title}-方案${variant}-${ratio.replace(":", "x")}.png">下载原图 ↓</a></div></article>`;
    }).join("");
    go("resultPanel");
    if (data.demo) toast("当前为视觉演示图，连接 API 后生成正式成片");
  } catch (error) {
    toast(error.message.includes("quota") || error.message.includes("额度") ? "API额度不足，请使用 ChatGPT 手动生成模式" : error.message);
  } finally { loading(false); }
});
