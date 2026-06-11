/* ============================================================
   浮光剧场 · TTS Engine
   ============================================================ */

import { settings, state, el, getStory, getChapter } from "./state.js";
import { toast } from "./utils.js";

export function splitSpeechText(text) {
  var clean = String(text || "").replace(/[#*_`>\[\]]/g, "").replace(/\s+/g, " ").trim();
  var parts = clean.match(/[^。！？!?；;]{1,180}[。！？!?；;]?/g) || [];
  return parts.map(function (part) { return part.trim(); }).filter(Boolean);
}

export function stopSpeech() {
  if (window.speechSynthesis) window.speechSynthesis.cancel();
  if (state.tts.audio) { state.tts.audio.pause(); state.tts.audio = null; }
  if (state.tts.url) { URL.revokeObjectURL(state.tts.url); state.tts.url = ""; }
  state.tts.playing = false;
  state.tts.paused = false;
  el.ttsPlayBtn.textContent = "\u25b6";
}

export function refreshSpeechProgress() {
  var total = Math.max(1, state.tts.chunks.length);
  el.playbackProgress.style.width = Math.min(100, ((state.tts.index + (state.tts.playing ? 1 : 0)) / total) * 100) + "%";
}

export function getSystemVoice() {
  var voices = window.speechSynthesis ? window.speechSynthesis.getVoices() : [];
  return voices.find(function (voice) { return voice.voiceURI === settings.systemVoice; }) || null;
}

export async function speakText(text, fromStart) {
  if (fromStart || !state.tts.chunks.length) {
    stopSpeech();
    state.tts.chunks = splitSpeechText(text);
    state.tts.index = 0;
  }
  if (!state.tts.chunks.length) return toast(el.toast, "没有可朗读的正文");
  state.tts.playing = true;
  el.ttsPlayBtn.textContent = "\u2161";
  playSpeechChunk();
}

export async function playSpeechChunk() {
  if (!state.tts.playing || state.tts.index >= state.tts.chunks.length) {
    stopSpeech();
    el.playbackTitle.textContent = "朗读完成";
    refreshSpeechProgress();
    return;
  }
  var chunk = state.tts.chunks[state.tts.index];
  el.playbackTitle.textContent = chunk;
  refreshSpeechProgress();
  try {
    if (settings.ttsProvider === "mimo") await playMimoChunk(chunk);
    else await playSystemChunk(chunk);
    if (!state.tts.playing) return;
    state.tts.index += 1;
    playSpeechChunk();
  } catch (error) {
    stopSpeech();
    toast(el.toast, "朗读失败：" + error.message);
  }
}

function playSystemChunk(chunk) {
  return new Promise(function (resolve, reject) {
    if (!window.speechSynthesis) return reject(new Error("浏览器不支持系统 TTS"));
    var utterance = new SpeechSynthesisUtterance(chunk);
    utterance.rate = Number(el.speechRate.value) || 1;
    utterance.pitch = Number(settings.systemPitch) || 1;
    var voice = getSystemVoice();
    if (voice) utterance.voice = voice;
    utterance.onend = resolve;
    utterance.onerror = function (event) {
      if (event.error === "canceled" || event.error === "interrupted") resolve();
      else reject(new Error(event.error || "系统朗读失败"));
    };
    state.tts.utterance = utterance;
    window.speechSynthesis.speak(utterance);
  });
}

async function playMimoChunk(chunk) {
  if (!settings.ttsKey || !settings.ttsHost) throw new Error("请先配置 MiMo TTS");
  var speed = Number(el.speechRate.value) || 1;
  var hint = speed < 0.9 ? "语速较慢" : speed > 1.3 ? "语速较快" : "正常语速";
  var response = await fetch(settings.ttsHost.replace(/\/+$/, ""), {
    method: "POST",
    headers: { "Content-Type": "application/json", "api-key": settings.ttsKey },
    body: JSON.stringify({
      model: settings.ttsModel,
      messages: [{ role: "user", content: hint }, { role: "assistant", content: chunk }],
      audio: { format: "wav", voice: settings.ttsVoice },
      stream: false,
    }),
  });
  if (!response.ok) throw new Error("MiMo HTTP " + response.status);
  var data = await response.json();
  var base64 = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.audio && data.choices[0].message.audio.data;
  if (!base64) throw new Error("MiMo 响应中没有音频");
  var binary = atob(base64);
  var bytes = new Uint8Array(binary.length);
  for (var i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  state.tts.url = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  state.tts.audio = new Audio(state.tts.url);
  await state.tts.audio.play();
  await new Promise(function (resolve, reject) {
    state.tts.audio.onended = resolve;
    state.tts.audio.onerror = function () { reject(new Error("音频播放失败")); };
  });
  URL.revokeObjectURL(state.tts.url);
  state.tts.url = "";
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

export function populateVoices() {
  if (!window.speechSynthesis) return;
  var voices = window.speechSynthesis.getVoices() || [];
  el.systemVoice.innerHTML = '<option value="">默认音色</option>' + voices.map(function (voice) {
    return '<option value="' + voice.voiceURI + '">' + voice.name + " \u00b7 " + voice.lang + "</option>";
  }).join("");
  el.systemVoice.value = settings.systemVoice || "";
}
