import { useState, useEffect, useCallback } from "react";

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

const SOURCES = [
  { id:"direct",    label:"Direct",        icon:"🤝", color:"#60A5FA" },
  { id:"airbnb",    label:"Airbnb",        icon:"✈",  color:"#FF385C" },
  { id:"goibibo",   label:"GoIbibo / MMT", icon:"🏨", color:"#F59E0B" },
  { id:"ekant",     label:"Ekant",         icon:"👤", color:"#A78BFA" },
  { id:"urmit",     label:"Urmit",         icon:"👤", color:"#34D399" },
];

const SOURCE_MAP = Object.fromEntries(SOURCES.map(s => [s.id, s]));

function formatDate(y,m,d) { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function generateId()      { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2,12); }
function getToken()        { return localStorage.getItem("gcbm_token"); }
function setToken(t)       { if(t) localStorage.setItem("gcbm_token",t); else localStorage.removeItem("gcbm_token"); }

const API = "/api";

async function apiFetch(path, options={}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization:`Bearer ${token}` } : {}),
      ...(options.headers||{}),
    },
  });
  if (res.status === 401) { setToken(null); window.location.reload(); return; }
  if (!res.ok) { const t = await res.text(); throw new Error(t); }
  return res.json();
}

// ── Auth API ──────────────────────────────────────────────────────────────────
const Auth = {
  verify:   ()          => apiFetch("/auth?action=verify"),
  login:    (email,pwd) => apiFetch("/auth?action=login",    { method:"POST", body:JSON.stringify({email,password:pwd}) }),
  register: (email,pwd,name) => apiFetch("/auth?action=register", { method:"POST", body:JSON.stringify({email,password:pwd,name}) }),
  googleUrl: () => `${API}/auth?action=google`,
};

// ── Bookings API ──────────────────────────────────────────────────────────────
const BookingsAPI = {
  units:       ()         => apiFetch("/bookings?action=units"),
  addUnit:     (name,loc) => apiFetch("/bookings?action=units", { method:"POST", body:JSON.stringify({name,location:loc}) }),
  getBookings: (unitId)   => apiFetch(`/bookings?action=bookings&unit_id=${encodeURIComponent(unitId)}`),
  upsert:      (b)        => apiFetch("/bookings?action=bookings", { method:"POST", body:JSON.stringify(b) }),
  delete:      (id)       => apiFetch(`/bookings?action=bookings&id=${id}`, { method:"DELETE" }),
};

// ── Styles ────────────────────────────────────────────────────────────────────
const S = {
  inp: { background:"rgba(255,255,255,0.05)", border:"1px solid rgba(255,255,255,0.1)", borderRadius:"8px", color:"#F0EEF8", padding:"10px 14px", fontSize:"13px", fontFamily:"'DM Mono', monospace", width:"100%", outline:"none", boxSizing:"border-box" },
  lbl: { color:"rgba(255,255,255,0.45)", fontSize:"10px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:"5px" },
  btn: (accent="#6E56CF") => ({ padding:"11px", borderRadius:"8px", border:"none", background:`linear-gradient(135deg,${accent},${accent}cc)`, color:"#fff", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"12px", fontWeight:700, width:"100%", transition:"opacity 0.15s" }),
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN PAGE
// ─────────────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [tab, setTab]         = useState("login"); // login | register
  const [email, setEmail]     = useState("");
  const [name, setName]       = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm]   = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  // Handle token in URL hash (Google OAuth callback)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("token=")) {
      const token = hash.split("token=")[1];
      setToken(token);
      window.location.hash = "";
      window.location.reload();
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("error")) setError("Google sign-in was cancelled or failed. Please try again.");
  }, []);

  const handleSubmit = async () => {
    setError(""); setLoading(true);
    try {
      if (tab === "login") {
        const res = await Auth.login(email, password);
        setToken(res.token);
        onLogin(res.user);
      } else {
        if (password !== confirm) { setError("Passwords do not match."); setLoading(false); return; }
        if (password.length < 6) { setError("Password must be at least 6 characters."); setLoading(false); return; }
        const res = await Auth.register(email, password, name);
        setToken(res.token);
        onLogin(res.user);
      }
    } catch(e) {
      setError(e.message.includes("{") ? JSON.parse(e.message).error : e.message);
    }
    setLoading(false);
  };

  const inputFocus = e => e.target.style.borderColor = "rgba(110,86,207,0.7)";
  const inputBlur  = e => e.target.style.borderColor = "rgba(255,255,255,0.1)";

  return (
    <div style={{ minHeight:"100vh", background:"#0A0A12", display:"flex", alignItems:"center", justifyContent:"center", fontFamily:"'DM Mono', monospace", padding:"16px" }}>
      <div style={{ width:"100%", maxWidth:"400px" }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:"32px" }}>
          <div style={{ fontSize:"36px", marginBottom:"8px" }}>🏢</div>
          <div style={{ color:"#F0EEF8", fontSize:"22px", fontFamily:"'Playfair Display', serif", fontWeight:900 }}>Gaur City</div>
          <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"10px", letterSpacing:"0.2em", textTransform:"uppercase" }}>Booking Manager</div>
        </div>

        <div style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"16px", padding:"28px" }}>
          {/* Tabs */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px", background:"rgba(255,255,255,0.04)", borderRadius:"10px", padding:"4px", marginBottom:"24px" }}>
            {["login","register"].map(t => (
              <button key={t} onClick={()=>{setTab(t);setError("");}} style={{ padding:"8px", borderRadius:"8px", border:"none", background:tab===t?"rgba(110,86,207,0.5)":"transparent", color:tab===t?"#F0EEF8":"rgba(255,255,255,0.35)", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"11px", letterSpacing:"0.08em", transition:"all 0.15s", textTransform:"uppercase" }}>
                {t === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>

          {/* Google SSO */}
          <a href={Auth.googleUrl()} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"10px", padding:"11px", borderRadius:"10px", border:"1px solid rgba(255,255,255,0.12)", background:"rgba(255,255,255,0.04)", color:"#F0EEF8", textDecoration:"none", fontSize:"13px", fontFamily:"'DM Mono', monospace", marginBottom:"20px", transition:"background 0.15s" }}
            onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"}
            onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}>
            <svg width="18" height="18" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </a>

          <div style={{ display:"flex", alignItems:"center", gap:"12px", marginBottom:"20px" }}>
            <div style={{ flex:1, height:"1px", background:"rgba(255,255,255,0.08)" }} />
            <span style={{ color:"rgba(255,255,255,0.2)", fontSize:"10px", letterSpacing:"0.1em" }}>OR</span>
            <div style={{ flex:1, height:"1px", background:"rgba(255,255,255,0.08)" }} />
          </div>

          <div style={{ display:"grid", gap:"12px" }}>
            {tab === "register" && (
              <div>
                <label style={S.lbl}>Full Name</label>
                <input style={S.inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" onFocus={inputFocus} onBlur={inputBlur} />
              </div>
            )}
            <div>
              <label style={S.lbl}>Email</label>
              <input style={S.inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" onFocus={inputFocus} onBlur={inputBlur}
                onKeyDown={e=>e.key==="Enter"&&handleSubmit()} />
            </div>
            <div>
              <label style={S.lbl}>Password</label>
              <input style={S.inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onFocus={inputFocus} onBlur={inputBlur}
                onKeyDown={e=>e.key==="Enter"&&handleSubmit()} />
            </div>
            {tab === "register" && (
              <div>
                <label style={S.lbl}>Confirm Password</label>
                <input style={S.inp} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••" onFocus={inputFocus} onBlur={inputBlur}
                  onKeyDown={e=>e.key==="Enter"&&handleSubmit()} />
              </div>
            )}
          </div>

          {error && <div style={{ color:"#FF7B7F", fontSize:"11px", marginTop:"12px", padding:"8px 12px", background:"rgba(255,90,95,0.1)", borderRadius:"6px", border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}

          <button onClick={handleSubmit} disabled={loading} style={{ ...S.btn(), marginTop:"20px", opacity:loading?0.6:1 }}>
            {loading ? "Please wait…" : tab==="login" ? "Sign In" : "Create Account"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL
// ─────────────────────────────────────────────────────────────────────────────
function Modal({ isOpen, onClose, children }) {
  useEffect(()=>{
    const h=e=>{if(e.key==="Escape")onClose();};
    window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
  },[onClose]);
  if(!isOpen) return null;
  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, zIndex:1000, background:"rgba(10,10,18,0.8)", backdropFilter:"blur(6px)", display:"flex", alignItems:"center", justifyContent:"center", animation:"fadeIn 0.15s ease", padding:"16px" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:"#12121E", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"16px", padding:"28px", width:"100%", maxWidth:"460px", boxShadow:"0 24px 60px rgba(0,0,0,0.6)", animation:"slideUp 0.2s cubic-bezier(.34,1.4,.64,1)", maxHeight:"90vh", overflowY:"auto" }}>
        {children}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD UNIT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function AddUnitModal({ onAdd, onClose }) {
  const [name, setName]     = useState("");
  const [location, setLoc]  = useState("Gaur City Center, Greater Noida");
  const [saving, setSaving] = useState(false);
  const handleAdd = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await onAdd(name.trim(), location.trim());
    setSaving(false);
  };
  const inputFocus = e => e.target.style.borderColor="rgba(110,86,207,0.7)";
  const inputBlur  = e => e.target.style.borderColor="rgba(255,255,255,0.1)";
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
        <div style={{ color:"#F0EEF8", fontSize:"16px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>Add New Unit</div>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:"18px", width:"32px", height:"32px", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
      </div>
      <div style={{ display:"grid", gap:"14px" }}>
        <div>
          <label style={S.lbl}>Unit Name / Number</label>
          <input style={S.inp} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Unit 1627" onFocus={inputFocus} onBlur={inputBlur} />
        </div>
        <div>
          <label style={S.lbl}>Location</label>
          <input style={S.inp} value={location} onChange={e=>setLoc(e.target.value)} placeholder="e.g. Gaur City Center, Greater Noida" onFocus={inputFocus} onBlur={inputBlur} />
        </div>
      </div>
      <div style={{ display:"flex", gap:"10px", marginTop:"20px" }}>
        <button onClick={onClose} style={{ flex:1, padding:"10px", borderRadius:"8px", border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"12px" }}>Cancel</button>
        <button onClick={handleAdd} disabled={saving||!name.trim()} style={{ ...S.btn(), flex:2, opacity:saving||!name.trim()?0.5:1 }}>{saving?"Adding…":"Add Unit"}</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING FORM
// ─────────────────────────────────────────────────────────────────────────────
function BookingForm({ date, unit, onSave, onClose, editBooking, allUnits }) {
  const [form, setForm] = useState(editBooking || { guestName:"", source:"direct", checkIn:"14:00", checkOut:"11:00", amount:"", notes:"", overflowTo:"" });
  const [error, setError]   = useState("");
  const [saving, setSaving] = useState(false);
  const set = (f,v) => setForm(p=>({...p,[f]:v}));
  const inputFocus = e => e.target.style.borderColor="rgba(110,86,207,0.7)";
  const inputBlur  = e => e.target.style.borderColor="rgba(255,255,255,0.1)";

  const handleSave = async () => {
    if (!form.guestName.trim()) return setError("Guest name is required.");
    if (!form.amount||isNaN(Number(form.amount))||Number(form.amount)<0) return setError("Please enter a valid amount.");
    setError(""); setSaving(true);
    await onSave({ ...form, id:form.id||generateId(), date, unit_id:unit.id });
    setSaving(false);
  };

  const src = SOURCE_MAP[form.source] || SOURCES[0];

  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
        <div>
          <div style={{ color:"rgba(110,86,207,0.8)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"2px" }}>{unit.name} · {unit.location}</div>
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"4px" }}>{editBooking?"Edit Booking":"New Booking"}</div>
          <div style={{ color:"#F0EEF8", fontSize:"18px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>{date}</div>
        </div>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:"18px", width:"34px", height:"34px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>×</button>
      </div>

      <div style={{ display:"grid", gap:"14px" }}>
        <div>
          <label style={S.lbl}>Guest Name</label>
          <input style={S.inp} value={form.guestName} onChange={e=>set("guestName",e.target.value)} placeholder="e.g. Rahul Sharma" onFocus={inputFocus} onBlur={inputBlur} />
        </div>

        {/* Booking source */}
        <div>
          <label style={S.lbl}>Booking Source</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"6px" }}>
            {SOURCES.map(s=>(
              <button key={s.id} onClick={()=>set("source",s.id)} style={{ padding:"8px 6px", borderRadius:"8px", border:`1px solid ${form.source===s.id?s.color:"rgba(255,255,255,0.08)"}`, background:form.source===s.id?`${s.color}22`:"rgba(255,255,255,0.02)", color:form.source===s.id?s.color:"rgba(255,255,255,0.35)", fontFamily:"'DM Mono', monospace", fontSize:"10px", cursor:"pointer", fontWeight:600, transition:"all 0.15s", display:"flex", flexDirection:"column", alignItems:"center", gap:"3px" }}>
                <span style={{fontSize:"14px"}}>{s.icon}</span>
                <span style={{letterSpacing:"0.03em", fontSize:"9px", textAlign:"center"}}>{s.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Overflow to Ekant (shown if source is direct/airbnb/goibibo and capacity full) */}
        <div>
          <label style={S.lbl}>Overflow / Pass-on to <span style={{color:"#A78BFA"}}>Ekant</span> (optional)</label>
          <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
            <input type="checkbox" id="overflow" checked={form.overflowTo==="ekant"} onChange={e=>set("overflowTo",e.target.checked?"ekant":"")}
              style={{ width:"16px", height:"16px", cursor:"pointer", accentColor:"#A78BFA" }} />
            <label htmlFor="overflow" style={{ color:"rgba(255,255,255,0.5)", fontSize:"11px", fontFamily:"'DM Mono', monospace", cursor:"pointer" }}>
              Pass this booking to Ekant
            </label>
          </div>
        </div>

        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px" }}>
          <div><label style={S.lbl}>Check-In Time</label><input type="time" style={S.inp} value={form.checkIn} onChange={e=>set("checkIn",e.target.value)} /></div>
          <div><label style={S.lbl}>Check-Out Time</label><input type="time" style={S.inp} value={form.checkOut} onChange={e=>set("checkOut",e.target.value)} /></div>
        </div>
        <div>
          <label style={S.lbl}>Amount (₹)</label>
          <input style={S.inp} type="number" min="0" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="e.g. 2500" onFocus={inputFocus} onBlur={inputBlur} />
        </div>
        <div>
          <label style={S.lbl}>Notes (optional)</label>
          <textarea style={{...S.inp,resize:"vertical",minHeight:"56px"}} value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any special requests…" onFocus={inputFocus} onBlur={inputBlur} />
        </div>
      </div>

      {error && <div style={{ color:"#FF7B7F", fontSize:"11px", marginTop:"10px", padding:"8px 12px", background:"rgba(255,90,95,0.1)", borderRadius:"6px", border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}

      <div style={{ display:"flex", gap:"10px", marginTop:"20px" }}>
        <button onClick={onClose} style={{ flex:1, padding:"11px", borderRadius:"8px", border:"1px solid rgba(255,255,255,0.1)", background:"transparent", color:"rgba(255,255,255,0.4)", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"12px" }}>Cancel</button>
        <button onClick={handleSave} disabled={saving} style={{ ...S.btn(), flex:2, opacity:saving?0.6:1 }}>
          {saving?"Saving…":editBooking?"Update Booking":"Save Booking"}
        </button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING DETAIL
// ─────────────────────────────────────────────────────────────────────────────
function BookingDetail({ booking, unit, onClose, onEdit, onDelete }) {
  const [deleting, setDeleting] = useState(false);
  const src = SOURCE_MAP[booking.source] || SOURCES[0];
  const handleDelete = async()=>{setDeleting(true);await onDelete(booking.id,booking.date);setDeleting(false);};
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:"20px" }}>
        <div>
          <div style={{ color:"rgba(110,86,207,0.7)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>{unit?.name} · {unit?.location}</div>
          <div style={{ display:"inline-flex", alignItems:"center", gap:"5px", background:`${src.color}22`, border:`1px solid ${src.color}55`, borderRadius:"20px", padding:"3px 10px", marginBottom:"8px" }}>
            <span style={{fontSize:"10px"}}>{src.icon}</span>
            <span style={{ color:src.color, fontFamily:"'DM Mono', monospace", fontSize:"10px", letterSpacing:"0.08em", fontWeight:600 }}>{src.label.toUpperCase()}</span>
          </div>
          <div style={{ color:"#F0EEF8", fontSize:"20px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>{booking.guest_name||booking.guestName}</div>
          <div style={{ color:"rgba(255,255,255,0.35)", fontSize:"11px", fontFamily:"'DM Mono', monospace", marginTop:"2px" }}>{booking.date}</div>
        </div>
        <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:"18px", width:"34px", height:"34px", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}>×</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"10px", marginBottom:"14px" }}>
        {[{label:"Check-In",value:booking.check_in||booking.checkIn,icon:"⬆"},{label:"Check-Out",value:booking.check_out||booking.checkOut,icon:"⬇"}].map(item=>(
          <div key={item.label} style={{ background:"rgba(255,255,255,0.04)", borderRadius:"10px", padding:"12px 14px", border:"1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ color:"rgba(255,255,255,0.35)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", marginBottom:"4px" }}>{item.icon} {item.label.toUpperCase()}</div>
            <div style={{ color:"#F0EEF8", fontSize:"20px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>{item.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background:"linear-gradient(135deg,rgba(110,86,207,0.12),rgba(155,127,232,0.07))", borderRadius:"10px", padding:"14px 16px", border:"1px solid rgba(110,86,207,0.2)", marginBottom:"14px", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
        <div style={{ color:"rgba(255,255,255,0.4)", fontSize:"10px", fontFamily:"'DM Mono', monospace" }}>AMOUNT</div>
        <div style={{ color:"#C4B5FD", fontSize:"22px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>₹{Number(booking.amount).toLocaleString("en-IN")}</div>
      </div>

      {(booking.overflow_to||booking.overflowTo) && (
        <div style={{ background:"rgba(167,139,250,0.08)", borderRadius:"10px", padding:"10px 14px", border:"1px solid rgba(167,139,250,0.2)", marginBottom:"14px", display:"flex", alignItems:"center", gap:"8px" }}>
          <span style={{fontSize:"14px"}}>👤</span>
          <div>
            <div style={{ color:"rgba(167,139,250,0.7)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase" }}>Overflow Passed To</div>
            <div style={{ color:"#C4B5FD", fontSize:"13px", fontFamily:"'DM Mono', monospace", fontWeight:600, textTransform:"capitalize" }}>{booking.overflow_to||booking.overflowTo}</div>
          </div>
        </div>
      )}

      {(booking.notes) && (
        <div style={{ background:"rgba(255,255,255,0.03)", borderRadius:"10px", padding:"12px 14px", border:"1px solid rgba(255,255,255,0.06)", marginBottom:"14px" }}>
          <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", marginBottom:"5px" }}>NOTES</div>
          <div style={{ color:"rgba(255,255,255,0.65)", fontSize:"13px", fontFamily:"'DM Mono', monospace", lineHeight:1.5 }}>{booking.notes}</div>
        </div>
      )}

      <div style={{ display:"flex", gap:"10px" }}>
        <button onClick={handleDelete} disabled={deleting} style={{ flex:1, padding:"10px", borderRadius:"8px", border:"1px solid rgba(255,90,95,0.3)", background:"rgba(255,90,95,0.08)", color:"#FF7B7F", cursor:deleting?"not-allowed":"pointer", fontFamily:"'DM Mono', monospace", fontSize:"11px" }}>{deleting?"Deleting…":"Delete"}</button>
        <button onClick={()=>onEdit(booking)} style={{ flex:2, padding:"10px", borderRadius:"8px", border:"none", background:"linear-gradient(135deg,#6E56CF,#9B7FE8)", color:"#fff", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"11px", fontWeight:700 }}>Edit Booking</button>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS BADGE
// ─────────────────────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg={
    loading:{ bg:"rgba(255,189,46,0.12)", border:"rgba(255,189,46,0.3)",  color:"#FFBD2E", dot:"#FFBD2E", label:"Connecting…" },
    saving: { bg:"rgba(110,86,207,0.12)", border:"rgba(110,86,207,0.3)",  color:"#C4B5FD", dot:"#9B7FE8", label:"Saving…" },
    saved:  { bg:"rgba(39,201,63,0.1)",   border:"rgba(39,201,63,0.25)",  color:"#74C69D", dot:"#27C93F", label:"✦ Synced" },
    error:  { bg:"rgba(255,90,95,0.1)",   border:"rgba(255,90,95,0.3)",   color:"#FF7B7F", dot:"#FF5A5F", label:"⚠ DB error" },
  }[status]||{};
  return (
    <div style={{ display:"flex", alignItems:"center", gap:"6px", background:cfg.bg, border:`1px solid ${cfg.border}`, borderRadius:"20px", padding:"4px 12px" }}>
      <div style={{ width:"6px", height:"6px", borderRadius:"50%", background:cfg.dot, animation:(status==="saving"||status==="loading")?"pulse 1s infinite":"none" }} />
      <span style={{ color:cfg.color, fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em" }}>{cfg.label}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BOOKING BADGE (on calendar)
// ─────────────────────────────────────────────────────────────────────────────
function BookingBadge({ booking, onClick }) {
  const src = SOURCE_MAP[booking.source] || SOURCES[0];
  const guestName = booking.guest_name || booking.guestName || "";
  return (
    <div onClick={e=>{e.stopPropagation();onClick(booking);}} style={{ background:`linear-gradient(135deg,${src.color}cc,${src.color}88)`, color:"#fff", borderRadius:"4px", padding:"2px 5px", fontSize:"10px", fontFamily:"'DM Mono', monospace", fontWeight:600, cursor:"pointer", marginBottom:"2px", display:"flex", alignItems:"center", gap:"3px", overflow:"hidden", whiteSpace:"nowrap", textOverflow:"ellipsis", transition:"transform 0.12s" }}
      onMouseEnter={e=>e.currentTarget.style.transform="scale(1.03)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
      <span style={{fontSize:"9px",flexShrink:0}}>{src.icon}</span>
      <span style={{overflow:"hidden",textOverflow:"ellipsis"}}>{guestName||src.label}</span>
      {(booking.overflow_to||booking.overflowTo) && <span title="Overflow to Ekant" style={{fontSize:"8px",flexShrink:0,opacity:0.8}}>↗</span>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP
// ─────────────────────────────────────────────────────────────────────────────
export default function App() {
  const today = new Date();
  const [user, setUser]                   = useState(null);
  const [authChecked, setAuthChecked]     = useState(false);
  const [units, setUnits]                 = useState([]);
  const [selectedUnit, setSelectedUnit]   = useState(null);
  const [bookings, setBookings]           = useState({});
  const [currentYear, setCurrentYear]     = useState(today.getFullYear());
  const [currentMonth, setCurrentMonth]   = useState(today.getMonth());
  const [status, setStatus]               = useState("loading");
  const [dbError, setDbError]             = useState("");
  const [modalState, setModalState]       = useState(null);

  // ── Auth check on mount ───────────────────────────────────────────────────
  useEffect(()=>{
    const token = getToken();
    if (!token) { setAuthChecked(true); return; }
    Auth.verify()
      .then(res=>{ setUser(res.user); setAuthChecked(true); })
      .catch(()=>{ setToken(null); setAuthChecked(true); });
  },[]);

  // ── Load units after login ────────────────────────────────────────────────
  useEffect(()=>{
    if (!user) return;
    BookingsAPI.units()
      .then(list=>{ setUnits(list); if(list.length) setSelectedUnit(list[0]); })
      .catch(e=>setDbError(e.message));
  },[user]);

  // ── Load bookings when unit or month changes ──────────────────────────────
  useEffect(()=>{
    if (!selectedUnit) return;
    setStatus("loading"); setBookings({});
    BookingsAPI.getBookings(selectedUnit.id)
      .then(rows=>{
        const map={};
        for(const row of rows){
          const b={id:row.id,date:row.date,unit_id:row.unit_id,guestName:row.guest_name,source:row.source,checkIn:row.check_in,checkOut:row.check_out,amount:row.amount,notes:row.notes||"",overflowTo:row.overflow_to||""};
          if(!map[row.date])map[row.date]=[];
          map[row.date].push(b);
        }
        setBookings(map); setStatus("saved"); setDbError("");
      })
      .catch(e=>{ setStatus("error"); setDbError(e.message); });
  },[selectedUnit]);

  const firstDay    = new Date(currentYear, currentMonth, 1).getDay();
  const daysInMonth = new Date(currentYear, currentMonth+1, 0).getDate();
  const prevMonth   = ()=>{ if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1); };
  const nextMonth   = ()=>{ if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1); };
  const getBookingsForDate = d => bookings[d]||[];

  const handleAddUnit = async(name,loc)=>{
    const list = await BookingsAPI.addUnit(name,loc);
    setUnits(list);
    const newUnit = list.find(u=>u.name===name&&u.location===loc);
    if(newUnit) setSelectedUnit(newUnit);
    setModalState(null);
  };

  const handleDayClick = day=>{
    const dateStr=formatDate(currentYear,currentMonth,day);
    if(getBookingsForDate(dateStr).length>=2) return;
    setModalState({type:"add",date:dateStr});
  };

  const handleSave = async booking=>{
    setStatus("saving");
    try {
      await BookingsAPI.upsert({
        id:booking.id, unit_id:booking.unit_id||selectedUnit.id,
        date:booking.date, guest_name:booking.guestName, source:booking.source,
        check_in:booking.checkIn, check_out:booking.checkOut,
        amount:Number(booking.amount), notes:booking.notes||"",
        overflow_to:booking.overflowTo||null,
      });
      const updated={...bookings};
      const list=updated[booking.date]?[...updated[booking.date]]:[];
      if(modalState.type==="edit"){const idx=list.findIndex(b=>b.id===booking.id);if(idx!==-1)list[idx]=booking;else list.push(booking);}
      else list.push(booking);
      updated[booking.date]=list;
      setBookings(updated); setStatus("saved"); setDbError("");
    } catch(e){ setStatus("error"); setDbError(e.message); }
    setModalState(null);
  };

  const handleDelete = async(id,date)=>{
    setStatus("saving");
    try {
      await BookingsAPI.delete(id);
      const updated={...bookings};
      updated[date]=(updated[date]||[]).filter(b=>b.id!==id);
      if(updated[date].length===0)delete updated[date];
      setBookings(updated); setStatus("saved"); setDbError("");
    } catch(e){ setStatus("error"); setDbError(e.message); }
    setModalState(null);
  };

  const handleLogout=()=>{ setToken(null); setUser(null); setBookings({}); setUnits([]); setSelectedUnit(null); };

  // ── Loading spinner ───────────────────────────────────────────────────────
  if (!authChecked) return (
    <div style={{ minHeight:"100vh", background:"#0A0A12", display:"flex", alignItems:"center", justifyContent:"center" }}>
      <div style={{ color:"rgba(255,255,255,0.3)", fontFamily:"'DM Mono', monospace", fontSize:"12px", letterSpacing:"0.1em" }}>Loading…</div>
    </div>
  );

  if (!user) return <LoginPage onLogin={u=>setUser(u)} />;

  const monthPrefix  = `${currentYear}-${String(currentMonth+1).padStart(2,"0")}`;
  const monthBks     = Object.entries(bookings).filter(([d])=>d.startsWith(monthPrefix)).flatMap(([,l])=>l);
  const totalRevenue = monthBks.reduce((s,b)=>s+Number(b.amount||0),0);
  const todayStr     = formatDate(today.getFullYear(),today.getMonth(),today.getDate());

  // Group units by location
  const unitsByLocation = units.reduce((acc,u)=>{
    const loc = u.location||"Other";
    if(!acc[loc]) acc[loc]=[];
    acc[loc].push(u);
    return acc;
  },{});

  return (
    <div style={{ minHeight:"100vh", background:"#0A0A12", fontFamily:"'DM Mono', monospace", overflowX:"hidden" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500;600&display=swap');
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(28px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        *{box-sizing:border-box}
        input[type="time"]::-webkit-calendar-picker-indicator{filter:invert(0.6)}
        textarea{font-family:'DM Mono',monospace!important}
        select option{background:#1a1a2e}
        ::-webkit-scrollbar{width:4px}
        ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
      `}</style>

      {/* ── Header ── */}
      <div style={{ background:"rgba(255,255,255,0.02)", borderBottom:"1px solid rgba(255,255,255,0.06)", padding:"14px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:"10px" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"12px" }}>
          <span style={{fontSize:"22px"}}>🏢</span>
          <div>
            <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"8px", letterSpacing:"0.2em", textTransform:"uppercase" }}>Gaur City Center</div>
            <div style={{ color:"#F0EEF8", fontSize:"18px", fontFamily:"'Playfair Display', serif", fontWeight:900, letterSpacing:"-0.01em" }}>Booking Manager</div>
          </div>
        </div>
        <div style={{ display:"flex", alignItems:"center", gap:"10px" }}>
          <StatusBadge status={status} />
          {user.avatar && <img src={user.avatar} alt="" style={{ width:"30px", height:"30px", borderRadius:"50%", border:"2px solid rgba(110,86,207,0.5)" }} />}
          <div style={{ color:"rgba(255,255,255,0.4)", fontSize:"10px", fontFamily:"'DM Mono', monospace", maxWidth:"140px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.name||user.email}</div>
          <button onClick={handleLogout} style={{ background:"rgba(255,90,95,0.1)", border:"1px solid rgba(255,90,95,0.2)", borderRadius:"8px", color:"#FF7B7F", cursor:"pointer", padding:"5px 10px", fontSize:"10px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.06em" }}>Sign out</button>
        </div>
      </div>

      {/* ── Unit selector bar ── */}
      <div style={{ background:"rgba(110,86,207,0.05)", borderBottom:"1px solid rgba(110,86,207,0.12)", padding:"10px 24px", display:"flex", alignItems:"center", gap:"8px", flexWrap:"wrap", overflowX:"auto" }}>
        <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"9px", letterSpacing:"0.12em", textTransform:"uppercase", whiteSpace:"nowrap" }}>Unit:</span>
        {units.map(u=>(
          <button key={u.id} onClick={()=>setSelectedUnit(u)} style={{ padding:"5px 14px", borderRadius:"20px", border:`1px solid ${selectedUnit?.id===u.id?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`, background:selectedUnit?.id===u.id?"rgba(110,86,207,0.2)":"transparent", color:selectedUnit?.id===u.id?"#C4B5FD":"rgba(255,255,255,0.4)", fontFamily:"'DM Mono', monospace", fontSize:"11px", cursor:"pointer", whiteSpace:"nowrap", transition:"all 0.15s", fontWeight:selectedUnit?.id===u.id?600:400 }}>
            {u.name}
            <span style={{ color:"rgba(255,255,255,0.25)", fontSize:"9px", marginLeft:"4px" }}>· {u.location.split(",")[0]}</span>
          </button>
        ))}
        <button onClick={()=>setModalState({type:"addUnit"})} style={{ padding:"5px 12px", borderRadius:"20px", border:"1px dashed rgba(255,255,255,0.12)", background:"transparent", color:"rgba(255,255,255,0.3)", fontFamily:"'DM Mono', monospace", fontSize:"11px", cursor:"pointer", whiteSpace:"nowrap", transition:"all 0.15s" }}
          onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(110,86,207,0.5)";e.currentTarget.style.color="#C4B5FD";}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.12)";e.currentTarget.style.color="rgba(255,255,255,0.3)";}}>
          + Add Unit
        </button>
      </div>

      {dbError&&<div style={{ background:"rgba(255,90,95,0.08)", borderBottom:"1px solid rgba(255,90,95,0.2)", padding:"10px 24px", color:"#FF7B7F", fontSize:"11px" }}>⚠ {dbError}</div>}

      <div style={{ maxWidth:"880px", margin:"0 auto", padding:"20px 16px" }}>

        {/* ── Stats ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:"10px", marginBottom:"20px" }}>
          {[
            {label:"Bookings",   value:monthBks.length,                                        accent:"#C4B5FD"},
            {label:"Revenue",    value:`₹${totalRevenue.toLocaleString("en-IN")}`,             accent:"#86EFAC"},
            {label:"Overflow ↗", value:monthBks.filter(b=>b.overflowTo).length,               accent:"#A78BFA"},
            {label:"Occupancy",  value:`${Math.round((monthBks.length/(daysInMonth*2))*100)}%`,accent:"#FCA5A5"},
          ].map(s=>(
            <div key={s.label} style={{ background:"rgba(255,255,255,0.03)", border:"1px solid rgba(255,255,255,0.07)", borderRadius:"12px", padding:"12px 14px" }}>
              <div style={{ color:"rgba(255,255,255,0.3)", fontSize:"8px", letterSpacing:"0.12em", textTransform:"uppercase", marginBottom:"4px" }}>{s.label}</div>
              <div style={{ color:s.accent, fontSize:"18px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* ── Source breakdown ── */}
        <div style={{ display:"flex", gap:"8px", marginBottom:"20px", flexWrap:"wrap" }}>
          {SOURCES.map(src=>{
            const count = monthBks.filter(b=>b.source===src.id).length;
            return (
              <div key={src.id} style={{ background:`${src.color}11`, border:`1px solid ${src.color}33`, borderRadius:"8px", padding:"6px 12px", display:"flex", alignItems:"center", gap:"6px" }}>
                <span style={{fontSize:"12px"}}>{src.icon}</span>
                <span style={{ color:src.color, fontSize:"10px", fontFamily:"'DM Mono', monospace", fontWeight:600 }}>{src.label}</span>
                <span style={{ background:`${src.color}33`, color:src.color, borderRadius:"10px", padding:"1px 6px", fontSize:"10px", fontFamily:"'DM Mono', monospace", fontWeight:700 }}>{count}</span>
              </div>
            );
          })}
        </div>

        {/* ── Calendar nav ── */}
        <div style={{ background:"rgba(255,255,255,0.025)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:"16px 16px 0 0", padding:"16px 22px", display:"flex", alignItems:"center", justifyContent:"space-between" }}>
          <button onClick={prevMonth} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", width:"34px", height:"34px", fontSize:"16px", display:"flex", alignItems:"center", justifyContent:"center" }} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>‹</button>
          <div style={{ textAlign:"center" }}>
            <div style={{ color:"#F0EEF8", fontSize:"20px", fontFamily:"'Playfair Display', serif", fontWeight:900 }}>{MONTHS[currentMonth]}</div>
            <div style={{ color:"rgba(255,255,255,0.25)", fontSize:"11px", letterSpacing:"0.12em" }}>{currentYear} · {selectedUnit?.name||""}</div>
          </div>
          <button onClick={nextMonth} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", width:"34px", height:"34px", fontSize:"16px", display:"flex", alignItems:"center", justifyContent:"center" }} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>›</button>
        </div>

        {/* ── Day labels ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", background:"rgba(255,255,255,0.02)", borderLeft:"1px solid rgba(255,255,255,0.08)", borderRight:"1px solid rgba(255,255,255,0.08)" }}>
          {DAYS.map(d=><div key={d} style={{ padding:"9px 0", textAlign:"center", color:d==="Sun"||d==="Sat"?"rgba(155,127,232,0.5)":"rgba(255,255,255,0.25)", fontSize:"9px", letterSpacing:"0.1em", textTransform:"uppercase", borderBottom:"1px solid rgba(255,255,255,0.06)" }}>{d}</div>)}
        </div>

        {/* ── Calendar grid ── */}
        <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", border:"1px solid rgba(255,255,255,0.08)", borderTop:"none", borderRadius:"0 0 16px 16px", overflow:"hidden", background:"rgba(255,255,255,0.012)" }}>
          {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`} style={{ minHeight:"86px", borderRight:"1px solid rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.04)", background:"rgba(0,0,0,0.12)" }} />)}
          {Array.from({length:daysInMonth},(_,i)=>i+1).map(day=>{
            const dateStr=formatDate(currentYear,currentMonth,day);
            const dayBks=getBookingsForDate(dateStr);
            const isToday=dateStr===todayStr, isFull=dayBks.length>=2, hasBooking=dayBks.length>0;
            const isWeekend=(firstDay+day-1)%7===0||(firstDay+day-1)%7===6;
            const hasOverflow=dayBks.some(b=>b.overflowTo||b.overflow_to);
            return (
              <div key={day} onClick={()=>handleDayClick(day)} style={{ minHeight:"86px", padding:"7px 5px 5px", borderRight:"1px solid rgba(255,255,255,0.04)", borderBottom:"1px solid rgba(255,255,255,0.04)", cursor:isFull?"not-allowed":"pointer", background:isToday?"rgba(110,86,207,0.08)":hasBooking?"rgba(255,255,255,0.015)":"transparent", transition:"background 0.15s", position:"relative" }}
                onMouseEnter={e=>{if(!isFull)e.currentTarget.style.background=isToday?"rgba(110,86,207,0.12)":"rgba(255,255,255,0.035)";}}
                onMouseLeave={e=>{e.currentTarget.style.background=isToday?"rgba(110,86,207,0.08)":hasBooking?"rgba(255,255,255,0.015)":"transparent";}}>
                <div style={{ width:"22px", height:"22px", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", background:isToday?"linear-gradient(135deg,#6E56CF,#9B7FE8)":"transparent", color:isToday?"#fff":isWeekend?"rgba(155,127,232,0.6)":"rgba(255,255,255,0.4)", fontSize:"11px", fontWeight:isToday?700:400, marginBottom:"3px", boxShadow:isToday?"0 2px 8px rgba(110,86,207,0.5)":"none" }}>{day}</div>
                {dayBks.map(b=><BookingBadge key={b.id} booking={b} onClick={bk=>setModalState({type:"detail",booking:bk})} />)}
                {isFull&&<div style={{ position:"absolute", top:"4px", right:"4px", width:"6px", height:"6px", borderRadius:"50%", background:"#FF5A5F", boxShadow:"0 0 4px rgba(255,90,95,0.6)" }} title="Fully booked" />}
                {hasOverflow&&<div style={{ position:"absolute", top:isFull?"12px":"4px", right:"4px", fontSize:"8px", opacity:0.7 }} title="Overflow to Ekant">↗</div>}
                {!isFull&&!hasBooking&&<div style={{ color:"rgba(255,255,255,0.08)", fontSize:"16px", textAlign:"center", marginTop:"4px" }}>+</div>}
              </div>
            );
          })}
        </div>

        {/* ── Legend ── */}
        <div style={{ display:"flex", gap:"12px", marginTop:"14px", flexWrap:"wrap", justifyContent:"center" }}>
          {SOURCES.map(s=>(
            <div key={s.id} style={{ display:"flex", alignItems:"center", gap:"5px", color:"rgba(255,255,255,0.3)", fontSize:"9px" }}>
              <div style={{ width:"12px", height:"7px", borderRadius:"3px", background:s.color }} />
              <span style={{fontSize:"9px"}}>{s.icon}</span>
              {s.label}
            </div>
          ))}
          <div style={{ display:"flex", alignItems:"center", gap:"5px", color:"rgba(255,255,255,0.3)", fontSize:"9px" }}>
            <div style={{ width:"8px", height:"8px", borderRadius:"50%", background:"#FF5A5F" }} />
            Fully Booked
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:"5px", color:"rgba(255,255,255,0.3)", fontSize:"9px" }}>
            <span>↗</span> Overflow → Ekant
          </div>
        </div>
      </div>

      {/* ── Modals ── */}
      <Modal isOpen={modalState?.type==="addUnit"} onClose={()=>setModalState(null)}>
        <AddUnitModal onAdd={handleAddUnit} onClose={()=>setModalState(null)} />
      </Modal>
      <Modal isOpen={modalState?.type==="add"} onClose={()=>setModalState(null)}>
        <BookingForm date={modalState?.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={null} allUnits={units} />
      </Modal>
      <Modal isOpen={modalState?.type==="detail"} onClose={()=>setModalState(null)}>
        {modalState?.type==="detail"&&<BookingDetail booking={modalState.booking} unit={selectedUnit} onClose={()=>setModalState(null)} onEdit={bk=>setModalState({type:"edit",booking:bk})} onDelete={handleDelete} />}
      </Modal>
      <Modal isOpen={modalState?.type==="edit"} onClose={()=>setModalState(null)}>
        {modalState?.type==="edit"&&<BookingForm date={modalState.booking.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={modalState.booking} allUnits={units} />}
      </Modal>
    </div>
  );
}
