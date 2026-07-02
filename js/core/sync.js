/* ============================================================
   浮光剧场 · WebDAV/Cloudflare Workers Cloud Sync Module
   ============================================================ */

import { settings, state, saveSettings, saveState, ensureActiveSelection } from "./state.js";
import { getAllStories, saveStory, deleteStory as dbDeleteStory } from "./db.js";
import { toast, setBusy, uid, escapeHtml } from "./utils.js";
import { renderAll } from "../ui/renderer.js";

// Helper for fetch API requests
function syncRequest(path, method, body) {
  var host = String(settings.syncHost || "").trim().replace(/\/+$/, "");
  if (!host) {
    throw new Error("请先在设置中填写同步服务器地址");
  }
  if (!/^https?:\/\//i.test(host)) {
    throw new Error("同步服务器地址格式不正确，必须以 http:// 或 https:// 开头");
  }
  var url = host + path;
  var headers = {
    "Content-Type": "application/json"
  };
  if (settings.syncToken) {
    headers["X-Sync-Token"] = settings.syncToken;
  }
  var config = {
    method: method || "GET",
    headers: headers
  };
  if (body) {
    config.body = JSON.stringify(body);
  }
  return fetch(url, config).then(function (res) {
    if (!res.ok) {
      return res.json().then(function (err) {
        throw new Error(err.error || ("HTTP 请求失败: " + res.status));
      }).catch(function () {
        throw new Error("HTTP 请求失败: " + res.status);
      });
    }
    return res.json();
  });
}

// Ping sync server to verify connection
export function pingSyncServer() {
  return syncRequest("/ping", "GET");
}

function showConflictDialog(storyName, localTime, remoteTime) {
  return new Promise(function (resolve) {
    var dialog = document.createElement("dialog");
    dialog.className = "modal confirm-modal";
    dialog.style.padding = "24px";
    dialog.style.border = "1px solid var(--glass-border)";
    dialog.style.boxShadow = "var(--shadow-float)";
    
    dialog.innerHTML = 
      '<div class="modal-head"><strong style="font-size: 18px;">检测到同步冲突</strong></div>' +
      '<div style="padding: 16px 0; font-size: 14px; line-height: 1.6; display: grid; gap: 12px; color: var(--text-secondary);">' +
        '<p>故事 <strong style="color: var(--text-primary);">「' + escapeHtml(storyName) + '」</strong> 在本地和云端都被修改过，且两端进度不一致。</p>' +
        '<div style="background: rgba(255, 255, 255, 0.04); padding: 12px; border-radius: 8px; font-size: 12px; display: grid; gap: 6px; border: 1px solid rgba(255, 255, 255, 0.05);">' +
          '<div style="display: flex; justify-content: space-between;"><span>💻 本地修改时间：</span><span style="color: var(--text-primary);">' + new Date(localTime).toLocaleString() + '</span></div>' +
          '<div style="display: flex; justify-content: space-between;"><span>☁️ 云端修改时间：</span><span style="color: var(--text-primary);">' + new Date(remoteTime).toLocaleString() + '</span></div>' +
        '</div>' +
        '<p>请选择如何处理该冲突：</p>' +
      '</div>' +
      '<div class="modal-actions" style="display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: 100%;">' +
        '<button type="button" class="primary-btn" id="conflictUseCloudBtn" style="width: 100%; justify-content: center; padding: 10px;">☁️ 使用云端版本 (本地修改存为备份故事)</button>' +
        '<button type="button" class="quiet-btn" id="conflictUseLocalBtn" style="width: 100%; justify-content: center; padding: 10px; border: 1px solid rgba(255, 255, 255, 0.1);">💻 使用本地版本 (覆盖云端进度)</button>' +
        '<button type="button" class="quiet-btn" id="conflictCancelBtn" style="width: 100%; justify-content: center; padding: 10px;">暂不同步</button>' +
      '</div>';
    
    document.body.appendChild(dialog);
    dialog.showModal();
    
    dialog.querySelector("#conflictUseCloudBtn").addEventListener("click", function () {
      dialog.close();
      dialog.remove();
      resolve("cloud");
    });
    
    dialog.querySelector("#conflictUseLocalBtn").addEventListener("click", function () {
      dialog.close();
      dialog.remove();
      resolve("local");
    });
    
    dialog.querySelector("#conflictCancelBtn").addEventListener("click", function () {
      dialog.close();
      dialog.remove();
      resolve("cancel");
    });
  });
}

// Generate a new sync token from the server
export function generateSyncToken() {
  return syncRequest("/token", "POST").then(function (data) {
    if (data && data.token) {
      settings.syncToken = data.token;
      saveSettings();
      return data.token;
    }
    throw new Error("返回的数据格式不正确");
  });
}

export function updateSyncIndicator(status, message) {
  var ind = document.getElementById("syncIndicator");
  if (!ind) return;
  if (!settings.syncHost || !settings.syncToken) {
    ind.setAttribute("data-status", "none");
    ind.setAttribute("title", "未配置云同步");
    return;
  }
  ind.setAttribute("data-status", status);
  if (message) {
    ind.setAttribute("title", message);
  }
}

var isSyncing = false;

// Perform a bi-directional synchronization
export async function runSync() {
  if (isSyncing) return null;
  if (!settings.syncHost || !settings.syncToken) {
    updateSyncIndicator("none");
    return null; // Sync is not configured, fail silently
  }
  
  updateSyncIndicator("syncing", "正在同步数据...");
  isSyncing = true;
  try {
    // 0. Handle pending deletions
    var deletedIds = [];
    try {
      deletedIds = JSON.parse(localStorage.getItem("floating-story-studio-deleted-ids")) || [];
    } catch (_) {}
    
    if (deletedIds.length > 0) {
      var remaining = [];
      for (var j = 0; j < deletedIds.length; j++) {
        var id = deletedIds[j];
        try {
          await syncRequest("/stories/" + id, "DELETE");
        } catch (err) {
          console.warn("[Sync] Failed to delete remote story: " + id, err);
          remaining.push(id);
        }
      }
      localStorage.setItem("floating-story-studio-deleted-ids", JSON.stringify(remaining));
    }

    var localStories = await getAllStories();
    var activeStories = localStories.filter(function (s) { return !s.trash; });
    
    // 1. Calculate diff
    var localIndex = activeStories.map(function (s) {
      return { id: s.id, title: s.title, updatedAt: s.updatedAt };
    });
    
    var diff = await syncRequest("/sync/diff", "POST", { localIndex: localIndex });
    var needPull = diff.needPull || [];
    var needPush = diff.needPush || [];
    
    var changed = false;
    var nowLocal = new Date().toISOString();
    
    // 2. Pull updates from Cloud
    if (needPull.length > 0) {
      for (var i = 0; i < needPull.length; i++) {
        var meta = needPull[i];
        var remoteStory = await syncRequest("/stories/" + meta.id, "GET");
        
        // Conflict Check (check full localStories to protect trashed stories from overwrite)
        var local = localStories.find(function (s) { return s.id === remoteStory.id; });
        if (local) {
          if (local.trash) {
            // Local copy is in the trash
            var isCloudNewerThanDeletion = remoteStory.updatedAt > (local.deletedAt || local.updatedAt || "");
            if (isCloudNewerThanDeletion) {
              // Remote has updates that occurred AFTER it was trashed locally -> Resurrect!
              remoteStory.syncedAt = nowLocal;
              await saveStory(remoteStory);
              changed = true;
              console.log("[Sync] Resurrected story from trash because remote has newer updates: " + remoteStory.title);
              state.stories.push(remoteStory);
            } else {
              // Keep in trash! Save latest remote contents but retain trash status
              remoteStory.trash = true;
              remoteStory.deletedAt = local.deletedAt;
              remoteStory.syncedAt = nowLocal;
              await saveStory(remoteStory);
            }
          } else {
            var hasLocalMod = local.updatedAt > (local.syncedAt || "");
            var isCloudNewer = remoteStory.updatedAt > (local.syncedAt || "");
            if (hasLocalMod && isCloudNewer && local.updatedAt !== remoteStory.updatedAt) {
              // Conflict detected! Ask user
              var choice = await showConflictDialog(local.title, local.updatedAt, remoteStory.updatedAt);
              if (choice === "cloud") {
                // Backup local copy as a separate story (remains active but renamed)
                var backup = JSON.parse(JSON.stringify(local));
                backup.id = uid("story");
                backup.title = (backup.title || "未命名故事") + " (冲突备份 " + new Date().toLocaleDateString() + ")";
                delete backup.syncedAt;
                await saveStory(backup);
                
                // Apply remote
                remoteStory.syncedAt = nowLocal;
                await saveStory(remoteStory);
                changed = true;
              } else if (choice === "local") {
                // Force push local to cloud (without settings)
                await syncRequest("/sync/push", "POST", {
                  stories: [local]
                });
                local.syncedAt = nowLocal;
                await saveStory(local);
              } else {
                // cancel - skip
                continue;
              }
            } else {
              // Normal pull (set syncedAt to local clock to prevent timezone mismatch)
              remoteStory.syncedAt = nowLocal;
              await saveStory(remoteStory);
              changed = true;
            }
          }
        } else {
          // New story from cloud
          remoteStory.syncedAt = nowLocal;
          await saveStory(remoteStory);
          changed = true;
        }
      }
    }
    
    // 3. Push updates to Cloud (or propagate deletions from cloud)
    if (needPush.length > 0) {
      var pushStories = localStories.filter(function (s) {
        return needPush.some(function (p) { return p.id === s.id; });
      });
      
      var verifiedPush = [];
      var deletedLocalCount = 0;
      var softDeletedTitles = [];
      
      // Safety lock: if the cloud index is empty, but we have previously synced local stories,
      // we assume a cloud reset and treat them all as new local stories to push instead of deleting them.
      // ALSO: if cloud appears to have fewer stories than we've ever synced locally (partial cloud data loss),
      // trigger the same lock to avoid silently trashing stories that are simply missing from cloud due to bugs.
      var isCloudIndexEmpty = (needPull.length === 0 && needPush.length === activeStories.length);
      var hasPreviouslySyncedLocal = activeStories.some(function (s) { return s.syncedAt; });
      var syncedLocalCount = activeStories.filter(function (s) { return !!s.syncedAt; }).length;
      // cloudStoryCount = stories in cloud = local stories that did NOT need push + cloud-only stories to pull
      var cloudStoryCount = (activeStories.length - needPush.length) + needPull.length;
      var cloudAppearsIncomplete = hasPreviouslySyncedLocal && cloudStoryCount < syncedLocalCount;
      var safetyLockTriggered = (isCloudIndexEmpty || cloudAppearsIncomplete) && hasPreviouslySyncedLocal;

      if (safetyLockTriggered && cloudAppearsIncomplete && !isCloudIndexEmpty) {
        console.warn("[Sync] Safety lock triggered: cloud appears incomplete (cloud=" + cloudStoryCount + " < synced=" + syncedLocalCount + "). Treating missing stories as new pushes.");
      }
      
      for (var k = 0; k < pushStories.length; k++) {
        var s = pushStories[k];
        if (s.syncedAt && !safetyLockTriggered) {
          // Previously synced, but now missing in cloud.
          // Conservative strategy: NEVER auto-trash. Always re-push to cloud.
          // This prevents false-positive deletions caused by cloud API glitches,
          // network timing issues, or race conditions with the deleted-ids queue.
          delete s.syncedAt;
          await saveStory(s);
          verifiedPush.push(s);
          console.warn("[Sync] Story was synced but missing from cloud, re-pushing instead of trashing: " + s.title);
        } else {
          // Brand new story or safety lock active -> push to cloud
          verifiedPush.push(s);
        }
      }
      
      if (verifiedPush.length > 0) {
        var res = await syncRequest("/sync/push", "POST", {
          stories: verifiedPush
        });
        
        var now = (res && res.pushedAt) || new Date().toISOString();
        for (var k = 0; k < verifiedPush.length; k++) {
          var s = verifiedPush[k];
          s.syncedAt = now;
          await saveStory(s);
        }
      }
    }
    
    // 4. Sync Settings (with conflict resolution based on updatedAt)
    var cloudSettings = await syncRequest("/settings", "GET");
    var cloudUpdatedAt = (cloudSettings && cloudSettings.updatedAt) || "";
    var localUpdatedAt = settings.updatedAt || "";
    
    if (cloudSettings && typeof cloudSettings === "object" && Object.keys(cloudSettings).length > 0) {
      if (cloudUpdatedAt > localUpdatedAt) {
        // Cloud settings are newer -> pull them
        var localModified = false;
        Object.keys(cloudSettings).forEach(function (key) {
          if (key !== "apiKey" && key !== "ttsKey" && key !== "updatedAt" && settings[key] !== cloudSettings[key]) {
            settings[key] = cloudSettings[key];
            localModified = true;
          }
        });
        if (localModified) {
          settings.updatedAt = cloudUpdatedAt;
          localStorage.setItem("floating-story-studio-settings-v1", JSON.stringify(settings));
          changed = true;
        }
      } else if (localUpdatedAt > cloudUpdatedAt) {
        // Local settings are newer -> push them
        await syncRequest("/settings", "PUT", settings);
      }
    }
    
    if (changed) {
      renderAll();
      try {
        var channel = new BroadcastChannel("story-studio-sync");
        channel.postMessage({ type: "sync-complete" });
      } catch (_) {}
    }
    
    updateSyncIndicator("synced", "同步完成。上次同步: " + new Date().toLocaleTimeString());
    return { pulledCount: needPull.length, pushedCount: needPush.length };
  } catch (error) {
    updateSyncIndicator("failed", "同步失败: " + (error.message || error));
    console.error("同步失败:", error);
    throw error;
  } finally {
    isSyncing = false;
  }
}

// Debounced background sync trigger
var _syncDebounceTimer = null;
export function triggerAutoSync() {
  if (!settings.syncHost || !settings.syncToken) return;
  clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(function () {
    runSync().catch(function (err) {
      console.warn("[Sync] Background auto-sync failed:", err);
    });
  }, 5000); // Wait 5 seconds after last save before pushing
}
