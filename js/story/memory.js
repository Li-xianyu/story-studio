/* ============================================================
   浮光剧场 · Memory / System Prompt
   ============================================================ */

import { state, el, getStory, getChapter, touchStory } from "../core/state.js";
import { toast } from "../core/utils.js";
import { streamCompletion } from "../core/api.js";
import { renderMemory } from "../ui/renderer.js";

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
    "\u4f60\u662f\u4e00\u4f4d\u6210\u719f\u7684\u4e2d\u6587\u957f\u7bc7\u5c0f\u8bf4\u4f5c\u8005\uff0c\u4e5f\u662f\u9690\u5f62\u7684\u4e92\u52a8\u53d9\u4e8b\u5f15\u64ce\u3002",
    "\u53ea\u8f93\u51fa\u53ef\u4ee5\u76f4\u63a5\u8fdb\u5165\u5c0f\u8bf4\u6b63\u6587\u7684\u5185\u5bb9\uff0c\u4e0d\u89e3\u91ca\u521b\u4f5c\u601d\u8def\uff0c\u4e0d\u4f7f\u7528 Markdown \u6807\u9898\uff0c\u4e0d\u590d\u8ff0\u7528\u6237\u6307\u4ee4\u3002",
    "\u5fc5\u987b\u627f\u63a5\u5df2\u6709\u6b63\u6587\uff0c\u4fdd\u6301\u4eba\u7269\u52a8\u673a\u3001\u7a7a\u95f4\u4f4d\u7f6e\u3001\u65f6\u95f4\u987a\u5e8f\u548c\u4fe1\u606f\u8fb9\u754c\u4e00\u81f4\u3002",
    "\u7528\u6237\u4ee5\u89d2\u8272\u8eab\u4efd\u4ecb\u5165\u65f6\uff0c\u7528\u6237\u8f93\u5165\u4e2d\u7684\u201c\u6211\u201d\u53ea\u4ee3\u8868\u5176\u626e\u6f14\u7684\u89d2\u8272\uff0c\u4e0d\u4ee3\u8868\u6b63\u6587\u5fc5\u987b\u6539\u6210\u7b2c\u4e00\u4eba\u79f0\u3002\u5c06\u7528\u6237\u660e\u786e\u63d0\u4f9b\u7684\u8a00\u884c\u89c6\u4e3a\u5df2\u7ecf\u53d1\u751f\u7684\u5267\u60c5\u4e8b\u5b9e\uff0c\u518d\u4e25\u683c\u6309\u8bbe\u7f6e\u7684\u53d9\u4e8b\u89c6\u89d2\u5199\u5165\u6b63\u6587\uff1b\u4e0d\u5f97\u56e0\u4e3a\u7528\u6237\u4f7f\u7528\u201c\u6211\u201d\u800c\u6539\u53d8\u4eba\u79f0\u3002\u5bf9\u7528\u6237\u6240\u626e\u6f14\u7684\u89d2\u8272\u5b9e\u884c\u4e25\u683c\u7684\u73a9\u5bb6\u4ee3\u7406\u6743\u8fb9\u754c\uff1a\u53ea\u80fd\u5199\u7528\u6237\u672c\u6b21\u660e\u786e\u8f93\u5165\u7684\u52a8\u4f5c\u3001\u53f0\u8bcd\u548c\u610f\u56fe\uff0c\u4e0d\u5f97\u66ff\u8be5\u89d2\u8272\u65b0\u589e\u4efb\u4f55\u52a8\u4f5c\u3001\u53f0\u8bcd\u3001\u5fc3\u7406\u5224\u65ad\u3001\u627f\u8bfa\u3001\u51b3\u5b9a\u6216\u76ee\u6807\u3002\u4e0d\u5f97\u64c5\u81ea\u5f15\u5165\u65b0\u4eba\u7269\u3001\u65b0\u7ebf\u7d22\u3001\u7a81\u53d1\u4e8b\u4ef6\u6216\u65b0\u7684\u5267\u60c5\u5206\u652f\u3002\u8f93\u51fa\u5e94\u96c6\u4e2d\u4e8e\u7528\u6237\u884c\u4e3a\u7684\u5c0f\u8bf4\u5316\u5448\u73b0\u3001\u73b0\u573a\u73af\u5883\u4e0e\u6c1b\u56f4\u3001\u53ef\u89c2\u5bdf\u7684\u52a8\u4f5c\u795e\u6001\u3001\u5176\u4ed6\u4eba\u7269\u7684\u76f4\u63a5\u53cd\u5e94\u4e0e\u5fc5\u7136\u7684\u5373\u65f6\u540e\u679c\uff0c\u5e76\u5728\u9700\u8981\u73a9\u5bb6\u7ee7\u7eed\u9009\u62e9\u6216\u56de\u7b54\u7684\u4f4d\u7f6e\u505c\u4e0b\u3002",
    "\u907f\u514d\u603b\u7ed3\u5f0f\u53d9\u4e8b\u3001\u5957\u8def\u5316\u5347\u534e\u3001\u8fde\u7eed\u53cd\u95ee\u3001\u8fc7\u5ea6\u534e\u4e3d\u6bd4\u55bb\u548c\u7a81\u5140\u53cd\u8f6c\u3002",
    "\u5168\u7bc7\u53d9\u4e8b\u4eba\u79f0\u5df2\u9501\u5b9a\u4e3a\u201c" + story.pov + "\u201d\uff0c\u5fc5\u987b\u4e0e\u5df2\u6709\u6b63\u6587\u4fdd\u6301\u4e00\u81f4\uff0c\u4efb\u4f55\u60c5\u51b5\u4e0b\u90fd\u4e0d\u5f97\u81ea\u884c\u5207\u6362\u4eba\u79f0\u3002",
    story.pov === "\u7b2c\u4e00\u4eba\u79f0"
      ? "\u4f7f\u7528\u201c\u6211\u201d\u4f5c\u4e3a\u53d9\u8ff0\u4e3b\u4f53\uff0c\u53ea\u5199\u53d9\u8ff0\u8005\u80fd\u611f\u77e5\u3001\u56de\u5fc6\u6216\u63a8\u65ad\u7684\u4fe1\u606f\u3002"
      : story.pov === "\u7b2c\u4e8c\u4eba\u79f0"
        ? "\u4f7f\u7528\u201c\u4f60\u201d\u6307\u4ee3\u6838\u5fc3\u89c6\u89d2\u89d2\u8272\uff0c\u4fdd\u6301\u7a33\u5b9a\u7684\u7b2c\u4e8c\u4eba\u79f0\u53d9\u8ff0\uff0c\u4e0d\u5f97\u6ed1\u5411\u7b2c\u4e00\u6216\u7b2c\u4e09\u4eba\u79f0\u3002"
        : "\u4f7f\u7528\u89d2\u8272\u59d3\u540d\u6216\u201c\u4ed6/\u5979\u201d\u8fdb\u884c\u7b2c\u4e09\u4eba\u79f0\u53d9\u8ff0\uff0c\u4e0d\u5f97\u628a\u7528\u6237\u8f93\u5165\u4e2d\u7684\u201c\u6211\u201d\u76f4\u63a5\u5e26\u5165\u6b63\u6587\u3002",
    "\u6587\u98ce\uff1a" + story.style + "\u3002",
    getLengthInstruction(story.length),
    story.genre ? "\u7c7b\u578b\uff1a" + story.genre + "\u3002" : "",
    story.premise ? "\u6545\u4e8b\u539f\u59cb\u8bbe\u5b9a\uff1a\n" + story.premise : "",
    story.playerRole ? "\u7528\u6237\u4e3b\u8981\u626e\u6f14\u89d2\u8272\uff1a" + story.playerRole + "\u3002" : "",
    memoryBlock,
    "【强制要求·声线标注】每句人物对话的引号后必须紧跟 [m] 或 [f]：男性角色用 [m]，女性角色用 [f]。旁白叙述不加任何标记。示例：\"你来了。\"[m] \"嗯。\"[f] \"我先走了。\"[m] 不遵守此规则会导致朗读功能失效。",
  ].filter(Boolean).join("\n\n");
}

function getLengthInstruction(length) {
  if (length === "short") return "\u672c\u6b21\u53ea\u751f\u6210\u4e00\u4e2a\u8f83\u77ed\u7684\u5267\u60c5\u7247\u6bb5\uff0c\u63a7\u5236\u5728 250 \u81f3 400 \u4e2a\u4e2d\u6587\u5b57\u7b26\uff0c\u63a5\u8fd1 300 \u5b57\u65f6\u81ea\u7136\u505c\u5728\u53ef\u7eed\u7ee7\u7684\u4f4d\u7f6e\u3002";
  if (length === "long") return "\u672c\u6b21\u53ea\u751f\u6210\u4e00\u4e2a\u8f83\u957f\u7684\u5267\u60c5\u7247\u6bb5\uff0c\u63a7\u5236\u5728 900 \u81f3 1300 \u4e2a\u4e2d\u6587\u5b57\u7b26\uff0c\u63a5\u8fd1 1100 \u5b57\u65f6\u81ea\u7136\u6536\u675f\uff0c\u4e0d\u8981\u5199\u6210\u5b8c\u6574\u7ae0\u8282\u3002";
  return "\u672c\u6b21\u53ea\u751f\u6210\u4e00\u4e2a\u4e2d\u7b49\u957f\u5ea6\u7684\u5267\u60c5\u7247\u6bb5\uff0c\u63a7\u5236\u5728 500 \u81f3 800 \u4e2a\u4e2d\u6587\u5b57\u7b26\uff0c\u63a5\u8fd1 650 \u5b57\u65f6\u81ea\u7136\u505c\u5728\u53ef\u7eed\u7ee7\u7684\u4f4d\u7f6e\u3002";
}

export function looksNarrativeIncomplete(text) {
  var value = String(text || "").trim();
  if (!value) return false;
  if (/[。！？!?…"’」』）)]$/.test(value)) return false;
  return /[\u3400-\u9fffA-Za-z0-9，、；：—…"'（(]$/.test(value);
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
      {
        role: "system",
        content: "你是小说记忆编辑助手。只返回 JSON 数组，不要任何其他内容。"
      },
      {
        role: "user",
        content: [
          "根据以下故事设定，生成 5~8 条简洁的"记忆整理标语"——描述你正在做什么的短句。",
          "要求：每条 8~15 个中文字，口语化、有趣、贴合故事内容。",
          '返回纯 JSON 数组，如 ["正在梳理人物关系脉络","已记载李咸鱼的修炼历程"]',
          "故事设定：" + (story.premise || "未设定")
        ].join("\n")
      }
    ], function (delta) { result += delta; }, {
      maxTokens: 256,
      temperature: 0.7,
      thinking: "disabled"
    });
    var cleaned = result.replace(/^```json\s*|```$/g, "").trim();
    var arr = JSON.parse(cleaned);
    if (Array.isArray(arr) && arr.length && arr.every(function (s) { return typeof s === "string" && s.trim(); })) {
      return arr.map(function (s) { return s.trim(); });
    }
    return null;
  } catch (e) {
    return null;
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
    for (var ci = 0; ci < story.chapters.length; ci++) {
      var ch = story.chapters[ci];
      if (!ch.segments.some(function (s) { return String(s.content || "").trim(); })) continue;
      // 判断本章是否需要整理
      var hasSummary = !!story.memory.chapterSummaries[ch.id];
      var hasCommitted = !!ch.memoryCommittedAt;
      var latestSegCreatedAt = "";
      ch.segments.forEach(function (s) { if (s.createdAt && s.createdAt > latestSegCreatedAt) latestSegCreatedAt = s.createdAt; });
      var hasNewContent = hasCommitted && latestSegCreatedAt > ch.memoryCommittedAt;
      var needsSummarize = !hasSummary || !hasCommitted || hasNewContent;
      if (!needsSummarize) continue;

      summarizedAny = true;
      var chapterIndex = ci + 1;
      var chRecent = ch.segments.slice(-12).map(function (s) { return s.content; }).filter(Boolean).join("\n\n").slice(-18000);
      var oldSummary = story.memory.chapterSummaries[ch.id] || "";
      var prompt = [
        "请分析以下小说正文，为指定章节生成或更新记忆。返回严格 JSON，不使用 Markdown 代码块。",
        "当前是第 " + chapterIndex + " 章，标题：「" + ch.title + "」。",
        '{"summary":"本章剧情摘要，必须以【第' + chapterIndex + '章】开头，不要自行编造章节编号","characters":"人物关系（全局，输出完整最新版，非增量）","worldConstants":"世界观、力量体系、不变规则（输出完整最新版，非增量）","worldEvolution":"随剧情演化的状态、地点、物品（输出完整最新版，非增量）","threads":"未解决的悬念与伏笔（输出完整最新版，非增量）","characterAttributes":"主角外貌、衣着、修为/武力等（输出完整最新版，非增量）"}',
        "要求：人物关系、世界观、世界演化、伏笔、主角属性这五个字段，请基于已有记录和本章新内容输出完整的最新版本——保留已有记录中仍然准确的部分，删除已不再适用的内容，融入本章新增的信息。不要输出增量补充。",
        "已有记录：\n" + JSON.stringify({
          chapterSummary: oldSummary.slice(0, 3000),
          characters: (story.memory.characters || "").slice(0, 3000),
          worldConstants: (story.memory.worldConstants || "").slice(0, 3000),
          worldEvolution: (story.memory.worldEvolution || "").slice(0, 3000),
          threads: (story.memory.threads || "").slice(0, 3000),
          characterAttributes: (story.memory.characterAttributes || "").slice(0, 3000),
        }),
        "原始设定：\n" + (story.premise || "无"),
        "本章正文（最近部分）：\n" + chRecent,
      ].join("\n\n");
      if (oldSummary) {
        prompt += "\n\n已有本章旧摘要如下，请在保留核心事实的基础上合并更新：\n" + oldSummary.slice(0, 5000);
      }
      var result = "";
      await streamCompletion([
        { role: "system", content: "你是小说连续性编辑，只维护准确的故事状态。" },
        { role: "user", content: prompt }
      ], function (delta) { result += delta; });
      var cleaned = result.replace(/^```json\s*|```$/g, "").trim();
      var mem = JSON.parse(cleaned);
      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }
      // 非摘要字段：原位覆盖，不再拼接
      var mergeKeys = ["characters", "worldConstants", "worldEvolution", "threads", "characterAttributes"];
      mergeKeys.forEach(function (key) {
        if (typeof mem[key] === "string" && mem[key].trim()) {
          story.memory[key] = mem[key].trim();
        }
      });
      ch.memoryCommittedAt = new Date().toISOString();
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

export async function prepareChapterMemory() {
  if (state.generating) return false;
  var story = getStory();
  var activeChapter = getChapter();
  if (!story || !activeChapter) return false;

  var sourceChapters = story.chapters.filter(function (chapter) {
    return chapter.id !== activeChapter.id &&
      !chapter.memoryCommittedAt &&
      chapter.segments.some(function (segment) {
        return String(segment.content || "").trim();
      });
  });
  if (!sourceChapters.length) return true;

  setBusy(true, "正在整理前文…");
  var labels = await generateMemoryLabels(story);
  if (labels) startCarousel(labels);
  try {
    for (var si = 0; si < sourceChapters.length; si++) {
      var ch = sourceChapters[si];
      var chapterIndex = story.chapters.indexOf(ch) + 1;
      var chText = ch.segments.map(function (s) { return s.content; }).filter(Boolean).join("\n\n").slice(-18000);
      var prompt = [
        "即将进入新章节。请为以下章节生成独立记忆条目，返回严格 JSON，不使用 Markdown 代码块。",
        "当前归档的是第 " + chapterIndex + " 章，标题：「" + ch.title + "」。",
        '{"summary":"本章剧情摘要，必须以【第' + chapterIndex + '章】开头，不要自行编造章节编号","characters":"人物关系（全局，输出完整最新版，非增量）","worldConstants":"世界观、力量体系、不变规则（输出完整最新版，非增量）","worldEvolution":"本章涉及的状态变化（输出完整最新版，非增量）","threads":"仍未解决的目标、冲突、悬念与伏笔（输出完整最新版，非增量）","characterAttributes":"主角属性更新（输出完整最新版，非增量）"}',
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
        { role: "system", content: "你是长篇小说的连续性编辑，只维护准确、紧凑、可供后续创作使用的故事记忆。" },
        { role: "user", content: prompt }
      ], function (delta) { result += delta; }, {
        maxTokens: 1400,
        temperature: 0.2,
        thinking: "disabled",
      });
      var cleaned = result.replace(/^```json\s*|```$/g, "").trim();
      var mem = JSON.parse(cleaned);
      if (typeof mem.summary === "string" && mem.summary.trim()) {
        story.memory.chapterSummaries[ch.id] = mem.summary.trim();
      }
      // 非摘要字段：原位覆盖，不再拼接
      var mergeKeys = ["characters", "worldConstants", "worldEvolution", "threads", "characterAttributes"];
      mergeKeys.forEach(function (key) {
        if (typeof mem[key] === "string" && mem[key].trim()) {
          story.memory[key] = mem[key].trim();
        }
      });
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
  }
}

/* ---- setBusy ---- */

function setBusy(busy, text) {
  state.generating = busy;
  el.composerInput.disabled = busy;
  el.sendBtn.classList.toggle("hidden", busy);
  el.stopBtn.classList.toggle("hidden", !busy);
  el.statusText.textContent = text || (busy ? "\u6b63\u5728\u7eed\u5192\u2026" : "\u51c6\u5907\u5c31\u7eea");
  el.topLoader.classList.toggle("active", busy);
  el.topLoader.setAttribute("aria-hidden", busy ? "false" : "true");
}
