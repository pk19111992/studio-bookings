import { useState, useEffect, useCallback, useMemo } from "react";

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
const DAYS   = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
// Universal sources — available to every unit
const BASE_SOURCES = [
    { id:"direct",  label:"Direct",      icon:"🤝", color:"#60A5FA" },
    { id:"airbnb",  label:"Airbnb",      icon:"✈",  color:"#FF385C" },
    { id:"goibibo", label:"GoIbibo/MMT", icon:"🏨", color:"#F59E0B" },
];
// Built-in cap rule: these source ids count toward the "2 booking/day" cap
const ALWAYS_CAPPED = ["direct","airbnb","goibibo"];

// Combine base + unit's custom sources into one lookup list
function combineSources(customSources) {
    const custom = (customSources||[]).map(c => ({ id:c.source_key, label:c.label, icon:c.icon||"👤", color:c.color||"#94A3B8", custom:true, dbId:c.id }));
    return [...BASE_SOURCES, ...custom];
}

const STATUSES = [
    { id:"enquiry",    label:"Enquiry",     color:"#94A3B8" },
    { id:"confirmed",  label:"Confirmed",   color:"#60A5FA" },
    { id:"checked_in", label:"Checked In",  color:"#34D399" },
    { id:"checked_out",label:"Checked Out", color:"#A78BFA" },
    { id:"cancelled",  label:"Cancelled",   color:"#FF5A5F" },
];
const ST = Object.fromEntries(STATUSES.map(s=>[s.id,s]));

const PAY_STATUSES = [
    { id:"pending",  label:"Pending",  color:"#F59E0B" },
    { id:"partial",  label:"Partial",  color:"#60A5FA" },
    { id:"paid",     label:"Paid",     color:"#34D399" },
    { id:"refunded", label:"Refunded", color:"#FF5A5F" },
];
const PS = Object.fromEntries(PAY_STATUSES.map(s=>[s.id,s]));


// ── Helpers ───────────────────────────────────────────────────────────────────
function fmtDate(y,m,d)  { return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`; }
function uid()           { return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2,12); }
function getToken()      { return localStorage.getItem("gcbm_token"); }
function setToken(t)     { t ? localStorage.setItem("gcbm_token",t) : localStorage.removeItem("gcbm_token"); }
function addDays(dateStr,n) { const d=new Date(dateStr); d.setDate(d.getDate()+n); return d.toISOString().slice(0,10); }
function calcNights(ci,co)  { const n=Math.round((new Date(co)-new Date(ci))/86400000); return Math.max(n,1); }
function inrFmt(n)       { return `₹${Number(n||0).toLocaleString("en-IN")}`; }

function isHalfDay(b, sources) {
    const sourceList = sources || BASE_SOURCES;
    const isCustom = !ALWAYS_CAPPED.includes(b.source);
    // Half-day pricing rule applies to: direct + any custom source (ekant/urmit/etc), same-day, <=1500
    if (b.source === "direct" || isCustom) {
        return Number(b.total_amount||b.amount_per_night||0) <= 1500 && (b.nights||1) === 1 && b.checkin_date === b.checkout_date;
    }
    return false;
}
function getDayOccupancy(dayBks, customSourceKeys) {
    const customKeys = customSourceKeys || [];
    const capped = dayBks.filter(b => ALWAYS_CAPPED.includes(b.source));
    const customBookings = dayBks.filter(b => customKeys.includes(b.source));
    let occ = Math.min(capped.reduce((s,b)=>s+(isHalfDay(b)?0.5:1),0),1);
    occ += customBookings.reduce((s,b)=>s+(isHalfDay(b)?0.5:1),0);
    return Math.min(occ,1);
}

// ── API ───────────────────────────────────────────────────────────────────────
const BASE = "/api";
async function apiFetch(path, opts={}) {
    const token = getToken();
    const res = await fetch(`${BASE}${path}`, {
        ...opts,
        headers:{ "Content-Type":"application/json", ...(token?{Authorization:`Bearer ${token}`}:{}), ...(opts.headers||{}) },
    });
    if (res.status===401) { setToken(null); window.location.reload(); return; }
    if (!res.ok) { const t=await res.text(); throw new Error(t); }
    return res.json();
}
const API = {
    verify:        ()        => apiFetch("/auth?action=verify"),
    login:         (e,p)     => apiFetch("/auth?action=login",    {method:"POST",body:JSON.stringify({email:e,password:p})}),
    register:      (e,p,n)   => apiFetch("/auth?action=register", {method:"POST",body:JSON.stringify({email:e,password:p,name:n})}),
    googleUrl:     ()        => `${BASE}/auth?action=google`,
    updateProfile: (d)       => apiFetch("/auth?action=profile",         {method:"PATCH",body:JSON.stringify(d)}),
    changePassword:(c,n)     => apiFetch("/auth?action=change-password",  {method:"POST", body:JSON.stringify({currentPassword:c,newPassword:n})}),
    units:         ()        => apiFetch("/bookings?action=units"),
    addUnit:       (n,l)     => apiFetch("/bookings?action=units",{method:"POST",body:JSON.stringify({name:n,location:l})}),
    getBookings:   (uid)     => apiFetch(`/bookings?action=bookings&unit_id=${encodeURIComponent(uid)}`),
    stats:         (uid,m)   => apiFetch(`/bookings?action=stats&unit_id=${encodeURIComponent(uid)}&month=${m}`),
    allStats:      (m)       => apiFetch(`/bookings?action=stats&month=${m}`),
    saveBooking:   (b)       => apiFetch("/bookings?action=bookings",{method:"POST",body:JSON.stringify(b)}),
    patchBooking:  (id,d)    => apiFetch(`/bookings?action=bookings&id=${id}`,{method:"PATCH",body:JSON.stringify(d)}),
    deleteBooking: (id)      => apiFetch(`/bookings?action=bookings&id=${id}`,{method:"DELETE"}),
    allUsers:      ()        => apiFetch("/bookings?action=users"),
    getPerms:      (uid)     => apiFetch(`/bookings?action=permissions&unit_id=${encodeURIComponent(uid)}`),
    grantPerm:     (u,us)    => apiFetch("/bookings?action=permissions",{method:"POST",body:JSON.stringify({unit_id:u,user_id:us})}),
    revokePerm:    (u,us)    => apiFetch(`/bookings?action=permissions&unit_id=${encodeURIComponent(u)}&user_id=${us}`,{method:"DELETE"}),
    getSources:    (uid)     => apiFetch(`/bookings?action=sources&unit_id=${encodeURIComponent(uid)}`),
    addSource:     (uid,label,color,icon) => apiFetch("/bookings?action=sources",{method:"POST",body:JSON.stringify({unit_id:uid,label,color,icon})}),
    deleteSource:  (id)      => apiFetch(`/bookings?action=sources&id=${id}`,{method:"DELETE"}),
};

// ── Shared styles ─────────────────────────────────────────────────────────────
const inp  = { background:"var(--inp-bg)", border:"1px solid var(--border)", borderRadius:"8px", color:"var(--text)", padding:"9px 12px", fontSize:"12px", fontFamily:"'DM Mono', monospace", width:"100%", outline:"none", boxSizing:"border-box" };
const lbl  = { color:"var(--text-muted)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.1em", textTransform:"uppercase", display:"block", marginBottom:"4px" };
const card = { background:"var(--card-bg)", border:"1px solid var(--card-border)", borderRadius:"12px", padding:"16px" };
const fi   = e => e.target.style.borderColor="rgba(110,86,207,0.7)";
const fb   = e => e.target.style.borderColor="var(--border)";

// ── Modal wrapper ─────────────────────────────────────────────────────────────
function Modal({ isOpen, onClose, children, wide }) {
    useEffect(()=>{
        const h=e=>{if(e.key==="Escape")onClose();};
        window.addEventListener("keydown",h); return()=>window.removeEventListener("keydown",h);
    },[onClose]);
    if (!isOpen) return null;
    return (
        <div className="modal-overlay" onClick={onClose} style={{position:"fixed",inset:0,zIndex:1000,background:"rgba(10,10,18,0.85)",backdropFilter:"blur(6px)",display:"flex",alignItems:"center",justifyContent:"center",animation:"fadeIn 0.15s",padding:"16px"}}>
            <div className={wide?"modal-wide":"modal-box"} onClick={e=>e.stopPropagation()} style={{background:"var(--modal-bg)",border:`1px solid var(--modal-border)`,borderRadius:"16px",padding:"24px",width:"100%",maxWidth:wide?"760px":"500px",boxShadow:"0 24px 60px rgba(0,0,0,0.7)",animation:"slideUp 0.2s cubic-bezier(.34,1.4,.64,1)",maxHeight:"92vh",overflowY:"auto"}}>
                {children}
            </div>
        </div>
    );
}

// ── Status pill ───────────────────────────────────────────────────────────────
function Pill({ label, color, size=10 }) {
    return <span style={{background:`${color}22`,color,border:`1px solid ${color}44`,borderRadius:"4px",padding:"2px 7px",fontSize:`${size}px`,fontFamily:"'DM Mono', monospace",fontWeight:600,whiteSpace:"nowrap"}}>{label}</span>;
}

// ── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, onClose }) {
    return (
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"18px"}}>
            <div style={{color:"var(--text)",fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{title}</div>
            {onClose && <button onClick={onClose} style={{background:"var(--card-bg)",border:"none",borderRadius:"8px",color:"var(--text-soft)",cursor:"pointer",fontSize:"18px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center"}}>×</button>}
        </div>
    );
}

// ── LOGIN PAGE ────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
    const [tab,setTab]=useState("login");
    const [email,setEmail]=useState(""); const [name,setName]=useState("");
    const [pw,setPw]=useState(""); const [pw2,setPw2]=useState("");
    const [err,setErr]=useState(""); const [loading,setLoading]=useState(false);

    useEffect(()=>{
        const hash=window.location.hash;
        if(hash.includes("token=")){
            const t=hash.split("token=")[1]; setToken(t);
            window.location.hash=""; window.location.reload();
        }
        if(new URLSearchParams(window.location.search).get("error")) setErr("Sign-in failed. Please try again.");
    },[]);

    const submit=async()=>{
        setErr(""); setLoading(true);
        try {
            if(tab==="login"){ const r=await API.login(email,pw); setToken(r.token); onLogin(r.user); }
            else {
                if(pw!==pw2){setErr("Passwords don't match");setLoading(false);return;}
                if(pw.length<6){setErr("Password must be 6+ characters");setLoading(false);return;}
                const r=await API.register(email,pw,name); setToken(r.token); onLogin(r.user);
            }
        } catch(e){ setErr(e.message.includes("{")?JSON.parse(e.message).error:e.message); }
        setLoading(false);
    };

    const savedTheme = typeof localStorage !== 'undefined' ? (localStorage.getItem("gcbm_theme") || "dark") : "dark";
    return (
        <div className={`theme-${savedTheme}`} style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Mono', monospace",padding:"16px"}}>
            <div style={{width:"100%",maxWidth:"400px"}}>
                <div style={{textAlign:"center",marginBottom:"28px"}}>
                    <div style={{fontSize:"36px",marginBottom:"8px"}}>🏢</div>
                    <div style={{color:"var(--text)",fontSize:"22px",fontFamily:"'Playfair Display', serif",fontWeight:900}}>Gaur City</div>
                    <div style={{color:"var(--text-muted)",fontSize:"10px",letterSpacing:"0.2em",textTransform:"uppercase"}}>Booking Manager</div>
                </div>
                <div style={{background:"var(--card-bg)",border:"1px solid var(--card-border)",borderRadius:"16px",padding:"28px"}}>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px",background:"var(--card-bg)",borderRadius:"10px",padding:"4px",marginBottom:"20px"}}>
                        {["login","register"].map(t=>(
                            <button key={t} onClick={()=>{setTab(t);setErr("");}} style={{padding:"8px",borderRadius:"8px",border:"none",background:tab===t?"rgba(110,86,207,0.5)":"transparent",color:tab===t?"var(--text)":"rgba(255,255,255,0.35)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px",letterSpacing:"0.08em",textTransform:"uppercase"}}>
                                {t==="login"?"Sign In":"Register"}
                            </button>
                        ))}
                    </div>
                    <a href={API.googleUrl()} style={{display:"flex",alignItems:"center",justifyContent:"center",gap:"10px",padding:"11px",borderRadius:"10px",border:"1px solid rgba(255,255,255,0.12)",background:"var(--card-bg)",color:"var(--text)",textDecoration:"none",fontSize:"13px",fontFamily:"'DM Mono', monospace",marginBottom:"18px"}}
                       onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.08)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}>
                        <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.35-8.16 2.35-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
                        Continue with Google
                    </a>
                    <div style={{display:"flex",alignItems:"center",gap:"12px",marginBottom:"18px"}}>
                        <div style={{flex:1,height:"1px",background:"var(--inp-bg)"}}/>
                        <span style={{color:"var(--text-faint)",fontSize:"10px"}}>OR</span>
                        <div style={{flex:1,height:"1px",background:"var(--inp-bg)"}}/>
                    </div>
                    <div style={{display:"grid",gap:"10px"}}>
                        {tab==="register"&&<div><label style={lbl}>Full Name</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" onFocus={fi} onBlur={fb}/></div>}
                        <div><label style={lbl}>Email</label><input style={inp} type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@example.com" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
                        <div><label style={lbl}>Password</label><input style={inp} type="password" value={pw} onChange={e=>setPw(e.target.value)} placeholder="••••••••" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>
                        {tab==="register"&&<div><label style={lbl}>Confirm Password</label><input style={inp} type="password" value={pw2} onChange={e=>setPw2(e.target.value)} placeholder="••••••••" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&submit()}/></div>}
                    </div>
                    {err&&<div style={{color:"#FF7B7F",fontSize:"11px",marginTop:"12px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)"}}>⚠ {err}</div>}
                    <button onClick={submit} disabled={loading} style={{padding:"11px",borderRadius:"8px",border:"none",background:loading?"rgba(110,86,207,0.5)":"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:loading?"not-allowed":"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",width:"100%",marginTop:"16px",opacity:loading?0.7:1}}>
                        {loading?"Please wait…":tab==="login"?"Sign In":"Create Account"}
                    </button>
                </div>
                <div style={{textAlign:"center",marginTop:"12px",color:"var(--text-faint)",fontSize:"10px",fontFamily:"'DM Mono', monospace"}}>New users can register freely and add their own apartments</div>
            </div>
        </div>
    );
}

// ── PROFILE MODAL ─────────────────────────────────────────────────────────────
function ProfileModal({ user, onClose, onUpdate }) {
    const [tab,setTab]=useState("profile");
    const [name,setName]=useState(user.name||""); const [bio,setBio]=useState(user.bio||"");
    const [phone,setPhone]=useState(user.phone||""); const [avatarUrl,setAvatarUrl]=useState(user.avatar||"");
    const [preview,setPreview]=useState(user.avatar||"");
    const [curPw,setCurPw]=useState(""); const [newPw,setNewPw]=useState(""); const [confPw,setConfPw]=useState("");
    const [saving,setSaving]=useState(false); const [msg,setMsg]=useState({text:"",type:""});

    const showMsg=(text,type="ok")=>{ setMsg({text,type}); setTimeout(()=>setMsg({text:"",type:""}),3000); };

    const handleFile=e=>{
        const f=e.target.files[0]; if(!f) return;
        if(f.size>2*1024*1024){showMsg("Image must be under 2MB","err");return;}
        const r=new FileReader(); r.onload=ev=>{setPreview(ev.target.result);setAvatarUrl(ev.target.result);}; r.readAsDataURL(f);
    };

    const saveProfile=async()=>{
        if(!name.trim()){showMsg("Name required","err");return;}
        setSaving(true);
        try{ const r=await API.updateProfile({name:name.trim(),bio,phone,avatar:avatarUrl}); setToken(r.token); onUpdate(r.user); showMsg("Profile saved ✓"); }
        catch(e){ showMsg(e.message,"err"); }
        setSaving(false);
    };

    const savePw=async()=>{
        if(newPw.length<6){showMsg("Min 6 characters","err");return;}
        if(newPw!==confPw){showMsg("Passwords don't match","err");return;}
        setSaving(true);
        try{ await API.changePassword(curPw,newPw); setCurPw(""); setNewPw(""); setConfPw(""); showMsg("Password changed ✓"); }
        catch(e){ showMsg(e.message,"err"); }
        setSaving(false);
    };

    const initials=(user.name||user.email||"?")[0].toUpperCase();
    return (
        <>
            <SectionHeader title="My Profile" onClose={onClose}/>
            <div style={{display:"flex",alignItems:"center",gap:"14px",padding:"14px",background:"var(--card-bg)",borderRadius:"10px",border:"1px solid var(--card-border)",marginBottom:"18px"}}>
                <div style={{position:"relative",flexShrink:0}}>
                    {preview?<img src={preview} alt="" style={{width:"56px",height:"56px",borderRadius:"50%",objectFit:"cover",border:"3px solid rgba(110,86,207,0.5)"}} onError={()=>setPreview("")}/>
                        :<div style={{width:"56px",height:"56px",borderRadius:"50%",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"22px",fontWeight:700,color:"#fff"}}>{initials}</div>}
                    <label htmlFor="av-up" style={{position:"absolute",bottom:"-2px",right:"-2px",width:"20px",height:"20px",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",fontSize:"10px",border:"2px solid var(--bg)"}} title="Upload photo">📷<input id="av-up" type="file" accept="image/*" onChange={handleFile} style={{display:"none"}}/></label>
                </div>
                <div style={{flex:1,minWidth:0}}>
                    <div style={{color:"var(--text)",fontSize:"14px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{user.name||"—"}</div>
                    <div style={{color:"var(--text-muted)",fontSize:"10px",fontFamily:"'DM Mono', monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.email}</div>
                    <div style={{display:"flex",gap:"5px",marginTop:"5px"}}>
                        <Pill label={user.role==="admin"?"ADMIN":"USER"} color={user.role==="admin"?"#C4B5FD":"rgba(255,255,255,0.4)"} size={9}/>
                        <Pill label={user.provider==="google"?"Google":"Email"} color="rgba(255,255,255,0.3)" size={9}/>
                    </div>
                </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"4px",background:"var(--card-bg)",borderRadius:"10px",padding:"4px",marginBottom:"18px"}}>
                {[["profile","✏ Profile"],["password","🔒 Password"]].map(([t,l])=>(
                    <button key={t} onClick={()=>setTab(t)} style={{padding:"7px",borderRadius:"8px",border:"none",background:tab===t?"rgba(110,86,207,0.5)":"transparent",color:tab===t?"var(--text)":"rgba(255,255,255,0.35)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px"}}>{l}</button>
                ))}
            </div>
            {msg.text&&<div style={{color:msg.type==="err"?"#FF7B7F":"#74C69D",fontSize:"11px",marginBottom:"12px",padding:"8px 12px",background:msg.type==="err"?"rgba(255,90,95,0.1)":"rgba(39,201,63,0.08)",borderRadius:"6px",border:`1px solid ${msg.type==="err"?"rgba(255,90,95,0.2)":"rgba(39,201,63,0.2)"}`}}>{msg.type==="err"?"⚠":"✓"} {msg.text}</div>}
            {tab==="profile"&&(
                <div style={{display:"grid",gap:"12px"}}>
                    <div><label style={lbl}>Display Name</label><input style={inp} value={name} onChange={e=>setName(e.target.value)} onFocus={fi} onBlur={fb}/></div>
                    <div><label style={lbl}>Phone</label><input style={inp} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+91 98765 43210" onFocus={fi} onBlur={fb}/></div>
                    <div><label style={lbl}>Bio</label><textarea style={{...inp,resize:"vertical",minHeight:"60px"}} value={bio} onChange={e=>setBio(e.target.value)} onFocus={fi} onBlur={fb}/></div>
                    <div><label style={lbl}>Avatar URL</label><input style={inp} value={avatarUrl} onChange={e=>{setAvatarUrl(e.target.value);setPreview(e.target.value);}} placeholder="https://…" onFocus={fi} onBlur={fb}/></div>
                    <button onClick={saveProfile} disabled={saving} style={{padding:"10px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",opacity:saving?0.6:1}}>{saving?"Saving…":"Save Profile"}</button>
                </div>
            )}
            {tab==="password"&&(
                user.provider==="google"
                    ?<div style={{textAlign:"center",padding:"24px 0",color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"12px",lineHeight:1.8}}><div style={{fontSize:"28px",marginBottom:"10px"}}>🔗</div>Account uses Google sign-in.<br/>Password managed by Google.</div>
                    :<div style={{display:"grid",gap:"12px"}}>
                        <div><label style={lbl}>Current Password</label><input style={inp} type="password" value={curPw} onChange={e=>setCurPw(e.target.value)} onFocus={fi} onBlur={fb}/></div>
                        <div><label style={lbl}>New Password</label><input style={inp} type="password" value={newPw} onChange={e=>setNewPw(e.target.value)} onFocus={fi} onBlur={fb}/></div>
                        <div><label style={lbl}>Confirm New Password</label><input style={inp} type="password" value={confPw} onChange={e=>setConfPw(e.target.value)} onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&savePw()}/></div>
                        {newPw.length>0&&<div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                            {[["6+ chars",newPw.length>=6],["Number",/\d/.test(newPw)],["Uppercase",/[A-Z]/.test(newPw)],["Matches",newPw===confPw&&confPw.length>0]].map(([l,ok])=>(
                                <span key={l} style={{background:ok?"rgba(39,201,63,0.1)":"rgba(255,255,255,0.04)",color:ok?"#74C69D":"rgba(255,255,255,0.25)",borderRadius:"4px",padding:"2px 7px",fontSize:"9px",fontFamily:"'DM Mono', monospace"}}>{ok?"✓":"·"} {l}</span>
                            ))}
                        </div>}
                        <button onClick={savePw} disabled={saving} style={{padding:"10px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",opacity:saving?0.6:1}}>{saving?"Updating…":"Change Password"}</button>
                    </div>
            )}
        </>
    );
}

// ── BOOKING FORM ──────────────────────────────────────────────────────────────
function BookingForm({ unit, onSave, onClose, editBooking, defaultDate, sources, onAddSource }) {
    const today = new Date().toISOString().slice(0,10);
    const [showAddSrc, setShowAddSrc] = useState(false);
    const [newSrcLabel, setNewSrcLabel] = useState("");
    const [addingSrc, setAddingSrc] = useState(false);
    const [srcErr, setSrcErr] = useState("");

    const getDefaults = () => {
        if (editBooking) return {
            checkin_date:     editBooking.checkin_date,
            checkout_date:    editBooking.checkout_date,
            guest_name:       editBooking.guest_name || "Guest",
            guest_phone:      editBooking.guest_phone || "",
            source:           editBooking.source,
            check_in_time:    editBooking.check_in_time  || "11:00",
            check_out_time:   editBooking.check_out_time || "19:00",
            status:           editBooking.status || "confirmed",
            amount_per_night: editBooking.amount_per_night || "",
            total_amount:     editBooking.total_amount || "",
            paid_amount:      editBooking.paid_amount || "",
            payment_status:   editBooking.payment_status || "pending",
            overflow_to:      editBooking.overflow_to || "",
        };
        return {
            checkin_date: defaultDate || today, checkout_date: defaultDate || today,
            guest_name: "Guest", guest_phone: "",
            source: "direct", check_in_time: "11:00", check_out_time: "19:00",
            status: "confirmed", amount_per_night: "", total_amount: "",
            paid_amount: "", payment_status: "pending", overflow_to: "",
        };
    };

    const [f,setF]           = useState(getDefaults);
    const [err,setErr]       = useState("");
    const [saving,setSaving] = useState(false);

    const set = (k, v) => setF(p => {
        const n = { ...p, [k]: v };
        if (["amount_per_night","checkin_date","checkout_date"].includes(k)) {
            const isSameDay = n.checkin_date === n.checkout_date;
            const nights = isSameDay ? 1 : calcNights(n.checkin_date, n.checkout_date);
            if (n.amount_per_night) n.total_amount = (parseFloat(n.amount_per_night) * nights).toFixed(0);
        }
        return n;
    });

    const isSameDay  = f.checkin_date === f.checkout_date;
    const nights     = isSameDay ? 1 : calcNights(f.checkin_date, f.checkout_date);
    const isCustomSrc = !ALWAYS_CAPPED.includes(f.source);
    const showPayment = f.source === "direct" || isCustomSrc; // Airbnb/GoIbibo excluded — paid direct to account
    const halfDay    = isSameDay && (f.source === "direct" || isCustomSrc) && parseFloat(f.total_amount||0) <= 1500;

    const handleSave = async () => {
        if (!f.guest_name.trim()) { setErr("Guest name is required."); return; }
        if (!f.checkin_date)      { setErr("Check-in date is required."); return; }
        if (!f.total_amount || isNaN(parseFloat(f.total_amount))) { setErr("Amount is required."); return; }
        if (isSameDay) {
            const [ciH,ciM] = f.check_in_time.split(":").map(Number);
            const [coH,coM] = f.check_out_time.split(":").map(Number);
            if (coH*60+coM <= ciH*60+ciM) { setErr("Check-out time must be after check-in time for same-day bookings."); return; }
        }
        setErr(""); setSaving(true);
        try {
            const payStatus = ["airbnb","goibibo"].includes(f.source) ? "paid" : f.payment_status;
            const paidAmt   = payStatus === "paid" ? parseFloat(f.total_amount)||0 : parseFloat(f.paid_amount)||0;
            await onSave({
                id: editBooking?.id || uid(), unit_id: unit.id,
                checkin_date: f.checkin_date, checkout_date: f.checkout_date, nights,
                guest_name: f.guest_name.trim(), guest_phone: f.guest_phone.trim(),
                source: f.source, check_in_time: f.check_in_time, check_out_time: f.check_out_time,
                status: f.status,
                amount_per_night: parseFloat(f.amount_per_night) || parseFloat(f.total_amount) || 0,
                total_amount: parseFloat(f.total_amount) || 0,
                paid_amount: paidAmt, payment_status: payStatus,
                platform_commission_pct: 0, platform_commission_amt: 0,
                security_deposit: 0, deposit_returned: false,
                overflow_to: f.overflow_to, notes: "", special_requests: "",
            });
        } catch(e) { setErr(e.message); }
        setSaving(false);
    };

    return (
        <>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"16px"}}>
                <div>
                    <div style={{color:"rgba(110,86,207,0.8)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"2px"}}>{unit.name}</div>
                    <div style={{color:"var(--text)",fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{editBooking?"Edit Booking":"New Booking"}</div>
                    <div style={{color:"var(--text-muted)",fontSize:"10px",fontFamily:"'DM Mono', monospace",marginTop:"2px"}}>
                        {isSameDay ? `Same day · ${halfDay?"½ Half day":"Full day"}` : `${nights} night${nights>1?"s":""}`}
                    </div>
                </div>
                <button onClick={onClose} style={{background:"var(--card-bg)",border:"none",borderRadius:"8px",color:"var(--text-soft)",cursor:"pointer",fontSize:"18px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
            </div>

            <div style={{display:"grid",gap:"14px"}}>

                {/* Dates */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <div><label style={lbl}>Check-In Date</label>
                        <input style={inp} type="date" value={f.checkin_date}
                               onChange={e=>{set("checkin_date",e.target.value); if(e.target.value>f.checkout_date) set("checkout_date",e.target.value);}}
                               onFocus={fi} onBlur={fb}/>
                    </div>
                    <div><label style={lbl}>Check-Out Date</label>
                        <input style={inp} type="date" value={f.checkout_date} min={f.checkin_date}
                               onChange={e=>set("checkout_date",e.target.value)} onFocus={fi} onBlur={fb}/>
                    </div>
                </div>

                {/* Times */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <div><label style={lbl}>Check-In Time</label>
                        <input style={inp} type="time" value={f.check_in_time} onChange={e=>set("check_in_time",e.target.value)}/>
                    </div>
                    <div>
                        <label style={lbl}>Check-Out Time {isSameDay&&<span style={{color:"var(--text-muted)",fontSize:"8px"}}>(same day)</span>}</label>
                        <input style={inp} type="time" value={f.check_out_time} onChange={e=>set("check_out_time",e.target.value)}/>
                    </div>
                </div>

                {/* Quick presets */}
                <div>
                    <label style={lbl}>Quick Presets</label>
                    <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                        {[
                            {label:"1st Half",  ci:"11:00", co:"19:00", coDt:f.checkin_date,              tip:"11am – 7pm same day"},
                            {label:"2nd Half",  ci:"19:30", co:"10:00", coDt:addDays(f.checkin_date,1),   tip:"7:30pm – 10am next day"},
                            {label:"Full Day",  ci:"14:00", co:"11:00", coDt:addDays(f.checkin_date,1),   tip:"2pm – 11am next day"},
                            {label:"2 Nights",  ci:"14:00", co:"11:00", coDt:addDays(f.checkin_date,2),   tip:"2 nights"},
                        ].map(p=>(
                            <button key={p.label} title={p.tip} onClick={()=>setF(prev=>({...prev,check_in_time:p.ci,check_out_time:p.co,checkout_date:p.coDt}))}
                                    style={{padding:"4px 10px",borderRadius:"6px",border:"1px solid var(--border)",background:"var(--card-bg)",color:"rgba(255,255,255,0.55)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",transition:"all 0.15s"}}
                                    onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(110,86,207,0.5)";e.currentTarget.style.color="#C4B5FD";}}
                                    onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.1)";e.currentTarget.style.color="rgba(255,255,255,0.55)";}}>
                                {p.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Source */}
                <div>
                    <label style={lbl}>Booking Source</label>
                    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(sources.length+1,6)},1fr)`,gap:"5px"}}>
                        {sources.map(s=>(
                            <button key={s.id} onClick={()=>set("source",s.id)} style={{padding:"8px 4px",borderRadius:"8px",border:`1px solid ${f.source===s.id?s.color:"rgba(255,255,255,0.08)"}`,background:f.source===s.id?`${s.color}22`:"rgba(255,255,255,0.02)",color:f.source===s.id?s.color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",transition:"all 0.15s"}}>
                                <span style={{fontSize:"14px"}}>{s.icon}</span>
                                <span style={{textAlign:"center",lineHeight:1.1}}>{s.label}</span>
                            </button>
                        ))}
                        <button onClick={()=>setShowAddSrc(true)} style={{padding:"8px 4px",borderRadius:"8px",border:"1px dashed rgba(255,255,255,0.15)",background:"transparent",color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:"3px",transition:"all 0.15s"}}
                                onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(110,86,207,0.5)";e.currentTarget.style.color="#C4B5FD";}}
                                onMouseLeave={e=>{e.currentTarget.style.borderColor="rgba(255,255,255,0.15)";e.currentTarget.style.color="rgba(255,255,255,0.3)";}}>
                            <span style={{fontSize:"14px"}}>+</span>
                            <span>Add New</span>
                        </button>
                    </div>

                    {/* Inline add custom source */}
                    {showAddSrc && (
                        <div style={{marginTop:"8px",padding:"10px",background:"rgba(110,86,207,0.06)",border:"1px solid rgba(110,86,207,0.2)",borderRadius:"8px"}}>
                            <div style={{display:"flex",gap:"6px"}}>
                                <input autoFocus style={{...inp,flex:1}} value={newSrcLabel} onChange={e=>setNewSrcLabel(e.target.value)} placeholder="e.g. Rajesh, Booking.com…" onFocus={fi} onBlur={fb}
                                       onKeyDown={async e=>{ if(e.key==="Enter"){ if(!newSrcLabel.trim())return; setAddingSrc(true); setSrcErr(""); try{ const newId=await onAddSource(newSrcLabel.trim()); set("source",newId); setNewSrcLabel(""); setShowAddSrc(false);}catch(err){setSrcErr(err.message);} setAddingSrc(false);} }}/>
                                <button onClick={async()=>{ if(!newSrcLabel.trim())return; setAddingSrc(true); setSrcErr(""); try{ const newId=await onAddSource(newSrcLabel.trim()); set("source",newId); setNewSrcLabel(""); setShowAddSrc(false);}catch(err){setSrcErr(err.message);} setAddingSrc(false); }} disabled={addingSrc||!newSrcLabel.trim()} style={{padding:"8px 14px",borderRadius:"6px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:700,opacity:addingSrc||!newSrcLabel.trim()?0.5:1}}>{addingSrc?"…":"Add"}</button>
                                <button onClick={()=>{setShowAddSrc(false);setNewSrcLabel("");setSrcErr("");}} style={{padding:"8px 10px",borderRadius:"6px",border:"none",background:"var(--card-bg)",color:"var(--text-muted)",cursor:"pointer",fontSize:"13px"}}>×</button>
                            </div>
                            {srcErr && <div style={{color:"#FF7B7F",fontSize:"10px",marginTop:"6px",fontFamily:"'DM Mono', monospace"}}>⚠ {srcErr}</div>}
                            <div style={{color:"var(--text-muted)",fontSize:"9px",marginTop:"6px",fontFamily:"'DM Mono', monospace"}}>This source will only be available for {unit.name}</div>
                        </div>
                    )}
                </div>

                {/* Guest */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <div><label style={lbl}>Guest Name</label>
                        <input style={inp} value={f.guest_name} onChange={e=>set("guest_name",e.target.value)} placeholder="Guest" onFocus={fi} onBlur={fb}/>
                    </div>
                    <div><label style={lbl}>Mobile Number</label>
                        <input style={inp} value={f.guest_phone} onChange={e=>set("guest_phone",e.target.value)} placeholder="+91 98765 43210" onFocus={fi} onBlur={fb}/>
                    </div>
                </div>

                {/* Amount */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <div>
                        <label style={lbl}>Amount (₹){nights>1&&<span style={{color:"var(--text-muted)",fontSize:"8px"}}> per night</span>}</label>
                        <input style={inp} type="number" min="0" value={f.amount_per_night} onChange={e=>set("amount_per_night",e.target.value)} placeholder="e.g. 1800" onFocus={fi} onBlur={fb}/>
                    </div>
                    <div><label style={lbl}>Total Amount (₹)</label>
                        <input style={inp} type="number" min="0" value={f.total_amount} onChange={e=>set("total_amount",e.target.value)} placeholder="e.g. 1800" onFocus={fi} onBlur={fb}/>
                    </div>
                </div>

                {/* Half/full indicator */}
                {parseFloat(f.total_amount)>0 && isSameDay && (f.source==="direct" || isCustomSrc) && (
                    <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <span style={{background:halfDay?"rgba(251,191,36,0.15)":"rgba(52,211,153,0.15)",color:halfDay?"#FBbf24":"#34D399",borderRadius:"4px",padding:"3px 10px",fontSize:"10px",fontFamily:"'DM Mono', monospace"}}>
              {halfDay?"½ Half Day (≤₹1500)":"Full Day (>₹1500)"}
            </span>
                    </div>
                )}

                {/* Payment — Direct / Custom sources only */}
                {showPayment && (
                    <div style={{background:"var(--card-bg)",border:"1px solid var(--card-border)",borderRadius:"8px",padding:"12px 14px"}}>
                        <label style={{...lbl,marginBottom:"8px"}}>Payment</label>
                        <div style={{display:"flex",gap:"5px",marginBottom:"8px"}}>
                            {[{id:"pending",label:"⏳ Pending",c:"#F59E0B"},{id:"partial",label:"💵 Partial",c:"#60A5FA"},{id:"paid",label:"✓ Paid",c:"#34D399"}].map(ps=>(
                                <button key={ps.id} onClick={()=>{set("payment_status",ps.id); if(ps.id==="paid") set("paid_amount",f.total_amount); if(ps.id==="pending") set("paid_amount","");}}
                                        style={{flex:1,padding:"6px 4px",borderRadius:"6px",border:`1px solid ${f.payment_status===ps.id?ps.c:"rgba(255,255,255,0.08)"}`,background:f.payment_status===ps.id?`${ps.c}22`:"transparent",color:f.payment_status===ps.id?ps.c:"rgba(255,255,255,0.35)",fontFamily:"'DM Mono', monospace",fontSize:"10px",cursor:"pointer",fontWeight:f.payment_status===ps.id?700:400,transition:"all 0.15s"}}>
                                    {ps.label}
                                </button>
                            ))}
                        </div>
                        {f.payment_status==="partial" && (
                            <div style={{animation:"fadeIn 0.15s ease"}}>
                                <label style={lbl}>Amount Paid (₹)</label>
                                <input style={inp} type="number" min="0" max={parseFloat(f.total_amount)||undefined}
                                       value={f.paid_amount} onChange={e=>set("paid_amount",e.target.value)}
                                       placeholder={`Partial amount (total: ${inrFmt(f.total_amount)})`} onFocus={fi} onBlur={fb}/>
                                {parseFloat(f.paid_amount)>0 && parseFloat(f.total_amount)>0 && (
                                    <div style={{display:"flex",gap:"8px",marginTop:"5px"}}>
                                        <span style={{color:"#34D399",fontSize:"10px",fontFamily:"'DM Mono', monospace"}}>Paid: {inrFmt(f.paid_amount)}</span>
                                        <span style={{color:"#F59E0B",fontSize:"10px",fontFamily:"'DM Mono', monospace"}}>Due: {inrFmt(Math.max(0,parseFloat(f.total_amount)-parseFloat(f.paid_amount)))}</span>
                                    </div>
                                )}
                            </div>
                        )}
                        {f.source!=="direct" && (
                            <div style={{color:"var(--text-faint)",fontSize:"9px",fontFamily:"'DM Mono', monospace",marginTop:"6px"}}>
                                {sources.find(s=>s.id===f.source)?.label||f.source} — settle at month end via UPI
                            </div>
                        )}
                    </div>
                )}

                {/* Airbnb / MMT note */}
                {["airbnb","goibibo"].includes(f.source) && (
                    <div style={{background:"var(--header-bg)",border:"1px solid var(--card-border)",borderRadius:"8px",padding:"10px 14px"}}>
                        <div style={{color:"var(--text-muted)",fontSize:"10px",fontFamily:"'DM Mono', monospace"}}>
                            💳 {f.source==="airbnb"?"Airbnb":"MMT/GoIbibo"} payment deposited directly to your account
                        </div>
                    </div>
                )}

                {/* Status + Overflow */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    <div><label style={lbl}>Booking Status</label>
                        <select style={inp} value={f.status} onChange={e=>set("status",e.target.value)}>
                            {STATUSES.map(s=><option key={s.id} value={s.id} style={{background:"var(--select-bg)"}}>{s.label}</option>)}
                        </select>
                    </div>
                    <div><label style={lbl}>Overflow to Ekant</label>
                        <div style={{display:"flex",alignItems:"center",gap:"8px",height:"38px"}}>
                            <input type="checkbox" id="ov" checked={f.overflow_to==="ekant"} onChange={e=>set("overflow_to",e.target.checked?"ekant":"")} style={{width:"16px",height:"16px",accentColor:"#A78BFA",cursor:"pointer"}}/>
                            <label htmlFor="ov" style={{color:"var(--text-soft)",fontSize:"11px",fontFamily:"'DM Mono', monospace",cursor:"pointer"}}>Pass to Ekant</label>
                        </div>
                    </div>
                </div>

            </div>

            {err&&<div style={{color:"#FF7B7F",fontSize:"11px",marginTop:"12px",padding:"8px 12px",background:"rgba(255,90,95,0.1)",borderRadius:"6px",border:"1px solid rgba(255,90,95,0.2)"}}>⚠ {err}</div>}

            <div style={{display:"flex",gap:"10px",marginTop:"18px"}}>
                <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:"8px",border:"1px solid var(--border)",background:"transparent",color:"var(--text-muted)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"12px"}}>Cancel</button>
                <button onClick={handleSave} disabled={saving} style={{flex:2,padding:"10px",borderRadius:"8px",border:"none",background:saving?"rgba(110,86,207,0.5)":"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:saving?"not-allowed":"pointer",fontWeight:700,fontFamily:"'DM Mono', monospace",fontSize:"12px",opacity:saving?0.7:1}}>
                    {saving?"Saving…":editBooking?"Update Booking":"Save Booking"}
                </button>
            </div>
        </>
    );
}

// ── PAYMENT CONTROLS ──────────────────────────────────────────────────────────
function PaymentControls({ booking: b, onUpdate }) {
    const [mode, setMode]       = useState("buttons"); // buttons | partial
    const [partialAmt, setPartialAmt] = useState("");
    const [saving, setSaving]   = useState(false);
    const [err, setErr]         = useState("");
    const src = b.source;
    const total   = Number(b.total_amount || 0);
    const paid    = Number(b.paid_amount  || 0);
    const due     = Math.max(0, total - paid);

    const handlePartial = async () => {
        const amt = parseFloat(partialAmt);
        if (!amt || isNaN(amt) || amt <= 0)   { setErr("Enter a valid amount."); return; }
        if (amt > due)                         { setErr(`Cannot exceed due amount ${inrFmt(due)}.`); return; }
        setErr(""); setSaving(true);
        const newPaid   = paid + amt;
        const newStatus = newPaid >= total ? "paid" : "partial";
        await onUpdate(b.id, newStatus, newPaid);
        setPartialAmt(""); setMode("buttons"); setSaving(false);
    };

    const handleFullPaid   = () => onUpdate(b.id, "paid",    total);
    const handleMarkPending = () => onUpdate(b.id, "pending", 0);

    return (
        <div style={{borderTop:"1px solid var(--border)",paddingTop:"10px"}}>
            {mode === "buttons" ? (
                <>
                    <div style={{display:"flex",gap:"4px",marginBottom:"5px"}}>
                        <button onClick={handleMarkPending} disabled={b.payment_status==="pending"}
                                style={{flex:1,padding:"5px 6px",borderRadius:"6px",border:`1px solid ${b.payment_status==="pending"?"#F59E0B":"rgba(255,255,255,0.06)"}`,background:b.payment_status==="pending"?"rgba(245,158,11,0.15)":"transparent",color:b.payment_status==="pending"?"#F59E0B":"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",fontWeight:b.payment_status==="pending"?700:400}}>
                            ⏳ Pending
                        </button>
                        <button onClick={()=>setMode("partial")}
                                style={{flex:1,padding:"5px 6px",borderRadius:"6px",border:`1px solid ${b.payment_status==="partial"?"#60A5FA":"rgba(255,255,255,0.06)"}`,background:b.payment_status==="partial"?"rgba(96,165,250,0.15)":"transparent",color:b.payment_status==="partial"?"#60A5FA":"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",fontWeight:b.payment_status==="partial"?700:400}}>
                            💵 Partial
                        </button>
                        <button onClick={handleFullPaid} disabled={b.payment_status==="paid"}
                                style={{flex:1,padding:"5px 6px",borderRadius:"6px",border:`1px solid ${b.payment_status==="paid"?"#34D399":"rgba(255,255,255,0.06)"}`,background:b.payment_status==="paid"?"rgba(52,211,153,0.15)":"transparent",color:b.payment_status==="paid"?"#34D399":"rgba(255,255,255,0.3)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",fontWeight:b.payment_status==="paid"?700:400}}>
                            ✓ Paid
                        </button>
                    </div>
                    {src !== "direct" && (
                        <div style={{color:"var(--text-faint)",fontSize:"9px",fontFamily:"'DM Mono', monospace"}}>
                            Settle at month end via UPI
                        </div>
                    )}
                </>
            ) : (
                <div style={{animation:"fadeIn 0.15s ease"}}>
                    <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",marginBottom:"6px"}}>
                        ADD PARTIAL PAYMENT · Due: {inrFmt(due)}
                    </div>
                    <div style={{display:"flex",gap:"6px"}}>
                        <input autoFocus style={{...inp,flex:1}} type="number" min="1" max={due}
                               value={partialAmt} onChange={e=>setPartialAmt(e.target.value)}
                               placeholder={`Amount (max ${inrFmt(due)})`} onFocus={fi} onBlur={fb}
                               onKeyDown={e=>{if(e.key==="Enter")handlePartial();if(e.key==="Escape")setMode("buttons");}}/>
                        <button onClick={handlePartial} disabled={saving||!partialAmt}
                                style={{padding:"8px 12px",borderRadius:"6px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:700,opacity:saving||!partialAmt?0.5:1}}>
                            {saving?"…":"Add"}
                        </button>
                        <button onClick={()=>{setMode("buttons");setPartialAmt("");setErr("");}}
                                style={{padding:"8px 10px",borderRadius:"6px",border:"none",background:"var(--card-bg)",color:"var(--text-muted)",cursor:"pointer",fontSize:"13px"}}>×</button>
                    </div>
                    {err&&<div style={{color:"#FF7B7F",fontSize:"10px",marginTop:"5px",fontFamily:"'DM Mono', monospace"}}>⚠ {err}</div>}
                    {/* Quick presets */}
                    {due > 0 && (
                        <div style={{display:"flex",gap:"5px",marginTop:"7px",flexWrap:"wrap"}}>
                            {[25,50,75,100].map(pct=>{
                                const amt = Math.round(total*pct/100);
                                const remaining = Math.min(amt - paid, due);
                                if (remaining <= 0) return null;
                                return <button key={pct} onClick={()=>setPartialAmt(String(remaining))}
                                               style={{padding:"3px 8px",borderRadius:"5px",border:"1px solid var(--card-border)",background:"var(--card-bg)",color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer"}}>
                                    {pct}% · {inrFmt(remaining)}
                                </button>;
                            })}
                            <button onClick={()=>setPartialAmt(String(due))}
                                    style={{padding:"3px 8px",borderRadius:"5px",border:"1px solid rgba(52,211,153,0.3)",background:"rgba(52,211,153,0.08)",color:"#34D399",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer"}}>
                                Full due · {inrFmt(due)}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}

// ── BOOKING DETAIL ────────────────────────────────────────────────────────────
function BookingDetail({ booking:b, unit, sources, onClose, onEdit, onDelete, onStatusChange, onPaymentUpdate }) {
    const [deleting,setDeleting]=useState(false);
    const [updatingStatus,setUpdatingStatus]=useState(false);
    const src = sources.find(s=>s.id===b.source) || { label:b.source, icon:"❓", color:"#94A3B8" };
    const st  = ST[b.status]||ST.confirmed;
    const ps  = PS[b.payment_status]||PS.pending;
    const nights = b.nights || calcNights(b.checkin_date, b.checkin_date===b.checkout_date ? addDays(b.checkout_date,1) : b.checkout_date);
    const due = Math.max(0, Number(b.total_amount||0) - Number(b.paid_amount||0));
    const showPayment = b.source === "direct" || !ALWAYS_CAPPED.includes(b.source);

    const handleDelete=async()=>{ setDeleting(true); await onDelete(b.id); setDeleting(false); };
    const setStatus=async(status)=>{ setUpdatingStatus(true); await onStatusChange(b.id,status); setUpdatingStatus(false); };

    return (
        <>
            {/* Header */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:"14px"}}>
                <div>
                    <div style={{color:"rgba(110,86,207,0.7)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"4px"}}>{unit?.name}</div>
                    <div style={{display:"flex",gap:"5px",flexWrap:"wrap",marginBottom:"6px"}}>
                        <Pill label={src.label} color={src.color}/>
                        <Pill label={st.label} color={st.color}/>
                        {showPayment && <Pill label={ps.label} color={ps.color}/>}
                        {nights>1&&<Pill label={`${nights}N`} color="#94A3B8"/>}
                        {b.checkin_date===b.checkout_date&&<Pill label={isHalfDay(b)?"½ Day":"Full Day"} color={isHalfDay(b)?"#F59E0B":"#34D399"}/>}
                    </div>
                    <div style={{color:"var(--text)",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{b.guest_name}</div>
                    {b.guest_phone&&<div style={{color:"var(--text-muted)",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginTop:"2px"}}>📞 {b.guest_phone}</div>}
                    <div style={{color:"var(--text-muted)",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginTop:"2px"}}>
                        {b.checkin_date}{b.checkout_date!==b.checkin_date?` → ${b.checkout_date}`:""}
                    </div>
                </div>
                <button onClick={onClose} style={{background:"var(--card-bg)",border:"none",borderRadius:"8px",color:"var(--text-soft)",cursor:"pointer",fontSize:"18px",width:"32px",height:"32px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>×</button>
            </div>

            {/* Status workflow */}
            <div style={{marginBottom:"14px"}}>
                <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",marginBottom:"6px"}}>BOOKING STATUS</div>
                <div style={{display:"flex",gap:"4px",flexWrap:"wrap"}}>
                    {STATUSES.map(s=>(
                        <button key={s.id} onClick={()=>setStatus(s.id)} disabled={updatingStatus||b.status===s.id}
                                style={{padding:"4px 10px",borderRadius:"6px",border:`1px solid ${b.status===s.id?s.color:"rgba(255,255,255,0.08)"}`,background:b.status===s.id?`${s.color}22`:"transparent",color:b.status===s.id?s.color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:b.status===s.id?"default":"pointer",fontWeight:b.status===s.id?700:400}}>
                            {s.label}
                        </button>
                    ))}
                </div>
            </div>

            {/* Dates & times */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px",marginBottom:"12px"}}>
                {[
                    {l:"Check-In",  v:`${b.checkin_date}  ${b.check_in_time||"11:00"}`,  i:"⬆"},
                    {l:"Check-Out", v:`${b.checkout_date} ${b.check_out_time||"19:00"}`, i:"⬇"},
                ].map(item=>(
                    <div key={item.l} style={{background:"var(--card-bg)",borderRadius:"8px",padding:"10px 12px",border:"1px solid var(--card-border)"}}>
                        <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",marginBottom:"3px"}}>{item.i} {item.l.toUpperCase()}</div>
                        <div style={{color:"var(--text)",fontSize:"11px",fontFamily:"'DM Mono', monospace",fontWeight:600}}>{item.v}</div>
                    </div>
                ))}
            </div>

            {/* Financials */}
            <div style={{background:"linear-gradient(135deg,rgba(110,86,207,0.1),rgba(155,127,232,0.06))",borderRadius:"10px",padding:"12px 14px",border:"1px solid rgba(110,86,207,0.2)",marginBottom:"12px"}}>
                <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",marginBottom:"8px"}}>AMOUNT · {nights} NIGHT{nights>1?"S":""}</div>
                <div style={{display:"grid",gap:"5px",marginBottom:"10px"}}>
                    {[
                        ["Total", inrFmt(b.total_amount), "var(--text)"],
                        ...(showPayment ? [
                            ["Paid", inrFmt(b.paid_amount), "#34D399"],
                            ...(due > 0 ? [["Due", inrFmt(due), "#F59E0B"]] : []),
                        ] : [
                            ["Via " + (b.source==="airbnb"?"Airbnb":"MMT/GoIbibo"), "Direct to account", "rgba(255,255,255,0.35)"],
                        ]),
                    ].map(([k,v,c])=>(
                        <div key={k} style={{display:"flex",justifyContent:"space-between"}}>
                            <span style={{color:"var(--text-muted)",fontSize:"11px",fontFamily:"'DM Mono', monospace"}}>{k}</span>
                            <span style={{color:c,fontSize:"12px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{v}</span>
                        </div>
                    ))}
                </div>
                {b.payment_method&&<div style={{color:"var(--text-faint)",fontSize:"9px",fontFamily:"'DM Mono', monospace",marginBottom:"8px"}}>via {b.payment_method.replace("_"," ").toUpperCase()}</div>}

                {/* Payment controls — Direct/Custom sources only */}
                {showPayment && <PaymentControls booking={b} onUpdate={onPaymentUpdate}/>}
            </div>

            {/* Overflow */}
            {b.overflow_to&&(
                <div style={{background:"rgba(167,139,250,0.08)",borderRadius:"8px",padding:"8px 14px",border:"1px solid rgba(167,139,250,0.2)",marginBottom:"12px",display:"flex",alignItems:"center",gap:"6px"}}>
                    <span>👤</span>
                    <span style={{color:"#C4B5FD",fontSize:"11px",fontFamily:"'DM Mono', monospace"}}>↗ Passed to {b.overflow_to}</span>
                </div>
            )}

            <div style={{display:"flex",gap:"8px"}}>
                <button onClick={handleDelete} disabled={deleting} style={{flex:1,padding:"9px",borderRadius:"8px",border:"1px solid rgba(255,90,95,0.3)",background:"rgba(255,90,95,0.08)",color:"#FF7B7F",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px"}}>{deleting?"…":"Delete"}</button>
                <button onClick={()=>onEdit(b)} style={{flex:2,padding:"9px",borderRadius:"8px",border:"none",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",color:"#fff",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"11px",fontWeight:700}}>Edit Booking</button>
            </div>
        </>
    );
}

// ── BOOKING BADGE on calendar ─────────────────────────────────────────────────
function BookingBadge({ booking:b, sources, onClick }) {
    const src = sources.find(s=>s.id===b.source) || { label:b.source, icon:"❓", color:"#94A3B8" };
    const st=ST[b.status]||ST.confirmed;
    const ps=PS[b.payment_status]||PS.pending;
    const half=isHalfDay(b); const multi=(b.nights||1)>1;
    return (
        <div onClick={e=>{e.stopPropagation();onClick(b);}} style={{background:`linear-gradient(135deg,${src.color}cc,${src.color}77)`,color:"#fff",borderRadius:"4px",padding:"2px 4px",fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600,cursor:"pointer",marginBottom:"2px",display:"flex",alignItems:"center",gap:"3px",overflow:"hidden",whiteSpace:"nowrap",transition:"transform 0.1s",opacity:b.status==="cancelled"?0.4:1}}
             onMouseEnter={e=>e.currentTarget.style.transform="scale(1.03)"} onMouseLeave={e=>e.currentTarget.style.transform="scale(1)"}>
            <span style={{fontSize:"8px",flexShrink:0}}>{src.icon}</span>
            <span style={{overflow:"hidden",textOverflow:"ellipsis",flex:1}}>{b.guest_name||src.label}</span>
            {half&&<span style={{fontSize:"7px",flexShrink:0,opacity:0.9}}>½</span>}
            {multi&&<span style={{fontSize:"7px",flexShrink:0,opacity:0.9}}>{b.nights}N</span>}
            {ps.id==="pending"&&<span style={{fontSize:"7px",flexShrink:0}}>⚠</span>}
            {b.overflow_to&&<span style={{fontSize:"7px",flexShrink:0}}>↗</span>}
        </div>
    );
}

// ── DASHBOARD ─────────────────────────────────────────────────────────────────
function Dashboard({ units, user }) {
    const today=new Date();
    const [sel,setSel]           = useState("all");
    const [year,setYear]         = useState(today.getFullYear());
    const [month,setMonth]       = useState(today.getMonth());
    const [srcFilter,setSrcFilter] = useState("all"); // "all" or source id
    const [data,setData]         = useState([]);
    const [loading,setLoading]   = useState(false);
    const [allSources,setAllSources] = useState([]);
    const [downloading,setDownloading] = useState(null); // null | "excel" | "pdf"

    const mStr = `${year}-${String(month+1).padStart(2,"0")}`;
    const dim  = new Date(year,month+1,0).getDate();

    useEffect(()=>{
        setLoading(true);
        const p=sel==="all"?API.allStats(mStr):API.stats(sel,mStr);
        p.then(r=>{setData(r||[]);setLoading(false);}).catch(()=>setLoading(false));
    },[sel,mStr]);

    useEffect(()=>{
        const ids=sel==="all"?units.map(u=>u.id):[sel];
        Promise.all(ids.map(id=>API.getSources(id).catch(()=>[])))
            .then(results=>{
                const merged={};
                results.flat().forEach(c=>{merged[c.source_key]={id:c.source_key,label:c.label,icon:c.icon||"👤",color:c.color||"#94A3B8"};});
                setAllSources(combineSources(Object.values(merged).map(c=>({source_key:c.id,label:c.label,icon:c.icon,color:c.color}))));
            });
    },[sel,units]);

    // Filtered data by source
    const filteredData = useMemo(()=>
            srcFilter==="all" ? data : data.filter(b=>b.source===srcFilter)
        ,[data,srcFilter]);

    const stats=useMemo(()=>{
        const bySrc={}, byStatus={};
        allSources.forEach(s=>{bySrc[s.id]={count:0,revenue:0,nights:0};});
        STATUSES.forEach(s=>{byStatus[s.id]=0;});
        let totalRev=0,totalNights=0,totalDue=0,totalPaid=0;
        const byDate={};
        filteredData.filter(b=>b.status!=="cancelled").forEach(b=>{
            bySrc[b.source]=bySrc[b.source]||{count:0,revenue:0,nights:0};
            bySrc[b.source].count++; bySrc[b.source].revenue+=Number(b.total_amount||0); bySrc[b.source].nights+=Number(b.nights||1);
            byStatus[b.status]=(byStatus[b.status]||0)+1;
            totalRev+=Number(b.total_amount||0); totalPaid+=Number(b.paid_amount||0);
            totalNights+=Number(b.nights||1); totalDue+=Math.max(0,Number(b.total_amount||0)-Number(b.paid_amount||0));
            const ci=new Date(b.checkin_date);
            const co=b.checkin_date===b.checkout_date?new Date(ci.getTime()+86400000):new Date(b.checkout_date);
            for(let d=new Date(ci);d<co;d.setDate(d.getDate()+1)){
                const k=d.toISOString().slice(0,10);
                if(k.startsWith(mStr)){if(!byDate[k])byDate[k]=[];byDate[k].push(b);}
            }
        });
        const occupiedDays=Object.values(byDate).reduce((s,bks)=>s+getDayOccupancy(bks),0);
        const occupancyPct=dim>0?Math.round((occupiedDays/dim)*100):0;
        const cancelled=filteredData.filter(b=>b.status==="cancelled").length;
        return {bySrc,byStatus,totalRev,totalPaid,totalNights,totalDue,occupiedDays,occupancyPct,cancelled,total:filteredData.filter(b=>b.status!=="cancelled").length};
    },[filteredData,dim,mStr,allSources]);

    const daily=useMemo(()=>{
        const map={};
        for(let d=1;d<=dim;d++){const k=fmtDate(year,month,d);map[k]=0;}
        filteredData.filter(b=>b.status!=="cancelled").forEach(b=>{
            const ci=new Date(b.checkin_date);
            const isSame=b.checkin_date===b.checkout_date;
            const co=isSame?new Date(ci.getTime()+86400000):new Date(b.checkout_date);
            const nights=calcNights(b.checkin_date,isSame?addDays(b.checkout_date,1):b.checkout_date);
            const perN=nights>0?Number(b.total_amount||0)/nights:Number(b.total_amount||0);
            for(let d=new Date(ci);d<co;d.setDate(d.getDate()+1)){
                const k=d.toISOString().slice(0,10);
                if(map[k]!==undefined) map[k]+=perN;
            }
        });
        return Object.entries(map).map(([date,rev])=>({date,rev:Math.round(rev)}));
    },[filteredData,year,month,dim]);
    const maxRev=Math.max(...daily.map(d=>d.rev),1);

    // ── Download helpers ────────────────────────────────────────────────────────
    const tableRows = [...filteredData].sort((a,b)=>a.checkin_date.localeCompare(b.checkin_date));

    const downloadExcel = () => {
        setDownloading("excel");
        const headers = ["Date","Check-Out","Unit","Guest","Phone","Nights","Source","Status","Payment","Total (₹)","Paid (₹)","Due (₹)"];
        const rows = tableRows.map(b=>{
            const src=allSources.find(s=>s.id===b.source)||{label:b.source};
            const st=ST[b.status]||{label:b.status};
            const ps=PS[b.payment_status]||{label:b.payment_status};
            const total=Number(b.total_amount||0), paid=Number(b.paid_amount||0);
            return [b.checkin_date, b.checkout_date, units.find(u=>u.id===b.unit_id)?.name||b.unit_id, b.guest_name, b.guest_phone||"", b.nights||1, src.label, st.label, ps.label, total, paid, Math.max(0,total-paid)];
        });
        // Summary row
        rows.push([]);
        rows.push(["TOTAL","","","","","",stats.totalNights,"","",stats.totalRev,stats.totalPaid,stats.totalDue]);

        // Build CSV (works as .csv open in Excel perfectly)
        const csv = [headers,...rows].map(r=>r.map(v=>`"${String(v).replace(/"/g,'""')}"`).join(",")).join("\n");
        const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
        const url  = URL.createObjectURL(blob);
        const a    = document.createElement("a");
        a.href=url; a.download=`bookings-${MONTHS[month]}-${year}${srcFilter!=="all"?"-"+srcFilter:""}.csv`;
        a.click(); URL.revokeObjectURL(url);
        setDownloading(null);
    };

    const downloadPDF = () => {
        setDownloading("pdf");
        const unitName = sel==="all"?"All Units":units.find(u=>u.id===sel)?.name||sel;
        const srcName  = srcFilter==="all"?"All Sources":allSources.find(s=>s.id===srcFilter)?.label||srcFilter;
        const title    = `Booking Report — ${unitName} · ${srcName} · ${MONTHS[month]} ${year}`;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>${title}</title>
    <style>
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:Arial,sans-serif;font-size:11px;color:#1a1a2e;padding:20px}
      h1{font-size:16px;margin-bottom:4px;color:#2d1b69}
      .sub{color:#666;font-size:10px;margin-bottom:16px}
      .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:16px}
      .kpi{background:#f5f3ff;border-radius:8px;padding:10px 12px}
      .kpi-l{font-size:9px;color:#666;text-transform:uppercase;letter-spacing:1px;margin-bottom:2px}
      .kpi-v{font-size:18px;font-weight:700;color:#2d1b69}
      table{width:100%;border-collapse:collapse;font-size:10px}
      th{background:#2d1b69;color:#fff;padding:6px 8px;text-align:left;white-space:nowrap}
      td{padding:5px 8px;border-bottom:1px solid #eee}
      tr:nth-child(even) td{background:#faf9ff}
      .tfoot td{background:#f5f3ff;font-weight:700;border-top:2px solid #2d1b69}
      .badge{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;font-weight:700}
      @media print{body{padding:10px}}
    </style></head><body>
    <h1>${title}</h1>
    <div class="sub">Generated on ${new Date().toLocaleString("en-IN")}</div>
    <div class="kpis">
      <div class="kpi"><div class="kpi-l">Total Revenue</div><div class="kpi-v">₹${Number(stats.totalRev).toLocaleString("en-IN")}</div></div>
      <div class="kpi"><div class="kpi-l">Paid</div><div class="kpi-v">₹${Number(stats.totalPaid).toLocaleString("en-IN")}</div></div>
      <div class="kpi"><div class="kpi-l">Outstanding</div><div class="kpi-v">₹${Number(stats.totalDue).toLocaleString("en-IN")}</div></div>
      <div class="kpi"><div class="kpi-l">Bookings</div><div class="kpi-v">${stats.total}</div></div>
      <div class="kpi"><div class="kpi-l">Total Nights</div><div class="kpi-v">${stats.totalNights}</div></div>
      <div class="kpi"><div class="kpi-l">Occupancy</div><div class="kpi-v">${stats.occupancyPct}%</div></div>
      <div class="kpi"><div class="kpi-l">Cancelled</div><div class="kpi-v">${stats.cancelled}</div></div>
      <div class="kpi"><div class="kpi-l">Occupied Days</div><div class="kpi-v">${stats.occupiedDays.toFixed(1)} / ${dim}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Date</th><th>Check-Out</th><th>Unit</th><th>Guest</th><th>Phone</th>
        <th>Nights</th><th>Source</th><th>Status</th><th>Payment</th><th>Total</th><th>Paid</th><th>Due</th>
      </tr></thead>
      <tbody>
        ${tableRows.map(b=>{
            const src=allSources.find(s=>s.id===b.source)||{label:b.source};
            const st=ST[b.status]||{label:b.status};
            const ps=PS[b.payment_status]||{label:b.payment_status};
            const total=Number(b.total_amount||0),paid=Number(b.paid_amount||0),due=Math.max(0,total-paid);
            return `<tr>
            <td>${b.checkin_date}</td>
            <td>${b.checkout_date}</td>
            <td>${units.find(u=>u.id===b.unit_id)?.name||b.unit_id}</td>
            <td>${b.guest_name}</td>
            <td>${b.guest_phone||"—"}</td>
            <td style="text-align:center">${b.nights||1}</td>
            <td>${src.label}</td>
            <td>${st.label}</td>
            <td>${ps.label}</td>
            <td style="text-align:right;font-weight:600">₹${total.toLocaleString("en-IN")}</td>
            <td style="text-align:right;color:${paid>=total?"#166534":"#92400e"}">₹${paid.toLocaleString("en-IN")}</td>
            <td style="text-align:right;color:${due>0?"#92400e":"#166534"}">₹${due.toLocaleString("en-IN")}</td>
          </tr>`;
        }).join("")}
      </tbody>
      <tfoot><tr class="tfoot">
        <td colspan="5">TOTAL (${tableRows.length} bookings)</td>
        <td style="text-align:center">${stats.totalNights}</td>
        <td colspan="3"></td>
        <td style="text-align:right">₹${Number(stats.totalRev).toLocaleString("en-IN")}</td>
        <td style="text-align:right">₹${Number(stats.totalPaid).toLocaleString("en-IN")}</td>
        <td style="text-align:right">₹${Number(stats.totalDue).toLocaleString("en-IN")}</td>
      </tr></tfoot>
    </table>
    <script>window.onload=()=>{window.print();}</script>
    </body></html>`;

        const win=window.open("","_blank");
        if(win){win.document.write(html);win.document.close();}
        setDownloading(null);
    };

    const BBtn=(t,l)=>(
        <button onClick={()=>setSel(t)} style={{padding:"5px 12px",borderRadius:"20px",border:`1px solid ${sel===t?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:sel===t?"rgba(110,86,207,0.2)":"transparent",color:sel===t?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"10px",cursor:"pointer",whiteSpace:"nowrap"}}>{l}</button>
    );

    return (
        <div style={{padding:"16px 0"}}>
            {/* ── Controls row ── */}
            <div style={{display:"flex",gap:"8px",flexWrap:"wrap",alignItems:"center",marginBottom:"12px"}}>
                <div style={{display:"flex",gap:"6px",flexWrap:"wrap"}}>
                    {BBtn("all","All Units")}
                    {units.map(u=>BBtn(u.id,u.name))}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:"6px",marginLeft:"auto"}}>
                    <button onClick={()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);}} style={{background:"var(--card-bg)",border:"none",borderRadius:"6px",color:"var(--text-soft)",cursor:"pointer",width:"26px",height:"26px",fontSize:"14px"}}>‹</button>
                    <span style={{color:"var(--text)",fontFamily:"'DM Mono', monospace",fontSize:"12px",minWidth:"130px",textAlign:"center"}}>{MONTHS[month]} {year}</span>
                    <button onClick={()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);}} style={{background:"var(--card-bg)",border:"none",borderRadius:"6px",color:"var(--text-soft)",cursor:"pointer",width:"26px",height:"26px",fontSize:"14px"}}>›</button>
                </div>
            </div>

            {/* ── Source filter + download row ── */}
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",alignItems:"center",marginBottom:"18px",padding:"10px 12px",background:"var(--header-bg)",borderRadius:"10px",border:"1px solid var(--card-border)"}}>
                <span style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.1em",textTransform:"uppercase",whiteSpace:"nowrap"}}>Filter by type:</span>
                <button onClick={()=>setSrcFilter("all")} style={{padding:"4px 10px",borderRadius:"16px",border:`1px solid ${srcFilter==="all"?"rgba(255,255,255,0.4)":"rgba(255,255,255,0.08)"}`,background:srcFilter==="all"?"rgba(255,255,255,0.08)":"transparent",color:srcFilter==="all"?"var(--text)":"rgba(255,255,255,0.35)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer"}}>All</button>
                {allSources.map(src=>(
                    <button key={src.id} onClick={()=>setSrcFilter(src.id)} style={{padding:"4px 10px",borderRadius:"16px",border:`1px solid ${srcFilter===src.id?src.color:"rgba(255,255,255,0.08)"}`,background:srcFilter===src.id?`${src.color}22`:"transparent",color:srcFilter===src.id?src.color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"9px",cursor:"pointer",display:"flex",alignItems:"center",gap:"4px"}}>
                        <span style={{fontSize:"10px"}}>{src.icon}</span>{src.label}
                    </button>
                ))}
                <div style={{marginLeft:"auto",display:"flex",gap:"6px"}}>
                    <button onClick={downloadExcel} disabled={!!downloading||filteredData.length===0}
                            style={{padding:"5px 12px",borderRadius:"8px",border:"1px solid rgba(52,211,153,0.4)",background:"rgba(52,211,153,0.08)",color:"#34D399",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:600,display:"flex",alignItems:"center",gap:"5px",opacity:downloading||filteredData.length===0?0.5:1}}>
                        {downloading==="excel"?"⏳":"⬇"} Excel
                    </button>
                    <button onClick={downloadPDF} disabled={!!downloading||filteredData.length===0}
                            style={{padding:"5px 12px",borderRadius:"8px",border:"1px solid rgba(167,139,250,0.4)",background:"rgba(167,139,250,0.08)",color:"#A78BFA",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:600,display:"flex",alignItems:"center",gap:"5px",opacity:downloading||filteredData.length===0?0.5:1}}>
                        {downloading==="pdf"?"⏳":"🖨"} PDF
                    </button>
                </div>
            </div>

            {loading?<div style={{color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"40px"}}>Loading…</div>:<>

                {/* ── KPIs ── */}
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"10px"}}>
                    {[
                        {l:"Revenue",      v:inrFmt(stats.totalRev),          a:"#86EFAC"},
                        {l:"Paid",         v:inrFmt(stats.totalPaid),         a:"#34D399"},
                        {l:"Outstanding",  v:inrFmt(stats.totalDue),          a:stats.totalDue>0?"#F59E0B":"#34D399"},
                        {l:"Occupancy",    v:`${stats.occupancyPct}%`,        a:"#6EE7B7"},
                    ].map(s=>(
                        <div key={s.l} style={card}>
                            <div style={{color:"var(--text-muted)",fontSize:"8px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"3px"}}>{s.l}</div>
                            <div style={{color:s.a,fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{s.v}</div>
                        </div>
                    ))}
                </div>
                <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"8px",marginBottom:"16px"}}>
                    {[
                        {l:"Bookings",     v:stats.total,                     a:"#C4B5FD"},
                        {l:"Total Nights", v:stats.totalNights,               a:"#60A5FA"},
                        {l:"Cancelled",    v:stats.cancelled,                 a:"#FF7B7F"},
                        {l:"Pending Pay",  v:(stats.byStatus.pending||0)+(stats.byStatus.partial||0), a:"#F59E0B"},
                    ].map(s=>(
                        <div key={s.l} style={card}>
                            <div style={{color:"var(--text-muted)",fontSize:"8px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"3px"}}>{s.l}</div>
                            <div style={{color:s.a,fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{s.v}</div>
                        </div>
                    ))}
                </div>

                {/* ── Source breakdown (clickable to filter) ── */}
                <div style={{...card,marginBottom:"16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                        <div style={{color:"var(--text-muted)",fontSize:"9px",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'DM Mono', monospace"}}>Bookings by Source</div>
                        {srcFilter!=="all"&&<button onClick={()=>setSrcFilter("all")} style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",background:"none",border:"none",cursor:"pointer"}}>✕ Clear filter</button>}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:`repeat(${Math.min(allSources.length||1,6)},1fr)`,gap:"6px"}}>
                        {allSources.map(src=>{
                            const s=stats.bySrc[src.id]||{count:0,revenue:0};
                            const isActive=srcFilter===src.id;
                            return (
                                <button key={src.id} onClick={()=>setSrcFilter(isActive?"all":src.id)}
                                        style={{background:isActive?`${src.color}22`:`${src.color}0d`,border:`${isActive?2:1}px solid ${isActive?src.color:src.color+"33"}`,borderRadius:"10px",padding:"10px",textAlign:"center",cursor:"pointer",transition:"all 0.15s"}}>
                                    <div style={{fontSize:"16px",marginBottom:"3px"}}>{src.icon}</div>
                                    <div style={{color:src.color,fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600,marginBottom:"5px"}}>{src.label}</div>
                                    <div style={{color:"var(--text)",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{s.count}</div>
                                    <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace"}}>{inrFmt(s.revenue)}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ── Payment status ── */}
                <div style={{...card,marginBottom:"16px"}}>
                    <div style={{color:"var(--text-muted)",fontSize:"9px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"12px",fontFamily:"'DM Mono', monospace"}}>Payment Status</div>
                    <div style={{display:"flex",gap:"8px",flexWrap:"wrap"}}>
                        {PAY_STATUSES.map(ps=>{
                            const bks=filteredData.filter(b=>b.payment_status===ps.id&&b.status!=="cancelled");
                            return <div key={ps.id} style={{background:`${ps.color}11`,border:`1px solid ${ps.color}33`,borderRadius:"8px",padding:"8px 12px",flex:1,minWidth:"90px"}}>
                                <div style={{color:ps.color,fontSize:"10px",fontFamily:"'DM Mono', monospace",fontWeight:600}}>{ps.label}</div>
                                <div style={{color:"var(--text)",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{bks.length}</div>
                                <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace"}}>{inrFmt(bks.reduce((s,b)=>s+Number(b.total_amount||0),0))}</div>
                            </div>;
                        })}
                    </div>
                </div>

                {/* ── Daily revenue chart ── */}
                <div style={{...card,marginBottom:"16px"}}>
                    <div style={{color:"var(--text-muted)",fontSize:"9px",letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:"12px",fontFamily:"'DM Mono', monospace"}}>
                        Daily Revenue — {MONTHS[month]} {year}{srcFilter!=="all"?` · ${allSources.find(s=>s.id===srcFilter)?.label||srcFilter}`:""}
                    </div>
                    <div style={{display:"flex",alignItems:"flex-end",gap:"2px",height:"100px"}}>
                        {daily.map(({date,rev})=>{
                            const h=maxRev>0?Math.max(rev/maxRev*100,rev>0?4:0):0;
                            const d=parseInt(date.split("-")[2]);
                            return <div key={date} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"3px"}} title={`${date}: ${inrFmt(rev)}`}>
                                <div style={{width:"100%",background:rev>0?"linear-gradient(180deg,#9B7FE8,#6E56CF)":"rgba(255,255,255,0.04)",height:`${h}%`,borderRadius:"2px 2px 0 0",minHeight:rev>0?"3px":"0",transition:"height 0.4s"}}/>
                                <div style={{color:"var(--text-faint)",fontSize:"7px",fontFamily:"'DM Mono', monospace"}}>{d}</div>
                            </div>;
                        })}
                    </div>
                </div>

                {/* ── Bookings table ── */}
                <div style={card}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"12px"}}>
                        <div style={{color:"var(--text-muted)",fontSize:"9px",letterSpacing:"0.1em",textTransform:"uppercase",fontFamily:"'DM Mono', monospace"}}>
                            {filteredData.length} Booking{filteredData.length!==1?"s":""} — {MONTHS[month]} {year}
                            {srcFilter!=="all"&&<span style={{color:"rgba(110,86,207,0.8)",marginLeft:"8px"}}>· {allSources.find(s=>s.id===srcFilter)?.label}</span>}
                        </div>
                        <div style={{display:"flex",gap:"5px"}}>
                            <button onClick={downloadExcel} disabled={filteredData.length===0} style={{padding:"4px 10px",borderRadius:"6px",border:"1px solid rgba(52,211,153,0.3)",background:"rgba(52,211,153,0.07)",color:"#34D399",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"9px",opacity:filteredData.length===0?0.4:1}}>⬇ Excel</button>
                            <button onClick={downloadPDF}   disabled={filteredData.length===0} style={{padding:"4px 10px",borderRadius:"6px",border:"1px solid rgba(167,139,250,0.3)",background:"rgba(167,139,250,0.07)",color:"#A78BFA",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"9px",opacity:filteredData.length===0?0.4:1}}>🖨 PDF</button>
                        </div>
                    </div>
                    {filteredData.length===0
                        ?<div style={{color:"var(--text-faint)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"20px"}}>No bookings found</div>
                        :<div style={{overflowX:"auto"}}>
                            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'DM Mono', monospace",fontSize:"10px"}}>
                                <thead><tr>{["Check-In","Check-Out","Unit","Guest","Phone","Nights","Source","Status","Payment","Total","Paid","Due"].map(h=>(
                                    <th key={h} style={{textAlign:"left",color:"var(--text-muted)",padding:"5px 8px",borderBottom:"1px solid var(--header-border)",whiteSpace:"nowrap",letterSpacing:"0.06em"}}>{h}</th>
                                ))}</tr></thead>
                                <tbody>
                                {tableRows.map(b=>{
                                    const src=allSources.find(s=>s.id===b.source)||{label:b.source,icon:"❓",color:"#94A3B8"};
                                    const st=ST[b.status]||ST.confirmed; const ps=PS[b.payment_status]||PS.pending;
                                    const total=Number(b.total_amount||0),paid=Number(b.paid_amount||0),due=Math.max(0,total-paid);
                                    return <tr key={b.id} style={{borderBottom:"1px solid rgba(255,255,255,0.03)",opacity:b.status==="cancelled"?0.5:1}}
                                               onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.02)"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                                        <td style={{padding:"6px 8px",color:"var(--text-soft)",whiteSpace:"nowrap"}}>{b.checkin_date}</td>
                                        <td style={{padding:"6px 8px",color:"var(--text-muted)",whiteSpace:"nowrap"}}>{b.checkout_date}</td>
                                        <td style={{padding:"6px 8px",color:"var(--text-muted)",whiteSpace:"nowrap"}}>{units.find(u=>u.id===b.unit_id)?.name||b.unit_id}</td>
                                        <td style={{padding:"6px 8px",color:"var(--text)",whiteSpace:"nowrap"}}>{b.guest_name}</td>
                                        <td style={{padding:"6px 8px",color:"var(--text-muted)",whiteSpace:"nowrap"}}>{b.guest_phone||"—"}</td>
                                        <td style={{padding:"6px 8px",color:"var(--text-muted)",textAlign:"center"}}>{b.nights||1}</td>
                                        <td style={{padding:"6px 8px"}}><span style={{background:`${src.color}22`,color:src.color,borderRadius:"4px",padding:"1px 5px",fontSize:"9px",fontWeight:600}}>{src.icon} {src.label}</span></td>
                                        <td style={{padding:"6px 8px"}}><span style={{background:`${st.color}22`,color:st.color,borderRadius:"4px",padding:"1px 5px",fontSize:"9px"}}>{st.label}</span></td>
                                        <td style={{padding:"6px 8px"}}><span style={{background:`${ps.color}22`,color:ps.color,borderRadius:"4px",padding:"1px 5px",fontSize:"9px"}}>{ps.label}</span></td>
                                        <td style={{padding:"6px 8px",color:"#C4B5FD",fontWeight:600,whiteSpace:"nowrap"}}>{inrFmt(total)}</td>
                                        <td style={{padding:"6px 8px",color:"#34D399",whiteSpace:"nowrap"}}>{inrFmt(paid)}</td>
                                        <td style={{padding:"6px 8px",color:due>0?"#F59E0B":"rgba(255,255,255,0.25)",whiteSpace:"nowrap"}}>{due>0?inrFmt(due):"—"}</td>
                                    </tr>;
                                })}
                                </tbody>
                                <tfoot><tr style={{background:"rgba(110,86,207,0.08)",borderTop:"1px solid rgba(110,86,207,0.2)"}}>
                                    <td colSpan={5} style={{padding:"7px 8px",color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"10px",fontWeight:700}}>TOTAL ({tableRows.length})</td>
                                    <td style={{padding:"7px 8px",color:"#60A5FA",textAlign:"center",fontWeight:700}}>{stats.totalNights}</td>
                                    <td colSpan={3}></td>
                                    <td style={{padding:"7px 8px",color:"#C4B5FD",fontWeight:700,whiteSpace:"nowrap"}}>{inrFmt(stats.totalRev)}</td>
                                    <td style={{padding:"7px 8px",color:"#34D399",fontWeight:700,whiteSpace:"nowrap"}}>{inrFmt(stats.totalPaid)}</td>
                                    <td style={{padding:"7px 8px",color:stats.totalDue>0?"#F59E0B":"rgba(255,255,255,0.25)",fontWeight:700,whiteSpace:"nowrap"}}>{stats.totalDue>0?inrFmt(stats.totalDue):"—"}</td>
                                </tr></tfoot>
                            </table>
                        </div>
                    }
                </div>
            </>}
        </div>
    );
}

// ── ICAL SYNC PANEL ───────────────────────────────────────────────────────────
function IcalSyncPanel({ units, selUnit }) {
    const [unit, setUnit]         = useState(selUnit?.id || units[0]?.id || "");
    const [importUrl, setImportUrl] = useState("");
    const [platform, setPlatform]   = useState("airbnb");
    const [links, setLinks]         = useState(null);
    const [loading, setLoading]     = useState(false);
    const [msg, setMsg]             = useState({ text:"", type:"" });
    const [syncing, setSyncing]     = useState(false);
    const [syncResults, setSyncResults] = useState([]);

    const showMsg = (text, type="ok") => { setMsg({ text, type }); setTimeout(() => setMsg({ text:"", type:"" }), 4000); };

    // Load export links when unit changes
    useEffect(() => {
        if (!unit) return;
        fetch(`/api/ical?action=links&unit_id=${encodeURIComponent(unit)}`)
            .then(r => r.json()).then(setLinks).catch(() => {});
    }, [unit]);

    const copyUrl = (url) => {
        navigator.clipboard.writeText(url).then(() => showMsg("URL copied to clipboard ✓")).catch(() => showMsg("Copy failed — select and copy manually", "err"));
    };

    const handleImport = async () => {
        if (!importUrl.trim()) return showMsg("Paste a calendar URL first", "err");
        setSyncing(true);
        try {
            const res = await fetch(`/api/ical?action=import&unit_id=${encodeURIComponent(unit)}`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ url: importUrl.trim() }),
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || "Import failed");
            setSyncResults(prev => [{
                platform, unit: units.find(u => u.id === unit)?.name || unit,
                imported: data.imported, skipped: data.skipped, total: data.total,
                time: new Date().toLocaleTimeString(),
            }, ...prev.slice(0, 9)]);
            showMsg(`✓ Imported ${data.imported} blocked dates (${data.skipped} already existed)`);
            setImportUrl("");
        } catch (e) { showMsg(e.message, "err"); }
        setSyncing(false);
    };

    const exportUrl = links?.export_url || "";
    const currentUnit = units.find(u => u.id === unit);
    const steps = links?.instructions?.[platform === "airbnb" ? "airbnb" : "mmt"];

    const stepCard = (title, steps2, accent) => (
        <div style={{ background: `${accent}0a`, border: `1px solid ${accent}33`, borderRadius: "10px", padding: "14px", flex: 1, minWidth: "240px" }}>
            <div style={{ color: accent, fontSize: "10px", fontFamily: "'DM Mono', monospace", fontWeight: 700, letterSpacing: "0.1em", marginBottom: "10px" }}>{title}</div>
            {steps2.map((s, i) => (
                <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px" }}>
                    <div style={{ width: "18px", height: "18px", borderRadius: "50%", background: `${accent}33`, color: accent, fontSize: "9px", fontFamily: "'DM Mono', monospace", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{i+1}</div>
                    <div style={{ color: "rgba(255,255,255,0.55)", fontSize: "11px", fontFamily: "'DM Mono', monospace", lineHeight: 1.5 }}>{s}</div>
                </div>
            ))}
        </div>
    );

    return (
        <div style={{ padding: "16px 0" }}>
            <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "9px", fontFamily: "'DM Mono', monospace", letterSpacing: "0.15em", textTransform: "uppercase", marginBottom: "16px" }}>
                Calendar Sync — Airbnb & MMT/GoIbibo
            </div>

            {/* How it works banner */}
            <div style={{ background: "rgba(110,86,207,0.08)", border: "1px solid rgba(110,86,207,0.2)", borderRadius: "10px", padding: "12px 16px", marginBottom: "18px", display: "flex", gap: "12px", alignItems: "flex-start" }}>
                <span style={{ fontSize: "20px", flexShrink: 0 }}>🔄</span>
                <div>
                    <div style={{ color: "#C4B5FD", fontSize: "11px", fontFamily: "'DM Mono', monospace", fontWeight: 700, marginBottom: "4px" }}>How two-way sync works</div>
                    <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "10px", fontFamily: "'DM Mono', monospace", lineHeight: 1.7 }}>
                        <b style={{ color: "rgba(255,255,255,0.6)" }}>Step 1:</b> Copy your Export URL below → paste it into Airbnb and MMT/GoIbibo (they'll auto-block dates from this app).<br/>
                        <b style={{ color: "rgba(255,255,255,0.6)" }}>Step 2:</b> Copy the iCal URL from Airbnb/MMT → paste it in the Import section below (blocks those dates in this app).<br/>
                        Both platforms re-check the URL every 1–3 hours automatically.
                    </div>
                </div>
            </div>

            {/* Unit selector */}
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", marginBottom: "18px" }}>
                {units.map(u => (
                    <button key={u.id} onClick={() => setUnit(u.id)} style={{ padding: "5px 14px", borderRadius: "20px", border: `1px solid ${unit === u.id ? "rgba(110,86,207,0.7)" : "rgba(255,255,255,0.1)"}`, background: unit === u.id ? "rgba(110,86,207,0.2)" : "transparent", color: unit === u.id ? "#C4B5FD" : "rgba(255,255,255,0.4)", fontFamily: "'DM Mono', monospace", fontSize: "11px", cursor: "pointer" }}>
                        {u.name}
                    </button>
                ))}
            </div>

            {msg.text && (
                <div style={{ color: msg.type === "err" ? "#FF7B7F" : "#74C69D", fontSize: "11px", marginBottom: "14px", padding: "8px 12px", background: msg.type === "err" ? "rgba(255,90,95,0.1)" : "rgba(39,201,63,0.08)", borderRadius: "6px", border: `1px solid ${msg.type === "err" ? "rgba(255,90,95,0.2)" : "rgba(39,201,63,0.2)"}` }}>
                    {msg.text}
                </div>
            )}

            {/* ── EXPORT section ── */}
            <div style={{ ...card, marginBottom: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", fontFamily: "'DM Mono', monospace", fontWeight: 600 }}>📤 Export — Subscribe in Airbnb & MMT</div>
                    <Pill label={currentUnit?.name || "—"} color="#C4B5FD" size={9}/>
                </div>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", fontFamily: "'DM Mono', monospace", marginBottom: "8px" }}>
                    This URL contains all your bookings as an iCal feed. Paste it into Airbnb and MMT to auto-block those dates on their calendars.
                </div>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <input readOnly value={exportUrl} style={{ ...inp, fontSize: "10px", color: "rgba(255,255,255,0.5)", flex: 1 }} onClick={e => e.target.select()}/>
                    <button onClick={() => copyUrl(exportUrl)} style={{ padding: "9px 14px", borderRadius: "8px", border: "none", background: "linear-gradient(135deg,#6E56CF,#9B7FE8)", color: "#fff", cursor: "pointer", fontFamily: "'DM Mono', monospace", fontSize: "10px", fontWeight: 700, whiteSpace: "nowrap" }}>Copy URL</button>
                </div>
                {exportUrl && (
                    <a href={exportUrl} download style={{ display: "inline-flex", alignItems: "center", gap: "5px", marginTop: "8px", color: "rgba(110,86,207,0.7)", fontSize: "10px", fontFamily: "'DM Mono', monospace", textDecoration: "none" }}
                       onMouseEnter={e => e.currentTarget.style.color = "#C4B5FD"} onMouseLeave={e => e.currentTarget.style.color = "rgba(110,86,207,0.7)"}>
                        ⬇ Download .ics file
                    </a>
                )}
            </div>

            {/* ── IMPORT section ── */}
            <div style={{ ...card, marginBottom: "18px" }}>
                <div style={{ color: "rgba(255,255,255,0.7)", fontSize: "12px", fontFamily: "'DM Mono', monospace", fontWeight: 600, marginBottom: "12px" }}>📥 Import — Block dates from Airbnb / MMT</div>

                {/* Platform toggle */}
                <div style={{ display: "flex", gap: "6px", marginBottom: "12px" }}>
                    {[["airbnb","✈ Airbnb","#FF385C"], ["mmt","🏨 GoIbibo/MMT","#F59E0B"]].map(([id, label, color]) => (
                        <button key={id} onClick={() => setPlatform(id)} style={{ padding: "5px 14px", borderRadius: "8px", border: `1px solid ${platform === id ? color : "rgba(255,255,255,0.08)"}`, background: platform === id ? `${color}22` : "transparent", color: platform === id ? color : "rgba(255,255,255,0.4)", fontFamily: "'DM Mono', monospace", fontSize: "11px", cursor: "pointer", fontWeight: 600 }}>
                            {label}
                        </button>
                    ))}
                </div>

                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "10px", fontFamily: "'DM Mono', monospace", marginBottom: "8px" }}>
                    Paste the iCal URL from {platform === "airbnb" ? "Airbnb" : "MMT/GoIbibo"}. Booked dates will appear as blocked on this calendar.
                </div>
                <div style={{ display: "flex", gap: "8px" }}>
                    <input value={importUrl} onChange={e => setImportUrl(e.target.value)} placeholder={`Paste ${platform === "airbnb" ? "Airbnb" : "MMT/GoIbibo"} iCal URL…`} style={{ ...inp, flex: 1 }} onFocus={fi} onBlur={fb}/>
                    <button onClick={handleImport} disabled={syncing || !importUrl.trim()} style={{ padding: "9px 14px", borderRadius: "8px", border: "none", background: syncing ? "rgba(110,86,207,0.4)" : "linear-gradient(135deg,#6E56CF,#9B7FE8)", color: "#fff", cursor: syncing ? "not-allowed" : "pointer", fontFamily: "'DM Mono', monospace", fontSize: "10px", fontWeight: 700, whiteSpace: "nowrap", opacity: !importUrl.trim() ? 0.5 : 1 }}>
                        {syncing ? "Syncing…" : "Sync Now"}
                    </button>
                </div>
            </div>

            {/* Platform-specific instructions */}
            <div style={{ marginBottom: "18px" }}>
                <div style={{ color: "rgba(255,255,255,0.3)", fontSize: "9px", fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>
                    Step-by-step: {platform === "airbnb" ? "Airbnb" : "MMT/GoIbibo"}
                </div>
                {steps && (
                    <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                        {stepCard("📤 Share your calendar (Export)", steps.import_steps, "#C4B5FD")}
                        {stepCard("📥 Import their calendar", steps.export_steps, "#60A5FA")}
                    </div>
                )}
            </div>

            {/* Sync history */}
            {syncResults.length > 0 && (
                <div style={card}>
                    <div style={{ color: "rgba(255,255,255,0.4)", fontSize: "9px", fontFamily: "'DM Mono', monospace", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: "10px" }}>Recent Syncs</div>
                    {syncResults.map((r, i) => (
                        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: i < syncResults.length - 1 ? "1px solid rgba(255,255,255,0.04)" : "none" }}>
                            <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "10px", fontFamily: "'DM Mono', monospace" }}>
                                {r.platform.toUpperCase()} → {r.unit}
                            </div>
                            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                                <Pill label={`${r.imported} imported`} color="#74C69D" size={9}/>
                                {r.skipped > 0 && <Pill label={`${r.skipped} skipped`} color="#94A3B8" size={9}/>}
                                <span style={{ color: "rgba(255,255,255,0.2)", fontSize: "9px", fontFamily: "'DM Mono', monospace" }}>{r.time}</span>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

// ── MANAGE SOURCES PANEL ──────────────────────────────────────────────────────
function ManageSourcesPanel({ units, selUnit, onSelectUnit, customSources, setCustomSources }) {
    const [name, setName]         = useState("");
    const [color, setColor]       = useState("#94A3B8");
    const [icon, setIcon]         = useState("👤");
    const [adding, setAdding]     = useState(false);
    const [msg, setMsg]           = useState({ text:"", type:"" });
    const [deletingId, setDeletingId] = useState(null);

    const COLOR_OPTIONS = ["#94A3B8","#A78BFA","#34D399","#60A5FA","#F59E0B","#FF385C","#EC4899","#22D3EE"];
    const ICON_OPTIONS  = ["👤","🏠","🏨","📞","💼","🔑","🌟","📦"];

    const showMsg = (text, type="ok") => { setMsg({ text, type }); setTimeout(() => setMsg({ text:"", type:"" }), 3000); };

    const handleAdd = async () => {
        if (!name.trim()) return showMsg("Enter a name for the booking type", "err");
        if (!selUnit) return showMsg("Select a unit first", "err");
        setAdding(true);
        try {
            const list = await API.addSource(selUnit.id, name.trim(), color, icon);
            setCustomSources(list || []);
            setName(""); setColor("#94A3B8"); setIcon("👤");
            showMsg(`✓ "${name.trim()}" added for ${selUnit.name}`);
        } catch(e) {
            showMsg(e.message.includes("{") ? JSON.parse(e.message).error : e.message, "err");
        }
        setAdding(false);
    };

    const handleDelete = async (id, label) => {
        setDeletingId(id);
        try {
            await API.deleteSource(id);
            setCustomSources(prev => prev.filter(c => c.id !== id));
            showMsg(`Removed "${label}"`);
        } catch(e) { showMsg(e.message, "err"); }
        setDeletingId(null);
    };

    return (
        <div style={{ padding:"16px 0" }}>
            <div style={{ color:"var(--text-muted)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.15em", textTransform:"uppercase", marginBottom:"4px" }}>
                Manage Booking Types
            </div>
            <div style={{ color:"var(--text-muted)", fontSize:"10px", fontFamily:"'DM Mono', monospace", marginBottom:"16px", lineHeight:1.6 }}>
                Direct, Airbnb, and GoIbibo/MMT are available on every unit. Add custom booking types (like agents, brokers, or recurring contacts) that are specific to one unit.
            </div>

            {/* Unit selector */}
            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap", marginBottom:"18px" }}>
                {units.map(u => (
                    <button key={u.id} onClick={() => onSelectUnit(u)} style={{ padding:"5px 14px", borderRadius:"20px", border:`1px solid ${selUnit?.id===u.id ? "rgba(110,86,207,0.7)" : "rgba(255,255,255,0.1)"}`, background:selUnit?.id===u.id ? "rgba(110,86,207,0.2)" : "transparent", color:selUnit?.id===u.id ? "#C4B5FD" : "rgba(255,255,255,0.4)", fontFamily:"'DM Mono', monospace", fontSize:"11px", cursor:"pointer" }}>
                        {u.name}
                    </button>
                ))}
            </div>

            {msg.text && (
                <div style={{ color: msg.type==="err" ? "#FF7B7F" : "#74C69D", fontSize:"11px", marginBottom:"14px", padding:"8px 12px", background: msg.type==="err" ? "rgba(255,90,95,0.1)" : "rgba(39,201,63,0.08)", borderRadius:"6px", border:`1px solid ${msg.type==="err" ? "rgba(255,90,95,0.2)" : "rgba(39,201,63,0.2)"}` }}>
                    {msg.text}
                </div>
            )}

            {/* Add new source form */}
            <div style={{ ...card, marginBottom:"18px" }}>
                <div style={{ color:"rgba(255,255,255,0.6)", fontSize:"12px", fontFamily:"'DM Mono', monospace", fontWeight:600, marginBottom:"12px" }}>
                    + Add New Booking Type for {selUnit?.name || "—"}
                </div>
                <div style={{ display:"grid", gap:"12px" }}>
                    <div>
                        <label style={lbl}>Name</label>
                        <input style={inp} value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Rajesh, Booking.com, Office Booking…" onFocus={fi} onBlur={fb} onKeyDown={e => e.key==="Enter" && handleAdd()}/>
                    </div>
                    <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"12px" }}>
                        <div>
                            <label style={lbl}>Color</label>
                            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                                {COLOR_OPTIONS.map(c => (
                                    <button key={c} onClick={() => setColor(c)} style={{ width:"26px", height:"26px", borderRadius:"50%", background:c, border:color===c ? "2px solid #fff" : "2px solid transparent", cursor:"pointer", boxShadow:color===c ? `0 0 0 2px ${c}` : "none" }}/>
                                ))}
                            </div>
                        </div>
                        <div>
                            <label style={lbl}>Icon</label>
                            <div style={{ display:"flex", gap:"6px", flexWrap:"wrap" }}>
                                {ICON_OPTIONS.map(ic => (
                                    <button key={ic} onClick={() => setIcon(ic)} style={{ width:"26px", height:"26px", borderRadius:"6px", background:icon===ic ? "rgba(110,86,207,0.3)" : "rgba(255,255,255,0.04)", border:icon===ic ? "1px solid rgba(110,86,207,0.7)" : "1px solid rgba(255,255,255,0.08)", cursor:"pointer", fontSize:"13px", display:"flex", alignItems:"center", justifyContent:"center" }}>
                                        {ic}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* Live preview */}
                    {name.trim() && (
                        <div style={{ display:"flex", alignItems:"center", gap:"8px" }}>
                            <span style={{ color:"var(--text-muted)", fontSize:"9px", fontFamily:"'DM Mono', monospace", letterSpacing:"0.08em" }}>PREVIEW:</span>
                            <span style={{ background:`${color}22`, border:`1px solid ${color}55`, borderRadius:"6px", padding:"4px 10px", color, fontFamily:"'DM Mono', monospace", fontSize:"11px", fontWeight:600, display:"inline-flex", alignItems:"center", gap:"5px" }}>
                <span>{icon}</span>{name.trim()}
              </span>
                        </div>
                    )}

                    <button onClick={handleAdd} disabled={adding || !name.trim() || !selUnit} style={{ padding:"10px", borderRadius:"8px", border:"none", background:"linear-gradient(135deg,#6E56CF,#9B7FE8)", color:"#fff", cursor:"pointer", fontWeight:700, fontFamily:"'DM Mono', monospace", fontSize:"12px", opacity:(adding||!name.trim()||!selUnit) ? 0.5 : 1 }}>
                        {adding ? "Adding…" : "Add Booking Type"}
                    </button>
                </div>
            </div>

            {/* Existing custom sources list */}
            <div style={card}>
                <div style={{ color:"var(--text-muted)", fontSize:"9px", letterSpacing:"0.1em", textTransform:"uppercase", marginBottom:"12px", fontFamily:"'DM Mono', monospace" }}>
                    Custom Types for {selUnit?.name || "—"}
                </div>
                {customSources.length === 0 ? (
                    <div style={{ color:"var(--text-faint)", fontFamily:"'DM Mono', monospace", fontSize:"12px", textAlign:"center", padding:"16px" }}>
                        No custom booking types yet for this unit. Add one above.
                    </div>
                ) : (
                    <div style={{ display:"grid", gap:"6px" }}>
                        {customSources.map(c => (
                            <div key={c.id} style={{ display:"flex", alignItems:"center", gap:"10px", padding:"8px 12px", background:"var(--header-bg)", borderRadius:"8px", border:`1px solid ${c.color||"#94A3B8"}33` }}>
                                <span style={{ fontSize:"16px" }}>{c.icon||"👤"}</span>
                                <div style={{ flex:1 }}>
                                    <div style={{ color: c.color||"#94A3B8", fontSize:"12px", fontFamily:"'DM Mono', monospace", fontWeight:600 }}>{c.label}</div>
                                    <div style={{ color:"var(--text-faint)", fontSize:"9px", fontFamily:"'DM Mono', monospace" }}>key: {c.source_key}</div>
                                </div>
                                <button onClick={() => handleDelete(c.id, c.label)} disabled={deletingId===c.id} style={{ padding:"5px 10px", borderRadius:"6px", border:"1px solid rgba(255,90,95,0.3)", background:"rgba(255,90,95,0.08)", color:"#FF7B7F", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"10px" }}>
                                    {deletingId===c.id ? "…" : "Remove"}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function AdminPanel({ units }) {
    const [users,setUsers]=useState([]); const [selUnit,setSelUnit]=useState(units[0]?.id||"");
    const [perms,setPerms]=useState([]); const [loading,setLoading]=useState(false); const [msg,setMsg]=useState("");
    useEffect(()=>{API.allUsers().then(setUsers).catch(()=>{});}, []);
    useEffect(()=>{ if(!selUnit) return; API.getPerms(selUnit).then(setPerms).catch(()=>{}); },[selUnit]);
    const showMsg=t=>{ setMsg(t); setTimeout(()=>setMsg(""),2000); };
    const grant=async(uid)=>{ setLoading(true); await API.grantPerm(selUnit,uid); setPerms(await API.getPerms(selUnit)); setLoading(false); showMsg("Access granted ✓"); };
    const revoke=async(uid)=>{ setLoading(true); await API.revokePerm(selUnit,uid); setPerms(await API.getPerms(selUnit)); setLoading(false); showMsg("Access revoked"); };
    const grantedIds=new Set(perms.map(p=>p.user_id));
    const unit=units.find(u=>u.id===selUnit);
    return (
        <div style={{padding:"16px 0"}}>
            <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.15em",textTransform:"uppercase",marginBottom:"14px"}}>Admin — User Access Control</div>
            <div style={{display:"flex",gap:"6px",flexWrap:"wrap",marginBottom:"16px"}}>
                {units.map(u=><button key={u.id} onClick={()=>setSelUnit(u.id)} style={{padding:"5px 14px",borderRadius:"20px",border:`1px solid ${selUnit===u.id?"rgba(110,86,207,0.7)":"rgba(255,255,255,0.1)"}`,background:selUnit===u.id?"rgba(110,86,207,0.2)":"transparent",color:selUnit===u.id?"#C4B5FD":"rgba(255,255,255,0.4)",fontFamily:"'DM Mono', monospace",fontSize:"11px",cursor:"pointer"}}>{u.name}</button>)}
            </div>
            {msg&&<div style={{color:"#74C69D",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginBottom:"12px",padding:"8px 12px",background:"rgba(39,201,63,0.08)",borderRadius:"6px",border:"1px solid rgba(39,201,63,0.2)"}}>{msg}</div>}
            <div style={card}>
                <div style={{color:"var(--text-muted)",fontSize:"11px",fontFamily:"'DM Mono', monospace",marginBottom:"12px"}}>Who can see <span style={{color:"#C4B5FD"}}>{unit?.name}</span>?</div>
                <div style={{display:"grid",gap:"6px"}}>
                    {users.filter(u=>u.role!=="admin").map(u=>{
                        const has=grantedIds.has(u.id);
                        return <div key={u.id} style={{display:"flex",alignItems:"center",gap:"10px",padding:"8px 12px",background:"var(--header-bg)",borderRadius:"8px",border:`1px solid ${has?"rgba(110,86,207,0.2)":"rgba(255,255,255,0.05)"}`}}>
                            {u.avatar?<img src={u.avatar} alt="" style={{width:"28px",height:"28px",borderRadius:"50%",flexShrink:0,objectFit:"cover"}}/>:<div style={{width:"28px",height:"28px",borderRadius:"50%",background:"rgba(110,86,207,0.3)",display:"flex",alignItems:"center",justifyContent:"center",color:"#C4B5FD",fontSize:"12px",flexShrink:0}}>{(u.name||u.email)[0].toUpperCase()}</div>}
                            <div style={{flex:1,minWidth:0}}>
                                <div style={{color:"var(--text)",fontSize:"11px",fontFamily:"'DM Mono', monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.name}</div>
                                <div style={{color:"var(--text-muted)",fontSize:"9px",fontFamily:"'DM Mono', monospace",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</div>
                            </div>
                            <button onClick={()=>has?revoke(u.id):grant(u.id)} disabled={loading} style={{padding:"4px 10px",borderRadius:"6px",border:"none",background:has?"rgba(255,90,95,0.15)":"rgba(110,86,207,0.2)",color:has?"#FF7B7F":"#C4B5FD",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"9px",fontWeight:600,whiteSpace:"nowrap"}}>
                                {has?"Revoke":"Grant"}
                            </button>
                        </div>;
                    })}
                    {users.filter(u=>u.role!=="admin").length===0&&<div style={{color:"var(--text-faint)",fontFamily:"'DM Mono', monospace",fontSize:"12px",textAlign:"center",padding:"20px"}}>No other users registered yet</div>}
                </div>
            </div>
        </div>
    );
}

// ── STATUS BADGE ──────────────────────────────────────────────────────────────
function StatusBadge({ status }) {
    const c={loading:{bg:"rgba(255,189,46,0.12)",b:"rgba(255,189,46,0.3)",c:"#FFBD2E",d:"#FFBD2E",l:"Connecting…"},saving:{bg:"rgba(110,86,207,0.12)",b:"rgba(110,86,207,0.3)",c:"#C4B5FD",d:"#9B7FE8",l:"Saving…"},saved:{bg:"rgba(39,201,63,0.1)",b:"rgba(39,201,63,0.25)",c:"#74C69D",d:"#27C93F",l:"✦ Synced"},error:{bg:"rgba(255,90,95,0.1)",b:"rgba(255,90,95,0.3)",c:"#FF7B7F",d:"#FF5A5F",l:"⚠ Error"}}[status]||{};
    return <div style={{display:"flex",alignItems:"center",gap:"5px",background:c.bg,border:`1px solid ${c.b}`,borderRadius:"20px",padding:"3px 10px"}}><div style={{width:"5px",height:"5px",borderRadius:"50%",background:c.d,animation:(status==="saving"||status==="loading")?"pulse 1s infinite":"none"}}/><span style={{color:c.c,fontSize:"9px",fontFamily:"'DM Mono', monospace",letterSpacing:"0.08em"}}>{c.l}</span></div>;
}

// ── MAIN APP ──────────────────────────────────────────────────────────────────
// ── ADD UNIT FORM ─────────────────────────────────────────────────────────────
function AddUnitForm({ onAdd, onClose }) {
    const [n, setN] = useState("");
    const [l, setL] = useState("");
    const [s, setS] = useState(false);
    const [err, setErr] = useState("");

    const handleAdd = async () => {
        if (!n.trim()) { setErr("Unit name is required."); return; }
        setErr(""); setS(true);
        try { await onAdd(n.trim(), l.trim()); }
        catch(e) { setErr(e.message); setS(false); }
    };

    return (
        <>
            <SectionHeader title="Add New Unit" onClose={onClose}/>
            <div style={{ display:"grid", gap:"12px" }}>
                <div>
                    <label style={lbl}>Unit Name</label>
                    <input style={inp} value={n} onChange={e=>setN(e.target.value)} placeholder="e.g. Unit 1627" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&handleAdd()}/>
                </div>
                <div>
                    <label style={lbl}>Location</label>
                    <input style={inp} value={l} onChange={e=>setL(e.target.value)} placeholder="e.g. Gaur City Center, Greater Noida" onFocus={fi} onBlur={fb} onKeyDown={e=>e.key==="Enter"&&handleAdd()}/>
                </div>
                {err && <div style={{ color:"#FF7B7F", fontSize:"11px", padding:"8px 12px", background:"rgba(255,90,95,0.1)", borderRadius:"6px", border:"1px solid rgba(255,90,95,0.2)" }}>⚠ {err}</div>}
                <div style={{ display:"flex", gap:"8px" }}>
                    <button onClick={onClose} style={{ flex:1, padding:"9px", borderRadius:"8px", border:"1px solid var(--border)", background:"transparent", color:"var(--text-muted)", cursor:"pointer", fontFamily:"'DM Mono', monospace", fontSize:"11px" }}>Cancel</button>
                    <button onClick={handleAdd} disabled={s || !n.trim()} style={{ flex:2, padding:"9px", borderRadius:"8px", border:"none", background:"linear-gradient(135deg,#6E56CF,#9B7FE8)", color:"#fff", cursor:"pointer", fontWeight:700, fontFamily:"'DM Mono', monospace", fontSize:"11px", opacity:(s||!n.trim())?0.5:1 }}>
                        {s ? "Adding…" : "Add Unit"}
                    </button>
                </div>
            </div>
        </>
    );
}

export default function App() {
    const today=new Date();
    const [user,setUser]=useState(null); const [authChecked,setAuthChecked]=useState(false);
    const [units,setUnits]=useState([]); const [selUnit,setSelUnit]=useState(null);
    const [customSources,setCustomSources]=useState([]); // raw rows from DB for selUnit
    const [bookings,setBookings]=useState({}); // keyed by checkin_date
    const [year,setYear]=useState(today.getFullYear()); const [month,setMonth]=useState(today.getMonth());
    const [status,setStatus]=useState("loading"); const [dbErr,setDbErr]=useState("");
    const [modal,setModal]=useState(null); // {type, ...}
    const [activeTab,setActiveTab]=useState("calendar");
    const [showProfile,setShowProfile]=useState(false);
    const [theme,setTheme]=useState(()=>localStorage.getItem("gcbm_theme")||"dark");
    const [mobileMenuOpen,setMobileMenuOpen]=useState(false);

    const toggleTheme=()=>setTheme(t=>{const n=t==="dark"?"light":"dark";localStorage.setItem("gcbm_theme",n);return n;});

    // Combined sources for the currently selected unit (base + custom)
    const sources = useMemo(() => combineSources(customSources), [customSources]);

    useEffect(()=>{
        const t=getToken();
        if(!t){setAuthChecked(true);return;}
        API.verify().then(r=>{setUser(r.user);setAuthChecked(true);}).catch(()=>{setToken(null);setAuthChecked(true);});
    },[]);

    useEffect(()=>{
        if(!user) return;
        API.units().then(list=>{setUnits(list||[]); const preferred=(list||[]).find(u=>u.id==="unit-1626")||(list||[])[0]; if(preferred)setSelUnit(preferred); setStatus("saved");}).catch(e=>{setStatus("error");setDbErr(e.message);});
    },[user]);

    // Load this unit's custom sources whenever selected unit changes
    useEffect(()=>{
        if(!selUnit) { setCustomSources([]); return; }
        API.getSources(selUnit.id).then(setCustomSources).catch(()=>setCustomSources([]));
    },[selUnit]);

    const handleAddSource = async (label) => {
        if(!selUnit) throw new Error("No unit selected");
        const list = await API.addSource(selUnit.id, label);
        setCustomSources(list);
        const created = list.find(c => c.label.toLowerCase() === label.toLowerCase());
        return created ? created.source_key : label.toLowerCase().replace(/[^a-z0-9]+/g,"_");
    };

    useEffect(()=>{
        if(!selUnit) return;
        setStatus("loading"); setBookings({});
        API.getBookings(selUnit.id).then(rows=>{
            const map={};
            (rows||[]).forEach(b=>{
                const ci = new Date(b.checkin_date);
                const co = new Date(b.checkout_date);
                // Same-day or single-night: always show on checkin_date
                const isSameDay = b.checkin_date === b.checkout_date;
                const endDate = isSameDay ? new Date(ci.getTime() + 86400000) : co;
                for(let d=new Date(ci); d<endDate; d.setDate(d.getDate()+1)){
                    const k=d.toISOString().slice(0,10);
                    if(!map[k]) map[k]=[];
                    if(!map[k].find(x=>x.id===b.id)) map[k].push(b);
                }
            });
            setBookings(map); setStatus("saved"); setDbErr("");
        }).catch(e=>{setStatus("error");setDbErr(e.message);});
    },[selUnit]);


    const firstDay=new Date(year,month,1).getDay();
    const dim=new Date(year,month+1,0).getDate();
    const prevM=()=>{if(month===0){setMonth(11);setYear(y=>y-1);}else setMonth(m=>m-1);};
    const nextM=()=>{if(month===11){setMonth(0);setYear(y=>y+1);}else setMonth(m=>m+1);};
    const getDay=d=>bookings[d]||[];
    const todayStr=fmtDate(today.getFullYear(),today.getMonth(),today.getDate());

    // Local state update after save
    const refreshBookings=useCallback(async()=>{
        if(!selUnit) return;
        const rows=await API.getBookings(selUnit.id);
        const map={};
        (rows||[]).forEach(b=>{
            const ci = new Date(b.checkin_date);
            const co = new Date(b.checkout_date);
            const isSameDay = b.checkin_date === b.checkout_date;
            const endDate = isSameDay ? new Date(ci.getTime() + 86400000) : co;
            for(let d=new Date(ci); d<endDate; d.setDate(d.getDate()+1)){
                const k=d.toISOString().slice(0,10);
                if(!map[k]) map[k]=[];
                if(!map[k].find(x=>x.id===b.id)) map[k].push(b);
            }
        });
        setBookings(map);
    },[selUnit]);

    const handleSave=async(b)=>{
        setStatus("saving");
        try{ await API.saveBooking(b); await refreshBookings(); setStatus("saved"); setDbErr(""); }
        catch(e){ setStatus("error"); setDbErr(e.message); }
        setModal(null);
    };

    const handleDelete=async(id)=>{
        setStatus("saving");
        try{ await API.deleteBooking(id); await refreshBookings(); setStatus("saved"); setDbErr(""); }
        catch(e){ setStatus("error"); setDbErr(e.message); }
        setModal(null);
    };

    const handleStatusChange=async(id,newStatus)=>{
        setStatus("saving");
        try{ await API.patchBooking(id,{status:newStatus}); await refreshBookings(); setStatus("saved"); }
        catch(e){ setStatus("error"); }
        setModal(null);
    };

    const handlePaymentUpdate=async(id, payStatus, explicitPaidAmt)=>{
        setStatus("saving");
        const patch = { payment_status: payStatus };
        if (explicitPaidAmt !== undefined) {
            patch.paid_amount = explicitPaidAmt;
        } else if (payStatus === "paid") {
            const allBks = Object.values(bookings).flat();
            const bk = allBks.find(b=>b.id===id);
            if (bk) patch.paid_amount = Number(bk.total_amount||0);
        } else if (payStatus === "pending") {
            patch.paid_amount = 0;
        }
        try {
            await API.patchBooking(id, patch);
            await refreshBookings();
            setStatus("saved"); setDbErr("");
            // Update the modal's booking in-place so UI reflects new values immediately
            setModal(prev => prev?.type==="detail" && prev.booking?.id===id
                ? { ...prev, booking: { ...prev.booking, ...patch } }
                : prev
            );
        } catch(e){ setStatus("error"); setDbErr(e.message); }
    };

    const handleAddUnit=async(n,l)=>{
        const list=await API.addUnit(n,l);
        setUnits(list||[]);
        const nu=(list||[]).find(u=>u.name===n);
        if(nu) setSelUnit(nu);
        setModal(null);
    };

    const handleLogout=()=>{setToken(null);setUser(null);setBookings({});setUnits([]);setSelUnit(null);};

    if(!authChecked) return <div style={{minHeight:"100vh",background:"var(--bg)",display:"flex",alignItems:"center",justifyContent:"center",color:"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"12px",letterSpacing:"0.1em"}}>Loading…</div>;
    if(!user) return <LoginPage onLogin={u=>setUser(u)}/>;

    const mPfx=`${year}-${String(month+1).padStart(2,"0")}`;
    const mStart = `${mPfx}-01`;
    const mEnd   = `${year}-${String(month+1).padStart(2,"0")}-${String(new Date(year,month+1,0).getDate()).padStart(2,"0")}`;

    // Include all bookings that overlap with this month
    // A booking overlaps if checkin_date <= mEnd AND checkout_date >= mStart
    // For same-day bookings (checkin=checkout), treat checkout as checkin+1
    const allBookingsList = [...new Map(
        Object.values(bookings).flat().map(b=>[b.id,b])
    ).values()];

    const mBks = allBookingsList.filter(b => {
        if (b.status === "cancelled") return false;
        const ci = b.checkin_date;
        const co = b.checkin_date === b.checkout_date ? addDays(b.checkout_date,1) : b.checkout_date;
        return ci <= mEnd && co > mStart;
    });

    const totalRev=mBks.reduce((s,b)=>s+Number(b.total_amount||0),0);
    const totalDue=mBks.reduce((s,b)=>s+Math.max(0,Number(b.total_amount||0)-Number(b.paid_amount||0)),0);

    const tabBtn=(t,l,i)=>(
        <button onClick={()=>setActiveTab(t)} style={{display:"flex",alignItems:"center",gap:"5px",padding:"7px 14px",borderRadius:"8px",border:"none",background:activeTab===t?"rgba(110,86,207,0.25)":"transparent",color:activeTab===t?"#C4B5FD":"var(--text-muted)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"10px",letterSpacing:"0.06em",whiteSpace:"nowrap"}}>
            <span>{i}</span>{l}
        </button>
    );

    return (
        <div className={`theme-${theme}`} style={{minHeight:"100vh",background:"var(--bg)",fontFamily:"'DM Mono', monospace",overflowX:"hidden",color:"var(--text)"}}>
            <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700;900&family=DM+Mono:wght@400;500;600&display=swap');

        /* ── DARK THEME (default) ── */
        .theme-dark {
          --bg:            #0A0A12;
          --surface:       #12121E;
          --card-bg:       rgba(255,255,255,0.03);
          --card-border:   rgba(255,255,255,0.07);
          --inp-bg:        rgba(255,255,255,0.05);
          --border:        rgba(255,255,255,0.1);
          --header-bg:     rgba(255,255,255,0.02);
          --header-border: rgba(255,255,255,0.06);
          --unit-bar-bg:   rgba(110,86,207,0.04);
          --unit-bar-border:rgba(110,86,207,0.1);
          --text:          #F0EEF8;
          --text-soft:     rgba(255,255,255,0.5);
          --text-muted:    rgba(255,255,255,0.4);
          --text-faint:    rgba(255,255,255,0.15);
          --modal-bg:      #12121E;
          --modal-border:  rgba(255,255,255,0.08);
          --scrollbar:     rgba(255,255,255,0.1);
          --cal-empty:     rgba(0,0,0,0.1);
          --cal-today:     rgba(110,86,207,0.07);
          --cal-today-hover:rgba(110,86,207,0.11);
          --cal-hover:     rgba(255,255,255,0.03);
          --cal-booked:    rgba(255,255,255,0.01);
          --fin-card-bg:   linear-gradient(135deg,rgba(110,86,207,0.1),rgba(155,127,232,0.06));
          --fin-card-border:rgba(110,86,207,0.2);
          --tab-hover-bg:  rgba(255,255,255,0.08);
          --err-bg:        rgba(255,90,95,0.1);
          --err-border:    rgba(255,90,95,0.2);
          --select-bg:     #1a1a2e;
          color-scheme: dark;
        }

        /* ── LIGHT THEME ── */
        .theme-light {
          --bg:            #F5F4F0;
          --surface:       #FFFFFF;
          --card-bg:       rgba(255,255,255,0.9);
          --card-border:   rgba(0,0,0,0.08);
          --inp-bg:        rgba(0,0,0,0.04);
          --border:        rgba(0,0,0,0.12);
          --header-bg:     rgba(255,255,255,0.95);
          --header-border: rgba(0,0,0,0.08);
          --unit-bar-bg:   rgba(110,86,207,0.04);
          --unit-bar-border:rgba(110,86,207,0.15);
          --text:          #1C1C2E;
          --text-soft:     rgba(0,0,0,0.55);
          --text-muted:    rgba(0,0,0,0.45);
          --text-faint:    rgba(0,0,0,0.25);
          --modal-bg:      #FFFFFF;
          --modal-border:  rgba(0,0,0,0.1);
          --scrollbar:     rgba(0,0,0,0.15);
          --cal-empty:     rgba(0,0,0,0.03);
          --cal-today:     rgba(110,86,207,0.08);
          --cal-today-hover:rgba(110,86,207,0.12);
          --cal-hover:     rgba(0,0,0,0.02);
          --cal-booked:    rgba(110,86,207,0.02);
          --fin-card-bg:   linear-gradient(135deg,rgba(110,86,207,0.07),rgba(155,127,232,0.04));
          --fin-card-border:rgba(110,86,207,0.15);
          --tab-hover-bg:  rgba(0,0,0,0.04);
          --err-bg:        rgba(255,90,95,0.08);
          --err-border:    rgba(255,90,95,0.2);
          --select-bg:     #F5F4F0;
          color-scheme: light;
        }

        /* ── Base resets ── */
        *{box-sizing:border-box}

        /* Calendar picker icons */
        .theme-dark input[type="time"]::-webkit-calendar-picker-indicator,
        .theme-dark input[type="date"]::-webkit-calendar-picker-indicator{filter:invert(0.6)}
        .theme-light input[type="time"]::-webkit-calendar-picker-indicator,
        .theme-light input[type="date"]::-webkit-calendar-picker-indicator{filter:none;opacity:0.5}

        /* Select options */
        .theme-dark select option{background:#1a1a2e}
        .theme-light select option{background:#ffffff;color:#1C1C2E}

        textarea{font-family:'DM Mono',monospace!important}
        select{cursor:pointer}
        ::-webkit-scrollbar{width:3px}
        ::-webkit-scrollbar-thumb{background:var(--scrollbar);border-radius:2px}

        /* ── Animations ── */
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes slideUp{from{opacity:0;transform:translateY(24px) scale(0.97)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}

        /* ── Mobile nav hamburger ── */
        .mobile-nav-toggle{display:none;background:none;border:none;cursor:pointer;padding:6px;color:var(--text-soft);font-size:18px}
        .nav-tabs{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
        .nav-right{display:flex;align-items:center;gap:8px}

        /* ── Calendar grid mobile fix ── */
        .cal-cell{min-height:72px;padding:4px 3px 3px}

        /* ── Mobile drawer ── */
        .mobile-drawer{
          display:none;position:fixed;inset:0;z-index:200;
          background:var(--modal-bg);flex-direction:column;padding:16px;
          animation:fadeIn 0.15s;
        }
        .mobile-drawer.open{display:flex}

        /* ── Responsive ── */
        @media(max-width:768px){
          .mobile-nav-toggle{display:block}
          .nav-tabs{display:none}
          .nav-right .status-badge{display:none}

          /* Calendar cells smaller */
          .cal-cell{min-height:54px;padding:2px 1px 2px}

          /* Stats grid: 2 cols on mobile */
          .stats-grid-5{grid-template-columns:repeat(3,1fr)!important}
          .stats-grid-4{grid-template-columns:repeat(2,1fr)!important}
          .stats-grid-2{grid-template-columns:1fr!important}

          /* Report KPIs: 2 cols */
          .kpi-grid-4{grid-template-columns:repeat(2,1fr)!important}

          /* Booking form wide modal */
          .modal-wide{max-width:100%!important;margin:0!important;border-radius:16px 16px 0 0!important;position:fixed!important;bottom:0!important;top:auto!important;max-height:92vh!important;overflow-y:auto}

          /* Regular modals */
          .modal-box{max-width:100%!important;margin:0!important;border-radius:16px 16px 0 0!important;position:fixed!important;bottom:0!important;top:auto!important;max-height:92vh!important}

          /* Modal overlay on mobile — align to bottom */
          .modal-overlay{align-items:flex-end!important;padding:0!important}

          /* Source grid: 3 cols on mobile */
          .src-grid{grid-template-columns:repeat(3,1fr)!important}

          /* Reports table: scroll */
          .reports-table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}

          /* Unit bar padding */
          .unit-bar-inner{padding:0 8px!important}

          /* Header compact */
          .app-header{padding:8px 12px!important}
          .app-header-title{font-size:14px!important}

          /* Profile modal full screen */
          .profile-modal{max-width:100%!important}

          /* Preset row wraps */
          .preset-row{flex-wrap:wrap!important}

          /* Source breakdown */
          .src-breakdown-grid{grid-template-columns:repeat(3,1fr)!important}

          /* Pay status grid */
          .pay-status-flex{flex-wrap:wrap!important}
          .pay-status-flex>*{min-width:120px!important}
        }

        @media(max-width:480px){
          .stats-grid-5{grid-template-columns:repeat(2,1fr)!important}
          .src-breakdown-grid{grid-template-columns:repeat(2,1fr)!important}
          .cal-cell{min-height:44px}
        }

        @media print{body{padding:10px}}
      `}</style>

            {/* Header */}
            <div className="app-header" style={{background:"var(--header-bg)",borderBottom:`1px solid var(--header-border)`,padding:"10px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"8px",position:"sticky",top:0,zIndex:50,backdropFilter:"blur(12px)"}}>
                <div style={{display:"flex",alignItems:"center",gap:"10px",flexShrink:0}}>
                    <span style={{fontSize:"20px"}}>🏢</span>
                    <div>
                        <div style={{color:"var(--text-muted)",fontSize:"8px",letterSpacing:"0.18em",textTransform:"uppercase"}}>Property Manager</div>
                        <div className="app-header-title" style={{color:"var(--text)",fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:900}}>Booking Manager</div>
                    </div>
                </div>
                {/* Desktop nav tabs */}
                <div className="nav-tabs">
                    {tabBtn("calendar","Calendar","📅")}
                    {tabBtn("dashboard","Reports","📊")}
                    {tabBtn("sync","Sync","🔄")}
                    {tabBtn("sources","Types","🏷")}
                    {user.role==="admin"&&tabBtn("admin","Admin","⚙")}
                </div>
                <div className="nav-right" style={{display:"flex",alignItems:"center",gap:"6px",flexShrink:0}}>
                    <div className="status-badge"><StatusBadge status={status}/></div>
                    {/* Theme toggle */}
                    <button onClick={toggleTheme} title={`Switch to ${theme==="dark"?"light":"dark"} mode`} style={{background:"var(--card-bg)",border:`1px solid var(--card-border)`,borderRadius:"8px",color:"var(--text-soft)",cursor:"pointer",padding:"5px 9px",fontSize:"14px",display:"flex",alignItems:"center",gap:"4px",fontFamily:"'DM Mono', monospace"}}
                            onMouseEnter={e=>e.currentTarget.style.background="var(--tab-hover-bg)"} onMouseLeave={e=>e.currentTarget.style.background="var(--card-bg)"}>
                        {theme==="dark"?"☀ Light":"🌙 Dark"}
                    </button>
                    <button onClick={()=>setShowProfile(true)} style={{display:"flex",alignItems:"center",gap:"7px",background:"var(--card-bg)",border:`1px solid var(--card-border)`,borderRadius:"20px",padding:"3px 10px 3px 3px",cursor:"pointer"}}
                            onMouseEnter={e=>e.currentTarget.style.background="var(--tab-hover-bg)"} onMouseLeave={e=>e.currentTarget.style.background="var(--card-bg)"}>
                        {user.avatar?<img src={user.avatar} alt="" style={{width:"22px",height:"22px",borderRadius:"50%",objectFit:"cover",border:"2px solid rgba(110,86,207,0.5)"}}/>
                            :<div style={{width:"22px",height:"22px",borderRadius:"50%",background:"linear-gradient(135deg,#6E56CF,#9B7FE8)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:"10px",fontWeight:700,color:"#fff"}}>{(user.name||user.email||"?")[0].toUpperCase()}</div>}
                        <span style={{color:"var(--text-soft)",fontSize:"10px",fontFamily:"'DM Mono', monospace",maxWidth:"80px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{user.name||user.email}</span>
                        {user.role==="admin"&&<span style={{background:"rgba(110,86,207,0.3)",color:"#C4B5FD",borderRadius:"4px",padding:"1px 5px",fontSize:"8px"}}>ADMIN</span>}
                    </button>
                    {/* Hamburger for mobile */}
                    <button className="mobile-nav-toggle" onClick={()=>setMobileMenuOpen(true)} aria-label="Menu">☰</button>
                    <button onClick={handleLogout} style={{background:"rgba(255,90,95,0.1)",border:"1px solid rgba(255,90,95,0.2)",borderRadius:"8px",color:"#FF7B7F",cursor:"pointer",padding:"4px 9px",fontSize:"10px",fontFamily:"'DM Mono', monospace",whiteSpace:"nowrap"}}>Sign out</button>
                </div>
            </div>

            {/* Mobile drawer menu */}
            <div className={`mobile-drawer${mobileMenuOpen?" open":""}`} style={{background:"var(--modal-bg)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"20px"}}>
                    <div style={{color:"var(--text)",fontSize:"16px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>Menu</div>
                    <button onClick={()=>setMobileMenuOpen(false)} style={{background:"var(--card-bg)",border:`1px solid var(--card-border)`,borderRadius:"8px",color:"var(--text-soft)",cursor:"pointer",padding:"6px 10px",fontSize:"16px"}}>✕</button>
                </div>
                {[["calendar","📅 Calendar"],["dashboard","📊 Reports"],["sync","🔄 Sync"],["sources","🏷 Types"],...(user.role==="admin"?[["admin","⚙ Admin"]]:[])].map(([t,l])=>(
                    <button key={t} onClick={()=>{setActiveTab(t);setMobileMenuOpen(false);}} style={{display:"block",width:"100%",textAlign:"left",padding:"14px 16px",background:activeTab===t?"rgba(110,86,207,0.15)":"transparent",border:"none",borderRadius:"10px",color:activeTab===t?"#C4B5FD":"var(--text-soft)",fontFamily:"'DM Mono', monospace",fontSize:"14px",cursor:"pointer",marginBottom:"4px"}}>{l}</button>
                ))}
                <div style={{borderTop:`1px solid var(--border)`,marginTop:"16px",paddingTop:"16px",display:"flex",flexDirection:"column",gap:"8px"}}>
                    <button onClick={()=>{toggleTheme();}} style={{padding:"12px 16px",background:"var(--card-bg)",border:`1px solid var(--card-border)`,borderRadius:"10px",color:"var(--text-soft)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"13px",textAlign:"left"}}>
                        {theme==="dark"?"☀ Switch to Light Mode":"🌙 Switch to Dark Mode"}
                    </button>
                    <button onClick={()=>{setMobileMenuOpen(false);setShowProfile(true);}} style={{padding:"12px 16px",background:"var(--card-bg)",border:`1px solid var(--card-border)`,borderRadius:"10px",color:"var(--text-soft)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"13px",textAlign:"left"}}>
                        👤 My Profile
                    </button>
                    <button onClick={()=>{setMobileMenuOpen(false);handleLogout();}} style={{padding:"12px 16px",background:"rgba(255,90,95,0.08)",border:"1px solid rgba(255,90,95,0.2)",borderRadius:"10px",color:"#FF7B7F",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"13px",textAlign:"left"}}>
                        Sign Out
                    </button>
                </div>
            </div>

            {/* Unit bar */}
            <div style={{background:"var(--unit-bar-bg)",borderBottom:`1px solid var(--unit-bar-border)`,padding:"8px 20px",display:"flex",alignItems:"center",gap:"6px",flexWrap:"wrap",overflowX:"auto"}}>
                <span style={{color:"var(--text-faint)",fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",whiteSpace:"nowrap"}}>Unit:</span>
                {units.map(u=>(
                    <button key={u.id} onClick={()=>setSelUnit(u)} style={{padding:"4px 12px",borderRadius:"20px",border:`1px solid ${selUnit?.id===u.id?"rgba(110,86,207,0.7)":"var(--border)"}`,background:selUnit?.id===u.id?"rgba(110,86,207,0.2)":"transparent",color:selUnit?.id===u.id?"#C4B5FD":"var(--text-muted)",fontFamily:"'DM Mono', monospace",fontSize:"10px",cursor:"pointer",whiteSpace:"nowrap",fontWeight:selUnit?.id===u.id?600:400}}>
                        {u.name}{u.location&&<span style={{color:"var(--text-faint)",fontSize:"8px",marginLeft:"3px"}}>· {u.location.split(",")[0]}</span>}
                    </button>
                ))}
                <button onClick={()=>setModal({type:"addUnit"})} style={{padding:"4px 10px",borderRadius:"20px",border:`1px dashed var(--border)`,background:"transparent",color:"var(--text-faint)",fontFamily:"'DM Mono', monospace",fontSize:"10px",cursor:"pointer",whiteSpace:"nowrap"}}
                        onMouseEnter={e=>{e.currentTarget.style.borderColor="rgba(110,86,207,0.4)";e.currentTarget.style.color="#C4B5FD";}} onMouseLeave={e=>{e.currentTarget.style.borderColor="var(--border)";e.currentTarget.style.color="var(--text-faint)";}}>
                    + Add Unit
                </button>
            </div>

            {dbErr&&<div style={{background:"rgba(255,90,95,0.08)",borderBottom:"1px solid rgba(255,90,95,0.2)",padding:"8px 20px",color:"#FF7B7F",fontSize:"10px"}}>⚠ {dbErr}</div>}

            <div style={{maxWidth:"940px",margin:"0 auto",padding:"16px"}}>

                {activeTab==="dashboard"&&<Dashboard units={units} user={user}/>}
                {activeTab==="sync"&&<IcalSyncPanel units={units} selUnit={selUnit}/>}
                {activeTab==="sources"&&<ManageSourcesPanel units={units} selUnit={selUnit} onSelectUnit={u=>{setSelUnit(u);}} customSources={customSources} setCustomSources={setCustomSources}/>}
                {activeTab==="admin"&&user.role==="admin"&&<AdminPanel units={units}/>}

                {activeTab==="calendar"&&<>
                    {/* Stats */}
                    <div className="stats-grid-5" style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:"8px",marginBottom:"16px"}}>
                        {[
                            {l:"Bookings",   v:mBks.length,                                   a:"#C4B5FD"},
                            {l:"Revenue",    v:inrFmt(totalRev),                               a:"#86EFAC"},
                            {l:"Due",        v:inrFmt(totalDue),                               a:totalDue>0?"#F59E0B":"#34D399"},
                            {l:"Nights",     v:mBks.reduce((s,b)=>s+Number(b.nights||1),0),   a:"#60A5FA"},
                            {l:"Occupancy",  v:(()=>{
                                    const bd={};
                                    mBks.forEach(b=>{
                                        const ci=new Date(b.checkin_date);
                                        const co=b.checkin_date===b.checkout_date ? new Date(ci.getTime()+86400000) : new Date(b.checkout_date);
                                        for(let d=new Date(ci);d<co;d.setDate(d.getDate()+1)){
                                            const k=d.toISOString().slice(0,10);
                                            if(k.startsWith(mPfx)){if(!bd[k])bd[k]=[];bd[k].push(b);}
                                        }
                                    });
                                    const occ=Object.values(bd).reduce((s,bks)=>s+getDayOccupancy(bks),0);
                                    return `${Math.round(occ/dim*100)}%`;
                                })(), a:"#FCA5A5"},
                        ].map(s=>(
                            <div key={s.l} style={{background:"var(--card-bg)",border:"1px solid var(--card-border)",borderRadius:"10px",padding:"10px 12px"}}>
                                <div style={{color:"var(--text-muted)",fontSize:"7px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>{s.l}</div>
                                <div style={{color:s.a,fontSize:"15px",fontFamily:"'Playfair Display', serif",fontWeight:700}}>{s.v}</div>
                            </div>
                        ))}
                    </div>

                    {/* Source pills */}
                    <div style={{display:"flex",gap:"6px",marginBottom:"14px",flexWrap:"wrap"}}>
                        {sources.map(src=>{
                            const c=mBks.filter(b=>b.source===src.id).length;
                            return <div key={src.id} style={{background:`${src.color}0d`,border:`1px solid ${src.color}33`,borderRadius:"6px",padding:"3px 9px",display:"flex",alignItems:"center",gap:"4px"}}>
                                <span style={{fontSize:"10px"}}>{src.icon}</span>
                                <span style={{color:src.color,fontSize:"9px",fontFamily:"'DM Mono', monospace",fontWeight:600}}>{src.label}</span>
                                <span style={{background:`${src.color}33`,color:src.color,borderRadius:"8px",padding:"0 5px",fontSize:"9px",fontFamily:"'DM Mono', monospace",fontWeight:700}}>{c}</span>
                            </div>;
                        })}
                    </div>

                    {/* Calendar */}
                    <div style={{background:"rgba(255,255,255,0.025)",border:"1px solid var(--card-border)",borderRadius:"14px 14px 0 0",padding:"14px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                        <button onClick={prevM} style={{background:"var(--card-bg)",border:"none",borderRadius:"7px",color:"var(--text-soft)",cursor:"pointer",width:"30px",height:"30px",fontSize:"15px",display:"flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>‹</button>
                        <div style={{textAlign:"center"}}>
                            <div style={{color:"var(--text)",fontSize:"18px",fontFamily:"'Playfair Display', serif",fontWeight:900}}>{MONTHS[month]}</div>
                            <div style={{color:"var(--text-faint)",fontSize:"10px",letterSpacing:"0.12em"}}>{year} · {selUnit?.name||""}</div>
                        </div>
                        <button onClick={nextM} style={{background:"var(--card-bg)",border:"none",borderRadius:"7px",color:"var(--text-soft)",cursor:"pointer",width:"30px",height:"30px",fontSize:"15px",display:"flex",alignItems:"center",justifyContent:"center"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.1)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(255,255,255,0.06)"}>›</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"var(--header-bg)",borderLeft:"1px solid rgba(255,255,255,0.07)",borderRight:"1px solid rgba(255,255,255,0.07)"}}>
                        {DAYS.map(d=><div key={d} style={{padding:"8px 0",textAlign:"center",color:d==="Sun"||d==="Sat"?"rgba(155,127,232,0.5)":"rgba(255,255,255,0.25)",fontSize:"8px",letterSpacing:"0.1em",textTransform:"uppercase",borderBottom:"1px solid rgba(255,255,255,0.05)"}}>{d}</div>)}
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",border:"1px solid var(--card-border)",borderTop:"none",borderRadius:"0 0 14px 14px",overflow:"hidden",background:"rgba(255,255,255,0.01)"}}>
                        {Array.from({length:firstDay}).map((_,i)=><div key={`e${i}`} style={{minHeight:"88px",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)",background:"var(--cal-empty)"}}/>)}
                        {Array.from({length:dim},(_,i)=>i+1).map(day=>{
                            const dateStr=fmtDate(year,month,day);
                            const dayBks=getDay(dateStr);
                            const activeBks=dayBks.filter(b=>b.status!=="cancelled");
                            const isToday=dateStr===todayStr;
                            const cappedCount=activeBks.filter(b=>ALWAYS_CAPPED.includes(b.source)).length;
                            const isWE=(firstDay+day-1)%7===0||(firstDay+day-1)%7===6;
                            const occ=getDayOccupancy(activeBks);
                            const occDot=occ>=1?"#FF5A5F":occ>=0.5?"#F59E0B":null;
                            const pendingPay=activeBks.some(b=>b.payment_status==="pending");
                            return (
                                <div key={day} onClick={()=>setModal({type:"add",date:dateStr})} style={{minHeight:"88px",padding:"6px 4px 4px",borderRight:"1px solid rgba(255,255,255,0.04)",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",background:isToday?"var(--cal-today)":activeBks.length>0?"var(--cal-booked)":"transparent",transition:"background 0.15s",position:"relative"}}
                                     onMouseEnter={e=>e.currentTarget.style.background=isToday?"rgba(110,86,207,0.11)":"rgba(255,255,255,0.03)"}
                                     onMouseLeave={e=>e.currentTarget.style.background=isToday?"rgba(110,86,207,0.07)":activeBks.length>0?"rgba(255,255,255,0.01)":"transparent"}>
                                    <div style={{width:"20px",height:"20px",borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:isToday?"linear-gradient(135deg,#6E56CF,#9B7FE8)":"transparent",color:isToday?"#fff":isWE?"rgba(155,127,232,0.6)":"rgba(255,255,255,0.4)",fontSize:"10px",fontWeight:isToday?700:400,marginBottom:"3px",boxShadow:isToday?"0 2px 8px rgba(110,86,207,0.5)":"none"}}>{day}</div>
                                    {dayBks.map(b=><BookingBadge key={b.id} booking={b} sources={sources} onClick={bk=>setModal({type:"detail",booking:bk})}/>)}
                                    {occDot&&<div style={{position:"absolute",top:"4px",right:"4px",width:"5px",height:"5px",borderRadius:"50%",background:occDot,boxShadow:`0 0 4px ${occDot}`}} title={`${Math.round(occ*100)}% occupied`}/>}
                                    {pendingPay&&<div style={{position:"absolute",bottom:"4px",right:"4px",fontSize:"8px",opacity:0.8}} title="Payment pending">💰</div>}
                                    {!dayBks.length&&<div style={{color:"rgba(255,255,255,0.07)",fontSize:"14px",textAlign:"center",marginTop:"4px"}}>+</div>}
                                </div>
                            );
                        })}
                    </div>

                    {/* Legend */}
                    <div style={{display:"flex",gap:"10px",marginTop:"12px",flexWrap:"wrap",justifyContent:"center"}}>
                        {sources.map(s=><div key={s.id} style={{display:"flex",alignItems:"center",gap:"4px",color:"var(--text-muted)",fontSize:"8px"}}><div style={{width:"10px",height:"6px",borderRadius:"2px",background:s.color}}/>{s.icon} {s.label}</div>)}
                        <div style={{display:"flex",alignItems:"center",gap:"4px",color:"var(--text-muted)",fontSize:"8px"}}><div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#FF5A5F"}}/>Full</div>
                        <div style={{display:"flex",alignItems:"center",gap:"4px",color:"var(--text-muted)",fontSize:"8px"}}><div style={{width:"5px",height:"5px",borderRadius:"50%",background:"#F59E0B"}}/>Half</div>
                        <div style={{display:"flex",alignItems:"center",gap:"4px",color:"var(--text-muted)",fontSize:"8px"}}><span>💰</span>Payment pending</div>
                    </div>
                </>}
            </div>

            {/* ── Modals ── */}
            <Modal isOpen={showProfile} onClose={()=>setShowProfile(false)}>
                <ProfileModal user={user} onClose={()=>setShowProfile(false)} onUpdate={u=>{setUser(u);setShowProfile(false);}}/>
            </Modal>
            <Modal isOpen={modal?.type==="addUnit"} onClose={()=>setModal(null)}>
                {modal?.type==="addUnit"&&<AddUnitForm onAdd={handleAddUnit} onClose={()=>setModal(null)}/>}
            </Modal>
            <Modal isOpen={modal?.type==="add"} onClose={()=>setModal(null)} wide>
                {modal?.type==="add"&&selUnit&&<BookingForm unit={selUnit} sources={sources} onAddSource={handleAddSource} onSave={handleSave} onClose={()=>setModal(null)} defaultDate={modal.date}/>}
            </Modal>
            <Modal isOpen={modal?.type==="detail"} onClose={()=>setModal(null)}>
                {modal?.type==="detail"&&<BookingDetail booking={modal.booking} unit={selUnit} sources={sources} onClose={()=>setModal(null)} onEdit={b=>setModal({type:"edit",booking:b})} onDelete={handleDelete} onStatusChange={handleStatusChange} onPaymentUpdate={handlePaymentUpdate}/>}
            </Modal>
            <Modal isOpen={modal?.type==="edit"} onClose={()=>setModal(null)} wide>
                {modal?.type==="edit"&&selUnit&&<BookingForm unit={selUnit} sources={sources} onAddSource={handleAddSource} onSave={handleSave} onClose={()=>setModal(null)} editBooking={modal.booking}/>}
            </Modal>

            {/* Mobile bottom tab bar */}
            <style>{`
        .mobile-tab-bar{display:none}
        @media(max-width:768px){
          .mobile-tab-bar{
            display:flex;position:fixed;bottom:0;left:0;right:0;z-index:90;
            background:var(--modal-bg);border-top:1px solid var(--border);
            padding:4px 0 env(safe-area-inset-bottom,4px);
          }
          .main-content{padding-bottom:60px}
        }
      `}</style>
            <div className="mobile-tab-bar">
                {[["calendar","📅","Cal"],["dashboard","📊","Rep"],["sync","🔄","Sync"],["sources","🏷","Types"],...(user.role==="admin"?[["admin","⚙","Admin"]]:[])]
                    .map(([t,i,l])=>(
                        <button key={t} onClick={()=>setActiveTab(t)} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:"2px",padding:"6px 0",border:"none",background:"transparent",color:activeTab===t?"#C4B5FD":"var(--text-faint)",cursor:"pointer",fontFamily:"'DM Mono', monospace",fontSize:"8px",letterSpacing:"0.06em",position:"relative"}}>
                            <span style={{fontSize:"18px"}}>{i}</span>{l}
                            {activeTab===t&&<div style={{position:"absolute",bottom:0,left:"50%",transform:"translateX(-50%)",width:"4px",height:"4px",borderRadius:"50%",background:"#6E56CF"}}/>}
                        </button>
                    ))}
            </div>
        </div>
    );
}
