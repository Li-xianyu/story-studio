var CustomSelect = (function () {

  var activeDropdown = null;

  function closeActive() {
    if (activeDropdown) {
      activeDropdown.classList.remove("cs-open");
      activeDropdown = null;
    }
  }

  function CustomSelect(el) {
    this.el = el;
    this.nativeSelect = el.querySelector("select");
    if (!this.nativeSelect) return;

    el._csInstance = this;
    instances.push(this);
    this.nativeSelect.style.display = "none";

    this.buildTrigger();
    this.buildDropdown();
    this.syncDisplay();

    var self = this;
    this.nativeSelect.addEventListener("change", function () {
      self.syncDisplay();
    });
    this.nativeSelect.addEventListener("blur", function () {
      self.syncDisplay();
    });

    this.optionObserver = new MutationObserver(function () {
      self.rebuildOptions();
    });
    this.optionObserver.observe(this.nativeSelect, { childList: true, subtree: true });

    this.trigger.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        self.close();
        self.trigger.focus();
      }
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        self.toggle();
      }
    });

    this.dropdown.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        self.close();
        self.trigger.focus();
      }
    });
  }

  CustomSelect.prototype.buildTrigger = function () {
    var self = this;
    this.trigger = document.createElement("button");
    this.trigger.className = "cs-trigger";
    this.trigger.type = "button";
    this.trigger.setAttribute("aria-haspopup", "listbox");
    this.trigger.setAttribute("aria-expanded", "false");
    this.trigger.innerHTML = '<span class="cs-value"></span><svg class="cs-chevron" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 8l4 4 4-4"/></svg>';
    this.trigger.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggle();
    });
    this.el.insertBefore(this.trigger, this.nativeSelect);
  };

  CustomSelect.prototype.buildDropdown = function () {
    this.dropdown = document.createElement("div");
    this.dropdown.className = "cs-dropdown";
    this.dropdown.setAttribute("role", "listbox");
    this.rebuildOptions();
    var container = this.el.closest("dialog") || document.body;
    container.appendChild(this.dropdown);
    if (this.el.classList.contains("cs-compact")) {
      this.dropdown.classList.add("cs-dropdown-compact");
    }
    this.dropdown._csInstance = this;

    var self = this;
    this.dropdown.addEventListener("click", function (e) {
      var item = e.target.closest(".cs-option");
      if (item && !item.classList.contains("cs-disabled")) {
        self.select(item.dataset.value);
      }
    });
  };

  CustomSelect.prototype.rebuildOptions = function () {
    if (!this.dropdown) return;
    var self = this;
    this.dropdown.innerHTML = "";
    Array.from(this.nativeSelect.options).forEach(function (opt) {
      var item = document.createElement("div");
      item.className = "cs-option";
      item.setAttribute("role", "option");
      if (opt.disabled) item.classList.add("cs-disabled");
      item.dataset.value = opt.value;
      item.textContent = opt.text;
      self.dropdown.appendChild(item);
    });
    this.syncDisplay();
    requestAnimationFrame(function () { self.syncDisplay(); });
  };

  CustomSelect.prototype.toggle = function () {
    if (this.dropdown.classList.contains("cs-open")) {
      this.close();
    } else {
      this.open();
    }
  };

  CustomSelect.prototype.open = function () {
    closeActive();
    this.dropdown.classList.add("cs-open");
    this.trigger.setAttribute("aria-expanded", "true");
    activeDropdown = this.dropdown;
    this.positionDropdown();
  };

  CustomSelect.prototype.close = function () {
    this.dropdown.classList.remove("cs-open");
    this.trigger.setAttribute("aria-expanded", "false");
    if (activeDropdown === this.dropdown) activeDropdown = null;
  };

  CustomSelect.prototype.positionDropdown = function () {
    var triggerRect = this.trigger.getBoundingClientRect();
    var dropdown = this.dropdown;
    var viewportHeight = window.innerHeight;
    var spaceBelow = viewportHeight - triggerRect.bottom - 8;
    var spaceAbove = triggerRect.top - 8;

    dropdown.style.position = "fixed";
    dropdown.style.left = triggerRect.left + "px";
    dropdown.style.width = Math.max(triggerRect.width, 140) + "px";

    if (spaceBelow >= 180 || spaceBelow >= spaceAbove) {
      dropdown.style.top = triggerRect.bottom + 6 + "px";
      dropdown.style.bottom = "auto";
      dropdown.style.maxHeight = Math.min(spaceBelow, 280) + "px";
      dropdown.style.transformOrigin = "center top";
    } else {
      dropdown.style.top = "auto";
      dropdown.style.bottom = viewportHeight - triggerRect.top + 6 + "px";
      dropdown.style.maxHeight = Math.min(spaceAbove, 280) + "px";
      dropdown.style.transformOrigin = "center bottom";
    }
  };

  CustomSelect.prototype.select = function (value) {
    var prev = this.nativeSelect.value;
    this.nativeSelect.value = value;
    if (this.nativeSelect.value !== prev) {
      this.nativeSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
    this.syncDisplay();
    this.close();
  };

  CustomSelect.prototype.syncDisplay = function () {
    var idx = this.nativeSelect.selectedIndex;
    if (idx === -1) return;
    var text = this.nativeSelect.options[idx].text;
    var value = this.nativeSelect.value;
    var valEl = this.trigger.querySelector(".cs-value");
    if (valEl) valEl.textContent = text;
    if (this.dropdown) {
      Array.from(this.dropdown.children).forEach(function (item) {
        var sel = item.dataset.value === value;
        item.classList.toggle("cs-selected", sel);
        item.setAttribute("aria-selected", sel);
      });
    }
  };

  CustomSelect._closeActive = closeActive;
  return CustomSelect;
})();

var instances = [];
var initialized = false;

function closeAllDropdowns() {
  CustomSelect._closeActive();
}

function initCustomSelects() {
  if (initialized) return;
  initialized = true;
  document.querySelectorAll("custom-select").forEach(function (el) {
    if (!el._csInstance) {
      el._csInstance = new CustomSelect(el);
    }
  });

  var audioToggle = document.getElementById("audioPanelToggle");
  if (audioToggle) {
    audioToggle.addEventListener("click", closeAllDropdowns);
  }

  var playerBar = document.getElementById("playerBar");
  if (playerBar && window.MutationObserver) {
    var obs = new MutationObserver(function () {
      if (!playerBar.classList.contains("open")) closeAllDropdowns();
    });
    obs.observe(playerBar, { attributes: true, attributeFilter: ["class"] });
  }
}

document.addEventListener("click", function () {
  CustomSelect._closeActive();
});

window.addEventListener("resize", function () {
  CustomSelect._closeActive();
});

document.addEventListener("DOMContentLoaded", initCustomSelects);
if (document.readyState !== "loading") initCustomSelects();

function syncAll() {
  instances.forEach(function (inst) { inst.syncDisplay(); });
}

export { CustomSelect, initCustomSelects, instances, syncAll };
