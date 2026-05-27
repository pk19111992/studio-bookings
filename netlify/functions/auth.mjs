// netlify/functions/auth.mjs
// Uses Supabase REST API directly — zero npm dependencies

const SUPABASE_URL          = process.env.SUPABASE_URL;
const SUPABASE_KEY          = process.env.SUPABASE_KEY;
const GOOGLE_CLIENT_ID      = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET  = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET            = process.env.JWT_SECRET || "change-me";
const SITE_URL              = process.env.SITE_URL   || "http://localhost:8888";
const ADMIN_EMAIL           = "blissfulperch@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, OPTIONS",
  "Content-Type": "application/json",
};

// ── Supabase REST helpers ─────────────────────────────────────────────────────
const sbH = {
  "Content-Type":  "application/json",
  "apikey":        SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

async function sbSelect(table, qs = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: sbH });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbUpsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { ...sbH, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbUpdate(table, filters, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filters}`, {
    method: "PATCH",
    headers: sbH,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── JWT helpers ───────────────────────────────────────────────────────────────
function b64url(str) { return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }

async function signJWT(payload) {
  const h   = b64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
  const b   = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000) }));
  const msg = `${h}.${b}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return `${msg}.${b64url(String.fromCharCode(...new Uint8Array(sig)))}`;
}

async function verifyJWT(token) {
  const [h, b, sig] = token.split(".");
  const msg = `${h}.${b}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(msg));
  if (!ok) throw new Error("Invalid token");
  const payload = JSON.parse(atob(b.replace(/-/g,"+").replace(/_/g,"/")));
  if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) throw new Error("Token expired");
  return payload;
}

async function hashPassword(pw) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw + JWT_SECRET));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

function makeToken(u) {
  return signJWT({ sub:u.id, email:u.email, name:u.name, avatar:u.avatar||null, role:u.role||"user", exp: Math.floor(Date.now()/1000)+86400*7 });
}

function userPayload(u) {
  return { id:u.id, email:u.email, name:u.name, avatar:u.avatar||null, bio:u.bio||null, phone:u.phone||null, role:u.role||"user", provider:u.provider||"password" };
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  try {

    // ── verify ──────────────────────────────────────────────────────────────
    if (action === "verify") {
      const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
      if (!token) return new Response(JSON.stringify({ error:"No token" }), { status:401, headers:CORS });
      const p = await verifyJWT(token);
      const rows = await sbSelect("users", `id=eq.${p.sub}&select=*`);
      if (!rows.length) return new Response(JSON.stringify({ error:"User not found" }), { status:401, headers:CORS });
      return new Response(JSON.stringify({ user: userPayload(rows[0]) }), { headers:CORS });
    }

    // ── login ───────────────────────────────────────────────────────────────
    if (action === "login" && req.method === "POST") {
      const { email, password } = await req.json();
      const hash = await hashPassword(password);
      const rows = await sbSelect("users", `email=eq.${encodeURIComponent(email.toLowerCase())}&password_hash=eq.${hash}&provider=eq.password`);
      if (!rows.length) return new Response(JSON.stringify({ error:"Invalid email or password" }), { status:401, headers:CORS });
      const u = rows[0];
      return new Response(JSON.stringify({ token: await makeToken(u), user: userPayload(u) }), { headers:CORS });
    }

    // ── register (open) ─────────────────────────────────────────────────────
    if (action === "register" && req.method === "POST") {
      const { email, password, name } = await req.json();
      if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });
      if (password.length < 6) return new Response(JSON.stringify({ error:"Password must be at least 6 characters" }), { status:400, headers:CORS });
      const id   = crypto.randomUUID();
      const hash = await hashPassword(password);
      const role = email.toLowerCase() === ADMIN_EMAIL ? "admin" : "user";
      try {
        await sbUpsert("users", { id, email:email.toLowerCase(), name:name||email, password_hash:hash, provider:"password", role });
      } catch(e) {
        if (e.message.includes("unique") || e.message.includes("duplicate")) return new Response(JSON.stringify({ error:"Email already registered" }), { status:409, headers:CORS });
        throw e;
      }
      const u = { id, email:email.toLowerCase(), name:name||email, avatar:null, bio:null, phone:null, role, provider:"password" };
      return new Response(JSON.stringify({ token: await makeToken(u), user: userPayload(u) }), { headers:CORS });
    }

    // ── update profile ──────────────────────────────────────────────────────
    if (action === "profile" && req.method === "PATCH") {
      const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
      const p = await verifyJWT(token);
      const { name, bio, phone, avatar } = await req.json();
      if (avatar && !avatar.startsWith("http") && !avatar.startsWith("data:")) {
        return new Response(JSON.stringify({ error:"Invalid avatar URL" }), { status:400, headers:CORS });
      }
      const update = {};
      if (name)   update.name   = name.trim();
      if (bio   !== undefined) update.bio   = bio||null;
      if (phone !== undefined) update.phone = phone||null;
      if (avatar !== undefined) update.avatar = avatar||null;
      await sbUpdate("users", `id=eq.${p.sub}`, update);
      const rows = await sbSelect("users", `id=eq.${p.sub}`);
      const u = rows[0];
      return new Response(JSON.stringify({ token: await makeToken(u), user: userPayload(u) }), { headers:CORS });
    }

    // ── change password ─────────────────────────────────────────────────────
    if (action === "change-password" && req.method === "POST") {
      const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
      const p = await verifyJWT(token);
      const { currentPassword, newPassword } = await req.json();
      if (!newPassword || newPassword.length < 6) return new Response(JSON.stringify({ error:"New password must be at least 6 characters" }), { status:400, headers:CORS });
      const rows = await sbSelect("users", `id=eq.${p.sub}`);
      if (!rows.length) return new Response(JSON.stringify({ error:"User not found" }), { status:404, headers:CORS });
      const u = rows[0];
      if (u.provider === "google") return new Response(JSON.stringify({ error:"Google accounts cannot set a password here" }), { status:400, headers:CORS });
      const currentHash = await hashPassword(currentPassword);
      if (u.password_hash !== currentHash) return new Response(JSON.stringify({ error:"Current password is incorrect" }), { status:401, headers:CORS });
      await sbUpdate("users", `id=eq.${p.sub}`, { password_hash: await hashPassword(newPassword) });
      return new Response(JSON.stringify({ ok:true, message:"Password updated successfully" }), { headers:CORS });
    }

    // ── Google OAuth step 1 ─────────────────────────────────────────────────
    if (action === "google") {
      if (!GOOGLE_CLIENT_ID) return new Response(JSON.stringify({ error:"GOOGLE_CLIENT_ID not configured" }), { status:500, headers:CORS });
      const params = new URLSearchParams({ client_id:GOOGLE_CLIENT_ID, redirect_uri:`${SITE_URL}/api/auth?action=callback`, response_type:"code", scope:"openid email profile", access_type:"online", prompt:"select_account" });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    }

    // ── Google OAuth step 2 callback ────────────────────────────────────────
    if (action === "callback") {
      const code = url.searchParams.get("code");
      if (!code) return Response.redirect(`${SITE_URL}?error=oauth_denied`);
      const tokenRes  = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body:new URLSearchParams({ code, client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, redirect_uri:`${SITE_URL}/api/auth?action=callback`, grant_type:"authorization_code" }) });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return Response.redirect(`${SITE_URL}?error=oauth_failed`);
      const info = await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers:{ Authorization:`Bearer ${tokenData.access_token}` } })).json();
      const role = info.email.toLowerCase() === ADMIN_EMAIL ? "admin" : "user";
      const existing = await sbSelect("users", `email=eq.${encodeURIComponent(info.email)}`);
      let u;
      if (existing.length) {
        await sbUpdate("users", `id=eq.${existing[0].id}`, { name:info.name, avatar:info.picture, provider:"google", role });
        u = { ...existing[0], name:info.name, avatar:info.picture, role, provider:"google" };
      } else {
        const id = crypto.randomUUID();
        await sbUpsert("users", { id, email:info.email, name:info.name, avatar:info.picture, provider:"google", role });
        u = { id, email:info.email, name:info.name, avatar:info.picture, bio:null, phone:null, role, provider:"google" };
      }
      return Response.redirect(`${SITE_URL}/#token=${await makeToken(u)}`);
    }

    // ── list all users (admin only) ─────────────────────────────────────────
    if (action === "users" && req.method === "GET") {
      const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
      const p = await verifyJWT(token);
      if (p.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const users = await sbSelect("users", "select=id,email,name,avatar,role,provider,created_at&order=created_at.desc");
      return new Response(JSON.stringify(users), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Unknown action" }), { status:404, headers:CORS });

  } catch(err) {
    console.error("Auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status:500, headers:CORS });
  }
}

export const config = { path: "/api/auth" };
