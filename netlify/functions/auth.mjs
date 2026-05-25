// netlify/functions/auth.mjs
// Uses Supabase REST API directly — no npm packages needed for DB

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET           = process.env.JWT_SECRET || "change-me-in-production";
const SITE_URL             = process.env.SITE_URL || "http://localhost:8888";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json",
};

// ── Supabase REST helpers ─────────────────────────────────────────────────────
const sbHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

async function sbSelect(table, filters = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filters}`, { headers: sbHeaders });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function sbUpsert(table, row) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { ...sbHeaders, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
  if (!res.ok) throw new Error(await res.text());
}

async function sbUpdate(table, id, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "PATCH",
    headers: sbHeaders,
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── JWT (no external deps) ────────────────────────────────────────────────────
function b64url(str) {
  return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
async function signJWT(payload) {
  const header = b64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
  const body   = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000) }));
  const msg    = `${header}.${body}`;
  const key    = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig    = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  const sigB64 = b64url(String.fromCharCode(...new Uint8Array(sig)));
  return `${msg}.${sigB64}`;
}
async function verifyJWT(token) {
  const [header, body, sig] = token.split(".");
  const msg = `${header}.${body}`;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["verify"]);
  const sigBytes = Uint8Array.from(atob(sig.replace(/-/g,"+").replace(/_/g,"/")), c => c.charCodeAt(0));
  const ok = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(msg));
  if (!ok) throw new Error("Invalid token");
  const payload = JSON.parse(atob(body.replace(/-/g,"+").replace(/_/g,"/")));
  if (payload.exp && payload.exp < Math.floor(Date.now()/1000)) throw new Error("Token expired");
  return payload;
}
async function hashPassword(password) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password + JWT_SECRET));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    // verify token
    if (action === "verify") {
      const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
      if (!token) return new Response(JSON.stringify({ error:"No token" }), { status:401, headers:CORS });
      const payload = await verifyJWT(token);
      return new Response(JSON.stringify({ user: payload }), { headers:CORS });
    }

    // password login
    if (action === "login" && req.method === "POST") {
      const { email, password } = await req.json();
      if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });
      const hash  = await hashPassword(password);
      const users = await sbSelect("users", `email=eq.${encodeURIComponent(email.toLowerCase())}&password_hash=eq.${hash}&provider=eq.password`);
      if (!users.length) return new Response(JSON.stringify({ error:"Invalid email or password" }), { status:401, headers:CORS });
      const user  = users[0];
      const token = await signJWT({ sub:user.id, email:user.email, name:user.name, avatar:user.avatar, exp: Math.floor(Date.now()/1000)+86400*7 });
      return new Response(JSON.stringify({ token, user:{ id:user.id, email:user.email, name:user.name, avatar:user.avatar } }), { headers:CORS });
    }

    // register
    if (action === "register" && req.method === "POST") {
      const { email, password, name } = await req.json();
      if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });
      // first user registers freely; after that need existing auth
      const existing = await sbSelect("users", "select=id&limit=1");
      if (existing.length > 0) {
        const auth = req.headers.get("Authorization")||"";
        try { await verifyJWT(auth.replace("Bearer ","")); }
        catch { return new Response(JSON.stringify({ error:"Only existing users can add new users" }), { status:403, headers:CORS }); }
      }
      const id   = crypto.randomUUID();
      const hash = await hashPassword(password);
      try {
        await sbUpsert("users", { id, email:email.toLowerCase(), name:name||email, password_hash:hash, provider:"password" });
      } catch(e) {
        if (e.message.includes("unique") || e.message.includes("duplicate")) {
          return new Response(JSON.stringify({ error:"Email already registered" }), { status:409, headers:CORS });
        }
        throw e;
      }
      const token = await signJWT({ sub:id, email:email.toLowerCase(), name:name||email, exp: Math.floor(Date.now()/1000)+86400*7 });
      return new Response(JSON.stringify({ token, user:{ id, email:email.toLowerCase(), name:name||email } }), { headers:CORS });
    }

    // Google OAuth — step 1
    if (action === "google") {
      if (!GOOGLE_CLIENT_ID) return new Response(JSON.stringify({ error:"GOOGLE_CLIENT_ID not set in Netlify env vars" }), { status:500, headers:CORS });
      const params = new URLSearchParams({
        client_id:     GOOGLE_CLIENT_ID,
        redirect_uri:  `${SITE_URL}/api/auth?action=callback`,
        response_type: "code",
        scope:         "openid email profile",
        access_type:   "online",
        prompt:        "select_account",
      });
      return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
    }

    // Google OAuth — step 2 callback
    if (action === "callback") {
      const code = url.searchParams.get("code");
      if (!code) return Response.redirect(`${SITE_URL}?error=oauth_denied`);
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type":"application/x-www-form-urlencoded" },
        body: new URLSearchParams({ code, client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, redirect_uri:`${SITE_URL}/api/auth?action=callback`, grant_type:"authorization_code" }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return Response.redirect(`${SITE_URL}?error=oauth_failed`);
      const info = await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers:{ Authorization:`Bearer ${tokenData.access_token}` } })).json();
      const existing = await sbSelect("users", `email=eq.${encodeURIComponent(info.email)}`);
      let userId;
      if (existing.length) {
        userId = existing[0].id;
        await sbUpdate("users", userId, { name:info.name, avatar:info.picture, provider:"google" });
      } else {
        userId = crypto.randomUUID();
        await sbUpsert("users", { id:userId, email:info.email, name:info.name, avatar:info.picture, provider:"google" });
      }
      const jwt = await signJWT({ sub:userId, email:info.email, name:info.name, avatar:info.picture, exp: Math.floor(Date.now()/1000)+86400*7 });
      return Response.redirect(`${SITE_URL}/#token=${jwt}`);
    }

    return new Response(JSON.stringify({ error:"Unknown action" }), { status:404, headers:CORS });

  } catch(err) {
    console.error("Auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status:500, headers:CORS });
  }
}

export const config = { path: "/api/auth" };
