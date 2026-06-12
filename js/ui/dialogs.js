/* ============================================================
   浮光剧场 · Dialogs
   ============================================================ */

import { state, settings, el, saveSettings, getStory, saveState } from "../core/state.js";
import { safeParse, toast } from "../core/utils.js";
import { renderAll, renderStory, renderChapterList } from "./renderer.js";
import { populateVoices, speakText } from "../core/tts.js";

export function openSettings(message) {
  fillSettingsForm();
  el.settingsStatus.textContent = message || "";
  el.settingsDialog.showModal();
}

export function fillSettingsForm() {
  ["apiHost", "apiKey", "apiModel", "temperature", "ttsProvider", "systemPitch", "ttsHost", "ttsKey", "ttsModel",
    "ttsNarratorVoice", "ttsMaleVoice", "ttsFemaleVoice"].forEach(function (key) {
    if (el[key]) el[key].value = settings[key];
  });
  populateVoices();
  syncCustomSelect(el.ttsProvider);
  syncTtsProviderFields();
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

export function saveSettingsForm() {
  ["apiHost", "apiKey", "apiModel", "ttsProvider", "ttsHost", "ttsKey", "ttsModel",
    "ttsNarratorVoice", "ttsMaleVoice", "ttsFemaleVoice"].forEach(function (key) {
    settings[key] = el[key].value.trim();
  });
  settings.ttsVoice = settings.ttsNarratorVoice;
  settings.temperature = Number(el.temperature.value) || 0.9;
  settings.systemVoice = el.systemVoice.value;
  settings.systemPitch = Number(el.systemPitch.value) || 1;
  saveSettings();
  toast(el.toast, "\u8bbe\u7f6e\u5df2\u4fdd\u5b58");
}

export function readMoyuSettings() {
  var moyu = safeParse(localStorage.getItem("moyu-settings"), null);
  if (!moyu) return toast(el.toast, "\u6ca1\u6709\u627e\u5230 MOYU \u914d\u7f6e");
  var configs = Array.isArray(moyu.configs) ? moyu.configs : [];
  var config = configs.find(function (item) { return item.id === moyu.activeConfigId; }) || configs[0];
  if (config) {
    el.apiHost.value = config.host || "";
    el.apiKey.value = config.key || "";
    el.apiModel.value = moyu.assistant && moyu.assistant.model || (config.workModels && config.workModels[0]) || "";
  }
  if (moyu.tts) {
    el.ttsProvider.value = moyu.tts.provider || "system";
    el.ttsHost.value = moyu.tts.host || settings.ttsHost;
    el.ttsKey.value = moyu.tts.apiKey || "";
    el.ttsModel.value = moyu.tts.model || settings.ttsModel;
    el.ttsNarratorVoice.value = moyu.tts.narratorVoice || moyu.tts.voice || settings.ttsNarratorVoice;
    el.ttsMaleVoice.value = moyu.tts.maleVoice || settings.ttsMaleVoice;
    el.ttsFemaleVoice.value = moyu.tts.femaleVoice || settings.ttsFemaleVoice;
    el.systemVoice.value = moyu.tts.systemVoice || "";
    el.systemPitch.value = moyu.tts.systemPitch || 1;
    syncCustomSelect(el.ttsProvider);
    syncCustomSelect(el.systemVoice);
    syncTtsProviderFields();
  }
  toast(el.toast, "\u5df2\u8bfb\u53d6 MOYU \u5f53\u524d\u914d\u7f6e");
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
  el.undoBar.classList.add("show");
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(function () {
    state.undoSnapshot = null;
    el.undoBar.classList.remove("show");
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
