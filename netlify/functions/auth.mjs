// netlify/functions/auth.mjs
// Open registration — all users get 'user' role by default
// blissfulperch@gmail.com is seeded as admin

import { neon } from "@netlify/neon";
const sql = neon();

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const JWT_SECRET           = process.env.JWT_SECRET || "change-me";
const SITE_URL             = process.env.SITE_URL   || "http://localhost:8888";
const ADMIN_EMAIL          = "blissfulperch@gmail.com";

const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Content-Type": "application/json",
};

function b64url(str) { return btoa(str).replace(/\+/g,"-").replace(/\//g,"_").replace(/=/g,""); }

async function signJWT(payload) {
    const h = b64url(JSON.stringify({ alg:"HS256", typ:"JWT" }));
    const b = b64url(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000) }));
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

async function ensureTables() {
    await sql`CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT, avatar TEXT,
    password_hash TEXT, provider TEXT DEFAULT 'password', role TEXT DEFAULT 'user',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
    // Ensure admin user has admin role
    await sql`UPDATE users SET role='admin' WHERE email=${ADMIN_EMAIL}`;
}

function makeToken(user) {
    return signJWT({ sub:user.id, email:user.email, name:user.name, avatar:user.avatar||null, role:user.role||'user', exp: Math.floor(Date.now()/1000)+86400*7 });
}

export default async function handler(req) {
    if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });
    const url    = new URL(req.url);
    const action = url.searchParams.get("action");
    try {
        await ensureTables();

        if (action === "verify") {
            const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
            if (!token) return new Response(JSON.stringify({ error:"No token" }), { status:401, headers:CORS });
            const payload = await verifyJWT(token);
            // Re-fetch role from DB in case it changed
            const users = await sql`SELECT role FROM users WHERE id=${payload.sub}`;
            const role = users.length ? users[0].role : payload.role;
            return new Response(JSON.stringify({ user: { ...payload, role } }), { headers:CORS });
        }

        if (action === "login" && req.method === "POST") {
            const { email, password } = await req.json();
            const hash  = await hashPassword(password);
            const users = await sql`SELECT * FROM users WHERE email=${email.toLowerCase()} AND password_hash=${hash} AND provider='password'`;
            if (!users.length) return new Response(JSON.stringify({ error:"Invalid email or password" }), { status:401, headers:CORS });
            const token = await makeToken(users[0]);
            return new Response(JSON.stringify({ token, user:{ id:users[0].id, email:users[0].email, name:users[0].name, avatar:users[0].avatar, role:users[0].role } }), { headers:CORS });
        }

        // Open registration — no restrictions
        if (action === "register" && req.method === "POST") {
            const { email, password, name } = await req.json();
            if (!email || !password) return new Response(JSON.stringify({ error:"Email and password required" }), { status:400, headers:CORS });
            if (password.length < 6) return new Response(JSON.stringify({ error:"Password must be at least 6 characters" }), { status:400, headers:CORS });
            const id   = crypto.randomUUID();
            const hash = await hashPassword(password);
            const role = email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
            try {
                await sql`INSERT INTO users (id,email,name,password_hash,provider,role) VALUES (${id},${email.toLowerCase()},${name||email},${hash},'password',${role})`;
            } catch(e) {
                if (e.message.includes("unique")) return new Response(JSON.stringify({ error:"Email already registered" }), { status:409, headers:CORS });
                throw e;
            }
            const newUser = { id, email:email.toLowerCase(), name:name||email, avatar:null, role };
            const token = await makeToken(newUser);
            return new Response(JSON.stringify({ token, user:newUser }), { headers:CORS });
        }

        if (action === "google") {
            if (!GOOGLE_CLIENT_ID) return new Response(JSON.stringify({ error:"GOOGLE_CLIENT_ID not configured" }), { status:500, headers:CORS });
            const params = new URLSearchParams({ client_id:GOOGLE_CLIENT_ID, redirect_uri:`${SITE_URL}/api/auth?action=callback`, response_type:"code", scope:"openid email profile", access_type:"online", prompt:"select_account" });
            return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
        }

        if (action === "callback") {
            const code = url.searchParams.get("code");
            if (!code) return Response.redirect(`${SITE_URL}?error=oauth_denied`);
            const tokenRes  = await fetch("https://oauth2.googleapis.com/token", { method:"POST", headers:{"Content-Type":"application/x-www-form-urlencoded"}, body: new URLSearchParams({ code, client_id:GOOGLE_CLIENT_ID, client_secret:GOOGLE_CLIENT_SECRET, redirect_uri:`${SITE_URL}/api/auth?action=callback`, grant_type:"authorization_code" }) });
            const tokenData = await tokenRes.json();
            if (!tokenData.access_token) return Response.redirect(`${SITE_URL}?error=oauth_failed`);
            const info = await (await fetch("https://www.googleapis.com/oauth2/v2/userinfo", { headers:{ Authorization:`Bearer ${tokenData.access_token}` } })).json();
            const role = info.email.toLowerCase() === ADMIN_EMAIL ? 'admin' : 'user';
            const existing = await sql`SELECT * FROM users WHERE email=${info.email}`;
            let user;
            if (existing.length) {
                await sql`UPDATE users SET name=${info.name}, avatar=${info.picture}, provider='google', role=${role} WHERE id=${existing[0].id}`;
                user = { ...existing[0], name:info.name, avatar:info.picture, role };
            } else {
                const id = crypto.randomUUID();
                await sql`INSERT INTO users (id,email,name,avatar,provider,role) VALUES (${id},${info.email},${info.name},${info.picture},'google',${role})`;
                user = { id, email:info.email, name:info.name, avatar:info.picture, role };
            }
            const jwt = await makeToken(user);
            return Response.redirect(`${SITE_URL}/#token=${jwt}`);
        }

        // Admin: list all users
        if (action === "users" && req.method === "GET") {
            const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
            const payload = await verifyJWT(token);
            if (payload.role !== 'admin') return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
            const users = await sql`SELECT id, email, name, avatar, role, created_at FROM users ORDER BY created_at DESC`;
            return new Response(JSON.stringify(users), { headers:CORS });
        }

        return new Response(JSON.stringify({ error:"Unknown action" }), { status:404, headers:CORS });
    } catch(err) {
        console.error("Auth error:", err);
        return new Response(JSON.stringify({ error: err.message }), { status:500, headers:CORS });
    }
}

export const config = { path: "/api/auth" };
