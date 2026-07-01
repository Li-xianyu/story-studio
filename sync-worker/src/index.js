/**
 * Story Studio Sync Worker
 * Cloudflare Worker for cross-device story synchronization
 *
 * Auth:    X-Sync-Token 请求头（用户唯一凭证，无账号体系）
 * Storage: Cloudflare KV（SYNC_KV binding）
 *
 * KV Key 结构：
 *   token:{token}:created          → 创建时间（用于校验 token 有效性）
 *   {token}:meta:{storyId}         → 故事元数据 JSON，含 metadata 选项，用于快速 list() 组装索引
 *   {token}:story:{storyId}        → 单个故事完整 JSON
 *   {token}:settings               → 用户设置 JSON（不含 apiKey / ttsKey）
 */

/* ---- CORS ---- */

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Sync-Token",
    "Access-Control-Max-Age": "86400",
  };
}

function json(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders()),
  });
}

/* ---- Token 生成 ---- */

async function generateToken() {
  var array = new Uint8Array(24);
  crypto.getRandomValues(array);
  return Array.from(array, function (b) {
    return b.toString(16).padStart(2, "0");
  }).join("");
}

/* ---- 获取云端故事元数据索引列表 ---- */
async function getCloudIndex(env, syncToken) {
  var index = [];
  var cursor = null;
  do {
    var list = await env.SYNC_KV.list({
      prefix: syncToken + ":meta:",
      cursor: cursor
    });
    for (var i = 0; i < list.keys.length; i++) {
      var keyInfo = list.keys[i];
      if (keyInfo.metadata) {
        index.push(keyInfo.metadata);
      }
    }
    cursor = list.list_complete ? null : list.cursor;
  } while (cursor);
  return index;
}

/* ---- 主入口 ---- */

export default {
  async fetch(request, env) {
    var url = new URL(request.url);
    var path = url.pathname;
    var method = request.method;

    /* CORS 预检 */
    if (method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    /* ---- 公开路由：生成 Token（无需认证） ---- */
    if (path === "/token" && method === "POST") {
      var token = await generateToken();
      await env.SYNC_KV.put("token:" + token + ":created", new Date().toISOString());
      return json({
        token: token,
        message: "Token 生成成功，请妥善保存。它是你的唯一凭证，丢失后数据无法找回。",
        createdAt: new Date().toISOString(),
      }, 201);
    }

    /* ---- 认证校验 ---- */
    var syncToken = request.headers.get("X-Sync-Token");
    if (!syncToken) {
      return json({ error: "缺少 X-Sync-Token 请求头" }, 401);
    }

    var tokenCreated = await env.SYNC_KV.get("token:" + syncToken + ":created");
    if (!tokenCreated) {
      return json({ error: "无效的 Token，请重新生成" }, 401);
    }

    /* ---- 路由 ---- */
    try {
      // === ONE-TIME INDEX MIGRATION ===
      var legacyIndexKey = syncToken + ":index";
      var legacyIndex = await env.SYNC_KV.get(legacyIndexKey, "json");
      if (legacyIndex && Array.isArray(legacyIndex)) {
        for (var i = 0; i < legacyIndex.length; i++) {
          var meta = legacyIndex[i];
          var metaKey = syncToken + ":meta:" + meta.id;
          var exists = await env.SYNC_KV.get(metaKey);
          if (!exists) {
            await env.SYNC_KV.put(metaKey, JSON.stringify(meta), { metadata: meta });
          }
        }
        await env.SYNC_KV.delete(legacyIndexKey);
      }

      /* 健康检查 / Token 验证 */
      if (path === "/ping") {
        var cloudIndex = await getCloudIndex(env, syncToken);
        return json({ ok: true, tokenCreatedAt: tokenCreated, storyCount: cloudIndex.length });
      }

      /* 故事列表（仅元数据） */
      if (path === "/stories" && method === "GET") {
        var cloudIndex = await getCloudIndex(env, syncToken);
        return json(cloudIndex);
      }

      /* 单个故事 CRUD */
      var storyMatch = path.match(/^\/stories\/([^/]+)$/);
      if (storyMatch) {
        var storyId = storyMatch[1];

        if (method === "GET") {
          var story = await env.SYNC_KV.get(syncToken + ":story:" + storyId, "json");
          if (!story) return json({ error: "故事不存在" }, 404);
          return json(story);
        }

        if (method === "PUT") {
          var body = await request.json();
          var now = new Date().toISOString();
          var story = Object.assign({}, body, { syncedAt: now });
          await env.SYNC_KV.put(syncToken + ":story:" + storyId, JSON.stringify(story));

          var meta = { id: storyId, title: story.title || "未命名", updatedAt: story.updatedAt || now, syncedAt: now };
          await env.SYNC_KV.put(syncToken + ":meta:" + storyId, JSON.stringify(meta), { metadata: meta });
          return json({ ok: true, syncedAt: now });
        }

        if (method === "DELETE") {
          await env.SYNC_KV.delete(syncToken + ":story:" + storyId);
          await env.SYNC_KV.delete(syncToken + ":meta:" + storyId);
          return json({ ok: true });
        }
      }

      /* 设置同步（不同步 apiKey / ttsKey） */
      if (path === "/settings") {
        if (method === "GET") {
          return json((await env.SYNC_KV.get(syncToken + ":settings", "json")) || {});
        }
        if (method === "PUT") {
          var body = await request.json();
          var safe = Object.assign({}, body);
          delete safe.apiKey;
          delete safe.ttsKey;
          await env.SYNC_KV.put(syncToken + ":settings", JSON.stringify(safe));
          return json({ ok: true });
        }
      }

      /* 全量拉取（所有故事 + 设置） */
      if (path === "/sync/pull" && method === "GET") {
        var cloudIndex = await getCloudIndex(env, syncToken);
        var settings = (await env.SYNC_KV.get(syncToken + ":settings", "json")) || {};
        var stories = await Promise.all(
          cloudIndex.map(function (meta) { return env.SYNC_KV.get(syncToken + ":story:" + meta.id, "json"); })
        );
        return json({ stories: stories.filter(Boolean), settings: settings, index: cloudIndex, pulledAt: new Date().toISOString() });
      }

      /* 批量推送（最后写入胜，以 updatedAt 比较） */
      if (path === "/sync/push" && method === "POST") {
        var body = await request.json();
        var stories = body.stories || [];
        var newSettings = body.settings || null;
        var now = new Date().toISOString();

        await Promise.all(stories.map(async function (story) {
          var storedMetaKey = syncToken + ":meta:" + story.id;
          var storedMeta = await env.SYNC_KV.get(storedMetaKey, "json");
          if (!storedMeta || (story.updatedAt || "") >= (storedMeta.updatedAt || "")) {
            await env.SYNC_KV.put(syncToken + ":story:" + story.id, JSON.stringify(Object.assign({}, story, { syncedAt: now })));
            var meta = { id: story.id, title: story.title || "未命名", updatedAt: story.updatedAt || now, syncedAt: now };
            await env.SYNC_KV.put(storedMetaKey, JSON.stringify(meta), { metadata: meta });
          }
        }));

        if (newSettings) {
          var safe = Object.assign({}, newSettings);
          delete safe.apiKey;
          delete safe.ttsKey;
          await env.SYNC_KV.put(syncToken + ":settings", JSON.stringify(safe));
        }
        return json({ ok: true, pushedAt: now, count: stories.length });
      }

      /* 差异计算（增量同步辅助） */
      if (path === "/sync/diff" && method === "POST") {
        var body = await request.json();
        var localIndex = body.localIndex || [];
        var cloudIndex = await getCloudIndex(env, syncToken);

        var localMap = {};
        localIndex.forEach(function (s) { localMap[s.id] = s.updatedAt; });
        var cloudMap = {};
        cloudIndex.forEach(function (s) { cloudMap[s.id] = s.updatedAt; });

        var needPull = cloudIndex.filter(function (s) { return !localMap[s.id] || s.updatedAt > localMap[s.id]; });
        var needPush = localIndex.filter(function (s) { return !cloudMap[s.id] || s.updatedAt > cloudMap[s.id]; });

        return json({ needPull: needPull, needPush: needPush });
      }

      return json({ error: "接口不存在: " + path }, 404);

    } catch (err) {
      console.error("Worker error:", err);
      return json({ error: "内部错误：" + err.message }, 500);
    }
  },
};
