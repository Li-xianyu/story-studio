/* ============================================================
   浮光剧场 · TTS Engine
   ============================================================ */

import { settings, state, el, getStory, getChapter } from "./state.js";
import { toast } from "./utils.js";
import { buildSpeechPlan } from "./speech-track.js";

var audioCache = new Map();
var audioCacheBytes = 0;
var maxAudioCacheBytes = 96 * 1024 * 1024;
var playbackSession = 0;
var speechSource = "";

function chapterSpeechSource(chapter) {
  return JSON.stringify((chapter && chapter.segments || []).map(function (segment) {
    return {
      content: segment.content || "",
      speechTrack: segment.speechTrack || [],
    };
  }));
}

export function splitSpeechText(text) {
  return String(text || "")
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n+/)
    .map(function (paragraph) {
      return paragraph
        .replace(/[#*_`>\[\]]/g, "")
        .replace(/[ \t]+/g, " ")
        .replace(/\n+/g, " ")
        .trim();
    })
    .filter(Boolean);
}

function syncSpeechBlock() {
  document.querySelectorAll(".speech-block.is-reading").forEach(function (node) {
    node.classList.remove("is-reading");
  });
  if (!state.tts.playing) return;
  var paragraphIndex = state.tts.chunkParagraphs && state.tts.chunkParagraphs[state.tts.index];
  var current = document.querySelector('.speech-block[data-speech-index="' +
    (Number.isFinite(paragraphIndex) ? paragraphIndex : state.tts.index) + '"]');
  if (current) current.classList.add("is-reading");
  syncSegmentPlaybackButtons();
}

function syncSegmentPlaybackButtons() {
  document.querySelectorAll('[data-segment-action="readFromHere"]').forEach(function (button) {
    button.innerHTML = '<i data-lucide="play"></i>';
    button.title = "\u4ece\u6b64\u5904\u5f00\u59cb\u8bfb";
    button.setAttribute("aria-label", button.title);
  });
  if (state.tts.playing) {
    var paragraphIndex = state.tts.chunkParagraphs && state.tts.chunkParagraphs[state.tts.index];
    var block = document.querySelector('.speech-block[data-speech-index="' + paragraphIndex + '"]');
    var activeButton = block && block.closest(".segment") &&
      block.closest(".segment").querySelector('[data-segment-action="readFromHere"]');
    if (activeButton) {
      activeButton.innerHTML = '<i data-lucide="' + (state.tts.paused ? "play" : "pause") + '"></i>';
      activeButton.title = state.tts.paused ? "\u7ee7\u7eed\u6717\u8bfb" : "\u6682\u505c\u6717\u8bfb";
      activeButton.setAttribute("aria-label", activeButton.title);
    }
  }
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
}

function setPlaybackIcon(playing) {
  var iconName = playing ? "pause" : "play";
  el.ttsPlayBtn.innerHTML = '<i data-lucide="' + iconName + '"></i>';
  el.ttsPlayBtn.title = playing ? "暂停朗读" : "开始朗读";
  el.ttsPlayBtn.setAttribute("aria-label", el.ttsPlayBtn.title);
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons({ nodes: [el.ttsPlayBtn] });
  }
}

function audioCacheKey(chunk, voiceRole) {
  var voice = getMimoVoice(voiceRole);
  return [
    settings.ttsHost,
    settings.ttsModel,
    voice,
    Number(el.speechRate.value) || 1,
    voiceRole,
    chunk,
  ].join("\u241f");
}

function touchAudioCache(key, entry) {
  audioCache.delete(key);
  audioCache.set(key, entry);
}

function trimAudioCache() {
  while (audioCacheBytes > maxAudioCacheBytes && audioCache.size > 1) {
    var oldestKey = audioCache.keys().next().value;
    var oldest = audioCache.get(oldestKey);
    audioCache.delete(oldestKey);
    if (oldest && oldest.blob) audioCacheBytes -= oldest.blob.size;
  }
}

export function stopSpeech() {
  playbackSession += 1;
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.tts.audio) {
    if (state.tts.audio._speechResolve) state.tts.audio._speechResolve(false);
    state.tts.audio.onended = null;
    state.tts.audio.onerror = null;
    state.tts.audio.pause();
    if (state.tts.audio._speechUrl) URL.revokeObjectURL(state.tts.audio._speechUrl);
    state.tts.audio = null;
  }
  state.tts.playing = false;
  state.tts.paused = false;
  setPlaybackIcon(false);
  syncSpeechBlock();
}

export function toggleSpeechPause() {
  if (!state.tts.playing) return false;
  state.tts.paused = !state.tts.paused;
  if (settings.ttsProvider === "mimo" && state.tts.audio) {
    if (state.tts.paused) state.tts.audio.pause();
    else state.tts.audio.play().catch(function () {});
  } else if (window.speechSynthesis) {
    if (state.tts.paused) window.speechSynthesis.pause();
    else window.speechSynthesis.resume();
  }
  setPlaybackIcon(!state.tts.paused);
  syncSpeechBlock();
  return true;
}

export function refreshSpeechProgress() {
  var total = Math.max(1, state.tts.chunks.length);
  el.playbackProgress.style.width = Math.min(100, ((state.tts.index + (state.tts.playing ? 1 : 0)) / total) * 100) + "%";
}

export function getSystemVoice() {
  var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return voices.find(function (voice) { return voice.voiceURI === settings.systemVoice; }) || null;
}

function createMimoAudio(chunk, voiceRole) {
  var speed = Number(el.speechRate.value) || 1;
  var tag = speed < 0.85 ? "[语速极慢，缓慢低沉]" : speed < 0.95 ? "[语速放慢]" : speed > 1.4 ? "[语速极快，连珠炮]" : speed > 1.1 ? "[语速加快]" : "";
  var roleTag = voiceRole === "m" ? "[成年男性角色，自然对白]" : voiceRole === "f" ? "[成年女性角色，自然对白]" : "[旁白，沉浸式叙述]";
  var text = roleTag + (tag || "") + chunk;
  return fetch((settings.ttsHost || "").replace(/\/+$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": settings.ttsKey },
    body: JSON.stringify({
      model: settings.ttsModel,
      messages: [
        { role: "user", content: "朗读以下文本" },
        { role: "assistant", content: text }
      ],
      audio: { format: "wav", voice: getMimoVoice(voiceRole) },
      stream: false,
    }),
  }).then(async function (response) {
    if (!response.ok) throw new Error("MiMo HTTP " + response.status);
    var data = await response.json();
    var base64 = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.audio && data.choices[0].message.audio.data;
    if (!base64) throw new Error("MiMo 响应中没有音频");
    var binary = atob(base64);
    var bytes = new Uint8Array(binary.length);
    for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new Blob([bytes], { type: "audio/wav" });
  });
}

function getMimoVoice(voiceRole) {
  if (voiceRole === "m") return settings.ttsMaleVoice || "苏打";
  if (voiceRole === "f") return settings.ttsFemaleVoice || "冰糖";
  return settings.ttsNarratorVoice || settings.ttsVoice || "白桦";
}

function getCachedAudio(chunk, voiceRole) {
  var key = audioCacheKey(chunk, voiceRole);
  var cached = audioCache.get(key);
  if (cached) {
    touchAudioCache(key, cached);
    return cached.promise || Promise.resolve(cached.blob);
  }

  var entry = { blob: null, promise: null };
  entry.promise = createMimoAudio(chunk, voiceRole).then(function (blob) {
    entry.blob = blob;
    entry.promise = null;
    audioCacheBytes += blob.size;
    touchAudioCache(key, entry);
    trimAudioCache();
    return blob;
  }).catch(function (error) {
    audioCache.delete(key);
    throw error;
  });
  audioCache.set(key, entry);
  return entry.promise;
}

function playLoadedChunk(blob, session) {
  return new Promise(function (resolve, reject) {
    if (session !== playbackSession || !state.tts.playing) {
      resolve(false);
      return;
    }
    var url = URL.createObjectURL(blob);
    var audio = new Audio(url);
    audio._speechUrl = url;
    audio._speechResolve = resolve;
    state.tts.audio = audio;
    audio.onended = function () {
      URL.revokeObjectURL(url);
      if (state.tts.audio === audio) state.tts.audio = null;
      resolve(session === playbackSession);
    };
    audio.onerror = function () {
      if (session !== playbackSession) return resolve(false);
      reject(new Error("音频播放失败"));
    };
    audio.play().catch(function (error) {
      if (session !== playbackSession) return resolve(false);
      reject(error);
    });
  });
}

async function preloadChunk(index) {
  if (index < 0 || index >= state.tts.chunks.length) return;
  if (settings.ttsProvider !== "mimo") return;
  if (!settings.ttsKey || !settings.ttsHost) return;
  getCachedAudio(state.tts.chunks[index], state.tts.chunkVoices[index] || "n").catch(function () {});
}

export async function speakText(text, fromStart) {
  if (fromStart || !state.tts.chunks.length) {
    stopSpeech();
    state.tts.chunks = splitSpeechText(text);
    state.tts.chunkVoices = state.tts.chunks.map(function () { return "n"; });
    state.tts.chunkParagraphs = state.tts.chunks.map(function (_, index) { return index; });
    state.tts.index = 0;
    speechSource = String(text || "");
  }
  if (!state.tts.chunks.length) return toast(el.toast, "没有可朗读的正文");
  state.tts.playing = true;
  setPlaybackIcon(true);
  var session = playbackSession;

  if (settings.ttsProvider === "mimo") {
    playSpeechChunk(session);
  } else {
    playSystemSpeech(0, session);
  }
}

/* ---- System TTS: sequential (no overlap) ---- */
function playSystemSpeech(fromIndex, session) {
  if (!state.tts.chunks.length) return;
  window.speechSynthesis.cancel();
  state.tts.playing = true;
  state.tts.index = fromIndex || 0;
  playSystemChunkSequential(session);
}

function playSystemChunkSequential(session) {
  if (session !== playbackSession) return;
  if (!state.tts.playing || state.tts.index >= state.tts.chunks.length) {
    stopSpeech();
    el.playbackTitle.textContent = "朗读完成";
    refreshSpeechProgress();
    return;
  }

  var idx = state.tts.index;
  el.playbackTitle.textContent = state.tts.chunks[idx];
  syncSpeechBlock();
  refreshSpeechProgress();

  var utterance = new SpeechSynthesisUtterance(state.tts.chunks[idx]);
  utterance.rate = Number(el.speechRate.value) || 1;
  utterance.pitch = Number(settings.systemPitch) || 1;
  var voice = getSystemVoice();
  if (voice) utterance.voice = voice;

  utterance.onend = function () {
    if (!state.tts.playing || session !== playbackSession) return;
    state.tts.index += 1;
    playSystemChunkSequential(session);
  };
  utterance.onerror = function (event) {
    if (event.error === "canceled" || event.error === "interrupted") return;
    if (session !== playbackSession) return;
    state.tts.index += 1;
    playSystemChunkSequential(session);
  };

  window.speechSynthesis.speak(utterance);
}

/* ---- MiMo TTS: preload next chunks while playing ---- */
export async function playSpeechChunk(session) {
  var activeSession = session === undefined ? playbackSession : session;
  if (activeSession !== playbackSession) return;
  if (!state.tts.playing || state.tts.index >= state.tts.chunks.length) {
    stopSpeech();
    el.playbackTitle.textContent = "朗读完成";
    refreshSpeechProgress();
    return;
  }

  var index = state.tts.index;
  el.playbackTitle.textContent = state.tts.chunks[index];
  syncSpeechBlock();
  refreshSpeechProgress();

  // Preload nearby chunks in both directions
  preloadChunk(index - 2);
  preloadChunk(index - 1);
  preloadChunk(index + 1);
  preloadChunk(index + 2);

  try {
    var blob = await getCachedAudio(state.tts.chunks[index], state.tts.chunkVoices[index] || "n");
    if (activeSession !== playbackSession) return;
    var completed = await playLoadedChunk(blob, activeSession);
    if (!completed || !state.tts.playing || activeSession !== playbackSession) return;
    state.tts.index += 1;
    playSpeechChunk(activeSession);
  } catch (error) {
    if (activeSession !== playbackSession) return;
    stopSpeech();
    toast(el.toast, "朗读失败：" + error.message);
  }
}

export function toggleSpeech() {
  if (state.tts.playing) {
    stopSpeech();
    return;
  }
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) return;
  prepareChapterSpeech(chapter);
  playFromIndex(0);
}

export function playFromIndex(index) {
  stopSpeech();
  if (!state.tts.chunks.length) return;
  state.tts.playing = true;
  state.tts.index = index;
  setPlaybackIcon(true);
  syncSpeechBlock();
  var session = playbackSession;
  // Preload a wide range around the jump target
  for (var i = -3; i <= 3; i += 1) preloadChunk(index + i);
  if (settings.ttsProvider === "mimo") {
    playSpeechChunk(session);
  } else {
    playSystemSpeech(index, session);
  }
}

export function playChapterFromIndex(index) {
  var chapter = getChapter();
  if (!chapter) return;
  if (speechSource !== chapterSpeechSource(chapter)) {
    prepareChapterSpeech(chapter);
  }
  if (!state.tts.chunks.length) return toast(el.toast, "没有可朗读的正文");
  var chunkIndex = state.tts.chunkParagraphs.findIndex(function (paragraph) {
    return paragraph === index;
  });
  playFromIndex(chunkIndex < 0 ? 0 : chunkIndex);
}

export function playChapterFromSegment(segmentId) {
  var chapter = getChapter();
  if (!chapter) return;
  var paragraphIndex = 0;
  var found = false;
  chapter.segments.some(function (segment) {
    if (segment.id === segmentId) {
      found = true;
      return true;
    }
    paragraphIndex += String(segment.content || "").split(/\n\s*\n+/).filter(Boolean).length;
    return false;
  });
  if (!found) return;
  prepareChapterSpeech(chapter);
  var chunkIndex = state.tts.chunkParagraphs.findIndex(function (paragraph) {
    return paragraph === paragraphIndex;
  });
  playFromIndex(chunkIndex < 0 ? 0 : chunkIndex);
}

export function toggleChapterFromSegment(segmentId) {
  var block = document.querySelector('[data-segment-id="' + segmentId + '"] .speech-block');
  var segmentParagraph = block ? Number(block.dataset.speechIndex) : -1;
  var activeParagraph = state.tts.chunkParagraphs && state.tts.chunkParagraphs[state.tts.index];
  var activeBlock = document.querySelector('.speech-block[data-speech-index="' + activeParagraph + '"]');
  var activeSegmentId = activeBlock && activeBlock.closest(".segment") &&
    activeBlock.closest(".segment").dataset.segmentId;
  if (state.tts.playing && activeSegmentId === segmentId) {
    toggleSpeechPause();
    return;
  }
  if (Number.isFinite(segmentParagraph) && segmentParagraph >= 0) playChapterFromIndex(segmentParagraph);
}

function prepareChapterSpeech(chapter) {
  stopSpeech();
  var plan = buildSpeechPlan(chapter.segments);
  state.tts.chunks = plan.map(function (item) { return item.text; });
  state.tts.chunkVoices = plan.map(function (item) { return item.voice; });
  state.tts.chunkParagraphs = plan.map(function (item) { return item.paragraph; });
  speechSource = chapterSpeechSource(chapter);
  console.groupCollapsed("[SpeechTrack] 当前章节最终播放计划");
  console.table(plan);
  console.groupEnd();
}

export function populateVoices() {
  if (!window.speechSynthesis) return;
  var voices = window.speechSynthesis.getVoices() || [];
  el.systemVoice.innerHTML = '<option value="">默认音色</option>' + voices.map(function (voice) {
    return '<option value="' + voice.voiceURI + '">' + voice.name + " · " + voice.lang + "</option>";
  }).join("");
  el.systemVoice.value = settings.systemVoice || "";
}
