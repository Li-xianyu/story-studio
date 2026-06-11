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
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { el.classList.remove("show"); }, 2200);
}

export function setBusy(el, busy, text) {
  el.sendBtn.classList.toggle("hidden", busy);
  el.stopBtn.classList.toggle("hidden", !busy);
  el.statusText.textContent = text || (busy ? "正在续写…" : "准备就绪");
  el.topLoader.classList.toggle("active", busy);
  el.topLoader.setAttribute("aria-hidden", busy ? "false" : "true");
}
