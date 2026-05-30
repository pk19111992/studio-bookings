// netlify/functions/ical.mjs
// Generates iCal (.ics) feeds per unit — subscribe URL in Airbnb/MMT
// Also handles importing external iCal feeds (Airbnb/MMT → block dates)

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SITE_URL     = process.env.SITE_URL || "https://blissfulperch.netlify.app";

const CORS = {
  "Access-Control-Allow-Origin":  "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
async function sbUpsert(table, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?on_conflict=id`, {
    method: "POST",
    headers: { ...sbH, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}
async function sbPatch(table, qs, body) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    method: "PATCH", headers: sbH, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
}

// ── iCal date helpers ─────────────────────────────────────────────────────────
function toIcalDate(dateStr) {
  // YYYY-MM-DD → 20240115
  return dateStr.replace(/-/g, "");
}
function toIcalDateTime(dateStr) {
  // Now as UTC stamp
  return new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+/,"") + "Z";
}
function parseIcalDate(s) {
  // 20240115 or 20240115T140000Z → YYYY-MM-DD
  const d = s.replace(/T.*/, "");
  return `${d.slice(0,4)}-${d.slice(4,6)}-${d.slice(6,8)}`;
}
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0,10);
}
function uid() { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2,12); }

// ── Generate .ics content from bookings ──────────────────────────────────────
function generateIcal(bookings, unitName, unitId) {
  const now = toIcalDateTime();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:-//Gaur City Booking Manager//EN`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${unitName} — Bookings`,
    `X-WR-CALDESC:Booking calendar for ${unitName}`,
    "X-WR-TIMEZONE:Asia/Kolkata",
  ];

  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    const summary = b.source === "blocked"
      ? `BLOCKED — ${b.notes || "External booking"}`
      : `${b.guest_name || "Guest"} (${b.source})`;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${b.id}@gaurcity.blissfulperch`);
    lines.push(`DTSTAMP:${now}`);
    lines.push(`DTSTART;VALUE=DATE:${toIcalDate(b.checkin_date)}`);
    lines.push(`DTEND;VALUE=DATE:${toIcalDate(b.checkout_date)}`);
    lines.push(`SUMMARY:${summary}`);
    lines.push(`DESCRIPTION:Source: ${b.source}\\nGuests: ${b.num_guests||1}\\nAmount: ₹${b.total_amount||0}`);
    lines.push(`STATUS:${b.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`);
    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

// ── Parse incoming iCal feed ──────────────────────────────────────────────────
function parseIcal(text) {
  const events = [];
  const blocks = text.split("BEGIN:VEVENT");
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i].split("END:VEVENT")[0];
    const get = (key) => {
      const rx = new RegExp(`${key}[^:]*:(.+)`, "i");
      const m = block.match(rx);
      return m ? m[1].trim().replace(/\\n/g,"\n") : null;
    };
    const dtstart = get("DTSTART");
    const dtend   = get("DTEND");
    const summary = get("SUMMARY") || "Blocked";
    const uidVal  = get("UID") || uid();
    const status  = (get("STATUS") || "CONFIRMED").toUpperCase();
    if (!dtstart) continue;
    const checkin  = parseIcalDate(dtstart);
    const checkout = dtend ? parseIcalDate(dtend) : addDays(checkin, 1);
    if (status === "CANCELLED") continue;
    events.push({ uid: uidVal, checkin, checkout, summary });
  }
  return events;
}

// ── Handler ───────────────────────────────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { status:204, headers:CORS });

  const url    = new URL(req.url);
  const action = url.searchParams.get("action");
  const unitId = url.searchParams.get("unit_id");

  try {

    // ── GET /api/ical?action=export&unit_id=xxx
    // Returns .ics file — subscribe this URL in Airbnb/MMT
    if (action === "export" || !action) {
      if (!unitId) return new Response("unit_id required", { status:400 });
      const [units, bookings] = await Promise.all([
        sb("units", `id=eq.${unitId}`),
        sb("bookings", `unit_id=eq.${unitId}&order=checkin_date.asc`),
      ]);
      const unit = units[0];
      if (!unit) return new Response("Unit not found", { status:404 });
      const ics = generateIcal(bookings, unit.name, unitId);
      return new Response(ics, {
        headers: {
          "Content-Type": "text/calendar; charset=utf-8",
          "Content-Disposition": `attachment; filename="${unit.name.replace(/\s+/g,"-")}-bookings.ics"`,
          "Cache-Control": "no-cache, no-store",
          "Access-Control-Allow-Origin": "*",
        },
      });
    }

    // ── POST /api/ical?action=import&unit_id=xxx
    // Body: { url: "https://airbnb.com/calendar/ical/..." }  OR  raw .ics text
    // Fetches external calendar and creates "blocked" bookings for taken dates
    if (action === "import" && req.method === "POST") {
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:{ ...CORS, "Content-Type":"application/json" } });

      let icsText = "";
      const ct = req.headers.get("content-type")||"";

      if (ct.includes("application/json")) {
        const body = await req.json();
        if (body.url) {
          // Fetch the external iCal URL
          const ext = await fetch(body.url, {
            headers: { "User-Agent": "GaurCityBookingManager/1.0" },
          });
          if (!ext.ok) throw new Error(`Failed to fetch calendar: ${ext.status}`);
          icsText = await ext.text();
        } else if (body.ics) {
          icsText = body.ics;
        } else {
          return new Response(JSON.stringify({ error:"Provide url or ics in body" }), { status:400, headers:{ ...CORS, "Content-Type":"application/json" } });
        }
      } else {
        icsText = await req.text();
      }

      const events = parseIcal(icsText);
      let created = 0, skipped = 0;

      for (const ev of events) {
        // Use UID as ID (stable across re-syncs — avoids duplicates)
        const stableId = `ext-${unitId}-${ev.uid}`.slice(0,100).replace(/[^a-zA-Z0-9-_]/g,"_");
        // Determine source label from summary
        const srcLower = ev.summary.toLowerCase();
        let source = "blocked";
        if (srcLower.includes("airbnb"))  source = "airbnb";
        else if (srcLower.includes("mmt") || srcLower.includes("goibibo") || srcLower.includes("makemytrip")) source = "goibibo";

        // Skip if already our own booking (avoid circular block)
        if (ev.uid.includes("gaurcity.blissfulperch")) { skipped++; continue; }

        try {
          await sbUpsert("bookings", {
            id:            stableId,
            unit_id:       unitId,
            checkin_date:  ev.checkin,
            checkout_date: ev.checkout,
            nights:        Math.max(1, Math.round((new Date(ev.checkout)-new Date(ev.checkin))/86400000)),
            guest_name:    ev.summary.length > 60 ? ev.summary.slice(0,60) : ev.summary,
            source,
            check_in_time:  "14:00",
            check_out_time: "11:00",
            status:         "confirmed",
            amount_per_night: 0,
            total_amount:   0,
            paid_amount:    0,
            payment_status: "paid",
            platform_commission_pct: 0,
            platform_commission_amt: 0,
            notes:          `Imported from external calendar: ${ev.summary}`,
            created_by:     "ical-import",
            updated_at:     new Date().toISOString(),
          });
          created++;
        } catch(e) { skipped++; }
      }

      return new Response(JSON.stringify({ ok:true, imported:created, skipped, total:events.length }), {
        headers: { ...CORS, "Content-Type":"application/json" },
      });
    }

    // ── GET /api/ical?action=links&unit_id=xxx
    // Returns the export URL + instructions for Airbnb/MMT
    if (action === "links") {
      if (!unitId) return new Response(JSON.stringify({ error:"unit_id required" }), { status:400, headers:{ ...CORS, "Content-Type":"application/json" } });
      const exportUrl = `${SITE_URL}/api/ical?action=export&unit_id=${unitId}`;
      return new Response(JSON.stringify({
        export_url: exportUrl,
        instructions: {
          airbnb: {
            import_steps: [
              "Go to airbnb.com → Calendar → Availability Settings",
              "Scroll to 'Sync calendars' → 'Import calendar'",
              `Paste this URL: ${exportUrl}`,
              "Airbnb will sync every few hours automatically",
            ],
            export_steps: [
              "Go to airbnb.com → Calendar → Availability Settings",
              "Scroll to 'Sync calendars' → 'Export calendar'",
              "Copy the iCal URL",
              "Paste it in the 'Import from Airbnb' field in this app",
            ],
          },
          mmt: {
            import_steps: [
              "Go to your MMT/GoIbibo host dashboard",
              "Calendar → Sync/Import → Add new calendar",
              `Paste this URL: ${exportUrl}`,
              "MMT will sync periodically",
            ],
            export_steps: [
              "Go to your MMT/GoIbibo host dashboard",
              "Calendar → Export or iCal → Copy URL",
              "Paste it in the 'Import from MMT' field in this app",
            ],
          },
        },
      }), { headers: { ...CORS, "Content-Type":"application/json" } });
    }

    return new Response(JSON.stringify({ error:"Unknown action" }), { status:404, headers:{ ...CORS, "Content-Type":"application/json" } });

  } catch(err) {
    console.error("iCal error:", err);
    return new Response(JSON.stringify({ error:err.message }), { status:500, headers:{ ...CORS, "Content-Type":"application/json" } });
  }
}

export const config = { path: "/api/ical" };
