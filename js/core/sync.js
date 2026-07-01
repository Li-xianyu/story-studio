/* ============================================================
   浮光剧场 · WebDAV/Cloudflare Workers Cloud Sync Module
   ============================================================ */

import { settings, saveSettings, saveState } from "./state.js";
import { getAllStories, saveStory } from "./db.js";
import { toast, setBusy, uid, escapeHtml } from "./utils.js";
import { renderAll } from "../ui/renderer.js";

// Helper for fetch API requests
function syncRequest(path, method, body) {
  var host = String(settings.syncHost || "").trim().replace(/\/+$/, "");
  if (!host) {
    throw new Error("请先在设置中填写同步服务器地址");
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

// Perform a bi-directional synchronization
export async function runSync() {
  if (!settings.syncHost || !settings.syncToken) {
    return null; // Sync is not configured, fail silently
  }
  
  try {
    var localStories = await getAllStories();
    
    // 1. Calculate diff
    var localIndex = localStories.map(function (s) {
      return { id: s.id, title: s.title, updatedAt: s.updatedAt };
    });
    
    var diff = await syncRequest("/sync/diff", "POST", { localIndex: localIndex });
    var needPull = diff.needPull || [];
    var needPush = diff.needPush || [];
    
    var changed = false;
    
    // 2. Pull updates from Cloud
    if (needPull.length > 0) {
      for (var i = 0; i < needPull.length; i++) {
        var meta = needPull[i];
        var remoteStory = await syncRequest("/stories/" + meta.id, "GET");
        
        // Conflict Check:
        var local = localStories.find(function (s) { return s.id === remoteStory.id; });
        if (local) {
          var hasLocalMod = local.updatedAt > (local.syncedAt || "");
          var isCloudNewer = remoteStory.updatedAt > (local.syncedAt || "");
          if (hasLocalMod && isCloudNewer && local.updatedAt !== remoteStory.updatedAt) {
            // Conflict detected! Ask user
            var choice = await showConflictDialog(local.title, local.updatedAt, remoteStory.updatedAt);
            if (choice === "cloud") {
              // Backup local copy as a separate story
              var backup = JSON.parse(JSON.stringify(local));
              backup.id = uid("story");
              backup.title = (backup.title || "未命名故事") + " (冲突备份 " + new Date().toLocaleDateString() + ")";
              delete backup.syncedAt;
              await saveStory(backup);
              
              // Apply remote
              await saveStory(remoteStory);
              changed = true;
            } else if (choice === "local") {
              // Force push local to cloud
              var res = await syncRequest("/sync/push", "POST", {
                stories: [local],
                settings: settings
              });
              var now = (res && res.pushedAt) || new Date().toISOString();
              local.syncedAt = now;
              await saveStory(local);
            } else {
              // cancel - skip
              continue;
            }
          } else {
            // Normal pull
            await saveStory(remoteStory);
            changed = true;
          }
        } else {
          // New story from cloud
          await saveStory(remoteStory);
          changed = true;
        }
      }
    }
    
    // 3. Push updates to Cloud
    if (needPush.length > 0) {
      var pushStories = localStories.filter(function (s) {
        return needPush.some(function (p) { return p.id === s.id; });
      });
      if (pushStories.length > 0) {
        var res = await syncRequest("/sync/push", "POST", {
          stories: pushStories,
          settings: settings
        });
        
        var now = (res && res.pushedAt) || new Date().toISOString();
        for (var k = 0; k < pushStories.length; k++) {
          var s = pushStories[k];
          s.syncedAt = now;
          await saveStory(s);
        }
      }
    }
    
    // 4. Sync Settings
    var cloudSettings = await syncRequest("/settings", "GET");
    if (cloudSettings && typeof cloudSettings === "object" && Object.keys(cloudSettings).length > 0) {
      var localModified = false;
      Object.keys(cloudSettings).forEach(function (key) {
        if (key !== "apiKey" && key !== "ttsKey" && settings[key] !== cloudSettings[key]) {
          settings[key] = cloudSettings[key];
          localModified = true;
        }
      });
      if (localModified) {
        saveSettings();
        changed = true;
      }
    }
    
    if (changed) {
      renderAll();
    }
    
    return { pulledCount: needPull.length, pushedCount: needPush.length };
  } catch (error) {
    console.error("同步失败:", error);
    throw error;
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
