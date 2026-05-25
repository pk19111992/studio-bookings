// netlify/functions/bookings.mjs
// Uses Supabase REST API directly — no npm packages needed for DB

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET   = process.env.JWT_SECRET || "change-me-in-production";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
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

async function sbDelete(table, id) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: "DELETE",
    headers: sbHeaders,
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── JWT verify ────────────────────────────────────────────────────────────────
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
  const token = (req.headers.get("Authorization")||"").replace("Bearer ","");
  if (!token) throw new Error("Unauthorized");
  return verifyJWT(token);
}

// ── Seed default units if none exist ─────────────────────────────────────────
async function seedUnits() {
  const existing = await sbSelect("units", "select=id&limit=1");
  if (!existing.length) {
    await sbUpsert("units", [
      { id:"unit-1625", name:"Unit 1625", location:"Gaur City Center, Greater Noida" },
      { id:"unit-1626", name:"Unit 1626", location:"Gaur City Center, Greater Noida" },
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

    // GET units
    if (action === "units" && method === "GET") {
      await seedUnits();
      const units = await sbSelect("units", "order=location.asc,name.asc");
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // POST add unit
    if (action === "units" && method === "POST") {
      const { name, location } = await req.json();
      const id = "unit-" + crypto.randomUUID().slice(0,8);
      await sbUpsert("units", { id, name, location: location || "Gaur City Center, Greater Noida" });
      const units = await sbSelect("units", "order=location.asc,name.asc");
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    // GET bookings for a unit
    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });
      const rows = await sbSelect("bookings", `unit_id=eq.${unitId}&order=date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // POST upsert booking
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
        notes:       b.notes || "",
        overflow_to: b.overflow_to || null,
        created_by:  user.email,
      });
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // DELETE booking
    if (action === "bookings" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error:"id required" }), { status:400, headers:CORS });
      await sbDelete("bookings", id);
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Not found" }), { status:404, headers:CORS });

  } catch(err) {
    const status = ["Unauthorized","Invalid token","Token expired"].includes(err.message) ? 401 : 500;
    return new Response(JSON.stringify({ error:err.message }), { status, headers:CORS });
  }
}

export const config = { path: "/api/bookings" };
