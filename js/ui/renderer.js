/* ============================================================
   浮光剧场 · Renderer
   ============================================================ */

import { state, settings, el, getStory, getChapter, isPristineStory } from "../core/state.js";
import { escapeHtml } from "../core/utils.js";

export function renderAll() {
  renderStoryList();
  renderChapterList();
  renderStory();
  renderControls();
  renderMemory();
  renderBranches();
}

export function renderStoryList() {
  el.storyList.innerHTML = state.stories
    .slice()
    .sort(function (a, b) { return String(b.updatedAt).localeCompare(String(a.updatedAt)); })
    .map(function (story) {
      var count = story.chapters.reduce(function (sum, chapter) {
        return sum + chapter.segments.reduce(function (s, segment) { return s + String(segment.content || "").length; }, 0);
      }, 0);
      return '<div class="story-row">' +
        '<button class="story-item ' + (story.id === state.activeStoryId ? "active" : "") + '" data-story-id="' + story.id + '">' +
        "<strong>" + escapeHtml(story.title) + "</strong><small>" + story.chapters.length + " \u7ae0 \u00b7 " + count + " \u5b57</small></button>" +
        '<div class="story-row-actions"><button class="story-mini-btn" data-story-action="rename" data-story-id="' + story.id +
        '" title="\u91cd\u547d\u540d" aria-label="\u91cd\u547d\u540d"><i data-lucide="pencil"></i></button>' +
        '<button class="story-mini-btn danger" data-story-action="delete" data-story-id="' + story.id +
        '" title="\u5220\u9664\u6545\u4e8b" aria-label="\u5220\u9664' + escapeHtml(story.title) + '"><i data-lucide="trash-2"></i></button></div></div>';
    }).join("");
}

export function renderChapterList() {
  var story = getStory();
  el.chapterList.innerHTML = story ? story.chapters.map(function (chapter, index) {
    var words = chapter.segments.reduce(function (sum, segment) { return sum + String(segment.content || "").length; }, 0);
    return '<div class="chapter-row"><button class="chapter-item ' + (chapter.id === state.activeChapterId ? "active" : "") + '" data-chapter-id="' + chapter.id + '">' +
      "<strong>" + escapeHtml(chapter.title || ("\u7b2c " + (index + 1) + " \u7ae0")) + "</strong><small>" + words + " \u5b57</small></button>" +
      '<div class="chapter-row-actions"><button class="chapter-mini-btn" data-chapter-action="rename" data-chapter-id="' + chapter.id + '" title="\u91cd\u547d\u540d"><i data-lucide="pencil"></i></button>' +
      '<button class="chapter-mini-btn danger" data-chapter-action="delete" data-chapter-id="' + chapter.id + '" title="\u5220\u9664\u7ae0\u8282"><i data-lucide="trash-2"></i></button></div></div>';
  }).join("") : "";
}

export function segmentHtml(segment, speechOffset, isLast) {
  var content = escapeHtml(segment.content || "");
  var paragraphs = content.split(/\n\s*\n+/).filter(Boolean);
  var offset = Number(speechOffset) || 0;
  var actions = segment.streaming ? "" : '<div class="segment-actions">' +
    '<button class="segment-action" data-segment-action="edit" title="\u7f16\u8f91\u539f\u6587"><i data-lucide="pencil"></i></button>' +
    '<button class="segment-action" data-segment-action="rewrite" title="\u91cd\u5199\u6b64\u6bb5"><i data-lucide="refresh-cw"></i></button>' +
    (isLast
      ? '<button class="segment-action" data-segment-action="continue" title="\u7eed\u5199"><i data-lucide="fast-forward"></i></button>'
      : '<button class="segment-action" data-segment-action="insert" title="\u5728\u6b64\u5904\u63d2\u5199"><i data-lucide="between-horizontal-start"></i></button>') +
    '<button class="segment-action danger" data-segment-action="delete" title="\u5220\u9664\u6b64\u6bb5"><i data-lucide="trash-2"></i></button></div>';
  return '<div class="segment ' + (segment.streaming ? "streaming" : "") + '" data-segment-id="' + segment.id + '">' + actions +
    paragraphs.map(function (paragraph, index) {
      return '<p class="speech-block" data-speech-index="' + (offset + index) + '">' +
        paragraph.replace(/\n/g, "<br>") + "</p>";
    }).join("") + "</div>";
}

export function renderStory(options) {
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) {
    document.body.classList.add("welcome-mode");
    el.emptyState.classList.remove("hidden");
    el.storyContent.innerHTML = "";
    el.storyTitle.textContent = "";
    el.storyMeta.textContent = "";
    return;
  }
  var hasContent = chapter.segments.some(function (segment) { return segment.content; });
  var hasStarted = Boolean(story.started || story.premise || chapter.segments.length || state.generating);
  var welcomeMode = isPristineStory(story);
  document.body.classList.toggle("welcome-mode", welcomeMode);
  el.emptyState.classList.toggle("hidden", hasContent || hasStarted);
  var speechOffset = 0;
  el.storyContent.innerHTML = chapter.segments.map(function (segment, index) {
    var html = segmentHtml(segment, speechOffset, index === chapter.segments.length - 1);
    speechOffset += String(segment.content || "").split(/\n\s*\n+/).filter(Boolean).length;
    return html;
  }).join("");
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  el.storyTitle.textContent = story.title;
  var words = chapter.segments.reduce(function (sum, segment) { return sum + String(segment.content || "").length; }, 0);
  var chapterIndex = story.chapters.findIndex(function (item) { return item.id === chapter.id; }) + 1;
  el.storyMeta.textContent = "\u7b2c " + chapterIndex + " \u7ae0 \u00b7 " + words + " \u5b57";
  if (options && options.toBottom) {
    requestAnimationFrame(function () { el.readerViewport.scrollTop = el.readerViewport.scrollHeight; });
  }
}

export function renderControls() {
  document.documentElement.dataset.theme = settings.theme;
  var story = getStory();
  if (!story) return;
  el.povSelect.value = story.pov || "\u7b2c\u4e09\u4eba\u79f0\u9650\u77e5";
  el.lengthSelect.value = story.length || "medium";
  el.styleInput.value = story.style || "";
  el.playerRoleInput.value = story.playerRole || "";
  el.premiseInput.value = story.premise || "";
  el.autoContinueToggle.checked = Boolean(story.autoContinue);
  el.autoTtsToggle.checked = Boolean(story.autoTts);
}

export function renderMemory() {
  var story = getStory();
  if (!story) return;
  ["summary", "characters", "world", "threads"].forEach(function (key) {
    var target = document.getElementById(key + "Memory");
    target.textContent = story.memory[key] || "\u5c1a\u672a\u8bb0\u5f55\u3002";
  });
}

export function renderBranches() {
  var story = getStory();
  el.branchList.innerHTML = story && story.branches.length ? story.branches.slice().reverse().map(function (branch) {
    return '<button class="branch-item" data-branch-id="' + branch.id + '"><strong>' + escapeHtml(branch.name) +
      "</strong><small>" + new Date(branch.createdAt).toLocaleString() + "</small></button>";
  }).join("") : '<small>\u8fd8\u6ca1\u6709\u4fdd\u5b58\u5206\u652f\u3002</small>';
}
