/* ============================================================
   娴厜鍓у満 路 Dialogs
   ============================================================ */

import { state, settings, el, saveSettings, getStory, saveState } from "../core/state.js";
import { toast } from "../core/utils.js";
import { renderAll, renderStory, renderChapterList } from "./renderer.js";
import { populateVoices, speakText } from "../core/tts.js";

export function openSettings(message) {
  fillSettingsForm();
  el.settingsStatus.textContent = message || "";
  el.settingsDialog.showModal();
}

export function fillSettingsForm() {
  ["apiProvider", "apiHost", "apiKey", "apiModelCustom", "temperature", "memoryContextTokens", "ttsProvider", "systemPitch", "ttsHost", "ttsKey", "ttsModel",
    "ttsNarratorVoice", "ttsMaleVoice", "ttsFemaleVoice", "syncHost", "syncToken"].forEach(function (key) {
    if (el[key]) el[key].value = settings[key] || "";
  });
  
  syncApiModelOptions(settings.apiProvider || "deepseek", settings.apiModel);
  
  populateVoices();
  syncCustomSelect(el.ttsProvider);
  syncCustomSelect(el.apiProvider);
  syncTtsProviderFields();
}

export function syncApiModelOptions(provider, selectedValue) {
  var select = el.apiModel;
  if (!select) return;
  select.innerHTML = "";

  var hostValue = String(el.apiHost ? el.apiHost.value : (settings.apiHost || "")).trim().replace(/\/+$/, "");
  var cached = {};
  try {
    cached = JSON.parse(localStorage.getItem("floating-story-studio-cached-models")) || {};
  } catch (_) {}
  
  var cachedList = cached[hostValue] || [];
  var list = [];
  
  if (cachedList.length > 0) {
    list = cachedList.map(function (id) {
      return { value: id, text: id };
    });
  } else {
    var presets = {
      deepseek: [
        { value: "deepseek-v4-flash", text: "DeepSeek-V4-Flash" },
        { value: "deepseek-v4-pro", text: "DeepSeek-V4-Pro" }
      ],
      siliconflow: [
        { value: "deepseek-ai/DeepSeek-V3", text: "DeepSeek-V3 (SiliconFlow)" },
        { value: "deepseek-ai/DeepSeek-R1", text: "DeepSeek-R1 (SiliconFlow)" },
        { value: "deepseek-ai/DeepSeek-V2.5", text: "DeepSeek-V2.5 (SiliconFlow)" },
        { value: "Qwen/Qwen2.5-72B-Instruct", text: "Qwen 2.5 72B (SiliconFlow)" },
        { value: "GLM-4-9B-Chat", text: "GLM-4 9B (SiliconFlow)" }
      ],
      openai: [
        { value: "gpt-4o", text: "GPT-4o (openai)" },
        { value: "gpt-4o-mini", text: "GPT-4o-mini (openai)" },
        { value: "o1-preview", text: "o1-preview (openai)" },
        { value: "o1-mini", text: "o1-mini (openai)" }
      ],
      custom: []
    };
    list = presets[provider] || [];
  }

  list.forEach(function (opt) {
    var o = document.createElement("option");
    o.value = opt.value;
    o.textContent = opt.text;
    select.appendChild(o);
  });

  // If selectedValue exists and is not in presets, add it as a standalone option
  if (selectedValue && selectedValue !== "custom") {
    var exists = list.some(function (opt) { return opt.value === selectedValue; });
    if (!exists) {
      var o = document.createElement("option");
      o.value = selectedValue;
      o.textContent = selectedValue;
      select.appendChild(o);
    }
  }

  // Add a "custom" fallback option
  var customOpt = document.createElement("option");
  customOpt.value = "custom";
  customOpt.textContent = "手动输入...";
  select.appendChild(customOpt);

  if (selectedValue) {
    var hasVal = Array.from(select.options).some(function (o) { return o.value === selectedValue; });
    select.value = hasVal ? selectedValue : "custom";
  } else if (list.length > 0) {
    select.value = list[0].value;
  } else {
    select.value = "custom";
  }

  // Rebuild custom-select UI
  var host = select.closest("custom-select");
  if (host && host._csInstance) {
    host._csInstance.rebuildOptions();
  }
  
  // Show/hide manual custom model name input based on selection
  var customRow = document.getElementById("customModelInputRow");
  if (customRow) {
    customRow.style.display = select.value === "custom" ? "block" : "none";
  }
}

function syncCustomSelect(select) {
  var host = select && select.closest("custom-select");
  if (host && host._csInstance) host._csInstance.syncDisplay();
}

export function syncTtsProviderFields() {
  var mimo = el.ttsProvider.value === "mimo";
  el.systemTtsFields.hidden = mimo;
  el.mimoTtsFields.hidden = !mimo;
}

export function saveSettingsForm(silent) {
  ["apiProvider", "apiHost", "apiKey", "apiModelCustom", "ttsProvider", "ttsHost", "ttsKey", "ttsModel",
    "ttsNarratorVoice", "ttsMaleVoice", "ttsFemaleVoice", "syncHost", "syncToken"].forEach(function (key) {
    if (el[key]) settings[key] = el[key].value.trim();
  });
  
  if (el.apiModel.value === "custom") {
    settings.apiModel = el.apiModelCustom.value.trim();
  } else {
    settings.apiModel = el.apiModel.value;
  }
  
  settings.ttsVoice = settings.ttsNarratorVoice;
  settings.temperature = Number(el.temperature.value) || 0.9;
  settings.memoryContextTokens = Number(el.memoryContextTokens.value) || 128000;
  settings.systemVoice = el.systemVoice.value;
  settings.systemPitch = Number(el.systemPitch.value) || 1;
  saveSettings();
  if (!silent) {
    toast(el.toast, "设置已保存");
  }
}


export function openSegmentEditor(segmentId) {
  var found = findSegment(segmentId);
  if (!found || state.generating) return;
  state.editingSegmentId = segmentId;
  el.segmentEditor.value = found.segment.content || "";
  el.segmentEditDialog.showModal();
}

export function saveSegmentEdit() {
  var found = findSegment(state.editingSegmentId);
  if (!found) return;
  var value = el.segmentEditor.value.trim();
  if (!value) return toast(el.toast, "\u6b63\u6587\u4e0d\u80fd\u4e3a\u7a7a\uff0c\u53ef\u4ee5\u4f7f\u7528\u5220\u9664\u64cd\u4f5c");
  createUndoSnapshot("\u5df2\u7f16\u8f91\u6b63\u6587");
  found.segment.content = value;
  found.segment.speechTrack = [];
  found.segment.editedAt = new Date().toISOString();
  saveState();
  renderStory();
  renderChapterList();
  el.segmentEditDialog.close();
  state.editingSegmentId = "";
  toast(el.toast, "\u6b63\u6587\u5df2\u66f4\u65b0");
}

export function createUndoSnapshot(message) {
  var story = getStory();
  if (!story) return;
  state.undoSnapshot = {
    storyId: story.id,
    story: JSON.parse(JSON.stringify(story)),
    chapterId: state.activeChapterId,
  };
  el.undoText.textContent = message || "\u5df2\u4fee\u6539\u6b63\u6587";
  
  var activeDialog = document.querySelector("dialog[open]");
  if (activeDialog) {
    activeDialog.appendChild(el.undoBar);
  } else {
    document.body.appendChild(el.undoBar);
  }
  
  el.undoBar.classList.add("show");
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(function () {
    state.undoSnapshot = null;
    el.undoBar.classList.remove("show");
    setTimeout(function () {
      if (!el.undoBar.classList.contains("show") && el.undoBar.parentNode !== document.body) {
        document.body.appendChild(el.undoBar);
      }
    }, 350);
  }, 8000);
}

export function undoLastChange() {
  var snapshot = state.undoSnapshot;
  if (!snapshot) return;
  var index = state.stories.findIndex(function (story) { return story.id === snapshot.storyId; });
  if (index < 0) return;
  state.stories[index] = snapshot.story;
  state.activeStoryId = snapshot.storyId;
  state.activeChapterId = snapshot.chapterId;
  state.undoSnapshot = null;
  clearTimeout(state.undoTimer);
  el.undoBar.classList.remove("show");
  saveState();
  renderAll();
  toast(el.toast, "\u5df2\u64a4\u9500");
}

function findSegment(segmentId) {
  var chapter = getChapter();
  if (!chapter) return null;
  var index = chapter.segments.findIndex(function (segment) { return segment.id === segmentId; });
  return index < 0 ? null : { chapter: chapter, segment: chapter.segments[index], index: index };
}

function getChapter() {
  var story = getStory();
  return story ? story.chapters.find(function (item) { return item.id === state.activeChapterId; }) || null : null;
}
