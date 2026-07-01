/* ============================================================
   浮光剧场 · Core Utilities
   ============================================================ */

export function uid(prefix) {
  return prefix + "-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8);
}

export function nowIso() {
  return new Date().toISOString();
}

export function safeParse(raw, fallback) {
  try { return JSON.parse(raw); } catch (_) { return fallback; }
}

export function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function toast(el, message) {
  el.textContent = message;
  var activeDialog = document.querySelector("dialog[open]");
  if (activeDialog) {
    activeDialog.appendChild(el);
  } else {
    document.body.appendChild(el);
  }
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () {
    el.classList.remove("show");
    setTimeout(function () {
      if (!el.classList.contains("show") && el.parentNode !== document.body) {
        document.body.appendChild(el);
      }
    }, 350);
  }, 2200);
}

export function setBusy(el, busy, text) {
  if (el.composerInput) el.composerInput.disabled = busy;
  el.sendBtn.classList.toggle("hidden", busy);
  el.stopBtn.classList.toggle("hidden", !busy);
  el.statusText.textContent = text || (busy ? "正在续写…" : "准备就绪");
  el.topLoader.classList.toggle("active", busy);
  el.topLoader.setAttribute("aria-hidden", busy ? "false" : "true");
}

/**
 * 尝试修复并解析可能被截断或包含 Markdown 标记的 JSON 字符串
 */
export function tryRepairJson(jsonStr) {
  if (!jsonStr) return null;
  var cleaned = jsonStr.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  var jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  var fixed = jsonMatch[0];
  try {
    return JSON.parse(fixed);
  } catch (parseErr) {
    // 尝试修复截断的 JSON：移除尾部逗号/未闭合的双引号，并补全括号
    fixed = fixed.replace(/,\s*$/, "").replace(/"[^"]*$/, "");
    var openBrackets = (fixed.match(/\[/g) || []).length - (fixed.match(/\]/g) || []).length;
    var openBraces = (fixed.match(/\{/g) || []).length - (fixed.match(/\}/g) || []).length;
    for (var i = 0; i < openBrackets; i++) fixed += "]";
    for (var i = 0; i < openBraces; i++) fixed += "}";
    try {
      return JSON.parse(fixed);
    } catch (e) {
      return null;
    }
  }
}
