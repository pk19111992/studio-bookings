// src/App.jsx
import { useState, useEffect, useCallback, useMemo } from "react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
const SOURCES = [
  { id:"direct",  label:"Direct",       icon:"🤝", color:"#60A5FA" },
  { id:"airbnb",  label:"Airbnb",       icon:"✈",  color:"#FF385C" },
  { id:"goibibo", label:"GoIbibo/MMT",  icon:"🏨", color:"#F59E0B" },
  { id:"ekant",   label:"Ekant",        icon:"👤", color:"#A78BFA" },
  { id:"urmit",   label:"Urmit",        icon:"👤", color:"#34D399" },
];
const SRC = Object.fromEntries(SOURCES.map(s=>[s.id,s]));
const CAPPED_SOURCES = ["direct","airbnb","goibibo","urmit"];

// Status Workflow Definitions
const BOOKING_STATUSES = [
  { id: "enquiry", label: "Enquiry", color: "#9CA3AF" },
  { id: "confirmed", label: "Confirmed", color: "#3B82F6" },
  { id: "checked_in", label: "Checked In", color: "#10B981" },
  { id: "checked_out", label: "Checked Out", color: "#6B7280" },
  { id: "cancelled", label: "Cancelled", color: "#EF4444" }
];

const PAYMENT_STATUSES = [
  { id: "pending", label: "Pending", color: "#F59E0B" },
  { id: "partially_paid", label: "Partially Paid", color: "#10B981" },
  { id: "paid", label: "Paid", color: "#059669" },
  { id: "refunded", label: "Refunded", color: "#EF4444" }
];

// Helper to determine single-date cost allocation behavior
function isHalfDay(booking) {
  if (["ekant","urmit","direct"].includes(booking.source)) {
    return Number(booking.amount) <= 1500;
  }
  return false;
}

// Expand multi-night records sequentially into individual dates for cell indexing
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

function getDayOccupancy(dayBookings) {
  const active = dayBookings.filter(b => b.status !== "cancelled");
  const capped = active.filter(b => CAPPED_SOURCES.includes(b.source));
  const ekant  = active.filter(b => b.source === "ekant");
  let cappedDays = capped.reduce((sum, b) => sum + (isHalfDay(b) ? 0.5 : 1), 0);
  cappedDays = Math.min(cappedDays, 1);
  const ekantDays = ekant.reduce((sum, b) => sum + (isHalfDay(b) ? 0.5 : 1), 0);
  return Math.min(cappedDays + ekantDays, 1);
}

function fmt(y,m,d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function uid()      { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2,12); }
function getToken() { return localStorage.getItem("gcbm_token"); }
function setToken(t){ t ? localStorage.setItem("gcbm_token",t) : localStorage.removeItem("gcbm_token"); }

const API = "/api";
async function apiFetch(path, opts={}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: { "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}), ...(opts.headers||{}) },
  });
  if (res.status === 401) { setToken(null); window.location.reload(); return; }
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  return res.json();
}

const API2 = {
  verify:          ()           => apiFetch("/auth?action=verify"),
  login:           (e,p)        => apiFetch("/auth?action=login",           { method:"POST", body:JSON.stringify({email:e,password:p}) }),
  register:        (e,p,n)      => apiFetch("/auth?action=register",        { method:"POST", body:JSON.stringify({email:e,password:p,name:n}) }),
  googleUrl:       ()           => `${API}/auth?action=google`,
  units:           ()           => apiFetch("/bookings?action=units"),
  addUnit:         (n,l)        => apiFetch("/bookings?action=units",        { method:"POST", body:JSON.stringify({name:n,location:l}) }),
  bookings:        (uid)        => apiFetch(`/bookings?action=bookings&unit_id=${encodeURIComponent(uid)}`),
  stats:           (uid,month)  => apiFetch(`/bookings?action=stats&unit_id=${encodeURIComponent(uid)}&month=${month}`),
  allStats:        (month)      => apiFetch(`/bookings?action=stats&month=${month}`),
  upsert:          (b)          => apiFetch("/bookings?action=bookings",     { method:"POST", body:JSON.stringify(b) }),
  deleteBooking:   (id)         => apiFetch(`/bookings?action=bookings&id=${id}`, { method:"DELETE" }),
};

const inp = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", color:"#F0EEF8", padding:"10px 14px", fontSize:"13px", fontFamily:"'DM Mono', monospace", width:"100%", outline:"none", boxSizing:"border-box" };
const lbl = { color:"rgba(255,255,255,0.45)", fontSize:"10px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:"5px" };
const card = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"12px", padding:"16px" };

function Modal({ isOpen, onClose, children, wide }) {
  useEffect(()=>{ const h=e=>{if(e.key==="Escape")onClose();}; window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h); },[onClose]);
  if(!isOpen) return null;
  return (
      <div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(10,10,18,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",padding:"16px" }}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#12121E",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"28px",width:"100%",maxWidth:wide?"720px":"460px",boxShadow:"0 24px 60px rgba(0,0,0,0.6)",maxHeight:"90vh",overflowY:"auto" }}>
          {children}
        </div>
      </div>
  );
}

function LoginPage({ onLogin }) {
  const [email,setEmail]=useState("");
  const [password,setPassword]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  const submit=async()=>{
    setError(""); setLoading(true);
    try {
      const r=await API2.login(email,password);
      setToken(r.token); onLogin(r.user);
    } catch(e){ setError(e.message.includes("{")?JSON.parse(e.message).error:e.message); }
    setLoading(false);
  };

  return (
      <div style={{ minHeight:"100vh",background:"#0A0A12",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono', monospace",padding:"16px" }}>
        <div style={{ width:"100%",maxWidth:"400px" }}>
          <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"28px" }}>
            <h2 style={{ color:"#fff", fontFamily:"'Playfair Display', serif", textAlign:"center", marginBottom:"20px" }}>Sign In</h2>
            <div style={{ display:"grid",gap:"12px" }}>
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
              <div><label style={lbl}>Password</label><input style={inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
            </div>
            {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"12px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}
            <button onClick={submit} disabled={loading} style={{ padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontWeight:700,width:"100%",marginTop:"20px" }}>
              {loading?"Please wait…":"Sign In"}
            </button>
          </div>
        </div>
      </div>
  );
}

function Dashboard({ units }) {
  const today = new Date();
  const [selUnit, setSelUnit] = useState("all");
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [data, setData]   = useState([]);
  const [loading, setLoading] = useState(false);

  const monthStr = `${year}-${String(month+1).padStart(2,"0")}`;
  const daysInMonth = new Date(year, month+1, 0).getDate();

  useEffect(()=>{
    setLoading(true);
    const p = selUnit === "all" ? API2.allStats(monthStr) : API2.stats(selUnit, monthStr);
    p.then(rows=>{ setData(rows||[]); setLoading(false); }).catch(()=>setLoading(false));
  },[selUnit, monthStr]);

  const stats = useMemo(()=>{
    const bySource = {};
    SOURCES.forEach(s=>{ bySource[s.id]={ count:0, revenue:0 }; });
    let totalRevenue=0, totalDays=0;

    const byDate = {};
    data.forEach(b=>{
      if (b.status === "cancelled") return;
      const stayDates = getDatesInRange(b.start_date, b.end_date);
      stayDates.forEach(dateStr => {
        if(dateStr.startsWith(monthStr)) {
          if(!byDate[dateStr]) byDate[dateStr]=[];
          byDate[dateStr].push(b);
        }
      });

      bySource[b.source] = bySource[b.source]||{ count:0,revenue:0 };
      bySource[b.source].count++;
      bySource[b.source].revenue += Number(b.amount||0);
      totalRevenue += Number(b.amount||0);
    });

    Object.values(byDate).forEach(dayBks=>{
      totalDays += getDayOccupancy(dayBks);
    });

    const occupancyPct = daysInMonth > 0 ? Math.round((totalDays/daysInMonth)*100) : 0;
    return { bySource, totalRevenue, totalDays, occupancyPct, totalBookings:data.filter(x=>x.status!=="cancelled").length };
  },[data, daysInMonth, monthStr]);

  return (
      <div style={{ padding:"20px 0" }}>
        <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"20px" }}>
          {[
            { label:"Total Revenue",   value:`₹${stats.totalRevenue.toLocaleString("en-IN")}`, accent:"#86EFAC" },
            { label:"Total Bookings",  value:stats.totalBookings,  accent:"#C4B5FD" },
            { label:"Occupied Nights",   value:`${stats.totalDays.toFixed(1)} / ${daysInMonth}`, accent:"#FCA5A5" },
            { label:"Occupancy Rate",  value:`${stats.occupancyPct}%`, accent:"#6EE7B7" },
          ].map(s=>(
              <div key={s.label} style={card}>
                <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"4px" }}>{s.label}</div>
                <div style={{ color:s.accent,fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{s.value}</div>
              </div>
          ))}
        </div>
        <div style={{ color: "#fff" }}>Use Calendar Tab to view structured breakdown arrays.</div>
      </div>
  );
}

function BookingBadge({ booking, onClick }) {
  const src = SRC[booking.source]||SRC.direct;
  const half = isHalfDay(booking);
  const isCancelled = booking.status === "cancelled";

  return (
      <div onClick={e=>{e.stopPropagation();onClick(booking);}} style={{ background:isCancelled ? "rgba(255,255,255,0.05)" : `linear-gradient(135deg,${src.color}cc,${src.color}77)`,color: isCancelled ? "rgba(255,255,255,0.2)" : "#fff",borderRadius:"4px",padding:"2px 5px",fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600,cursor:"pointer",marginBottom:"2px",display:"flex",alignItems:"center",gap:"3px",textDecoration: isCancelled ? "line-through" : "none" }}>
        <span style={{ fontSize:"9px",flexShrink:0 }}>{isCancelled ? "❌" : src.icon}</span>
        <span style={{ overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{booking.guest_name||src.label}</span>
        {half && <span style={{ fontSize:"8px",flexShrink:0 }}>½</span>}
      </div>
  );
}

function BookingForm({ date, unit, onSave, onClose, editBooking }) {
  const [form,setForm] = useState(editBooking||{ guest_name:"", source:"direct", start_date:date, end_date:date, check_in:"14:00", check_out:"11:00", amount:"", guest_phone:"", guest_count:"1", status:"confirmed", payment_status:"pending", payment_method:"UPI", notes:"", overflow_to:"" });
  const [error,setError]=useState("");
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));

  const handleSave=async()=>{
    if(!form.guest_name.trim()) return setError("Guest name is required.");
    if(new Date(form.start_date) > new Date(form.end_date)) return setError("Checkout date cannot be prior to Check-in date.");
    if(!form.amount || isNaN(Number(form.amount))) return setError("Valid transactional value required.");
    setError("");
    await onSave({ ...form, id:form.id||uid(), unit_id:unit.id });
  };

  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"#F0EEF8",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{editBooking?"Modify Reservation":"New Range Booking"}</div>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:"#fff",cursor:"pointer",fontSize:"18px" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"14px" }}>
          <div><label style={lbl}>Guest Name</label><input style={inp} value={form.guest_name} onChange={e=>set("guest_name",e.target.value)}/></div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div><label style={lbl}>Start Date</label><input type="date" style={inp} value={form.start_date} onChange={e=>set("start_date",e.target.value)}/></div>
            <div><label style={lbl}>End Date (Checkout)</label><input type="date" style={inp} value={form.end_date} onChange={e=>set("end_date",e.target.value)}/></div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div><label style={lbl}>Guest Phone</label><input style={inp} value={form.guest_phone} onChange={e=>set("guest_phone",e.target.value)} placeholder="+91"/></div>
            <div><label style={lbl}>Total Guests</label><input type="number" style={inp} value={form.guest_count} onChange={e=>set("guest_count",e.target.value)}/></div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div>
              <label style={lbl}>Booking Status</label>
              <select style={inp} value={form.status} onChange={e=>set("status",e.target.value)}>
                {BOOKING_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Payment Status</label>
              <select style={inp} value={form.payment_status} onChange={e=>set("payment_status",e.target.value)}>
                {PAYMENT_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
              </select>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div>
              <label style={lbl}>Payment Channel</label>
              <select style={inp} value={form.payment_method} onChange={e=>set("payment_method",e.target.value)}>
                <option value="UPI">UPI / QR</option>
                <option value="Cash">Cash Payments</option>
                <option value="Bank Transfer">Bank NEFT/IMPS</option>
                <option value="Card">Credit/Debit Card</option>
              </select>
            </div>
            <div><label style={lbl}>Total Amount Assessed (₹)</label><input type="number" style={inp} value={form.amount} onChange={e=>set("amount",e.target.value)}/></div>
          </div>
          <div>
            <label style={lbl}>Booking Source</label>
            <select style={inp} value={form.source} onChange={e=>set("source",e.target.value)}>
              {SOURCES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Internal Operational Notes</label><textarea style={inp} value={form.notes} onChange={e=>set("notes",e.target.value)}/></div>
        </div>
        {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"10px" }}>⚠ {error}</div>}
        <div style={{ display:"flex",gap:"10px",marginTop:"20px" }}>
          <button onClick={handleSave} style={{ flex:1,padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",fontWeight:700 }}>Commit Changes</button>
        </div>
      </>
  );
}

function BookingDetail({ booking, unit, onClose, onEdit, onDelete }) {
  const src = SRC[booking.source]||SRC.direct;
  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{booking.guest_name}</div>
            <div style={{ color:"rgba(255,255,255,0.4)",fontSize:"12px" }}>Stay Range: {booking.start_date} to {booking.end_date}</div>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:"#fff",cursor:"pointer" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"10px",marginBottom:"20px" }}>
          <div style={{ background:"rgba(255,255,255,0.02)", padding:"10px", borderRadius:"6px" }}>
            <div style={lbl}>Workflow Allocation Status</div>
            <span style={{ color: booking.status === "cancelled" ? "#EF4444" : "#34D399", fontWeight:700 }}>{booking.status.toUpperCase()}</span>
          </div>
          <div style={{ background:"rgba(255,255,255,0.02)", padding:"10px", borderRadius:"6px" }}>
            <div style={lbl}>Financial Status ({booking.payment_method})</div>
            <span style={{ color:"#C4B5FD", fontWeight:700 }}>₹{Number(booking.amount).toLocaleString("en-IN")} — {booking.payment_status.toUpperCase()}</span>
          </div>
          {booking.guest_phone && <div style={{ color:"#fff" }}>📞 Phone Contact: {booking.guest_phone}</div>}
          <div style={{ color:"rgba(255,255,255,0.6)" }}>📝 Logs: {booking.notes || "No special requests attached."}</div>
        </div>
        <div style={{ display:"flex",gap:"10px" }}>
          <button onClick={() => onDelete(booking.id)} style={{ padding:"10px",background:"rgba(239,68,68,0.2)",border:"1px solid #EF4444",color:"#EF4444",borderRadius:"6px",cursor:"pointer" }}>Purge</button>
          <button onClick={() => onEdit(booking)} style={{ flex:1,padding:"10px",background:"#6E56CF",border:"none",color:"#fff",borderRadius:"6px",fontWeight:700,cursor:"pointer" }}>Edit Properties</button>
        </div>
      </>
  );
}

export default function App() {
  const today = new Date();
  const [user,setUser]             = useState(null);
  const [authChecked,setAuthChecked] = useState(false);
  const [units,setUnits]           = useState([]);
  const [selectedUnit,setSelectedUnit] = useState(null);
  const [bookings,setBookings]     = useState({});
  const [currentYear,setCurrentYear] = useState(today.getFullYear());
  const [currentMonth,setCurrentMonth] = useState(today.getMonth());
  const [status,setStatus]         = useState("loading");
  const [modalState,setModalState] = useState(null);
  const [activeTab,setActiveTab]   = useState("calendar");

  useEffect(()=>{
    const token=getToken();
    if(!token){setAuthChecked(true);return;}
    API2.verify().then(r=>{setUser(r.user);setAuthChecked(true);}).catch(()=>{setToken(null);setAuthChecked(true);});
  },[]);

  useEffect(()=>{
    if(!user) return;
    API2.units().then(list=>{
      setUnits(list||[]);
      if(list?.length) setSelectedUnit(list[0]);
    }).catch(()=>{});
  },[user]);

  const loadBookings = useCallback(()=>{
    if(!selectedUnit) return;
    setStatus("loading");
    API2.bookings(selectedUnit.id).then(rows=>{
      const map={};
      (rows||[]).forEach(row=>{
        const stayDates = getDatesInRange(row.start_date, row.end_date);
        stayDates.forEach(dateStr => {
          if (!map[dateStr]) map[dateStr] = [];
          map[dateStr].push(row);
        });
      });
      setBookings(map);
      setStatus("saved");
    }).catch(()=>setStatus("error"));
  },[selectedUnit]);

  useEffect(()=>{ loadBookings(); },[loadBookings]);

  const firstDay   = new Date(currentYear,currentMonth,1).getDay();
  const daysInMonth = new Date(currentYear,currentMonth+1,0).getDate();
  const getDay     = d => bookings[d]||[];

  const handleSave=async booking=>{
    setStatus("saving");
    try {
      await API2.upsert(booking);
      loadBookings();
    } catch(e){setStatus("error");}
    setModalState(null);
  };

  const handleDelete=async id=>{
    setStatus("saving");
    try {
      await API2.deleteBooking(id);
      loadBookings();
    } catch(e){setStatus("error");}
    setModalState(null);
  };

  if(!authChecked) return <div style={{ color:"#fff", textAlign:"center", padding:"40px" }}>Booting Security Systems…</div>;
  if(!user) return <LoginPage onLogin={u=>setUser(u)} />;

  return (
      <div style={{ minHeight:"100vh",background:"#0A0A12",fontFamily:"'DM Mono', monospace",padding:"20px",color:"#F0EEF8" }}>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",borderBottom:"1px solid rgba(255,255,255,0.08)",paddingBottom:"12px",marginBottom:"20px" }}>
          <div>
            <span style={{ fontSize:"20px", fontWeight:900 }}>Gaur City Cluster Ops</span>
            <span style={{marginLeft:"15px",fontSize:"11px",background:"rgba(110,86,207,0.25)",padding:"4px 8px",borderRadius:"4px"}}>{status.toUpperCase()}</span>
          </div>
          <div style={{ display:"flex",gap:"10px" }}>
            <button onClick={()=>setActiveTab("calendar")} style={{ background:activeTab==="calendar"?"#6E56CF":"transparent",color:"#fff",border:"1px solid rgba(255,255,255,0.1)",padding:"6px 12px",borderRadius:"6px",cursor:"pointer" }}>Calendar Master</button>
            <button onClick={()=>setActiveTab("dashboard")} style={{ background:activeTab==="dashboard"?"#6E56CF":"transparent",color:"#fff",border:"1px solid rgba(255,255,255,0.1)",padding:"6px 12px",borderRadius:"6px",cursor:"pointer" }}>Analytics Sheets</button>
            <button onClick={()=>{setToken(null);setUser(null);}} style={{ background:"rgba(239,68,68,0.2)",color:"#EF4444",border:"none",padding:"6px 12px",borderRadius:"6px",cursor:"pointer" }}>Exit</button>
          </div>
        </div>

        <div style={{ marginBottom:"15px", display:"flex", gap:"8px" }}>
          {units.map(u => (
              <button key={u.id} onClick={()=>setSelectedUnit(u)} style={{ padding:"6px 12px", borderRadius:"20px", background: selectedUnit?.id === u.id ? "#6E56CF" : "rgba(255,255,255,0.05)", border:"none", color:"#fff", cursor:"pointer" }}>{u.name}</button>
          ))}
        </div>

        {activeTab === "dashboard" && <Dashboard units={units} />}

        {activeTab === "calendar" && (
            <>
              <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",background:"rgba(255,255,255,0.02)",padding:"10px",borderRadius:"8px 8px 0 0" }}>
                <button onClick={()=>{ if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1); }} style={{ background:"none",border:"none",color:"#fff",fontSize:"18px",cursor:"pointer" }}>‹</button>
                <span style={{ fontSize:"16px",fontWeight:700 }}>{MONTHS[currentMonth]} {currentYear}</span>
                <button onClick={()=>{ if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1); }} style={{ background:"none",border:"none",color:"#fff",fontSize:"18px",cursor:"pointer" }}>›</button>
              </div>

              <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",border:"1px solid rgba(255,255,255,0.08)",background:"#12121E" }}>
                {DAYS.map(d => <div key={d} style={{ textGroup:"center",padding:"10px",fontSize:"11px",color:"rgba(255,255,255,0.3)",textAlign:"center" }}>{d}</div>)}

                {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`} style={{ minHeight:"100px",background:"rgba(0,0,0,0.2)",border:"1px solid rgba(255,255,255,0.02)" }}/>)}

                {Array.from({length:daysInMonth},(_,i)=>i+1).map(day=>{
                  const dateStr = fmt(currentYear,currentMonth,day);
                  const dayBks = getDay(dateStr);
                  const occ = getDayOccupancy(dayBks);
                  const occColor = occ >= 1 ? "#EF4444" : occ >= 0.5 ? "#F59E0B" : "transparent";

                  return (
                      <div key={day} onClick={() => setModalState({ type:"add", date:dateStr })} style={{ minHeight:"110px",border:"1px solid rgba(255,255,255,0.04)",padding:"4px",position:"relative",background:"rgba(255,255,255,0.01)" }}>
                        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center" }}>
                          <span style={{ fontSize:"12px",fontWeight:600 }}>{day}</span>
                          {occ > 0 && <span style={{ width:"6px",height:"6px",borderRadius:"50%",background:occColor }}/>}
                        </div>
                        <div style={{ marginTop:"4px" }}>
                          {dayBks.map(b => (
                              <BookingBadge key={b.id} booking={b} onClick={bk => setModalState({ type:"detail", booking:bk })} />
                          ))}
                        </div>
                      </div>
                  );
                })}
              </div>
            </>
        )}

        <Modal isOpen={modalState?.type === "add"} onClose={()=>setModalState(null)}>
          <BookingForm date={modalState?.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={null}/>
        </Modal>
        <Modal isOpen={modalState?.type === "detail"} onClose={()=>setModalState(null)}>
          <BookingDetail booking={modalState?.booking} unit={selectedUnit} onClose={()=>setModalState(null)} onEdit={bk=>setModalState({type:"edit",booking:bk})} onDelete={handleDelete}/>
        </Modal>
        <Modal isOpen={modalState?.type === "edit"} onClose={()=>setModalState(null)}>
          <BookingForm date={modalState?.booking?.start_date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={modalState?.booking}/>
        </Modal>
      </div>
  );
}