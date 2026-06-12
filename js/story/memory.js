/* ============================================================
   浮光剧场 · Memory / System Prompt
   ============================================================ */

import { state, el, getStory, getChapter, touchStory } from "../core/state.js";
import { toast } from "../core/utils.js";
import { streamCompletion } from "../core/api.js";
import { renderMemory } from "../ui/renderer.js";

export function buildSystemPrompt(story) {
  return [
    "\u4f60\u662f\u4e00\u4f4d\u6210\u719f\u7684\u4e2d\u6587\u957f\u7bc7\u5c0f\u8bf4\u4f5c\u8005\uff0c\u4e5f\u662f\u9690\u5f62\u7684\u4e92\u52a8\u53d9\u4e8b\u5f15\u64ce\u3002",
    "\u53ea\u8f93\u51fa\u53ef\u4ee5\u76f4\u63a5\u8fdb\u5165\u5c0f\u8bf4\u6b63\u6587\u7684\u5185\u5bb9\uff0c\u4e0d\u89e3\u91ca\u521b\u4f5c\u601d\u8def\uff0c\u4e0d\u4f7f\u7528 Markdown \u6807\u9898\uff0c\u4e0d\u590d\u8ff0\u7528\u6237\u6307\u4ee4\u3002",
    "\u5fc5\u987b\u627f\u63a5\u5df2\u6709\u6b63\u6587\uff0c\u4fdd\u6301\u4eba\u7269\u52a8\u673a\u3001\u7a7a\u95f4\u4f4d\u7f6e\u3001\u65f6\u95f4\u987a\u5e8f\u548c\u4fe1\u606f\u8fb9\u754c\u4e00\u81f4\u3002",
    "\u7528\u6237\u4ee5\u89d2\u8272\u8eab\u4efd\u4ecb\u5165\u65f6\uff0c\u7528\u6237\u8f93\u5165\u4e2d\u7684\u201c\u6211\u201d\u53ea\u4ee3\u8868\u5176\u626e\u6f14\u7684\u89d2\u8272\uff0c\u4e0d\u4ee3\u8868\u6b63\u6587\u5fc5\u987b\u6539\u6210\u7b2c\u4e00\u4eba\u79f0\u3002\u5c06\u7528\u6237\u660e\u786e\u63d0\u4f9b\u7684\u8a00\u884c\u89c6\u4e3a\u5df2\u7ecf\u53d1\u751f\u7684\u5267\u60c5\u4e8b\u5b9e\uff0c\u518d\u4e25\u683c\u6309\u8bbe\u7f6e\u7684\u53d9\u4e8b\u89c6\u89d2\u5199\u5165\u6b63\u6587\uff1b\u4e0d\u5f97\u56e0\u4e3a\u7528\u6237\u4f7f\u7528\u201c\u6211\u201d\u800c\u6539\u53d8\u4eba\u79f0\u3002\u5bf9\u7528\u6237\u6240\u626e\u6f14\u7684\u89d2\u8272\u5b9e\u884c\u4e25\u683c\u7684\u73a9\u5bb6\u4ee3\u7406\u6743\u8fb9\u754c\uff1a\u53ea\u80fd\u5199\u7528\u6237\u672c\u6b21\u660e\u786e\u8f93\u5165\u7684\u52a8\u4f5c\u3001\u53f0\u8bcd\u548c\u610f\u56fe\uff0c\u4e0d\u5f97\u66ff\u8be5\u89d2\u8272\u65b0\u589e\u4efb\u4f55\u52a8\u4f5c\u3001\u53f0\u8bcd\u3001\u5fc3\u7406\u5224\u65ad\u3001\u627f\u8bfa\u3001\u51b3\u5b9a\u6216\u76ee\u6807\u3002\u4e0d\u5f97\u64c5\u81ea\u5f15\u5165\u65b0\u4eba\u7269\u3001\u65b0\u7ebf\u7d22\u3001\u7a81\u53d1\u4e8b\u4ef6\u6216\u65b0\u7684\u5267\u60c5\u5206\u652f\u3002\u8f93\u51fa\u5e94\u96c6\u4e2d\u4e8e\u7528\u6237\u884c\u4e3a\u7684\u5c0f\u8bf4\u5316\u5448\u73b0\u3001\u73b0\u573a\u73af\u5883\u4e0e\u6c1b\u56f4\u3001\u53ef\u89c2\u5bdf\u7684\u52a8\u4f5c\u795e\u6001\u3001\u5176\u4ed6\u4eba\u7269\u7684\u76f4\u63a5\u53cd\u5e94\u4e0e\u5fc5\u7136\u7684\u5373\u65f6\u540e\u679c\uff0c\u5e76\u5728\u9700\u8981\u73a9\u5bb6\u7ee7\u7eed\u9009\u62e9\u6216\u56de\u7b54\u7684\u4f4d\u7f6e\u505c\u4e0b\u3002",
    "\u907f\u514d\u603b\u7ed3\u5f0f\u53d9\u4e8b\u3001\u5957\u8def\u5316\u5347\u534e\u3001\u8fde\u7eed\u53cd\u95ee\u3001\u8fc7\u5ea6\u534e\u4e3d\u6bd4\u55bb\u548c\u7a81\u5140\u53cd\u8f6c\u3002",
    "\u53d9\u4e8b\u89c6\u89d2\uff1a" + story.pov + "\u3002",
    "\u6587\u98ce\uff1a" + story.style + "\u3002",
    getLengthInstruction(story.length),
    story.genre ? "\u7c7b\u578b\uff1a" + story.genre + "\u3002" : "",
    story.premise ? "\u6545\u4e8b\u539f\u59cb\u8bbe\u5b9a\uff1a\n" + story.premise : "",
    story.playerRole ? "\u7528\u6237\u4e3b\u8981\u626e\u6f14\u89d2\u8272\uff1a" + story.playerRole + "\u3002" : "",
    story.memory.summary ? "\u957f\u671f\u5267\u60c5\u6458\u8981\uff1a\n" + story.memory.summary : "",
    story.memory.characters ? "\u4eba\u7269\u5173\u7cfb\uff1a\n" + story.memory.characters : "",
    story.memory.world ? "\u4e16\u754c\u72b6\u6001\uff1a\n" + story.memory.world : "",
    story.memory.threads ? "\u5c1a\u672a\u56de\u6536\u7684\u4f0f\u7b14\uff1a\n" + story.memory.threads : "",
    story.memory.lore ? "\u7528\u6237\u8ffd\u52a0\u8bbe\u5b9a\uff1a\n" + story.memory.lore : "",
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

export async function summarizeMemory() {
  if (state.generating) return;
  var story = getStory();
  var chapter = getChapter();
  setBusy(true, "\u6b63\u5728\u6574\u7406\u6545\u4e8b\u8bb0\u5fc6\u2026");
  try {
    var prompt = [
      "\u8bf7\u5206\u6790\u4ee5\u4e0b\u5c0f\u8bf4\u8bbe\u5b9a\u4e0e\u5f53\u524d\u6b63\u6587\uff0c\u8fd4\u56de\u4e25\u683c JSON\uff0c\u4e0d\u4f7f\u7528 Markdown \u4ee3\u7801\u5757\u3002",
      '{"summary":"\u5267\u60c5\u6458\u8981","characters":"\u4eba\u7269\u53ca\u5173\u7cfb","world":"\u5f53\u524d\u5730\u70b9\u3001\u65f6\u95f4\u3001\u7269\u54c1\u548c\u4e16\u754c\u89c4\u5219","threads":"\u5c1a\u672a\u89e3\u51b3\u7684\u60ac\u5ff5\u4e0e\u4f0f\u7b14"}',
      "\u6bcf\u4e2a\u5b57\u6bb5\u7b80\u6d01\u4f46\u4fdd\u7559\u5173\u952e\u4e8b\u5b9e\uff0c\u4e0d\u675c\u64b0\u3002",
      "\u539f\u59cb\u8bbe\u5b9a\uff1a\n" + story.premise,
      "\u5df2\u6709\u8bb0\u5fc6\uff1a\n" + JSON.stringify(story.memory),
      "\u6700\u8fd1\u6b63\u6587\uff1a\n" + recentNarrative(chapter),
    ].join("\n\n");
    var result = "";
    await streamCompletion([{ role: "system", content: "\u4f60\u662f\u5c0f\u8bf4\u8fde\u7eed\u6027\u7f16\u8f91\uff0c\u53ea\u8d1f\u8d23\u7ef4\u62a4\u51c6\u786e\u7684\u6545\u4e8b\u72b6\u6001\u3002" }, { role: "user", content: prompt }], function (delta) { result += delta; });
    var cleaned = result.replace(/^```json\s*|```$/g, "").trim();
    var memory = JSON.parse(cleaned);
    ["summary", "characters", "world", "threads"].forEach(function (key) {
      if (typeof memory[key] === "string") story.memory[key] = memory[key];
    });
    touchStory();
    renderMemory();
    toast(el.toast, "\u6545\u4e8b\u8bb0\u5fc6\u5df2\u66f4\u65b0");
  } catch (error) {
    if (error.name !== "AbortError") toast(el.toast, "\u6574\u7406\u5931\u8d25\uff1a" + error.message);
  } finally {
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

  var selectedChapters = [];
  var sourceParts = [];
  var sourceCharacters = 0;
  sourceChapters.slice().reverse().some(function (chapter) {
    var part = "【" + chapter.title + "】\n" + chapter.segments.map(function (segment) {
      return segment.content;
    }).filter(Boolean).join("\n\n");
    if (sourceParts.length && sourceCharacters + part.length > 36000) return true;
    selectedChapters.unshift(chapter);
    sourceParts.unshift(part);
    sourceCharacters += part.length;
    return false;
  });
  var sourceText = sourceParts.join("\n\n").slice(-36000);

  setBusy(true, "正在整理前文…");
  try {
    var prompt = [
      "即将进入新章节。请把尚未归档的前文合并进长期记忆，返回严格 JSON，不使用 Markdown 代码块。",
      '{"summary":"截至新章前的剧情摘要","characters":"人物身份、关系、立场与已知秘密","world":"当前时间、地点、物品、规则与人物状态","threads":"仍未解决的目标、冲突、悬念与伏笔"}',
      "已有长期记忆是可信基础。新正文若带来变化，应合并更新；不要删除仍然有效的重要事实，不得杜撰。",
      "故事原始设定：\n" + (story.premise || "无"),
      "已有长期记忆：\n" + JSON.stringify(story.memory),
      "本次待归档前文：\n" + sourceText,
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
    var memory = JSON.parse(cleaned);
    ["summary", "characters", "world", "threads"].forEach(function (key) {
      if (typeof memory[key] === "string" && memory[key].trim()) story.memory[key] = memory[key].trim();
    });
    var committedAt = new Date().toISOString();
    selectedChapters.forEach(function (chapter) { chapter.memoryCommittedAt = committedAt; });
    touchStory();
    renderMemory();
    toast(el.toast, "前文已整理，可以开始新章节");
    return true;
  } catch (error) {
    if (error.name !== "AbortError") toast(el.toast, "前文整理失败：" + error.message);
    return false;
  } finally {
    state.abortController = null;
    setBusy(false);
  }
}

function setBusy(busy, text) {
  state.generating = busy;
  el.composerInput.disabled = busy;
  el.sendBtn.classList.toggle("hidden", busy);
  el.stopBtn.classList.toggle("hidden", !busy);
  el.statusText.textContent = text || (busy ? "\u6b63\u5728\u7eed\u5199\u2026" : "\u51c6\u5907\u5c31\u7eea");
  el.topLoader.classList.toggle("active", busy);
  el.topLoader.setAttribute("aria-hidden", busy ? "false" : "true");
}
