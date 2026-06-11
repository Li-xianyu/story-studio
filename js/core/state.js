/* ============================================================
   浮光剧场 · Core State
   ============================================================ */

import { safeParse, uid, nowIso } from "./utils.js";

var STORAGE_KEY = "floating-story-studio-v1";
var SETTINGS_KEY = "floating-story-studio-settings-v1";

export var state = {
  stories: [],
  activeStoryId: "",
  activeChapterId: "",
  inputMode: "role",
  generating: false,
  abortController: null,
  memoryEditingKey: "",
  editingSegmentId: "",
  undoSnapshot: null,
  undoTimer: 0,
  tts: { playing: false, paused: false, index: 0, chunks: [], utterance: null, audio: null, url: "" },
};

export var settings = {
  theme: "dark",
  apiHost: "https://api.deepseek.com",
  apiKey: "",
  apiModel: "deepseek-chat",
  temperature: 0.9,
  ttsProvider: "system",
  systemVoice: "",
  systemPitch: 1,
  ttsHost: "https://api.xiaomimimo.com/v1/chat/completions",
  ttsKey: "",
  ttsModel: "mimo-v2.5-tts",
  ttsVoice: "冰糖",
};

export var el = {};

var ids = [
  "topLoader", "libraryPanel", "controlsPanel", "mobileBackdrop", "storyList", "chapterList", "branchList",
  "storyTitle", "storyMeta", "storyContent", "emptyState", "readerViewport", "composerInput", "sendBtn", "stopBtn",
  "statusText", "setupDialog", "setupForm", "setupTitle", "setupPrompt", "setupRole", "setupGenre",
  "settingsDialog", "settingsForm", "memoryDialog", "memoryDialogTitle", "memoryEditor", "toast",
  "povSelect", "lengthSelect", "styleInput", "playerRoleInput", "premiseInput", "autoContinueToggle", "autoTtsToggle",
  "speechRate", "playbackTitle", "playbackProgress", "ttsPlayBtn", "playerBar", "audioPanelToggle", "apiHost", "apiKey", "apiModel",
  "temperature", "ttsProvider", "systemVoice", "systemPitch", "ttsHost", "ttsKey", "ttsModel", "ttsVoice",
  "systemTtsFields", "mimoTtsFields", "settingsStatus", "importInput",
  "segmentEditDialog", "segmentEditor", "undoBar", "undoText",
  "deleteStoryDialog", "deleteStoryName", "confirmDeleteStoryBtn"
];

export function cacheElements() {
  ids.forEach(function (id) { el[id] = document.getElementById(id); });
}

export function createStoryData(title, premise, playerRole, genre) {
  var chapterId = uid("chapter");
  return {
    id: uid("story"),
    title: title || "未命名故事",
    premise: premise || "",
    genre: genre || "",
    playerRole: playerRole || "",
    pov: "第三人称限知",
    style: "沉浸、细腻、克制，重视动作与对白",
    length: "medium",
    autoContinue: false,
    autoTts: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    started: false,
    chapters: [{ id: chapterId, title: "第一章", segments: [], createdAt: nowIso() }],
    memory: { summary: "", characters: "", world: "", threads: "", lore: "" },
    branches: [],
  };
}

export function isPristineStory(story) {
  return Boolean(
    story &&
    !story.started &&
    !String(story.premise || "").trim() &&
    Array.isArray(story.chapters) &&
    story.chapters.every(function (chapter) {
      return !chapter.segments || chapter.segments.every(function (segment) {
        return !String(segment.content || "").trim();
      });
    })
  );
}

export function ensureActiveSelection() {
  var story = state.stories.find(function (item) { return item.id === state.activeStoryId; }) || state.stories[0];
  state.activeStoryId = story ? story.id : "";
  if (!story) {
    state.activeChapterId = "";
    return;
  }
  var chapter = story.chapters.find(function (item) { return item.id === state.activeChapterId; }) || story.chapters[0];
  state.activeChapterId = chapter ? chapter.id : "";
}

export function getStory() {
  return state.stories.find(function (item) { return item.id === state.activeStoryId; }) || null;
}

export function getChapter() {
  var story = getStory();
  return story ? story.chapters.find(function (item) { return item.id === state.activeChapterId; }) || null : null;
}

export function touchStory() {
  var story = getStory();
  if (story) story.updatedAt = nowIso();
  saveState();
}

export function loadState() {
  var saved = safeParse(localStorage.getItem(STORAGE_KEY), null);
  var savedSettings = safeParse(localStorage.getItem(SETTINGS_KEY), null);
  if (savedSettings) Object.assign(settings, savedSettings);
  if (saved && Array.isArray(saved.stories)) {
    state.stories = saved.stories;
    state.activeStoryId = saved.activeStoryId || "";
    state.activeChapterId = saved.activeChapterId || "";
  }
  var storyCountBeforeMigration = state.stories.length;
  state.stories = state.stories.filter(function (story) {
    return !(story.title === "我的第一部故事" && isPristineStory(story));
  });
  ensureActiveSelection();
  if (state.stories.length !== storyCountBeforeMigration) saveState();
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    stories: state.stories,
    activeStoryId: state.activeStoryId,
    activeChapterId: state.activeChapterId,
  }));
}

export function saveSettings() {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}
