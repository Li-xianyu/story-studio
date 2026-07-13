/*
 * Story Studio AI Proxy Worker
 *
 * This Worker only forwards OpenAI-compatible model listing and chat completion
 * requests to VanYo. The browser supplies its own API key in Authorization.
 */

var DEFAULT_UPSTREAM_ORIGIN = "https://api.vanyospace.com";
var ALLOWED_ROUTES = {
  "/v1/models": ["GET"],
  "/v1/chat/completions": ["POST"]
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400"
  };
}

function withCors(response) {
  var headers = new Headers(response.headers);
  var cors = corsHeaders();
  Object.keys(cors).forEach(function (name) {
    headers.set(name, cors[name]);
  });
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: headers
  });
}

function jsonError(message, status) {
  return new Response(JSON.stringify({ error: { message: message } }), {
    status: status,
    headers: Object.assign({ "Content-Type": "application/json" }, corsHeaders())
  });
}

export default {
  async fetch(request) {
    var url = new URL(request.url);
    var allowedMethods = ALLOWED_ROUTES[url.pathname];

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (!allowedMethods || allowedMethods.indexOf(request.method) === -1) {
      return jsonError("Only /v1/models and /v1/chat/completions are available", 404);
    }

    var headers = new Headers();
    var authorization = request.headers.get("Authorization");
    var contentType = request.headers.get("Content-Type");
    var accept = request.headers.get("Accept");

    if (authorization) headers.set("Authorization", authorization);
    if (contentType) headers.set("Content-Type", contentType);
    if (accept) headers.set("Accept", accept);

    var target = url.searchParams.get("target") || DEFAULT_UPSTREAM_ORIGIN;
    var targetUrl;
    try {
      targetUrl = new URL(target);
      if (targetUrl.protocol !== "https:") return jsonError("Target must use HTTPS", 400);
    } catch (_) {
      return jsonError("Invalid target URL", 400);
    }

    var upstreamUrl = targetUrl.origin + targetUrl.pathname.replace(/\/+$/, "") + url.pathname +
      (targetUrl.search || "");
    try {
      var upstream = await fetch(upstreamUrl, {
        method: request.method,
        headers: headers,
        body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body
      });
      return withCors(upstream);
    } catch (err) {
      return jsonError("Upstream request failed: " + (err.message || "unknown error"), 502);
    }
  }
};
