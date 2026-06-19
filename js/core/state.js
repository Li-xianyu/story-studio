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
  tts: { playing: false, paused: false, index: 0, chunks: [], chunkVoices: [], chunkParagraphs: [], utterance: null, audio: null, url: "" },
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
  ttsVoice: "白桦",
  ttsNarratorVoice: "白桦",
  ttsMaleVoice: "苏打",
  ttsFemaleVoice: "冰糖",
  readerFontSize: "18",
  readerLineHeight: "2",
  readerIndent: true,
};

export var el = {};

var ids = [
  "topLoader", "libraryPanel", "controlsPanel", "mobileBackdrop", "storyList", "chapterList", "branchList",
  "storyTitle", "storyMeta", "storyContent", "emptyState", "readerViewport", "composerInput", "sendBtn", "stopBtn",
  "statusText", "setupDialog", "setupForm", "setupTitle", "setupPrompt", "setupRole", "setupGenre", "setupPov",
  "settingsDialog", "settingsForm", "memoryDialog", "memoryDialogTitle", "memoryEditor", "memoryAiInput", "memoryAiBtn", "toast",
  "povDisplay", "lengthSelect", "styleInput", "playerRoleInput", "premiseInput", "autoContinueToggle", "autoTtsToggle",
  "speechRate", "playbackTitle", "playbackProgress", "ttsPlayBtn", "playerBar", "audioPanelToggle", "apiHost", "apiKey", "apiModel",
  "temperature", "ttsProvider", "systemVoice", "systemPitch", "ttsHost", "ttsKey", "ttsModel",
  "ttsNarratorVoice", "ttsMaleVoice", "ttsFemaleVoice",
  "systemTtsFields", "mimoTtsFields", "settingsStatus", "importInput",
  "segmentEditDialog", "segmentEditor", "undoBar", "undoText",
  "rewriteChoiceDialog", "rewriteSourcePreview", "rewriteFreeBtn", "rewriteFromInputBtn",
  "deleteStoryDialog", "deleteStoryName", "confirmDeleteStoryBtn",
  "libraryThemeBtn", "memoryProgressDialog", "memoryProgressTimeline", "memoryProgressCancelBtn",
  "readingSettingsBtn", "readingSettingsDialog",
  "readerFontSize", "readerLineHeight", "readerIndentToggle", "scrollToBottomBtn",
  "contextMenu"
];

export function cacheElements() {
  ids.forEach(function (id) { el[id] = document.getElementById(id); });
}

export function normalizePov(value) {
  if (value === "第一人称") return "第一人称";
  if (value === "第二人称") return "第二人称";
  return "第三人称";
}

export function createStoryData(title, premise, playerRole, genre, pov) {
  var chapterId = uid("chapter");
  return {
    id: uid("story"),
    title: title || "未命名故事",
    premise: premise || "",
    genre: genre || "",
    playerRole: playerRole || "",
    pov: normalizePov(pov),
    style: "沉浸、细腻、克制，重视动作与对白",
    length: "medium",
    autoContinue: false,
    autoTts: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    started: false,
    chapters: [{ id: chapterId, title: "第一章", segments: [], createdAt: nowIso() }],
    memory: { chapterSummaries: {}, characters: "", worldConstants: "", worldEvolution: "", threads: "", characterAttributes: "", lore: "" },
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
  if (savedSettings) {
    Object.assign(settings, savedSettings);
    settings.ttsNarratorVoice = savedSettings.ttsNarratorVoice || savedSettings.ttsVoice || "白桦";
    settings.ttsMaleVoice = savedSettings.ttsMaleVoice || "苏打";
    settings.ttsFemaleVoice = savedSettings.ttsFemaleVoice || "冰糖";
  }
  if (saved && Array.isArray(saved.stories)) {
    state.stories = saved.stories;
    state.activeStoryId = saved.activeStoryId || "";
    state.activeChapterId = saved.activeChapterId || "";
  }
	  var povMigrated = false;
	  var memMigrated = false;
	  state.stories.forEach(function (story) {
	    var normalized = normalizePov(story.pov);
	    if (story.pov !== normalized) {
	      story.pov = normalized;
	      povMigrated = true;
	    }
	    // 旧 memory 结构迁移：{summary, characters, world, threads, lore} → 新分章结构
	    if (story.memory && typeof story.memory.summary === "string" && story.memory.summary) {
	      story.memory.chapterSummaries = story.memory.chapterSummaries || {};
	      // 尝试按已有章节分配，否则全放占位键
	      var placeholderId = "__legacy__";
	      story.memory.chapterSummaries[placeholderId] = story.memory.summary;
	      delete story.memory.summary;
	      memMigrated = true;
	    }
	    if (story.memory && typeof story.memory.world === "string") {
	      if (!story.memory.worldConstants && !story.memory.worldEvolution) {
	        story.memory.worldConstants = story.memory.world;
	        story.memory.worldEvolution = "";
	      }
	      delete story.memory.world;
	      memMigrated = true;
	    }
		    if (story.memory) {
		      story.memory.chapterSummaries = story.memory.chapterSummaries || {};
		      story.memory.worldConstants = story.memory.worldConstants || "";
		      story.memory.worldEvolution = story.memory.worldEvolution || "";
		      story.memory.characterAttributes = story.memory.characterAttributes || "";
		      // 旧版遗留字段二次清理
		      delete story.memory.summary;
		      delete story.memory.world;
		    }
	  });
  var storyCountBeforeMigration = state.stories.length;
  state.stories = state.stories.filter(function (story) {
    return !(story.title === "我的第一部故事" && isPristineStory(story));
  });
  ensureActiveSelection();
	  if (state.stories.length !== storyCountBeforeMigration || povMigrated || memMigrated) saveState();
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

export function applyReaderSettings() {
  var content = document.getElementById("storyContent");
  if (!content) return;
  content.style.setProperty("font-size", settings.readerFontSize + "px");
  content.style.setProperty("line-height", settings.readerLineHeight);
  content.classList.toggle("reader-indent", settings.readerIndent);
}
