/* ============================================================
   浮光剧场 · Import / Export
   ============================================================ */

import { state, el, getStory, saveState, createStoryData, isPristineStory, normalizePov } from "../core/state.js";
import { uid, nowIso, toast } from "../core/utils.js";
import { renderAll } from "../ui/renderer.js";

export function exportStory() {
  var story = getStory();
  if (!story) return;
  var payload = JSON.stringify({ type: "floating-story-studio", version: 1, story: story }, null, 2);
  downloadFile((story.title || "\u6545\u4e8b") + ".story.json", payload, "application/json");
}

function downloadFile(name, content, type) {
  var blob = new Blob([content], { type: type + ";charset=utf-8" });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
}

export async function importFile(file) {
  var text = await file.text();
  state.stories = state.stories.filter(function (item) { return !isPristineStory(item); });
  if (/\.json$/i.test(file.name)) {
    var data = safeParse(text, null);
    var story = data && (data.story || data);
    if (!story || !Array.isArray(story.chapters)) throw new Error("\u4e0d\u662f\u6709\u6548\u7684\u6545\u4e8b\u6587\u4ef6");
    story.id = uid("story");
    story.title = story.title || file.name.replace(/\.[^.]+$/, "");
    story.pov = normalizePov(story.pov);
    state.stories.push(story);
    state.activeStoryId = story.id;
    state.activeChapterId = story.chapters[0].id;
  } else {
    var imported = createStoryData(file.name.replace(/\.[^.]+$/, ""), "", "", "");
    imported.chapters[0].segments.push({ id: uid("segment"), type: "narrative", content: text, createdAt: nowIso() });
    state.stories.push(imported);
    state.activeStoryId = imported.id;
    state.activeChapterId = imported.chapters[0].id;
  }
  saveState();
  renderAll();
  toast(el.toast, "\u5bfc\u5165\u5b8c\u6210");
}

function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}
