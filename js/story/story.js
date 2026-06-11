/* ============================================================
   浮光剧场 · Story Management
   ============================================================ */

import { state, el, getStory, getChapter, touchStory, saveState, ensureActiveSelection } from "../core/state.js";
import { uid, nowIso, toast } from "../core/utils.js";
import { renderAll, renderChapterList, renderBranches, renderStory } from "../ui/renderer.js";
import { createUndoSnapshot } from "../ui/dialogs.js";

export function newChapter() {
  var story = getStory();
  if (!story) return;
  var chapter = { id: uid("chapter"), title: "\u7b2c " + (story.chapters.length + 1) + " \u7ae0", segments: [], createdAt: nowIso() };
  story.chapters.push(chapter);
  state.activeChapterId = chapter.id;
  touchStory();
  renderAll();
}

export function renameStory(storyId) {
  var story = state.stories.find(function (item) { return item.id === storyId; });
  if (!story) return;
  var name = window.prompt("故事名称", story.title || "");
  if (!name || !name.trim() || name.trim() === story.title) return;
  story.title = name.trim();
  touchStory();
  renderAll();
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

export function deleteStory(storyId) {
  var index = state.stories.findIndex(function (story) { return story.id === storyId; });
  if (index < 0) return;
  state.stories.splice(index, 1);
  if (state.activeStoryId === storyId) {
    var nextStory = state.stories[Math.min(index, state.stories.length - 1)] || null;
    state.activeStoryId = nextStory ? nextStory.id : "";
    state.activeChapterId = nextStory && nextStory.chapters[0] ? nextStory.chapters[0].id : "";
  }
  ensureActiveSelection();
  saveState();
  renderAll();
  toast(el.toast, "\u6545\u4e8b\u5df2\u5220\u9664");
}

export function renameChapter(chapterId) {
  var story = getStory();
  var chapter = story && story.chapters.find(function (item) { return item.id === chapterId; });
  if (!chapter) return;
  var name = window.prompt("\u7ae0\u8282\u540d\u79f0", chapter.title || "");
  if (!name || !name.trim() || name.trim() === chapter.title) return;
  createUndoSnapshot("\u5df2\u91cd\u547d\u540d\u7ae0\u8282");
  chapter.title = name.trim();
  touchStory();
  renderChapterList();
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

export function deleteChapter(chapterId) {
  var story = getStory();
  if (!story) return;
  if (story.chapters.length <= 1) return toast(el.toast, "\u81f3\u5c11\u4fdd\u7559\u4e00\u4e2a\u7ae0\u8282");
  var index = story.chapters.findIndex(function (chapter) { return chapter.id === chapterId; });
  if (index < 0) return;
  createUndoSnapshot("\u5df2\u5220\u9664\u7ae0\u8282");
  story.chapters.splice(index, 1);
  if (state.activeChapterId === chapterId) {
    state.activeChapterId = story.chapters[Math.max(0, index - 1)].id;
  }
  touchStory();
  renderAll();
}

export function saveBranch() {
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) return;
  story.branches.push({
    id: uid("branch"),
    name: chapter.title + " \u00b7 " + (chapter.segments.length ? "\u7b2c " + chapter.segments.length + " \u6bb5" : "\u5f00\u573a"),
    chapterId: chapter.id,
    segments: JSON.parse(JSON.stringify(chapter.segments)),
    memory: JSON.parse(JSON.stringify(story.memory)),
    createdAt: nowIso(),
  });
  touchStory();
  renderBranches();
  toast(el.toast, "\u5206\u652f\u5feb\u7167\u5df2\u4fdd\u5b58");
}

export function restoreBranch(branchId) {
  var story = getStory();
  var branch = story && story.branches.find(function (item) { return item.id === branchId; });
  if (!branch) return;
  var chapter = story.chapters.find(function (item) { return item.id === branch.chapterId; });
  if (!chapter) return;
  chapter.segments = JSON.parse(JSON.stringify(branch.segments));
  story.memory = JSON.parse(JSON.stringify(branch.memory));
  state.activeChapterId = chapter.id;
  touchStory();
  renderAll();
  closeMobilePanels();
  toast(el.toast, "\u5df2\u56de\u5230\u8be5\u5206\u652f");
}

export function deleteSegment(segmentId) {
  var found = findSegment(segmentId);
  if (!found || state.generating) return;
  createUndoSnapshot("\u5df2\u5220\u9664\u4e00\u6bb5\u6b63\u6587");
  found.chapter.segments.splice(found.index, 1);
  touchStory();
  renderAll();
}

export function rewriteFromSegment(segmentId) {
  var found = findSegment(segmentId);
  if (!found || state.generating) return;
  createUndoSnapshot("\u5df2\u4ece\u6b64\u5904\u91cd\u5199");
  found.chapter.segments.splice(found.index);
  touchStory();
  renderAll();
}

export function continueFromSegment(segmentId) {
  var found = findSegment(segmentId);
  if (!found || state.generating) return;
  if (found.index < found.chapter.segments.length - 1) {
    createUndoSnapshot("\u5df2\u5207\u6362\u5230\u6b64\u5904\u7eed\u5199");
    found.chapter.segments.splice(found.index + 1);
    touchStory();
    renderAll();
  }
}

export function findSegment(segmentId) {
  var chapter = getChapter();
  if (!chapter) return null;
  var index = chapter.segments.findIndex(function (segment) { return segment.id === segmentId; });
  return index < 0 ? null : { chapter: chapter, segment: chapter.segments[index], index: index };
}

export function closeMobilePanels() {
  el.libraryPanel.classList.remove("open");
  el.controlsPanel.classList.remove("open");
  if (el.controlsPanel.contains(document.activeElement)) document.activeElement.blur();
  el.controlsPanel.setAttribute("aria-hidden", "true");
  el.mobileBackdrop.classList.remove("show");
  var libraryToggle = document.getElementById("libraryToggle");
  if (libraryToggle && window.matchMedia("(max-width: 760px)").matches) {
    libraryToggle.setAttribute("aria-expanded", "false");
  }
}
