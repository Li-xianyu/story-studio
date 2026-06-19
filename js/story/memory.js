/* ============================================================
   浮光剧场 · Memory / System Prompt (Refactored)
   ============================================================ */

import { state, el, getStory, getChapter, touchStory } from "../core/state.js";
import { toast } from "../core/utils.js";
import { streamCompletion } from "../core/api.js";
import { renderMemory } from "../ui/renderer.js";

/* ---- 常量 ---- */

var GLOBAL_KEYS = ["worldState", "characters", "plotThreads"];
var FIELD_LABELS = {
  worldState: "世界状态", characters: "人物关系", plotThreads: "剧情伏笔"
};

/* ---- System Prompt ---- */

export function buildSystemPrompt(story) {
  function buildSummaryBlock() {
    var m = story.memory;
    var parts = [];
    if (m.chapterSummaries) {
      var keys = Object.keys(m.chapterSummaries);
      if (keys.length) {
        var lines = ["【近期剧情摘要】"];
        var recentKeys = keys.slice(-5); // Sliding window
        if (keys.length > 5) lines.push("（更早的情节摘要已省略...）");
        recentKeys.forEach(function (cid) { lines.push(m.chapterSummaries[cid]); });
        parts.push(lines.join("\n\n"));
      }
    }

    var chars = m.characters;
    if (Array.isArray(chars)) {
        chars = chars.map(function(c) {
            return c.source + " ——" + c.relation + (c.mutual ? " (互相)—— " : "—— ") + c.target;
        }).join("\n");
    } else if (typeof chars === "string" && chars.trim().startsWith("[")) {
        try {
            var parsed = JSON.parse(chars);
            if (Array.isArray(parsed)) {
                chars = parsed.map(function(c) {
                    return c.source + " ——" + c.relation + (c.mutual ? " (互相)—— " : "—— ") + c.target;
                }).join("\n");
            }
        } catch(e) {}
    }

    if (chars && String(chars).trim()) parts.push("【人物关系】\n" + chars);
    
    // Fallback logic to support old saves
    var worldSt = m.worldState || m.worldConstants || "";
    if (worldSt) parts.push("【世界状态】\n" + worldSt);
    
    var plots = m.plotThreads || m.threads || "";
    if (plots) parts.push("【剧情伏笔】\n" + plots);

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
  var rule = "【强制收束要求】绝对不要在句子中途被截断。当你感觉接近字数上限时，请提前进行剧情收束，必须以完整的标点符号（。！？…”）结尾，确保最后一段是一个完整的句子，千万不要留下半句话。";
  if (length === "short") return "本次只生成一个较短的剧情片段，控制在 250 至 400 个中文字符，接近 300 字时自然停在可续继的位置。" + rule;
  if (length === "long") return "本次只生成一个较长的剧情片段，控制在 900 至 1300 个中文字符，接近 1100 字时自然收束，不要写成完整章节。" + rule;
  return "本次只生成一个中等长度的剧情片段，控制在 500 至 800 个中文字符，接近 650 字时自然停在可续继的位置。" + rule;
}

/* ---- 辅助 ---- */

export function looksNarrativeIncomplete(text) {
  var value = String(text || "").trim();
  if (!value) return false;
  if (/[。！？!?…"』」』）)]$/.test(value)) return false;
  return /[㐀-鿿A-Za-z0-9，、；：—…"'（(]$/.test(value);
}

export function getLengthMaxTokens(length) {
  if (length === "short") return 1100;
  if (length === "long") return 3200;
  return 2000;
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
        '返回纯 JSON 数组，如 ["正在梳理人物关系脉络","已记载主角的修炼历程"]',
        "故事设定：" + (story.premise || "未设定")
      ].join("\n") }
    ], function (delta) { result += delta; }, {
      maxTokens: 256, temperature: 0.7, thinking: "disabled", responseFormat: { type: "json_object" }
    });
    var arr = JSON.parse(result.replace(/^```json\s*|```$/g, "").trim());
    if (Array.isArray(arr) && arr.length && arr.every(function (s) { return typeof s === "string" && s.trim(); })) {
      return arr.map(function (s) { return s.trim(); });
    }
    return null;
  } catch (e) { return null; }
}

/* ---- 单章记忆增量提取 prompt ---- */

function buildChapterExtractPrompt(chapter, chapterIndex, story, oldSummary) {
  var chRecent = chapter.segments.slice(-12).map(function (s) { return s.content; }).filter(Boolean).join("\n\n").slice(-18000);
  
  var oldWorldState = story.memory.worldState || story.memory.worldConstants || "";
  var oldPlotThreads = story.memory.plotThreads || story.memory.threads || "";
  
  var prompt = [
    "请分析以下小说正文，为指定章节生成或更新故事记忆。必须返回严格的 JSON 格式数据。",
    "当前是第 " + chapterIndex + " 章，标题：「" + chapter.title + "」。",
    '返回格式：\n{"summary":"本章详细剧情摘要，必须以【第' + chapterIndex + '章】开头","worldState":"完整的当前世界状态、势力格局、常数设定等（若无变化可保持原样，如有变化请更新）","plotThreads":"当前所有未解决的任务、悬念与伏笔（剔除本章已解决的，添加本章新增的）","characters": [{"source": "角色A", "target": "角色B", "relation": "具体关系描述，如青梅竹马、死敌", "mutual": true或false}]}',
    "",
    "【重要更新规则】",
    "1. 你不仅是在归纳本章，更是在维护一份「全局记忆」。",
    "2. 对于 worldState 和 plotThreads：请综合【已有记忆基础】与【待处理正文】，输出一份最新的、完整的全局文本。不要只写增量！如果本章没有任何相关更新，直接复用已有记忆即可；如果已有记忆的某些设定在本章发生了改变或失效，请在输出中修改或删除它们。",
    "3. 对于 characters：输出一个 JSON 数组，包含故事中所有重要人物的关系。每个关系对象必须有 source, target, relation, mutual 字段。关系描述必须是 2~4 个字的简短关系词（如：上下级、同僚、同袍、死敌、暗恋等。注意区分身份场合，例如军队/官场请用'上下级'或'属下'，切勿滥用'主仆'），绝对不要写成一大长串句子！不要漏掉旧记忆里依然存在的角色关系。",
    "请确保返回的是符合上述结构的纯 JSON 文本！",
    "",
    "已有记忆基础：\n" + JSON.stringify({
      chapterSummary: (oldSummary || "").slice(0, 3000),
      characters: story.memory.characters || [],
      worldState: oldWorldState.slice(0, 3000),
      plotThreads: oldPlotThreads.slice(0, 3000),
    }, null, 2),
    "故事原始设定：\n" + (story.premise || "无"),
    "待处理正文：\n" + chRecent,
  ];
  if (oldSummary) prompt.push("已有本章旧摘要如下，请在保留核心事实的基础上合并更新：\n" + oldSummary.slice(0, 5000));
  return prompt.join("\n\n");
}

/* ---- 整理记忆进度 UI ---- */
function openProgressDialog() {
  if (el.memoryProgressTimeline) el.memoryProgressTimeline.innerHTML = "";
  if (el.memoryProgressDialog) el.memoryProgressDialog.showModal();
}

function resetProgressNodes(chapterTitle) {
  if (!el.memoryProgressTimeline) return;
  el.memoryProgressTimeline.innerHTML = "";
  addProgressNode("context", "分析上下文 (" + escapeHtml(chapterTitle) + ")", "正在准备数据...");
  addProgressNode("summary", "提炼剧情摘要", "等待生成...");
  addProgressNode("characters", "梳理人物关系", "等待生成...");
  addProgressNode("world", "更新世界与伏笔", "等待生成...");
}

function addProgressNode(id, title, desc) {
  if (!el.memoryProgressTimeline) return;
  var li = document.createElement("li");
  li.id = "progress-node-" + id;
  li.innerHTML = '<div class="step-title">' + title + '</div><div class="step-desc" id="progress-desc-' + id + '">' + desc + '</div>';
  el.memoryProgressTimeline.appendChild(li);
}

function updateProgressNode(id, status, desc) {
  var li = document.getElementById("progress-node-" + id);
  if (!li) return;
  
  // Remove existing status classes
  li.classList.remove("active", "completed");
  
  var titleEl = li.querySelector('.step-title');
  var existingSpinner = titleEl.querySelector('.dot-spinner');

  if (status === "active") {
    li.classList.add("active");
    if (!existingSpinner) {
      titleEl.innerHTML += ' <div class="dot-spinner" style="transform: scale(0.7); transform-origin: left center; margin-left: 2px;"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>';
    }
  } else if (status === "completed") {
    li.classList.add("completed");
    if (existingSpinner) {
      existingSpinner.remove();
    }
  }
  
  var descEl = document.getElementById("progress-desc-" + id);
  if (descEl && desc) descEl.textContent = desc;
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>'"]/g, function (tag) {
    return {"&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"}[tag];
  });
}

/* ---- 整理记忆主流程 ---- */

export async function summarizeMemory() {
  if (state.generating) return;
  var story = getStory();
  
  var chaptersToProcess = story.chapters.filter(function (ch) {
    if (!ch.segments.some(function (s) { return String(s.content || "").trim(); })) return false;
    var hasSummary = !!story.memory.chapterSummaries[ch.id];
    var hasCommitted = !!ch.memoryCommittedAt;
    var latestSegCreatedAt = "";
    ch.segments.forEach(function (s) { if (s.createdAt && s.createdAt > latestSegCreatedAt) latestSegCreatedAt = s.createdAt; });
    var hasNewContent = hasCommitted && latestSegCreatedAt > ch.memoryCommittedAt;
    return !hasSummary || !hasCommitted || hasNewContent;
  });

  if (chaptersToProcess.length === 0) {
    toast(el.toast, "各章节均无新增内容，无需整理");
    return;
  }

  setBusy(true, "正在整理故事记忆…");
  openProgressDialog();
  generateMemoryLabels(story).then(function(labels) {
    if (labels && state.abortController) startCarousel(labels);
  });

  try {
    for (var i = 0; i < chaptersToProcess.length; i++) {
      var ch = chaptersToProcess[i];
      var chapterIndex = story.chapters.indexOf(ch) + 1;
      
      resetProgressNodes(ch.title || ("第" + chapterIndex + "章"));
      updateProgressNode("context", "active", "正在提取正文与历史设定...");
      
      var oldSummary = story.memory.chapterSummaries[ch.id] || "";
      var prompt = buildChapterExtractPrompt(ch, chapterIndex, story, oldSummary);

      updateProgressNode("context", "completed", "分析完成");
      updateProgressNode("summary", "active", "AI 正在思考中...");

      var result = "";
      var step = 0;

      await streamCompletion([
        { role: "system", content: "你是小说连续性编辑，只维护准确的故事状态。请返回 JSON 格式数据。" },
        { role: "user", content: prompt }
      ], function (delta) { 
        result += delta; 
        if (step === 0 && (result.includes('"summary"') || result.length > 50)) {
          step = 1;
          updateProgressNode("summary", "active", "正在生成核心剧情...");
        }
        if (step === 1 && (result.includes('"characters"') || result.length > 300)) {
          step = 2;
          updateProgressNode("summary", "completed", "摘要提炼完成");
          updateProgressNode("characters", "active", "正在重构人物图谱...");
        }
        if (step === 2 && (result.includes('"worldState"') || result.includes('"plotThreads"') || result.length > 800)) {
          step = 3;
          updateProgressNode("characters", "completed", "关系网重构完成");
          updateProgressNode("world", "active", "正在推演世界观与伏笔闭环...");
        }
      }, { responseFormat: { type: "json_object" }});

      updateProgressNode("world", "completed", "各项指标更新完成");

      var mem = parseMemoryJson(result);

      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }
      if (typeof mem.worldState === "string" && mem.worldState.trim()) {
        story.memory.worldState = mem.worldState.trim();
      }
      if (typeof mem.plotThreads === "string" && mem.plotThreads.trim()) {
        story.memory.plotThreads = mem.plotThreads.trim();
      }
      if (Array.isArray(mem.characters)) {
        story.memory.characters = mem.characters;
      }

      ch.memoryCommittedAt = new Date().toISOString();
    }

    touchStory();
    renderMemory();
    toast(el.toast, "故事记忆已更新");
  } catch (error) {
    if (error.name !== "AbortError") toast(el.toast, "整理失败：" + error.message);
  } finally {
    stopCarousel();
    state.abortController = null;
    setBusy(false);
    if (el.memoryProgressDialog) el.memoryProgressDialog.close();
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
  openProgressDialog();
  generateMemoryLabels(story).then(function(labels) {
    if (labels && state.abortController) startCarousel(labels);
  });

  try {
    for (var si = 0; si < sourceChapters.length; si++) {
      var ch = sourceChapters[si];
      var chapterIndex = story.chapters.indexOf(ch) + 1;
      
      resetProgressNodes(ch.title || ("第" + chapterIndex + "章"));
      updateProgressNode("context", "active", "正在提取正文与历史设定...");
      
      var prompt = buildChapterExtractPrompt(ch, chapterIndex, story, story.memory.chapterSummaries[ch.id] || "");

      updateProgressNode("context", "completed", "分析完成");
      updateProgressNode("summary", "active", "AI 正在思考中...");

      var result = "";
      var step = 0;

      await streamCompletion([
        { role: "system", content: "你是长篇小说的连续性编辑。请返回 JSON 格式数据。" },
        { role: "user", content: prompt }
      ], function (delta) { 
        result += delta; 
        if (step === 0 && (result.includes('"summary"') || result.length > 50)) {
          step = 1;
          updateProgressNode("summary", "active", "正在生成核心剧情...");
        }
        if (step === 1 && (result.includes('"characters"') || result.length > 300)) {
          step = 2;
          updateProgressNode("summary", "completed", "摘要提炼完成");
          updateProgressNode("characters", "active", "正在重构人物图谱...");
        }
        if (step === 2 && (result.includes('"worldState"') || result.includes('"plotThreads"') || result.length > 800)) {
          step = 3;
          updateProgressNode("characters", "completed", "关系网重构完成");
          updateProgressNode("world", "active", "正在推演世界观与伏笔闭环...");
        }
      }, {
        maxTokens: 2000,
        temperature: 0.2,
        thinking: "disabled",
        responseFormat: { type: "json_object" }
      });

      updateProgressNode("world", "completed", "各项指标更新完成");

      var mem = parseMemoryJson(result);

      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }
      if (typeof mem.worldState === "string" && mem.worldState.trim()) {
        story.memory.worldState = mem.worldState.trim();
      }
      if (typeof mem.plotThreads === "string" && mem.plotThreads.trim()) {
        story.memory.plotThreads = mem.plotThreads.trim();
      }
      if (Array.isArray(mem.characters)) {
        story.memory.characters = mem.characters;
      }

      ch.memoryCommittedAt = new Date().toISOString();
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
    if (el.memoryProgressDialog) el.memoryProgressDialog.close();
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
