// netlify/functions/bookings.mjs
// Full booking management: multi-night, guest details, payment tracking

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET   = process.env.JWT_SECRET || "change-me";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

const sbH = {
  "Content-Type":  "application/json",
  "apikey":        SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
};

async function sb(table, qs = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: sbH });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function sbPost(table, body, prefer = "") {
  const h = prefer ? { ...sbH, "Prefer": prefer } : sbH;
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method:"POST", headers:h, body:JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return prefer.includes("return=representation") ? res.json() : null;
}
async function sbUpsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, { method:"POST", headers:{ ...sbH, "Prefer":"resolution=merge-duplicates" }, body:JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
}
async function sbPatch(table, qs, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { method:"PATCH", headers:sbH, body:JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
}
async function sbDel(table, qs) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { method:"DELETE", headers:sbH });
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
  if (user.role === "admin") return (await sb("units","select=id")).map(r=>r.id);
  const owned   = await sb("units", `owner_id=eq.${user.sub}&select=id`);
  const granted = await sb("unit_permissions", `user_id=eq.${user.sub}&select=unit_id`);
  return [...new Set([...owned.map(r=>r.id), ...granted.map(r=>r.unit_id)])];
}
async function getVisibleUnits(user) {
  if (user.role === "admin") return sb("units","order=location.asc,name.asc");
  const ids = await getVisibleUnitIds(user);
  if (!ids.length) return [];
  return sb("units", `id=in.(${ids.join(",")})&order=location.asc,name.asc`);
}

function calcNights(checkin, checkout) {
  const a = new Date(checkin), b = new Date(checkout);
  const n = Math.round((b - a) / 86400000);
  return Math.max(n, 1);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });
  try {
    const user   = await requireAuth(req);
    const url    = new URL(req.url);
    const action = url.searchParams.get("action") || "bookings";
    const method = req.method;

    // ── Units ─────────────────────────────────────────────────────────────
    if (action === "units" && method === "GET") {
      if (user.role === "admin") {
        const existing = await sb("units","id=in.(unit-1625,unit-1626)&select=id");
        if (!existing.length) {
          await sbUpsert("units", [
            { id:"unit-1625", name:"Unit 1625", location:"Gaur City Center, Greater Noida", owner_id:user.sub },
            { id:"unit-1626", name:"Unit 1626", location:"Gaur City Center, Greater Noida", owner_id:user.sub },
          ]);
        }
      }
      return new Response(JSON.stringify(await getVisibleUnits(user)), { headers:CORS });
    }
    if (action === "units" && method === "POST") {
      const { name, location } = await req.json();
      await sbUpsert("units", { id:"unit-"+crypto.randomUUID().slice(0,8), name, location:location||"", owner_id:user.sub });
      return new Response(JSON.stringify(await getVisibleUnits(user)), { headers:CORS });
    }

    // ── Users (admin) ─────────────────────────────────────────────────────
    if (action === "users" && method === "GET") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      return new Response(JSON.stringify(await sb("users","select=id,email,name,avatar,role,created_at&order=created_at.desc")), { headers:CORS });
    }

    // ── Permissions ───────────────────────────────────────────────────────
    if (action === "permissions") {
      if (user.role !== "admin") return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      if (method === "GET") {
        const uid = url.searchParams.get("unit_id");
        const perms = await sb("unit_permissions", `unit_id=eq.${uid}`);
        if (!perms.length) return new Response(JSON.stringify([]), { headers:CORS });
        const uids  = perms.map(p=>p.user_id).join(",");
        const users = await sb("users", `id=in.(${uids})&select=id,email,name,avatar`);
        const map   = Object.fromEntries(users.map(u=>[u.id,u]));
        return new Response(JSON.stringify(perms.map(p=>({...p,...map[p.user_id]}))), { headers:CORS });
      }
      if (method === "POST") {
        const { unit_id, user_id } = await req.json();
        try { await sbPost("unit_permissions", { id:crypto.randomUUID(), unit_id, user_id, granted_by:user.sub }, "return=minimal"); } catch(_) {}
        return new Response(JSON.stringify({ ok:true }), { headers:CORS });
      }
      if (method === "DELETE") {
        await sbDel("unit_permissions", `unit_id=eq.${url.searchParams.get("unit_id")}&user_id=eq.${url.searchParams.get("user_id")}`);
        return new Response(JSON.stringify({ ok:true }), { headers:CORS });
      }
    }

    // ── GET bookings ──────────────────────────────────────────────────────
    if (action === "bookings" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:CORS });
      const visible = await getVisibleUnitIds(user);
      if (!visible.includes(unitId)) return new Response(JSON.stringify({ error:"Forbidden" }), { status:403, headers:CORS });
      const rows = await sb("bookings", `unit_id=eq.${unitId}&order=checkin_date.asc`);
      return new Response(JSON.stringify(rows), { headers:CORS });
    }

    // ── GET stats ─────────────────────────────────────────────────────────
    if (action === "stats" && method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      const month  = url.searchParams.get("month");
      const mf     = month ? `&checkin_date=like.${month}*` : "";
      if (unitId) {
        return new Response(JSON.stringify(await sb("bookings", `unit_id=eq.${unitId}${mf}&order=checkin_date.asc`)), { headers:CORS });
      }
      const ids = await getVisibleUnitIds(user);
      if (!ids.length) return new Response(JSON.stringify([]), { headers:CORS });
      return new Response(JSON.stringify(await sb("bookings", `unit_id=in.(${ids.join(",")})${mf}&order=checkin_date.asc`)), { headers:CORS });
    }

    // ── POST upsert booking ───────────────────────────────────────────────
    if (action === "bookings" && method === "POST") {
      const b = await req.json();
      const nights  = calcNights(b.checkin_date, b.checkout_date === b.checkin_date ? addDays(b.checkout_date,1) : b.checkout_date);
      await sbUpsert("bookings", {
        id:                     b.id,
        unit_id:                b.unit_id,
        checkin_date:           b.checkin_date,
        checkout_date:          b.checkout_date,
        nights,
        guest_name:             b.guest_name,
        guest_phone:            b.guest_phone||null,
        guest_email:            b.guest_email||null,
        guest_id_type:          b.guest_id_type||null,
        guest_id_number:        b.guest_id_number||null,
        num_guests:             Number(b.num_guests)||1,
        source:                 b.source,
        check_in_time:          b.check_in_time||"14:00",
        check_out_time:         b.check_out_time||"11:00",
        status:                 b.status||"confirmed",
        amount_per_night:       parseFloat(b.amount_per_night)||0,
        total_amount:           parseFloat(b.total_amount)||0,
        paid_amount:            parseFloat(b.paid_amount)||0,
        payment_method:         b.payment_method||null,
        payment_status:         b.payment_status||"pending",
        security_deposit:       parseFloat(b.security_deposit)||0,
        deposit_returned:       b.deposit_returned||false,
        platform_commission_pct: 0,
        platform_commission_amt: 0,
        overflow_to:            b.overflow_to||null,
        notes:                  b.notes||"",
        special_requests:       b.special_requests||"",
        created_by:             user.email,
        updated_at:             new Date().toISOString(),
      });
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── PATCH booking (status / payment update) ───────────────────────────
    if (action === "bookings" && method === "PATCH") {
      const id   = url.searchParams.get("id");
      const body = await req.json();
      await sbPatch("bookings", `id=eq.${id}`, { ...body, updated_at: new Date().toISOString() });
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    // ── DELETE booking ────────────────────────────────────────────────────
    if (action === "bookings" && method === "DELETE") {
      const id = url.searchParams.get("id");
      if (!id) return new Response(JSON.stringify({ error:"id required" }), { status:400, headers:CORS });
      await sbDel("bookings", `id=eq.${id}`);
      return new Response(JSON.stringify({ ok:true }), { headers:CORS });
    }

    return new Response(JSON.stringify({ error:"Not found" }), { status:404, headers:CORS });
  } catch(err) {
    const status = ["Unauthorized","Invalid token","Token expired"].includes(err.message) ? 401 : 500;
    return new Response(JSON.stringify({ error:err.message }), { status, headers:CORS });
  }
}
export const config = { path: "/api/bookings" };
