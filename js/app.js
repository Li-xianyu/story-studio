/* ============================================================
   浮光剧场 · App Entry
   ============================================================ */

import { cacheElements, loadState } from "./core/state.js";
import { populateVoices } from "./core/tts.js";
import { renderAll } from "./ui/renderer.js";
import { bindEvents } from "./ui/events.js";
import { initCustomSelects, syncAll } from "./ui/custom-select.js";

var PANEL_STATE_KEY = "floating-story-studio-panels-v1";

function syncAppChromeTheme() {
  var light = document.documentElement.dataset.theme === "light";
  var themeColor = light ? "#f7f7f9" : "#000000";
  var metaTheme = document.querySelector('meta[name="theme-color"]');
  var metaScheme = document.querySelector('meta[name="color-scheme"]');
  if (metaTheme) metaTheme.content = themeColor;
  if (metaScheme) metaScheme.content = light ? "light" : "dark";
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  document.documentElement.style.backgroundColor = themeColor;
}

function observeAppTheme() {
  syncAppChromeTheme();
  new MutationObserver(syncAppChromeTheme).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
}

function restoreDesktopPanelState() {
  if (!window.matchMedia("(min-width: 761px)").matches) return;
  document.documentElement.classList.add("restoring-panels");
  var saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(PANEL_STATE_KEY));
  } catch (_) {}
  var libraryOpen = !saved || saved.libraryOpen !== false;
  var controlsOpen = Boolean(saved && saved.controlsOpen);
  document.body.classList.toggle("library-collapsed", !libraryOpen);
  document.getElementById("libraryToggle").setAttribute("aria-expanded", libraryOpen ? "true" : "false");
  document.getElementById("controlsPanel").classList.toggle("open", controlsOpen);
  document.getElementById("controlsPanel").setAttribute("aria-hidden", controlsOpen ? "false" : "true");
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      document.documentElement.classList.remove("restoring-panels");
    });
  });
}

function resetMemoryCardState() {
  document.querySelectorAll(".memory-card").forEach(function (card) {
    card.open = false;
  });
}

function syncComposerHeight() {
  var composer = document.querySelector(".composer");
  if (!composer) return;
  document.documentElement.style.setProperty("--composer-height", composer.getBoundingClientRect().height + "px");
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  window.addEventListener("load", function () {
    navigator.serviceWorker.register("./sw.js").then(function (reg) {
      if (reg.active && !navigator.serviceWorker.controller) return;
      reg.addEventListener("updatefound", function () {
        var newSW = reg.installing;
        newSW.addEventListener("statechange", function () {
          if (newSW.state === "installed" && navigator.serviceWorker.controller) {
            var toast = document.getElementById("toast");
            if (toast) {
              toast.textContent = "新版本已就绪，正在刷新…";
              toast.classList.add("show");
            }
            setTimeout(function () { window.location.reload(); }, 1500);
          }
        });
      });
    }).catch(function (error) {
      console.warn("[PWA] Service Worker 注册失败", error);
    });
  });
}

function bindPwaInstall() {
  var installButton = document.getElementById("installAppBtn");
  if (!installButton) return;
  var deferredPrompt = null;
  var standalone = window.matchMedia("(display-mode: standalone)").matches ||
    window.navigator.standalone === true;

  function setAvailable(available) {
    installButton.hidden = standalone || !available;
  }

  window.addEventListener("beforeinstallprompt", function (event) {
    event.preventDefault();
    deferredPrompt = event;
    setAvailable(true);
  });

  installButton.addEventListener("click", async function () {
    if (!deferredPrompt) return;
    installButton.disabled = true;
    try {
      await deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } finally {
      deferredPrompt = null;
      installButton.disabled = false;
      setAvailable(false);
    }
  });

  window.addEventListener("appinstalled", function () {
    standalone = true;
    deferredPrompt = null;
    setAvailable(false);
  });
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
  resetMemoryCardState();
  restoreDesktopPanelState();
  initCustomSelects();
  bindEvents();
  renderAll();
  observeAppTheme();
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

bindPwaInstall();
registerServiceWorker();
document.addEventListener("DOMContentLoaded", init);
