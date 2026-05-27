// netlify/functions/bookings.mjs
// Uses Supabase REST API directly — zero npm dependencies

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET   = process.env.JWT_SECRET || "change-me";
const ADMIN_EMAIL  = "blissfulperch@gmail.com";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

async function sbDelete(table, qs) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { method:"DELETE", headers: sbH });
  if (!res.ok) throw new Error(await res.text());
}

async function sbInsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: { ...sbH, "Prefer": "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

// ── JWT verify ────────────────────────────────────────────────────────────────
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

// ── Visible units for a user ──────────────────────────────────────────────────
async function getVisibleUnitIds(user) {
  if (user.role === "admin") {
    const rows = await sbSelect("units", "select=id");
    return rows.map(r => r.id);
  }
  // Units owned by user
  const owned = await sbSelect("units", `owner_id=eq.${user.sub}&select=id`);
  // Units granted via permissions
  const granted = await sbSelect("unit_permissions", `user_id=eq.${user.sub}&select=unit_id`);
  const ids = [...new Set([...owned.map(r=>r.id), ...granted.map(r=>r.unit_id)])];
  return ids;
}

async function getVisibleUnits(user) {
  if (user.role === "admin") {
    return sbSelect("units", "order=location.asc,name.asc");
  }
  const ids = await getVisibleUnitIds(user);
  if (!ids.length) return [];
  return sbSelect("units", `id=in.(${ids.join(",")})&order=location.asc,name.asc`);
}

// ── Seed default units if none exist ─────────────────────────────────────────
async function seedDefaultUnits(adminUserId) {
  const existing = await sbSelect("units", "id=in.(unit-1625,unit-1626)&select=id");
  if (!existing.length) {
    await sbUpsert("units", [
      { id:"unit-1625", name:"Unit 1625", location:"Gaur City Center, Greater Noida", owner_id:adminUserId },
      { id:"unit-1626", name:"Unit 1626", location:"Gaur City Center, Greater Noida", owner_id:adminUserId },
    ]);
  }
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  try {
    const user   = await requireAuth(req);
    const url    = new URL(req.url);
    const action = url.searchParams.get("action") || "bookings";
    const method = req.method;

    // Seed default units once
    if (user.role === "admin") {
      try { await seedDefaultUnits(user.sub); } catch(_) {}
    }

    // ── GET units ───────────────────────────────────────────────────────────
    if (action === "units" && method === "GET") {
      const units = await getVisibleUnits(user);
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── POST add unit ───────────────────────────────────────────────────────
    if (action === "units" && method === "POST") {
      const { name, location } = await req.json();
      const id = "unit-" + crypto.randomUUID().slice(0,8);
      await sbUpsert("units", { id, name, location:location||"", owner_id:user.sub });
      const units = await getVisibleUnits(user);
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // ── GET all users (admin only) ──────────────────────────────────────────
    if (action === "users" && method === "GET") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const users = await sbSelect("users", "select=id,email,name,avatar,role,created_at&order=created_at.desc");
      return new Response(JSON.stringify(users), { headers:CORS });
    }

    // ── GET permissions for a unit (admin only) ─────────────────────────────
    if (action === "permissions" && method === "GET") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const unitId = url.searchParams.get("unit_id");
      // Get permissions then enrich with user details
      const perms = await sbSelect("unit_permissions", `unit_id=eq.${unitId}`);
      if (!perms.length) return new Response(JSON.stringify([]), { headers:CORS });
      const userIds = perms.map(p=>p.user_id).join(",");
      const users2  = await sbSelect("users", `id=in.(${userIds})&select=id,email,name,avatar`);
      const userMap = Object.fromEntries(users2.map(u=>[u.id,u]));
      const enriched = perms.map(p=>({ ...p, ...userMap[p.user_id] }));
      return new Response(JSON.stringify(enriched), { headers:CORS });
    }

    // ── POST grant permission (admin only) ──────────────────────────────────
    if (action === "permissions" && method === "POST") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const { unit_id, user_id } = await req.json();
      const id = crypto.randomUUID();
      try {
        await sbInsert("unit_permissions", { id, unit_id, user_id, granted_by:user.sub });
      } catch(e) {
        if (e.message.includes("unique") || e.message.includes("duplicate")) {
          return new Response(JSON.stringify({ ok:true }), { headers:CORS }); // already granted
        }
        throw e;
      }
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE permission (admin only) ──────────────────────────────────────
    if (action === "permissions" && method === "DELETE") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const unit_id = url.searchParams.get("unit_id");
      const user_id = url.searchParams.get("user_id");
      await sbDelete("unit_permissions", `unit_id=eq.${unit_id}&user_id=eq.${user_id}`);
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── GET bookings for a unit ─────────────────────────────────────────────
    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });
      const visibleIds = await getVisibleUnitIds(user);
      if (!visibleIds.includes(unitId)) return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const rows = await sbSelect("bookings", `unit_id=eq.${unitId}&order=date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── GET stats ───────────────────────────────────────────────────────────
    if (action === "stats" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      const month  = url.searchParams.get("month"); // YYYY-MM
      const monthFilter = month ? `&date=like.${month}*` : "";
      if (unitId) {
        const rows = await sbSelect("bookings", `unit_id=eq.${unitId}${monthFilter}&order=date.asc`);
        return new Response(JSON.stringify(rows), { headers:CORS });
      }
      const visibleIds = await getVisibleUnitIds(user);
      if (!visibleIds.length) return new Response(JSON.stringify([]), { headers:CORS });
      const rows = await sbSelect("bookings", `unit_id=in.(${visibleIds.join(",")})${monthFilter}&order=date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── POST upsert booking ─────────────────────────────────────────────────
    if (action === "bookings" && method === "POST") {
      const b = await req.json();
      await sbUpsert("bookings", {
        id:          b.id,
        unit_id:     b.unit_id,
        date:        b.date,
        guest_name:  b.guest_name,
        source:      b.source,
        check_in:    b.check_in,
        check_out:   b.check_out,
        amount:      Number(b.amount),
        notes:       b.notes||"",
        overflow_to: b.overflow_to||null,
        created_by:  user.email,
      });
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE booking ──────────────────────────────────────────────────────
    if (action === "bookings" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error:"id required" }), { status:400, headers:CORS });
      await sbDelete("bookings", `id=eq.${id}`);
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Not found" }), { status:404, headers:CORS });

  } catch(err) {
    const status = ["Unauthorized","Invalid token","Token expired"].includes(err.message) ? 401 : 500;
    return new Response(JSON.stringify({ error: err.message }), { status, headers:CORS });
  }
}

export const config = { path: "/api/bookings" };
