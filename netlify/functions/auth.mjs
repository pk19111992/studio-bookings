// netlify/functions/auth.mjs
// Handles: Google OAuth initiation, OAuth callback, password login, token verify, logout

import { neon } from "@netlify/neon";

const sql = neon(process.env.DATABASE_URL);

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

// ── Minimal JWT (HS256) without external deps ─────────────────────────────────
function base64url(str) {
  return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,"");
}
function base64urlFromUint8(arr) {
  return base64url(String.fromCharCode(...arr));
}
async function signJWT(payload) {
  const header  = base64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
  const body    = base64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000) }));
  const msg     = `${header}.${body}`;
  const key     = await crypto.subtle.importKey("raw", new TextEncoder().encode(JWT_SECRET), { name:"HMAC", hash:"SHA-256" }, false, ["sign"]);
  const sig     = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg));
  return `${msg}.${base64urlFromUint8(new Uint8Array(sig))}`;
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

// ── Simple password hash (SHA-256) ───────────────────────────────────────────
async function hashPassword(password) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password + JWT_SECRET));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2,"0")).join("");
}

// ── DB setup ─────────────────────────────────────────────────────────────────
async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      name TEXT,
      avatar TEXT,
      password_hash TEXT,
      provider TEXT DEFAULT 'password',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");

  try {
    await ensureTables();

    // ── Verify token (used by frontend on load) ───────────────────────────
    if (action === "verify") {
      const auth = req.headers.get("Authorization") || "";
      const token = auth.replace("Bearer ","");
      if (!token) return new Response(JSON.stringify({ error:"No token" }), { status:401, headers:CORS });
      const payload = await verifyJWT(token);
      return new Response(JSON.stringify({ user: payload }), { headers:CORS });
    }

    // ── Password login ────────────────────────────────────────────────────
    if (action === "login" && req.method === "POST") {
      const { email, password } = await req.json();
      if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });

      const hash  = await hashPassword(password);
      const users = await sql`SELECT * FROM users WHERE email=${email.toLowerCase()} AND password_hash=${hash} AND provider='password'`;
      if (!users.length) return new Response(JSON.stringify({ error:"Invalid email or password" }), { status:401, headers:CORS });

      const user  = users[0];
      const token = await signJWT({ sub:user.id, email:user.email, name:user.name, avatar:user.avatar, exp: Math.floor(Date.now()/1000) + 86400*7 });
      return new Response(JSON.stringify({ token, user:{ id:user.id, email:user.email, name:user.name, avatar:user.avatar } }), { headers:CORS });
    }

    // ── Password register (first-time / admin creates users) ─────────────
    if (action === "register" && req.method === "POST") {
      const { email, password, name } = await req.json();
      if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });

      // Check if any user exists — first user becomes admin freely; after that, require existing token
      const count = await sql`SELECT COUNT(*) as c FROM users`;
      if (parseInt(count[0].c) > 0) {
        const auth = req.headers.get("Authorization")||"";
        try { await verifyJWT(auth.replace("Bearer ","")); }
        catch { return new Response(JSON.stringify({ error:"Only existing users can add new users" }), { status:403, headers:CORS }); }
      }

      const id   = crypto.randomUUID();
      const hash = await hashPassword(password);
      try {
        await sql`INSERT INTO users (id,email,name,password_hash,provider) VALUES (${id},${email.toLowerCase()},${name||email},${hash},'password')`;
      } catch(e) {
        if (e.message.includes("unique")) return new Response(JSON.stringify({ error:"Email already registered" }), { status:409, headers:CORS });
        throw e;
      }
      const token = await signJWT({ sub:id, email:email.toLowerCase(), name:name||email, exp: Math.floor(Date.now()/1000)+86400*7 });
      return new Response(JSON.stringify({ token, user:{ id, email:email.toLowerCase(), name:name||email } }), { headers:CORS });
    }

    // ── Google OAuth — Step 1: redirect to Google ─────────────────────────
    if (action === "google") {
      if (!GOOGLE_CLIENT_ID) return new Response(JSON.stringify({ error:"Google OAuth not configured" }), { status:500, headers:CORS });
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

    // ── Google OAuth — Step 2: handle callback ────────────────────────────
    if (action === "callback") {
      const code = url.searchParams.get("code");
      if (!code) return Response.redirect(`${SITE_URL}?error=oauth_denied`);

      // Exchange code for tokens
      const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type":"application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code, client_id: GOOGLE_CLIENT_ID, client_secret: GOOGLE_CLIENT_SECRET,
          redirect_uri: `${SITE_URL}/api/auth?action=callback`, grant_type: "authorization_code",
        }),
      });
      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) return Response.redirect(`${SITE_URL}?error=oauth_failed`);

      // Get user info
      const infoRes  = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers: { Authorization:`Bearer ${tokenData.access_token}` } });
      const info     = await infoRes.json();

      // Upsert user in DB
      const existing = await sql`SELECT * FROM users WHERE email=${info.email}`;
      let userId;
      if (existing.length) {
        userId = existing[0].id;
        await sql`UPDATE users SET name=${info.name}, avatar=${info.picture}, provider='google' WHERE id=${userId}`;
      } else {
        userId = crypto.randomUUID();
        await sql`INSERT INTO users (id,email,name,avatar,provider) VALUES (${userId},${info.email},${info.name},${info.picture},'google')`;
      }

      const jwt = await signJWT({ sub:userId, email:info.email, name:info.name, avatar:info.picture, exp: Math.floor(Date.now()/1000)+86400*7 });
      // Redirect back to app with token in hash (never in query string)
      return Response.redirect(`${SITE_URL}/#token=${jwt}`);
    }

    return new Response(JSON.stringify({ error:"Unknown action" }), { status:404, headers:CORS });

  } catch(err) {
    console.error("Auth error:", err);
    return new Response(JSON.stringify({ error: err.message }), { status:500, headers:CORS });
  }
}

export const config = { path: "/api/auth" };
