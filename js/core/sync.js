/* ============================================================
   浮光剧场 · WebDAV/Cloudflare Workers Cloud Sync Module
   ============================================================ */

import { settings, saveSettings, saveState } from "./state.js";
import { getAllStories, saveStory } from "./db.js";
import { toast, setBusy, uid } from "./utils.js";
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
            // Conflict detected! Backup local copy as a separate story
            var backup = JSON.parse(JSON.stringify(local));
            backup.id = uid("story");
            backup.title = (backup.title || "未命名故事") + " (冲突备份 " + new Date().toLocaleDateString() + ")";
            delete backup.syncedAt;
            await saveStory(backup);
          }
        }
        
        await saveStory(remoteStory);
        changed = true;
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
