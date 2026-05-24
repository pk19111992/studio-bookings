// netlify/functions/bookings.mjs

import { neon } from "@netlify/neon";

const sql = neon(process.env.DATABASE_URL);
const JWT_SECRET = process.env.JWT_SECRET || "change-me-in-production";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

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

async function requireAuth(req) {
  const auth = req.headers.get("Authorization") || "";
  const token = auth.replace("Bearer ", "");
  if (!token) throw new Error("Unauthorized");
  return verifyJWT(token);
}

async function ensureTables() {
  await sql`
    CREATE TABLE IF NOT EXISTS units (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      location TEXT NOT NULL DEFAULT 'Gaur City Center, Greater Noida',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  await sql`
    CREATE TABLE IF NOT EXISTS bookings (
      id TEXT PRIMARY KEY,
      unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
      date TEXT NOT NULL,
      guest_name TEXT NOT NULL,
      source TEXT NOT NULL,
      check_in TEXT NOT NULL,
      check_out TEXT NOT NULL,
      amount NUMERIC NOT NULL,
      notes TEXT,
      overflow_to TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )
  `;
  // Seed default units if empty
  const existing = await sql`SELECT id FROM units LIMIT 1`;
  if (!existing.length) {
    await sql`INSERT INTO units (id,name,location) VALUES
      ('unit-1625','Unit 1625','Gaur City Center, Greater Noida'),
      ('unit-1626','Unit 1626','Gaur City Center, Greater Noida')
      ON CONFLICT DO NOTHING`;
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  try {
    const user = await requireAuth(req);
    await ensureTables();

    const url    = new URL(req.url);
    const action = url.searchParams.get("action") || "bookings";
    const method = req.method;

    // ── GET units list ────────────────────────────────────────────────────
    if (action === "units" && method === "GET") {
      const units = await sql`SELECT * FROM units ORDER BY location, name`;
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── POST add unit ─────────────────────────────────────────────────────
    if (action === "units" && method === "POST") {
      const { name, location } = await req.json();
      const id = "unit-" + crypto.randomUUID().slice(0,8);
      await sql`INSERT INTO units (id,name,location) VALUES (${id},${name},${location||"Gaur City Center, Greater Noida"})`;
      const units = await sql`SELECT * FROM units ORDER BY location, name`;
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── GET bookings for a unit ───────────────────────────────────────────
    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });
      const rows = await sql`SELECT * FROM bookings WHERE unit_id=${unitId} ORDER BY date ASC`;
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── POST upsert booking ───────────────────────────────────────────────
    if (action === "bookings" && method === "POST") {
      const b = await req.json();
      await sql`
        INSERT INTO bookings (id,unit_id,date,guest_name,source,check_in,check_out,amount,notes,overflow_to,created_by)
        VALUES (${b.id},${b.unit_id},${b.date},${b.guest_name},${b.source},${b.check_in},${b.check_out},${Number(b.amount)},${b.notes||""},${b.overflow_to||null},${user.email})
        ON CONFLICT (id) DO UPDATE SET
          unit_id    = EXCLUDED.unit_id,
          date       = EXCLUDED.date,
          guest_name = EXCLUDED.guest_name,
          source     = EXCLUDED.source,
          check_in   = EXCLUDED.check_in,
          check_out  = EXCLUDED.check_out,
          amount     = EXCLUDED.amount,
          notes      = EXCLUDED.notes,
          overflow_to= EXCLUDED.overflow_to
      `;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE booking ────────────────────────────────────────────────────
    if (action === "bookings" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error:"id required" }), { status:400, headers:CORS });
      await sql`DELETE FROM bookings WHERE id=${id}`;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Not found" }), { status:404, headers:CORS });

  } catch(err) {
    const status = err.message === "Unauthorized" || err.message === "Invalid token" || err.message === "Token expired" ? 401 : 500;
    return new Response(JSON.stringify({ error:err.message }), { status, headers:CORS });
  }
}

export const config = { path: "/api/bookings" };
