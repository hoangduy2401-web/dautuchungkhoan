#!/usr/bin/env node
// Spike: talk to SSI MCP (https://mcp.ssi.com.vn/mcp) as a plain MCP client,
// no LLM in between. Measures whether a backend can hold an OAuth session and
// call tools directly. Local only — nothing here is deployed.
//
//   node scripts/ssi-mcp-spike.mjs login            # one-time browser login (user does it)
//   node scripts/ssi-mcp-spike.mjs refresh          # use refresh_token, report rotation + lifetime
//   node scripts/ssi-mcp-spike.mjs tools [out.json] # list tools
//   node scripts/ssi-mcp-spike.mjs call <tool> '<json args>' [out.json]
//
// Tokens live in server/.ssi-mcp-token.json (gitignored). They are never printed.

import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "https://mcp.ssi.com.vn";
const MCP_URL = `${BASE}/mcp`;
const PORT = 8765;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const SCOPE = "market-data:read";
const TOKEN_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "server", ".ssi-mcp-token.json");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function loadToken() {
  if (!fs.existsSync(TOKEN_FILE)) throw new Error("no token file — run `login` first");
  return JSON.parse(fs.readFileSync(TOKEN_FILE, "utf8"));
}
function saveToken(t) {
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2), { mode: 0o600 });
}

// Token metadata only: lifetimes and claims that say nothing about the user.
function describe(tok) {
  const out = {
    expires_in: tok.expires_in ?? null,
    has_refresh_token: Boolean(tok.refresh_token),
    refresh_expires_in: tok.refresh_expires_in ?? tok.refresh_token_expires_in ?? null,
    scope: tok.scope ?? null,
    token_type: tok.token_type ?? null,
  };
  const parts = String(tok.access_token || "").split(".");
  if (parts.length === 3) {
    try {
      const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
      out.jwt = { iat: claims.iat, exp: claims.exp, lifetimeSec: claims.exp && claims.iat ? claims.exp - claims.iat : null };
    } catch {}
  } else {
    out.jwt = "opaque";
  }
  return out;
}

async function register() {
  const res = await fetch(`${BASE}/oauth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "Bang Dien dashboard (spike)",
      redirect_uris: [REDIRECT_URI],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: SCOPE,
    }),
  });
  if (!res.ok) throw new Error(`register HTTP ${res.status}: ${await res.text()}`);
  return (await res.json()).client_id;
}

async function tokenRequest(params) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`token HTTP ${res.status}: ${body.slice(0, 300)}`);
  return { tok: JSON.parse(body), ms: Date.now() - t0 };
}

async function login() {
  const clientId = await register();
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  const state = b64url(crypto.randomBytes(16));
  const url = new URL(`${BASE}/oauth/authorize`);
  url.search = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: REDIRECT_URI, scope: SCOPE,
    state, code_challenge: challenge, code_challenge_method: "S256", resource: MCP_URL,
  }).toString();

  console.log("Mở link này trong trình duyệt và đăng nhập SSI:\n\n" + url.toString() + "\n");
  console.log(`Đang chờ callback ở ${REDIRECT_URI} (tối đa 10 phút)…`);

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error("timeout waiting for login")); }, 600_000);
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, REDIRECT_URI);
      if (u.pathname !== "/callback") { res.writeHead(404).end(); return; }
      const ok = u.searchParams.get("state") === state && u.searchParams.get("code");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(ok ? "<p>Đã nhận đăng nhập. Đóng tab này được rồi.</p>"
                 : `<p>Lỗi: ${u.searchParams.get("error") || "state không khớp"}</p>`);
      clearTimeout(timer);
      server.close();
      ok ? resolve(u.searchParams.get("code"))
         : reject(new Error(`callback error: ${u.searchParams.get("error")} ${u.searchParams.get("error_description") || ""}`));
    }).listen(PORT, "127.0.0.1");
  });

  const { tok, ms } = await tokenRequest({
    grant_type: "authorization_code", code, redirect_uri: REDIRECT_URI,
    client_id: clientId, code_verifier: verifier, resource: MCP_URL,
  });
  saveToken({ ...tok, client_id: clientId, obtained_at: new Date().toISOString() });
  console.log("Đăng nhập xong. Token exchange", ms, "ms\n", JSON.stringify(describe(tok), null, 2));
}

async function refresh() {
  const old = loadToken();
  const { tok, ms } = await tokenRequest({
    grant_type: "refresh_token", refresh_token: old.refresh_token, client_id: old.client_id, resource: MCP_URL,
  });
  const rotated = Boolean(tok.refresh_token) && tok.refresh_token !== old.refresh_token;
  saveToken({ ...old, ...tok, refresh_token: tok.refresh_token || old.refresh_token, obtained_at: new Date().toISOString() });
  console.log(JSON.stringify({
    ms, rotated, previousObtainedAt: old.obtained_at,
    ageOfOldRefreshHours: ((Date.now() - Date.parse(old.obtained_at)) / 3.6e6).toFixed(2),
    ...describe(tok),
  }, null, 2));
}

// ---- Minimal MCP Streamable HTTP client ----
let sessionId = null;
let rpcId = 0;
const PROTOCOL = "2025-06-18";

async function rpc(method, params, { notify = false } = {}) {
  const tok = loadToken();
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    Authorization: `Bearer ${tok.access_token}`,
    "MCP-Protocol-Version": PROTOCOL,
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const msg = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const t0 = Date.now();
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(msg) });
  const ms = Date.now() - t0;
  sessionId = res.headers.get("mcp-session-id") || sessionId;
  if (notify) return { ms, status: res.status };
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} HTTP ${res.status}: ${text.slice(0, 300)}`);
  // Either plain JSON or an SSE stream whose `data:` lines carry JSON-RPC messages.
  let reply = null;
  if ((res.headers.get("content-type") || "").includes("text/event-stream")) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      const m = JSON.parse(line.slice(5));
      if (m.id === msg.id) reply = m;
    }
  } else {
    reply = JSON.parse(text);
  }
  if (!reply) throw new Error(`${method}: no reply in response`);
  if (reply.error) throw new Error(`${method} RPC error ${reply.error.code}: ${reply.error.message}`);
  return { ms, result: reply.result };
}

async function connect() {
  const init = await rpc("initialize", {
    protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "bang-dien-spike", version: "0.1" },
  });
  await rpc("notifications/initialized", {}, { notify: true });
  return init;
}

async function tools(outFile) {
  const init = await connect();
  console.log("initialize", init.ms, "ms — server", JSON.stringify(init.result.serverInfo), "protocol", init.result.protocolVersion);
  const all = [];
  let cursor;
  do {
    const r = await rpc("tools/list", cursor ? { cursor } : {});
    all.push(...r.result.tools);
    cursor = r.result.nextCursor;
  } while (cursor);
  console.log(all.length, "tools");
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(all, null, 2));
  else for (const t of all) console.log("-", t.name);
}

async function call(name, argsJson, outFile) {
  await connect();
  const r = await rpc("tools/call", { name, arguments: JSON.parse(argsJson || "{}") });
  const text = JSON.stringify(r.result);
  console.log(`${name}: ${r.ms} ms, ${text.length} bytes, isError=${Boolean(r.result.isError)}`);
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(r.result, null, 2));
  else console.log(text.slice(0, 1500));
}

const [cmd, ...args] = process.argv.slice(2);
const cmds = { login, refresh, tools, call };
if (!cmds[cmd]) {
  console.error("usage: login | refresh | tools [out] | call <tool> '<json>' [out]");
  process.exit(1);
}
cmds[cmd](...args).catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
