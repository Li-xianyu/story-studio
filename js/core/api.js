/* ============================================================
   浮光剧场 · API Client
   ============================================================ */

import { settings, state } from "./state.js";
import { openSettings } from "../ui/dialogs.js";

export function normalizedHost(host) {
  var value = String(host || "").trim().replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(value)) return value;
  if (/\/v1$/i.test(value)) return value + "/chat/completions";
  return value + "/v1/chat/completions";
}

export async function streamCompletion(messages, onDelta, options) {
  if (!settings.apiKey || !settings.apiHost || !settings.apiModel) {
    openSettings("请先配置模型接口");
    throw new Error("请先配置模型接口");
  }
  state.abortController = new AbortController();
  // Resolve target model and thinking state based on options and settings
  var targetModel = settings.apiModel;
  var isThinkingActive = !!settings.thinkingEnabled;
  if (options && options.thinking === "disabled") {
    isThinkingActive = false;
  }

  // Auto model switching for official DeepSeek and SiliconFlow models
  if (isThinkingActive) {
    if (targetModel === "deepseek-chat") {
      targetModel = "deepseek-reasoner";
    } else if (targetModel === "deepseek-ai/DeepSeek-V3") {
      targetModel = "deepseek-ai/DeepSeek-R1";
    } else if (targetModel.indexOf("V3") !== -1 && targetModel.indexOf("R1") === -1) {
      targetModel = targetModel.replace("V3", "R1").replace("v3", "r1");
    }
  } else {
    if (targetModel === "deepseek-reasoner") {
      targetModel = "deepseek-chat";
    } else if (targetModel === "deepseek-ai/DeepSeek-R1") {
      targetModel = "deepseek-ai/DeepSeek-V3";
    } else if (targetModel.indexOf("R1") !== -1 && targetModel.indexOf("V3") === -1) {
      targetModel = targetModel.replace("R1", "V3").replace("r1", "v3");
    }
  }

  var body = {
    model: targetModel,
    messages: messages,
    stream: true,
    temperature: options && options.temperature !== undefined
      ? Number(options.temperature)
      : Number(settings.temperature) || 0.9,
    max_tokens: Number(options && options.maxTokens) || undefined,
  };
  if (!body.max_tokens) delete body.max_tokens;

  // Apply thinking/reasoning effort parameters safely to avoid 400 errors on standard endpoints
  if (isThinkingActive) {
    if (targetModel.indexOf("o1") !== -1 || targetModel.indexOf("o3") !== -1) {
      body.reasoning_effort = "medium";
      delete body.temperature;
    } else if (settings.apiHost.indexOf("siliconflow") !== -1 && targetModel.indexOf("R1") !== -1) {
      body.thinking_budget = 2048;
    } else {
      body.thinking = { type: "enabled" };
    }
  } else {
    if (targetModel.indexOf("o1") !== -1 || targetModel.indexOf("o3") !== -1) {
      body.reasoning_effort = "low";
      delete body.temperature;
    } else {
      body.thinking = { type: "disabled" };
    }
  }

  if (options && options.thinking) body.thinking = { type: options.thinking };
  if (options && options.responseFormat) body.response_format = options.responseFormat;
  var response = await fetch(normalizedHost(settings.apiHost), {
    method: "POST",
    headers: { Authorization: "Bearer " + settings.apiKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: state.abortController.signal,
  });
  if (!response.ok) {
    var detail = await response.text().catch(function () { return ""; });
    throw new Error("HTTP " + response.status + (detail ? "：" + detail.slice(0, 220) : ""));
  }
  if (!response.body) {
    var json = await response.json();
    var direct = json && json.choices && json.choices[0] && json.choices[0].message && json.choices[0].message.content || "";
    onDelta(direct);
    return {
      content: direct,
      finishReason: json && json.choices && json.choices[0] && json.choices[0].finish_reason || "",
    };
  }
  var reader = response.body.getReader();
  var decoder = new TextDecoder("utf-8");
  var buffer = "";
  var full = "";
  var finishReason = "";
  while (true) {
    var result = await reader.read();
    if (result.done) break;
    buffer += decoder.decode(result.value, { stream: true });
    var lines = buffer.split("\n");
    buffer = lines.pop() || "";
    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line.startsWith("data:")) return;
      var payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") return;
      try {
        var data = JSON.parse(payload);
        var chunkFinishReason = data && data.choices && data.choices[0] && data.choices[0].finish_reason;
        if (chunkFinishReason) finishReason = chunkFinishReason;
        var delta = data && data.choices && data.choices[0] && data.choices[0].delta && data.choices[0].delta.content || "";
        if (delta) {
          full += delta;
          onDelta(delta);
        }
      } catch (_) {}
    });
  }
  return { content: full, finishReason: finishReason };
}
