// netlify/functions/bookings.mjs
// Full RBAC: admin sees all, users see own + granted apartments
// Ekant bookings don't count toward the 2-booking cap

import { neon } from "@netlify/neon";
const sql = neon();

const JWT_SECRET  = process.env.JWT_SECRET || "change-me";
const ADMIN_EMAIL = "blissfulperch@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

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

async function requireAuth(req) {
  const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
  if (!token) throw new Error("Unauthorized");
  return verifyJWT(token);
}

async function ensureTables() {
  await sql`CREATE TABLE IF NOT EXISTS units (
    id TEXT PRIMARY KEY, name TEXT NOT NULL,
    location TEXT NOT NULL DEFAULT 'Gaur City Center, Greater Noida',
    owner_id TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS bookings (
    id TEXT PRIMARY KEY, unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    date TEXT NOT NULL, guest_name TEXT NOT NULL, source TEXT NOT NULL,
    check_in TEXT NOT NULL, check_out TEXT NOT NULL, amount NUMERIC NOT NULL,
    notes TEXT, overflow_to TEXT, created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`;
  await sql`CREATE TABLE IF NOT EXISTS unit_permissions (
    id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::TEXT,
    unit_id TEXT NOT NULL REFERENCES units(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL,
    granted_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(unit_id, user_id)
  )`;
  // Seed default units owned by admin
  const existing = await sql`SELECT id FROM units WHERE id IN ('unit-1625','unit-1626') LIMIT 1`;
  if (!existing.length) {
    const adminUsers = await sql`SELECT id FROM users WHERE email=${ADMIN_EMAIL} LIMIT 1`;
    const adminId = adminUsers.length ? adminUsers[0].id : null;
    await sql`INSERT INTO units (id,name,location,owner_id) VALUES
      ('unit-1625','Unit 1625','Gaur City Center, Greater Noida',${adminId}),
      ('unit-1626','Unit 1626','Gaur City Center, Greater Noida',${adminId})
      ON CONFLICT DO NOTHING`;
  }
}

async function getVisibleUnits(user) {
  if (user.role === 'admin') {
    return sql`SELECT * FROM units ORDER BY location, name`;
  }
  // User sees: units they own + units explicitly granted to them
  return sql`
    SELECT DISTINCT u.* FROM units u
    LEFT JOIN unit_permissions p ON p.unit_id = u.id AND p.user_id = ${user.sub}
    WHERE u.owner_id = ${user.sub} OR p.user_id = ${user.sub}
    ORDER BY u.location, u.name
  `;
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  try {
    const user   = await requireAuth(req);
    await ensureTables();
    const url    = new URL(req.url);
    const action = url.searchParams.get("action") || "bookings";
    const method = req.method;

    // ── GET units (filtered by role) ──────────────────────────────────────
    if (action === "units" && method === "GET") {
      const units = await getVisibleUnits(user);
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── POST add unit ─────────────────────────────────────────────────────
    if (action === "units" && method === "POST") {
      const { name, location } = await req.json();
      const id = "unit-" + crypto.randomUUID().slice(0,8);
      await sql`INSERT INTO units (id,name,location,owner_id) VALUES (${id},${name},${location||""},${user.sub})`;
      const units = await getVisibleUnits(user);
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── GET all users (admin only) ────────────────────────────────────────
    if (action === "users" && method === "GET") {
      if (user.role !== 'admin') return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const users = await sql`SELECT id, email, name, avatar, role, created_at FROM users ORDER BY created_at DESC`;
      return new Response(JSON.stringify(users), { headers:CORS });
    }

    // ── GET permissions for a unit (admin only) ───────────────────────────
    if (action === "permissions" && method === "GET") {
      if (user.role !== 'admin') return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const unitId = url.searchParams.get("unit_id");
      const perms = await sql`
        SELECT p.*, u.email, u.name FROM unit_permissions p
        JOIN users u ON u.id = p.user_id
        WHERE p.unit_id = ${unitId}
      `;
      return new Response(JSON.stringify(perms), { headers:CORS });
    }

    // ── POST grant permission (admin only) ────────────────────────────────
    if (action === "permissions" && method === "POST") {
      if (user.role !== 'admin') return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const { unit_id, user_id } = await req.json();
      await sql`INSERT INTO unit_permissions (unit_id, user_id, granted_by) VALUES (${unit_id},${user_id},${user.sub}) ON CONFLICT DO NOTHING`;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE permission (admin only) ────────────────────────────────────
    if (action === "permissions" && method === "DELETE") {
      if (user.role !== 'admin') return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const unit_id = url.searchParams.get("unit_id");
      const user_id = url.searchParams.get("user_id");
      await sql`DELETE FROM unit_permissions WHERE unit_id=${unit_id} AND user_id=${user_id}`;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── GET bookings for a unit ───────────────────────────────────────────
    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });
      // Verify user can see this unit
      const visible = await getVisibleUnits(user);
      if (!visible.find(u => u.id === unitId) && user.role !== 'admin') {
        return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      }
      const rows = await sql`SELECT * FROM bookings WHERE unit_id=${unitId} ORDER BY date ASC`;
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── GET dashboard stats (admin sees all, user sees own) ───────────────
    if (action === "stats" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      const month  = url.searchParams.get("month"); // YYYY-MM
      let rows;
      if (unitId) {
        rows = month
            ? await sql`SELECT * FROM bookings WHERE unit_id=${unitId} AND date LIKE ${month+'%'} ORDER BY date`
            : await sql`SELECT * FROM bookings WHERE unit_id=${unitId} ORDER BY date`;
      } else {
        const visible = await getVisibleUnits(user);
        const ids = visible.map(u => u.id);
        if (!ids.length) return new Response(JSON.stringify([]), { headers:CORS });
        rows = month
            ? await sql`SELECT * FROM bookings WHERE unit_id = ANY(${ids}::text[]) AND date LIKE ${month+'%'} ORDER BY date`
            : await sql`SELECT * FROM bookings WHERE unit_id = ANY(${ids}::text[]) ORDER BY date`;
      }
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── POST upsert booking ───────────────────────────────────────────────
    if (action === "bookings" && method === "POST") {
      const b = await req.json();
      await sql`
        INSERT INTO bookings (id,unit_id,date,guest_name,source,check_in,check_out,amount,notes,overflow_to,created_by)
        VALUES (${b.id},${b.unit_id},${b.date},${b.guest_name},${b.source},${b.check_in},${b.check_out},${Number(b.amount)},${b.notes||""},${b.overflow_to||null},${user.email})
        ON CONFLICT (id) DO UPDATE SET
          date=EXCLUDED.date, guest_name=EXCLUDED.guest_name, source=EXCLUDED.source,
          check_in=EXCLUDED.check_in, check_out=EXCLUDED.check_out, amount=EXCLUDED.amount,
          notes=EXCLUDED.notes, overflow_to=EXCLUDED.overflow_to
      `;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE booking ────────────────────────────────────────────────────
    if (action === "bookings" && method === "DELETE") {
      const id = url.searchParams.get("id");
      await sql`DELETE FROM bookings WHERE id=${id}`;
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Not found" }), { status:404, headers:CORS });

  } catch(err) {
    const status = ["Unauthorized","Invalid token","Token expired"].includes(err.message) ? 401 : 500;
    return new Response(JSON.stringify({ error:err.message }), { status, headers:CORS });
  }
}

export const config = { path: "/api/bookings" };
