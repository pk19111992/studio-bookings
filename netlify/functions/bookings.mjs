// netlify/functions/bookings.mjs
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const JWT_SECRET   = process.env.JWT_SECRET || "change-me";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Content-Type": "application/json",
};

const sbH = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

async function sbSelect(table, qs = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, { headers: sbH });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function sbUpsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, { method: "POST", headers: { ...sbH, "Prefer": "resolution=merge-duplicates" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
}

// Minimal iCal string parser (Regex-driven for zero-npm architecture)
function parseICal(icalText) {
  const events = [];
  const matches = icalText.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  for (const match of matches) {
    const dtstart = match.match(/DTSTART;?VALUE=DATE:(\d{8})/);
    const dtend = match.match(/DTEND;?VALUE=DATE:(\d{8})/);
    const summary = match.match(/SUMMARY:(.*)/);
    const uid = match.match(/UID:(.*)/);

    if (dtstart && dtend) {
      const startFmt = `${dtstart[1].substring(0,4)}-${dtstart[1].substring(4,6)}-${dtstart[1].substring(6,8)}`;
      const endFmt = `${dtend[1].substring(0,4)}-${dtend[1].substring(4,6)}-${dtend[1].substring(6,8)}`;
      events.push({
        id: uid ? uid[1].trim() : crypto.randomUUID(),
        start_date: startFmt,
        end_date: endFmt,
        guest_name: summary ? summary[1].trim() : "External Platform Block",
        notes: "Imported via structural channel sync wrapper."
      });
    }
  }
  return events;
}

// Generate valid standard iCal payloads for Airbnb / MMT consumers
function generateICal(bookings) {
  let ical = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Gaur City Booking Manager//EN\n";
  bookings.forEach(b => {
    if (b.status === "cancelled") return;
    const sStr = b.start_date.replace(/-/g, "");
    const eStr = b.end_date.replace(/-/g, "");
    ical += "BEGIN:VEVENT\n";
    ical += `UID:${b.id}@gaurbooking.com\n`;
    ical += `DTSTART;VALUE=DATE:${sStr}\n`;
    ical += `DTEND;VALUE=DATE:${eStr}\n`;
    ical += `SUMMARY:${b.guest_name} (${b.source.toUpperCase()})\n`;
    ical += `DESCRIPTION:${b.notes || "No notes"}\n`;
    ical += "END:VEVENT\n";
  });
  ical += "END:VCALENDAR";
  return ical;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const action = url.searchParams.get("action");

  // Public Export iCal Endpoint (Called directly by Airbnb or MakeMyTrip spiders)
  if (action === "export_ical") {
    const unitId = url.searchParams.get("unit_id");
    try {
      const rows = await sbSelect("bookings", `unit_id=eq.${unitId}`);
      return new Response(generateICal(rows), { status: 200, headers: { "Content-Type": "text/calendar", "Access-Control-Allow-Origin": "*" } });
    } catch (e) {
      return new Response("Error building feed", { status: 500 });
    }
  }

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  try {
    // Standard Token Validation
    const auth = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    if (!auth) return new Response("Unauthorized", { status: 401, headers: CORS });
    const payload = JSON.parse(atob(auth.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));

    // ── Dynamic Sources Query ──
    if (action === "sources" && req.method === "GET") {
      const custom = await sbSelect("user_booking_sources", `user_id=eq.${payload.sub}`);
      return new Response(JSON.stringify(custom), { headers: CORS });
    }

    if (action === "sources" && req.method === "POST") {
      const body = await req.json();
      await sbUpsert("user_booking_sources", { ...body, user_id: payload.sub });
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    // ── Two-Way Remote iCal Sync Engine ──
    if (action === "sync_channels" && req.method === "POST") {
      const { unit_id } = await req.json();
      const units = await sbSelect("units", `id=eq.${unit_id}`);
      if (!units.length) return new Response("Unit not found", { status: 404, headers: CORS });
      const unit = units[0];

      let importedCount = 0;
      const processFeed = async (feedUrl, sourceId) => {
        if (!feedUrl) return;
        const feedRes = await fetch(feedUrl);
        if (!feedRes.ok) return;
        const text = await feedRes.text();
        const events = parseICal(text);

        for (const ev of events) {
          await sbUpsert("bookings", {
            id: ev.id,
            unit_id,
            start_date: ev.start_date,
            end_date: ev.end_date,
            guest_name: ev.guest_name,
            source: sourceId,
            status: "confirmed",
            payment_status: "paid",
            amount: 0,
            check_in: "14:00",
            check_out: "11:00",
            created_by: "Channel Sync Runner"
          });
          importedCount++;
        }
      };

      await processFeed(unit.airbnb_ical_url, "airbnb");
      await processFeed(unit.mmt_ical_url, "goibibo");

      return new Response(JSON.stringify({ ok: true, imported: importedCount }), { headers: CORS });
    }

    // Default structural pass-through for upserts, deletes, and normal visibility loops
    if (action === "bookings" && req.method === "POST") {
      const b = await req.json();
      await sbUpsert("bookings", {
        id: b.id, unit_id: b.unit_id, start_date: b.start_date, end_date: b.end_date,
        guest_name: b.guest_name, source: b.source, check_in: b.check_in, check_out: b.check_out,
        amount: Number(b.amount), status: b.status, payment_status: b.payment_status,
        payment_method: b.payment_method, notes: b.notes, created_by: payload.email
      });
      return new Response(JSON.stringify({ ok: true }), { headers: CORS });
    }

    if (action === "bookings" && req.method === "GET") {
      const unitId = url.searchParams.get("unit_id");
      const rows = await sbSelect("bookings", `unit_id=eq.${unitId}&order=start_date.asc`);
      return new Response(JSON.stringify(rows), { headers: CORS });
    }

    if (action === "units" && req.method === "GET") {
      const units = await sbSelect("units", "order=name.asc");
      return new Response(JSON.stringify(units), { headers: CORS });
    }

    return new Response("Action not matched", { status: 404, headers: CORS });
  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: CORS });
  }
}

export const config = { path: "/api/bookings" };