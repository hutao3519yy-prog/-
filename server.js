import "dotenv/config";
import express from "express";
import multer from "multer";
import mammoth from "mammoth";
import JSZip from "jszip";
import OpenAI, { toFile } from "openai";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const app = express();
const port = Number(process.env.PORT || 3000);
const isVercel = Boolean(process.env.VERCEL);
const uploadDir = isVercel ? path.join(os.tmpdir(), "poster-studio-uploads") : path.resolve("uploads");
await fs.mkdir(uploadDir, { recursive: true });

const MAX_UPLOAD_FILES = 20;
const MAX_CHARACTER_FILES = 20;
const MAX_FILE_SIZE = 60 * 1024 * 1024;
const MAX_EXPORT_TOTAL_SIZE = 90 * 1024 * 1024;

const upload = multer({
  dest: uploadDir,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_UPLOAD_FILES },
});
app.use(express.json({ limit: "2mb" }));
app.use(express.static("public"));

const TITLE_SAFE_PROMPT = "剧名安全区硬约束：剧名完整外接框必须全部位于纵向58%-74%的中央标题区内，包含文字、描边、投影、发光、花纹、下划线和装饰笔画；剧名最上边不得高于58%，最下边不得低于74%，并且必须与78%数据裁切区至少保留4%画布高度缓冲。横向完整外接框必须位于画布中央70%宽度内，左右各至少15%留边。长剧名必须自动缩小字号、压缩字距或拆成2-3行，宁可缩小也绝不能越过安全区。禁止任何标题文字、英文副标题、装饰线、Logo或随机文案进入顶部0%-15.6%、底部78%-100%或左右安全边距外。";
const SAFE_ZONE = `9:16画面严格服从平台裁切规范。纵向0%-12.8%为顶部图片裁切区，只能放低对比度背景延展，禁止人物面部、剧名、标语和Logo；12.8%-15.6%为过渡警戒带，任何文案不得向上越过15.6%边界；15.6%-78.0%为封面信息安全区，人物面部、核心身体语言、剧名和主要情绪线索必须完整位于其中；78.0%-87.2%为数据裁切区，只保留可牺牲的背景或平台后期叠加信息；87.2%-100%为底部图片裁切区，禁止核心信息。横向核心信息限制在画布中央75%宽度内，左右各保留12.5%呼吸边距。${TITLE_SAFE_PROMPT}`;
const SAFE_ZONE_3X4 = `3:4画面严格服从平台裁切规范。纵向0%-12.8%为顶部图片裁切区，只能放低对比度背景延展，禁止人物面部、剧名、标语和Logo；12.8%-15.6%为文案上边界警戒带，任何文案不得超过15.6%边界；15.6%-78.0%为封面信息安全区，人物面部、核心身体语言、剧名和主要情绪线索必须完整位于其中；78.0%-87.2%为数据裁切区，只保留可牺牲背景或平台后期叠加信息；87.2%-100%为底部图片裁切区，禁止核心信息。横向核心信息限制在画布中央75%宽度内，左右各保留12.5%呼吸边距。${TITLE_SAFE_PROMPT}`;
const PLATFORM_SAFE_ZONES = `${SAFE_ZONE}\n${SAFE_ZONE_3X4}`;
const ASPECT_PROMPT = `必须分别输出两套画幅：第一套为9:16竖版短剧封面；第二套为3:4竖版海报。两套图保持同一人物身份、剧名、视觉风格和核心叙事，但需要针对画幅重新构图，不要简单裁切。9:16与3:4都必须按各自安全区规范排布，顶部图片裁切区与底部图片裁切区只能放可牺牲背景，3:4版本也必须把人物面部、剧名和核心情绪线索完整放入15.6%-78.0%的封面信息安全区。`;
const QUALITY_PROMPT = "真人实拍电影海报质感，极致真人写实，超写实摄影，不要CG渲染感。保持竖版海报画幅，但使用变形宽银幕电影质感：IMAX胶片摄影机质感，Panavision C系列变形镜头观感，真实摄影棚或实景置景灯光，电影胶片颗粒，真实镜头眩光，真实景深，真实皮肤毛孔、细小瑕疵、汗毛、发丝和织物纹理；面部不能油腻、不能蜡像、不能塑料皮、不能过度磨皮，皮肤高光必须像真实摄影反光而不是3D材质；杜绝游戏CG感、动画感、二次元感、廉价影楼感、AI网红精修感、过度锐化、假HDR、假散景、油画感、硅胶脸、手指变形和AI伪影。";
const INTEGRATION_PROMPT = "人物必须自然融入同一个真实空间，绝对不要像后期P图、抠图贴上去或廉价合成；每个人物都要接受同一主光源、环境反射光和色温影响，脸部、头发、肩颈、衣物边缘有合理明暗过渡；脚下、身体后方、人物交叠处和道具接触处必须有接触阴影、投射阴影、遮挡关系与空气透视，边缘不能发白、发硬或出现贴纸感。";
const MEMORY_ISOLATION_PROMPT = "上下文隔离约束：请忽略当前 ChatGPT 对话中此前所有与其他剧本、角色、海报、风格、人物关系、名称、参考图和记忆有关的内容；本次生成只能依据当前资源包内的 prompt.txt、README.md、metadata.json、characters/ 角色图、references/ 安全区图和 style-reference/ 风格图。不得引用、混合、延续或改写旧对话中的人物身份、剧情设定、剧名、视觉风格、构图、角色关系或任何历史记忆；如果旧记忆与当前资源包冲突，必须以当前资源包为唯一准绳。";
const VARIANT_PAIRING_PROMPT = "多版输出规则：生成数量指“构图方案数量”，不是每个比例各自随机变化。每一个构图方案必须输出两张图：一张9:16，一张3:4；如果生成2版海报，总计输出4张图，即方案1的9:16与3:4、方案2的9:16与3:4。不同方案之间必须是明显不同的构图版本；同一方案的9:16与3:4保留同一创意核心和人物关系，但必须针对画幅重新安排人物尺度、标题位置、留白和安全区，不能只是同一张图简单裁切，也不能让两个比例看起来完全同构图。";
const OUTPUT_RATIOS = [
  { id: "9x16", label: "9:16", size: "1080x1920" },
  { id: "3x4", label: "3:4", size: "1200x1600" },
];

const STYLE_PRESETS = [
  { id: "auto", name: "剧本自动原创", tag: "AUTO", group: "Original", thumb: "", refs: [], description: "不套风格库，按剧本气质原创视觉语言", mergedFrom: "独立原创模式", detail: "适合用户不确定风格时使用。系统会根据题材、人物关系、时代背景和核心冲突自动生成视觉语言。", prompt: "已按本次剧本题材、人物关系、情绪张力、时代背景和核心冲突确定原创商业海报视觉语言；画面不套固定模板。" },
  { id: "dark-fantasy", name: "史诗暗黑奇幻", tag: "龙族 · 王权 · 超自然", group: "Fantasy", thumb: "/style-library/12-epic-dark-fantasy.png", refs: ["/style-library/12-epic-dark-fantasy.png", "/style-library/09-dark-fantasy.jpg", "/style-library/05-royal-triangle.jpg"], description: "巨龙/月光/古堡纵深/暗金标题", mergedFrom: "合并：史诗暗黑奇幻、华丽王室、暗黑超自然", detail: "适合龙族、王权、怀孕秘辛、命运契约、奇幻家族和超自然题材。人物以核心双人为前景，反派与阵营人物分布中后景，巨龙、城堡、月光和火星只作为叙事背景，不抢人物脸。", prompt: "真人实拍级史诗暗黑奇幻电影海报，深青黑、银月光、暗金与少量火星微光形成胶片大片质感；巨龙翼影、古堡尖塔、月亮和烟雾像真实电影置景与高端实拍视觉特效，不能像游戏CG或动画渲染。核心人物前景亲密但带危险张力，反派和阵营人物在中后景形成权力包围；华丽金属衬线剧名完整压在安全区下半段，服饰刺绣、皮革、金属与发丝细节必须是摄影级真实质感。" },
  { id: "luxury-ensemble", name: "权力群像黑金", tag: "豪门 · 复仇 · 权谋", group: "Power", thumb: "/style-library/11-luxury-staircase.png", refs: ["/style-library/11-luxury-staircase.png", "/style-library/10-luxury-ensemble.jpg", "/style-library/02-revenge-ensemble.jpg"], description: "阶梯/门框/中轴权力关系", mergedFrom: "合并：暗金豪门群像、复仇剧情拼贴、几何黑金学院", detail: "适合豪门、家族、集团、继承、逆袭复仇和阵营对抗。主角最大，关键关系人物前景对峙，其余人物按权力层级分布在楼梯、门框、长廊或宴会厅纵深中。", prompt: "权力群像黑金商业海报，象牙白、炭黑、香槟金与冷灰玻璃质感；楼梯、门框、长廊、宴会厅或镜面中轴制造权力纵深，主角最大且最清晰，关键关系人物形成前景对峙，其余人物按阵营与身份压力分布中后景；标题采用高可读金属衬线字，奢华但克制。" },
  { id: "intimate-duo", name: "冷调情绪关系", tag: "爱情 · 悬疑 · 虐恋", group: "Emotion", thumb: "/style-library/06-intimate-duo.jpg", refs: ["/style-library/06-intimate-duo.jpg", "/style-library/03-minimal-silhouette.jpg", "/style-library/07-blue-arthouse.jpg"], description: "近景情绪/玻璃反射/压迫留白", mergedFrom: "合并：冷调情绪双人、极简作者电影、深蓝文艺群像", detail: "适合虐恋、真相追查、秘密关系、误会重逢和双人强冲突。以前景脸部或半身情绪作为第一视觉，后景人物通过玻璃、门缝、影子或浅景深制造牵制。", prompt: "冷调情绪关系海报，冷灰、青蓝、雾感暗部与少量暖光形成压迫式电影摄影；前景人物脸部或半身情绪极清晰，另一位关键人物在玻璃反射、门缝、浅景深或后景阴影中呼应，构图克制但情绪浓度高；标题小而精确或压在下半段安全区，负空间服务秘密和关系张力。" },
  { id: "red-collage", name: "复古戏剧拼贴", tag: "背叛 · 爱欲 · 强情节", group: "Drama", thumb: "/style-library/04-collage-romance.jpg", refs: ["/style-library/04-collage-romance.jpg", "/style-library/01-neon-romance.jpg", "/style-library/02-revenge-ensemble.jpg"], description: "巨幅侧脸/场景嵌套/戏剧红", mergedFrom: "合并：复古红调拼贴、霓虹危险浪漫、剧情分镜", detail: "适合背叛、危险关系、强反转、保镖/逃亡/爱欲冲突。可用人物轮廓、场景片段和象征道具组成一张强叙事商业拼贴，但必须保持人物主次和标题清晰。", prompt: "复古戏剧拼贴商业海报，深红、墨黑、橄榄绿或冷霓虹作为情绪色块；巨幅男女侧脸、半身人物与一个关键剧情场景嵌套，撕纸边、光斑或玻璃反射增强戏剧性；人物视线和手部动作必须指向同一冲突，标题高可读并与色块形成层级。" },
  { id: "bright-romance", name: "明亮平台爆款", tag: "校园 · 甜宠 · 轻喜", group: "Bright", thumb: "/style-library/08-bright-romance.jpg", refs: ["/style-library/08-bright-romance.jpg"], description: "高亮色彩/亲密双人/移动端识别", mergedFrom: "合并：明亮甜宠、青春校园、清爽轻喜", detail: "适合校园、甜宠、轻喜、治愈和年轻化题材。画面明亮清爽，人物关系一眼可读，标题粗而干净，保证小屏幕点击率。", prompt: "高明度平台短剧封面，清透环境色与强人物轮廓分离，双主角近距离互动形成直接情感钩子，背景人物或场景运动虚化；粗体无衬线剧名，清晰、快速、移动端高辨识度，甜感但不廉价。" },
];

const OUTPUT_SCHEMA = {
  title: "剧名",
  logline: "一句话卖点",
  genre: "题材类型",
  tone: "情绪与色彩",
  characters: [{ name: "姓名", role: "身份", visual: "视觉关键词", priority: 1 }],
  recommendedMode: "duo 或 ensemble",
  recommendedStyle: "从风格ID中选择",
  prompt: "完整中文图像生成提示词",
};

const NON_CHARACTER_LABELS = new Set([
  "剧名", "片名", "场景", "时间", "地点", "人物", "旁白", "时长", "客厅", "内景", "外景",
  "镜头", "画面", "动作", "字幕", "音效", "道具", "服装", "备注", "白天", "夜晚",
  "景深", "构图", "光影", "色彩", "氛围", "调性", "空间", "背景", "前景", "中景", "远景",
]);
const NON_CHARACTER_PATTERNS = [
  /时长/, /客厅/, /卧室/, /办公室/, /医院/, /酒店/, /内景/, /外景/, /场景/, /地点/, /时间/,
  /镜头/, /运镜/, /运动/, /景深/, /构图/, /画面/, /光影/, /色彩/, /氛围/, /调性/, /背景/,
  /前景/, /中景/, /远景/, /字幕/, /音效/, /道具/, /服装/, /备注/, /旁白/, /台词/,
];

function normalizeName(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[（(].*?[）)]/g, "")
    .replace(/第?[一二三四五六七八九十\d]+[集场幕]/g, "")
    .replace(/[_\-\s]/g, "")
    .trim();
}

function extractCharacterNames(text) {
  const names = [...text.matchAll(/(?:^|\n)\s*([\u4e00-\u9fa5]{2,4})(?:（[^）]*）)?[：:]/g)]
    .map((match) => normalizeName(match[1]))
    .filter(isLikelyCharacterName);
  return [...new Set(names)].slice(0, 8);
}

function isLikelyCharacterName(name = "") {
  const normalized = normalizeName(name);
  if (!normalized || NON_CHARACTER_LABELS.has(normalized)) return false;
  if (NON_CHARACTER_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (/人物$/.test(normalized) && !["男主", "女主"].includes(normalized)) return false;
  return /^[\u4e00-\u9fa5]{2,4}$/.test(normalized);
}

function isUsableBoundCharacterName(name = "") {
  const normalized = normalizeName(name);
  if (!normalized || NON_CHARACTER_LABELS.has(normalized)) return false;
  if (NON_CHARACTER_PATTERNS.some((pattern) => pattern.test(normalized))) return false;
  if (/人物$/.test(normalized) && !["男主", "女主"].includes(normalized)) return false;
  return /^[\u4e00-\u9fa5a-zA-Z0-9]{1,16}$/.test(normalized);
}

function sanitizeCharacters(characters = []) {
  return characters
    .map((character, index) => ({
      ...character,
      name: normalizeName(character?.name),
      priority: character?.priority || index + 1,
    }))
    .filter((character) => isUsableBoundCharacterName(character.name))
    .slice(0, 8);
}

function safeFileName(value = "asset") {
  return normalizeName(value).replace(/[\\/:*?"<>|]/g, "") || "asset";
}

function cleanDramaTitle(value = "") {
  return String(value)
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/^(?:剧名|片名|项目名|名称|标题|剧本名|短剧名)\s*[：:\-—]\s*/i, "")
    .replace(/^[《「“"']+|[》」”"']+$/g, "")
    .replace(/(?:剧本|分集剧本|完整版|终稿|定稿|改稿|修改版|最新版|第?[一二三四五六七八九十\d]+版)$/g, "")
    .replace(/^[《「“"']+|[》」”"']+$/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 32);
}

function isUsefulDramaTitle(value = "") {
  const title = cleanDramaTitle(value);
  if (!title || title.length < 2) return false;
  if (/^(?:第?[一二三四五六七八九十\d]+[集场幕]|正文|目录|人物介绍|故事梗概|剧情梗概|分集大纲)$/i.test(title)) return false;
  if (NON_CHARACTER_PATTERNS.some((pattern) => pattern.test(title))) return false;
  return /[\u4e00-\u9fa5a-zA-Z0-9]/.test(title);
}

function extractTextDramaTitle(text = "") {
  const head = String(text).slice(0, 6000);
  const labeledPatterns = [
    /(?:^|\n)\s*(?:剧名|片名|项目名|名称|标题|剧本名|短剧名)\s*[：:\-—]\s*《([^》\n]{2,40})》/i,
    /(?:^|\n)\s*(?:剧名|片名|项目名|名称|标题|剧本名|短剧名)\s*[：:\-—]\s*([^\n]{2,40})/i,
  ];
  for (const pattern of labeledPatterns) {
    const candidate = head.match(pattern)?.[1];
    if (isUsefulDramaTitle(candidate)) return cleanDramaTitle(candidate);
  }

  const bracketTitle = head.match(/《([^》\n]{2,40})》/)?.[1];
  if (isUsefulDramaTitle(bracketTitle)) return cleanDramaTitle(bracketTitle);

  const lines = head
    .split(/\r?\n/)
    .map((line) => cleanDramaTitle(line))
    .filter(Boolean);
  const firstLine = lines[0] || "";
  const nextLine = lines[1] || "";
  const followedByScriptStructure = /^(?:第?[一二三四五六七八九十\d]+[集场幕]|人物|角色|场景|故事梗概|剧情梗概|分集大纲)/i.test(nextLine);
  if (followedByScriptStructure && isUsefulDramaTitle(firstLine) && firstLine.length <= 24) return firstLine;

  return "";
}

function extractDramaTitle(text = "", fileName = "") {
  const textTitle = extractTextDramaTitle(text);
  if (textTitle) return textTitle;

  const fileTitle = cleanDramaTitle(fileName);
  if (isUsefulDramaTitle(fileTitle)) return fileTitle;

  const fallbackLine = String(text).slice(0, 6000)
    .split(/\r?\n/)
    .map((line) => cleanDramaTitle(line))
    .find((line) => isUsefulDramaTitle(line) && line.length <= 24);
  if (fallbackLine) return fallbackLine;
  return "未命名短剧";
}

function parseJsonField(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function getUserApiKey(req) {
  const headerKey = String(req.get("x-openai-api-key") || "").replace(/^Bearer\s+/i, "").trim();
  const bodyKey = String(req.body?.apiKey || "").replace(/^Bearer\s+/i, "").trim();
  return headerKey || bodyKey;
}

function createUserOpenAI(req) {
  const apiKey = getUserApiKey(req);
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function escapeRegExp(value = "") {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compactLine(value = "") {
  return String(value)
    .replace(/\s+/g, " ")
    .replace(/^[第\d一二三四五六七八九十百千万]+[集场幕]\s*/, "")
    .trim();
}

function stripLineMarkup(value = "") {
  return compactLine(value)
    .replace(/^#{1,6}\s*/, "")
    .replace(/^[\-*•·]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .trim();
}

function isStructuralScriptLine(value = "") {
  const raw = compactLine(value);
  const line = stripLineMarkup(raw);
  if (!line) return true;
  if (/^#{1,6}\s*/.test(raw)) return true;
  if (/^(?:阶段|第?[一二三四五六七八九十\d]+[阶段幕场集])\s*[一二三四五六七八九十\d]*\s*[：:、\-\s]/.test(line)) return true;
  if (/^(?:人物介绍|角色介绍|人物小传|剧情梗概|故事梗概|分集大纲|故事大纲|正文|目录|备注|说明|主题|核心卖点)\s*[：:、\-\s]*$/i.test(line)) return true;
  if (/^(?:人物介绍|角色介绍|人物小传|剧情梗概|故事梗概|分集大纲|故事大纲|正文|目录|备注|说明)\s*[：:、\-]/i.test(line)) return true;
  return false;
}

function cleanStoryBeat(value = "") {
  const line = stripLineMarkup(value)
    .replace(/^(?:核心冲突|视觉瞬间|一句话卖点|海报瞬间|剧情钩子|故事钩子)\s*[：:]\s*/, "")
    .replace(/[“”"]/g, "")
    .trim();
  if (!line || isStructuralScriptLine(value) || isStructuralScriptLine(line)) return "";
  if (/^阶段[一二三四五六七八九十\d]+/.test(line) || /###/.test(line)) return "";
  return line.slice(0, 120);
}

function scoreStoryBeat(line = "") {
  let score = 0;
  if (/(发现|冲进|撞见|抓住|推开|跪|撕|吼|逼问|对峙|僵持|离开|回头|挡住|抱住|扔下|拿出|揭开|藏起|追问|威胁|保护|救|逃|吻|哭|笑|沉默)/.test(line)) score += 5;
  if (/，/.test(line) && /(发现|冲进|撞见|藏起|僵持|推开|揭开|拿出)/.test(line)) score += 3;
  if (/(离婚|背叛|真相|秘密|复仇|反击|威胁|争吵|崩溃|误会|重逢|死亡|继承|夺权|订婚|逃婚|失忆|替身|错嫁|惩戒|背叛)/.test(line)) score += 4;
  if (/[：:]/.test(line)) score += 2;
  if (/[。！？!?]/.test(line)) score += 1;
  if (line.length >= 12 && line.length <= 70) score += 2;
  if (line.length > 90) score -= 2;
  if (/^[\u4e00-\u9fa5]{2,4}[（(][^）)]{2,24}[）)]\s*[：:]/.test(line)) score -= 2;
  return score;
}

function pickStoryBeat(text = "") {
  const candidates = text.split(/\n+/)
    .map(cleanStoryBeat)
    .filter((line) => line.length >= 8 && line.length <= 120);
  if (!candidates.length) return "";
  return candidates
    .map((line, index) => ({ line, index, score: scoreStoryBeat(line) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0].line;
}

function sanitizeStoryValue(value = "", fallback = "") {
  const innerQuote = String(value).match(/[“"]([^”"]{4,120})[”"]/)?.[1];
  const cleaned = cleanStoryBeat(innerQuote || value);
  if (cleaned) return cleaned;
  return cleanStoryBeat(fallback) || fallback || "";
}

function isContaminatedStoryValue(value = "") {
  const text = String(value || "");
  return !text.trim() || /###|^#{1,6}|阶段[一二三四五六七八九十\d]+/.test(text) || isStructuralScriptLine(text);
}

function findCharacterSnippet(text = "", name = "") {
  const index = text.indexOf(name);
  if (index < 0) return "";
  return text.slice(Math.max(0, index - 80), Math.min(text.length, index + 160));
}

function inferCharacterRole(name = "", text = "", index = 0) {
  const escapedName = escapeRegExp(name);
  const bracketMatch = text.match(new RegExp(`${escapedName}\\s*[（(]([^）)]{2,24})[）)]`));
  const bracketRole = normalizeName(bracketMatch?.[1] || "");
  if (bracketRole && !NON_CHARACTER_PATTERNS.some((pattern) => pattern.test(bracketRole))) return bracketRole;

  const line = text.split(/\n+/).find((item) => item.includes(name) && /(身份|角色|人物|男主|女主|父亲|母亲|老板|医生|学生|老师|王爷|皇帝|总裁|妻子|丈夫|前夫|前妻)/.test(item));
  if (line) {
    const cleaned = compactLine(line)
      .replace(new RegExp(`.*?${escapedName}`), "")
      .replace(/^[：:，,、\s-]+/, "")
      .slice(0, 18);
    const role = normalizeName(cleaned);
    if (role && role !== name && !NON_CHARACTER_PATTERNS.some((pattern) => pattern.test(role))) return role;
  }

  if (/男主|男一|男主角/i.test(name)) return "核心男主";
  if (/女主|女一|女主角/i.test(name)) return "核心女主";
  return index === 0 ? "核心主角" : index === 1 ? "关键主角" : "重要人物";
}

function inferCharacterVisual(name = "", text = "", index = 0) {
  const snippet = findCharacterSnippet(text, name);
  const traits = [];
  if (/哭|泪|崩溃|委屈|心碎/.test(snippet)) traits.push("眼神含泪但不失控");
  if (/冷|沉默|克制|隐忍|压抑/.test(snippet)) traits.push("神情克制、情绪压在眼底");
  if (/怒|恨|复仇|报仇|反击|威胁/.test(snippet)) traits.push("目光锋利、带反击感");
  if (/温柔|守护|保护|拥抱|牵手/.test(snippet)) traits.push("姿态带保护欲与情感牵引");
  if (/秘密|真相|隐藏|伪装|身份/.test(snippet)) traits.push("表情带隐藏秘密的复杂感");
  if (/权|豪门|集团|继承|宴会|家族/.test(snippet)) traits.push("服装气质偏正式、利落、有压迫感");
  if (/校园|学生|青春|教室/.test(snippet)) traits.push("气质清爽但有青春冲突");
  if (!traits.length) traits.push(index < 2 ? "表情明确、有强叙事情绪，不做空洞摆拍" : "作为关系张力的一部分，情绪与主线一致");
  return [...new Set(traits)].join("，");
}

function inferStoryProfile(text = "", instruction = "") {
  const material = `${text}\n${instruction}`;
  const conflictLine = pickStoryBeat(text);
  let genre = "短剧情感 / 强冲突叙事";
  if (/豪门|集团|继承|财阀|家族|总裁/.test(material)) genre = "豪门情感 / 权力关系";
  else if (/校园|学生|教室|青春/.test(material)) genre = "青春情感 / 校园关系";
  else if (/王爷|皇帝|太子|宫|妃|侯府|将军/.test(material)) genre = "古装情感 / 权谋关系";
  else if (/命案|凶手|警察|悬疑|调查|失踪|证据/.test(material)) genre = "悬疑情感 / 真相追查";
  else if (/玄幻|龙|魔|异能|穿越|重生|Dragon|King/i.test(material)) genre = "奇幻情感 / 命运反转";

  let tone = "电影感强对比、情绪浓度高、商业海报质感";
  if (/甜|轻喜|欢喜|可爱/.test(material)) tone = "明亮清爽、甜感张力、移动端高辨识度";
  else if (/冷|悬疑|秘密|真相|夜|雨/.test(material)) tone = "冷调压迫、低饱和、强明暗对比";
  else if (/复仇|反击|恨|背叛/.test(material)) tone = "克制高压、锋利反击感、暗部层次强";
  else if (/古装|王爷|宫|将军/.test(material)) tone = "华丽克制、权谋压迫、暖金与深影对撞";

  const logline = conflictLine || "围绕剧本中的核心关系矛盾，抓住主角命运转折的一瞬间。";
  const visualMoment = conflictLine || "选择剧本里人物关系最紧绷的一幕作为海报瞬间，不做无剧情依据的通用摆拍。";
  return { genre, tone, logline, centralConflict: logline, visualMoment };
}

function demoAnalysis(text, instruction = "", fileName = "") {
  const title = extractDramaTitle(text, fileName);
  const profile = inferStoryProfile(text, instruction);
  const characters = extractCharacterNames(text).map((name, index) => ({
    name,
    role: inferCharacterRole(name, text, index),
    visual: inferCharacterVisual(name, text, index),
    priority: index + 1,
  }));
  if (!characters.length) {
    characters.push(
      { name: "男主", role: "核心男主", visual: "面部、发型、服装和气质严格参照同名上传角色图；表情必须根据剧本冲突塑造，不套用固定霸总或继承人人设", priority: 1 },
      { name: "女主", role: "核心女主", visual: "面部、发型、服装和气质严格参照同名上传角色图；表情必须根据剧本冲突塑造，不套用固定千金或复仇人设", priority: 2 },
    );
  }
  return {
    title,
    logline: profile.logline,
    genre: profile.genre,
    tone: profile.tone,
    centralConflict: profile.centralConflict,
    visualMoment: profile.visualMoment,
    characters,
    recommendedMode: characters.length > 2 ? "ensemble" : "duo",
    recommendedStyle: "auto",
    prompt: buildPrompt({ title, characters, instruction, style: "auto", ...profile }),
    demo: true,
  };
}

function characterDirection(char, index, total) {
  if (total <= 2) {
    return index === 0
      ? "站在画面中轴略偏前，肩线微微转向另一位主角，眼神直视镜头或越过镜头形成压迫感；一只手自然垂落或握紧道具/衣角，姿态克制但有情绪爆点"
      : "位于前景侧面或中景反向角度，与人物1形成高低/前后错位；眼神不要空泛，要表现犹疑、对抗、心碎、隐忍或守护中的一种明确情绪";
  }
  if (index === 0) return "最大比例，位于画面中央安全区前景，身体略转，目光最清晰，承担海报第一视觉锚点";
  if (index === 1) return "位于人物1身后半步或斜侧前景，与人物1形成三角关系，表情与人物1存在明显情绪反差";
  if (index === 2) return "位于中景侧后方，尺度小于前两位，通过视线方向、身体朝向或阴影位置表现其与主线的关系";
  return "位于后景或边侧层级，不与主角等大并排，用半身、侧脸或浅景深呈现阵营和压力";
}

function buildVisualExecutionPrompt({ styleLine, genre, tone, centralConflict, visualMoment, selected }) {
  const material = `${genre} ${tone} ${centralConflict} ${visualMoment}`;
  let palette = "低饱和高级综合色彩，暗部有层次，肤色真实，整体克制但移动端辨识度强";
  let light = "单一明确主光源从画面侧前方切入，辅以柔和环境反射光和局部轮廓光";
  let setting = "背景使用与剧情相符的真实空间线索，虚实分层，不堆砌无关道具";
  if (/悬疑|真相|秘密|证据|夜|雨/.test(material)) {
    palette = "冷灰、青蓝与少量暖色警示光对撞，低饱和但高反差";
    light = "窄束侧光、玻璃反射和深阴影包裹人物边缘，制造真相将被揭开的压迫感";
    setting = "可使用病房、走廊、门缝、玻璃、档案或证据线索，但只保留一个核心线索";
  } else if (/甜|青春|校园|清爽/.test(material)) {
    palette = "清透浅色系配少量高辨识强调色，画面明亮但不过曝";
    light = "柔和自然光加清晰轮廓光，让人物关系更亲近但仍有剧情张力";
    setting = "使用教室、操场、窗边或城市日光背景的简化线索";
  } else if (/古装|权谋|王爷|宫|将军/.test(material)) {
    palette = "暖金、绛红、墨黑和玉白形成华丽克制的权谋质感";
    light = "烛光/窗棂光与深影交错，服饰纹理和金属细节清晰";
    setting = "使用宫门、长廊、屏风、帷幔或台阶建立身份压力";
  } else if (/奇幻|龙|玄幻|异能|命运/.test(material)) {
    palette = "深青、银白、暗金与能量高光形成奇幻大片质感";
    light = "真实电影摄影中的逆光轮廓、烟雾空气感和克制特效光统一照亮人物，不做游戏CG式廉价特效堆叠";
    setting = "背景可含天空、王座、裂隙、古堡或仪式空间的实拍级线索，必须服务人物关系";
  } else if (/豪门|权力|家族|集团|继承/.test(material)) {
    palette = "象牙白、炭黑、香槟金与冷灰玻璃质感，奢华但不油腻";
    light = "宴会厅或建筑纵深中的侧逆光，突出阶层压迫和人物轮廓";
    setting = "可使用楼梯、门框、长廊、宴会厅、镜面或建筑中轴制造权力纵深";
  }
  const names = selected.map((char) => char.name).join("、");
  return `已确定视觉语言：${styleLine} 本片按“${genre || "短剧情感"}”与“${tone || "高情绪张力"}”执行，核心画面围绕“${visualMoment || centralConflict || "人物关系爆点"}”。色彩：${palette}。光影：${light}。空间：${setting}。版式：参考海报范例已被转化为可执行规则，${names ? `所有人物仅使用本次角色 ${names}，` : ""}前后景层级清晰，主次比例明确，标题压在安全区下半段，视线和手部姿态都指向同一个剧情冲突。`;
}

function buildLayoutPrompt({ selected, effectiveMode, style, genre, centralConflict, visualMoment }) {
  const count = selected.length;
  const baseMoment = visualMoment || centralConflict || "以已解析出的核心冲突瞬间作为画面中心";
  if (count <= 2 || effectiveMode === "duo") {
    const [lead, second = selected[0]] = selected;
    return `构图方案已确定：双人商业海报。核心画面瞬间是“${baseMoment}”。${lead.name}（${lead.role || "核心人物"}）作为最大视觉锚点，位于安全区中轴略偏前，采用半身或近景，肩线微转、眼神承担主要冲突；${second.name}（${second.role || "关键人物"}）放在侧后方或反向前景，不与${lead.name}等大并排，通过背靠背、擦肩、玻璃反射或门框分隔形成关系牵制。两人脸部都在15.6%-62%安全区内，剧名完整外接框压在58%-74%之间，不遮挡眼睛、嘴和关键手势。人物之间必须有真实前后距离、遮挡关系、共同光源和接触阴影；不要证件照式并排，不要空泛对视。`;
  }
  const ensembleStyle = /豪门|权力|古装|家族/.test(`${genre} ${style}`)
    ? "可使用楼梯、门框、长廊、宴会厅、镜面或建筑中轴制造权力纵深"
    : "可使用玻璃反射、门缝、光影分层、场景剪影或关系线索制造叙事纵深";
  const lead = selected[0];
  const second = selected[1];
  const rest = selected.slice(2).map((char) => char.name).join("、");
  return `构图方案已确定：多人群像商业海报。核心画面瞬间是“${baseMoment}”。${lead.name}（${lead.role || "核心人物"}）必须最大且最清晰，位于画面中央安全区前景；${second?.name || "关键人物"}${second ? `（${second.role || "关键人物"}）` : ""}与${lead.name}形成前景对峙或守护关系，身体朝向和眼神方向必须互相牵制；${rest || "其余人物"}按阵营和关系压力分布在中后景，不能与主角等大。${ensembleStyle}。每个人物都要有明确视线方向、手部动作和姿态目的；采用金字塔/三角形层级、人物尺度差、遮挡关系、标题压位和负空间控制，绝不生成随机站队群像。`;
}

function compositionVariantGuide(index = 0, total = 1) {
  const guides = [
    "方案1：情绪近景版。以核心人物脸部和上半身情绪为第一视觉，人物前后景错位，标题压在下半段，画面张力来自眼神、肩线和暗部空间。",
    "方案2：关系对峙版。拉开人物距离，用门框、长廊、玻璃、阴影或空间纵深制造对抗关系，人物身体朝向互相牵制，标题嵌入两人之间的负空间。",
    "方案3：叙事场景版。加入一个与剧情相关但不喧宾夺主的场景线索，人物不并排，前景人物清晰、后景人物带压迫或守护感，标题与场景透视结合。",
    "方案4：强商业群像版。强化人物层级和阵营关系，主角最大且最清晰，其余人物以尺度差、视线方向和浅景深形成关系网，标题稳定压住画面重心。",
  ];
  return guides[index % guides.length].replace(/方案\d+/, `方案${index + 1}/${total}`);
}

function buildPrompt({ title, characters, instruction = "", mode = "auto", style = "auto", logline = "", genre = "", tone = "", centralConflict = "", visualMoment = "" }) {
  const cleanCharacters = sanitizeCharacters(characters);
  const promptCharacters = cleanCharacters.length ? cleanCharacters : [
    { name: "男主", role: "核心男主", visual: "根据上传人物参考图保持面孔、发型、服装气质；具体情绪由剧本冲突决定", priority: 1 },
    { name: "女主", role: "核心女主", visual: "根据上传人物参考图保持面孔、发型、服装气质；具体情绪由剧本冲突决定", priority: 2 },
  ];
  const effectiveMode = mode === "auto" && promptCharacters.length > 2 ? "ensemble" : mode;
  const selected = effectiveMode === "duo" ? promptCharacters.slice(0, 2) : promptCharacters;
  const cast = selected.map((char, index) =>
    `人物${index + 1}：${char.name}（${char.role || "剧本角色"}）。外貌与服装：${char.visual || "严格参照对应上传角色图"}。站位/姿势/表情：${characterDirection(char, index, selected.length)}。面部、发型、服装和气质必须严格参照对应上传图片。`
  ).join("\n");
  const preset = STYLE_PRESETS.find((item) => item.id === style) || STYLE_PRESETS[0];
  const styleLine = style === "auto" ? STYLE_PRESETS[0].prompt : preset.prompt;
  const safeLogline = sanitizeStoryValue(logline, "围绕剧本中的核心关系矛盾，抓住主角命运转折的一瞬间。");
  const safeConflict = sanitizeStoryValue(centralConflict, safeLogline);
  const safeVisualMoment = sanitizeStoryValue(visualMoment, safeConflict || safeLogline);
  const visualExecution = buildVisualExecutionPrompt({ styleLine, genre, tone, centralConflict: safeConflict, visualMoment: safeVisualMoment, selected });
  const layout = buildLayoutPrompt({ selected, effectiveMode, style, genre, centralConflict: safeConflict, visualMoment: safeVisualMoment });
  const storyLine = [
    genre ? `题材：${genre}` : "",
    tone ? `情绪色彩：${tone}` : "",
    safeLogline ? `一句话卖点：${safeLogline}` : "",
    safeConflict ? `核心冲突：${safeConflict}` : "",
  ].filter(Boolean).join("；");
  return `短剧宣发海报，大师级商业成片，极致简约且高级，绝对不要呈现普通电影剧照感，也不要做成角色证件照或简单拼贴。

一、上下文隔离
${MEMORY_ISOLATION_PROMPT}

二、画幅与平台安全区
画幅要求：${ASPECT_PROMPT}
${VARIANT_PAIRING_PROMPT}
平台安全规范：${PLATFORM_SAFE_ZONES}

三、已解析剧本依据
${storyLine || "必须依据用户上传剧本中的人物关系、情绪冲突和场景线索生成，不得套用固定豪门/复仇模板。"}
海报只表现一个最强叙事瞬间：${safeVisualMoment || safeConflict || "已解析出的核心关系转折一刻"}。不要堆砌无关道具，不要添加当前剧本依据之外的新身份、新职业或新关系。

四、视觉语言与版式执行
${visualExecution}

五、构图执行
${layout}
构图必须明确执行，不要留给模型自由发挥成随机群像。人物不能漂浮、不能抠图贴上去、不能所有人同光同姿势站成一排。

六、人物映射与表演指令
${cast}

七、光影、材质与真实融合
光影与材质：电影级强烈明暗对比（chiaroscuro），克制的综合色彩，局部轮廓光，精细真实的皮肤、织物与环境纹理，深邃空间层次；${QUALITY_PROMPT}
人物融合真实感：${INTEGRATION_PROMPT}

八、文字与排版
只生成准确剧名“${title}”。${TITLE_SAFE_PROMPT} 字形准确、易读并与所选视觉语言一致；标题可以与人物前后层次产生轻微遮挡关系，但绝不能遮挡眼睛、嘴、关键手势。除剧名外不生成随机文字、虚构奖项、品牌Logo或水印。

九、负面约束
不要生成无关角色；不要改名、换脸、交换人物关系；不要平均分配人物大小；不要普通剧照感；不要廉价合成；不要随机英文；不要错误汉字；不要游戏CG感、动画感、二次元感、廉价影楼感、油腻蜡像皮肤、塑料皮肤、过度磨皮、AI网红脸。

${instruction ? `十、额外创作指令\n${instruction}\n\n` : ""}输出：分别生成9:16与3:4两版，高精度商业海报。两版保持同一人物身份、剧名、视觉风格和核心叙事，但必须针对画幅重新安排构图，不要简单裁切。`;
}

async function cleanup(files = []) {
  await Promise.all(files.filter(Boolean).map((file) => fs.unlink(file.path).catch(() => {})));
}

function canUseLocalFallback(error) {
  const message = `${error?.message || ""} ${error?.code || ""} ${error?.type || ""}`.toLowerCase();
  return error?.status === 429
    || message.includes("quota")
    || message.includes("timeout")
    || message.includes("connection");
}

app.get("/api/status", (_req, res) => {
  res.json({
    configured: false,
    manualMode: true,
    userApiRequired: true,
    imageModel: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2",
    textModel: process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini",
  });
});

app.get("/api/styles", (_req, res) => res.json({ styles: STYLE_PRESETS.map(({ prompt, ...style }) => style) }));

app.post("/api/analyze", upload.single("script"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "请上传 Word 剧本。" });
    if (!/\.docx?$/i.test(req.file.originalname)) {
      return res.status(400).json({ error: "目前支持 .docx 和 .doc 文件，建议使用 .docx。" });
    }
    let text;
    try {
      ({ value: text } = await mammoth.extractRawText({ path: req.file.path }));
    } catch {
      return res.status(400).json({ error: "无法读取该 Word 文件，请另存为 .docx 后重试。" });
    }
    text = text.trim().slice(0, 120000);
    if (!text) return res.status(400).json({ error: "文档中没有可读取的剧本文字。" });
    const openai = createUserOpenAI(req);
    if (!openai) {
      return res.json({
        ...demoAnalysis(text, req.body.instruction, req.file.originalname),
        manualMode: true,
        apiWarning: "当前为 ChatGPT 手动生成模式；如需 API 深度分析，请在网页中切换 API 模式并填写自己的 API Key。",
      });
    }

    try {
      const response = await openai.responses.create({
        model: process.env.OPENAI_TEXT_MODEL || "gpt-5.4-mini",
        input: [
          { role: "system", content: `你是短剧营销总监和电影海报视觉导演。深读剧本，提炼剧名、核心冲突、人物关系、人物视觉气质和最具点击率的海报构图。不要编造剧本没有的关键事实，严禁把所有剧本都套成“财阀千金、复仇继承人、霸总、千金”模板。characters 只能包含真实角色姓名，角色身份必须来自剧本或明确上下文，严禁把“时长、场景、客厅人物、镜头运动、景深、构图、画面、光影、服装、道具”等技术字段或场景字段当成人物。请从这些风格ID中推荐一个：${STYLE_PRESETS.filter(s => s.id !== "auto").map(s => `${s.id}(${s.tag})`).join("、")}。最终必须输出严格JSON，结构为：${JSON.stringify(OUTPUT_SCHEMA)}。` },
          { role: "user", content: `用户补充要求：${req.body.instruction || "无"}\n\n剧本全文：\n${text}` },
        ],
        text: { format: { type: "json_object" } },
      });
      const analysis = JSON.parse(response.output_text);
      const textTitle = extractTextDramaTitle(text);
      const fileTitle = cleanDramaTitle(req.file.originalname);
      const fallbackTitle = textTitle || (isUsefulDramaTitle(fileTitle) ? fileTitle : extractDramaTitle(text, req.file.originalname));
      analysis.title = fallbackTitle || cleanDramaTitle(analysis.title) || "未命名短剧";
      const localProfile = inferStoryProfile(text, req.body.instruction || "");
      const contaminatedProfile = [analysis.logline, analysis.centralConflict, analysis.visualMoment].some(isContaminatedStoryValue);
      analysis.logline = sanitizeStoryValue(analysis.logline, localProfile.logline) || localProfile.logline;
      analysis.genre = contaminatedProfile ? localProfile.genre : (analysis.genre || localProfile.genre);
      analysis.tone = contaminatedProfile ? localProfile.tone : (analysis.tone || localProfile.tone);
      analysis.centralConflict = sanitizeStoryValue(analysis.centralConflict, localProfile.centralConflict) || analysis.logline;
      analysis.visualMoment = sanitizeStoryValue(analysis.visualMoment, localProfile.visualMoment) || analysis.centralConflict;
      analysis.characters = sanitizeCharacters(analysis.characters || []).map((character, index) => ({
        ...character,
        role: character.role || inferCharacterRole(character.name, text, index),
        visual: character.visual || inferCharacterVisual(character.name, text, index),
        priority: character.priority || index + 1,
      }));
      analysis.prompt = buildPrompt({ ...analysis, title: analysis.title, instruction: req.body.instruction || "" });
      res.json(analysis);
    } catch (error) {
      if (!canUseLocalFallback(error)) throw error;
      console.warn("OpenAI analyze failed, using local fallback:", error?.message || error);
      res.json({
        ...demoAnalysis(text, req.body.instruction, req.file.originalname),
        manualMode: true,
        apiWarning: "OpenAI API 当前不可用，已切换为 ChatGPT 手动生成模式。",
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "剧本分析失败。" });
  } finally {
    await cleanup(req.file ? [req.file] : []);
  }
});

app.post("/api/prompt", (req, res) => {
  const { title, characters = [], instruction = "", mode = "auto", style = "auto", logline = "", genre = "", tone = "", centralConflict = "", visualMoment = "" } = req.body;
  res.json({ prompt: buildPrompt({ title: title || "未命名短剧", characters, instruction, mode, style, logline, genre, tone, centralConflict, visualMoment }) });
});

app.post("/api/generate", upload.array("characters", 8), async (req, res) => {
  try {
    const prompt = String(req.body.prompt || "").trim();
    const variants = Math.min(Math.max(Number(req.body.variants) || 1, 1), 4);
    if (!prompt) return res.status(400).json({ error: "生成提示词不能为空。" });
    const openai = createUserOpenAI(req);
    if (!openai) {
      return res.status(409).json({ error: "当前为 ChatGPT 手动生成模式；如需直接 API 生图，请在网页中切换 API 模式并填写自己的 OpenAI API Key。" });
    }
    const imageFiles = await Promise.all((req.files || []).map(async (file) =>
      toFile(await fs.readFile(file.path), file.originalname, { type: file.mimetype })
    ));
    const characterNames = parseJsonField(req.body.characterNames, []);
    const imageMap = imageFiles.length
      ? `\n人物参考图映射（必须严格遵守）：${imageFiles.map((_, i) => `图${i + 1} = ${characterNames[i] || `人物${i + 1}`}`).join("；")}。不得交换人物面孔、性别或服装。`
      : "";
    const tasks = Array.from({ length: variants }).flatMap((_, variantIndex) => OUTPUT_RATIOS.map(async (ratio) => {
      const finalPrompt = `${prompt}${imageMap}
${VARIANT_PAIRING_PROMPT}
构图方案指令：${compositionVariantGuide(variantIndex, variants)}
当前输出：方案${variantIndex + 1}/${variants}的${ratio.label}版本。必须与同方案另一比例共享同一创意核心和人物关系，但要按${ratio.label}画幅重新安排人物尺度、标题位置、留白和安全区；不同方案之间必须是明显不同的构图。不得简单裁切，不得让9:16与3:4完全同构图。
人物融合真实感：${INTEGRATION_PROMPT}
画质强制要求：${QUALITY_PROMPT}`;
      const result = imageFiles.length
        ? await openai.images.edit({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", image: imageFiles, prompt: finalPrompt, size: ratio.size, quality: "high" })
        : await openai.images.generate({ model: process.env.OPENAI_IMAGE_MODEL || "gpt-image-2", prompt: finalPrompt, size: ratio.size, quality: "high" });
      const image = result.data?.[0];
      return { ratio: ratio.label, variant: variantIndex + 1, url: image.url || `data:image/png;base64,${image.b64_json}` };
    }));
    res.json({ images: await Promise.all(tasks) });
  } catch (error) {
    console.error(error);
    const status = error?.status === 429 ? 429 : 500;
    const manualHint = status === 429 ? "API额度不足，请使用 ChatGPT 手动生成模式。" : "";
    res.status(status).json({ error: `${error?.message || "海报生成失败。"}${manualHint ? ` ${manualHint}` : ""}` });
  } finally {
    await cleanup(req.files || []);
  }
});

app.post("/api/export-chatgpt-package", upload.array("characters", MAX_CHARACTER_FILES), async (req, res) => {
  try {
    const body = req.body || {};
    const prompt = String(body.prompt || "").trim();
    const title = String(body.title || "短剧海报项目").trim();
    const styleId = String(body.style || "auto");
    const bindings = parseJsonField(body.bindings, []);
    if (!prompt) return res.status(400).json({ error: "导出前请先生成导演提示词。" });
    if ((req.files || []).length > MAX_CHARACTER_FILES) {
      return res.status(400).json({ error: `人物参考图最多 ${MAX_CHARACTER_FILES} 张，请减少后再导出。` });
    }
    const totalUploadSize = (req.files || []).reduce((sum, file) => sum + (file.size || 0), 0);
    if (totalUploadSize > MAX_EXPORT_TOTAL_SIZE) {
      return res.status(413).json({ error: "人物图总大小超过 90MB。请先压缩图片，公网导出会更稳定。" });
    }

    const zip = new JSZip();
    const safeTitle = safeFileName(title);
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
${bindings.length ? bindings.map((item, index) => `图${index + 1}：${item.characterName || `人物${index + 1}`}；原文件：${item.originalName || "未命名"}`).join("\n") : "未上传人物参考图。"}
`;
    zip.file("README.md", guide);

    for (const [index, file] of (req.files || []).entries()) {
      const binding = bindings[index] || {};
      const ext = path.extname(file.originalname) || ".png";
      const exportName = `${String(index + 1).padStart(2, "0")}-${safeFileName(binding.characterName || `人物${index + 1}`)}${ext}`;
      zip.file(`characters/${exportName}`, await fs.readFile(file.path));
      binding.exportName = exportName;
    }

    const chatPrompt = `请使用 GPT Image 生成短剧海报，并严格读取我上传的参考图。

${MEMORY_ISOLATION_PROMPT}

必须分别输出两套画幅：
1. 9:16 竖版短剧封面
2. 3:4 竖版海报

人物参考图映射如下，必须严格保持人物面孔、性别、发型、服装气质一致，不要交换角色：
${bindings.length ? bindings.map((item, index) => `图${index + 1}：${item.characterName || `人物${index + 1}`}；参考文件：${item.exportName || item.originalName || "未命名"}`).join("\n") : "未上传人物参考图。"}

如果我同时上传了风格参考图，只提取构图、色彩、光影和排版气质，不要复制参考图中的人物、品牌、文字或具体画面。

人物融合真实感：
${INTEGRATION_PROMPT}

导演提示词：
${prompt}`;

    zip.file("prompt.txt", chatPrompt);
    zip.file("metadata.json", JSON.stringify({ title, styleId, ratios: OUTPUT_RATIOS.map((ratio) => ratio.label), bindings }, null, 2));

    const safeZone9x16Path = path.resolve("public/assets/poster-safe-zone.png");
    const safeZone3x4Path = path.resolve("public/assets/poster-safe-zone-3x4.png");
    zip.file("references/poster-safe-zone-9x16.png", await fs.readFile(safeZone9x16Path).catch(() => Buffer.from("")));
    zip.file("references/poster-safe-zone-3x4.png", await fs.readFile(safeZone3x4Path).catch(() => Buffer.from("")));

    const style = STYLE_PRESETS.find((item) => item.id === styleId);
    if (style && style.id !== "auto") {
      const refs = style.refs?.length ? style.refs : (style.thumb ? [style.thumb] : []);
      for (const [index, source] of refs.entries()) {
        const thumbPath = path.resolve("public", source.replace(/^\//, ""));
        const ext = path.extname(source) || ".jpg";
        zip.file(`style-reference/${String(index + 1).padStart(2, "0")}-${safeFileName(style.name)}${ext}`, await fs.readFile(thumbPath));
      }
    }

    const buffer = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(`${safeTitle}-ChatGPT生成包.zip`)}"`);
    res.send(buffer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error?.message || "导出生成包失败。" });
  } finally {
    await cleanup(req.files || []);
  }
});

app.get("/api/demo-poster", (req, res) => {
  const title = (cleanDramaTitle(req.query.title) || "未命名短剧").slice(0, 20);
  const variant = Number(req.query.v || 1);
  const palettes = [["#07090d", "#7b2027"], ["#071114", "#1b5460"], ["#100d13", "#4e294d"]];
  const [a, b] = palettes[(variant - 1) % palettes.length];
  const safeTitle = title.replace(/[<>&'\"]/g, "");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1792" viewBox="0 0 1024 1792"><defs><radialGradient id="g"><stop stop-color="${b}"/><stop offset="1" stop-color="${a}"/></radialGradient><filter id="blur"><feGaussianBlur stdDeviation="34"/></filter></defs><rect width="1024" height="1792" fill="url(#g)"/><circle cx="512" cy="720" r="380" fill="#fff" opacity=".05" filter="url(#blur)"/><path d="M230 1320 Q255 590 510 410 Q765 590 794 1320Z" fill="#050609" opacity=".82"/><ellipse cx="510" cy="540" rx="175" ry="220" fill="#202126"/><path d="M375 560 Q510 640 650 560 L610 980 L405 980Z" fill="#0b0c10"/><text x="512" y="1070" text-anchor="middle" fill="#f5f0e8" font-size="92" font-family="serif" letter-spacing="12">${safeTitle}</text><line x1="335" y1="1120" x2="689" y2="1120" stroke="#b68c59"/><text x="512" y="1180" text-anchor="middle" fill="#c4bbaa" font-size="20" font-family="sans-serif" letter-spacing="8">A SHORT DRAMA ORIGINAL</text><text x="512" y="1680" text-anchor="middle" fill="#fff" opacity=".35" font-size="20" font-family="sans-serif">DEMO PREVIEW · CONNECT API FOR FINAL ART</text></svg>`;
  res.type("image/svg+xml").send(svg);
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    let message = `上传失败：${error.message}`;
    if (error.code === "LIMIT_FILE_SIZE") {
      message = "上传失败：单个文件超过 60MB，请压缩人物图后重试。";
    } else if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
      message = "上传失败：文件数量过多，人物参考图一次最多上传 20 张。";
    }
    return res.status(400).json({ error: message });
  }
  res.status(500).json({ error: "服务器出现异常。" });
});

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  const host = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");
  const server = app.listen(port, host, () => console.log(`Poster Studio: http://${host}:${port}`));
  server.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}

export { cleanDramaTitle, extractDramaTitle, demoAnalysis };
export default app;
