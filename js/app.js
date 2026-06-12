/* ============================================================
   浮光剧场 · App Entry
   ============================================================ */

import { cacheElements, loadState } from "./core/state.js";
import { populateVoices } from "./core/tts.js";
import { renderAll } from "./ui/renderer.js";
import { bindEvents } from "./ui/events.js";
import { initCustomSelects, syncAll } from "./ui/custom-select.js";

function syncComposerHeight() {
  var composer = document.querySelector(".composer");
  if (!composer) return;
  document.documentElement.style.setProperty("--composer-height", composer.getBoundingClientRect().height + "px");
}

function bindLiquidGlass() {
  var composer = document.querySelector(".composer");
  var viewport = document.getElementById("readerViewport");
  var content = document.getElementById("storyContent");
  if (!composer || !viewport || !content) return;

  function updateLight(event) {
    var rect = composer.getBoundingClientRect();
    var x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    var y = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
    composer.style.setProperty("--glass-x", x + "px");
    composer.style.setProperty("--glass-y", y + "px");
  }

  function updateOverlap() {
    var composerRect = composer.getBoundingClientRect();
    var contentRect = content.getBoundingClientRect();
    composer.classList.toggle(
      "over-content",
      contentRect.bottom > composerRect.top + 18 && contentRect.top < composerRect.bottom
    );
  }

  composer.addEventListener("pointermove", updateLight);
  composer.addEventListener("pointerdown", function (event) {
    updateLight(event);
    composer.classList.add("is-pressed");
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(function (name) {
    composer.addEventListener(name, function () { composer.classList.remove("is-pressed"); });
  });
  viewport.addEventListener("scroll", updateOverlap, { passive: true });
  window.addEventListener("resize", updateOverlap);
  if (window.MutationObserver) {
    var contentObserver = new MutationObserver(function () {
      requestAnimationFrame(updateOverlap);
    });
    contentObserver.observe(content, { childList: true, subtree: true, characterData: true });
  }
  requestAnimationFrame(updateOverlap);
}

function init() {
  cacheElements();
  loadState();
  initCustomSelects();
  bindEvents();
  renderAll();
  populateVoices();
  syncAll();
  syncComposerHeight();
  bindLiquidGlass();
  window.addEventListener("resize", syncComposerHeight);
  if (window.ResizeObserver) {
    var composerObserver = new ResizeObserver(syncComposerHeight);
    composerObserver.observe(document.querySelector(".composer"));
  }
  if (window.lucide && typeof window.lucide.createIcons === "function") {
    window.lucide.createIcons();
  }
}

document.addEventListener("DOMContentLoaded", init);
