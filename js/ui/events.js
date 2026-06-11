/* ============================================================
   浮光剧场 · Events
   ============================================================ */

import { state, settings, el, getStory, getChapter, touchStory, saveState, saveSettings, createStoryData, isPristineStory } from "../core/state.js";
import { uid, nowIso, toast, setBusy } from "../core/utils.js";
import { renderAll, renderStory, renderStoryList, renderChapterList, renderControls, renderMemory, renderBranches } from "./renderer.js";
import { openSettings, saveSettingsForm, readMoyuSettings, syncTtsProviderFields, openSegmentEditor, saveSegmentEdit, createUndoSnapshot, undoLastChange } from "./dialogs.js";
import { speakText, stopSpeech, toggleSpeech, playFromIndex, populateVoices } from "../core/tts.js";
import { newChapter, renameChapter, deleteChapter, renameStory, deleteStory, saveBranch, restoreBranch, deleteSegment, rewriteFromSegment, continueFromSegment, closeMobilePanels } from "../story/story.js";
import { summarizeMemory, recentNarrative, looksNarrativeIncomplete, getLengthMaxTokens, buildSystemPrompt } from "../story/memory.js";
import { exportStory, importFile } from "../story/import-export.js";
import { streamCompletion } from "../core/api.js";

function isReaderNearBottom() {
  return el.readerViewport.scrollHeight - el.readerViewport.scrollTop - el.readerViewport.clientHeight < 120;
}

async function generateNarrative(instruction, source, metadata) {
  if (state.generating) return;
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) return;
  story.started = true;
  var segment = {
    id: uid("segment"),
    type: "narrative",
    content: "",
    streaming: true,
    sourceInput: metadata && metadata.sourceInput || "",
    createdAt: nowIso()
  };
  chapter.segments.push(segment);
  renderStory({ toBottom: true });
  setBusy(el, true, source === "rewrite" ? "\u6b63\u5728\u91cd\u5199\u2026" : "\u6545\u4e8b\u6b63\u5728\u7ee7\u7eed\u2026");
  try {
    var messages = [
      { role: "system", content: buildSystemPrompt(story) },
      { role: "user", content: "\u4ee5\u4e0b\u662f\u5f53\u524d\u7ae0\u8282\u6700\u8fd1\u7684\u6b63\u6587\uff1a\n\n" + (recentNarrative(chapter) || "\u5c1a\u65e0\u6b63\u6587\u3002") +
        "\n\n\u63a5\u4e0b\u6765\u8bf7\u6267\u884c\uff1a" + (instruction || "\u81ea\u7136\u7eed\u5199\u6545\u4e8b\uff0c\u63a8\u8fdb\u5f53\u524d\u573a\u666f\u3002") }
    ];
    var completion = await streamCompletion(messages, function (delta) {
      var shouldFollow = isReaderNearBottom();
      segment.content += delta;
      renderStory({ toBottom: shouldFollow });
    }, { maxTokens: getLengthMaxTokens(story.length) });
    if (
      segment.content.trim() &&
      (["length", "max_tokens"].includes(completion.finishReason) || looksNarrativeIncomplete(segment.content))
    ) {
      el.statusText.textContent = "\u6b63\u5728\u8865\u5168\u7ed3\u5c3e\u2026";
      await completeTruncatedNarrative(story, segment);
    }
    segment.streaming = false;
    if (!segment.content.trim()) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    touchStory();
    renderAll();
    if (segment.content && story.autoTts) speakText(segment.content, true);
    if (story.autoContinue && !state.abortController.signal.aborted) {
      setTimeout(function () { generateNarrative("\u7ee7\u7eed\u81ea\u7136\u63a8\u8fdb\u6545\u4e8b\uff0c\u4e0d\u8981\u91cd\u590d\u4e0a\u4e00\u6bb5\u5185\u5bb9\u3002", "auto"); }, 800);
    }
  } catch (error) {
    segment.streaming = false;
    if (!segment.content) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    if (error.name !== "AbortError") toast(el.toast, "\u751f\u6210\u5931\u8d25\uff1a" + error.message);
    renderAll();
  } finally {
    state.abortController = null;
    setBusy(el, false);
  }
}

async function completeTruncatedNarrative(story, segment) {
  var tail = segment.content.slice(-1200);
  var result = await streamCompletion([
    {
      role: "system",
      content: [
        "\u4f60\u662f\u4e2d\u6587\u5c0f\u8bf4\u65ad\u53e5\u4fee\u590d\u5668\u3002",
        "\u53ea\u8865\u5b8c\u8f93\u5165\u672b\u5c3e\u88ab\u622a\u65ad\u7684\u5f53\u524d\u53e5\u5b50\uff0c\u5fc5\u8981\u65f6\u518d\u8865\u4e00\u4e24\u53e5\u8ba9\u5f53\u524d\u5c0f\u6bb5\u81ea\u7136\u505c\u4f4f\u3002",
        "\u7981\u6b62\u5f00\u542f\u65b0\u60c5\u8282\uff0c\u7981\u6b62\u590d\u8ff0\u5df2\u6709\u6587\u5b57\uff0c\u7981\u6b62\u89e3\u91ca\uff0c\u76f4\u63a5\u8f93\u51fa\u9700\u8981\u8ffd\u52a0\u7684\u6b63\u6587\u3002",
        "\u4fdd\u6301\u53d9\u4e8b\u89c6\u89d2\u4e0e\u6587\u98ce\uff1a" + story.pov + "\uff1b" + story.style
      ].join("\n")
    },
    { role: "user", content: "\u4ee5\u4e0b\u6b63\u6587\u672b\u5c3e\u88ab\u622a\u65ad\uff0c\u8bf7\u53ea\u8f93\u51fa\u5e94\u5f53\u8ffd\u52a0\u7684\u90e8\u5206\uff1a\n\n" + tail }
  ], function (delta) {
    var shouldFollow = isReaderNearBottom();
    segment.content += delta;
    renderStory({ toBottom: shouldFollow });
  }, { maxTokens: 260 });
  return result;
}

async function submitComposer() {
  var value = el.composerInput.value.trim();
  if (!value || state.generating) return;
  var story = getStory();
  var chapter = getChapter();
  el.composerInput.value = "";
  if (state.inputMode === "lore") {
    story.memory.lore = [story.memory.lore, value].filter(Boolean).join("\n");
    touchStory();
    renderMemory();
    toast(el.toast, "\u8bbe\u5b9a\u5df2\u5199\u5165\u957f\u671f\u8bb0\u5fc6");
    return;
  }
  if (state.inputMode === "role") {
    await generateNarrative(
      [
        "\u7528\u6237\u4ee5\u89d2\u8272\u201c" + (story.playerRole || "\u5f53\u524d\u4e3b\u89d2") + "\u201d\u63d0\u4f9b\u4e86\u4e00\u6bb5\u5267\u60c5\u8349\u7a3f\uff1a",
        value,
        "",
        "\u8bf7\u628a\u8fd9\u6bb5\u8349\u7a3f\u89c6\u4e3a\u786e\u5b9a\u53d1\u751f\u7684\u4e8b\u5b9e\u3002\u8f93\u51fa\u65f6\u5148\u5c06\u5b83\u6da6\u8272\u3001\u6269\u5199\u6210\u53ef\u76f4\u63a5\u63a5\u5728\u524d\u6587\u4e4b\u540e\u7684\u5c0f\u8bf4\u6b63\u6587\uff0c\u518d\u7ee7\u7eed\u63cf\u5199\u73af\u5883\u548c\u5176\u4ed6\u4eba\u7269\u7684\u81ea\u7136\u53cd\u5e94\u3002",
        "\u6da6\u8272\u90e8\u5206\u5fc5\u987b\u670d\u4ece\u5f53\u524d\u53d9\u4e8b\u89c6\u89d2\uff1a\u524d\u6587\u662f\u7b2c\u4e00\u4eba\u79f0\u5c31\u4f7f\u7528\u201c\u6211\u201d\uff0c\u524d\u6587\u662f\u7b2c\u4e09\u4eba\u79f0\u5c31\u4f7f\u7528\u89d2\u8272\u59d3\u540d\u6216\u5408\u9002\u4ee3\u8bcd\u3002",
        "\u4fdd\u6301\u524d\u6587\u6587\u98ce\u3001\u65f6\u6001\u3001\u8bed\u6c14\u548c\u4fe1\u606f\u8fb9\u754c\uff0c\u4e0d\u663e\u793a\u89d2\u8272\u6807\u7b7e\uff0c\u4e0d\u5f15\u7528\u539f\u59cb\u8f93\u5165\uff0c\u4e0d\u89e3\u91ca\u6539\u5199\u8fc7\u7a0b\uff0c\u4e5f\u4e0d\u8981\u66ff\u8be5\u89d2\u8272\u65b0\u589e\u91cd\u5927\u51b3\u5b9a\u3002"
      ].join("\n"),
      "role",
      { sourceInput: value }
    );
    return;
  }
  await generateNarrative("\u5267\u60c5\u6307\u4ee4\uff1a" + value + "\n\u81ea\u7136\u843d\u5b9e\u5230\u540e\u7eed\u6b63\u6587\u4e2d\uff0c\u4e0d\u8981\u63d0\u53ca\u8fd9\u6761\u6307\u4ee4\u3002", "director");
}

function stopGeneration() {
  if (state.abortController) state.abortController.abort();
  var chapter = getChapter();
  if (chapter) chapter.segments.forEach(function (segment) { segment.streaming = false; });
  setBusy(el, false, "\u5df2\u505c\u6b62");
  touchStory();
  renderStory();
}

function rewriteLast() {
  var chapter = getChapter();
  if (!chapter || state.generating) return;
  var index = -1;
  for (var i = chapter.segments.length - 1; i >= 0; i -= 1) {
    if (chapter.segments[i].type === "narrative") { index = i; break; }
  }
  if (index < 0) return toast(el.toast, "\u8fd8\u6ca1\u6709\u53ef\u91cd\u5199\u7684\u6b63\u6587");
  createUndoSnapshot("\u5df2\u91cd\u5199\u672b\u6bb5");
  chapter.segments.splice(index, 1);
  touchStory();
  renderStory();
  generateNarrative("\u91cd\u65b0\u5199\u521a\u624d\u5e94\u5f53\u53d1\u751f\u7684\u540e\u7eed\u3002\u91c7\u7528\u4e0d\u540c\u4f46\u5408\u7406\u7684\u53d1\u5c55\uff0c\u907f\u514d\u590d\u7528\u521a\u624d\u7684\u63aa\u8f9e\u3002", "rewrite");
}

function resetInlineConfirm(exceptButton) {
  document.querySelectorAll("[data-confirming='true']").forEach(function (button) {
    if (button === exceptButton) return;
    clearTimeout(Number(button.dataset.confirmTimer) || 0);
    button.dataset.confirming = "false";
    button.classList.remove("confirming");
    button.innerHTML = button.dataset.originalHtml || button.innerHTML;
  });
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

function requestInlineConfirm(button, action) {
  if (button.dataset.confirming === "true") {
    clearTimeout(Number(button.dataset.confirmTimer) || 0);
    resetInlineConfirm();
    action();
    return;
  }
  resetInlineConfirm(button);
  button.dataset.originalHtml = button.innerHTML;
  button.dataset.confirming = "true";
  button.classList.add("confirming");
  button.innerHTML = '<i data-lucide="check"></i><span class="confirm-label">\u786e\u8ba4</span>';
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  button.dataset.confirmTimer = String(setTimeout(function () {
    resetInlineConfirm();
  }, 3000));
}

function syncComposerHeight() {
  var composer = document.querySelector(".composer");
  if (!composer) return;
  document.documentElement.style.setProperty("--composer-height", composer.getBoundingClientRect().height + "px");
}

function openMobilePanel(name) {
  closeMobilePanels();
  var panel = name === "library" ? el.libraryPanel : el.controlsPanel;
  panel.classList.add("open");
  if (panel === el.controlsPanel) panel.setAttribute("aria-hidden", "false");
  el.mobileBackdrop.classList.add("show");
}

function setLibraryOpen(open) {
  var mobile = window.matchMedia("(max-width: 760px)").matches;
  if (mobile) {
    if (open) openMobilePanel("library");
    else closeMobilePanels();
  } else {
    document.body.classList.toggle("library-collapsed", !open);
  }
  document.getElementById("libraryToggle").setAttribute("aria-expanded", open ? "true" : "false");
}

function setAudioPanelOpen(open) {
  el.playerBar.classList.toggle("open", open);
  el.playerBar.setAttribute("aria-hidden", open ? "false" : "true");
  el.audioPanelToggle.classList.toggle("active", open);
  el.audioPanelToggle.setAttribute("aria-expanded", open ? "true" : "false");
}

function applyStoryControl(field, value) {
  var story = getStory();
  if (!story) return;
  story[field] = value;
  touchStory();
}

function plainStoryText(story) {
  return story.chapters.map(function (chapter) {
    var body = chapter.segments.map(function (segment) {
      return segment.content;
    }).join("\n\n");
    return "# " + chapter.title + "\n\n" + body;
  }).join("\n\n---\n\n");
}

export function bindEvents() {
  var pendingDeleteStoryId = "";
  document.getElementById("newStoryBtn").addEventListener("click", function () { el.setupDialog.showModal(); });
  document.getElementById("emptyStartBtn").addEventListener("click", function () { el.setupDialog.showModal(); });
  document.getElementById("addChapterBtn").addEventListener("click", newChapter);
  document.getElementById("settingsBtn").addEventListener("click", function () { openSettings(); });
  document.getElementById("themeBtn").addEventListener("click", function () {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    saveSettings();
    var btn = document.getElementById("themeBtn");
    btn.innerHTML = "";
    btn.appendChild(lucide.createElement(settings.theme === "dark" ? lucide.Sun : lucide.Moon));
    renderControls();
  });
  document.getElementById("focusBtn").addEventListener("click", function () { document.body.classList.toggle("focus-mode"); });
  document.getElementById("exitFocusBtn").addEventListener("click", function () { document.body.classList.remove("focus-mode"); });
  document.getElementById("libraryToggle").addEventListener("click", function () {
    var mobile = window.matchMedia("(max-width: 760px)").matches;
    var open = mobile ? !el.libraryPanel.classList.contains("open") : document.body.classList.contains("library-collapsed");
    setLibraryOpen(open);
  });
  document.getElementById("controlsBtn").addEventListener("click", function () { openMobilePanel("controls"); });
  el.audioPanelToggle.addEventListener("click", function () {
    setAudioPanelOpen(!el.playerBar.classList.contains("open"));
  });
  document.getElementById("audioPanelClose").addEventListener("click", function () { setAudioPanelOpen(false); });
  el.mobileBackdrop.addEventListener("click", closeMobilePanels);
  document.querySelectorAll("[data-close-panel]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.closePanel === "library") setLibraryOpen(false);
      else closeMobilePanels();
    });
  });
  document.querySelectorAll("[data-close-dialog]").forEach(function (button) {
    button.addEventListener("click", function () {
      var dialog = document.getElementById(button.dataset.closeDialog);
      if (dialog && dialog.open) dialog.close();
    });
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") {
      resetInlineConfirm();
    }
    if (event.key === "Escape" && document.body.classList.contains("focus-mode")) {
      document.body.classList.remove("focus-mode");
    }
  });
  document.addEventListener("click", function (event) {
    if (!event.target.closest("[data-confirming='true']")) {
      resetInlineConfirm();
    }
  });

  el.storyList.addEventListener("click", function (event) {
    var actionButton = event.target.closest("[data-story-action]");
    if (actionButton) {
      if (actionButton.dataset.storyAction === "delete") {
        var story = state.stories.find(function (item) { return item.id === actionButton.dataset.storyId; });
        if (!story) return;
        pendingDeleteStoryId = story.id;
        el.deleteStoryName.textContent = story.title || "\u672a\u547d\u540d\u6545\u4e8b";
        el.deleteStoryDialog.showModal();
        return;
      }
      if (actionButton.dataset.storyAction === "rename") {
        renameStory(actionButton.dataset.storyId);
        return;
      }
    }
    var button = event.target.closest("[data-story-id]");
    if (!button) return;
    state.activeStoryId = button.dataset.storyId;
    state.activeChapterId = getStory().chapters[0].id;
    saveState(); renderAll(); closeMobilePanels(); stopSpeech();
  });
  el.deleteStoryDialog.addEventListener("close", function () {
    pendingDeleteStoryId = "";
  });
  el.confirmDeleteStoryBtn.addEventListener("click", function (event) {
    event.preventDefault();
    if (!pendingDeleteStoryId) return;
    var storyId = pendingDeleteStoryId;
    pendingDeleteStoryId = "";
    el.deleteStoryDialog.close();
    stopSpeech();
    deleteStory(storyId);
  });
  el.chapterList.addEventListener("click", function (event) {
    var actionButton = event.target.closest("[data-chapter-action]");
    if (actionButton) {
      if (actionButton.dataset.chapterAction === "rename") renameChapter(actionButton.dataset.chapterId);
      if (actionButton.dataset.chapterAction === "delete") {
        requestInlineConfirm(actionButton, function () { deleteChapter(actionButton.dataset.chapterId); });
      }
      return;
    }
    var button = event.target.closest("[data-chapter-id]");
    if (!button) return;
    state.activeChapterId = button.dataset.chapterId;
    saveState(); renderAll(); closeMobilePanels(); stopSpeech();
  });
  el.branchList.addEventListener("click", function (event) {
    var button = event.target.closest("[data-branch-id]");
    if (button) restoreBranch(button.dataset.branchId);
  });
  el.storyContent.addEventListener("click", function (event) {
    var actionButton = event.target.closest("[data-segment-action]");
    var segmentNode = event.target.closest("[data-segment-id]");
    if (actionButton && segmentNode) {
      var segmentId = segmentNode.dataset.segmentId;
      var action = actionButton.dataset.segmentAction;
      if (action === "edit") openSegmentEditor(segmentId);
      if (action === "rewrite") { rewriteFromSegment(segmentId); generateNarrative("\u4ece\u521a\u624d\u622a\u65ad\u7684\u4f4d\u7f6e\u91cd\u65b0\u7eed\u5199\uff0c\u91c7\u7528\u4e0d\u540c\u4f46\u5408\u7406\u7684\u53d1\u5c55\uff0c\u4e0d\u8981\u590d\u7528\u88ab\u5220\u9664\u6bb5\u843d\u7684\u63aa\u8f9e\u3002", "rewrite"); }
      if (action === "continue") { continueFromSegment(segmentId); generateNarrative("\u7d27\u63a5\u5f53\u524d\u6b63\u6587\u81ea\u7136\u7eed\u5199\u5e76\u63a8\u8fdb\u573a\u666f\u3002", "continue"); }
      if (action === "delete") {
        requestInlineConfirm(actionButton, function () { deleteSegment(segmentId); });
      }
      return;
    }
    if (segmentNode && window.matchMedia("(max-width: 760px)").matches) {
      el.storyContent.querySelectorAll(".segment.actions-open").forEach(function (node) {
        if (node !== segmentNode) node.classList.remove("actions-open");
      });
      segmentNode.classList.toggle("actions-open");
    }
  });

  el.povSelect.addEventListener("change", function () { applyStoryControl("pov", el.povSelect.value); });
  el.lengthSelect.addEventListener("change", function () { applyStoryControl("length", el.lengthSelect.value); });
  el.styleInput.addEventListener("change", function () { applyStoryControl("style", el.styleInput.value.trim()); });
  el.playerRoleInput.addEventListener("change", function () { applyStoryControl("playerRole", el.playerRoleInput.value.trim()); });
  el.premiseInput.addEventListener("change", function () { applyStoryControl("premise", el.premiseInput.value.trim()); });
  el.autoContinueToggle.addEventListener("change", function () { applyStoryControl("autoContinue", el.autoContinueToggle.checked); });
  el.autoTtsToggle.addEventListener("change", function () { applyStoryControl("autoTts", el.autoTtsToggle.checked); });

  document.querySelectorAll(".mode-tab").forEach(function (button) {
    button.addEventListener("click", function () {
      state.inputMode = button.dataset.mode;
      document.querySelectorAll(".mode-tab").forEach(function (item) {
        var active = item === button;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", active ? "true" : "false");
      });
      var placeholders = {
        role: "\u4ee5\u89d2\u8272\u8eab\u4efd\u8bf4\u8bdd\u6216\u884c\u52a8\uff0c\u4f8b\u5982\uff1a\u6211\u63a8\u5f00\u95e8\uff0c\u8f7b\u58f0\u95ee\u5979\u662f\u4e0d\u662f\u4e00\u76f4\u5728\u7b49\u6211\u3002",
        director: "\u63a7\u5236\u540e\u7eed\u53d1\u5c55\uff0c\u4f8b\u5982\uff1a\u8ba9\u771f\u76f8\u665a\u4e00\u70b9\u63ed\u6653\uff0c\u5148\u589e\u52a0\u4e24\u4eba\u7684\u731c\u7591\u3002",
        lore: "\u52a0\u5165\u957f\u671f\u8bbe\u5b9a\uff0c\u4f8b\u5982\uff1a\u8fd9\u4e2a\u4e16\u754c\u91cc\uff0c\u76f4\u547c\u4ea1\u8005\u59d3\u540d\u4f1a\u88ab\u5176\u542c\u89c1\u3002",
      };
      el.composerInput.placeholder = placeholders[state.inputMode];
    });
  });
  el.sendBtn.addEventListener("click", submitComposer);
  el.stopBtn.addEventListener("click", stopGeneration);
  el.composerInput.addEventListener("keydown", function (event) {
    if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submitComposer(); }
  });
  el.composerInput.addEventListener("input", syncComposerHeight);
  document.getElementById("continueBtn").addEventListener("click", function () { generateNarrative("\u81ea\u7136\u7eed\u5199\u5e76\u63a8\u8fdb\u5f53\u524d\u573a\u666f\u3002", "continue"); });
  document.getElementById("rewriteBtn").addEventListener("click", rewriteLast);
  document.getElementById("branchBtn").addEventListener("click", saveBranch);
  document.getElementById("summarizeBtn").addEventListener("click", summarizeMemory);
  var composerMenuBtn = document.getElementById("composerMenuBtn");
  var composerActionMenu = document.getElementById("composerActionMenu");
  function setComposerMenuOpen(open) {
    composerActionMenu.classList.toggle("open", open);
    composerActionMenu.setAttribute("aria-hidden", open ? "false" : "true");
    composerMenuBtn.setAttribute("aria-expanded", open ? "true" : "false");
    composerMenuBtn.classList.toggle("active", open);
  }
  composerMenuBtn.addEventListener("click", function (event) {
    event.stopPropagation();
    setComposerMenuOpen(!composerActionMenu.classList.contains("open"));
  });
  composerActionMenu.addEventListener("click", function () { setComposerMenuOpen(false); });
  document.addEventListener("click", function (event) {
    if (!event.target.closest(".composer-menu-wrap")) setComposerMenuOpen(false);
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") setComposerMenuOpen(false);
  });
  document.getElementById("directorPresets").addEventListener("click", function (event) {
    var button = event.target.closest("[data-directive]");
    if (button) generateNarrative(button.dataset.directive, "preset");
  });

  el.setupForm.addEventListener("submit", function (event) {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    var story = createStoryData(el.setupTitle.value.trim(), el.setupPrompt.value.trim(), el.setupRole.value.trim(), el.setupGenre.value.trim());
    state.stories = state.stories.filter(function (item) { return !isPristineStory(item); });
    state.stories.push(story);
    state.activeStoryId = story.id;
    state.activeChapterId = story.chapters[0].id;
    saveState(); renderAll(); el.setupDialog.close(); el.setupForm.reset();
    generateNarrative("\u6839\u636e\u5f00\u573a\u8bbe\u5b9a\u5199\u51fa\u5c0f\u8bf4\u7b2c\u4e00\u5e55\u3002\u76f4\u63a5\u8fdb\u5165\u573a\u666f\uff0c\u4ee5\u6709\u5438\u5f15\u529b\u4f46\u4e0d\u6545\u5f04\u7384\u865a\u7684\u65b9\u5f0f\u5f00\u7bc7\u3002", "opening");
  });

  document.querySelectorAll("[data-memory]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      state.memoryEditingKey = button.dataset.memory;
      var labels = { summary: "\u6545\u4e8b\u6458\u8981", characters: "\u4eba\u7269\u5173\u7cfb", world: "\u4e16\u754c\u72b6\u6001", threads: "\u672a\u89e3\u4f0f\u7b14" };
      el.memoryDialogTitle.textContent = "\u7f16\u8f91" + labels[state.memoryEditingKey];
      el.memoryEditor.value = getStory().memory[state.memoryEditingKey] || "";
      el.memoryDialog.showModal();
    });
  });
  document.getElementById("memoryForm").addEventListener("submit", function (event) {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    getStory().memory[state.memoryEditingKey] = el.memoryEditor.value.trim();
    touchStory(); renderMemory(); el.memoryDialog.close();
  });
  document.getElementById("segmentEditForm").addEventListener("submit", function (event) {
    event.preventDefault();
    saveSegmentEdit();
  });
  document.getElementById("undoBtn").addEventListener("click", undoLastChange);

  document.querySelectorAll("[data-settings-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll("[data-settings-tab]").forEach(function (item) { item.classList.toggle("active", item === button); });
      document.querySelectorAll("[data-settings-panel]").forEach(function (panel) { panel.hidden = panel.dataset.settingsPanel !== button.dataset.settingsTab; });
    });
  });
  el.ttsProvider.addEventListener("change", syncTtsProviderFields);
  document.getElementById("importMoyuConfigBtn").addEventListener("click", readMoyuSettings);
  el.settingsForm.addEventListener("submit", function (event) {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault(); saveSettingsForm(); el.settingsDialog.close();
  });
  document.getElementById("ttsTestBtn").addEventListener("click", function () {
    saveSettingsForm();
    speakText("\u66ae\u8272\u4ece\u7a97\u5916\u7f13\u6162\u843d\u4e0b\uff0c\u6545\u4e8b\u6b63\u8981\u5f00\u59cb\u3002", true);
  });

  el.ttsPlayBtn.addEventListener("click", toggleSpeech);
  document.getElementById("ttsPrevBtn").addEventListener("click", function () {
    if (!state.tts.chunks.length) return toggleSpeech();
    playFromIndex(Math.max(0, state.tts.index - 1));
  });
  document.getElementById("ttsNextBtn").addEventListener("click", function () {
    if (!state.tts.chunks.length) return toggleSpeech();
    playFromIndex(Math.min(state.tts.chunks.length - 1, state.tts.index + 1));
  });

  document.getElementById("exportBtn").addEventListener("click", exportStory);
  document.getElementById("importBtn").addEventListener("click", function () { el.importInput.click(); });
  el.importInput.addEventListener("change", async function () {
    var file = el.importInput.files && el.importInput.files[0];
    if (!file) return;
    try { await importFile(file); } catch (error) { toast(el.toast, error.message); }
    el.importInput.value = "";
  });
  if (window.speechSynthesis) window.speechSynthesis.addEventListener("voiceschanged", populateVoices);
}
