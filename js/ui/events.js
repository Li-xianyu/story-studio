/* ============================================================
   浮光剧场 · Events
   ============================================================ */

import { state, settings, el, getStory, getChapter, touchStory, saveState, saveSettings, createStoryData, isPristineStory, applyReaderSettings } from "../core/state.js";
import { uid, nowIso, toast, setBusy } from "../core/utils.js";
import { renderAll, renderStory, renderStoryList, renderChapterList, renderControls, renderMemory, renderBranches, segmentHtml } from "./renderer.js";
import { openSettings, saveSettingsForm, syncTtsProviderFields, openSegmentEditor, saveSegmentEdit, createUndoSnapshot, undoLastChange } from "./dialogs.js";
import { syncAll } from "./custom-select.js";
import { speakText, stopSpeech, toggleSpeech, playFromIndex, playChapterFromIndex, playChapterFromSegment, toggleChapterFromSegment, populateVoices, flushStreamedParagraphs, resetStreamedState } from "../core/tts.js";
import { newChapter, renameChapter, deleteChapter, renameStory, deleteStory, saveBranch, restoreBranch, deleteSegment, rewriteFromSegment, closeMobilePanels } from "../story/story.js";
import { summarizeMemory, prepareChapterMemory, recentNarrative, looksNarrativeIncomplete, getLengthMaxTokens, buildSystemPrompt } from "../story/memory.js";
import { exportStory, importFile } from "../story/import-export.js";
import { openRelationGraph, closeRelationGraph } from "./relation-graph.js";
import { streamCompletion } from "../core/api.js";
import { parseInlineSpeechTrack, stripVoiceMarkers, buildSpeechAnnotationInput, parseSpeechAnnotation } from "../core/speech-track.js";

function isReaderNearBottom() {
  return el.readerViewport.scrollHeight - el.readerViewport.scrollTop - el.readerViewport.clientHeight < 20;
}
var userScrolledAway = false;
var userIsTouching = false;
var _programmaticScroll = false;
// 平滑滚动到底部（慢滚底）
// 移动端每行字少，速度翻倍（4px/帧 ≈ 240px/s）；桌面端 2px/帧 ≈ 120px/s
// 每帧重新计算 scrollHeight，内容持续生成时动画自动延展
var _smoothRaf = null;
var _smoothLastTop = 0;
function smoothScrollToBottom() {
  if (_smoothRaf) return;
  var pxPerFrame = window.matchMedia("(max-width: 760px)").matches ? 4 : 2;
  _smoothLastTop = el.readerViewport.scrollTop;
  function frame() {
    var rv = el.readerViewport;
    var current = rv.scrollTop;
    var maxScroll = rv.scrollHeight - rv.clientHeight;
    // 检测用户手动上滑中断
    if (current < _smoothLastTop - pxPerFrame) {
      _smoothRaf = null;
      userScrolledAway = true;
      return;
    }
    _smoothLastTop = current;
    if (current >= maxScroll) {
      _smoothRaf = null;
      return;
    }
    rv.scrollTop = Math.min(current + pxPerFrame, maxScroll);
    _smoothRaf = requestAnimationFrame(frame);
  }
  _smoothRaf = requestAnimationFrame(frame);
}

async function annotateSpeechTrack(story, content) {
  var numbered = buildSpeechAnnotationInput(content);
  if (!numbered) return [];
  console.log("[SpeechTrack] 提交给标注模型的编号文本\n" + numbered);
  var lines = numbered.split(/\r?\n/).filter(Boolean);
  var messages = [
    {
      role: "system",
      content: [
        "你是中文有声小说配音标注器。",
        "输入是已经按自然段.句子编号的小说文本，如 0.0 0.1 1.0 等。",
        "判断每个编号使用哪类声音：n=旁白，m=男性角色直接台词，f=女性角色直接台词。",
        "只有角色实际说出口的直接台词使用m或f；引号外的说话提示、动作、心理、神态和环境全部使用n。",
        "结合全文人物身份和上下文判断说话者，不要因为句子包含男性姓名或他就标m。",
        "例如：编号0.0的内容是 放那边就行。 则输出 0.0:m；编号0.1的内容是 他说声音不高 则输出 0.1:n。",
        "必须为每个编号输出一行，格式严格为 编号:字母。禁止解释，禁止复述原文，立即输出答案。"
      ].join("\n")
    },
    {
      role: "user",
      content: [
        story.memory.characters ? "人物关系：\n" + story.memory.characters : "",
        story.playerRole ? "用户角色：" + story.playerRole : "",
        "待标注文本：\n" + numbered
      ].filter(Boolean).join("\n\n")
    }
  ];
  var result = "";
  var completion;
  var parsed = [];
  var parsedCount = 0;
  for (var attempt = 1; attempt <= 2; attempt += 1) {
    result = "";
    completion = await streamCompletion(messages, function (delta) {
      result += delta;
    }, {
      maxTokens: Math.max(attempt === 1 ? 256 : 512, lines.length * (attempt === 1 ? 10 : 18)),
      temperature: 0,
      thinking: "disabled",
    });
    parsed = parseSpeechAnnotation(result);
    parsedCount = parsed.reduce(function (sum, track) { return sum + track.voices.length; }, 0);
    console.log("[SpeechTrack] 标注请求结束", {
      attempt: attempt,
      finishReason: completion.finishReason,
      outputCharacters: result.length,
      expectedLabels: lines.length,
      parsedLabels: parsedCount,
    });
    console.log("[SpeechTrack] 标注模型原始返回\n" + result);
    if (result.trim() && parsedCount >= lines.length) break;
    if (attempt === 1) console.warn("[SpeechTrack] 标注输出为空或不完整，正在提高预算重试");
  }
  if (!result.trim() || parsedCount < lines.length) {
    throw new Error(
      "标注输出不完整：期望 " + lines.length + " 条，实际 " + parsedCount +
      " 条，finish_reason=" + (completion && completion.finishReason || "unknown")
    );
  }
  console.log("[SpeechTrack] 解析后的隐藏声线轨道", parsed);
  return parsed;
}

function beginInlineRename(row, currentName, onCommit, onCancel) {
  if (!row || row.classList.contains("renaming")) return;
  var item = row.querySelector(".story-item, .chapter-item");
  var actions = row.querySelector(".story-row-actions, .chapter-row-actions");
  if (!item || !actions) return;

  var input = document.createElement("input");
  input.type = "text";
  input.className = "inline-title-input";
  input.value = currentName || "";
  input.setAttribute("aria-label", "\u91cd\u547d\u540d");
  row.classList.add("renaming");
  row.insertBefore(input, actions);

  var finished = false;
  function finish(shouldCommit) {
    if (finished) return;
    finished = true;
    var nextName = input.value.trim();
    if (shouldCommit && nextName && nextName !== currentName) onCommit(nextName);
    else onCancel();
  }

  input.addEventListener("keydown", function (event) {
    if (event.key === "Enter") {
      event.preventDefault();
      finish(true);
    } else if (event.key === "Escape") {
      event.preventDefault();
      finish(false);
    }
  });
  input.addEventListener("blur", function () { finish(true); }, { once: true });
  requestAnimationFrame(function () {
    input.focus();
    input.select();
  });
}

function rolePovInstruction(story) {
  if (story.pov === "第一人称") {
    return "本次正文必须继续使用第一人称叙述。把用户输入小说化，但不要逐句照抄，也不得切换为第二或第三人称。";
  }
  if (story.pov === "第二人称") {
    return "本次正文必须使用「你」指代用户扮演的核心视角角色。用户输入中的「我」应改写为「你」，不得切换为第一或第三人称。";
  }
  return "本次正文必须使用第三人称叙述。禁止把用户输入中的「我」原样作为叙述主体；应改写为角色「" +
    (story.playerRole || "当前主角") +
    "」的姓名或符合上下文的第三人称代词，不得切换为第一或第二人称。";
}

function buildRoleInstruction(story, value) {
  return [
    "用户以角色「" + (story.playerRole || "当前主角") + "」提供了一段剧情草稿：",
    value,
    "",
    "请把这段草稿视为角色已经做出或说出的事实，而不是可以原样复制进正文的第一人称文本。先解析「我」所指的角色，再改写成可直接接在前文之后的小说正文，随后描写环境和其他人物的自然反应。",
    "当前叙事视角由设置明确指定为「" + story.pov + "」，只能服从该设置，不得根据用户输入中的「我」或前文措辞自行改变人称。",
    rolePovInstruction(story),
    "玩家角色的控制权属于用户。只允许呈现本次输入已经明确写出的动作、台词和意图；禁止替玩家角色追加新的动作、台词、心理活动、判断、承诺、决定或下一步计划。",
    "不要为了推进故事而擅自引入新人物、新线索、突发事件、冲突升级或新的剧情分支。重点描写当前场景的空间、光线、声音、气味与氛围，细化已经发生的动作神态，并让在场其他人物针对用户明确行为作出直接、克制且符合人物逻辑的反应。",
    "如果用户向某人提问，最多写到对方的回答、犹豫或可观察反应；不要继续替玩家角色追问、表态或采取下一步行动。应在自然等待用户继续输入的位置停下。",
    "保持前文文风、时态、语气和信息边界，不显示角色标签，不引用原始输入，不解释改写过程。"
  ].join("\n");
}

function instructionFromGenerationSource(story, source) {
  if (!source || !source.input) return "";
  if (source.mode === "role") return buildRoleInstruction(story, source.input);
  if (source.mode === "director") {
    return "剧情指令：" + source.input + "\n自然落实到后续正文中，不要提及这条指令。";
  }
  if (source.mode === "preset") return source.input;
  return "";
}

function claimIncompleteTail(chapter, insertIndex) {
  if (!chapter || insertIndex <= 0) return null;
  var previous = chapter.segments[insertIndex - 1];
  if (!previous || !looksNarrativeIncomplete(previous.content)) return null;

  var content = String(previous.content || "").replace(/\s+$/, "");
  var boundary = Math.max(
    content.lastIndexOf("\n"),
    content.lastIndexOf("。"),
    content.lastIndexOf("！"),
    content.lastIndexOf("？"),
    content.lastIndexOf("…"),
    content.lastIndexOf("」"),
    content.lastIndexOf("」"),
    content.lastIndexOf("』")
  );
  var tail = content.slice(boundary + 1).trim();
  if (!tail || tail.length > 180) return null;

  previous.content = content.slice(0, boundary + 1).replace(/\s+$/, "");
  previous.truncated = false;
  return { text: tail, previous: previous };
}

async function generateNarrative(instruction, source, metadata) {
  if (state.generating) return;
  state.generating = true;
  var story = getStory();
  var chapter = getChapter();
  if (!story || !chapter) { state.generating = false; return; }
  story.started = true;
  var segment = {
    id: uid("segment"),
    type: "narrative",
    content: "",
    streaming: true,
    sourceInput: metadata && metadata.sourceInput || "",
    generationSource: metadata && metadata.generationSource || null,
    createdAt: nowIso()
  };
  console.groupCollapsed("[SpeechTrack] 正文生成流程");
  console.log("[SpeechTrack] 1/4 正在输出正文", {
    story: story.title,
    chapter: chapter.title,
    source: source,
  });
  var insertIndex = metadata && Number.isInteger(metadata.insertIndex)
    ? Math.max(0, Math.min(chapter.segments.length, metadata.insertIndex))
    : chapter.segments.length;
  var inheritedTail = claimIncompleteTail(chapter, insertIndex);
  chapter.segments.splice(insertIndex, 0, segment);
  renderStory({ toBottom: insertIndex === chapter.segments.length - 1 });
  // Find the streaming DOM node for in-place updates (no full re-render)
  var streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
  setBusy(el, true, source === "rewrite" ? "正在重写…" : "故事正在继续…");
  try {
    var narrativeContext = metadata && metadata.contextPrompt
      ? metadata.contextPrompt
      : "以下是当前章节最近的正文：\n\n" + (recentNarrative(chapter) || "尚无正文。");
    var continuationInstruction = inheritedTail
      ? [
          "",
          "上一部分因输出上限截断，并留下未完成片段：",
          inheritedTail.text,
          "新正文必须从这个片段自然接续，保留它的原意并把当前句补完整；不要重复已经完成的上文。",
          "补完残句后，继续严格执行下面的本轮要求。本轮用户输入与明确剧情指令优先级更高，不得忽略或改写其意图。"
        ].join("\n")
      : "";
    var messages = [
      { role: "system", content: buildSystemPrompt(story) },
      { role: "user", content: narrativeContext + continuationInstruction +
        "\n\n接下来请执行：" + (instruction || "自然续写故事，推进当前场景。") +
        "\n\n【硬性要求】每句人物对话的引号后必须紧跟 [m] 或 [f] 标记说话人性别（男[m] 女[f]），旁白不加标记。不加标记会导致朗读功能完全失效。示例：\"你来了。\"[m] \"嗯。\"[f]" }
    ];
    var completion = await streamCompletion(messages, function (delta) {
      segment.content += delta;
      // streaming TTS 已禁用，改为全文生成完后统一朗读
      // try { if (story.autoTts) flushStreamedParagraphs(segment.content); } catch (_) {}
      if (streamingNode) {
        streamingNode.outerHTML = segmentHtml(segment);
        streamingNode = document.querySelector('[data-segment-id="' + segment.id + '"]');
        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
      }
		      if (!userScrolledAway && !userIsTouching) {
		        smoothScrollToBottom();
		      }
    }, { maxTokens: getLengthMaxTokens(story.length) });
    segment.truncated = Boolean(
      segment.content.trim() &&
      (["length", "max_tokens"].includes(completion.finishReason) || looksNarrativeIncomplete(segment.content))
    );
    if (segment.truncated) {
      console.info("[Narrative] 输出在句中截断，残句将在下一部分接管", {
        finishReason: completion.finishReason,
        tail: segment.content.slice(-180),
      });
    }
    console.log("[SpeechTrack] 2/4 正文输出完成", {
      characters: segment.content.length,
      content: segment.content,
    });
    resetStreamedState();
    // 双层声线标注：先尝试内联 [m]/[f]，失败则二次请求
    var rawForDebug = segment.content;
    segment.speechTrack = parseInlineSpeechTrack(segment.content);
    segment.content = stripVoiceMarkers(segment.content);
    console.log("[SpeechTrack] 3/4 内联声线标注", segment.speechTrack);
    console.log("[SpeechTrack] 原文（含标记）:", rawForDebug);
    var markersFound = rawForDebug.match(/\[[nmf]\]/g);
    console.log("[SpeechTrack] 检测到的标记:", markersFound || "无");
    // 如果内联标注没有检测到任何标记，发起二次 AI 请求
    if (!markersFound || markersFound.length === 0) {
      console.log("[SpeechTrack] 内联标注为空，发起二次标注请求...");
      try {
        segment.speechTrack = await annotateSpeechTrack(story, segment.content);
        console.log("[SpeechTrack] 4/4 二次标注完成", segment.speechTrack);
      } catch (annotationError) {
        segment.speechTrack = [];
        console.error("[SpeechTrack] 二次标注失败", annotationError);
        toast(el.toast, "声线标注失败，使用默认旁白");
      }
    }
    segment.streaming = false;
    if (!segment.content.trim()) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    touchStory();
    renderAll();
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
    if (segment.content && story.autoTts) playChapterFromSegment(segment.id);
    if (story.autoContinue && !state.abortController.signal.aborted) {
      setTimeout(function () { generateNarrative("继续自然推进故事，不要重复上一段内容。", "auto"); }, 800);
    }
  } catch (error) {
    segment.streaming = false;
    if (inheritedTail && !segment.content) {
      inheritedTail.previous.content = [
        inheritedTail.previous.content,
        inheritedTail.text
      ].filter(Boolean).join("\n");
      inheritedTail.previous.truncated = true;
    }
    if (!segment.content) chapter.segments = chapter.segments.filter(function (item) { return item.id !== segment.id; });
    if (error.name !== "AbortError") toast(el.toast, "生成失败：" + error.message);
    renderAll();
  } finally {
    console.groupEnd();
    state.abortController = null;
    state.generating = false;
    setBusy(el, false);
    syncScrollToBottomBtn();
  }
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
      buildRoleInstruction(story, value),
      "role",
      {
        sourceInput: value,
        generationSource: { mode: "role", input: value },
      }
    );
    return;
  }
  await generateNarrative(
    "剧情指令：" + value + "\n自然落实到后续正文中，不要提及这条指令。",
    "director",
    {
      sourceInput: value,
      generationSource: { mode: "director", input: value },
    }
  );
}

function insertAfterSegment(segmentId) {
  var chapter = getChapter();
  if (!chapter || state.generating) return;
  var index = chapter.segments.findIndex(function (segment) { return segment.id === segmentId; });
  if (index < 0) return;
  var before = chapter.segments.slice(0, index + 1).map(function (segment) {
    return segment.content;
  }).join("\n\n").slice(-10000);
  var after = chapter.segments.slice(index + 1).map(function (segment) {
    return segment.content;
  }).join("\n\n").slice(0, 10000);
  createUndoSnapshot("已在此处插写");
  generateNarrative(
    "在前文与后文之间补写一段正文。必须自然承接前文，并准确过渡到后文已经发生的内容；不得改写、复述或否定后文。",
    "insert",
    {
      insertIndex: index + 1,
      contextPrompt: "插写位置之前的正文：\n\n" + before +
        "\n\n插写位置之后必须保留并衔接的正文：\n\n" + (after || "暂无后文，作为普通续写处理。"),
    }
  );
}

function stopGeneration() {
  if (state.abortController) state.abortController.abort();
  var chapter = getChapter();
  if (chapter) chapter.segments.forEach(function (segment) { segment.streaming = false; });
  setBusy(el, false, "已停止");
  touchStory();
  renderStory();
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

var PANEL_STATE_KEY = "floating-story-studio-panels-v1";

function saveDesktopPanelState() {
  if (!window.matchMedia("(min-width: 761px)").matches) return;
  localStorage.setItem(PANEL_STATE_KEY, JSON.stringify({
    libraryOpen: !document.body.classList.contains("library-collapsed"),
    controlsOpen: el.controlsPanel.classList.contains("open"),
  }));
}

function setLibraryOpen(open) {
  var mobile = window.matchMedia("(max-width: 760px)").matches;
  if (mobile) {
    if (open) openMobilePanel("library");
    else closeMobilePanels();
  } else {
    document.body.classList.toggle("library-collapsed", !open);
    saveDesktopPanelState();
  }
  document.getElementById("libraryToggle").setAttribute("aria-expanded", open ? "true" : "false");
  requestAnimationFrame(refreshComposerWidth);
}

function setControlsOpen(open) {
  if (window.matchMedia("(max-width: 760px)").matches) {
    if (open) openMobilePanel("controls");
    else closeMobilePanels();
    return;
  }
  el.controlsPanel.classList.toggle("open", open);
  el.controlsPanel.setAttribute("aria-hidden", open ? "false" : "true");
  if (!open && el.controlsPanel.contains(document.activeElement)) document.activeElement.blur();
  saveDesktopPanelState();
  requestAnimationFrame(refreshComposerWidth);
}

// 与 app.js 的 syncComposerWidth 同步，用于面板切换时更新输入框宽度
function refreshComposerWidth() {
  var viewport = document.getElementById("readerViewport");
  var composer = document.querySelector(".composer");
  var shell = document.querySelector(".reader-shell");
  if (!viewport || !composer || !shell) return;
  var vr = viewport.getBoundingClientRect();
  var sr = shell.getBoundingClientRect();
  var cs = getComputedStyle(viewport);
  var pl = parseFloat(cs.paddingLeft) || 0;
  var pr = parseFloat(cs.paddingRight) || 0;
  composer.style.left = (vr.left + pl - sr.left) + "px";
  composer.style.width = (viewport.clientWidth - pl - pr) + "px";
  composer.style.transform = "none";
  composer.style.maxWidth = "none";
}

function setAudioPanelOpen(open) {
  var distanceFromBottom = el.readerViewport.scrollHeight - el.readerViewport.scrollTop - el.readerViewport.clientHeight;
  var lastParagraph = el.storyContent.querySelector(".speech-block:last-of-type");
  var viewportRect = el.readerViewport.getBoundingClientRect();
  var lastParagraphRect = lastParagraph ? lastParagraph.getBoundingClientRect() : null;
  var lastParagraphVisible = Boolean(
    lastParagraphRect &&
    lastParagraphRect.top < viewportRect.bottom &&
    lastParagraphRect.bottom > viewportRect.top + viewportRect.height * 0.5
  );
  var nearBottom = distanceFromBottom < 96 && lastParagraphVisible;
  el.playerBar.classList.toggle("open", open);
  document.body.classList.toggle("audio-panel-open", open);
  if (!open) { var focused = el.playerBar.querySelector(":focus"); if (focused) focused.blur(); }
  el.playerBar.setAttribute("aria-hidden", open ? "false" : "true");
  el.audioPanelToggle.classList.toggle("active", open);
  el.audioPanelToggle.setAttribute("aria-expanded", open ? "true" : "false");
  if (open && nearBottom) {
    setTimeout(function () {
      var target = el.readerViewport.scrollHeight - el.readerViewport.clientHeight - distanceFromBottom;
      el.readerViewport.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
    }, 80);
  }
}

function syncSegmentActionPlacement(segmentNode) {
  if (!segmentNode) return;
  var viewportRect = el.readerViewport.getBoundingClientRect();
  var segmentRect = segmentNode.getBoundingClientRect();
  var topVisible = segmentRect.top >= viewportRect.top + 8 &&
    segmentRect.top <= viewportRect.bottom - 48;
  var bottomVisible = segmentRect.bottom <= viewportRect.bottom - 8 &&
    segmentRect.bottom >= viewportRect.top + 48;
  segmentNode.classList.toggle("actions-bottom", !topVisible && bottomVisible);
  segmentNode.classList.toggle("actions-fixed", !topVisible && !bottomVisible);
  var actionsEl = segmentNode.querySelector(".segment-actions");
  if (!actionsEl) return;
  if (!topVisible && !bottomVisible) {
    var storyRect = el.storyContent.getBoundingClientRect();
    actionsEl.style.right = Math.max(4, window.innerWidth - storyRect.right + 4) + "px";
  } else {
    actionsEl.style.right = "";
  }
}

async function copySegmentContent(segmentId, button) {
  var chapter = getChapter();
  var segment = chapter && chapter.segments.find(function (item) { return item.id === segmentId; });
  if (!segment) return;
  var succeeded = false;
  try {
    await navigator.clipboard.writeText(segment.content || "");
    succeeded = true;
  } catch (_) {
    var textarea = document.createElement("textarea");
    textarea.value = segment.content || "";
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    succeeded = document.execCommand("copy");
    textarea.remove();
  }
  button.innerHTML = '<i data-lucide="' + (succeeded ? "check" : "circle-x") + '"></i>';
  button.classList.toggle("copy-failed", !succeeded);
  if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  clearTimeout(Number(button.dataset.feedbackTimer) || 0);
  button.dataset.feedbackTimer = String(setTimeout(function () {
    button.innerHTML = '<i data-lucide="copy"></i>';
    button.classList.remove("copy-failed");
    if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
  }, 3000));
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
  var pendingRewriteSegmentId = "";

  function rewriteSegment(segmentId, useOriginalInput) {
    var chapter = getChapter();
    var story = getStory();
    var segment = chapter && chapter.segments.find(function (item) { return item.id === segmentId; });
    if (!segment || !story) return;
    var source = segment.generationSource;
    var instruction = useOriginalInput
      ? instructionFromGenerationSource(story, source)
      : "根据保留的上文重新写出此处应当发生的后续。自由发挥，但保持既有设定、人物逻辑与叙事视角，不要复用被删除正文的措辞。";
    rewriteFromSegment(segmentId);
    generateNarrative(instruction || "根据上文自然重写后续正文。", "rewrite", {
      sourceInput: useOriginalInput && source ? source.input : "",
      generationSource: useOriginalInput ? source : null,
    });
  }

  function requestSegmentRewrite(segmentId) {
    var chapter = getChapter();
    var segment = chapter && chapter.segments.find(function (item) { return item.id === segmentId; });
    if (!segment) return;
    if (segment.generationSource && segment.generationSource.input) {
      pendingRewriteSegmentId = segmentId;
      var labels = { role: "角色入戏", director: "剧情指令", preset: "剧情预设" };
      el.rewriteSourcePreview.textContent =
        (labels[segment.generationSource.mode] || "用户输入") + "：" + segment.generationSource.input;
      el.rewriteChoiceDialog.showModal();
      return;
    }
    rewriteSegment(segmentId, false);
  }

  document.getElementById("newStoryBtn").addEventListener("click", function () { el.setupDialog.showModal(); });
  document.getElementById("emptyStartBtn").addEventListener("click", function () { el.setupDialog.showModal(); });
  document.getElementById("addChapterBtn").addEventListener("click", async function () {
    if (state.generating) return;
    var chapter = newChapter();
    if (!chapter) return;
    await prepareChapterMemory();
  });
  document.getElementById("settingsBtn").addEventListener("click", function () { openSettings(); });
  document.getElementById("readingSettingsBtn").addEventListener("click", function () {
    el.readerFontSize.value = settings.readerFontSize;
    el.readerLineHeight.value = settings.readerLineHeight;
    el.readerIndentToggle.checked = Boolean(settings.readerIndent);
    syncAll();
    el.readingSettingsDialog.showModal();
  });
  el.readerFontSize.addEventListener("change", function () {
    settings.readerFontSize = el.readerFontSize.value;
    saveSettings();
    applyReaderSettings();
  });
  el.readerLineHeight.addEventListener("change", function () {
    settings.readerLineHeight = el.readerLineHeight.value;
    saveSettings();
    applyReaderSettings();
  });
  el.readerIndentToggle.addEventListener("change", function () {
    settings.readerIndent = el.readerIndentToggle.checked;
    saveSettings();
    applyReaderSettings();
  });
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
  document.getElementById("controlsBtn").addEventListener("click", function () {
    setControlsOpen(!el.controlsPanel.classList.contains("open"));
  });
  el.audioPanelToggle.addEventListener("click", function () {
    setAudioPanelOpen(!el.playerBar.classList.contains("open"));
  });
  document.getElementById("audioPanelClose").addEventListener("click", function () { setAudioPanelOpen(false); });
  el.mobileBackdrop.addEventListener("click", closeMobilePanels);
  document.querySelectorAll("[data-close-panel]").forEach(function (button) {
    button.addEventListener("click", function () {
      if (button.dataset.closePanel === "library") setLibraryOpen(false);
      else setControlsOpen(false);
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
    if (event.target.closest(".inline-title-input")) return;
    var actionButton = event.target.closest("[data-story-action]");
    if (actionButton) {
      event.stopPropagation();
      if (actionButton.dataset.storyAction === "delete") {
        var story = state.stories.find(function (item) { return item.id === actionButton.dataset.storyId; });
        if (!story) return;
        pendingDeleteStoryId = story.id;
        el.deleteStoryName.textContent = story.title || "未命名故事";
        el.deleteStoryDialog.showModal();
        return;
      }
      if (actionButton.dataset.storyAction === "rename") {
        var storyToRename = state.stories.find(function (item) { return item.id === actionButton.dataset.storyId; });
        if (!storyToRename) return;
        beginInlineRename(
          actionButton.closest(".story-row"),
          storyToRename.title || "",
          function (name) { renameStory(storyToRename.id, name); },
          renderStoryList
        );
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
  el.rewriteChoiceDialog.addEventListener("close", function () {
    pendingRewriteSegmentId = "";
  });
  el.rewriteFromInputBtn.addEventListener("click", function () {
    var segmentId = pendingRewriteSegmentId;
    el.rewriteChoiceDialog.close();
    if (segmentId) rewriteSegment(segmentId, true);
  });
  el.rewriteFreeBtn.addEventListener("click", function () {
    var segmentId = pendingRewriteSegmentId;
    el.rewriteChoiceDialog.close();
    if (segmentId) rewriteSegment(segmentId, false);
  });
  el.chapterList.addEventListener("click", function (event) {
    if (event.target.closest(".inline-title-input")) return;
    var actionButton = event.target.closest("[data-chapter-action]");
    if (actionButton) {
      event.stopPropagation();
      if (actionButton.dataset.chapterAction === "rename") {
        var chapterStory = getStory();
        var chapterToRename = chapterStory && chapterStory.chapters.find(function (item) {
          return item.id === actionButton.dataset.chapterId;
        });
        if (!chapterToRename) return;
        beginInlineRename(
          actionButton.closest(".chapter-row"),
          chapterToRename.title || "",
          function (name) { renameChapter(chapterToRename.id, name); },
          renderChapterList
        );
      }
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
      event.stopPropagation();
      var segmentId = segmentNode.dataset.segmentId;
      var action = actionButton.dataset.segmentAction;
      if (action === "readFromHere") toggleChapterFromSegment(segmentId);
      if (action === "copy") copySegmentContent(segmentId, actionButton);
      if (action === "edit") openSegmentEditor(segmentId);
      if (action === "rewrite") requestSegmentRewrite(segmentId);
      if (action === "insert") insertAfterSegment(segmentId);
	      if (action === "continue") {
	        var curCh = getChapter();
	        if (curCh) {
	          var segIdx = curCh.segments.findIndex(function (s) { return s.id === segmentId; });
	          if (segIdx >= 0) {
	            var before = curCh.segments.slice(Math.max(0, segIdx - 8), segIdx + 1).map(function (s) {
	              return s.content;
	            }).join("\n\n").slice(-10000);
	            generateNarrative("紧接当前章节正文自然续写并推进场景。", "continue", {
	              insertIndex: segIdx + 1,
	              contextPrompt: "当前章节：「" + curCh.title + "」。续写位置是本章末尾，后续暂无正文。请严格承接本章已有正文续写，不得跳到后续章节尚未发生的情节。\n\n续写位置之前的正文（最近部分）：\n\n" + before,
	            });
	            return;
	          }
	        }
	        generateNarrative("紧接当前正文自然续写并推进场景。", "continue");
	      }
      if (action === "delete") {
        requestInlineConfirm(actionButton, function () { deleteSegment(segmentId); });
      }
      return;
    }
  });
  el.storyContent.addEventListener("pointerover", function (event) {
    if (window.matchMedia("(hover: hover)").matches) {
      syncSegmentActionPlacement(event.target.closest(".speech-block") &&
        event.target.closest("[data-segment-id]"));
    }
  });
		  el.readerViewport.addEventListener("scroll", function () {
		    if (!_smoothRaf && !_programmaticScroll && !el.readerViewport.dataset.programmaticScroll) {
		      userScrolledAway = !isReaderNearBottom();
		    }
		    _programmaticScroll = false;
		    delete el.readerViewport.dataset.programmaticScroll;
	    syncScrollToBottomBtn();
	    var activeSegment = el.storyContent.querySelector(".segment:hover, .segment.actions-open");
	    if (activeSegment) syncSegmentActionPlacement(activeSegment);
	  }, { passive: true });
	  el.readerViewport.addEventListener("pointerdown", function (event) {
	    if (event.pointerType === "mouse") return;
	    userIsTouching = true;
	    // 触摸时立即停掉慢滚底动画，让用户自由滑动
	    if (_smoothRaf) { cancelAnimationFrame(_smoothRaf); _smoothRaf = null; }
	  });
  el.readerViewport.addEventListener("pointerup", function () {
    userIsTouching = false;
  });
  el.readerViewport.addEventListener("pointercancel", function () {
    userIsTouching = false;
  });
  function syncScrollToBottomBtn() {
    var show = userScrolledAway && state.generating;
    el.scrollToBottomBtn.classList.toggle("hidden", !show);
  }
	  el.scrollToBottomBtn.addEventListener("click", function () {
	    userScrolledAway = false;
	    var rv = el.readerViewport;
	    _programmaticScroll = true;
	    rv.style.scrollBehavior = 'auto';
	    rv.scrollTop = rv.scrollHeight;
	    rv.style.removeProperty('scroll-behavior');
	    el.scrollToBottomBtn.classList.add("hidden");
	  });
  var longPressTimer = 0;
  var longPressStart = null;
  var longPressTriggered = false;
  var lastMobileTap = null;
  var singleTapTimer = 0;

  function playParagraphFromNode(paragraph) {
    if (!state.tts.playing && !el.playerBar.classList.contains("open")) return;
    var index = Number(paragraph && paragraph.dataset.speechIndex);
    if (!Number.isFinite(index)) return;
    window.getSelection().removeAllRanges();
    playChapterFromIndex(index);
  }

  function toggleSegmentActions(segmentNode) {
    var wasOpen = segmentNode.classList.contains("actions-open");
    el.storyContent.querySelectorAll(".segment.actions-open").forEach(function (node) {
      if (node !== segmentNode) node.classList.remove("actions-open", "actions-fixed", "actions-bottom");
    });
    if (wasOpen) {
      segmentNode.classList.remove("actions-open", "actions-fixed", "actions-bottom");
    } else {
      syncSegmentActionPlacement(segmentNode);
      segmentNode.classList.add("actions-open");
      window.getSelection().removeAllRanges();
    }
  }

  el.storyContent.addEventListener("pointerdown", function (event) {
    if (!window.matchMedia("(max-width: 760px)").matches || event.pointerType === "mouse") return;
    var block = event.target.closest(".speech-block");
    var segmentNode = event.target.closest("[data-segment-id]");
    if (!segmentNode) return;
    longPressTriggered = false;
    longPressStart = {
      x: event.clientX,
      y: event.clientY,
      time: Date.now(),
      block: block,
      segment: segmentNode,
    };
    clearTimeout(longPressTimer);
    longPressTimer = setTimeout(function () {
      longPressTriggered = true;
      clearTimeout(singleTapTimer);
      lastMobileTap = null;
      navigator.vibrate && navigator.vibrate(20);
      toggleSegmentActions(segmentNode);
      longPressStart = null;
    }, 320);
  });
  el.storyContent.addEventListener("pointermove", function (event) {
    if (!longPressStart) return;
    if (Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10) {
      clearTimeout(longPressTimer);
      longPressStart = null;
    }
  });
  el.storyContent.addEventListener("pointerup", function (event) {
    clearTimeout(longPressTimer);
    if (longPressStart && !longPressTriggered &&
        Date.now() - longPressStart.time < 320 &&
        Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) <= 10) {
      var now = Date.now();
      var block = longPressStart.block;
      var segmentNode = longPressStart.segment;
      if (lastMobileTap &&
          lastMobileTap.block === block &&
          now - lastMobileTap.time <= 380 &&
          Math.hypot(event.clientX - lastMobileTap.x, event.clientY - lastMobileTap.y) <= 28) {
        event.preventDefault();
        clearTimeout(singleTapTimer);
        playParagraphFromNode(block);
        lastMobileTap = null;
	      } else {
	        clearTimeout(singleTapTimer);
	        lastMobileTap = { block: block, time: now, x: event.clientX, y: event.clientY, segment: segmentNode };
	        singleTapTimer = setTimeout(function () {
	          lastMobileTap = null;
	        }, 400);
	      }
    }
    longPressStart = null;
    longPressTriggered = false;
  });
  el.storyContent.addEventListener("pointercancel", function () {
    clearTimeout(longPressTimer);
    clearTimeout(singleTapTimer);
    longPressStart = null;
    longPressTriggered = false;
  });
  el.storyContent.addEventListener("contextmenu", function (event) {
    if (window.matchMedia("(max-width: 760px)").matches && event.target.closest("[data-segment-id]")) {
      event.preventDefault();
    }
  });
  document.addEventListener("pointerdown", function (event) {
    if (event.target.closest(".segment.actions-open")) return;
    el.storyContent.querySelectorAll(".segment.actions-open").forEach(function (node) {
      node.classList.remove("actions-open", "actions-fixed", "actions-bottom");
    });
  });
  el.storyContent.addEventListener("dblclick", function (event) {
    var paragraph = event.target.closest(".speech-block");
    if (!paragraph) return;
    playParagraphFromNode(paragraph);
  });

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
	  el.composerInput.addEventListener("input", syncComposerHeight);
  document.getElementById("quickContinueBtn").addEventListener("click", function () {
    generateNarrative("自然续写并推进当前场景。", "continue");
  });
  document.getElementById("rewriteBtn").addEventListener("click", function () {
    var chapter = getChapter();
    if (!chapter || state.generating) return;
    var segment = chapter.segments.slice().reverse().find(function (item) {
      return item.type === "narrative";
    });
    if (!segment) return toast(el.toast, "还没有可重写的正文");
    requestSegmentRewrite(segment.id);
  });
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
    if (button) generateNarrative(button.dataset.directive, "preset", {
      sourceInput: button.dataset.directive,
      generationSource: { mode: "preset", input: button.dataset.directive },
    });
  });

  el.setupForm.addEventListener("submit", function (event) {
    if (event.submitter && event.submitter.value === "cancel") return;
    event.preventDefault();
    var story = createStoryData(
      el.setupTitle.value.trim(),
      el.setupPrompt.value.trim(),
      el.setupRole.value.trim(),
      el.setupGenre.value.trim(),
      el.setupPov.value
    );
    state.stories = state.stories.filter(function (item) { return !isPristineStory(item); });
    state.stories.push(story);
    state.activeStoryId = story.id;
    state.activeChapterId = story.chapters[0].id;
    saveState(); renderAll(); el.setupDialog.close(); el.setupForm.reset();
    generateNarrative("根据开场设定写出小说第一幕。直接进入场景，以有吸引力但不故弄玄虚的方式开篇。", "opening");
  });

	  // 人物关系图：点击「关系图」按钮弹出居中力导向图弹窗
	  var openRelationGraphBtn = document.getElementById("openRelationGraphBtn");
	  if (openRelationGraphBtn) {
	    openRelationGraphBtn.addEventListener("click", function (event) {
	      event.preventDefault();
	      openRelationGraph(getStory());
	    });
	  }
	  // 关系图弹窗关闭时销毁网络实例，避免残留
	  var relationGraphDialog = document.getElementById("relationGraphDialog");
	  if (relationGraphDialog) {
	    relationGraphDialog.addEventListener("close", function () {
	      closeRelationGraph();
	    });
	  }
	  // 关系图弹窗：收起事件由弹窗内的关闭按钮处理

	  document.querySelectorAll("[data-memory]").forEach(function (button) {
	    button.addEventListener("click", function (event) {
	      event.preventDefault();
	      state.memoryEditingKey = button.dataset.memory;
	      var labels = {
	        chapterSummaries: "故事摘要",
	        characters: "人物关系",
	        worldConstants: "世界常数",
	        worldEvolution: "世界演化",
	        threads: "未解伏笔",
	        characterAttributes: "主角属性"
	      };
	      el.memoryDialogTitle.textContent = "编辑" + (labels[state.memoryEditingKey] || state.memoryEditingKey);
	      var val = getStory().memory[state.memoryEditingKey];
	      // chapterSummaries 是对象，拼接显示
	      if (state.memoryEditingKey === "chapterSummaries" && typeof val === "object") {
	        var lines = [];
	        var story = getStory();
	        var chMap = {};
	        (story.chapters || []).forEach(function (ch) { chMap[ch.id] = ch.title; });
	        Object.keys(val || {}).forEach(function (cid) {
	          var t = chMap[cid] || cid;
	          if (t === "__legacy__") t = "早期摘要";
	          lines.push("【" + t + "】\n" + (val[cid] || ""));
	        });
	        el.memoryEditor.value = lines.join("\n\n") || "";
	      } else {
	        el.memoryEditor.value = val || "";
	      }
	      el.memoryDialog.showModal();
	    });
	  });
	  document.getElementById("memoryForm").addEventListener("submit", function (event) {
	    if (event.submitter && event.submitter.value === "cancel") return;
	    event.preventDefault();
	    var story = getStory();
	    var key = state.memoryEditingKey;
	    var raw = el.memoryEditor.value.trim();
	    if (key === "chapterSummaries") {
	      // 解析回 chapterSummaries 对象
	      var parsed = {};
	      var lines = raw.split("\n");
	      var curId = null;
	      var curLines = [];
	      var chMap = {};
	      (story.chapters || []).forEach(function (ch) { chMap[ch.title] = ch.id; });
	      chMap["早期摘要"] = "__legacy__";
	      lines.forEach(function (line) {
	        var m = line.match(/^【(.+?)】/);
	        if (m) {
	          if (curId) { parsed[curId] = curLines.join("\n").trim(); }
	          var title = m[1];
	          curId = chMap[title] || title;
	          curLines = [];
	        } else {
	          curLines.push(line);
	        }
	      });
	      if (curId) { parsed[curId] = curLines.join("\n").trim(); }
	      story.memory.chapterSummaries = parsed;
	    } else {
	      story.memory[key] = raw;
	    }
	    touchStory(); renderMemory(); el.memoryDialog.close();
	  });
	  // AI 修改记忆
	  if (el.memoryAiBtn) {
	    var doAiModify = async function () {
	      var input = (el.memoryAiInput.value || "").trim();
	      if (!input) { toast(el.toast, "请先输入修改要求"); return; }
	      var key = state.memoryEditingKey;
	      var story = getStory();
	      var labelMap = { characters: "人物关系", worldConstants: "世界观", worldEvolution: "世界演化", threads: "未解伏笔", characterAttributes: "主角属性", chapterSummaries: "故事摘要" };
	      var label = labelMap[key] || key;
	      var current = el.memoryEditor.value.trim();
	      setBusy(el, true, "AI 正在修改" + label + "…");
	      el.memoryAiBtn.disabled = true;
	      try {
	        // 收集相关章节原文供 AI 参考
	        var contextText = "";
	        if (story && story.chapters) {
	          var chapters = story.chapters.filter(function (ch) {
	            return ch.segments.some(function (s) { return String(s.content || "").trim(); });
	          });
	          if (chapters.length) {
	            var snippets = chapters.slice(-3).map(function (ch) {
	              var txt = ch.segments.map(function (s) { return s.content; }).filter(Boolean).join("\n\n");
	              return "【" + (ch.title || "章节") + "】\n" + txt.slice(-6000);
	            });
	            contextText = "原文参考：\n" + snippets.join("\n\n---\n\n");
	          }
	        }
	        var prompt = "用户正在编辑「" + label + "」。\n"
	          + contextText + "\n"
	          + "当前内容：\n" + current + "\n\n"
	          + "用户要求：" + input + "\n\n"
	          + "请根据原文和用户要求，直接返回修改后的完整内容。不要添加解释，只输出修改后的文本。"
	          + "必须忠实于原文信息，不要编造不存在的人物、名字或细节。如果原文中某角色没有名字只有描述（如'马尾女生''瘦高个'），请保持这些描述，不要自行起名。";
	        var messages = [
	          { role: "system", content: "你是写作助手，帮助用户修改故事记忆。只输出修改后的内容，不加解释。禁止编造原文中没有的人名和细节。" },
	          { role: "user", content: prompt }
	        ];
	        var result = "";
	        // 初始清空 textarea，准备显示流式输出
	        el.memoryEditor.value = "";
	        await streamCompletion(messages, function (delta) {
	          result += delta;
	          // 实时显示到 textarea
	          el.memoryEditor.value = result;
	          el.memoryEditor.scrollTop = el.memoryEditor.scrollHeight;
	        }, { temperature: 0.4 });
	        result = result.replace(/^```[\s\S]*?\n?|```$/g, "").trim();
	        if (result) {
	          el.memoryEditor.value = result;
	          // 自动保存
	          if (key === "chapterSummaries") {
	            var parsed = {};
	            var lines2 = result.split("\n");
	            var curId = null;
	            var curLines = [];
	            var chMap = {};
	            (story.chapters || []).forEach(function (ch) { chMap[ch.title] = ch.id; });
	            chMap["早期摘要"] = "__legacy__";
	            lines2.forEach(function (line) {
	              var m = line.match(/^【(.+?)】/);
	              if (m) {
	                if (curId) { parsed[curId] = curLines.join("\n").trim(); }
	                curId = chMap[m[1]] || m[1];
	                curLines = [];
	              } else { curLines.push(line); }
	            });
	            if (curId) { parsed[curId] = curLines.join("\n").trim(); }
	            story.memory.chapterSummaries = parsed;
	          } else {
	            story.memory[key] = result;
	          }
	          touchStory(); renderMemory(); el.memoryDialog.close();
	          toast(el.toast, label + "已修改并保存");
	        } else {
	          toast(el.toast, "AI 未返回有效内容");
	        }
	        el.memoryAiInput.value = "";
	      } catch (err) {
	        if (err.name !== "AbortError") toast(el.toast, "修改失败：" + (err.message || String(err)));
	      } finally {
	        setBusy(el, false);
	        el.memoryAiBtn.disabled = false;
	      }
	    };
	    el.memoryAiBtn.addEventListener("click", doAiModify);
	    el.memoryAiInput.addEventListener("keydown", function (e) {
	      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doAiModify(); }
	    });
	  }
  document.getElementById("saveSegmentBtn").addEventListener("click", function () {
    saveSegmentEdit();
  });
	  document.getElementById("undoBtn").addEventListener("click", undoLastChange);

		  // 重置记忆 — 原位二次确认
		  var resetMemoryBtn = document.getElementById("resetMemoryBtn");
		  if (resetMemoryBtn) {
		    resetMemoryBtn.addEventListener("click", function () {
		      if (resetMemoryBtn.dataset.confirming === "true") {
		        clearTimeout(Number(resetMemoryBtn.dataset.confirmTimer) || 0);
		        // 执行清空
		        resetMemoryBtn.dataset.confirming = "false";
		        resetMemoryBtn.classList.remove("confirming");
		        resetMemoryBtn.querySelector(".btn-default").hidden = false;
		        resetMemoryBtn.querySelector(".btn-confirm").hidden = true;
		        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
		        var story = getStory();
		        if (story && story.memory) {
		          story.memory.chapterSummaries = {};
		          story.memory.characters = "";
		          story.memory.worldConstants = "";
		          story.memory.worldEvolution = "";
		          story.memory.threads = "";
		          story.memory.characterAttributes = "";
		          delete story.memory.summary;
		          delete story.memory.world;
		        }
		        touchStory();
		        renderMemory();
		        toast(el.toast, "记忆已清空，可重新整理");
		        return;
		      }
		      // 第一次点击 → 进入确认状态
		      resetMemoryBtn.dataset.originalHtml = resetMemoryBtn.innerHTML;
		      resetMemoryBtn.dataset.confirming = "true";
		      resetMemoryBtn.classList.add("confirming");
		      resetMemoryBtn.querySelector(".btn-default").hidden = true;
		      resetMemoryBtn.querySelector(".btn-confirm").hidden = false;
		      if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
		      resetMemoryBtn.dataset.confirmTimer = String(setTimeout(function () {
		        resetMemoryBtn.dataset.confirming = "false";
		        resetMemoryBtn.classList.remove("confirming");
		        resetMemoryBtn.querySelector(".btn-default").hidden = false;
		        resetMemoryBtn.querySelector(".btn-confirm").hidden = true;
		        if (window.lucide && typeof window.lucide.createIcons === "function") window.lucide.createIcons();
		      }, 3000));
		    });
		  }

  document.querySelectorAll("[data-settings-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll("[data-settings-tab]").forEach(function (item) { item.classList.toggle("active", item === button); });
      document.querySelectorAll("[data-settings-panel]").forEach(function (panel) { panel.hidden = panel.dataset.settingsPanel !== button.dataset.settingsTab; });
    });
  });
  document.querySelectorAll("[data-rs-tab]").forEach(function (button) {
    button.addEventListener("click", function () {
      document.querySelectorAll("[data-rs-tab]").forEach(function (item) { item.classList.toggle("active", item === button); });
      document.querySelectorAll("[data-rs-panel]").forEach(function (panel) { panel.hidden = panel.dataset.rsPanel !== button.dataset.rsTab; });
    });
  });
  el.ttsProvider.addEventListener("change", syncTtsProviderFields);

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

  // 缩到 mobile 断点时自动隐藏右侧栏，展开时恢复
  var mobileMql = window.matchMedia("(max-width: 760px)");
  var wasControlsOpen = false;
  if (mobileMql.matches) wasControlsOpen = el.controlsPanel.classList.contains("open");
  mobileMql.addListener(function (ev) {
    if (ev.matches) {
      wasControlsOpen = el.controlsPanel.classList.contains("open");
      el.controlsPanel.classList.remove("open");
    } else if (wasControlsOpen) {
      el.controlsPanel.classList.add("open");
    }
  });

  /* ---- 全页面右键菜单 ---- */
  var menu = el.contextMenu;
  var menuButtons = {
    ctxContinue: function () { generateNarrative("自然续写并推进当前场景。", "continue"); },
    ctxSummarize: summarizeMemory,
    ctxRewriteLast: function () {
      var chapter = getChapter();
      if (!chapter || state.generating) return;
      var lastNarrative = chapter.segments.slice().reverse().find(function (s) { return s.type === "narrative"; });
      if (!lastNarrative) return toast(el.toast, "没有可重写的正文");
      rewriteFromSegment(lastNarrative.id);
      generateNarrative("根据上文自然重写后续正文。", "rewrite");
    },
    ctxSaveBranch: saveBranch,
    ctxToggleLibrary: function () {
      var mobile = window.matchMedia("(max-width: 760px)").matches;
      var open = mobile
        ? !el.libraryPanel.classList.contains("open")
        : document.body.classList.contains("library-collapsed");
      setLibraryOpen(open);
    },
    ctxToggleControls: function () { setControlsOpen(!el.controlsPanel.classList.contains("open")); },
    ctxToggleFocus: function () { document.body.classList.toggle("focus-mode"); },
    ctxReadSettings: function () {
      el.readerFontSize.value = settings.readerFontSize;
      el.readerLineHeight.value = settings.readerLineHeight;
      el.readerIndentToggle.checked = Boolean(settings.readerIndent);
      syncAll();
      el.readingSettingsDialog.showModal();
    },
    ctxExport: exportStory,
    ctxNewStory: function () { el.setupDialog.showModal(); },
  };

  function showContextMenu(x, y) {
    hideContextMenu();
    var dw = document.documentElement;
    var w = dw.clientWidth;
    var h = dw.clientHeight;
    var menuW = Math.min(280, w - 20);
    menu.style.maxWidth = menuW + "px";
    // 先放一个临时位置触发 layout，算出真实高度
    menu.style.left = "0px";
    menu.style.top = "0px";
    menu.style.pointerEvents = "none";
    menu.classList.add("open");
    var realH = menu.getBoundingClientRect().height;
    menu.classList.remove("open");
    menu.style.pointerEvents = "";
    // 正式定位
    var left = x + menuW > w - 8 ? w - menuW - 8 : x;
    var top = y + realH > h - 8 ? y - realH - 4 : y;
    if (top < 0) top = 4;
    menu.style.left = left + "px";
    menu.style.top = top + "px";
    menu.style.setProperty("--ctx-origin", y + realH > h - 8 ? "bottom left" : "top left");
    menu.classList.add("open");
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons();
    }
  }

  function hideContextMenu() {
    menu.classList.remove("open");
  }

  // Desktop: custom menu on right-click, suppress browser default
  document.addEventListener("contextmenu", function (event) {
    if (window.matchMedia("(max-width: 760px)").matches) return; // let mobile keep long-press
    // allow native on inputs/textarea
    if (event.target.closest("input, textarea, [contenteditable]")) return;
    event.preventDefault();
    showContextMenu(event.clientX, event.clientY);
  });

  menu.addEventListener("click", function (event) {
    var btn = event.target.closest("[id^='ctx']");
    if (!btn) return;
    hideContextMenu();
    var fn = menuButtons[btn.id];
    if (typeof fn === "function") fn();
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest("#contextMenu")) hideContextMenu();
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape") hideContextMenu();
  });

  el.readerViewport.addEventListener("scroll", function () { hideContextMenu(); }, { passive: true });
}
