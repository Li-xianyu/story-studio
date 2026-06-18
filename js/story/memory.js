/* ============================================================
   浮光剧场 · Memory / System Prompt
   ============================================================ */

import { state, el, getStory, getChapter, touchStory } from "../core/state.js";
import { toast } from "../core/utils.js";
import { streamCompletion } from "../core/api.js";
import { renderMemory } from "../ui/renderer.js";

/* ---- 常量 ---- */

var GLOBAL_KEYS = ["characters", "worldConstants", "worldEvolution", "threads", "characterAttributes"];
var FIELD_LABELS = {
  characters: "人物关系", worldConstants: "世界常数", worldEvolution: "世界演化",
  threads: "未解伏笔", characterAttributes: "主角属性"
};

/* ---- System Prompt ---- */

export function buildSystemPrompt(story) {
  function buildSummaryBlock() {
    var m = story.memory;
    var parts = [];
    if (m.chapterSummaries) {
      var keys = Object.keys(m.chapterSummaries);
      if (keys.length) {
        var lines = ["【各章剧情摘要】"];
        keys.forEach(function (cid) { lines.push(m.chapterSummaries[cid]); });
        parts.push(lines.join("\n\n"));
      }
    }
    if (m.characters) parts.push("【人物关系】\n" + m.characters);
    if (m.worldConstants) parts.push("【世界常数】\n" + m.worldConstants);
    if (m.worldEvolution) parts.push("【世界演化】\n" + m.worldEvolution);
    if (m.threads) parts.push("【未回收伏笔】\n" + m.threads);
    if (m.characterAttributes) parts.push("【主角属性】\n" + m.characterAttributes);
    if (m.lore) parts.push("【用户追加设定】\n" + m.lore);
    return parts.join("\n\n");
  }
  var memoryBlock = buildSummaryBlock();
  return [
    "你是一位成熟的中文长篇小说作者，也是隐形的互动叙事引擎。",
    "只输出可以直接进入小说正文的内容，不解释创作思路，不使用 Markdown 标题，不复述用户指令。",
    "必须承接已有正文，保持人物动机、空间位置、时间顺序和信息边界一致。",
    "用户以角色身份介入时，用户输入中的“我”只代表其扮演的角色，不代表正文必须改成第一人称。将用户明确提供的言行视为已经发生的剧情事实，再严格按设置的叙事视角写入正文；不得因为用户使用“我”而改变人称。对用户所扮演的角色实行严格的玩家代理权边界：只能写用户本次明确输入的动作、台词和意图，不得替该角色新增任何动作、台词、心理判断、承诺、决定或目标。不得擅自引入新人物、新线索、突发事件或新的剧情分支。输出应集中于用户行为的小说化呈现、现场环境与氛围、可观察的动作神态、其他人物的直接反应与必然的即时后果，并在需要玩家继续选择或回答的位置停下。",
    "避免总结式叙事、套路化升华、连续反问、过度华丽比喻和突兀反转。",
    "全篇叙事人称已锁定为“" + story.pov + "”，必须与已有正文保持一致，任何情况下都不得自行切换人称。",
    story.pov === "第一人称"
      ? "使用“我”作为叙述主体，只写叙述者能感知、回忆或推断的信息。"
      : story.pov === "第二人称"
        ? "使用“你”指代核心视角角色，保持稳定的第二人称叙述，不得滑向第一或第三人称。"
        : "使用角色姓名或“他/她”进行第三人称叙述，不得把用户输入中的“我”直接带入正文。",
    "文风：" + story.style + "。",
    getLengthInstruction(story.length),
    story.genre ? "类型：" + story.genre + "。" : "",
    story.premise ? "故事原始设定：\n" + story.premise : "",
    story.playerRole ? "用户主要扮演角色：" + story.playerRole + "。" : "",
    memoryBlock,
    "【强制要求·声线标注】每句人物对话的引号后必须紧跟 [m] 或 [f]：男性角色用 [m]，女性角色用 [f]。旁白叙述不加任何标记。示例：“你来了。”[m] “嗯。”[f] “我先走了。”[m] 不遵守此规则会导致朗读功能失效。",
  ].filter(Boolean).join("\n\n");
}

function getLengthInstruction(length) {
  if (length === "short") return "本次只生成一个较短的剧情片段，控制在 250 至 400 个中文字符，接近 300 字时自然停在可续继的位置。";
  if (length === "long") return "本次只生成一个较长的剧情片段，控制在 900 至 1300 个中文字符，接近 1100 字时自然收束，不要写成完整章节。";
  return "本次只生成一个中等长度的剧情片段，控制在 500 至 800 个中文字符，接近 650 字时自然停在可续继的位置。";
}

/* ---- 辅助 ---- */

export function looksNarrativeIncomplete(text) {
  var value = String(text || "").trim();
  if (!value) return false;
  if (/[。！？!?…"』」』）)]$/.test(value)) return false;
  return /[㐀-鿿A-Za-z0-9，、；：—…"'（(]$/.test(value);
}

export function getLengthMaxTokens(length) {
  if (length === "short") return 850;
  if (length === "long") return 2600;
  return 1550;
}

export function recentNarrative(chapter) {
  return chapter.segments.slice(-12).map(function (segment) {
    return segment.content;
  }).join("\n\n").slice(-18000);
}

function parseMemoryJson(raw) {
  return JSON.parse(String(raw || "").replace(/^```json\s*|```$/g, "").trim());
}

/* ---- 记忆整理轮播标语 ---- */

var _carouselTimer = null;
var _carouselFadeTimer = null;
var _carouselRunning = false;

function startCarousel(labels) {
  stopCarousel();
  if (!labels || !labels.length) return;
  _carouselRunning = true;
  el.statusText.classList.add("carousel");
  el.statusText.textContent = labels[0];
  var idx = 0;
  _carouselTimer = setInterval(function () {
    idx = (idx + 1) % labels.length;
    el.statusText.classList.add("fade-out");
    _carouselFadeTimer = setTimeout(function () {
      if (!_carouselRunning) return;
      el.statusText.textContent = labels[idx];
      el.statusText.classList.remove("fade-out");
    }, 350);
  }, 2500);
}

function stopCarousel() {
  _carouselRunning = false;
  if (_carouselTimer) { clearInterval(_carouselTimer); _carouselTimer = null; }
  if (_carouselFadeTimer) { clearTimeout(_carouselFadeTimer); _carouselFadeTimer = null; }
  el.statusText.classList.remove("carousel", "fade-out");
}

async function generateMemoryLabels(story) {
  try {
    var result = "";
    await streamCompletion([
      { role: "system", content: "你是小说记忆编辑助手。只返回 JSON 数组，不要任何其他内容。" },
      { role: "user", content: [
        "根据以下故事设定，生成 5~8 条简洁的「记忆整理标语」——描述你正在做什么的短句。",
        "要求：每条 8~15 个中文字，口语化、有趣、贴合故事内容。",
        '返回纯 JSON 数组，如 ["正在梳理人物关系脉络","已记载李咸鱼的修炼历程"]',
        "故事设定：" + (story.premise || "未设定")
      ].join("\n") }
    ], function (delta) { result += delta; }, {
      maxTokens: 256, temperature: 0.7, thinking: "disabled"
    });
    var arr = JSON.parse(result.replace(/^```json\s*|```$/g, "").trim());
    if (Array.isArray(arr) && arr.length && arr.every(function (s) { return typeof s === "string" && s.trim(); })) {
      return arr.map(function (s) { return s.trim(); });
    }
    return null;
  } catch (e) { return null; }
}

/* ---- 单章记忆提取 prompt ---- */

function buildChapterExtractPrompt(chapter, chapterIndex, story, oldSummary) {
  var chRecent = chapter.segments.slice(-12).map(function (s) { return s.content; }).filter(Boolean).join("\n\n").slice(-18000);
  var prompt = [
    "请分析以下小说正文，为指定章节生成或更新记忆。返回严格 JSON，不使用 Markdown 代码块。",
    "当前是第 " + chapterIndex + " 章，标题：「" + chapter.title + "」。",
    '{"summary":"本章剧情摘要，必须以【第' + chapterIndex + '章】开头，不要自行编造章节编号","characters":"人物关系（全局，每对关系双向各输出一条，输出完整最新版）。格式：角色名——关系描述——关联角色名。每对关系必须输出两条，互相指向。若角色暂无关联，写：角色名——独立角色——（无）。主角列最前。","worldConstants":"世界观、力量体系、不变规则（输出完整最新版，非增量）","worldEvolution":"随剧情演化的状态、地点、物品（输出完整最新版，非增量）","threads":"未解决的悬念与伏笔（输出完整最新版，非增量）","characterAttributes":"主角外貌、衣着、修为/武力等（输出完整最新版，非增量）"}',
    "要求：人物关系、世界观、世界演化、伏笔、主角属性这五个字段，请基于已有记录和本章新内容输出完整的最新版本——保留已有记录中仍然准确的部分，删除已不再适用的内容，融入本章新增的信息。不要输出增量补充。",
    "已有记录：\n" + JSON.stringify({
      chapterSummary: (oldSummary || "").slice(0, 3000),
      characters: (story.memory.characters || "").slice(0, 3000),
      worldConstants: (story.memory.worldConstants || "").slice(0, 3000),
      worldEvolution: (story.memory.worldEvolution || "").slice(0, 3000),
      threads: (story.memory.threads || "").slice(0, 3000),
      characterAttributes: (story.memory.characterAttributes || "").slice(0, 3000),
    }),
    "原始设定：\n" + (story.premise || "无"),
    "本章正文（最近部分）：\n" + chRecent,
  ];
  if (oldSummary) prompt.push("已有本章旧摘要如下，请在保留核心事实的基础上合并更新：\n" + oldSummary.slice(0, 5000));
  return prompt.join("\n\n");
}

/* ---- 全局字段合并（新增） ---- */

async function consolidateGlobalFields(story, snapshots) {
  // 只有 1 个快照且无旧记忆 → 直接复用
  if (snapshots.length === 1 && !story.memory.characters && !story.memory.worldConstants && !story.memory.worldEvolution && !story.memory.threads && !story.memory.characterAttributes) {
    GLOBAL_KEYS.forEach(function (key) {
      if (typeof snapshots[0][key] === "string" && snapshots[0][key].trim()) {
        story.memory[key] = snapshots[0][key].trim();
      }
    });
    return;
  }

  // 收集旧记忆作为基线
  var oldBlock = "";
  var hasOld = false;
  GLOBAL_KEYS.forEach(function (key) {
    if (story.memory[key] && story.memory[key].trim()) {
      oldBlock += "\n【合并前·" + FIELD_LABELS[key] + "】\n" + story.memory[key].trim() + "\n";
      hasOld = true;
    }
  });
  if (hasOld) oldBlock = "【已有的全局记忆（合并基线）】" + oldBlock;

  // 收集各章快照
  var snapBlocks = "";
  GLOBAL_KEYS.forEach(function (key) {
    var parts = snapshots.filter(function (s) { return s[key] && s[key].trim(); });
    if (!parts.length) return;
    snapBlocks += "\n【各章·" + FIELD_LABELS[key] + "】";
    parts.forEach(function (s) {
      snapBlocks += "\n" + s._label + "：\n" + s[key].trim() + "\n";
    });
  });

  var prompt = [
    "以下是从各章节分别提取的记忆片段，请合并为一份完整、去重、一致的全局记忆。",
    "合并规则：",
    "1. 人物关系：同一对关系保留最详细的描述；若不同章节对同一关系描述有差异，以最新章节为准；每对关系双向各一条。",
    "2. 世界常数：保留所有不矛盾的规则和设定；重复的合并为最精确的描述。",
    "3. 世界演化：按时间顺序保留所有状态变化；若新章节的状态与旧记录矛盾，以新章节为准。",
    "4. 未解伏笔：去除已解决的伏笔，保留所有未解决的问题；不同章节对同一伏笔的描述合并。",
    "5. 主角属性：以最新章节的描述为准，同时保留旧记录中新章节未提及但可能仍然准确的信息。",
    "务必保留所有仍然有效的信息，只在确实存在矛盾时才修剪旧记录。",
    oldBlock,
    snapBlocks,
    '返回严格 JSON（不要 Markdown 代码块）：{"characters":"所有人物关系，格式：角色名——关系描述——关联角色名，双向","worldConstants":"世界观与不变量","worldEvolution":"状态与演化","threads":"未解决伏笔","characterAttributes":"主角属性"}'
  ].filter(Boolean).join("\n\n");

  try {
    var result = "";
    await streamCompletion([
      { role: "system", content: "你是小说记忆合并编辑。请忠实合并各章节的记忆片段：去重、查矛盾、保完整。不编造原文中没有的新信息。" },
      { role: "user", content: prompt }
    ], function (delta) { result += delta; }, { maxTokens: 2048, temperature: 0.2 });

    var mem = parseMemoryJson(result);
    GLOBAL_KEYS.forEach(function (key) {
      if (typeof mem[key] === "string" && mem[key].trim()) {
        story.memory[key] = mem[key].trim();
      }
    });
  } catch (e) {
    // 合并失败时回退到最后一个有内容的快照
    for (var i = snapshots.length - 1; i >= 0; i--) {
      GLOBAL_KEYS.forEach(function (key) {
        if (typeof snapshots[i][key] === "string" && snapshots[i][key].trim() && !story.memory[key]) {
          story.memory[key] = snapshots[i][key].trim();
        }
      });
    }
    console.warn("全局记忆合并失败，使用最后一章快照回退", e);
    // 不 re-throw：快照已回退保存，不要阻断用户流程
  }
}

/* ---- 整理记忆主流程 ---- */

export async function summarizeMemory() {
  if (state.generating) return;
  var story = getStory();
  setBusy(true, "正在整理故事记忆…");
  var labels = await generateMemoryLabels(story);
  if (labels) startCarousel(labels);
  try {
    var summarizedAny = false;
    var globalSnapshots = [];

    for (var ci = 0; ci < story.chapters.length; ci++) {
      var ch = story.chapters[ci];
      if (!ch.segments.some(function (s) { return String(s.content || "").trim(); })) continue;

      var hasSummary = !!story.memory.chapterSummaries[ch.id];
      var hasCommitted = !!ch.memoryCommittedAt;
      var latestSegCreatedAt = "";
      ch.segments.forEach(function (s) { if (s.createdAt && s.createdAt > latestSegCreatedAt) latestSegCreatedAt = s.createdAt; });
      var hasNewContent = hasCommitted && latestSegCreatedAt > ch.memoryCommittedAt;
      var needsSummarize = !hasSummary || !hasCommitted || hasNewContent;
      if (!needsSummarize) continue;

      summarizedAny = true;
      var chapterIndex = ci + 1;
      var oldSummary = story.memory.chapterSummaries[ch.id] || "";
      var prompt = buildChapterExtractPrompt(ch, chapterIndex, story, oldSummary);

      var result = "";
      await streamCompletion([
        { role: "system", content: "你是小说连续性编辑，只维护准确的故事状态。人物关系请使用 角色名——关系——关联角色名 的格式，每行一条关系，不要输出自然语言描述。" },
        { role: "user", content: prompt }
      ], function (delta) { result += delta; });

      var mem = parseMemoryJson(result);

      // 摘要：照常写入分章
      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }

      // 全局字段：收集快照，不逐章覆盖
      var snap = { _label: "【第" + chapterIndex + "章·" + ch.title + "】" };
      var hasGlobals = false;
      GLOBAL_KEYS.forEach(function (key) {
        if (typeof mem[key] === "string" && mem[key].trim()) {
          snap[key] = mem[key].trim();
          hasGlobals = true;
        }
      });
      if (hasGlobals) globalSnapshots.push(snap);

      ch.memoryCommittedAt = new Date().toISOString();
    }

    // 合并全局字段
    if (globalSnapshots.length > 0) {
      await consolidateGlobalFields(story, globalSnapshots);
    }

    touchStory();
    renderMemory();
    toast(el.toast, summarizedAny ? "故事记忆已更新" : "各章节均无新增内容，无需整理");
  } catch (error) {
    if (error.name !== "AbortError") toast(el.toast, "整理失败：" + error.message);
  } finally {
    stopCarousel();
    state.abortController = null;
    setBusy(false);
  }
}

/* ---- 新章前整理 ---- */

export async function prepareChapterMemory() {
  if (state.generating) return false;
  var story = getStory();
  var activeChapter = getChapter();
  if (!story || !activeChapter) return false;

  var sourceChapters = story.chapters.filter(function (chapter) {
    return chapter.id !== activeChapter.id &&
      !chapter.memoryCommittedAt &&
      chapter.segments.some(function (segment) { return String(segment.content || "").trim(); });
  });
  if (!sourceChapters.length) return true;

  setBusy(true, "正在整理前文…");
  var labels = await generateMemoryLabels(story);
  if (labels) startCarousel(labels);
  try {
    var globalSnapshots = [];

    for (var si = 0; si < sourceChapters.length; si++) {
      var ch = sourceChapters[si];
      var chapterIndex = story.chapters.indexOf(ch) + 1;
      var chText = ch.segments.map(function (s) { return s.content; }).filter(Boolean).join("\n\n").slice(-18000);
      var prompt = [
        "即将进入新章节。请为以下章节生成独立记忆条目，返回严格 JSON，不使用 Markdown 代码块。",
        "当前归档的是第 " + chapterIndex + " 章，标题：「" + ch.title + "」。",
        '{"summary":"本章剧情摘要，必须以【第' + chapterIndex + '章】开头，不要自行编造章节编号","characters":"人物关系（全局，每对关系双向各输出一条，输出完整最新版）。格式：角色名——关系描述——关联角色名。每对关系必须输出两条，互相指向。若角色暂无关联，写：角色名——独立角色——（无）。主角列最前。","worldConstants":"世界观、力量体系、不变规则（输出完整最新版，非增量）","worldEvolution":"本章涉及的状态变化（输出完整最新版，非增量）","threads":"仍未解决的目标、冲突、悬念与伏笔（输出完整最新版，非增量）","characterAttributes":"主角属性更新（输出完整最新版，非增量）"}',
        "要求：人物关系、世界观、世界演化、伏笔、主角属性这五个字段，请基于已有记录和本章内容输出完整的最新版本——保留已有记录中仍然准确的部分，删除已不再适用的内容，融入本章新增的信息。不要输出增量补充。",
        "已有记忆基础：\n" + JSON.stringify({
          characters: (story.memory.characters || "").slice(0, 3000),
          worldConstants: (story.memory.worldConstants || "").slice(0, 3000),
          characterAttributes: (story.memory.characterAttributes || "").slice(0, 3000),
        }),
        "故事原始设定：\n" + (story.premise || "无"),
        "待归档章节正文：\n" + chText,
      ].join("\n\n");

      var result = "";
      await streamCompletion([
        { role: "system", content: "你是长篇小说的连续性编辑，只维护准确、紧凑、可供后续创作使用的故事记忆。人物关系请使用 角色名——关系——关联角色名 的格式，每行一条关系。" },
        { role: "user", content: prompt }
      ], function (delta) { result += delta; }, {
        maxTokens: 1400,
        temperature: 0.2,
        thinking: "disabled",
      });

      var mem = parseMemoryJson(result);

      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }

      var snap = { _label: "【第" + chapterIndex + "章·" + ch.title + "】" };
      var hasGlobals = false;
      GLOBAL_KEYS.forEach(function (key) {
        if (typeof mem[key] === "string" && mem[key].trim()) {
          snap[key] = mem[key].trim();
          hasGlobals = true;
        }
      });
      if (hasGlobals) globalSnapshots.push(snap);

      ch.memoryCommittedAt = new Date().toISOString();
    }

    // 合并全局字段
    if (globalSnapshots.length > 0) {
      await consolidateGlobalFields(story, globalSnapshots);
    }

    touchStory();
    renderMemory();
    toast(el.toast, "前文已整理，可以开始新章节");
    return true;
  } catch (error) {
    if (error.name !== "AbortError") toast(el.toast, "前文整理失败：" + error.message);
    return false;
  } finally {
    stopCarousel();
    state.abortController = null;
    setBusy(false);
  }
}

/* ---- setBusy ---- */

function setBusy(busy, text) {
  state.generating = busy;
  el.composerInput.disabled = busy;
  el.sendBtn.classList.toggle("hidden", busy);
  el.stopBtn.classList.toggle("hidden", !busy);
  el.statusText.textContent = text || (busy ? "正在续写…" : "准备就绪");
  el.topLoader.classList.toggle("active", busy);
  el.topLoader.setAttribute("aria-hidden", busy ? "false" : "true");
}
