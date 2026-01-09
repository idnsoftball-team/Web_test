// script.js - v28.0 (Phase 1: UI Feedback & Layout Fix)

const APP_VERSION = '28.0';
// ★★★ 請保留您的私人 Gmail GAS 網址 ★★★
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

if ('serviceWorker' in navigator) { navigator.serviceWorker.getRegistrations().then(r => r.forEach(i => i.unregister())); }

let announcements=[], schedule={}, players=[], staff=[], matches=[], leaveRequestsData=[];
let adminLeaveShowToday = false;

const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = ['17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'];

function checkAppVersion() {
  const v = localStorage.getItem('kf_ver');
  if (v !== APP_VERSION) {
    localStorage.setItem('kf_ver', APP_VERSION);
    if(v) window.location.reload(true);
  }
}
function initEmptySchedule() {
  schedule = {};
  weekdays.forEach(d => { schedule[d] = {}; defaultSlots.forEach(s => schedule[d][s] = []); });
}
initEmptySchedule();

// === Load Data (GET) ===
async function loadAllData() {
  const loader = document.getElementById('app-loader');
  try {
    const fetchUrl = `${GAS_API_URL}?action=get_all_data&t=${new Date().getTime()}`;
    const res = await fetch(fetchUrl);
    const text = await res.text();
    if (text.trim().startsWith('<')) throw new Error("權限錯誤：請確認 GAS 部署為「任何人」");
    const data = JSON.parse(text);
    if (data.status === 'error') throw new Error(data.message);

    const norm = normalizeData(data);
    announcements = norm.announcements;
    players = norm.players;
    staff = norm.staff;
    matches = norm.matches;
    leaveRequestsData = norm.leaveRequests;
    window.heroConfig = norm.hero;

    initEmptySchedule();
    norm.schedules.forEach(item => {
      const d = item.date, s = item.slot;
      if (!schedule[d]) schedule[d] = {};
      if (!schedule[d][s]) schedule[d][s] = [];
      schedule[d][s].push(item);
    });
    renderHome();
  } catch (e) {
    console.error(e);
    const msg = document.getElementById('loader-text');
    if(msg) msg.innerText = "連線失敗：" + e.message;
  } finally {
    if(loader) setTimeout(()=>loader.style.display='none', 500);
  }
}

function normalizeData(data) {
  const getVal = (obj, keys) => { for (const k of keys) if (obj[k]) return obj[k]; return ""; };
  const anns = (data.announcements||[]).map(r => ({
    title: getVal(r, ['title', 'announcement_title']),
    date: String(getVal(r, ['date', 'announcement_date']) || '').split('T')[0],
    content: getVal(r, ['content', 'announcement_content'])
  })).filter(a=>a.title);
  
  const mapStaff = (data.staff||[]).map(r => ({ id: String(r.staff_id||r.id), name: r.name||'教練' }));
  const mapPlayers = (data.players||[]).map(r => ({
    rowId: r.rowId,
    id: String(r.player_id||r.id),
    name: getVal(r, ['student_name', 'name']),
    grade: r.grade, class: r.class, paddle: r.paddle
  }));
  const schedules = (data.training_schedule||[]).map(r => {
    const cId = String(r.coach_id||'');
    const paId = String(r.player_a_id||'');
    const pbId = String(r.player_b_id||'');
    return {
      date: r.weekday||'', slot: r.slot||'', table: r.table_no||'',
      coach: mapStaff.find(s=>s.id===cId)||{name:cId},
      playerA: mapPlayers.find(p=>p.id===paId)||{name:paId},
      playerB: mapPlayers.find(p=>p.id===pbId)||{name:pbId}
    };
  });
  const leaves = (data.leave_requests||[]).map(r => ({
    rowId: r.rowId,
    name: getVal(r, ['created_by_email', 'name']) || '未知',
    date: String(getVal(r, ['leave_date', 'date']) || '').split('T')[0],
    slot: r.slot||'', reason: r.reason||''
  }));
  const mapMatches = (data.matches||[]).map(r => ({
    rowId: r.rowId,
    date: String(getVal(r, ['match_date', 'date']) || '').split('T')[0],
    type: String(getVal(r, ['match_type', 'type'])||'').includes('雙')?'doubles':'singles',
    score: getVal(r, ['game_score', 'score'])||'',
    sets: r.set_scores||'',
    players: [r.player1_id, r.player2_id].filter(Boolean),
    opponents: [r.opponent1, r.opponent2].filter(Boolean),
    video: { url: r.media_url }
  }));
  return { announcements: anns, staff: mapStaff, players: mapPlayers, schedules, leaveRequests: leaves, matches: mapMatches, hero: data.hero||{} };
}

// Renderers (Home, Announce, Leave, Match, Roster, Schedule, Media) - Preserved
function renderHome() { const bg=window.heroConfig?.hero_bg_url; if(bg)document.querySelector('.hero-bg-placeholder').style.backgroundImage=`url(${convertDriveLink(bg)})`; const a=document.getElementById('home-announcements'); if(a){a.innerHTML=''; const l=announcements.slice().sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)).slice(0,3); if(l.length===0)a.innerHTML='<div style="text-align:center;padding:10px;color:#999">無最新動態</div>'; l.forEach(i=>{a.innerHTML+=`<div class="card" onclick="showAnnouncementDetail('${escapeHtml(i.title)}','${i.date}','${escapeHtml(i.content)}')"><div style="display:flex;justify-content:space-between;align-items:center"><h4 style="margin:0;color:#0054a6">${escapeHtml(i.title)}</h4><span style="font-size:0.8rem;color:#888">${i.date}</span></div><p style="margin-top:6px;font-size:0.9rem;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(i.content)}</p></div>`});} const hl=document.getElementById('home-leave-overview'); if(hl){ const t=new Date().toISOString().split('T')[0]; const tl=leaveRequestsData.filter(l=>l.date===t); hl.innerHTML=''; if(tl.length===0)hl.innerHTML='<div style="color:#999;font-size:0.9rem;">今日無請假</div>'; else tl.forEach(l=>{hl.innerHTML+=`<div style="background:white;padding:10px;border-radius:8px;margin-bottom:5px;border-left:3px solid #ffcc00;font-size:0.9rem;"><strong>${escapeHtml(l.name)}</strong> <span style="color:#666">${l.slot}</span></div>`}); } renderLeaveList(); }
function renderAnnouncements() { const d=document.getElementById('announcement-list'); d.innerHTML=''; const l=announcements.slice().sort((a,b)=>new Date(b.date||0)-new Date(a.date||0)); if(l.length===0){d.innerHTML='<div style="text-align:center;padding:20px">無公告</div>';return} l.forEach(a=>{d.innerHTML+=`<div class="card" onclick="showAnnouncementDetail('${escapeHtml(a.title)}','${a.date}','${escapeHtml(a.content)}')"><div style="display:flex;justify-content:space-between;"><h4 style="margin:0">${escapeHtml(a.title)}</h4><span style="font-size:0.8rem;color:#888">${a.date}</span></div><p style="margin-top:8px;color:#555">${escapeHtml(a.content)}</p></div>`}); }
function renderLeaveList() { const d=document.getElementById('leave-list'); d.innerHTML=''; if(leaveRequestsData.length===0){d.innerHTML='<div style="text-align:center;color:#888;padding:20px">無資料</div>';return} leaveRequestsData.forEach(l=>{d.innerHTML+=`<div class="leave-card-new"><div class="leave-header-row"><span class="leave-name-large">${escapeHtml(l.name)}</span></div><div class="leave-tags-row"><div class="tag-date"><i class="far fa-calendar-alt"></i> ${l.date}</div><div class="tag-time"><i class="far fa-clock"></i> ${escapeHtml(l.slot)}</div></div><div class="leave-reason-box">${escapeHtml(l.reason)}</div></div>`}); }
function renderMatches() { const d=document.getElementById('match-list'); d.innerHTML=''; const k=document.getElementById('match-keyword').value.toLowerCase(); const s=document.getElementById('filter-singles').checked; const db=document.getElementById('filter-doubles').checked; const l=matches.filter(m=>{if(m.type==='singles'&&!s)return false;if(m.type==='doubles'&&!db)return false;const t=[...m.players,...m.opponents].map(getPlayerName).join(' ').toLowerCase();return !k||t.includes(k)}); if(l.length===0){d.innerHTML='<div style="text-align:center;padding:20px;color:#999">無紀錄</div>';return} l.forEach(m=>{const p=m.players.map(getPlayerName).join(' & ');const o=m.opponents.map(getPlayerName).join(' & ');const el=document.createElement('div');el.className='match-card-score';el.innerHTML=`<div class="match-score-header"><span>${m.date}</span><span>${m.type==='singles'?'單打':'雙打'}</span></div><div class="match-score-body"><div class="match-players-container"><div class="match-side"><span class="side-names">${escapeHtml(p)}</span></div><div style="font-size:0.8rem;color:#ccc">VS</div><div class="match-side"><span class="side-names">${escapeHtml(o)}</span></div></div><div class="match-score-box">${escapeHtml(m.score)}</div></div><div class="match-details-panel"><div style="margin-bottom:5px;"><strong>局數:</strong> ${escapeHtml(m.sets||'無')}</div>${m.video.url?`<button class="hero-btn" style="font-size:0.8rem;padding:4px 10px;" onclick="event.stopPropagation();window.open('${m.video.url}','_blank')">影片</button>`:''}</div>`;el.onclick=function(){this.classList.toggle('expanded')};d.appendChild(el)}); }
function renderRoster(){const pd=document.getElementById('roster-players');const sd=document.getElementById('roster-staff');pd.innerHTML='';sd.innerHTML='';const q=document.getElementById('roster-search').value.toLowerCase();staff.forEach(s=>{if(q&&!s.name.includes(q))return;sd.innerHTML+=`<div class="roster-card-compact"><div class="roster-name">${escapeHtml(s.name)}</div><div class="roster-info">教練</div></div>`});players.forEach(p=>{const t=[p.name,p.grade,p.class].join(' ');if(q&&!t.includes(q))return;let i=(p.grade?p.grade+'年':'')+(p.class?p.class+'班':'')||'學員';pd.innerHTML+=`<div class="roster-card-compact"><div class="roster-name">${escapeHtml(p.name)}</div><div class="roster-info">${i}</div></div>`})}
function renderSchedule(){const c=document.getElementById('schedule-container');c.innerHTML='';const q=document.getElementById('schedule-search').value.toLowerCase();weekdays.forEach((d,i)=>{const slots=schedule[d]||{};let has=false;defaultSlots.forEach(s=>{if(slots[s]?.length)has=true});const h=document.createElement('div');h.className='accordion-header';const isT=(i===((new Date().getDay()+6)%7));const op=isT||q;h.innerHTML=`<span>${d}</span> <i class="fas fa-chevron-${op?'up':'down'}"></i>`;if(op)h.classList.add('active');const ct=document.createElement('div');ct.className=`accordion-content ${op?'show':''}`;if(!has&&!q){ct.innerHTML='<div style="padding:10px;text-align:center;color:#ccc">本日無課</div>'}else{Object.keys(slots).forEach(s=>{const items=slots[s].filter(e=>!q||JSON.stringify(e).toLowerCase().includes(q));if(items.length===0)return;ct.innerHTML+=`<div class="time-slot-header">${s}</div>`;const g=document.createElement('div');g.className='compact-grid';items.forEach(e=>{let html=`<div class="compact-card"><div class="schedule-header"><span class="table-badge">T${e.table}</span><span class="coach-name">${escapeHtml(e.coach?.name||'')}</span></div><div class="player-name">${escapeHtml(e.playerA?.name||'')}</div>${e.playerB&&e.playerB.name?`<div class="player-name">${escapeHtml(e.playerB.name)}</div>`:''}</div>`;g.innerHTML+=html;});ct.appendChild(g)})}h.onclick=()=>{h.classList.toggle('active');ct.classList.toggle('show');h.querySelector('i').className=`fas fa-chevron-${ct.classList.contains('show')?'up':'down'}`};c.appendChild(h);c.appendChild(ct)})}
function renderMedia(){const c=document.getElementById('media-list');c.innerHTML='';const v=matches.filter(m=>m.video&&m.video.url);if(v.length===0){c.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#888">暫無影音</div>';return}v.forEach(m=>{const id=getYouTubeID(m.video.url);const t=id?`https://img.youtube.com/vi/${id}/mqdefault.jpg`:'https://via.placeholder.com/320x180';const d=document.createElement('div');d.className='video-card';d.innerHTML=`<div class="video-thumb-container"><img src="${t}" class="video-thumb"><div class="play-icon-overlay"><i class="far fa-play-circle"></i></div></div><div class="video-info"><div class="video-title">${m.players.map(getPlayerName).join('/')} vs ${m.opponents.map(getPlayerName).join('/')}</div></div>`;d.onclick=()=>{id?openVideoModal(id):window.open(m.video.url,'_blank')};c.appendChild(d)})}

function getPlayerName(id){const p=players.find(x=>x.id===id);return p?p.name:id} function escapeHtml(t){return t?String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;'):''} function convertDriveLink(u){if(!u)return'';if(u.includes('googleusercontent'))return u;const m=u.match(/\/d\/([a-zA-Z0-9_-]+)/);return m?`https://drive.google.com/uc?export=view&id=${m[1]}`:u} function getYouTubeID(u){const m=u.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);return (m&&m[1].length===11)?m[1]:null} function showToast(m){const c=document.getElementById('toast-container');const t=document.createElement('div');t.className='toast show';t.innerText=m;c.appendChild(t);setTimeout(()=>t.remove(),3000)} function showAnnouncementDetail(t,d,c){const m=document.getElementById('announcement-detail');m.innerHTML=`<button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button><h3 style="margin-top:10px;color:#0054a6">${t}</h3><div style="color:#888;font-size:0.85rem;margin-bottom:15px;border-bottom:1px dashed #eee;padding-bottom:10px">${d}</div><div style="line-height:1.8;color:#333;white-space:pre-wrap">${c}</div>`;document.body.classList.add('modal-open');m.classList.add('active')} function openVideoModal(id){const m=document.getElementById('announcement-detail');m.innerHTML=`<button class="btn-close-absolute" onclick="hideModal()" style="color:white;z-index:100"><i class="fas fa-times"></i></button><iframe src="https://www.youtube.com/embed/${id}?autoplay=1" style="width:100%;height:100%;border:none" allowfullscreen></iframe>`;m.style.background='black';m.style.padding='0';m.classList.add('active');document.body.classList.add('modal-open')} function hideModal(){document.querySelectorAll('.modal').forEach(m=>{m.classList.remove('active');m.style.background='';m.style.padding='';});document.body.classList.remove('modal-open')}

// Admin
function renderAdmin() { 
    if(!sessionStorage.getItem('adm')) { 
        document.getElementById('admin-dashboard').classList.add('hidden');
        const lc=document.getElementById('admin-login'); lc.classList.remove('hidden');
        lc.innerHTML=`<h3 style="margin-bottom:20px;color:#0054a6;">系統登入</h3><input type="password" id="admin-password" class="admin-input" placeholder="輸入管理密碼"><button id="admin-login-btn" class="admin-btn-login">登入</button>`;
        document.getElementById('admin-login-btn').onclick=async()=>{
            const p=document.getElementById('admin-password').value; if(!p)return alert('請輸入密碼');
            const btn=document.getElementById('admin-login-btn'); btn.innerText='驗證中...';
            try{ const res=await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action:'check_auth',password:p})}); const j=await res.json(); if(j.success){sessionStorage.setItem('adm',p);renderAdmin();showToast('登入成功')}else{alert('密碼錯誤');btn.innerText='登入'} }catch(e){alert('連線錯誤');btn.innerText='登入'}
        }; 
    } else { document.getElementById('admin-login').classList.add('hidden'); document.getElementById('admin-dashboard').classList.remove('hidden'); bindAdmin(); } 
}
function bindAdmin() { 
    document.getElementById('admin-add-announcement').onclick=()=>{document.getElementById('admin-content').innerHTML=`<div class="card"><h3>新增公告</h3><input id="at" class="admin-input" placeholder="標題"><input type="date" id="ad" class="admin-input"><textarea id="ac" class="admin-textarea"></textarea><button class="hero-btn" onclick="postAnn()">發布</button></div>`}; 
    document.getElementById('admin-view-leave').onclick=showAdminLeaveList;
    document.getElementById('admin-manage-players').onclick=showAdminPlayerList; 
    document.getElementById('admin-manage-matches').onclick=()=>showToast('比賽管理: 開發中'); 
    document.getElementById('admin-settings').onclick=()=>showAdminSettings(); 
}

// === Phase 1: Enhanced Admin Player List ===
function showAdminPlayerList() {
    const c = document.getElementById('admin-content');
    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><h3>球員名冊</h3><button class="hero-btn" onclick="editPlayer()"><i class="fas fa-plus"></i> 新增</button></div>`;
    h += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;">`;
    players.forEach(p => {
        h += `<div class="card" id="p-card-${p.rowId}" style="margin:0;position:relative;">
            <div class="admin-card-header">
                <div>
                    <div style="font-weight:bold;font-size:1.1rem;">${escapeHtml(p.name)}</div>
                    <div style="font-size:0.85rem;color:#666;">${p.grade||'?'}年 ${p.class||'?'}班</div>
                </div>
                <div class="admin-card-actions">
                    <button class="admin-btn-icon edit" onclick="editPlayer('${p.rowId}')"><i class="fas fa-edit"></i></button>
                    <button class="admin-btn-icon delete" onclick="delPlayer('${p.rowId}')"><i class="fas fa-trash"></i></button>
                </div>
            </div>
            <div style="font-size:0.85rem;color:#555;">膠皮: ${escapeHtml(p.paddle||'無')}</div>
        </div>`;
    });
    h += '</div>';
    c.innerHTML = h;
}

window.editPlayer = (rowId) => {
    const p = rowId ? players.find(x => x.rowId == rowId) : { name:'', grade:'', class:'', paddle:'' };
    const title = rowId ? '編輯球員' : '新增球員';
    const c = document.getElementById('admin-content');
    c.innerHTML = `<div class="card">
        <h3>${title}</h3>
        <label>姓名</label><input id="ep-name" class="admin-input" value="${escapeHtml(p.name)}">
        <label>年級</label><input id="ep-grade" class="admin-input" type="number" value="${p.grade||''}">
        <label>班級</label><input id="ep-class" class="admin-input" type="number" value="${p.class||''}">
        <label>膠皮</label><input id="ep-paddle" class="admin-input" value="${escapeHtml(p.paddle||'')}">
        <div style="margin-top:15px; display:flex; gap:10px;">
            <button id="btn-save-player" class="hero-btn" onclick="savePlayerEdit('${rowId||''}')">儲存</button>
            <button class="hero-btn" style="background:#ccc" onclick="showAdminPlayerList()">取消</button>
        </div>
    </div>`;
};

window.savePlayerEdit = async (rowId) => {
    const btn = document.getElementById('btn-save-player');
    const name = document.getElementById('ep-name').value;
    if(!name) return alert('請輸入姓名');
    
    // UI Feedback: Loading
    btn.innerText = '⏳ 儲存中...';
    btn.disabled = true;

    const payload = {
        rowId: rowId,
        name: name,
        grade: document.getElementById('ep-grade').value,
        class: document.getElementById('ep-class').value,
        paddle: document.getElementById('ep-paddle').value
    };
    
    await sendToGasWithAuth('save_player', payload);
    // Success: Reload List directly
    showAdminPlayerList();
    showToast('✅ 儲存成功');
};

window.delPlayer = async (id) => {
    if(confirm('確定要刪除這位球員嗎？')) {
        // UI Feedback: Remove DOM immediately
        const card = document.getElementById(`p-card-${id}`);
        if(card) card.style.opacity = '0.5';
        
        await sendToGasWithAuth('delete_player', {rowId: id});
        
        if(card) card.remove();
        showToast('🗑️ 已刪除');
    }
};

// Admin Leave (Old Logic Preserved)
function showAdminLeaveList() {
    const c = document.getElementById('admin-content');
    let h = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;"><h3>請假管理</h3><button id="adm-filter-today" class="btn-filter-today ${adminLeaveShowToday?'active':''}"><i class="fas fa-calendar-day"></i> 只看今日</button></div>`;
    let list = leaveRequestsData.slice().sort((a,b) => new Date(a.date) - new Date(b.date));
    if(adminLeaveShowToday) { const t=new Date().toISOString().split('T')[0]; list=list.filter(x=>x.date===t); }
    if(list.length===0) h+='<div class="card">無資料</div>';
    else { list.forEach(l=>{h+=`<div class="card" style="display:flex;flex-direction:column;gap:8px;"><div style="display:flex;justify-content:space-between;align-items:center;"><div style="font-weight:bold;font-size:1.1rem;">${escapeHtml(l.name)}</div><div style="font-size:0.85rem;color:#666;">${l.date}</div></div><div style="background:#f9f9f9;padding:5px 8px;border-radius:4px;font-size:0.9rem;"><i class="far fa-clock"></i> ${escapeHtml(l.slot)}</div><div style="color:#555;font-size:0.9rem;">${escapeHtml(l.reason)}</div><div style="display:flex;justify-content:flex-end;gap:10px;margin-top:5px;border-top:1px solid #eee;padding-top:8px;"><button class="action-btn" onclick="editLeave('${l.rowId}')" style="color:var(--primary-color);border:none;background:none;font-weight:bold;"><i class="fas fa-edit"></i> 編輯</button><button class="action-btn" onclick="delLeave('${l.rowId}')" style="color:red;border:none;background:none;font-weight:bold;"><i class="fas fa-trash"></i> 刪除</button></div></div>`}); }
    c.innerHTML = h; document.getElementById('adm-filter-today').onclick=()=>{adminLeaveShowToday=!adminLeaveShowToday;showAdminLeaveList()};
}
window.editLeave=(id)=>{const l=leaveRequestsData.find(x=>x.rowId==id);if(!l)return;document.getElementById('admin-content').innerHTML=`<div class="card"><h3>編輯請假</h3><label>姓名</label><input id="el-name" class="admin-input" value="${escapeHtml(l.name)}"><label>日期</label><input type="date" id="el-date" class="admin-input" value="${l.date}"><label>時段</label><select id="el-slot" class="admin-input">${defaultSlots.map(s=>`<option value="${s}" ${s===l.slot?'selected':''}>${s}</option>`).join('')}</select><label>事由</label><textarea id="el-reason" class="admin-textarea">${escapeHtml(l.reason)}</textarea><div style="margin-top:15px;display:flex;gap:10px;"><button class="hero-btn" onclick="saveLeaveEdit('${id}')">儲存</button><button class="hero-btn" style="background:#ccc" onclick="showAdminLeaveList()">取消</button></div></div>`};
window.saveLeaveEdit=async(id)=>{const p={rowId:id,name:document.getElementById('el-name').value,date:document.getElementById('el-date').value,slot:document.getElementById('el-slot').value,reason:document.getElementById('el-reason').value};await sendToGasWithAuth('update_leave',p);showAdminLeaveList()};
function showAdminSettings() { document.getElementById('admin-content').innerHTML = `<div class="card"><h3>網站設定</h3><label>首頁背景圖 URL</label><input id="conf-bg" class="admin-input" value="${escapeHtml(window.heroConfig?.hero_bg_url||'')}"><button class="hero-btn" onclick="saveConfig()">儲存設定</button></div>`; }
async function saveConfig() { await sendToGasWithAuth('update_config', { hero_bg_url: document.getElementById('conf-bg').value }); }
async function sendToGasWithAuth(action, payload) { const pwd = sessionStorage.getItem('adm'); if(!pwd) return; const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action, payload, password: pwd }) }); const j = await res.json(); showToast(j.message); if(j.success) { loadAllData(); } }
window.postAnn=async()=>{ await fetch(GAS_API_URL,{method:'POST', body:JSON.stringify({action:'add_announcement', password:sessionStorage.getItem('adm'), payload:{title:document.getElementById('at').value, date:document.getElementById('ad').value, content:document.getElementById('ac').value}})}); alert('已發布'); loadAllData(); };
window.delLeave=async(id)=>{ if(confirm('刪除?')) { await fetch(GAS_API_URL,{method:'POST', body:JSON.stringify({action:'delete_leave', password:sessionStorage.getItem('adm'), payload:{rowId:id}})}); alert('已刪除'); loadAllData(); } };

function navigateTo(id,push=true) { document.querySelectorAll('main>section').forEach(s=>{s.classList.add('hidden');s.classList.remove('active')}); const t=document.getElementById(id); if(t){t.classList.remove('hidden');t.classList.add('active'); if(id==='announcements')renderAnnouncements(); if(id==='schedule')renderSchedule(); if(id==='matches')renderMatches(); if(id==='roster')renderRoster(); if(id==='leave')renderLeaveList(); if(id==='media')renderMedia(); if(id==='admin')renderAdmin();} if(push)history.pushState({section:id},'',`#${id}`); document.querySelectorAll('nav a, #bottom-nav button').forEach(e=>{e.classList.remove('active');if(e.dataset.section===id)e.classList.add('active')}); }
function initNavigation() { document.querySelectorAll('[data-section]').forEach(e=>{e.onclick=(ev)=>{ev.preventDefault();navigateTo(e.dataset.section);document.body.classList.remove('sidebar-open')}}); document.getElementById('menu-toggle').onclick=()=>document.body.classList.toggle('sidebar-open'); document.getElementById('overlay').onclick=()=>document.body.classList.remove('sidebar-open'); }

document.addEventListener('DOMContentLoaded', () => { checkAppVersion(); loadAllData(); initNavigation(); const b=(id,fn)=>{const e=document.getElementById(id);if(e)e.oninput=fn;}; b('schedule-search',renderSchedule); b('roster-search',renderRoster); b('match-keyword',renderMatches); const bc=(id,fn)=>{const e=document.getElementById(id);if(e)e.onchange=fn;}; bc('filter-singles',renderMatches); bc('filter-doubles',renderMatches); document.getElementById('leave-form').onsubmit=(e)=>{e.preventDefault(); fetch(GAS_API_URL,{method:'POST', body:JSON.stringify({action:'add_leave', payload:{name:document.getElementById('leave-name').value, date:document.getElementById('leave-date').value, slot:document.getElementById('leave-slot').value, reason:document.getElementById('leave-reason').value}})}).then(()=>{alert('請假成功');document.getElementById('leave-form').reset();loadAllData()});}; const h=location.hash.replace('#','')||'home'; if(h)navigateTo(h,false); window.onscroll=()=>{const b=document.getElementById('back-to-top');if(b)b.classList.toggle('show',window.scrollY>300)}; });