import { useState, useEffect, useCallback, useMemo } from "react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

// Core unalterable channels across all users
const BASE_SOURCES = [
  { id:"direct",  label:"Direct",       icon:"🤝", color:"#60A5FA" },
  { id:"airbnb",  label:"Airbnb",       icon:"✈",  color:"#FF385C" },
  { id:"goibibo", label:"GoIbibo/MMT",  icon:"🏨", color:"#F59E0B" },
];

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

function isHalfDay(booking) {
  if (["ekant","urmit","direct"].includes(booking.source)) {
    return Number(booking.amount) <= 1500;
  }
  return false;
}

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
  const capped = active.filter(b => ["direct","airbnb","goibibo","urmit"].includes(b.source));
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
  allUsers:        ()           => apiFetch("/bookings?action=users"),
  units:           ()           => apiFetch("/bookings?action=units"),
  addUnit:         (n,l)        => apiFetch("/bookings?action=units",        { method:"POST", body:JSON.stringify({name:n,location:l}) }),
  bookings:        (uid)        => apiFetch(`/bookings?action=bookings&unit_id=${encodeURIComponent(uid)}`),
  stats:           (uid,month)  => apiFetch(`/bookings?action=stats&unit_id=${encodeURIComponent(uid)}&month=${month}`),
  allStats:        (month)      => apiFetch(`/bookings?action=stats&month=${month}`),
  sources:         ()           => apiFetch("/bookings?action=sources"),
  syncICal:        (uid)        => apiFetch("/bookings?action=sync_channels", { method:"POST", body: JSON.stringify({ unit_id: uid }) }),
  upsert:          (b)          => apiFetch("/bookings?action=bookings",     { method:"POST", body:JSON.stringify(b) }),
  deleteBooking:   (id)         => apiFetch(`/bookings?action=bookings&id=${id}`, { method:"DELETE" }),
};

// ── CUSTOM STYLES FROM ORIGINAL UI ─────────────────────────────────────────────
const inp = { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", color:"#F0EEF8", padding:"10px 14px", fontSize:"13px", fontFamily:"'DM Mono', monospace", width:"100%", outline:"none", boxSizing:"border-box" };
const lbl = { color:"rgba(255,255,255,0.45)", fontSize:"10px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:"5px" };
const card = { background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"12px", padding:"16px" };

function Modal({ isOpen, onClose, children, wide }) {
  useEffect(()=>{ const h=e=>{if(e.key==="Escape")onClose();}; window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h); },[onClose]);
  if(!isOpen) return null;
  return (
      <div onClick={onClose} style={{ position:"fixed",inset:0,zIndex:1000,background:"rgba(10,10,18,0.8)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn 0.15s ease",padding:"16px" }}>
        <div onClick={e=>e.stopPropagation()} style={{ background:"#12121E",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"28px",width:"100%",maxWidth:wide?"720px":"460px",boxShadow:"0 24px 60px rgba(0,0,0,0.6)",animation:"slideUp 0.2s cubic-bezier(.34,1.4,.64,1)",maxHeight:"90vh",overflowY:"auto" }}>
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
          <div style={{ textAlign:"center",marginBottom:"28px" }}>
            <div style={{ fontSize:"36px",marginBottom:"8px" }}>🏢</div>
            <div style={{ color:"#F0EEF8",fontSize:"22px",fontFamily:"'Playfair Display', serif",fontWeight:900 }}>Gaur City</div>
            <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase" }}>Booking Manager</div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"28px" }}>
            <div style={{ display:"grid",gap:"12px" }}>
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com"/></div>
              <div><label style={lbl}>Password</label><input style={inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
            </div>
            {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"12px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}
            <button onClick={submit} disabled={loading} style={{ padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",width:"100%",marginTop:"20px" }}>
              {loading?"Please wait…":"Sign In"}
            </button>
          </div>
        </div>
      </div>
  );
}

function Dashboard({ units, sourceMap, allSources }) {
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
    allSources.forEach(s=>{ bySource[s.id]={ count:0, revenue:0 }; });
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

    Object.values(byDate).forEach(dayBks=>{ totalDays += getDayOccupancy(dayBks); });
    const occupancyPct = daysInMonth > 0 ? Math.round((totalDays/daysInMonth)*100) : 0;
    return { bySource, totalRevenue, totalDays, occupancyPct, totalBookings:data.filter(x=>x.status!=="cancelled").length };
  },[data, daysInMonth, monthStr, allSources]);

  const btnStyle = (active) => ({ padding:"5px 14px",borderRadius:"20px",border:`1px solid ${active?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:active?"rgba(110,86,207,0.2)":"transparent",color:active?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer",whiteSpace:"nowrap" });

  return (
      <div style={{ padding:"20px 0" }}>
        <div style={{ display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center",marginBottom:"20px" }}>
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
            <button style={btnStyle(selUnit==="all")} onClick={()=>setSelUnit("all")}>All Units</button>
            {units.map(u=><button key={u.id} style={btnStyle(selUnit===u.id)} onClick={()=>setSelUnit(u.id)}>{u.name}</button>)}
          </div>
        </div>

        {loading ? <div style={{ color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",textAlign:"center",padding:"40px" }}>Loading…</div> : <>
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
        </>}
      </div>
  );
}

function BookingBadge({ booking, onClick, sourceMap }) {
  const src = sourceMap[booking.source] || { icon:"❓", color:"#666", label:"Direct" };
  const half = isHalfDay(booking);
  const isCancelled = booking.status === "cancelled";
  return (
      <div onClick={e=>{e.stopPropagation();onClick(booking);}} style={{ background: isCancelled ? "rgba(255,255,255,0.05)" : `linear-gradient(135deg,${src.color}cc,${src.color}77)`,color: isCancelled ? "rgba(255,255,255,0.2)" : "#fff",borderRadius:"4px",padding:"2px 5px",fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600,cursor:"pointer",marginBottom:"2px",display:"flex",alignItems:"center",gap:"3px",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",textDecoration: isCancelled ? "line-through" : "none" }}>
        <span style={{ fontSize:"9px",flexShrink:0 }}>{isCancelled ? "❌" : src.icon}</span>
        <span style={{ overflow:"hidden",textOverflow:"ellipsis" }}>{booking.guest_name||src.label}</span>
        {half && <span style={{ fontSize:"8px",flexShrink:0 }}>½</span>}
      </div>
  );
}

function BookingForm({ date, unit, onSave, onClose, editBooking, allSources }) {
  const [form,setForm] = useState(editBooking || { guest_name:"", source:"direct", start_date:date, end_date:date, check_in:"14:00", check_out:"11:00", amount:"", guest_phone:"", guest_count:"1", status:"confirmed", payment_status:"pending", payment_method:"UPI", notes:"", overflow_to:"" });
  const [error,setError]=useState("");
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));

  const handleSave=async()=>{
    if(!form.guest_name.trim()) return setError("Guest name is required.");
    if(new Date(form.start_date) > new Date(form.end_date)) return setError("Checkout date cannot be prior to Check-in date.");
    if(!form.amount||isNaN(Number(form.amount))) return setError("Please enter a valid amount.");
    setError("");
    await onSave({ ...form, id:form.id||uid(), unit_id:unit.id });
  };

  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"#F0EEF8",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{editBooking?"Edit":"New Range"} Booking</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:"18px",width:"34px",height:"34px" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"14px" }}>
          <div><label style={lbl}>Guest Name</label><input style={inp} value={form.guest_name} onChange={e=>set("guest_name",e.target.value)}/></div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div><label style={lbl}>Start Date</label><input type="date" style={inp} value={form.start_date} onChange={e=>set("start_date",e.target.value)}/></div>
            <div><label style={lbl}>End Date</label><input type="date" style={inp} value={form.end_date} onChange={e=>set("end_date",e.target.value)}/></div>
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
              <label style={lbl}>Payment Method</label>
              <select style={inp} value={form.payment_method} onChange={e=>set("payment_method",e.target.value)}>
                <option value="UPI">UPI / QR</option>
                <option value="Cash">Cash</option>
                <option value="Bank Transfer">Bank Transfer</option>
              </select>
            </div>
            <div><label style={lbl}>Amount (₹)</label><input type="number" style={inp} value={form.amount} onChange={e=>set("amount",e.target.value)}/></div>
          </div>
          <div>
            <label style={lbl}>Booking Source</label>
            <select style={inp} value={form.source} onChange={e=>set("source",e.target.value)}>
              {allSources.map(s => <option key={s.id} value={s.id}>{s.icon} {s.label}</option>)}
            </select>
          </div>
          <div><label style={lbl}>Notes</label><textarea style={inp} value={form.notes} onChange={e=>set("notes",e.target.value)}/></div>
        </div>
        {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"10px" }}>⚠ {error}</div>}
        <div style={{ display:"flex",gap:"10px",marginTop:"20px" }}>
          <button onClick={handleSave} style={{ flex:1,padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",fontWeight:700 }}>Save Booking</button>
        </div>
      </>
  );
}

function BookingDetail({ booking, unit, onClose, onEdit, onDelete }) {
  const half = isHalfDay(booking);
  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{booking.guest_name}</div>
            <div style={{ color:"rgba(255,255,255,0.35)",fontSize:"11px" }}>Range: {booking.start_date} to {booking.end_date}</div>
          </div>
          <button onClick={onClose} style={{ background:"transparent",border:"none",color:"#fff",fontSize:"18px" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"10px",marginBottom:"20px" }}>
          <div style={{ background:"rgba(255,255,255,0.02)", padding:"12px", borderRadius:"8px" }}>
            <span style={lbl}>Status Workflow / Finance</span>
            <div style={{ color:"#C4B5FD", fontSize:"14px", fontWeight:700, marginTop:"4px" }}>
              {booking.status.toUpperCase()} — {booking.payment_status.toUpperCase()} (₹{Number(booking.amount).toLocaleString("en-IN")})
            </div>
          </div>
          {booking.guest_phone && <div style={{ color:"#fff", fontSize:"12px" }}>📞 Phone: {booking.guest_phone}</div>}
          {booking.notes && <div style={{ color:"rgba(255,255,255,0.6)", fontSize:"12px" }}>📝 Notes: {booking.notes}</div>}
        </div>
        <div style={{ display:"flex",gap:"10px" }}>
          <button onClick={() => onDelete(booking.id)} style={{ padding:"10px",background:"rgba(239,68,68,0.2)",border:"1px solid #EF4444",color:"#EF4444",borderRadius:"6px" }}>Delete</button>
          <button onClick={() => onEdit(booking)} style={{ flex:1,padding:"10px",background:"#6E56CF",color:"#fff",border:"none",borderRadius:"6px",fontWeight:700 }}>Edit Booking</button>
        </div>
      </>
  );
}

function StatusBadge({ status }) {
  const cfg={ loading:{bg:"rgba(255,189,46,0.12)",border:"rgba(255,189,46,0.3)",color:"#FFBD2E",dot:"#FFBD2E",label:"Connecting…"}, saving:{bg:"rgba(110,86,207,0.12)",border:"rgba(110,86,207,0.3)",color:"#C4B5FD",dot:"#9B7FE8",label:"Saving…"}, saved:{bg:"rgba(39,201,63,0.1)",border:"rgba(39,201,63,0.25)",color:"#74C69D",dot:"#27C93F",label:"✦ Synced"}, error:{bg:"rgba(255,90,95,0.1)",border:"rgba(255,90,95,0.3)",color:"#FF7B7F",dot:"#FF5A5F",label:"⚠ Error"} }[status]||{};
  return <div style={{ display:"flex",alignItems:"center",gap:"6px",background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:"20px",padding:"4px 12px" }}><div style={{ width:"6px",height:"6px",borderRadius:"50%",background:cfg.dot }}/><span style={{ color:cfg.color,fontSize:"9px",fontFamily:"'DM Mono', monospace" }}>{cfg.label}</span></div>;
}

export default function App() {
  const today = new Date();
  const [user,setUser]             = useState(null);
  const [authChecked,setAuthChecked] = useState(false);
  const [units,setUnits]           = useState([]);
  const [selectedUnit,setSelectedUnit] = useState(null);
  const [bookings,setBookings]     = useState({});
  const [customSources,setCustomSources] = useState([]);
  const [currentYear,setCurrentYear] = useState(today.getFullYear());
  const [currentMonth,setCurrentMonth] = useState(today.getMonth());
  const [status,setStatus]         = useState("loading");
  const [modalState,setModalState] = useState(null);
  const [activeTab,setActiveTab]   = useState("calendar");
  const [syncing, setSyncing]      = useState(false);

  const allSources = useMemo(() => [...BASE_SOURCES, ...customSources], [customSources]);
  const sourceMap = useMemo(() => Object.fromEntries(allSources.map(s => [s.id, s])), [allSources]);

  useEffect(()=>{
    const token=getToken();
    if(!token){setAuthChecked(true);return;}
    API2.verify().then(r=>{
      setUser(r.user);
      setAuthChecked(true);
      API2.sources().then(srcs => setCustomSources(Array.isArray(srcs) ? srcs : []));
    }).catch(()=>{setToken(null);setAuthChecked(true);});
  },[]);

  useEffect(()=>{
    if(!user) return;
    API2.units().then(list=>{
      setUnits(list||[]);
      if(list?.length) setSelectedUnit(list[0]);
      setStatus("saved");
    }).catch(()=>setStatus("error"));
  },[user]);

  const loadBookings = useCallback(()=>{
    if(!selectedUnit) return;
    setStatus("loading");
    API2.bookings(selectedUnit.id).then(rows=>{
      const map={};
      (rows||[]).forEach(row=>{
        const stayDates = getDatesInRange(row.start_date, row.end_date);
        stayDates.forEach(dateStr => {
          if(!map[dateStr]) map[dateStr]=[];
          map[dateStr].push(row);
        });
      });
      setBookings(map); setStatus("saved");
    }).catch(()=>setStatus("error"));
  },[selectedUnit]);

  useEffect(()=>{ loadBookings(); },[loadBookings]);

  const firstDay   = new Date(currentYear,currentMonth,1).getDay();
  const daysInMonth = new Date(currentYear,currentMonth+1,0).getDate();
  const prevMonth  = ()=>{if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1);};
  const nextMonth  = ()=>{if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1);};
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

  const runChannelSync = async () => {
    if (!selectedUnit) return;
    setSyncing(true); setStatus("loading");
    try {
      const res = await API2.syncICal(selectedUnit.id);
      alert(`Sync completely processed! Synced external operations.`);
      loadBookings();
    } catch (e) {
      alert("iCal remote synchronization task failed.");
      setStatus("error");
    }
    setSyncing(false);
  };

  const tabBtn=(tab,label,icon)=>(
      <button key={tab} onClick={()=>setActiveTab(tab)} style={{ display:"flex",alignItems:"center",gap:"6px",padding:"8px 16px",borderRadius:"8px",border:"none",background:activeTab===tab?"rgba(110,86,207,0.25)":"transparent",color:activeTab===tab?"#C4B5FD":"rgba(255,255,255,0.4)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px" }}>
        <span>{icon}</span>{label}
      </button>
  );

  if(!authChecked) return <div style={{ minHeight:"100vh",background:"#0A0A12",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace" }}>Loading Security Context…</div>;
  if(!user) return <LoginPage onLogin={u=>setUser(u)} />;

  const monthPrefix=`${currentYear}-${String(currentMonth+1).padStart(2,"0")}`;
  const monthBks = Object.entries(bookings).filter(([d])=>d.startsWith(monthPrefix)).flatMap(([,l])=>l);
  const totalRevenue = monthBks.filter(b => b.status !== "cancelled").reduce((s,b)=>s+Number(b.amount||0),0);

  return (
      <div style={{ minHeight:"100vh",background:"#0A0A12",fontFamily:"'DM Mono', monospace",overflowX:"hidden" }}>
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500;600&display=swap');
        @keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideUp{from{opacity:0;transform:translateY(28px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
      `}</style>

        {/* ── HEADER WITH PREVIOUS TABS VISIBLE ── */}
        <div style={{ background:"rgba(255,255,255,0.02)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"12px" }}>
            <span style={{ fontSize:"22px" }}>🏢</span>
            <div><div style={{ color:"#F0EEF8",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:900 }}>Booking Manager</div></div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
            {tabBtn("calendar","Calendar","📅")}
            {tabBtn("dashboard","Reports","📊")}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
            <StatusBadge status={status}/>
            <button onClick={runChannelSync} disabled={syncing} style={{ padding:"5px 12px", background:"#F59E0B", color:"#000", border:"none", borderRadius:"20px", fontSize:"10px", cursor:"pointer", fontWeight:700 }}>
              {syncing ? "Syncing..." : "🔄 Sync iCals"}
            </button>
            <button onClick={()=>{setToken(null);setUser(null);}} style={{ background:"rgba(255,90,95,0.1)",border:"1px solid rgba(255,90,95,0.2)",borderRadius:"8px",color:"#FF7B7F",cursor:"pointer",padding:"4px 10px",fontSize:"10px" }}>Sign out</button>
          </div>
        </div>

        {/* ── PROPERTY UNIT BAR ── */}
        <div style={{ background:"rgba(110,86,207,0.05)",borderBottom:"1px solid rgba(110,86,207,0.12)",padding:"10px 24px",display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap" }}>
          {units.map(u=>(
              <button key={u.id} onClick={()=>setSelectedUnit(u)} style={{ padding:"5px 14px",borderRadius:"20px",border:`1px solid ${selectedUnit?.id===u.id?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:selectedUnit?.id===u.id?"rgba(110,86,207,0.2)":"transparent",color:selectedUnit?.id===u.id?"#C4B5FD":"rgba(255,255,255,0.4)",cursor:"pointer" }}>
                {u.name}
              </button>
          ))}
        </div>

        <div style={{ maxWidth:"920px",margin:"0 auto",padding:"20px 16px" }}>
          {activeTab==="dashboard" && <Dashboard units={units} sourceMap={sourceMap} allSources={allSources}/>}

          {activeTab==="calendar" && <>
            {/* Stats Overview Grid Widget Block */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"20px" }}>
              {[
                {label:"Bookings",   value:monthBks.filter(x=>x.status!=="cancelled").length, accent:"#C4B5FD"},
                {label:"Revenue",    value:`₹${totalRevenue.toLocaleString("en-IN")}`, accent:"#86EFAC"},
                {label:"Active Units", value:units.length, accent:"#A78BFA"},
                {label:"Occupancy",  value:(()=>{
                    const byDate={};
                    monthBks.forEach(b=>{if(!byDate[b.date])byDate[b.date]=[];byDate[b.date].push(b);});
                    const days=Object.values(byDate).reduce((s,bks)=>s+getDayOccupancy(bks),0);
                    return `${Math.round((days/daysInMonth)*100)}%`;
                  })(), accent:"#FCA5A5"},
              ].map(s=>(
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",padding:"12px 14px" }}>
                    <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"8px",textTransform:"uppercase" }}>{s.label}</div>
                    <div style={{ color:s.accent,fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{s.value}</div>
                  </div>
              ))}
            </div>

            {/* Inbound iCal Feed Reference Display Block */}
            {selectedUnit && (
                <div style={{ background: "rgba(255,255,255,0.02)", padding: "10px 16px", borderRadius: "8px", marginBottom: "20px", border: "1px solid rgba(255,255,255,0.06)", fontSize: "11px", color: "rgba(255,255,255,0.4)" }}>
                  📌 <strong>Inbound Platform Export URL:</strong> <span style={{ color:"#C4B5FD" }}>{window.location.origin}/api/bookings?action=export_ical&unit_id={selectedUnit.id}</span>
                </div>
            )}

            {/* ── PREVIOUS DESIGN CALENDAR NAV CONTAINER ── */}
            <div style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px 16px 0 0",padding:"16px 22px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <button onClick={prevMonth} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"34px",height:"34px",fontSize:"16px" }}>‹</button>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:900 }}>{MONTHS[currentMonth]}</div>
                <div style={{ color:"rgba(255,255,255,0.25)",fontSize:"11px" }}>{currentYear} · {selectedUnit?.name||""}</div>
              </div>
              <button onClick={nextMonth} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"34px",height:"34px",fontSize:"16px" }}>›</button>
            </div>

            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"rgba(255,255,255,0.02)",borderLeft:"1px solid rgba(255,255,255,0.08)",borderRight:"1px solid rgba(255,255,255,0.08)" }}>
              {DAYS.map(d=><div key={d} style={{ padding:"9px 0",textAlign:"center",color:"rgba(255,255,255,0.25)",fontSize:"9px",textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,0.06)" }}>{d}</div>)}
            </div>

            {/* Calendar Main Grid Blocks */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",border:"1px solid rgba(255,255,255,0.08)",borderTop:"none",borderRadius:"0 0 16px 16px",overflow:"hidden",background:"rgba(255,255,255,0.012)" }}>
              {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`} style={{ minHeight:"90px",background:"rgba(0,0,0,0.12)",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)" }}/>)}
              {Array.from({length:daysInMonth},(_,i)=>i+1).map(day=>{
                const dateStr=fmt(currentYear,currentMonth,day);
                const dayBks=getDay(dateStr);
                const occ=getDayOccupancy(dayBks);
                const occColor = occ>=1?"#FF5A5F":occ>=0.5?"#FFBD2E":"transparent";
                return (
                    <div key={day} onClick={()=>setModalState({type:"add",date:dateStr})} style={{ minHeight:"90px",padding:"7px 5px 5px",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",position:"relative" }}>
                      <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"4px" }}>
                        <span style={{ fontSize:"11px",color:"rgba(255,255,255,0.4)" }}>{day}</span>
                        {occ>0&&<div style={{ width:"6px",height:"6px",borderRadius:"50%",background:occColor }}/>}
                      </div>
                      {dayBks.map(b=><BookingBadge key={b.id} booking={b} sourceMap={sourceMap} onClick={bk=>setModalState({type:"detail",booking:bk})}/>)}
                    </div>
                );
              })}
            </div>
          </>}
        </div>

        {/* Operational Flow Modals */}
        <Modal isOpen={modalState?.type==="add"} onClose={()=>setModalState(null)}>
          <BookingForm date={modalState?.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={null} allSources={allSources}/>
        </Modal>
        <Modal isOpen={modalState?.type==="detail"} onClose={()=>setModalState(null)}>
          <BookingDetail booking={modalState?.booking} unit={selectedUnit} onClose={()=>setModalState(null)} onEdit={bk=>setModalState({type:"edit",booking:bk})} onDelete={handleDelete}/>
        </Modal>
        <Modal isOpen={modalState?.type==="edit"} onClose={()=>setModalState(null)}>
          <BookingForm date={modalState?.booking?.start_date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={modalState?.booking} allSources={allSources}/>
        </Modal>
      </div>
  );
}