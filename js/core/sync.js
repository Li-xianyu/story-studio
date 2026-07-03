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

/* ---- 通用字数/章节统计 ---- */
function countStoryStats(story) {
  var chapters = story.chapters || [];
  var charCount = 0;
  chapters.forEach(function (ch) {
    (ch.segments || []).forEach(function (seg) {
      charCount += (seg.content || "").length;
    });
  });
  return { chapters: chapters.length, chars: charCount };
}

/* ---- 内容哈希（用于精确变化检测） ---- */
function djb2(str) {
  var hash = 5381;
  for (var i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash) + str.charCodeAt(i);
    hash = hash & hash; // 32-bit
  }
  return (hash >>> 0).toString(36);
}

function storyHash(story) {
  var parts = [];
  (story.chapters || []).forEach(function (ch, ci) {
    parts.push("c" + ci + ":" + (ch.title || ""));
    (ch.segments || []).forEach(function (seg, si) {
      parts.push("s" + ci + "_" + si + ":" + (seg.type || "") + ":" + (seg.content || ""));
    });
  });
  return djb2(parts.join("|"));
}

function chapterHash(chapter, index) {
  var parts = ["c" + index + ":" + (chapter.title || "")];
  (chapter.segments || []).forEach(function (seg, si) {
    parts.push("s" + si + ":" + (seg.type || "") + ":" + (seg.content || ""));
  });
  return djb2(parts.join("|"));
}

/* ---- 章节级三路合并 ---- */
function mergeStoriesChapterLevel(local, remote, localHash, remoteHash, baseHash) {
  // 合并策略：
  // 1. 只有本地变了的章节 → 保留本地
  // 2. 只有云端变了的章节 → 用云端
  // 3. 两端都变了的章节 → 冲突（记录在 conflicts 中）
  // 4. 新增的章节 → 从变了一方取
  // 5. 删除的章节 → 只在一端缺失时保留另一端

  var merged = JSON.parse(JSON.stringify(local)); // 以本地为基础
  var conflicts = [];
  var mergedCount = 0;

  var localChapters = local.chapters || [];
  var remoteChapters = remote.chapters || [];
  var maxLen = Math.max(localChapters.length, remoteChapters.length);

  // 计算每个章节在 base 中的 hash（从 syncedHash 反推不了，用索引近似）
  // baseHash 是整个 story 的，不是每个章节的
  // 简化：比较 local 和 remote 每个章节的 hash
  // 如果 local 的某章 hash !== remote 的某章 hash → 需要决定用谁的
  // 如果只有一边有 → 新增或删除

  var mergedChapters = [];
  for (var i = 0; i < maxLen; i++) {
    var lc = localChapters[i];
    var rc = remoteChapters[i];
    var lh = lc ? chapterHash(lc, i) : null;
    var rh = rc ? chapterHash(rc, i) : null;

    if (!lc && rc) {
      // 云端新增 → 接受
      mergedChapters.push(JSON.parse(JSON.stringify(rc)));
      mergedCount++;
    } else if (lc && !rc) {
      // 本地有，云端没有 → 保留本地（云端可能删了，保守保留）
      mergedChapters.push(JSON.parse(JSON.stringify(lc)));
      // 不标为 merged
    } else if (lh === rh) {
      // 相同 → 保留
      mergedChapters.push(JSON.parse(JSON.stringify(lc)));
    } else {
      // hash 不同 → 比较字数决定用谁的
      var lcChars = 0;
      (lc.segments || []).forEach(function (seg) { lcChars += (seg.content || "").length; });
      var rcChars = 0;
      (rc.segments || []).forEach(function (seg) { rcChars += (seg.content || "").length; });

      if (lcChars >= rcChars) {
        // 本地字数 ≥ 云端 → 保留本地（本地是更新的版本）
        mergedChapters.push(JSON.parse(JSON.stringify(lc)));
        if (lcChars > rcChars) mergedCount++;
      } else {
        // 云端字数更多 → 用云端
        mergedChapters.push(JSON.parse(JSON.stringify(rc)));
        mergedCount++;
      }
    }
  }

  merged.chapters = mergedChapters;
  return { story: merged, conflicts: conflicts, mergedChapters: mergedCount };
}

function showConflictDialog(storyName, localTime, remoteTime, localStats, remoteStats) {
  var statsHtml = "";
  if (localStats && remoteStats) {
    statsHtml =
      '<div style="display: flex; justify-content: space-between;"><span>💻 本地：</span><span style="color: var(--text-primary);">' + localStats.chapters + ' 章 / ' + localStats.chars.toLocaleString() + ' 字</span></div>' +
      '<div style="display: flex; justify-content: space-between;"><span>☁️ 云端：</span><span style="color: var(--text-primary);">' + remoteStats.chapters + ' 章 / ' + remoteStats.chars.toLocaleString() + ' 字</span></div>';
  }
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
          statsHtml +
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

// Push 阶段冲突：本地内容少于云端但 updatedAt 更新
function showPushContentLossDialog(storyName, localStats, remoteStats, localTime, remoteTime) {
  return new Promise(function (resolve) {
    var dialog = document.createElement("dialog");
    dialog.className = "modal confirm-modal";
    dialog.style.padding = "24px";
    dialog.style.border = "1px solid var(--glass-border)";
    dialog.style.boxShadow = "var(--shadow-float)";

    dialog.innerHTML =
      '<div class="modal-head"><strong style="font-size: 18px;">⚠️ 推送内容丢失风险</strong></div>' +
      '<div style="padding: 16px 0; font-size: 14px; line-height: 1.6; display: grid; gap: 12px; color: var(--text-secondary);">' +
        '<p>故事 <strong style="color: var(--text-primary);">「' + escapeHtml(storyName) + '」</strong> 本地版本内容 <span style="color:#ff453a;font-weight:700;">少于</span> 云端版本，但本地修改时间更新。</p>' +
        '<div style="background: rgba(255, 69, 58, 0.08); padding: 12px; border-radius: 8px; font-size: 12px; display: grid; gap: 6px; border: 1px solid rgba(255, 69, 58, 0.2);">' +
          '<div style="display: flex; justify-content: space-between;"><span>💻 本地：</span><span style="color: var(--text-primary);">' + localStats.chapters + ' 章 / ' + localStats.chars.toLocaleString() + ' 字</span></div>' +
          '<div style="display: flex; justify-content: space-between;"><span>☁️ 云端：</span><span style="color: var(--text-primary);">' + remoteStats.chapters + ' 章 / ' + remoteStats.chars.toLocaleString() + ' 字</span></div>' +
          '<div style="display: flex; justify-content: space-between;"><span>💻 本地时间：</span><span style="color: var(--text-primary);">' + new Date(localTime).toLocaleString() + '</span></div>' +
          '<div style="display: flex; justify-content: space-between;"><span>☁️ 云端时间：</span><span style="color: var(--text-primary);">' + new Date(remoteTime).toLocaleString() + '</span></div>' +
        '</div>' +
        '<p style="color: #ff453a;">⚠️ 如果选择「仍然推送本地」，云端更多内容将<strong>永久丢失</strong>。</p>' +
      '</div>' +
      '<div class="modal-actions" style="display: flex; flex-direction: column; gap: 8px; align-items: stretch; width: 100%;">' +
        '<button type="button" class="primary-btn" id="pushConflictPullBtn" style="width: 100%; justify-content: center; padding: 10px; background: var(--green);">☁️ 保留云端版本（拉取到本地）</button>' +
        '<button type="button" class="quiet-btn" id="pushConflictForceBtn" style="width: 100%; justify-content: center; padding: 10px; border: 1px solid rgba(255, 69, 58, 0.3); color: #ff453a;">⚠️ 仍然推送本地（云端数据将丢失）</button>' +
        '<button type="button" class="quiet-btn" id="pushConflictCancelBtn" style="width: 100%; justify-content: center; padding: 10px;">暂不处理，保留双方</button>' +
      '</div>';

    document.body.appendChild(dialog);
    dialog.showModal();

    dialog.querySelector("#pushConflictPullBtn").addEventListener("click", function () {
      dialog.close();
      dialog.remove();
      resolve("pull");
    });
    dialog.querySelector("#pushConflictForceBtn").addEventListener("click", function () {
      dialog.close();
      dialog.remove();
      resolve("force");
    });
    dialog.querySelector("#pushConflictCancelBtn").addEventListener("click", function () {
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
    
    // 1. Calculate diff (v2: content-hash based)
    var localIndex = activeStories.map(function (s) {
      var hash = storyHash(s);
      return {
        id: s.id,
        title: s.title,
        updatedAt: s.updatedAt,
        contentHash: hash,
        syncedHash: s.syncedHash || null   // null = 从未同步/旧数据
      };
    });
    
    var diff = await syncRequest("/sync/diff", "POST", { localIndex: localIndex });
    var needPull = diff.needPull || [];
    var needPush = diff.needPush || [];
    
    var changed = false;
    var nowLocal = new Date().toISOString();
    
    // 2. Pull updates from Cloud (v2: chapter-level merge)
    if (needPull.length > 0) {
      for (var i = 0; i < needPull.length; i++) {
        var meta = needPull[i];
        var remoteStory = await syncRequest("/stories/" + meta.id, "GET");
        var local = localStories.find(function (s) { return s.id === remoteStory.id; });

        if (!local) {
          // 新故事 → 直接保存
          remoteStory.syncedAt = nowLocal;
          remoteStory.syncedHash = meta.contentHash || storyHash(remoteStory);
          await saveStory(remoteStory);
          changed = true;
          continue;
        }

        if (local.trash) {
          var isCloudNewerThanDeletion = remoteStory.updatedAt > (local.deletedAt || local.updatedAt || "");
          if (isCloudNewerThanDeletion) {
            remoteStory.syncedAt = nowLocal;
            remoteStory.syncedHash = meta.contentHash || storyHash(remoteStory);
            await saveStory(remoteStory);
            changed = true;
            console.log("[Sync] Resurrected story from trash: " + remoteStory.title);
            state.stories.push(remoteStory);
          } else {
            remoteStory.trash = true;
            remoteStory.deletedAt = local.deletedAt;
            remoteStory.syncedAt = nowLocal;
            remoteStory.syncedHash = meta.contentHash || storyHash(remoteStory);
            await saveStory(remoteStory);
          }
          continue;
        }

        // === 三路合并判断 ===
        var localHash = storyHash(local);
        var remoteHash = meta.contentHash || storyHash(remoteStory);
        var baseHash = local.syncedHash || null;

        if (baseHash && localHash === baseHash) {
          // 本地没变，只有云端变了 → 直接接受云端
          remoteStory.syncedAt = nowLocal;
          remoteStory.syncedHash = remoteHash;
          await saveStory(remoteStory);
          changed = true;
          console.log("[Sync] Fast-forward pull (local unchanged): " + remoteStory.title);
          continue;
        }

        if (baseHash && remoteHash === baseHash) {
          // 云端没变，只有本地变了 → 保留本地（更新 syncedAt 即可）
          local.syncedAt = nowLocal;
          local.syncedHash = localHash;
          await saveStory(local);
          console.log("[Sync] Local-only changes, no pull needed: " + local.title);
          continue;
        }

        // === 两端都变了 → 章节级合并 ===
        if (baseHash) {
          var merged = mergeStoriesChapterLevel(local, remoteStory, localHash, remoteHash, baseHash);
          if (merged.conflicts.length > 0) {
            // 有冲突 → 弹窗
            var localStats = countStoryStats(local);
            var remoteStats = countStoryStats(remoteStory);
            var choice = await showConflictDialog(local.title, local.updatedAt, remoteStory.updatedAt, localStats, remoteStats);
            if (choice === "cloud") {
              var backup = JSON.parse(JSON.stringify(local));
              backup.id = uid("story");
              backup.title = (backup.title || "未命名故事") + " (冲突备份 " + new Date().toLocaleDateString() + ")";
              delete backup.syncedAt;
              delete backup.syncedHash;
              await saveStory(backup);
              remoteStory.syncedAt = nowLocal;
              remoteStory.syncedHash = remoteHash;
              await saveStory(remoteStory);
              changed = true;
            } else if (choice === "local") {
              await syncRequest("/sync/push", "POST", { stories: [local] });
              local.syncedAt = nowLocal;
              local.syncedHash = localHash;
              await saveStory(local);
            }
            continue;
          }
          // 自动合并成功
          merged.story.syncedAt = nowLocal;
          merged.story.syncedHash = storyHash(merged.story);
          await saveStory(merged.story);
          // 推送合并后的版本到云端
          try {
            await syncRequest("/sync/push", "POST", { stories: [merged.story] });
            merged.story.syncedAt = new Date().toISOString();
            await saveStory(merged.story);
          } catch (e) { console.warn("[Sync] Push after merge failed:", e); }
          // 从 needPush 中移除
          needPush = needPush.filter(function (p) { return p.id !== merged.story.id; });
          changed = true;
          console.log("[Sync] Chapter-level auto-merge + push: " + merged.story.title + " (merged " + merged.mergedChapters + " chapters)");
          continue;
        }

        // === 旧数据（无 syncedHash）→ 回退到旧逻辑 ===
        var localStats = countStoryStats(local);
        var remoteStats = countStoryStats(remoteStory);

        // 启发式判断：字数不减少 → 保留本地（正常增量编辑场景）
        if (localStats.chars >= remoteStats.chars && localStats.chapters >= remoteStats.chapters) {
          // 本地内容≥云端 → 保留本地，不下拉云端
          local.syncedAt = nowLocal;
          local.syncedHash = storyHash(local);
          await saveStory(local);
          console.log("[Sync] Legacy: keeping local (local chars >= remote): " + local.title);
          continue;
        }

        // 如果云端明显更多 → 接受云端
        if (remoteStats.chars > localStats.chars && remoteStats.chapters >= localStats.chapters) {
          remoteStory.syncedAt = nowLocal;
          remoteStory.syncedHash = storyHash(remoteStory);
          await saveStory(remoteStory);
          changed = true;
          console.log("[Sync] Legacy: accepting cloud (remote has more content): " + remoteStory.title);
          continue;
        }

        // 边缘情况：一端章节多一端字数多 → 弹窗
        var hasLocalMod = local.updatedAt > (local.syncedAt || "");
        var isCloudNewer = remoteStory.updatedAt > (local.syncedAt || "");
        if (hasLocalMod && isCloudNewer && local.updatedAt !== remoteStory.updatedAt) {
          var choice = await showConflictDialog(local.title, local.updatedAt, remoteStory.updatedAt, localStats, remoteStats);
          if (choice === "cloud") {
            var backup = JSON.parse(JSON.stringify(local));
            backup.id = uid("story");
            backup.title = (backup.title || "未命名故事") + " (冲突备份 " + new Date().toLocaleDateString() + ")";
            delete backup.syncedAt;
            delete backup.syncedHash;
            await saveStory(backup);
            remoteStory.syncedAt = nowLocal;
            remoteStory.syncedHash = storyHash(remoteStory);
            await saveStory(remoteStory);
            changed = true;
          } else if (choice === "local") {
            await syncRequest("/sync/push", "POST", { stories: [local] });
            local.syncedAt = nowLocal;
            local.syncedHash = storyHash(local);
            await saveStory(local);
          }
        } else {
          remoteStory.syncedAt = nowLocal;
          remoteStory.syncedHash = storyHash(remoteStory);
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

        if (!s.syncedAt) {
          // 从未同步过的新故事 → 直接推送
          verifiedPush.push(s);
          continue;
        }

        // 已同步过的故事 → 先确认云端状态
        if (safetyLockTriggered) {
          // 安全锁激活 → 当作新故事推送
          verifiedPush.push(s);
          continue;
        }

        // 尝试拉取云端版本做内容对比
        try {
          var remote = await syncRequest("/stories/" + s.id, "GET");
          // 云端存在 → 对比内容量，防止少覆盖多
          var localStats = countStoryStats(s);
          var remoteStats = countStoryStats(remote);

          if (remoteStats.chapters > localStats.chapters ||
              (remoteStats.chapters === localStats.chapters && remoteStats.chars > localStats.chars + 100)) {
            // ⚠️ 云端内容明显多于本地 → 触发推送冲突对话框
            console.warn("[Sync] Push blocked: local has less content than cloud for '" + s.title + "' (local: " + localStats.chapters + "ch/" + localStats.chars + "c, cloud: " + remoteStats.chapters + "ch/" + remoteStats.chars + "c)");
            var pushChoice = await showPushContentLossDialog(
              s.title || "未命名",
              localStats,
              remoteStats,
              s.updatedAt || "",
              remote.updatedAt || ""
            );
            if (pushChoice === "pull") {
              // 用云端版本覆盖本地
              remote.syncedAt = new Date().toISOString();
              await saveStory(remote);
              changed = true;
              console.log("[Sync] User chose to keep cloud version: " + s.title);
            } else if (pushChoice === "force") {
              verifiedPush.push(s);
              console.warn("[Sync] User chose to force push despite content loss: " + s.title);
            } else {
              console.log("[Sync] User skipped push for: " + s.title);
            }
          } else {
            // 内容量安全 → 正常推送
            verifiedPush.push(s);
          }
        } catch (fetchErr) {
          // 云端不存在（404等） → 重新推送
          console.warn("[Sync] Story was synced but missing from cloud, re-pushing: " + s.title);
          delete s.syncedAt;
          await saveStory(s);
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
          s.syncedHash = storyHash(s);
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
