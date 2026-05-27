// src/App.jsx
import { useState, useEffect, useCallback, useMemo } from "react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Core platform sources that remain unalterable across all system profiles
const BASE_SOURCES = [
  { id:"direct",  label:"Direct",       icon:"🤝", color:"#60A5FA", is_capped: true },
  { id:"airbnb",  label:"Airbnb",       icon:"✈",  color:"#FF385C", is_capped: true },
  { id:"goibibo", label:"GoIbibo/MMT",  icon:"🏨", color:"#F59E0B", is_capped: true },
];

function getDatesInRange(startDate, endDate) {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const dates = [];
  while (start <= end) {
    dates.push(start.toISOString().split("T")[0]);
    start.setDate(start.getDate() + 1);
  }
  return dates;
}

function fmt(y,m,d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function getToken() { return localStorage.getItem("gcbm_token"); }

const API2 = {
  verify:   ()    => fetch("/api/auth?action=verify", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
  units:    ()    => fetch("/api/bookings?action=units", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
  bookings: (uid) => fetch(`/api/bookings?action=bookings&unit_id=${encodeURIComponent(uid)}`, { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
  sources:  ()    => fetch("/api/bookings?action=sources", { headers: { Authorization: `Bearer ${getToken()}` } }).then(r => r.json()),
  saveSource:(s)  => fetch("/api/bookings?action=sources", { method:"POST", headers: { "Content-Type":"application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(s) }),
  syncICal: (uid) => fetch("/api/bookings?action=sync_channels", { method:"POST", headers: { "Content-Type":"application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify({ unit_id: uid }) }).then(r => r.json()),
  upsert:   (b)   => fetch("/api/bookings?action=bookings", { method:"POST", headers: { "Content-Type":"application/json", Authorization: `Bearer ${getToken()}` }, body: JSON.stringify(b) }),
};

export default function App() {
  const today = new Date();
  const [user, setUser] = useState(null);
  const [units, setUnits] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [bookings, setBookings] = useState({});
  const [customSources, setCustomSources] = useState([]);
  const [currentYear, setCurrentYear] = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth] = useState(today.getMonth());
  const [syncing, setSyncing] = useState(false);
  const [modalState, setModalState] = useState(null);

  // Combine baseline channels with custom database rows
  const allSources = useMemo(() => {
    return [...BASE_SOURCES, ...customSources];
  }, [customSources]);

  const sourceMap = useMemo(() => {
    return Object.fromEntries(allSources.map(s => [s.id, s]));
  }, [allSources]);

  useEffect(() => {
    const token = getToken();
    if (!token) return;
    API2.verify().then(r => {
      if (r.user) {
        setUser(r.user);
        // Fetch customized operational channels linked to user scope
        API2.sources().then(srcs => setCustomSources(Array.isArray(srcs) ? srcs : []));
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    API2.units().then(list => {
      setUnits(list || []);
      if (list?.length) setSelectedUnit(list[0]);
    });
  }, [user]);

  const loadData = useCallback(() => {
    if (!selectedUnit) return;
    API2.bookings(selectedUnit.id).then(rows => {
      const map = {};
      (rows || []).forEach(row => {
        const stayDates = getDatesInRange(row.start_date, row.end_date);
        stayDates.forEach(dateStr => {
          if (!map[dateStr]) map[dateStr] = [];
          map[dateStr].push(row);
        });
      });
      setBookings(map);
    });
  }, [selectedUnit]);

  useEffect(() => { loadData(); }, [loadData]);

  const runChannelSync = async () => {
    if (!selectedUnit) return;
    setSyncing(true);
    try {
      const res = await API2.syncICal(selectedUnit.id);
      alert(`Sync finished! Imported ${res.imported || 0} external calendar events.`);
      loadData();
    } catch (e) {
      alert("iCal fetch execution failed.");
    }
    setSyncing(false);
  };

  if (!user) return <div style={{ color: "#fff", padding: "40px" }}>Awaiting Auth Handshake...</div>;

  const firstDay = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();

  return (
      <div style={{ minHeight: "100vh", background: "#0A0A12", padding: "20px", color: "#F0EEF8", fontFamily: "monospace" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px", borderBottom: "1px solid #222", paddingBottom: "10px" }}>
          <h2>Gaur City Dashboard Ops</h2>
          <div>
            <button onClick={runChannelSync} disabled={syncing} style={{ padding: "8px 12px", background: "#F59E0B", color: "#000", border: "none", borderRadius: "4px", cursor: "pointer", fontWeight: "bold" }}>
              {syncing ? "Scraping OTA Feeds..." : "🔄 Sync External iCals"}
            </button>
          </div>
        </div>

        <div style={{ marginBottom: "20px" }}>
          {units.map(u => (
              <button key={u.id} onClick={() => setSelectedUnit(u)} style={{ marginRight: "10px", padding: "6px 12px", background: selectedUnit?.id === u.id ? "#6E56CF" : "#222", color: "#fff", border: "none", borderRadius: "4px" }}>
                {u.name}
              </button>
          ))}
        </div>

        {/* External Consumer Subscription Information Link Box */}
        {selectedUnit && (
            <div style={{ background: "#12121E", padding: "12px", borderRadius: "6px", marginBottom: "20px", border: "1px solid #333", fontSize: "11px" }}>
              <strong>📡 Outbound iCal Subscription Link for Platforms (Airbnb/MMT):</strong>
              <div style={{ color: "#A78BFA", marginTop: "4px", wordBreak: "break-all" }}>
                {window.location.origin}/api/bookings?action=export_ical&unit_id={selectedUnit.id}
              </div>
            </div>
        )}

        {/* Grid rendering components */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", background: "#12121E", border: "1px solid #333" }}>
          {DAYS.map(d => <div key={d} style={{ padding: "10px", textAlign: "center", color: "#666" }}>{d}</div>)}
          {Array.from({ length: firstDay }).map((_, i) => <div key={i} style={{ background: "#000" }} />)}
          {Array.from({ length: daysInMonth }, (_, i) => i + 1).map(day => {
            const dStr = fmt(currentYear, currentMonth, day);
            const dayBks = bookings[dStr] || [];
            return (
                <div key={day} onClick={() => setModalState({ type: "add", date: dStr })} style={{ minHeight: "100px", border: "1px solid #222", padding: "4px", cursor: "pointer" }}>
                  <strong>{day}</strong>
                  {dayBks.map(b => {
                    const sMeta = sourceMap[b.source] || { icon: "❓", color: "#666", label: b.source };
                    return (
                        <div key={b.id} style={{ background: sMeta.color, color: "#fff", padding: "2px", fontSize: "10px", borderRadius: "3px", marginTop: "2px" }}>
                          {sMeta.icon} {b.guest_name}
                        </div>
                    );
                  })}
                </div>
            );
          })}
        </div>
      </div>
  );
}