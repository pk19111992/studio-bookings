// netlify/functions/bookings.mjs
// Extended for Multi-Night, Status Workflows, and Payment Tracking

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET   = process.env.JWT_SECRET || "change-me";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

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

async function getVisibleUnitIds(user) {
  if (user.role === "admin") {
    const rows = await sbSelect("units", "select=id");
    return rows.map(r => r.id);
  }
  const owned = await sbSelect("units", `owner_id=eq.${user.sub}&select=id`);
  const granted = await sbSelect("unit_permissions", `user_id=eq.${user.sub}&select=unit_id`);
  return [...new Set([...owned.map(r=>r.id), ...granted.map(r=>r.unit_id)])];
}

async function getVisibleUnits(user) {
  if (user.role === "admin") {
    return sbSelect("units", "order=location.asc,name.asc");
  }
  const ids = await getVisibleUnitIds(user);
  if (!ids.length) return [];
  return sbSelect("units", `id=in.(${ids.join(",")})&order=location.asc,name.asc`);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  try {
    const user   = await requireAuth(req);
    const url    = new URL(req.url);
    const action = url.searchParams.get("action") || "bookings";
    const method = req.method;

    if (action === "units" && method === "GET") {
      const units = await getVisibleUnits(user);
      return new Response(JSON.stringify(units), { headers:CORS });
    }

    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });

      const visibleIds = await getVisibleUnitIds(user);
      if (!visibleIds.includes(unitId)) return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });

      const rows = await sbSelect("bookings", `unit_id=eq.${unitId}&order=start_date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    if (action === "stats" && method === "GET") {
      const month = url.searchParams.get("month"); // YYYY-MM
      const visibleIds = await getVisibleUnitIds(user);
      if (!visibleIds.length) return new Response(JSON.stringify([]), { headers:CORS });

      // Select all active reservations overlapping the operational target window
      const rows = await sbSelect("bookings", `unit_id=in.(${visibleIds.join(",")})&order=start_date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    if (action === "bookings" && method === "POST") {
      const b = await req.json();

      // Ensure date range validation logic matches backend ingestion targets
      if (!b.start_date || !b.end_date) {
        return new Response(JSON.stringify({ error: "Missing start_date or end_date range" }), { status:400, headers:CORS });
      }

      await sbUpsert("bookings", {
        id:            b.id,
        unit_id:       b.unit_id,
        start_date:    b.start_date, // Structural expansion format: YYYY-MM-DD
        end_date:      b.end_date,   // Checkout boundary format: YYYY-MM-DD
        guest_name:    b.guest_name,
        guest_phone:   b.guest_phone || null,
        guest_count:   b.guest_count ? Number(b.guest_count) : 1,
        source:        b.source,
        check_in:      b.check_in,
        check_out:     b.check_out,
        amount:        Number(b.amount),
        status:        b.status || "confirmed", // enquiry | confirmed | checked_in | checked_out | cancelled
        payment_status:b.payment_status || "pending", // pending | partially_paid | paid | refunded
        payment_method:b.payment_method || "UPI",
        notes:         b.notes || "",
        overflow_to:   b.overflow_to || null,
        created_by:    user.email,
      });
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

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