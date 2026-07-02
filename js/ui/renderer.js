/* ============================================================
   浮光剧场 · Renderer
   ============================================================ */

import { state, settings, el, getStory, getChapter, isPristineStory, applyReaderSettings } from "../core/state.js";
import { escapeHtml } from "../core/utils.js";
import { stripVoiceMarkers } from "../core/speech-track.js";
import { parseRelationGraph } from "./relation-graph.js";
import { getAllStories } from "../core/db.js";

export function renderAll() {
  renderStoryList();
  renderChapterList();
  renderStory();
  renderControls();
  renderMemory();
  renderBranches();
  renderTrashList();
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

export async function renderTrashList() {
  if (!el.trashList) return;
  try {
    var all = await getAllStories();
    var trashStories = all.filter(function (s) { return s.trash; });
    el.trashList.innerHTML = trashStories.length === 0
      ? '<div style="padding: 24px; text-align: center; color: var(--text-tertiary); font-size: 13px;">回收站是空的</div>'
      : trashStories
          .sort(function (a, b) { return String(b.deletedAt || b.updatedAt).localeCompare(String(a.deletedAt || a.updatedAt)); })
          .map(function (story) {
            return '<div class="story-row">' +
              '<div class="story-item" style="cursor: default; opacity: 0.8; flex: 1;">' +
              '<strong>' + escapeHtml(story.title) + '</strong>' +
              '<small style="margin-top: 4px; display: block; color: var(--text-tertiary);">删除于: ' + new Date(story.deletedAt || story.updatedAt).toLocaleString() + '</small>' +
              '</div>' +
              '<div class="story-row-actions" style="opacity: 1;">' +
              '<button class="story-mini-btn" data-trash-action="restore" data-story-id="' + story.id + '" title="还原故事" aria-label="还原故事"><i data-lucide="rotate-ccw"></i></button>' +
              '<button class="story-mini-btn danger" data-trash-action="purge" data-story-id="' + story.id + '" title="彻底删除" aria-label="彻底删除"><i data-lucide="trash-2"></i></button>' +
              '</div></div>';
          }).join("");
          
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  } catch (err) {
    console.error("加载回收站列表失败:", err);
  }
}

export function renderChapterList() {
  var story = getStory();
  el.chapterList.innerHTML = story ? story.chapters.map(function (chapter, index) {
    var isActive = chapter.id === state.activeChapterId;
    var words = chapter.segments.reduce(function (sum, segment) { return sum + String(segment.content || "").length; }, 0);
    
    var metaRow = "";
    var progressBar = "";
    
    if (isActive) {
      var goal = story.chapterWordGoal || 0;
      var wordLabel = goal > 0
        ? (words + " / " + goal + " \u5b57")
        : (words + " \u5b57");
      
      var goalBadge = "";
      if (goal > 0) {
        var reached = words >= goal;
        if (reached) {
          if (words >= goal * 1.5) {
            goalBadge = '<small class="goal-badge warning">\u5b57\u6570\u8fc7\u591a</small>';
          } else {
            goalBadge = '<small class="goal-badge">\u2713 \u8fbe\u6807</small>';
          }
        }
        
        var pct = Math.min(100, Math.round(words / goal * 100));
        progressBar = '<div class="chapter-word-progress" title="' + words + ' / ' + goal + ' \u5b57">' +
          '<div class="chapter-word-bar' + (reached ? " reached" : "") + '" style="width:' + pct + '%"></div>' +
          '</div>';
      }
      metaRow = '<span class="chapter-meta-row"><small>' + wordLabel + '</small>' + goalBadge + '</span>';
    } else {
      // Inactive chapters: clean view, just show words, no bars
      metaRow = '<span class="chapter-meta-row"><small style="color: var(--text-tertiary); opacity: 0.75;">' + words + ' \u5b57</small></span>';
    }
    
    return '<div class="chapter-row"><button class="chapter-item ' + (isActive ? "active" : "") + '" data-chapter-id="' + chapter.id + '">' +
      "<strong>" + escapeHtml(chapter.title || ("\u7b2c " + (index + 1) + " \u7ae0")) + "</strong>" +
      metaRow +
      progressBar +
      '</button>' +
      '<div class="chapter-row-actions"><button class="chapter-mini-btn" data-chapter-action="rename" data-chapter-id="' + chapter.id + '" title="\u91cd\u547d\u540d"><i data-lucide="pencil"></i></button>' +
      '<button class="chapter-mini-btn danger" data-chapter-action="delete" data-chapter-id="' + chapter.id + '" title="\u5220\u9664\u7ae0\u8282"><i data-lucide="trash-2"></i></button></div></div>';
  }).join("") : "";
  
  setTimeout(scrollActiveChapterIntoView, 50);
}

export function scrollActiveChapterIntoView() {
  if (!el.chapterList) return;
  var activeItem = el.chapterList.querySelector(".chapter-item.active");
  if (!activeItem) return;
  var activeRow = activeItem.closest(".chapter-row") || activeItem;
  var container = activeRow.closest(".library-panel-body");
  if (!container || container.clientHeight === 0) return;
  
  // Calculate static layout offset relative to the scroll container
  var relativeTop = activeRow.offsetTop;
  var parent = activeRow.offsetParent;
  while (parent && parent !== container && container.contains(parent)) {
    relativeTop += parent.offsetTop;
    parent = parent.offsetParent;
  }
  
  var targetScrollTop = relativeTop - (container.clientHeight / 2) + (activeRow.offsetHeight / 2) + 20;
  
  container.scrollTo({
    top: Math.max(0, targetScrollTop),
    behavior: "smooth"
  });
}

export function segmentHtml(segment, speechOffset, isLast) {
  var content = stripVoiceMarkers(segment.content || "");
  content = escapeHtml(content);
  var paragraphs = content.split(/\n\s*\n+/).filter(Boolean);
  var offset = Number(speechOffset) || 0;
  var actions = segment.streaming ? "" : '<div class="segment-actions">' +
    '<button class="segment-action" data-segment-action="readFromHere" title="\u4ece\u6b64\u5904\u5f00\u59cb\u8bfb"><i data-lucide="play"></i></button>' +
    '<button class="segment-action" data-segment-action="copy" title="\u590d\u5236\u672c\u6bb5"><i data-lucide="copy"></i></button>' +
    '<button class="segment-action" data-segment-action="edit" title="\u7f16\u8f91\u539f\u6587"><i data-lucide="pencil"></i></button>' +
    '<button class="segment-action" data-segment-action="rewrite" title="\u91cd\u5199\u6b64\u6bb5"><i data-lucide="refresh-cw"></i></button>' +
    (isLast
      ? '<button class="segment-action" data-segment-action="continue" title="\u7eed\u5199"><i data-lucide="fast-forward"></i></button>'
      : '<button class="segment-action" data-segment-action="insert" title="\u5728\u6b64\u5904\u63d2\u5199"><i data-lucide="between-horizontal-start"></i></button>') +
    '<button class="segment-action danger" data-segment-action="delete" title="\u5220\u9664\u6b64\u6bb5"><i data-lucide="trash-2"></i></button></div>';
  return '<div class="segment ' + (segment.streaming ? "streaming" : "") + '" data-segment-id="' + segment.id + '">' + actions +
    paragraphs.map(function (paragraph, index) {
      var commentCount = (segment.paragraphComments && segment.paragraphComments[index]) ? segment.paragraphComments[index].length : 0;
      var commentBubble = commentCount > 0
        ? '<span class="inline-comment-bubble" data-segment-id="' + segment.id + '" data-p-index="' + index + '"><i data-lucide="message-circle"></i><span>' + commentCount + '</span></span>'
        : '';
      return '<p class="speech-block" data-speech-index="' + (offset + index) + '">' +
        paragraph.replace(/\n/g, "<br>") + commentBubble + "</p>";
    }).join("") + "</div>";
}

var lastRenderedChapterId = null;

export function renderStory(options) {
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) {
    document.body.classList.add("welcome-mode");
    el.emptyState.classList.remove("hidden");
    el.storyContent.innerHTML = "";
    el.storyTitle.textContent = "";
    el.storyMeta.textContent = "";
    lastRenderedChapterId = null;
    return;
  }
  var shouldScrollToBottom = false;
  if (options && options.toBottom) {
    shouldScrollToBottom = true;
  } else if (chapter.id !== lastRenderedChapterId) {
    shouldScrollToBottom = true;
  }
  lastRenderedChapterId = chapter.id;

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
  applyReaderSettings();
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  el.storyTitle.textContent = story.title;
  var words = chapter.segments.reduce(function (sum, segment) { return sum + String(segment.content || "").length; }, 0);
  var chapterIndex = story.chapters.findIndex(function (item) { return item.id === chapter.id; }) + 1;
  el.storyMeta.textContent = "\u7b2c " + chapterIndex + " \u7ae0 \u00b7 " + words + " \u5b57";
  if (shouldScrollToBottom) {
    requestAnimationFrame(function () {
      var rv = el.readerViewport;
      rv.dataset.programmaticScroll = '1';
      rv.style.scrollBehavior = 'auto';
      rv.scrollTop = rv.scrollHeight;
      rv.style.removeProperty('scroll-behavior');
    });
  }
}

function syncThemeColor() {
  var light = settings.theme === "light";
  var themeColor = light ? "#f7f7f9" : "#000000";
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  var metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaTheme) metaTheme.content = themeColor;
  if (metaScheme) metaScheme.content = light ? "light" : "dark";
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  document.documentElement.style.backgroundColor = themeColor;
}

export function renderControls() {
  document.documentElement.dataset.theme = settings.theme;
  syncThemeColor();
  var story = getStory();
  if (!story) return;
  el.povDisplay.textContent = story.pov || "\u7b2c\u4e09\u4eba\u79f0";
  el.lengthSelect.value = story.length || "medium";
  el.styleInput.value = story.style || "";
  el.playerRoleInput.value = story.playerRole || "";
  el.playerRoleInput.disabled = false;
  el.playerRoleInput.removeAttribute("title");
  el.playerRoleInput.placeholder = "例如：沈砚";

  el.premiseInput.value = story.premise || "";
  el.autoContinueToggle.checked = Boolean(story.autoContinue);
  el.autoTtsToggle.checked = Boolean(story.autoTts);
  if (el.chapterWordGoalInput) {
    el.chapterWordGoalInput.value = story.chapterWordGoal > 0 ? story.chapterWordGoal : "";
  }
}

export function renderMemory() {
  var story = getStory();
  if (!story) return;
  // 故事摘要：分章节折叠面板
  var elSummary = document.getElementById("summaryMemory");
  if (elSummary) {
    var chapterMap = {};
    (story.chapters || []).forEach(function (ch) { chapterMap[ch.id] = ch.title; });
    var keys = Object.keys(story.memory.chapterSummaries || {});
    if (!keys.length) {
      elSummary.textContent = "尚未整理。";
    } else {
      elSummary.innerHTML = "";
      var currentCh = typeof getChapter === "function" ? getChapter() : null;
      keys.forEach(function (cid) {
        var title = chapterMap[cid] || cid;
        if (title === "__legacy__") title = "早期摘要";
        var content = story.memory.chapterSummaries[cid] || "";

        var details = document.createElement("details");
        details.className = "summary-chapter-details";
        if (currentCh && currentCh.id === cid) {
          details.open = true;
        }

        var summary = document.createElement("summary");
        summary.className = "summary-chapter-title";
        summary.textContent = title;

        var body = document.createElement("div");
        body.className = "summary-chapter-body";
        body.textContent = content || "无内容";

        details.appendChild(summary);
        details.appendChild(body);
        elSummary.appendChild(details);
      });
    }
  }
  // 人物关系：解析为易读格式
  var charsEl = document.getElementById("charactersMemory");
  if (charsEl) {
    var raw = story.memory.characters;
    if (raw && (Array.isArray(raw) || (typeof raw === "string" && raw.trim()))) {
      var parsed = parseRelationGraph(raw);
      if (parsed && parsed.nodes.length) {
        var nodeRelMap = {};
        parsed.nodes.forEach(function (n) { nodeRelMap[n.id] = { name: n.label, rels: [] }; });
        parsed.edges.forEach(function (e) {
          var fromNode = nodeRelMap[e.from];
          var toNode = nodeRelMap[e.to];
          if (fromNode) fromNode.rels.push({ label: e.label, target: toNode ? toNode.name : "?" });
          if (toNode) toNode.rels.push({ label: e.label, target: fromNode ? fromNode.name : "?" });
        });
        var lines = [];
        parsed.nodes.forEach(function (n) {
          var info = nodeRelMap[n.id];
          if (!info) return;
          var relStr = info.rels.length
            ? info.rels.map(function (r) { return r.label + " → " + r.target; }).join("；")
            : "独立角色";
          lines.push(escapeHtml(info.name) + "：" + relStr);
        });
        charsEl.textContent = lines.join("\n");
      } else {
        charsEl.textContent = raw;
      }
    } else {
      charsEl.textContent = "尚未记录。";
    }
  }
  // 其余单字段
  var plainFields = [
    { key: "worldState", fallbacks: ["worldConstants"] },
    { key: "plotThreads", fallbacks: ["threads"] },
    { key: "lore", fallbacks: [] }
  ];
  plainFields.forEach(function (field) {
    var target = document.getElementById(field.key + "Memory");
    if (target) {
      var val = story.memory[field.key];
      if (!val) {
        for (var i = 0; i < field.fallbacks.length; i++) {
          if (story.memory[field.fallbacks[i]]) {
            val = story.memory[field.fallbacks[i]];
            break;
          }
        }
      }
      target.textContent = val || "尚未记录。";
    }
  });
}

export function renderBranches() {
  var story = getStory();
  el.branchList.innerHTML = story && story.branches.length ? story.branches.slice().reverse().map(function (branch) {
    return '<button class="branch-item" data-branch-id="' + branch.id + '"><strong>' + escapeHtml(branch.name) +
      "</strong><small>" + new Date(branch.createdAt).toLocaleString() + "</small></button>";
  }).join("") : '<small>\u8fd8\u6ca1\u6709\u4fdd\u5b58\u5206\u652f\u3002</small>';
}
