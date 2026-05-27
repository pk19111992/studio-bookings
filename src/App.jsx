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
// Ekant is excluded from the 2-booking cap
const CAPPED_SOURCES = ["direct","airbnb","goibibo","urmit"];

function isHalfDay(booking) {
  const src = booking.source || booking.source;
  if (["ekant","urmit","direct"].includes(src)) return Number(booking.amount) <= 1500;
  return false; // airbnb/goibibo always full day
}

function getDayOccupancy(dayBookings) {
  // Separate ekant from capped bookings
  const capped = dayBookings.filter(b => CAPPED_SOURCES.includes(b.source));
  const ekant  = dayBookings.filter(b => b.source === "ekant");
  // Each capped booking: full day or half day by price/source
  let cappedDays = capped.reduce((sum, b) => sum + (isHalfDay(b) ? 0.5 : 1), 0);
  // 2 capped = full day. Cap at 1.
  cappedDays = Math.min(cappedDays, 1);
  // Ekant: each booking contributes 0.5 or 1 day independently
  const ekantDays = ekant.reduce((sum, b) => sum + (isHalfDay(b) ? 0.5 : 1), 0);
  return Math.min(cappedDays + ekantDays, 1); // total occupancy capped at 1 day
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
  updateProfile:   (data)       => apiFetch("/auth?action=profile",         { method:"PATCH", body:JSON.stringify(data) }),
  changePassword:  (cur,nw)     => apiFetch("/auth?action=change-password", { method:"POST",  body:JSON.stringify({currentPassword:cur,newPassword:nw}) }),
  allUsers:        ()           => apiFetch("/bookings?action=users"),
  units:           ()           => apiFetch("/bookings?action=units"),
  addUnit:         (n,l)        => apiFetch("/bookings?action=units",        { method:"POST", body:JSON.stringify({name:n,location:l}) }),
  bookings:        (uid)        => apiFetch(`/bookings?action=bookings&unit_id=${encodeURIComponent(uid)}`),
  stats:           (uid,month)  => apiFetch(`/bookings?action=stats&unit_id=${encodeURIComponent(uid)}&month=${month}`),
  allStats:        (month)      => apiFetch(`/bookings?action=stats&month=${month}`),
  upsert:          (b)          => apiFetch("/bookings?action=bookings",     { method:"POST", body:JSON.stringify(b) }),
  deleteBooking:   (id)         => apiFetch(`/bookings?action=bookings&id=${id}`, { method:"DELETE" }),
  getPerms:        (uid)        => apiFetch(`/bookings?action=permissions&unit_id=${encodeURIComponent(uid)}`),
  grantPerm:       (uid,userId) => apiFetch("/bookings?action=permissions",  { method:"POST", body:JSON.stringify({unit_id:uid,user_id:userId}) }),
  revokePerm:      (uid,userId) => apiFetch(`/bookings?action=permissions&unit_id=${encodeURIComponent(uid)}&user_id=${userId}`, { method:"DELETE" }),
};

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal({ user, onClose, onUpdate }) {
  const [tab, setTab]           = useState("profile"); // profile | password
  const [name, setName]         = useState(user.name||"");
  const [bio, setBio]           = useState(user.bio||"");
  const [phone, setPhone]       = useState(user.phone||"");
  const [avatarUrl, setAvatarUrl] = useState(user.avatar||"");
  const [avatarPreview, setAvatarPreview] = useState(user.avatar||"");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw]         = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState({ text:"", type:"" });

  const fi = e => e.target.style.borderColor = "rgba(110,86,207,0.7)";
  const fb = e => e.target.style.borderColor = "rgba(255,255,255,0.1)";

  const showMsg = (text, type="success") => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text:"", type:"" }), 3000);
  };

  const handleAvatarUrl = (url) => {
    setAvatarUrl(url);
    setAvatarPreview(url);
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return showMsg("Please select an image file", "error");
    if (file.size > 2 * 1024 * 1024) return showMsg("Image must be under 2MB", "error");
    const reader = new FileReader();
    reader.onload = (ev) => {
      setAvatarPreview(ev.target.result);
      setAvatarUrl(ev.target.result); // base64 data URL
    };
    reader.readAsDataURL(file);
  };

  const saveProfile = async () => {
    if (!name.trim()) return showMsg("Name cannot be empty", "error");
    setSaving(true);
    try {
      const res = await API2.updateProfile({ name:name.trim(), bio:bio.trim(), phone:phone.trim(), avatar:avatarUrl });
      setToken(res.token);
      onUpdate(res.user);
      showMsg("Profile updated successfully ✓");
    } catch(e) {
      showMsg(e.message.includes("{") ? JSON.parse(e.message).error : e.message, "error");
    }
    setSaving(false);
  };

  const savePassword = async () => {
    if (!currentPw) return showMsg("Enter your current password", "error");
    if (newPw.length < 6) return showMsg("New password must be 6+ characters", "error");
    if (newPw !== confirmPw) return showMsg("New passwords don't match", "error");
    if (newPw === currentPw) return showMsg("New password must differ from current", "error");
    setSaving(true);
    try {
      await API2.changePassword(currentPw, newPw);
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      showMsg("Password changed successfully ✓");
    } catch(e) {
      showMsg(e.message.includes("{") ? JSON.parse(e.message).error : e.message, "error");
    }
    setSaving(false);
  };

  const initials = (name||user.email||"?")[0].toUpperCase();

  return (
      <>
        {/* Header */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"20px" }}>
          <div style={{ color:"#F0EEF8", fontSize:"16px", fontFamily:"'Playfair Display', serif", fontWeight:700 }}>My Profile</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)", border:"none", borderRadius:"8px", color:"rgba(255,255,255,0.5)", cursor:"pointer", fontSize:"18px", width:"32px", height:"32px", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
        </div>

        {/* Avatar section */}
        <div style={{ display:"flex", alignItems:"center", gap:"16px", padding:"16px", background:"rgba(255,255,255,0.03)", borderRadius:"12px", border:"1px solid rgba(255,255,255,0.07)", marginBottom:"20px" }}>
          <div style={{ position:"relative", flexShrink:0 }}>
            {avatarPreview
                ? <img src={avatarPreview} alt="avatar" style={{ width:"64px", height:"64px", borderRadius:"50%", objectFit:"cover", border:"3px solid rgba(110,86,207,0.5)" }} onError={()=>setAvatarPreview("")} />
                : <div style={{ width:"64px", height:"64px", borderRadius:"50%", background:"linear-gradient(135deg,#6E56CF,#9B7FE8)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:"24px", fontWeight:700, color:"#fff", border:"3px solid rgba(110,86,207,0.5)" }}>{initials}</div>
            }
            <label htmlFor="avatar-upload" style={{ position:"absolute", bottom:"-2px", right:"-2px", width:"22px", height:"22px", background:"linear-gradient(135deg,#6E56CF,#9B7FE8)", borderRadius:"50%", display:"flex", alignItems:"center", justifyContent:"center", cursor:"pointer", fontSize:"11px", border:"2px solid #0A0A12" }} title="Upload photo">
              📷
              <input id="avatar-upload" type="file" accept="image/*" onChange={handleFileUpload} style={{ display:"none" }} />
            </label>
          </div>
          <div style={{ flex:1, minWidth:0 }}>
            <div style={{ color:"#F0EEF8", fontSize:"14px", fontFamily:"'Playfair Display', serif", fontWeight:700, marginBottom:"2px" }}>{user.name||"—"}</div>
            <div style={{ color:"rgba(255,255,255,0.35)", fontSize:"11px", fontFamily:"'DM Mono', monospace", marginBottom:"6px", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{user.email}</div>
            <div style={{ display:"flex", gap:"6px" }}>
              <span style={{ background:user.role==="admin"?"rgba(110,86,207,0.3)":"rgba(255,255,255,0.08)", color:user.role==="admin"?"#C4B5FD":"rgba(255,255,255,0.4)", borderRadius:"4px", padding:"2px 7px", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.08em" }}>{user.role==="admin"?"ADMIN":"USER"}</span>
              <span style={{ background:"rgba(255,255,255,0.05)", color:"rgba(255,255,255,0.3)", borderRadius:"4px", padding:"2px 7px", fontSize:"9px", fontFamily:"'DM Mono', monospace" }}>{user.provider==="google"?"Google":"Email"}</span>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"4px", background:"rgba(255,255,255,0.04)", borderRadius:"10px", padding:"4px", marginBottom:"20px" }}>
          {[["profile","✏ Edit Profile"],["password","🔒 Password"]].map(([t,l])=>(
              <button key={t} onClick={()=>setTab(t)} style={{ padding:"8px", borderRadius:"8px", border:"none", background:tab===t?"rgba(110,86,207,0.5)":"transparent", color:tab===t?"#F0EEF8":"rgba(255,255,255,0.35)", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"11px", letterSpacing:"0.06em", transition:"all 0.15s" }}>{l}</button>
          ))}
        </div>

        {/* Message */}
        {msg.text && (
            <div style={{ color:msg.type==="error"?"#FF7B7F":"#74C69D", fontSize:"11px", marginBottom:"14px", padding:"8px 12px", background:msg.type==="error"?"rgba(255,90,95,0.1)":"rgba(39,201,63,0.08)", borderRadius:"6px", border:`1px solid ${msg.type==="error"?"rgba(255,90,95,0.2)":"rgba(39,201,63,0.2)"}` }}>
              {msg.type==="error"?"⚠":"✓"} {msg.text}
            </div>
        )}

        {/* ── Profile Tab ── */}
        {tab === "profile" && (
            <div style={{ display:"grid", gap:"14px" }}>
              <div>
                <label style={lbl}>Display Name</label>
                <input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" onFocus={fi} onBlur={fb}/>
              </div>
              <div>
                <label style={lbl}>Phone Number</label>
                <input style={inp} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91 98765 43210" onFocus={fi} onBlur={fb}/>
              </div>
              <div>
                <label style={lbl}>Bio</label>
                <textarea style={{ ...inp, resize:"vertical", minHeight:"70px" }} value={bio} onChange={e=>setBio(e.target.value)} placeholder="A short bio about yourself…" onFocus={fi} onBlur={fb}/>
              </div>
              <div>
                <label style={lbl}>Avatar URL (or upload above)</label>
                <input style={inp} value={avatarUrl} onChange={e=>handleAvatarUrl(e.target.value)} placeholder="https://example.com/photo.jpg" onFocus={fi} onBlur={fb}/>
              </div>
              <button onClick={saveProfile} disabled={saving} style={{ padding:"11px", borderRadius:"8px", border:"none", background:saving?"rgba(110,86,207,0.5)":"linear-gradient(135deg,#6E56CF,#9B7FE8)", color:"#fff", cursor:saving?"not-allowed":"pointer", fontWeight:700, fontFamily:"'DM Mono', monospace", fontSize:"12px", width:"100%", opacity:saving?0.7:1 }}>
                {saving?"Saving…":"Save Profile"}
              </button>
            </div>
        )}

        {/* ── Password Tab ── */}
        {tab === "password" && (
            user.provider === "google"
                ? <div style={{ textAlign:"center", padding:"24px 0", color:"rgba(255,255,255,0.35)", fontFamily:"'DM Mono', monospace", fontSize:"12px", lineHeight:1.7 }}>
                  <div style={{ fontSize:"28px", marginBottom:"10px" }}>🔗</div>
                  Your account uses Google sign-in.<br/>Password management is handled by Google.
                </div>
                : <div style={{ display:"grid", gap:"14px" }}>
                  <div>
                    <label style={lbl}>Current Password</label>
                    <input style={inp} type="password" value={currentPw} onChange={e=>setCurrentPw(e.target.value)} placeholder="••••••••" onFocus={fi} onBlur={fb}/>
                  </div>
                  <div>
                    <label style={lbl}>New Password</label>
                    <input style={inp} type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} placeholder="Min 6 characters" onFocus={fi} onBlur={fb}/>
                  </div>
                  <div>
                    <label style={lbl}>Confirm New Password</label>
                    <input style={inp} type="password" value={confirmPw} onChange={e=>setConfirmPw(e.target.value)} placeholder="Repeat new password" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&savePassword()}/>
                  </div>
                  {newPw.length > 0 && (
                      <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                        {[["6+ chars",newPw.length>=6],["Has number",/\d/.test(newPw)],["Has uppercase",/[A-Z]/.test(newPw)],["Matches",newPw===confirmPw&&confirmPw.length>0]].map(([label,ok])=>(
                            <span key={label} style={{ background:ok?"rgba(39,201,63,0.1)":"rgba(255,255,255,0.05)", color:ok?"#74C69D":"rgba(255,255,255,0.25)", borderRadius:"4px", padding:"2px 8px", fontSize:"9px", fontFamily:"'DM Mono', monospace", border:`1px solid ${ok?"rgba(39,201,63,0.2)":"rgba(255,255,255,0.07)"}` }}>{ok?"✓":"·"} {label}</span>
                        ))}
                      </div>
                  )}
                  <button onClick={savePassword} disabled={saving} style={{ padding:"11px", borderRadius:"8px", border:"none", background:saving?"rgba(110,86,207,0.5)":"linear-gradient(135deg,#6E56CF,#9B7FE8)", color:"#fff", cursor:saving?"not-allowed":"pointer", fontWeight:700, fontFamily:"'DM Mono', monospace", fontSize:"12px", width:"100%", opacity:saving?0.7:1 }}>
                    {saving?"Updating…":"Change Password"}
                  </button>
                </div>
        )}
      </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
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

// ── LOGIN ─────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [tab,setTab]=useState("login");
  const [email,setEmail]=useState("");
  const [name,setName]=useState("");
  const [password,setPassword]=useState("");
  const [confirm,setConfirm]=useState("");
  const [error,setError]=useState("");
  const [loading,setLoading]=useState(false);

  useEffect(()=>{
    const hash=window.location.hash;
    if(hash.includes("token=")){
      const token=hash.split("token=")[1];
      setToken(token);
      window.location.hash="";
      window.location.reload();
    }
    const p=new URLSearchParams(window.location.search);
    if(p.get("error")) setError("Google sign-in failed. Try again.");
  },[]);

  const submit=async()=>{
    setError(""); setLoading(true);
    try {
      if(tab==="login"){
        const r=await API2.login(email,password);
        setToken(r.token); onLogin(r.user);
      } else {
        if(password!==confirm){setError("Passwords don't match.");setLoading(false);return;}
        if(password.length<6){setError("Password must be 6+ characters.");setLoading(false);return;}
        const r=await API2.register(email,password,name);
        setToken(r.token); onLogin(r.user);
      }
    } catch(e){ setError(e.message.includes("{")?JSON.parse(e.message).error:e.message); }
    setLoading(false);
  };

  const fi=e=>e.target.style.borderColor="rgba(110,86,207,0.7)";
  const fb=e=>e.target.style.borderColor="rgba(255,255,255,0.1)";

  return (
      <div style={{ minHeight:"100vh",background:"#0A0A12",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono', monospace",padding:"16px" }}>
        <div style={{ width:"100%",maxWidth:"400px" }}>
          <div style={{ textAlign:"center",marginBottom:"28px" }}>
            <div style={{ fontSize:"36px",marginBottom:"8px" }}>🏢</div>
            <div style={{ color:"#F0EEF8",fontSize:"22px",fontFamily:"'Playfair Display', serif",fontWeight:900 }}>Gaur City</div>
            <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase" }}>Booking Manager</div>
          </div>
          <div style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px",padding:"28px" }}>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px",background:"rgba(255,255,255,0.04)",borderRadius:"10px",padding:"4px",marginBottom:"24px" }}>
              {["login","register"].map(t=>(
                  <button key={t} onClick={()=>{setTab(t);setError("");}} style={{ padding:"8px",borderRadius:"8px",border:"none",background:tab===t?"rgba(110,86,207,0.5)":"transparent",color:tab===t?"#F0EEF8":"rgba(255,255,255,0.35)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase" }}>
                    {t==="login"?"Sign In":"Register"}
                  </button>
              ))}
            </div>
            <a href={API2.googleUrl()} style={{ display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",padding:"11px",borderRadius:"10px",border:"1px solid rgba(255,255,255,0.12)",background:"rgba(255,255,255,0.04)",color:"#F0EEF8",textDecoration:"none",fontSize:"13px",fontFamily:"'DM Mono', monospace",marginBottom:"20px" }}
               onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}>
              <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
              Continue with Google
            </a>
            <div style={{ display:"flex",alignItems:"center",gap:"12px",marginBottom:"20px" }}>
              <div style={{ flex:1,height:"1px",background:"rgba(255,255,255,0.08)" }} />
              <span style={{ color:"rgba(255,255,255,0.2)",fontSize:"10px",letterSpacing:"0.1em" }}>OR</span>
              <div style={{ flex:1,height:"1px",background:"rgba(255,255,255,0.08)" }} />
            </div>
            <div style={{ display:"grid",gap:"12px" }}>
              {tab==="register"&&<div><label style={lbl}>Full Name</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" onFocus={fi} onBlur={fb}/></div>}
              <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
              <div><label style={lbl}>Password</label><input style={inp} type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
              {tab==="register"&&<div><label style={lbl}>Confirm Password</label><input style={inp} type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="••••••••" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>}
            </div>
            {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"12px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}
            <button onClick={submit} disabled={loading} style={{ padding:"11px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",width:"100%",marginTop:"20px",opacity:loading?0.6:1 }}>
              {loading?"Please wait…":tab==="login"?"Sign In":"Create Account"}
            </button>
          </div>
          <div style={{ textAlign:"center",marginTop:"16px",color:"rgba(255,255,255,0.2)",fontSize:"10px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.06em" }}>
            New users can register freely and add their own apartments
          </div>
        </div>
      </div>
  );
}

// ── DASHBOARD / REPORTS ───────────────────────────────────────────────────────
function Dashboard({ units, user }) {
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
    const p = selUnit === "all"
        ? API2.allStats(monthStr)
        : API2.stats(selUnit, monthStr);
    p.then(rows=>{ setData(rows||[]); setLoading(false); }).catch(()=>setLoading(false));
  },[selUnit, monthStr]);

  // Compute stats
  const stats = useMemo(()=>{
    const bySource = {};
    SOURCES.forEach(s=>{ bySource[s.id]={ count:0, revenue:0 }; });
    let totalRevenue=0, totalDays=0;

    // Group by date to compute occupancy
    const byDate = {};
    data.forEach(b=>{
      if(!byDate[b.date]) byDate[b.date]=[];
      byDate[b.date].push(b);
      bySource[b.source] = bySource[b.source]||{ count:0,revenue:0 };
      bySource[b.source].count++;
      bySource[b.source].revenue += Number(b.amount||0);
      totalRevenue += Number(b.amount||0);
    });

    Object.values(byDate).forEach(dayBks=>{
      totalDays += getDayOccupancy(dayBks);
    });

    const occupancyPct = daysInMonth > 0 ? Math.round((totalDays/daysInMonth)*100) : 0;
    return { bySource, totalRevenue, totalDays, occupancyPct, totalBookings:data.length };
  },[data, daysInMonth]);

  // Monthly trend — revenue per day
  const dailyRevenue = useMemo(()=>{
    const map = {};
    for(let d=1; d<=daysInMonth; d++){
      const key = fmt(year,month,d);
      map[key] = 0;
    }
    data.forEach(b=>{ if(map[b.date]!==undefined) map[b.date]+=Number(b.amount||0); });
    return Object.entries(map).map(([date,rev])=>({date,rev}));
  },[data,year,month,daysInMonth]);

  const maxRev = Math.max(...dailyRevenue.map(d=>d.rev),1);

  const btnStyle = (active) => ({ padding:"5px 14px",borderRadius:"20px",border:`1px solid ${active?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:active?"rgba(110,86,207,0.2)":"transparent",color:active?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer",whiteSpace:"nowrap",transition:"all 0.15s" });

  return (
      <div style={{ padding:"20px 0" }}>
        {/* Controls */}
        <div style={{ display:"flex",gap:"10px",flexWrap:"wrap",alignItems:"center",marginBottom:"20px" }}>
          <div style={{ display:"flex",gap:"6px",flexWrap:"wrap" }}>
            <button style={btnStyle(selUnit==="all")} onClick={()=>setSelUnit("all")}>All Units</button>
            {units.map(u=><button key={u.id} style={btnStyle(selUnit===u.id)} onClick={()=>setSelUnit(u.id)}>{u.name}</button>)}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"8px",marginLeft:"auto" }}>
            <button onClick={()=>{ if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1); }} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"6px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"28px",height:"28px",fontSize:"14px" }}>‹</button>
            <span style={{ color:"#F0EEF8",fontFamily:"'DM Mono', monospace",fontSize:"13px",minWidth:"120px",textAlign:"center" }}>{MONTHS[month]} {year}</span>
            <button onClick={()=>{ if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1); }} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"6px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"28px",height:"28px",fontSize:"14px" }}>›</button>
          </div>
        </div>

        {loading ? <div style={{ color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"40px" }}>Loading…</div> : <>

          {/* KPI cards */}
          <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"20px" }}>
            {[
              { label:"Total Revenue",   value:`₹${stats.totalRevenue.toLocaleString("en-IN")}`, accent:"#86EFAC" },
              { label:"Total Bookings",  value:stats.totalBookings,  accent:"#C4B5FD" },
              { label:"Occupied Days",   value:`${stats.totalDays.toFixed(1)} / ${daysInMonth}`, accent:"#FCA5A5" },
              { label:"Occupancy Rate",  value:`${stats.occupancyPct}%`, accent:"#6EE7B7" },
            ].map(s=>(
                <div key={s.label} style={card}>
                  <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"4px" }}>{s.label}</div>
                  <div style={{ color:s.accent,fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{s.value}</div>
                </div>
            ))}
          </div>

          {/* Source breakdown */}
          <div style={{ ...card,marginBottom:"20px" }}>
            <div style={{ color:"rgba(255,255,255,0.4)",fontSize:"10px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"14px",fontFamily:"'DM Mono', monospace" }}>Bookings by Source</div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"8px" }}>
              {SOURCES.map(src=>{
                const s = stats.bySource[src.id]||{count:0,revenue:0};
                const pct = stats.totalBookings > 0 ? Math.round((s.count/stats.totalBookings)*100) : 0;
                return (
                    <div key={src.id} style={{ background:`${src.color}11`,border:`1px solid ${src.color}33`,borderRadius:"10px",padding:"12px",textAlign:"center" }}>
                      <div style={{ fontSize:"18px",marginBottom:"4px" }}>{src.icon}</div>
                      <div style={{ color:src.color,fontSize:"11px",fontFamily:"'DM Mono', monospace",fontWeight:600,marginBottom:"6px" }}>{src.label}</div>
                      <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{s.count}</div>
                      <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"10px",fontFamily:"'DM Mono', monospace",marginTop:"2px" }}>₹{s.revenue.toLocaleString("en-IN")}</div>
                      <div style={{ marginTop:"8px",height:"4px",background:"rgba(255,255,255,0.06)",borderRadius:"2px",overflow:"hidden" }}>
                        <div style={{ width:`${pct}%`,height:"100%",background:src.color,borderRadius:"2px",transition:"width 0.5s" }} />
                      </div>
                      <div style={{ color:"rgba(255,255,255,0.25)",fontSize:"9px",fontFamily:"'DM Mono', monospace",marginTop:"3px" }}>{pct}%</div>
                    </div>
                );
              })}
            </div>
          </div>

          {/* Daily revenue chart */}
          <div style={{ ...card,marginBottom:"20px" }}>
            <div style={{ color:"rgba(255,255,255,0.4)",fontSize:"10px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"14px",fontFamily:"'DM Mono', monospace" }}>Daily Revenue — {MONTHS[month]} {year}</div>
            <div style={{ display:"flex",alignItems:"flex-end",gap:"3px",height:"120px",paddingBottom:"4px" }}>
              {dailyRevenue.map(({date,rev})=>{
                const h = maxRev > 0 ? Math.max((rev/maxRev)*100, rev>0?4:0) : 0;
                const d = parseInt(date.split("-")[2]);
                return (
                    <div key={date} style={{ flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"4px" }} title={`${date}: ₹${rev.toLocaleString("en-IN")}`}>
                      <div style={{ width:"100%",background:rev>0?"linear-gradient(180deg,#9B7FE8,#6E56CF)":"rgba(255,255,255,0.05)",height:`${h}%`,borderRadius:"3px 3px 0 0",minHeight:rev>0?"4px":"0",transition:"height 0.3s" }} />
                      {daysInMonth <= 31 && <div style={{ color:"rgba(255,255,255,0.2)",fontSize:"8px",fontFamily:"'DM Mono', monospace" }}>{d}</div>}
                    </div>
                );
              })}
            </div>
          </div>

          {/* Bookings table */}
          <div style={card}>
            <div style={{ color:"rgba(255,255,255,0.4)",fontSize:"10px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"14px",fontFamily:"'DM Mono', monospace" }}>All Bookings — {MONTHS[month]} {year}</div>
            {data.length === 0 ? (
                <div style={{ color:"rgba(255,255,255,0.2)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"20px" }}>No bookings this month</div>
            ) : (
                <div style={{ overflowX:"auto" }}>
                  <table style={{ width:"100%",borderCollapse:"collapse",fontFamily:"'DM Mono', monospace",fontSize:"11px" }}>
                    <thead>
                    <tr>{["Date","Unit","Guest","Source","Check-In","Check-Out","Amount","Half/Full"].map(h=>(
                        <th key={h} style={{ textAlign:"left",color:"rgba(255,255,255,0.3)",padding:"6px 10px",borderBottom:"1px solid rgba(255,255,255,0.06)",letterSpacing:"0.06em",whiteSpace:"nowrap" }}>{h}</th>
                    ))}</tr>
                    </thead>
                    <tbody>
                    {[...data].sort((a,b)=>a.date.localeCompare(b.date)).map(b=>{
                      const src = SRC[b.source]||SRC.direct;
                      const half = isHalfDay(b);
                      return (
                          <tr key={b.id} style={{ borderBottom:"1px solid rgba(255,255,255,0.04)" }}
                              onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"}
                              onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                            <td style={{ padding:"8px 10px",color:"rgba(255,255,255,0.6)" }}>{b.date}</td>
                            <td style={{ padding:"8px 10px",color:"rgba(255,255,255,0.5)",whiteSpace:"nowrap" }}>{units.find(u=>u.id===b.unit_id)?.name||b.unit_id}</td>
                            <td style={{ padding:"8px 10px",color:"#F0EEF8" }}>{b.guest_name}</td>
                            <td style={{ padding:"8px 10px" }}>
                              <span style={{ background:`${src.color}22`,color:src.color,borderRadius:"4px",padding:"2px 6px",fontSize:"10px",fontWeight:600 }}>{src.icon} {src.label}</span>
                            </td>
                            <td style={{ padding:"8px 10px",color:"rgba(255,255,255,0.5)" }}>{b.check_in}</td>
                            <td style={{ padding:"8px 10px",color:"rgba(255,255,255,0.5)" }}>{b.check_out}</td>
                            <td style={{ padding:"8px 10px",color:"#C4B5FD",fontWeight:600 }}>₹{Number(b.amount).toLocaleString("en-IN")}</td>
                            <td style={{ padding:"8px 10px" }}>
                        <span style={{ background:half?"rgba(251,191,36,0.15)":"rgba(52,211,153,0.15)",color:half?"#FBbf24":"#34D399",borderRadius:"4px",padding:"2px 6px",fontSize:"10px" }}>
                          {half?"½ Day":"Full Day"}
                        </span>
                            </td>
                          </tr>
                      );
                    })}
                    </tbody>
                  </table>
                </div>
            )}
          </div>
        </>}
      </div>
  );
}

// ── ADMIN PANEL ───────────────────────────────────────────────────────────────
function AdminPanel({ units }) {
  const [users, setUsers]       = useState([]);
  const [selUnit, setSelUnit]   = useState(units[0]?.id||"");
  const [perms, setPerms]       = useState([]);
  const [loading, setLoading]   = useState(false);
  const [msg, setMsg]           = useState("");

  useEffect(()=>{ API2.allUsers().then(setUsers).catch(()=>{}); },[]);
  useEffect(()=>{
    if(!selUnit) return;
    API2.getPerms(selUnit).then(setPerms).catch(()=>{});
  },[selUnit]);

  const grant = async(userId)=>{
    setLoading(true); setMsg("");
    await API2.grantPerm(selUnit,userId);
    const p = await API2.getPerms(selUnit);
    setPerms(p); setLoading(false); setMsg("Access granted ✓");
    setTimeout(()=>setMsg(""),2000);
  };
  const revoke = async(userId)=>{
    setLoading(true); setMsg("");
    await API2.revokePerm(selUnit,userId);
    const p = await API2.getPerms(selUnit);
    setPerms(p); setLoading(false); setMsg("Access revoked");
    setTimeout(()=>setMsg(""),2000);
  };

  const grantedIds = new Set(perms.map(p=>p.user_id));
  const unit = units.find(u=>u.id===selUnit);

  return (
      <div style={{ padding:"20px 0" }}>
        <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"10px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"16px" }}>Admin — User Access Control</div>

        {/* Unit selector */}
        <div style={{ display:"flex",gap:"8px",flexWrap:"wrap",marginBottom:"20px" }}>
          {units.map(u=>(
              <button key={u.id} onClick={()=>setSelUnit(u.id)} style={{ padding:"6px 16px",borderRadius:"20px",border:`1px solid ${selUnit===u.id?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:selUnit===u.id?"rgba(110,86,207,0.2)":"transparent",color:selUnit===u.id?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer" }}>
                {u.name}
              </button>
          ))}
        </div>

        {msg && <div style={{ color:"#74C69D",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginBottom:"12px",padding:"8px 12px",background:"rgba(39,201,63,0.08)",borderRadius:"6px",border:"1px solid rgba(39,201,63,0.2)" }}>{msg}</div>}

        <div style={card}>
          <div style={{ color:"rgba(255,255,255,0.5)",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginBottom:"14px" }}>
            Who can see <span style={{ color:"#C4B5FD" }}>{unit?.name}</span>?
          </div>
          <div style={{ display:"grid",gap:"8px" }}>
            {users.filter(u=>u.role!=="admin").map(u=>{
              const hasAccess = grantedIds.has(u.id);
              return (
                  <div key={u.id} style={{ display:"flex",alignItems:"center",gap:"12px",padding:"10px 14px",background:"rgba(255,255,255,0.02)",borderRadius:"8px",border:`1px solid ${hasAccess?"rgba(110,86,207,0.25)":"rgba(255,255,255,0.06)"}` }}>
                    {u.avatar ? <img src={u.avatar} alt="" style={{ width:"32px",height:"32px",borderRadius:"50%",flexShrink:0 }} /> : <div style={{ width:"32px",height:"32px",borderRadius:"50%",background:"rgba(110,86,207,0.3)",display:"flex",alignItems:"center",justifyContent:"center",color:"#C4B5FD",fontSize:"13px",flexShrink:0 }}>{(u.name||u.email)[0].toUpperCase()}</div>}
                    <div style={{ flex:1,minWidth:0 }}>
                      <div style={{ color:"#F0EEF8",fontSize:"12px",fontFamily:"'DM Mono', monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{u.name}</div>
                      <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"10px",fontFamily:"'DM Mono', monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{u.email}</div>
                    </div>
                    <button onClick={()=>hasAccess?revoke(u.id):grant(u.id)} disabled={loading}
                            style={{ padding:"5px 12px",borderRadius:"6px",border:"none",background:hasAccess?"rgba(255,90,95,0.15)":"rgba(110,86,207,0.2)",color:hasAccess?"#FF7B7F":"#C4B5FD",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:600,whiteSpace:"nowrap" }}>
                      {hasAccess?"Revoke":"Grant Access"}
                    </button>
                  </div>
              );
            })}
            {users.filter(u=>u.role!=="admin").length===0 && <div style={{ color:"rgba(255,255,255,0.2)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"20px" }}>No non-admin users registered yet</div>}
          </div>
        </div>
      </div>
  );
}

// ── BOOKING BADGE ─────────────────────────────────────────────────────────────
function BookingBadge({ booking, onClick }) {
  const src = SRC[booking.source]||SRC.direct;
  const half = isHalfDay(booking);
  return (
      <div onClick={e=>{e.stopPropagation();onClick(booking);}} style={{ background:`linear-gradient(135deg,${src.color}cc,${src.color}77)`,color:"#fff",borderRadius:"4px",padding:"2px 5px",fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600,cursor:"pointer",marginBottom:"2px",display:"flex",alignItems:"center",gap:"3px",overflow:"hidden",whiteSpace:"nowrap",textOverflow:"ellipsis",transition:"transform 0.12s",opacity:half?0.8:1 }}
           onMouseEnter={e=>e.currentTarget.style.transform="scale(1.03)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
        <span style={{ fontSize:"9px",flexShrink:0 }}>{src.icon}</span>
        <span style={{ overflow:"hidden",textOverflow:"ellipsis" }}>{booking.guest_name||src.label}</span>
        {half && <span title="Half day" style={{ fontSize:"8px",flexShrink:0,opacity:0.9 }}>½</span>}
        {(booking.overflow_to||booking.overflowTo) && <span title="Overflow→Ekant" style={{ fontSize:"8px",flexShrink:0 }}>↗</span>}
      </div>
  );
}

// ── BOOKING FORM ──────────────────────────────────────────────────────────────
function BookingForm({ date, unit, onSave, onClose, editBooking }) {
  const [form,setForm] = useState(editBooking||{ guestName:"",source:"direct",checkIn:"14:00",checkOut:"11:00",amount:"",notes:"",overflowTo:"" });
  const [error,setError]=useState("");
  const [saving,setSaving]=useState(false);
  const set=(f,v)=>setForm(p=>({...p,[f]:v}));
  const fi=e=>e.target.style.borderColor="rgba(110,86,207,0.7)";
  const fb=e=>e.target.style.borderColor="rgba(255,255,255,0.1)";

  // Live half/full day indicator
  const previewHalf = ["ekant","urmit","direct"].includes(form.source) && Number(form.amount) > 0 && Number(form.amount) <= 1500;

  const handleSave=async()=>{
    if(!form.guestName.trim()) return setError("Guest name is required.");
    if(!form.amount||isNaN(Number(form.amount))||Number(form.amount)<0) return setError("Please enter a valid amount.");
    setError(""); setSaving(true);
    await onSave({ ...form, id:form.id||uid(), date, unit_id:unit.id });
    setSaving(false);
  };

  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"rgba(110,86,207,0.8)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"2px" }}>{unit.name}</div>
            <div style={{ color:"rgba(255,255,255,0.35)",fontSize:"9px",fontFamily:"'DM Mono', monospace",textTransform:"uppercase",marginBottom:"4px" }}>{editBooking?"Edit":"New"} Booking</div>
            <div style={{ color:"#F0EEF8",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{date}</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:"18px",width:"34px",height:"34px",display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"14px" }}>
          <div><label style={lbl}>Guest Name</label><input style={inp} value={form.guestName} onChange={e=>set("guestName",e.target.value)} placeholder="e.g. Rahul Sharma" onFocus={fi} onBlur={fb}/></div>
          <div>
            <label style={lbl}>Booking Source</label>
            <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px" }}>
              {SOURCES.map(s=>(
                  <button key={s.id} onClick={()=>set("source",s.id)} style={{ padding:"8px 6px",borderRadius:"8px",border:`1px solid ${form.source===s.id?s.color:"rgba(255,255,255,0.08)"}`,background:form.source===s.id?`${s.color}22`:"rgba(255,255,255,0.02)",color:form.source===s.id?s.color:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",fontWeight:600,transition:"all 0.15s",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px" }}>
                    <span style={{ fontSize:"14px" }}>{s.icon}</span>
                    <span style={{ textAlign:"center",lineHeight:1.2 }}>{s.label}</span>
                  </button>
              ))}
            </div>
          </div>
          <div>
            <label style={lbl}>Overflow to Ekant (optional)</label>
            <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
              <input type="checkbox" id="overflow" checked={form.overflowTo==="ekant"} onChange={e=>set("overflowTo",e.target.checked?"ekant":"")} style={{ width:"16px",height:"16px",cursor:"pointer",accentColor:"#A78BFA" }}/>
              <label htmlFor="overflow" style={{ color:"rgba(255,255,255,0.5)",fontSize:"11px",fontFamily:"'DM Mono', monospace",cursor:"pointer" }}>Pass this booking to Ekant</label>
            </div>
          </div>
          <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px" }}>
            <div><label style={lbl}>Check-In</label><input type="time" style={inp} value={form.checkIn} onChange={e=>set("checkIn",e.target.value)}/></div>
            <div><label style={lbl}>Check-Out</label><input type="time" style={inp} value={form.checkOut} onChange={e=>set("checkOut",e.target.value)}/></div>
          </div>
          <div>
            <label style={lbl}>Amount (₹)</label>
            <input style={inp} type="number" min="0" value={form.amount} onChange={e=>set("amount",e.target.value)} placeholder="e.g. 2500" onFocus={fi} onBlur={fb}/>
            {form.amount>0 && <div style={{ marginTop:"6px",display:"flex",alignItems:"center",gap:"6px" }}>
            <span style={{ background:previewHalf?"rgba(251,191,36,0.15)":"rgba(52,211,153,0.15)",color:previewHalf?"#FBbf24":"#34D399",borderRadius:"4px",padding:"2px 8px",fontSize:"10px",fontFamily:"'DM Mono', monospace" }}>
              {["ekant","urmit","direct"].includes(form.source) ? (previewHalf?"½ Half Day (≤₹1500)":"Full Day (>₹1500)") : "Full Day"}
            </span>
            </div>}
          </div>
          <div><label style={lbl}>Notes (optional)</label><textarea style={{ ...inp,resize:"vertical",minHeight:"56px" }} value={form.notes} onChange={e=>set("notes",e.target.value)} placeholder="Any special requests…" onFocus={fi} onBlur={fb}/></div>
        </div>
        {error&&<div style={{ color:"#FF7B7F",fontSize:"11px",marginTop:"10px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {error}</div>}
        <div style={{ display:"flex",gap:"10px",marginTop:"20px" }}>
          <button onClick={onClose} style={{ flex:1,padding:"11px",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"12px" }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex:2,padding:"11px",borderRadius:"8px",border:"none",background:saving?"rgba(110,86,207,0.5)":"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:saving?"not-allowed":"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px" }}>
            {saving?"Saving…":editBooking?"Update":"Save Booking"}
          </button>
        </div>
      </>
  );
}

// ── BOOKING DETAIL ────────────────────────────────────────────────────────────
function BookingDetail({ booking, unit, onClose, onEdit, onDelete }) {
  const [deleting,setDeleting]=useState(false);
  const src=SRC[booking.source]||SRC.direct;
  const half=isHalfDay(booking);
  const handleDelete=async()=>{setDeleting(true);await onDelete(booking.id,booking.date);setDeleting(false);};
  const guestName = booking.guest_name||booking.guestName||"";
  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"20px" }}>
          <div>
            <div style={{ color:"rgba(110,86,207,0.7)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"4px" }}>{unit?.name}</div>
            <div style={{ display:"inline-flex",alignItems:"center",gap:"5px",background:`${src.color}22`,border:`1px solid ${src.color}44`,borderRadius:"20px",padding:"3px 10px",marginBottom:"8px" }}>
              <span style={{ fontSize:"10px" }}>{src.icon}</span>
              <span style={{ color:src.color,fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:600 }}>{src.label.toUpperCase()}</span>
              <span style={{ background:half?"rgba(251,191,36,0.2)":"rgba(52,211,153,0.2)",color:half?"#FBbf24":"#34D399",borderRadius:"4px",padding:"1px 5px",fontSize:"9px",marginLeft:"2px" }}>{half?"½ Day":"Full Day"}</span>
            </div>
            <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{guestName}</div>
            <div style={{ color:"rgba(255,255,255,0.35)",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginTop:"2px" }}>{booking.date}</div>
          </div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:"18px",width:"34px",height:"34px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 }}>×</button>
        </div>
        <div style={{ display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",marginBottom:"14px" }}>
          {[{label:"Check-In",value:booking.check_in||booking.checkIn,icon:"⬆"},{label:"Check-Out",value:booking.check_out||booking.checkOut,icon:"⬇"}].map(item=>(
              <div key={item.label} style={{ background:"rgba(255,255,255,0.04)",borderRadius:"10px",padding:"12px 14px",border:"1px solid rgba(255,255,255,0.07)" }}>
                <div style={{ color:"rgba(255,255,255,0.35)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",marginBottom:"4px" }}>{item.icon} {item.label.toUpperCase()}</div>
                <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{item.value}</div>
              </div>
          ))}
        </div>
        <div style={{ background:"linear-gradient(135deg,rgba(110,86,207,0.12),rgba(155,127,232,0.07))",borderRadius:"10px",padding:"14px 16px",border:"1px solid rgba(110,86,207,0.2)",marginBottom:"14px",display:"flex",justifyContent:"space-between",alignItems:"center" }}>
          <div style={{ color:"rgba(255,255,255,0.4)",fontSize:"10px",fontFamily:"'DM Mono', monospace" }}>AMOUNT</div>
          <div style={{ color:"#C4B5FD",fontSize:"22px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>₹{Number(booking.amount).toLocaleString("en-IN")}</div>
        </div>
        {(booking.overflow_to||booking.overflowTo)&&<div style={{ background:"rgba(167,139,250,0.08)",borderRadius:"10px",padding:"10px 14px",border:"1px solid rgba(167,139,250,0.2)",marginBottom:"14px",display:"flex",alignItems:"center",gap:"8px" }}><span style={{ fontSize:"14px" }}>👤</span><div><div style={{ color:"rgba(167,139,250,0.7)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",textTransform:"uppercase" }}>Overflow Passed To</div><div style={{ color:"#C4B5FD",fontSize:"13px",fontFamily:"'DM Mono', monospace",fontWeight:600,textTransform:"capitalize" }}>{booking.overflow_to||booking.overflowTo}</div></div></div>}
        {booking.notes&&<div style={{ background:"rgba(255,255,255,0.03)",borderRadius:"10px",padding:"12px 14px",border:"1px solid rgba(255,255,255,0.06)",marginBottom:"14px" }}><div style={{ color:"rgba(255,255,255,0.3)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",marginBottom:"5px" }}>NOTES</div><div style={{ color:"rgba(255,255,255,0.65)",fontSize:"13px",fontFamily:"'DM Mono', monospace",lineHeight:1.5 }}>{booking.notes}</div></div>}
        <div style={{ display:"flex",gap:"10px" }}>
          <button onClick={handleDelete} disabled={deleting} style={{ flex:1,padding:"10px",borderRadius:"8px",border:"1px solid rgba(255,90,95,0.3)",background:"rgba(255,90,95,0.08)",color:"#FF7B7F",cursor:deleting?"not-allowed":"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px" }}>{deleting?"Deleting…":"Delete"}</button>
          <button onClick={()=>onEdit(booking)} style={{ flex:2,padding:"10px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px",fontWeight:700 }}>Edit Booking</button>
        </div>
      </>
  );
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg={ loading:{bg:"rgba(255,189,46,0.12)",border:"rgba(255,189,46,0.3)",color:"#FFBD2E",dot:"#FFBD2E",label:"Connecting…"}, saving:{bg:"rgba(110,86,207,0.12)",border:"rgba(110,86,207,0.3)",color:"#C4B5FD",dot:"#9B7FE8",label:"Saving…"}, saved:{bg:"rgba(39,201,63,0.1)",border:"rgba(39,201,63,0.25)",color:"#74C69D",dot:"#27C93F",label:"✦ Synced"}, error:{bg:"rgba(255,90,95,0.1)",border:"rgba(255,90,95,0.3)",color:"#FF7B7F",dot:"#FF5A5F",label:"⚠ Error"} }[status]||{};
  return <div style={{ display:"flex",alignItems:"center",gap:"6px",background:cfg.bg,border:`1px solid ${cfg.border}`,borderRadius:"20px",padding:"4px 12px" }}><div style={{ width:"6px",height:"6px",borderRadius:"50%",background:cfg.dot,animation:(status==="saving"||status==="loading")?"pulse 1s infinite":"none" }}/><span style={{ color:cfg.color,fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em" }}>{cfg.label}</span></div>;
}

// ── ADD UNIT MODAL ────────────────────────────────────────────────────────────
function AddUnitModal({ onAdd, onClose }) {
  const [name,setName]=useState("");
  const [location,setLoc]=useState("");
  const [saving,setSaving]=useState(false);
  const fi=e=>e.target.style.borderColor="rgba(110,86,207,0.7)";
  const fb=e=>e.target.style.borderColor="rgba(255,255,255,0.1)";
  const handleAdd=async()=>{
    if(!name.trim()) return;
    setSaving(true); await onAdd(name.trim(),location.trim()); setSaving(false);
  };
  return (
      <>
        <div style={{ display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px" }}>
          <div style={{ color:"#F0EEF8",fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>Add New Unit</div>
          <button onClick={onClose} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",fontSize:"18px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center" }}>×</button>
        </div>
        <div style={{ display:"grid",gap:"14px" }}>
          <div><label style={lbl}>Unit Name / Number</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Unit 1627" onFocus={fi} onBlur={fb}/></div>
          <div><label style={lbl}>Location</label><input style={inp} value={location} onChange={e=>setLoc(e.target.value)} placeholder="e.g. Sector 4, Greater Noida" onFocus={fi} onBlur={fb}/></div>
        </div>
        <div style={{ display:"flex",gap:"10px",marginTop:"20px" }}>
          <button onClick={onClose} style={{ flex:1,padding:"10px",borderRadius:"8px",border:"1px solid rgba(255,255,255,0.1)",background:"transparent",color:"rgba(255,255,255,0.4)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"12px" }}>Cancel</button>
          <button onClick={handleAdd} disabled={saving||!name.trim()} style={{ flex:2,padding:"10px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:saving||!name.trim()?"not-allowed":"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",opacity:saving||!name.trim()?0.5:1 }}>{saving?"Adding…":"Add Unit"}</button>
        </div>
      </>
  );
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
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
  const [dbError,setDbError]       = useState("");
  const [modalState,setModalState] = useState(null);
  const [activeTab,setActiveTab]   = useState("calendar"); // calendar | dashboard | admin
  const [showProfile,setShowProfile] = useState(false);

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
      setStatus("saved");
    }).catch(e=>{setStatus("error");setDbError(e.message);});
  },[user]);

  useEffect(()=>{
    if(!selectedUnit) return;
    setStatus("loading"); setBookings({});
    API2.bookings(selectedUnit.id).then(rows=>{
      const map={};
      (rows||[]).forEach(row=>{
        const b={id:row.id,date:row.date,unit_id:row.unit_id,guestName:row.guest_name,source:row.source,checkIn:row.check_in,checkOut:row.check_out,amount:row.amount,notes:row.notes||"",overflowTo:row.overflow_to||"",guest_name:row.guest_name,check_in:row.check_in,check_out:row.check_out,overflow_to:row.overflow_to};
        if(!map[row.date])map[row.date]=[];
        map[row.date].push(b);
      });
      setBookings(map); setStatus("saved"); setDbError("");
    }).catch(e=>{setStatus("error");setDbError(e.message);});
  },[selectedUnit]);

  const firstDay   = new Date(currentYear,currentMonth,1).getDay();
  const daysInMonth2 = new Date(currentYear,currentMonth+1,0).getDate();
  const prevMonth  = ()=>{if(currentMonth===0){setCurrentMonth(11);setCurrentYear(y=>y-1);}else setCurrentMonth(m=>m-1);};
  const nextMonth  = ()=>{if(currentMonth===11){setCurrentMonth(0);setCurrentYear(y=>y+1);}else setCurrentMonth(m=>m+1);};
  const getDay     = d => bookings[d]||[];
  const todayStr   = fmt(today.getFullYear(),today.getMonth(),today.getDate());

  const handleDayClick = day=>{
    const dateStr=fmt(currentYear,currentMonth,day);
    const dayBks=getDay(dateStr);
    // Capped sources max 2, ekant unlimited
    const cappedCount=dayBks.filter(b=>CAPPED_SOURCES.includes(b.source)).length;
    if(cappedCount>=2){
      // still allow if adding ekant — handled in form, just open modal
    }
    setModalState({type:"add",date:dateStr});
  };

  const handleSave=async booking=>{
    setStatus("saving");
    try {
      await API2.upsert({ id:booking.id,unit_id:booking.unit_id||selectedUnit.id,date:booking.date,guest_name:booking.guestName||booking.guest_name,source:booking.source,check_in:booking.checkIn||booking.check_in,check_out:booking.checkOut||booking.check_out,amount:Number(booking.amount),notes:booking.notes||"",overflow_to:booking.overflowTo||booking.overflow_to||null });
      // Update local state
      const updated={...bookings};
      const list=updated[booking.date]?[...updated[booking.date]]:[];
      const fullB={...booking,guest_name:booking.guestName||booking.guest_name,check_in:booking.checkIn||booking.check_in,check_out:booking.checkOut||booking.check_out,overflow_to:booking.overflowTo||booking.overflow_to};
      if(modalState?.type==="edit"){const idx=list.findIndex(b=>b.id===booking.id);if(idx!==-1)list[idx]=fullB;else list.push(fullB);}
      else list.push(fullB);
      updated[booking.date]=list;
      setBookings(updated); setStatus("saved"); setDbError("");
    } catch(e){setStatus("error");setDbError(e.message);}
    setModalState(null);
  };

  const handleDelete=async(id,date)=>{
    setStatus("saving");
    try {
      await API2.deleteBooking(id);
      const updated={...bookings};
      updated[date]=(updated[date]||[]).filter(b=>b.id!==id);
      if(updated[date].length===0)delete updated[date];
      setBookings(updated); setStatus("saved"); setDbError("");
    } catch(e){setStatus("error");setDbError(e.message);}
    setModalState(null);
  };

  const handleAddUnit=async(name,loc)=>{
    const list=await API2.addUnit(name,loc);
    setUnits(list||[]);
    const nu=(list||[]).find(u=>u.name===name);
    if(nu)setSelectedUnit(nu);
    setModalState(null);
  };

  const handleLogout=()=>{setToken(null);setUser(null);setBookings({});setUnits([]);setSelectedUnit(null);};

  if(!authChecked) return <div style={{ minHeight:"100vh",background:"#0A0A12",display:"flex",alignItems:"center",justifyContent:"center",color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"12px" }}>Loading…</div>;
  if(!user) return <LoginPage onLogin={u=>setUser(u)} />;

  const monthPrefix=`${currentYear}-${String(currentMonth+1).padStart(2,"0")}`;
  const monthBks=Object.entries(bookings).filter(([d])=>d.startsWith(monthPrefix)).flatMap(([,l])=>l);
  const totalRevenue=monthBks.reduce((s,b)=>s+Number(b.amount||0),0);

  const tabBtn=(tab,label,icon)=>(
      <button onClick={()=>setActiveTab(tab)} style={{ display:"flex",alignItems:"center",gap:"6px",padding:"8px 16px",borderRadius:"8px",border:"none",background:activeTab===tab?"rgba(110,86,207,0.25)":"transparent",color:activeTab===tab?"#C4B5FD":"rgba(255,255,255,0.4)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px",letterSpacing:"0.06em",transition:"all 0.15s" }}>
        <span>{icon}</span>{label}
      </button>
  );

  return (
      <div style={{ minHeight:"100vh",background:"#0A0A12",fontFamily:"'DM Mono', monospace",overflowX:"hidden" }}>
        <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500;600&display=swap');
        @keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes slideUp{from{opacity:0;transform:translateY(28px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}} @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        *{box-sizing:border-box} input[type="time"]::-webkit-calendar-picker-indicator{filter:invert(0.6)} textarea{font-family:'DM Mono',monospace!important} select option{background:#1a1a2e}
        ::-webkit-scrollbar{width:4px} ::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.1);border-radius:2px}
      `}</style>

        {/* Header */}
        <div style={{ background:"rgba(255,255,255,0.02)",borderBottom:"1px solid rgba(255,255,255,0.06)",padding:"12px 24px",display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:"10px" }}>
          <div style={{ display:"flex",alignItems:"center",gap:"12px" }}>
            <span style={{ fontSize:"22px" }}>🏢</span>
            <div>
              <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"8px",letterSpacing:"0.2em",textTransform:"uppercase" }}>Property Manager</div>
              <div style={{ color:"#F0EEF8",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:900,letterSpacing:"-0.01em" }}>Booking Manager</div>
            </div>
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"10px",flexWrap:"wrap" }}>
            {tabBtn("calendar","Calendar","📅")}
            {tabBtn("dashboard","Reports","📊")}
            {user.role==="admin" && tabBtn("admin","Admin","⚙")}
          </div>
          <div style={{ display:"flex",alignItems:"center",gap:"10px" }}>
            <StatusBadge status={status}/>
            {/* Clickable profile button */}
            <button onClick={()=>setShowProfile(true)} title="Edit profile" style={{ display:"flex",alignItems:"center",gap:"8px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"20px",padding:"4px 12px 4px 4px",cursor:"pointer",transition:"background 0.15s" }}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}>
              {user.avatar
                  ? <img src={user.avatar} alt="" style={{ width:"24px",height:"24px",borderRadius:"50%",border:"2px solid rgba(110,86,207,0.5)",objectFit:"cover" }}/>
                  : <div style={{ width:"24px",height:"24px",borderRadius:"50%",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"11px",fontWeight:700,color:"#fff" }}>{(user.name||user.email||"?")[0].toUpperCase()}</div>
              }
              <span style={{ color:"rgba(255,255,255,0.5)",fontSize:"10px",fontFamily:"'DM Mono', monospace",maxWidth:"100px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap" }}>{user.name||user.email}</span>
              {user.role==="admin"&&<span style={{ background:"rgba(110,86,207,0.3)",color:"#C4B5FD",borderRadius:"4px",padding:"1px 5px",fontSize:"8px",letterSpacing:"0.08em" }}>ADMIN</span>}
            </button>
            <button onClick={handleLogout} style={{ background:"rgba(255,90,95,0.1)",border:"1px solid rgba(255,90,95,0.2)",borderRadius:"8px",color:"#FF7B7F",cursor:"pointer",padding:"4px 10px",fontSize:"10px",fontFamily:"'DM Mono', monospace" }}>Sign out</button>
          </div>
        </div>

        {/* Unit bar */}
        <div style={{ background:"rgba(110,86,207,0.05)",borderBottom:"1px solid rgba(110,86,207,0.12)",padding:"10px 24px",display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap" }}>
          <span style={{ color:"rgba(255,255,255,0.25)",fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap" }}>Unit:</span>
          {units.map(u=>(
              <button key={u.id} onClick={()=>setSelectedUnit(u)} style={{ padding:"5px 14px",borderRadius:"20px",border:`1px solid ${selectedUnit?.id===u.id?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:selectedUnit?.id===u.id?"rgba(110,86,207,0.2)":"transparent",color:selectedUnit?.id===u.id?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer",whiteSpace:"nowrap",fontWeight:selectedUnit?.id===u.id?600:400 }}>
                {u.name}{u.location&&<span style={{ color:"rgba(255,255,255,0.2)",fontSize:"9px",marginLeft:"4px" }}>· {u.location.split(",")[0]}</span>}
              </button>
          ))}
          <button onClick={()=>setModalState({type:"addUnit"})} style={{ padding:"5px 12px",borderRadius:"20px",border:"1px dashed rgba(255,255,255,0.12)",background:"transparent",color:"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer",whiteSpace:"nowrap" }}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(110,86,207,0.5)";e.currentTarget.style.color="#C4B5FD";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.12)";e.currentTarget.style.color="rgba(255,255,255,0.3)";}}>
            + Add Unit
          </button>
        </div>

        {dbError&&<div style={{ background:"rgba(255,90,95,0.08)",borderBottom:"1px solid rgba(255,90,95,0.2)",padding:"10px 24px",color:"#FF7B7F",fontSize:"11px" }}>⚠ {dbError}</div>}

        <div style={{ maxWidth:"920px",margin:"0 auto",padding:"20px 16px" }}>

          {/* ── DASHBOARD TAB ── */}
          {activeTab==="dashboard" && <Dashboard units={units} user={user}/>}

          {/* ── ADMIN TAB ── */}
          {activeTab==="admin" && user.role==="admin" && <AdminPanel units={units}/>}

          {/* ── CALENDAR TAB ── */}
          {activeTab==="calendar" && <>
            {/* Stats */}
            <div style={{ display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"10px",marginBottom:"20px" }}>
              {[
                {label:"Bookings",   value:monthBks.length,                accent:"#C4B5FD"},
                {label:"Revenue",    value:`₹${totalRevenue.toLocaleString("en-IN")}`, accent:"#86EFAC"},
                {label:"Overflow ↗", value:monthBks.filter(b=>b.overflowTo||b.overflow_to).length, accent:"#A78BFA"},
                {label:"Occupancy",  value:(()=>{
                    const byDate={};
                    monthBks.forEach(b=>{if(!byDate[b.date])byDate[b.date]=[];byDate[b.date].push(b);});
                    const days=Object.values(byDate).reduce((s,bks)=>s+getDayOccupancy(bks),0);
                    return `${Math.round((days/daysInMonth2)*100)}%`;
                  })(), accent:"#FCA5A5"},
              ].map(s=>(
                  <div key={s.label} style={{ background:"rgba(255,255,255,0.03)",border:"1px solid rgba(255,255,255,0.07)",borderRadius:"12px",padding:"12px 14px" }}>
                    <div style={{ color:"rgba(255,255,255,0.3)",fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"4px" }}>{s.label}</div>
                    <div style={{ color:s.accent,fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700 }}>{s.value}</div>
                  </div>
              ))}
            </div>

            {/* Source pills */}
            <div style={{ display:"flex",gap:"8px",marginBottom:"20px",flexWrap:"wrap" }}>
              {SOURCES.map(src=>{
                const count=monthBks.filter(b=>b.source===src.id).length;
                return <div key={src.id} style={{ background:`${src.color}11`,border:`1px solid ${src.color}33`,borderRadius:"8px",padding:"5px 10px",display:"flex",alignItems:"center",gap:"5px" }}>
                  <span style={{ fontSize:"11px" }}>{src.icon}</span>
                  <span style={{ color:src.color,fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600 }}>{src.label}</span>
                  <span style={{ background:`${src.color}33`,color:src.color,borderRadius:"10px",padding:"1px 6px",fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:700 }}>{count}</span>
                </div>;
              })}
            </div>

            {/* Calendar nav */}
            <div style={{ background:"rgba(255,255,255,0.025)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:"16px 16px 0 0",padding:"16px 22px",display:"flex",alignItems:"center",justifyContent:"space-between" }}>
              <button onClick={prevMonth} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"34px",height:"34px",fontSize:"16px",display:"flex",alignItems:"center",justifyContent:"center" }} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>‹</button>
              <div style={{ textAlign:"center" }}>
                <div style={{ color:"#F0EEF8",fontSize:"20px",fontFamily:"'Playfair Display', serif",fontWeight:900 }}>{MONTHS[currentMonth]}</div>
                <div style={{ color:"rgba(255,255,255,0.25)",fontSize:"11px",letterSpacing:"0.12em" }}>{currentYear} · {selectedUnit?.name||""}</div>
              </div>
              <button onClick={nextMonth} style={{ background:"rgba(255,255,255,0.06)",border:"none",borderRadius:"8px",color:"rgba(255,255,255,0.5)",cursor:"pointer",width:"34px",height:"34px",fontSize:"16px",display:"flex",alignItems:"center",justifyContent:"center" }} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>›</button>
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"rgba(255,255,255,0.02)",borderLeft:"1px solid rgba(255,255,255,0.08)",borderRight:"1px solid rgba(255,255,255,0.08)" }}>
              {DAYS.map(d=><div key={d} style={{ padding:"9px 0",textAlign:"center",color:d==="Sun"||d==="Sat"?"rgba(155,127,232,0.5)":"rgba(255,255,255,0.25)",fontSize:"9px",letterSpacing:"0.1em",textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,0.06)" }}>{d}</div>)}
            </div>
            <div style={{ display:"grid",gridTemplateColumns:"repeat(7,1fr)",border:"1px solid rgba(255,255,255,0.08)",borderTop:"none",borderRadius:"0 0 16px 16px",overflow:"hidden",background:"rgba(255,255,255,0.012)" }}>
              {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`} style={{ minHeight:"90px",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"rgba(0,0,0,0.12)" }}/>)}
              {Array.from({length:daysInMonth2},(_,i)=>i+1).map(day=>{
                const dateStr=fmt(currentYear,currentMonth,day);
                const dayBks=getDay(dateStr);
                const isToday=dateStr===todayStr;
                const cappedCount=dayBks.filter(b=>CAPPED_SOURCES.includes(b.source)).length;
                const isCappedFull=cappedCount>=2;
                const hasBooking=dayBks.length>0;
                const isWeekend=(firstDay+day-1)%7===0||(firstDay+day-1)%7===6;
                const occ=getDayOccupancy(dayBks);
                const occColor = occ>=1?"#FF5A5F":occ>=0.5?"#FFBD2E":"transparent";
                return (
                    <div key={day} onClick={()=>handleDayClick(day)} style={{ minHeight:"90px",padding:"7px 5px 5px",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:isToday?"rgba(110,86,207,0.08)":hasBooking?"rgba(255,255,255,0.015)":"transparent",transition:"background 0.15s",position:"relative" }}
                         onMouseEnter={e=>e.currentTarget.style.background=isToday?"rgba(110,86,207,0.12)":"rgba(255,255,255,0.035)"}
                         onMouseLeave={e=>e.currentTarget.style.background=isToday?"rgba(110,86,207,0.08)":hasBooking?"rgba(255,255,255,0.015)":"transparent"}>
                      <div style={{ width:"22px",height:"22px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:isToday?"linear-gradient(135deg,#6E56CF,#9B7FE8)":"transparent",color:isToday?"#fff":isWeekend?"rgba(155,127,232,0.6)":"rgba(255,255,255,0.4)",fontSize:"11px",fontWeight:isToday?700:400,marginBottom:"3px",boxShadow:isToday?"0 2px 8px rgba(110,86,207,0.5)":"none" }}>{day}</div>
                      {dayBks.map(b=><BookingBadge key={b.id} booking={b} onClick={bk=>setModalState({type:"detail",booking:bk})}/>)}
                      {occ>0&&<div style={{ position:"absolute",top:"4px",right:"4px",width:"6px",height:"6px",borderRadius:"50%",background:occColor,boxShadow:`0 0 4px ${occColor}` }} title={`${Math.round(occ*100)}% occupied`}/>}
                      {!hasBooking&&<div style={{ color:"rgba(255,255,255,0.08)",fontSize:"16px",textAlign:"center",marginTop:"4px" }}>+</div>}
                    </div>
                );
              })}
            </div>

            {/* Legend */}
            <div style={{ display:"flex",gap:"12px",marginTop:"14px",flexWrap:"wrap",justifyContent:"center" }}>
              {SOURCES.map(s=><div key={s.id} style={{ display:"flex",alignItems:"center",gap:"5px",color:"rgba(255,255,255,0.3)",fontSize:"9px" }}><div style={{ width:"12px",height:"7px",borderRadius:"3px",background:s.color }}/><span>{s.icon}</span>{s.label}</div>)}
              <div style={{ display:"flex",alignItems:"center",gap:"5px",color:"rgba(255,255,255,0.3)",fontSize:"9px" }}><div style={{ width:"7px",height:"7px",borderRadius:"50%",background:"#FF5A5F" }}/>Full Day</div>
              <div style={{ display:"flex",alignItems:"center",gap:"5px",color:"rgba(255,255,255,0.3)",fontSize:"9px" }}><div style={{ width:"7px",height:"7px",borderRadius:"50%",background:"#FFBD2E" }}/>Half Day</div>
              <div style={{ display:"flex",alignItems:"center",gap:"5px",color:"rgba(255,255,255,0.3)",fontSize:"9px" }}><span style={{ fontSize:"8px" }}>½</span>Half-day booking</div>
            </div>
          </>}
        </div>

        {/* Profile Modal */}
        <Modal isOpen={showProfile} onClose={()=>setShowProfile(false)}>
          <ProfileModal
              user={user}
              onClose={()=>setShowProfile(false)}
              onUpdate={(updatedUser)=>{ setUser(updatedUser); setShowProfile(false); }}
          />
        </Modal>

        {/* Modals */}
        <Modal isOpen={modalState?.type==="addUnit"} onClose={()=>setModalState(null)}>
          <AddUnitModal onAdd={handleAddUnit} onClose={()=>setModalState(null)}/>
        </Modal>
        <Modal isOpen={modalState?.type==="add"} onClose={()=>setModalState(null)}>
          {modalState?.type==="add"&&selectedUnit&&<BookingForm date={modalState.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={null}/>}
        </Modal>
        <Modal isOpen={modalState?.type==="detail"} onClose={()=>setModalState(null)}>
          {modalState?.type==="detail"&&<BookingDetail booking={modalState.booking} unit={selectedUnit} onClose={()=>setModalState(null)} onEdit={bk=>setModalState({type:"edit",booking:bk})} onDelete={handleDelete}/>}
        </Modal>
        <Modal isOpen={modalState?.type==="edit"} onClose={()=>setModalState(null)}>
          {modalState?.type==="edit"&&selectedUnit&&<BookingForm date={modalState.booking.date} unit={selectedUnit} onSave={handleSave} onClose={()=>setModalState(null)} editBooking={modalState.booking}/>}
        </Modal>
      </div>
  );
}
