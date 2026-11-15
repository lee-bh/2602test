interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  IMAGES: R2Bucket;
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  SESSION_SECRET: string;
}

interface Session { userId: string; exp: number }
interface Entry { id: string; entry_date: string; title: string; body: string; created_at: string; updated_at: string }

const encoder = new TextEncoder();
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
const error = (message: string, status = 400) => json({ error: message }, status);
const id = () => crypto.randomUUID();
// Cookie values may not contain `"` or `,` (RFC 6265), so every signed payload travels base64url-encoded.
const pack = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
const unpack = <T>(raw: string): T => JSON.parse(new TextDecoder().decode(decodeBase64url(raw))) as T;
const SECRET_KEYS = ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "SESSION_SECRET"] as const;
const configured = (env: Env) => SECRET_KEYS.every((key) => Boolean(env[key]));
const CONFIG_MESSAGE = "서버에 Google 로그인 설정이 없습니다. GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / SESSION_SECRET 시크릿을 설정해 주세요.";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return health(env);
      if (url.pathname === "/auth/google") return beginGoogleLogin(request, env);
      if (url.pathname === "/auth/google/callback") return finishGoogleLogin(request, env);
      if (url.pathname === "/auth/logout" && request.method === "POST") return logout(url);
      if (url.pathname.startsWith("/api/")) return api(request, env, ctx);
      return env.ASSETS.fetch(request);
    } catch (cause) {
      console.error(cause);
      return error("요청을 처리하지 못했습니다.", 500);
    }
  },
};

async function api(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const session = await getSession(request, env);
  const url = new URL(request.url);
  const path = url.pathname;
  const imageMatch = path.match(/^\/api\/images\/([\w-]+)$/);

  // Reading is public: the feed and the photos in it need no sign-in. Writing does.
  if (path === "/api/entries" && request.method === "GET") return listEntries(env, session?.userId ?? null);
  if (imageMatch && request.method === "GET") return getImage(request, env, session?.userId ?? null, imageMatch[1]);

  if (!session) return error("로그인이 필요합니다.", 401);
  if (path === "/api/me" && request.method === "GET") {
    // nickname is null for an account that has not picked one, and absent while the
    // database predates nicknames, so the page only asks for one once it can be saved.
    const columns = await nicknamesReady(env) ? "id, email, name, avatar_url, nickname" : "id, email, name, avatar_url";
    const user = await env.DB.prepare(`SELECT ${columns} FROM users WHERE id = ?`).bind(session.userId).first();
    return user ? json({ user }) : error("사용자를 찾을 수 없습니다.", 401);
  }
  if (path === "/api/me" && request.method === "PUT") return setNickname(request, env, session.userId);
  if (path === "/api/entries" && request.method === "POST") return createEntry(request, env, session.userId);
  const entryMatch = path.match(/^\/api\/entries\/([\w-]+)$/);
  if (entryMatch) {
    if (request.method === "PUT") return updateEntry(request, env, session.userId, entryMatch[1]);
    if (request.method === "DELETE") return deleteEntry(env, session.userId, entryMatch[1], ctx);
  }
  if (path === "/api/images" && request.method === "POST") return uploadImage(request, env, session.userId);
  if (imageMatch && request.method === "DELETE") return deleteImage(env, session.userId, imageMatch[1]);
  return error("찾을 수 없는 API입니다.", 404);
}

// Every entry, newest first, for anyone, signed with the author's nickname. The Google
// name, email and user_id stay on the server; a signed-in visitor only learns which
// entries are theirs, so the page can offer edit and delete.
async function listEntries(env: Env, userId: string | null): Promise<Response> {
  const author = await nicknamesReady(env) ? "u.nickname" : "u.name";
  const rows = await env.DB.prepare(`SELECT e.id, e.entry_date, e.title, e.body, e.created_at, e.updated_at, ${author} AS author, e.user_id = ? AS mine
    FROM entries e JOIN users u ON u.id = e.user_id ORDER BY e.entry_date DESC, e.created_at DESC, e.id DESC`)
    .bind(userId).all<Entry & { author: string | null; mine: number | null }>();
  return json({ entries: rows.results.map((entry) => ({ ...entry, mine: entry.mine === 1 })) });
}

// The code can go out before migration 0003 reaches the database. Until the column
// exists, the feed keeps signing entries with the Google name and nothing asks for a
// nickname; once it does, nicknames switch on without another deploy. Only "ready" is
// remembered, so the check repeats until the migration lands.
let nicknameColumn = false;
async function nicknamesReady(env: Env): Promise<boolean> {
  if (!nicknameColumn) nicknameColumn = Boolean(await env.DB.prepare("SELECT 1 FROM pragma_table_info('users') WHERE name = 'nickname'").first());
  return nicknameColumn;
}

// 2 to 20 letters (any script), digits, spaces, _ . -; runs of spaces collapse to one.
const NICKNAME = /^[\p{L}\p{N}_.\- ]{2,20}$/u;
const NICKNAME_RULE = "닉네임은 2~20자의 한글, 영문, 숫자, 공백, _ . - 만 쓸 수 있습니다.";
function cleanNickname(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const nickname = value.normalize("NFC").trim().replace(/\s+/g, " ");
  return NICKNAME.test(nickname) ? nickname : null;
}
async function setNickname(request: Request, env: Env, userId: string): Promise<Response> {
  if (!(await nicknamesReady(env))) return error("닉네임 기능을 준비하고 있습니다. 잠시 뒤에 다시 시도해 주세요.", 503);
  const input = await request.json().catch(() => null) as { nickname?: unknown } | null;
  const nickname = cleanNickname(input?.nickname);
  if (!nickname) return error(NICKNAME_RULE);
  const taken = await env.DB.prepare("SELECT id FROM users WHERE nickname = ? COLLATE NOCASE AND id <> ?").bind(nickname, userId).first();
  if (taken) return error("이미 사용 중인 닉네임입니다.", 409);
  try {
    await env.DB.prepare("UPDATE users SET nickname = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").bind(nickname, userId).run();
  } catch (cause) {
    // Someone took it between the check and the write; the unique index caught it.
    if (String(cause).includes("UNIQUE")) return error("이미 사용 중인 닉네임입니다.", 409);
    throw cause;
  }
  return json({ nickname });
}
const hasNickname = async (env: Env, userId: string) =>
  Boolean(await env.DB.prepare("SELECT id FROM users WHERE id = ? AND nickname IS NOT NULL").bind(userId).first());

function validEntry(input: unknown): input is { entryDate: string; title: string; body: string } {
  if (!input || typeof input !== "object") return false;
  const value = input as Record<string, unknown>;
  return typeof value.entryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.entryDate)
    && typeof value.title === "string" && value.title.trim().length <= 200
    && typeof value.body === "string" && value.body.length <= 20_000;
}
async function createEntry(request: Request, env: Env, userId: string): Promise<Response> {
  const input: unknown = await request.json().catch(() => null);
  if (!validEntry(input)) return error("일기 형식이 올바르지 않습니다.");
  if (await nicknamesReady(env) && !(await hasNickname(env, userId))) return error("마이페이지에서 닉네임을 먼저 정해 주세요.", 403);
  const entryId = id();
  try {
    await env.DB.prepare("INSERT INTO entries (id, user_id, entry_date, title, body) VALUES (?, ?, ?, ?, ?)")
      .bind(entryId, userId, input.entryDate, input.title.trim(), input.body).run();
  } catch (cause) { console.error(cause); return error("일기를 저장하지 못했습니다.", 500); }
  await linkImages(env, userId, entryId, input.body);
  return json({ entry: { id: entryId, entry_date: input.entryDate, title: input.title.trim(), body: input.body } }, 201);
}
async function updateEntry(request: Request, env: Env, userId: string, entryId: string): Promise<Response> {
  const input: unknown = await request.json().catch(() => null);
  if (!validEntry(input)) return error("일기 형식이 올바르지 않습니다.");
  const result = await env.DB.prepare("UPDATE entries SET entry_date = ?, title = ?, body = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?")
    .bind(input.entryDate, input.title.trim(), input.body, entryId, userId).run();
  if (!result.meta.changes) return error("일기를 찾을 수 없습니다.", 404);
  await linkImages(env, userId, entryId, input.body);
  return json({ ok: true });
}
async function deleteEntry(env: Env, userId: string, entryId: string, ctx: ExecutionContext): Promise<Response> {
  const images = await env.DB.prepare("SELECT object_key FROM images WHERE entry_id = ? AND user_id = ?").bind(entryId, userId).all<{ object_key: string }>();
  const result = await env.DB.prepare("DELETE FROM entries WHERE id = ? AND user_id = ?").bind(entryId, userId).run();
  if (!result.meta.changes) return error("일기를 찾을 수 없습니다.", 404);
  await env.DB.prepare("DELETE FROM images WHERE entry_id = ? AND user_id = ?").bind(entryId, userId).run();
  ctx.waitUntil(Promise.all(images.results.map((image) => env.IMAGES.delete(image.object_key))));
  return new Response(null, { status: 204 });
}

async function uploadImage(request: Request, env: Env, userId: string): Promise<Response> {
  const form = await request.formData();
  const file = form.get("image");
  const entryId = form.get("entryId");
  if (!(file instanceof File) || !file.type.startsWith("image/") || file.size > 8 * 1024 * 1024) return error("8MB 이하의 이미지 파일만 올릴 수 있습니다.");
  // A photo can be uploaded while composing, before the entry exists. It is linked when
  // the entry is saved; until then entry_id stays null.
  let entry: string | null = null;
  if (typeof entryId === "string" && entryId) {
    if (!(await ownedEntry(env, userId, entryId))) return error("일기를 찾을 수 없습니다.", 404);
    entry = entryId;
  }
  const imageId = id(); const key = `${userId}/${imageId}`;
  await env.IMAGES.put(key, file.stream(), { httpMetadata: { contentType: file.type }, customMetadata: { originalName: file.name } });
  await env.DB.prepare("INSERT INTO images (id, user_id, entry_id, object_key, content_type, size) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(imageId, userId, entry, key, file.type, file.size).run();
  return json({ image: { id: imageId, url: `/api/images/${imageId}` } }, 201);
}
// A photo attached to an entry is public like the entry. One uploaded while composing and
// not yet saved with an entry is still visible only to the person who uploaded it.
async function getImage(request: Request, env: Env, userId: string | null, imageId: string): Promise<Response> {
  const image = await env.DB.prepare("SELECT object_key, content_type, entry_id FROM images WHERE id = ? AND (entry_id IS NOT NULL OR user_id = ?)")
    .bind(imageId, userId).first<{ object_key: string; content_type: string; entry_id: string | null }>();
  if (!image) return error("이미지를 찾을 수 없습니다.", 404);
  const object = await env.IMAGES.get(image.object_key);
  if (!object) return error("이미지를 찾을 수 없습니다.", 404);
  const headers = new Headers({ "Content-Type": object.httpMetadata?.contentType || image.content_type, "Cache-Control": `${image.entry_id ? "public" : "private"}, max-age=3600`, ETag: object.httpEtag });
  if (request.headers.get("If-None-Match") === object.httpEtag) return new Response(null, { status: 304, headers });
  return new Response(object.body, { headers });
}
async function deleteImage(env: Env, userId: string, imageId: string): Promise<Response> {
  const image = await env.DB.prepare("SELECT object_key FROM images WHERE id = ? AND user_id = ?").bind(imageId, userId).first<{ object_key: string }>();
  if (!image) return error("이미지를 찾을 수 없습니다.", 404);
  await Promise.all([env.DB.prepare("DELETE FROM images WHERE id = ? AND user_id = ?").bind(imageId, userId).run(), env.IMAGES.delete(image.object_key)]);
  return new Response(null, { status: 204 });
}
// Claim the photos this body references that were uploaded before the entry existed, so
// deleting the entry still clears them from R2.
const linkImages = (env: Env, userId: string, entryId: string, body: string) =>
  env.DB.prepare("UPDATE images SET entry_id = ? WHERE user_id = ? AND entry_id IS NULL AND instr(?, '/api/images/' || id) > 0")
    .bind(entryId, userId, body).run();
const ownedEntry = async (env: Env, userId: string, entryId: string) => Boolean(await env.DB.prepare("SELECT id FROM entries WHERE id = ? AND user_id = ?").bind(entryId, userId).first());

function base64url(bytes: Uint8Array) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""); }
function decodeBase64url(value: string) { const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4); return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)); }
async function hmac(value: string, secret: string) { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return base64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)))); }
async function signed(value: string, secret: string) { return `${value}.${await hmac(value, secret)}`; }
async function verifySigned(value: string | undefined, secret: string) { if (!value) return null; const dot = value.lastIndexOf("."); if (dot < 1) return null; const raw = value.slice(0, dot); const actual = value.slice(dot + 1); const expected = await hmac(raw, secret); if (actual.length !== expected.length || !constantTimeEqual(encoder.encode(actual), encoder.encode(expected))) return null; return raw; }
function constantTimeEqual(left: Uint8Array, right: Uint8Array) { if (left.length !== right.length) return false; let diff = 0; for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i]; return diff === 0; }
function cookie(request: Request, name: string) { return request.headers.get("Cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1); }
function cookieHeader(name: string, value: string, maxAge?: number) { return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax${maxAge !== undefined ? `; Max-Age=${maxAge}` : ""}`; }
async function getSession(request: Request, env: Env): Promise<Session | null> { if (!env.SESSION_SECRET) return null; const raw = await verifySigned(cookie(request, "diary_session"), env.SESSION_SECRET); if (!raw) return null; try { const session = unpack<Session>(raw); return session.exp > Date.now() / 1000 ? session : null; } catch { return null; } }

// Visitable in a browser to confirm the Worker -- not the asset router -- answered the
// request. Reports only whether each dependency is reachable, never any secret value.
async function health(env: Env): Promise<Response> {
  const missing = SECRET_KEYS.filter((key) => !env[key]);
  let db = "ok";
  try { await env.DB.prepare("SELECT 1 FROM users LIMIT 1").all(); }
  catch (cause) { db = `실패 (${cause instanceof Error ? cause.message : String(cause)})`; }
  const lines = [
    "worker: ok (이 글이 보이면 Worker가 요청을 처리한 것입니다)",
    `secrets: ${missing.length ? `누락 - ${missing.join(", ")}` : "ok"}`,
    `secret 상세: ${SECRET_KEYS.map((key) => `${key}=${!(key in env) ? "바인딩 없음" : env[key] ? "값 있음" : "값이 빈 문자열"}`).join(", ")}`,
    // Names only, never values: a name with stray whitespace shows up in the quotes.
    `런타임 바인딩 이름: ${JSON.stringify(Object.keys(env).sort())}`,
    `d1: ${db}`,
  ];
  return new Response(lines.join("\n") + "\n", { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
async function beginGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return loginFailed(CONFIG_MESSAGE);
  const state = base64url(crypto.getRandomValues(new Uint8Array(24)));
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(verifier))));
  const redirectUri = new URL("/auth/google/callback", request.url).href;
  const params = new URLSearchParams({ client_id: env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri, response_type: "code", scope: "openid email profile", state, code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account" });
  const signedState = await signed(pack({ state, verifier, exp: Date.now() + 600_000 }), env.SESSION_SECRET);
  return new Response(null, { status: 302, headers: { Location: `https://accounts.google.com/o/oauth2/v2/auth?${params}`, "Set-Cookie": cookieHeader("oauth_state", signedState, 600) } });
}
async function finishGoogleLogin(request: Request, env: Env): Promise<Response> {
  if (!configured(env)) return loginFailed(CONFIG_MESSAGE);
  const url = new URL(request.url);
  const googleError = url.searchParams.get("error");
  if (googleError) return loginFailed(`Google 로그인이 취소되었습니다. (${googleError})`);
  const saved = await verifySigned(cookie(request, "oauth_state"), env.SESSION_SECRET);
  if (!saved) return loginFailed("로그인 상태 쿠키를 찾을 수 없습니다. 다시 시도해 주세요.");

  let state: { state: string; verifier: string; exp: number };
  try { state = unpack(saved); } catch { return loginFailed("로그인 요청을 확인할 수 없습니다."); }
  const code = url.searchParams.get("code");
  if (state.exp < Date.now()) return loginFailed("로그인 요청이 만료되었습니다. 다시 시도해 주세요.");
  if (state.state !== url.searchParams.get("state") || !code) return loginFailed("로그인 요청을 확인할 수 없습니다.");

  const redirectUri = new URL("/auth/google/callback", request.url).href;
  let profile: Awaited<ReturnType<typeof verifyGoogleToken>>;
  try {
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: env.GOOGLE_CLIENT_ID, client_secret: env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri, grant_type: "authorization_code", code_verifier: state.verifier }) });
    if (!response.ok) {
      console.error("Google token exchange failed", response.status, await response.text());
      return loginFailed(`Google 토큰 교환에 실패했습니다 (${response.status}). Google Cloud Console에 승인된 리디렉션 URI로 ${redirectUri} 가 등록되어 있는지 확인해 주세요.`);
    }
    const tokens = await response.json() as { id_token?: string };
    if (!tokens.id_token) return loginFailed("Google 응답에 ID 토큰이 없습니다.");
    profile = await verifyGoogleToken(tokens.id_token, env.GOOGLE_CLIENT_ID);
  } catch (cause) {
    console.error(cause);
    return loginFailed("Google 인증 정보를 확인하지 못했습니다.");
  }
  if (!profile.email_verified) return loginFailed("Google 이메일 인증이 필요합니다.");

  let user: { id: string } | null;
  try {
    user = await env.DB.prepare("SELECT id FROM users WHERE google_sub = ?").bind(profile.sub).first<{ id: string }>();
    if (!user) { user = { id: id() }; await env.DB.prepare("INSERT INTO users (id, google_sub, email, name, avatar_url) VALUES (?, ?, ?, ?, ?)").bind(user.id, profile.sub, profile.email, profile.name || profile.email, profile.picture || null).run(); }
  } catch (cause) {
    console.error(cause);
    return loginFailed("사용자 정보를 저장하지 못했습니다. D1 마이그레이션이 적용되었는지 확인해 주세요.");
  }

  const session = pack({ userId: user.id, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 14 } satisfies Session);
  const headers = new Headers({ Location: "/" });
  headers.append("Set-Cookie", cookieHeader("diary_session", await signed(session, env.SESSION_SECRET), 60 * 60 * 24 * 14));
  headers.append("Set-Cookie", cookieHeader("oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}
function loginFailed(message: string): Response {
  const headers = new Headers({ Location: `/?login_error=${encodeURIComponent(message)}` });
  headers.append("Set-Cookie", cookieHeader("oauth_state", "", 0));
  return new Response(null, { status: 302, headers });
}
async function logout(_url: URL): Promise<Response> { return new Response(null, { status: 204, headers: { "Set-Cookie": cookieHeader("diary_session", "", 0) } }); }

async function verifyGoogleToken(token: string, clientId: string): Promise<{ sub: string; email: string; email_verified: boolean; name?: string; picture?: string }> {
  const [header, payload, signature] = token.split("."); if (!header || !payload || !signature) throw new Error("Invalid ID token");
  const jwk = await fetch("https://www.googleapis.com/oauth2/v3/certs").then((r) => r.json() as Promise<{ keys: JsonWebKey[] }>).then((keys) => keys.keys.find((key) => (key as JsonWebKey & { kid?: string }).kid === JSON.parse(new TextDecoder().decode(decodeBase64url(header))).kid));
  if (!jwk) throw new Error("Unknown Google signing key");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  if (!await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, decodeBase64url(signature), encoder.encode(`${header}.${payload}`))) throw new Error("Invalid ID token signature");
  const claims = JSON.parse(new TextDecoder().decode(decodeBase64url(payload))) as { iss: string; aud: string; exp: number; sub: string; email: string; email_verified: boolean; name?: string; picture?: string };
  if (!['https://accounts.google.com', 'accounts.google.com'].includes(claims.iss) || claims.aud !== clientId || claims.exp < Date.now() / 1000) throw new Error("Invalid ID token claims");
  return claims;
}
