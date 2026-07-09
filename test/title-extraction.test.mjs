import test from "node:test";
import assert from "node:assert/strict";
import { cleanDramaTitle, demoAnalysis, extractDramaTitle } from "../server.js";

test("extracts labeled drama title", () => {
  assert.equal(extractDramaTitle("剧名：《春风不渡旧情人》\n第一集"), "春风不渡旧情人");
});

test("extracts bracket drama title when there is no label", () => {
  assert.equal(extractDramaTitle("《她从火光中回头》\n人物：林晚"), "她从火光中回头");
});

test("extracts first useful title line", () => {
  assert.equal(extractDramaTitle("错嫁后我手撕豪门\n第1集\n场景：客厅"), "错嫁后我手撕豪门");
});

test("falls back to uploaded file name", () => {
  assert.equal(extractDramaTitle("第1集\n场景：办公室", "回到爸妈十七岁.docx"), "回到爸妈十七岁");
});

test("prefers file name when script body has no explicit title", () => {
  assert.equal(extractDramaTitle("第一场\n林晚走进办公室\n她停在门口。", "离婚后我继承亿万家产.docx"), "离婚后我继承亿万家产");
});

test("does not use old demo title fallback", () => {
  const analysis = demoAnalysis("第1集\n场景：办公室", "", "我的短剧.docx");
  assert.equal(analysis.title, "我的短剧");
  assert.ok(!analysis.prompt.includes("逆光之下"));
});

test("does not inject fixed rich-family revenge identities", () => {
  const analysis = demoAnalysis("第1集\n场景：办公室", "", "普通爱情故事.docx");
  assert.ok(!analysis.characters.some((character) => ["财阀千金", "复仇继承人"].includes(character.role)));
  assert.ok(!analysis.prompt.includes("财阀千金"));
  assert.ok(!analysis.prompt.includes("复仇继承人"));
});

test("infers character role from script instead of template defaults", () => {
  const analysis = demoAnalysis("剧名：《白色病房》\n林晚（外科医生）：我不能让他再隐瞒真相。\n周屿（记者）：证据就在这里。", "", "白色病房.docx");
  assert.equal(analysis.characters[0].name, "林晚");
  assert.equal(analysis.characters[0].role, "外科医生");
  assert.match(analysis.prompt, /人物1：林晚（外科医生）/);
  assert.match(analysis.prompt, /已确定视觉语言/);
  assert.match(analysis.prompt, /站位\/姿势\/表情/);
});

test("adds memory isolation constraint to prompt", () => {
  const analysis = demoAnalysis("剧名：《白色病房》\n林晚（外科医生）：我不能让他再隐瞒真相。", "", "白色病房.docx");
  assert.match(analysis.prompt, /上下文隔离约束/);
  assert.match(analysis.prompt, /忽略当前 ChatGPT 对话中此前所有/);
});

test("does not mention episode badge placement", () => {
  const analysis = demoAnalysis("剧名：《白色病房》\n林晚（外科医生）：我不能让他再隐瞒真相。", "", "白色病房.docx");
  assert.ok(!analysis.prompt.includes("EP集数徽标"));
  assert.ok(!analysis.prompt.includes("17.7%-22.5%"));
});

test("defines variants as paired composition plans", () => {
  const analysis = demoAnalysis("剧名：《白色病房》\n林晚（外科医生）：我不能让他再隐瞒真相。", "", "白色病房.docx");
  assert.match(analysis.prompt, /生成数量指“构图方案数量”/);
  assert.match(analysis.prompt, /每一个构图方案必须输出两张图/);
  assert.match(analysis.prompt, /不能只是同一张图简单裁切/);
});

test("cleans titles for file names and prompts", () => {
  assert.equal(cleanDramaTitle("剧名：《星河 / 旧梦》终稿.docx"), "星河 旧梦");
});

test("does not use markdown stage headings as story hook or prompt beat", () => {
  const script = [
    "剧名：《暗线病房》",
    "### 阶段三：背叛与惩戒",
    "林晚冲进病房，发现周屿藏起证据，两人在门口僵持。",
    "林晚（外科医生）：你到底还瞒了我多少？",
    "周屿（记者）：我是在保护你。",
  ].join("\n");
  const analysis = demoAnalysis(script, "", "暗线病房.docx");
  assert.ok(!analysis.logline.includes("###"));
  assert.ok(!analysis.logline.includes("阶段三"));
  assert.ok(!analysis.prompt.includes("###"));
  assert.ok(!analysis.prompt.includes("阶段三"));
  assert.match(analysis.logline, /林晚冲进病房/);
  assert.match(analysis.prompt, /核心画面瞬间是“林晚冲进病房/);
  assert.match(analysis.prompt, /林晚.*周屿/);
});

test("script-derived visual language is concrete before image generation", () => {
  const analysis = demoAnalysis("剧名：《白色病房》\n林晚（外科医生）：我不能让他再隐瞒真相。\n周屿（记者）：证据就在这里。", "", "白色病房.docx");
  assert.match(analysis.prompt, /四、视觉语言与版式执行\n已确定视觉语言/);
  assert.match(analysis.prompt, /五、构图执行\n构图方案已确定/);
  assert.ok(!analysis.prompt.includes("重新识别或改写参考范例"));
});

test("uses live-action photoreal quality language instead of CG render language", () => {
  const analysis = demoAnalysis("剧名：《龙王之子》\n艾琳（女主）：我不能让龙族发现这个孩子。\n达里安（男主）：他们已经来了。", "", "龙王之子.docx");
  assert.match(analysis.prompt, /真人实拍电影海报质感/);
  assert.match(analysis.prompt, /IMAX胶片摄影机质感/);
  assert.match(analysis.prompt, /Panavision C系列/);
  assert.match(analysis.prompt, /杜绝游戏CG感/);
  assert.ok(!analysis.prompt.includes("Octane"));
  assert.ok(!analysis.prompt.includes("虚幻引擎"));
  assert.ok(!analysis.prompt.includes("光线追踪"));
});

test("hard-limits title text within the safe zone", () => {
  const analysis = demoAnalysis("剧名：《很长很长的短剧标题测试》\n林晚：我不能让他再隐瞒真相。", "", "很长很长的短剧标题测试.docx");
  assert.match(analysis.prompt, /剧名完整外接框必须全部位于纵向58%-74%/);
  assert.match(analysis.prompt, /最下边不得低于74%/);
  assert.match(analysis.prompt, /横向完整外接框必须位于画布中央70%宽度内/);
  assert.match(analysis.prompt, /长剧名必须自动缩小字号/);
});
