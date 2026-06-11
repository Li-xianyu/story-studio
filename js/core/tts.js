/* ============================================================
   浮光剧场 · TTS Engine
   ============================================================ */

import { settings, state, el, getStory, getChapter } from "./state.js";
import { toast } from "./utils.js";

var preloadBuffer = {};
var preloadKeepRange = 3; // keep this many ahead & behind current index

export function splitSpeechText(text) {
  var clean = String(text || "").replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim();
  // 先按句末标点拆开
  var raw = clean.match(/[^。！？!?…]+[。！？!?…]?/g) || [];
  // 太短的句子合并到一起，每条至少 ~60 字符
  var parts = [];
  var buf = "";
  for (var i = 0; i < raw.length; i += 1) {
    buf += raw[i];
    if (buf.length >= 60 || i === raw.length - 1) {
      parts.push(buf.trim());
      buf = "";
    }
  }
  return parts.filter(Boolean);
}

function trimPreloadBuffer(currentIndex) {
  var min = currentIndex - preloadKeepRange;
  var max = currentIndex + preloadKeepRange;
  Object.keys(preloadBuffer).forEach(function (key) {
    var num = Number(key);
    if (num < min || num > max) {
      if (preloadBuffer[num] && preloadBuffer[num].url) URL.revokeObjectURL(preloadBuffer[num].url);
      delete preloadBuffer[num];
    }
  });
}

function clearPreloadBuffer() {
  Object.keys(preloadBuffer).forEach(function (key) {
    if (preloadBuffer[key].url) URL.revokeObjectURL(preloadBuffer[key].url);
  });
  preloadBuffer = {};
}

export function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.tts.audio) { state.tts.audio.pause(); state.tts.audio = null; }
  state.tts.playing = false;
  state.tts.paused = false;
  el.ttsPlayBtn.textContent = "▶";
}

export function refreshSpeechProgress() {
  var total = Math.max(1, state.tts.chunks.length);
  el.playbackProgress.style.width = Math.min(100, ((state.tts.index + (state.tts.playing ? 1 : 0)) / total) * 100) + "%";
}

export function getSystemVoice() {
  var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return voices.find(function (voice) { return voice.voiceURI === settings.systemVoice; }) || null;
}

function createMimoAudio(chunk) {
  var speed = Number(el.speechRate.value) || 1;
  var tag = speed < 0.85 ? "[语速极慢，缓慢低沉]" : speed < 0.95 ? "[语速放慢]" : speed > 1.4 ? "[语速极快，连珠炮]" : speed > 1.1 ? "[语速加快]" : "";
  var text = tag ? tag + chunk : chunk;
  return fetch((settings.ttsHost || "").replace(/\/+$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": settings.ttsKey },
    body: JSON.stringify({
      model: settings.ttsModel,
      messages: [
        { role: "user", content: "朗读以下文本" },
        { role: "assistant", content: text }
      ],
      audio: { format: "wav", voice: settings.ttsVoice },
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
    return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  });
}

function playLoadedChunk(url) {
  return new Promise(function (resolve, reject) {
    state.tts.audio = new Audio(url);
    state.tts.audio.onended = function () {
      URL.revokeObjectURL(url);
      state.tts.audio = null;
      resolve();
    };
    state.tts.audio.onerror = function () { reject(new Error("音频播放失败")); };
    state.tts.audio.play();
  });
}

async function preloadChunk(index) {
  if (index < 0 || index >= state.tts.chunks.length) return;
  if (preloadBuffer[index]) return;
  if (settings.ttsProvider !== "mimo") return;
  if (!settings.ttsKey || !settings.ttsHost) return;
  preloadBuffer[index] = { loading: true, url: "" };
  try {
    var url = await createMimoAudio(state.tts.chunks[index]);
    preloadBuffer[index] = { loading: false, url: url };
  } catch (_) {
    delete preloadBuffer[index];
  }
}

export async function speakText(text, fromStart) {
  if (fromStart || !state.tts.chunks.length) {
    stopSpeech();
    clearPreloadBuffer();
    state.tts.chunks = splitSpeechText(text);
    state.tts.index = 0;
  }
  if (!state.tts.chunks.length) return toast(el.toast, "没有可朗读的正文");
  state.tts.playing = true;
  el.ttsPlayBtn.textContent = "Ⅱ";

  if (settings.ttsProvider === "mimo") {
    playSpeechChunk();
  } else {
    playSystemSpeech();
  }
}

/* ---- System TTS: queue all at once ---- */
function playSystemSpeech() {
  if (!state.tts.chunks.length) return;
  var rate = Number(el.speechRate.value) || 1;
  var pitch = Number(settings.systemPitch) || 1;
  var voice = getSystemVoice();
  var finished = 0;

  state.tts.chunks.forEach(function (chunk, idx) {
    var utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = rate;
    utterance.pitch = pitch;
    if (voice) utterance.voice = voice;
    utterance.onend = function () {
      finished += 1;
      state.tts.index = finished;
      refreshSpeechProgress();
      if (!state.tts.playing) return;
      if (finished >= state.tts.chunks.length) {
        stopSpeech();
        el.playbackTitle.textContent = "朗读完成";
        refreshSpeechProgress();
      }
    };
    utterance.onerror = function (event) {
      if (event.error !== "canceled" && event.error !== "interrupted") {
        toast(el.toast, "朗读失败：" + (event.error || ""));
      }
    };
    window.speechSynthesis.speak(utterance);
  });
}

/* ---- MiMo TTS: preload next chunks while playing ---- */
export async function playSpeechChunk() {
  if (!state.tts.playing || state.tts.index >= state.tts.chunks.length) {
    stopSpeech();
    el.playbackTitle.textContent = "朗读完成";
    refreshSpeechProgress();
    return;
  }

  var index = state.tts.index;
  el.playbackTitle.textContent = state.tts.chunks[index];
  refreshSpeechProgress();

  // Preload nearby chunks in both directions
  preloadChunk(index - 2);
  preloadChunk(index - 1);
  preloadChunk(index + 1);
  preloadChunk(index + 2);

  try {
    var cached = preloadBuffer[index];
    if (cached && cached.url) {
      delete preloadBuffer[index];
      await playLoadedChunk(cached.url);
    } else {
      var url = await createMimoAudio(state.tts.chunks[index]);
      await playLoadedChunk(url);
    }
    if (!state.tts.playing) return;
    state.tts.index += 1;
    trimPreloadBuffer(state.tts.index);
    playSpeechChunk();
  } catch (error) {
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
  var text = chapter.segments.map(function (segment) { return segment.content; }).join("\n");
  speakText(text, true);
}

export function playFromIndex(index) {
  stopSpeech();
  if (!state.tts.chunks.length) return;
  state.tts.playing = true;
  state.tts.index = index;
  el.ttsPlayBtn.textContent = "Ⅱ";
  // Preload a wide range around the jump target
  for (var i = -3; i <= 3; i += 1) preloadChunk(index + i);
  if (settings.ttsProvider === "mimo") {
    playSpeechChunk();
  } else {
    playSystemSpeech();
  }
}

export function populateVoices() {
  if (!window.speechSynthesis) return;
  var voices = window.speechSynthesis.getVoices() || [];
  el.systemVoice.innerHTML = '<option value="">默认音色</option>' + voices.map(function (voice) {
    return '<option value="' + voice.voiceURI + '">' + voice.name + " · " + voice.lang + "</option>";
  }).join("");
  el.systemVoice.value = settings.systemVoice || "";
}
