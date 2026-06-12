/* ============================================================
   浮光剧场 · Events
   ============================================================ */

import { state, settings, el, getStory, getChapter, touchStory, saveState, saveSettings, createStoryData, isPristineStory } from "../core/state.js";
import { uid, nowIso, toast, setBusy } from "../core/utils.js";
import { renderAll, renderStory, renderStoryList, renderChapterList, renderControls, renderMemory, renderBranches, segmentHtml } from "./renderer.js";
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
  // Find the streaming DOM node for in-place updates (no full re-render)
  var streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
  setBusy(el, true, source === "rewrite" ? "正在重写…" : "故事正在继续…");
  try {
    var messages = [
      { role: "system", content: buildSystemPrompt(story) },
      { role: "user", content: "以下是当前章节最近的正文：\n\n" + (recentNarrative(chapter) || "尚无正文。") +
        "\n\n接下来请执行：" + (instruction || "自然续写故事，推进当前场景。") }
    ];
    var completion = await streamCompletion(messages, function (delta) {
      segment.content += delta;
      // In-place DOM update instead of full renderStory
      if (streamingNode) {
        streamingNode.innerHTML = segmentHtml(segment);
        streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
      }
      if (isReaderNearBottom()) {
        el.readerViewport.scrollTop = el.readerViewport.scrollHeight;
      }
    }, { maxTokens: getLengthMaxTokens(story.length) });
    if (
      segment.content.trim() &&
      (["length", "max_tokens"].includes(completion.finishReason) || looksNarrativeIncomplete(segment.content))
    ) {
      el.statusText.textContent = "正在补全结尾…";
      await completeTruncatedNarrative(story, segment);
    }
    segment.streaming = false;
    if (!segment.content.trim()) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    touchStory();
    renderAll();
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    if (segment.content && story.autoTts) speakText(segment.content, true);
    if (story.autoContinue && !state.abortController.signal.aborted) {
      setTimeout(function () { generateNarrative("继续自然推进故事，不要重复上一段内容。", "auto"); }, 800);
    }
  } catch (error) {
    segment.streaming = false;
    if (!segment.content) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    if (error.name !== "AbortError") toast(el.toast, "生成失败：" + error.message);
    renderAll();
  } finally {
    state.abortController = null;
    setBusy(el, false);
  }
}

async function completeTruncatedNarrative(story, segment) {
  var tail = segment.content.slice(-1200);
  var streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
  var result = await streamCompletion([
    {
      role: "system",
      content: [
        "你是中文小说断句修复器。",
        "只补完输入末尾被截断的当前句子，必要时再补一两句让当前小段自然停住。",
        "禁止开启新情节，禁止复述已有文字，禁止解释，直接输出需要追加的正文。",
        "保持叙事视角与文风：" + story.pov + "；" + story.style
      ].join("\n")
    },
    { role: "user", content: "以下正文末尾被截断，请只输出应当追加的部分：\n\n" + tail }
  ], function (delta) {
    segment.content += delta;
    if (streamingNode) {
      streamingNode.innerHTML = segmentHtml(segment);
      streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
    }
    if (isReaderNearBottom()) {
      el.readerViewport.scrollTop = el.readerViewport.scrollHeight;
    }
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
    toast(el.toast, "设定已写入长期记忆");
    return;
  }
  if (state.inputMode === "role") {
    await generateNarrative(
      [
        "用户以角色“" + (story.playerRole || "当前主角") + "”提供了一段剧情草稿：",
        value,
        "",
        "请把这段草稿视为确定发生的事实。输出时先将它润色、扩写成可直接接在前文之后的小说正文，再继续描写环境和其他人物的自然反应。",
        "润色部分必须服从当前叙事视角：前文是第一人称就使用“我”，前文是第三人称就使用角色姓名或合适代词。",
        "保持前文文风、时态、语气和信息边界，不显示角色标签，不引用原始输入，不解释改写过程，也不要替该角色新增重大决定。"
      ].join("\n"),
      "role",
      { sourceInput: value }
    );
    return;
  }
  await generateNarrative("剧情指令：" + value + "\n自然落实到后续正文中，不要提及这条指令。", "director");
}

function stopGeneration() {
  if (state.abortController) state.abortController.abort();
  var chapter = getChapter();
  if (chapter) chapter.segments.forEach(function (segment) { segment.streaming = false; });
  setBusy(el, false, "已停止");
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
  if (index < 0) return toast(el.toast, "还没有可重写的正文");
  createUndoSnapshot("已重写末段");
  chapter.segments.splice(index, 1);
  touchStory();
  renderStory();
  generateNarrative("重新写刚才应当发生的后续。采用不同但合理的发展，避免复用刚才的措辞。", "rewrite");
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
  button.innerHTML = '<i data-lucide="check"></i><span class="confirm-label">确认</span>';
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
  document.getElementById("libraryThemeBtn").addEventListener("click", function () {
    settings.theme = settings.theme === "dark" ? "light" : "dark";
    saveSettings();
    var btn = document.getElementById("libraryThemeBtn");
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
        el.deleteStoryName.textContent = story.title || "未命名故事";
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
      if (action === "rewrite") { rewriteFromSegment(segmentId); generateNarrative("从刚才截断的位置重新续写，采用不同但合理的发展，不要复用被删除段落的措辞。", "rewrite"); }
      if (action === "continue") { continueFromSegment(segmentId); generateNarrative("紧接当前正文自然续写并推进场景。", "continue"); }
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
        role: "以角色身份说话或行动，例如：我推开门，轻声问她是不是一直在等我。",
        director: "控制后续发展，例如：让真相晚一点揭晓，先增加两人的猜疑。",
        lore: "加入长期设定，例如：这个世界里，直呼死者姓名会被其听见。",
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
  document.getElementById("continueBtn").addEventListener("click", function () { generateNarrative("自然续写并推进当前场景。", "continue"); });
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
    generateNarrative("根据开场设定写出小说第一幕。直接进入场景，以有吸引力但不故弄玄虚的方式开篇。", "opening");
  });

  document.querySelectorAll("[data-memory]").forEach(function (button) {
    button.addEventListener("click", function (event) {
      event.preventDefault();
      state.memoryEditingKey = button.dataset.memory;
      var labels = { summary: "故事摘要", characters: "人物关系", world: "世界状态", threads: "未解伏笔" };
      el.memoryDialogTitle.textContent = "编辑" + labels[state.memoryEditingKey];
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
  document.getElementById("saveSegmentBtn").addEventListener("click", function () {
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
    speakText("暮色从窗外缓慢落下，故事正要开始。", true);
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
