// script.js - v13.0 Final Fix (Force POST for Data Loading)

const APP_VERSION = '13.0'; // 升級版號強制重整
// ★★★ 請確認這是您最新的 Web App URL ★★★
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// ... (Global Data & Weekdays 保持不變) ...
let announcements = [], schedule = {}, players = [], staff = [], matches = [], leaveRequestsData = [];
const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = ['17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'];

// ... (checkAppVersion & initEmptySchedule 保持不變) ...
function checkAppVersion() {
  const storedVersion = localStorage.getItem('kf_app_version');
  if (storedVersion !== APP_VERSION) {
    console.log(`Updated to v${APP_VERSION}`);
    localStorage.setItem('kf_app_version', APP_VERSION);
    if (storedVersion) { alert('系統更新至 v' + APP_VERSION); window.location.reload(true); }
  }
}
function initEmptySchedule() {
  schedule = {};
  weekdays.forEach(d => { schedule[d] = {}; defaultSlots.forEach(s => schedule[d][s] = []); });
}
initEmptySchedule();

// ★★★ 重點修正：改用 POST 請求讀取資料 ★★★
async function loadAllData() {
  const loader = document.getElementById('app-loader');
  try {
    // 這裡原本是 GET，現在改用 POST 並帶上 action 參數
    // 這樣可以避開 doGet 的各種權限/快取地雷
    const res = await fetch(GAS_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 避免 CORS preflight
        body: JSON.stringify({ action: 'get_all_data' }) // 告訴後端我要讀資料
    });
    
    const text = await res.text(); // 先讀成文字，方便除錯
    let data;
    try {
        data = JSON.parse(text);
    } catch (e) {
        console.error("JSON Parse Error:", text);
        throw new Error("伺服器回傳格式錯誤");
    }

    if (data.status === 'error') throw new Error(data.message);

    console.log("Raw Data:", data);

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

    console.log("Normalized:", norm);
    renderHome();
  } catch (e) {
    console.error("Load Error", e);
    // 顯示更具體的錯誤訊息
    const loaderText = document.getElementById('loader-text');
    if(loaderText) loaderText.innerText = "資料載入失敗: " + e.message;
    // showToast("資料載入異常"); // 先註解掉以免擋住畫面
  } finally {
    if(loader) setTimeout(() => loader.style.display = 'none', 500);
  }
}

// ★★★ 配合 POST 修改 GAS 端處理 (請確認後端是否支援) ★★★
// 為了讓 POST Work，您的 GAS.gs 的 doPost 必須包含處理 'get_all_data' 的邏輯
// 請檢查下一段說明

// ... (normalizeData 及其它 Render 函式全部保持您原本 v12.0 的內容即可) ...
// 為了節省您的複製時間，下方列出 normalizeData 之後的內容，請直接接續使用
function normalizeData(data) {
  const getVal = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== "") return obj[k];
    }
    return "";
  };

  const anns = (data.announcements || []).map(r => ({
    title: getVal(r, ['title', '標題', 'announcement_title']),
    date: formatDate(getVal(r, ['date', '日期', 'announcement_date'])),
    content: getVal(r, ['content', '內容', 'announcement_content'])
  })).filter(a => a.title);

  const mapStaff = (data.staff || []).map(r => ({ 
    id: String(getVal(r, ['staff_id', 'id'])), 
    name: getVal(r, ['name', 'staff_name', '姓名']) || '教練' 
  }));

  const mapPlayers = (data.players || []).map(r => ({
    id: String(getVal(r, ['player_id', 'id'])),
    name: getVal(r, ['student_name', 'name', '姓名', 'Name']),
    grade: getVal(r, ['grade', '年級']),
    class: getVal(r, ['class', '班級']),
    paddle: getVal(r, ['paddle', '膠皮'])
  }));

  const schedules = (data.training_schedule || []).map(r => {
    const cId = String(getVal(r, ['coach_id', 'coachId']));
    const paId = String(getVal(r, ['player_a_id', 'playerAId']));
    const pbId = String(getVal(r, ['player_b_id', 'playerBId']));
    return {
      rowId: r.rowId,
      date: getVal(r, ['weekday', 'date', '星期']),
      slot: getVal(r, ['slot', 'time', '時段']),
      table: getVal(r, ['table_no', 'table', '桌次']),
      coach: mapStaff.find(s => s.id === cId) || { name: cId },
      playerA: mapPlayers.find(p => p.id === paId) || { name: paId },
      playerB: mapPlayers.find(p => p.id === pbId) || { name: pbId },
      remark: getVal(r, ['note', '備註']) || ''
    };
  });
  
  const leaves = (data.leave_requests || []).map(r => ({
    rowId: r.rowId,
    name: getVal(r, ['created_by_email', 'name', '姓名']) || '未知',
    date: formatDate(getVal(r, ['leave_date', 'date', '日期'])),
    slot: getVal(r, ['slot', '時段']) || '',
    reason: getVal(r, ['reason', '事由']) || ''
  }));

  const mapMatches = (data.matches || []).map(r => ({
    rowId: r.rowId,
    date: formatDate(getVal(r, ['match_date', 'date', '日期'])),
    type: getVal(r, ['match_type', 'type']).includes('雙') ? 'doubles' : 'singles',
    score: getVal(r, ['game_score', 'score', '比分']) || '',
    sets: getVal(r, ['set_scores', 'sets']) || '',
    players: [getVal(r, ['player1_id', 'p1']), getVal(r, ['player2_id', 'p2'])].filter(Boolean),
    opponents: [getVal(r, ['opponent1', 'o1']), getVal(r, ['opponent2', 'o2'])].filter(Boolean),
    video: { url: getVal(r, ['media_url', 'video', '影片']) }
  }));

  return { hero: data.hero || {}, announcements: anns, staff: mapStaff, players: mapPlayers, schedules: schedules, leaveRequests: leaves, matches: mapMatches };
}

function formatDate(d) {
    if(!d) return '';
    if(d.includes && d.includes('T')) return d.split('T')[0];
    return d;
}

// ... (Render Functions - Home, Announcements, Leave, Matches, Roster, Schedule, Media - 保持不變) ...
// 為了避免這裡太長，請直接保留您原本 v12.0 的 Render 函式部分
// 或是直接使用下面的完整程式碼

function renderHome() {
  const bgUrl = window.heroConfig?.hero_bg_url;
  const heroBg = document.querySelector('#home .hero-bg-placeholder');
  if (heroBg && bgUrl) heroBg.style.backgroundImage = `url(${convertDriveLink(bgUrl)})`;

  const homeAnn = document.getElementById('home-announcements');
  if (homeAnn) {
    homeAnn.innerHTML = '';
    const sorted = announcements.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)).slice(0, 3);
    if (sorted.length === 0) {
        homeAnn.innerHTML = '<div style="text-align:center;padding:15px;color:#999;">目前無最新動態</div>';
    } else {
        sorted.forEach(item => {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><h4 style="margin:0; color:var(--primary-color);">${escapeHtml(item.title)}</h4><span style="font-size:0.8rem; color:#888;">${item.date}</span></div><p style="margin-top:6px; font-size:0.9rem; color:#555; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.content)}</p>`;
          card.onclick = () => showAnnouncementDetail(item);
          homeAnn.appendChild(card);
        });
    }
  }
  renderLeaveList(); 
}

function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
  if(sorted.length === 0) { listDiv.innerHTML = '<div style="text-align:center;padding:20px;">無公告</div>'; return; }
  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><h4 style="margin:0;">${escapeHtml(item.title)}</h4><span style="font-size:0.8rem; color:#888;">${item.date}</span></div><p style="margin-top:8px; color:#555; font-size:0.95rem;">${escapeHtml(item.content)}</p>`;
    card.onclick = () => showAnnouncementDetail(item);
    listDiv.appendChild(card);
  });
}

function renderLeaveList() {
    const div = document.getElementById('leave-list');
    if(!div) return;
    div.innerHTML = '';
    if(!leaveRequestsData || leaveRequestsData.length === 0) {
        div.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">無請假紀錄</div>';
        return;
    }
    const container = document.createElement('div');
    container.className = 'leave-list-container';
    leaveRequestsData.forEach(item => {
        const d = item.date.split('T')[0]; 
        const card = document.createElement('div');
        card.className = 'leave-card-new';
        card.innerHTML = `<div class="leave-header-row"><span class="leave-name-large">${escapeHtml(item.name)}</span></div><div class="leave-tags-row"><div class="tag-date"><i class="far fa-calendar-alt"></i> ${escapeHtml(d)}</div><div class="tag-time"><i class="far fa-clock"></i> ${escapeHtml(item.slot)}</div></div><div class="leave-reason-box">${escapeHtml(item.reason)}</div>`;
        container.appendChild(card);
    });
    div.appendChild(container);
}

function renderMatches() {
  const div = document.getElementById('match-list');
  if(!div) return;
  div.innerHTML = '';
  const key = (document.getElementById('match-keyword')?.value || '').toLowerCase();
  const showS = document.getElementById('filter-singles')?.checked ?? true;
  const showD = document.getElementById('filter-doubles')?.checked ?? true;
  const list = matches.filter(m => {
    if(m.type === 'singles' && !showS) return false;
    if(m.type === 'doubles' && !showD) return false;
    const txt = [...m.players, ...m.opponents].map(getPlayerName).join(' ').toLowerCase();
    return !key || txt.includes(key);
  });
  if(list.length === 0) { div.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">無紀錄</div>'; return; }
  list.forEach(m => {
    const pNames = m.players.map(getPlayerName).join(' & ');
    const oNames = m.opponents.map(getPlayerName).join(' & ');
    const card = document.createElement('div');
    card.className = 'match-card-score';
    card.innerHTML = `<div class="match-score-header"><span>${m.date}</span><span>${m.type === 'singles' ? '單打' : '雙打'}</span></div><div class="match-score-body"><div class="match-players-container"><div class="match-side"><span class="side-names">${escapeHtml(pNames)}</span></div><div style="font-size:0.8rem;color:#ccc;">VS</div><div class="match-side"><span class="side-names">${escapeHtml(oNames)}</span></div></div><div class="match-score-box">${escapeHtml(m.score)}</div></div>`;
    card.onclick = () => showMatchDetail(m);
    div.appendChild(card);
  });
}

function renderRoster(){const pDiv=document.getElementById('roster-players');const sDiv=document.getElementById('roster-staff');if(!pDiv||!sDiv)return;pDiv.className='roster-grid';sDiv.className='roster-grid';pDiv.innerHTML='';sDiv.innerHTML='';const query=(document.getElementById('roster-search')?.value||'').toLowerCase();staff.forEach(s=>{if(query&&!s.name.includes(query))return;sDiv.innerHTML+=`<div class="roster-card-compact"><div class="roster-name">${escapeHtml(s.name)}</div><div class="roster-info">教練</div></div>`});players.forEach(p=>{const txt=[p.name,p.grade,p.class].join(' ');if(query&&!txt.includes(query))return;let info=(p.grade?p.grade+'年':'')+(p.class?p.class+'班':'');if(!info)info='學員';pDiv.innerHTML+=`<div class="roster-card-compact"><div class="roster-name">${escapeHtml(p.name)}</div><div class="roster-info">${info}</div></div>`})}
function renderSchedule(){const c=document.getElementById('schedule-container');if(!c)return;c.innerHTML='';const q=(document.getElementById('schedule-search')?.value||'').toLowerCase();weekdays.forEach((d,i)=>{const slots=schedule[d]||{};let has=false;defaultSlots.forEach(s=>{if(slots[s]?.length)has=true});const h=document.createElement('div');h.className='accordion-header';const isT=(i===((new Date().getDay()+6)%7));const op=isT||q;h.innerHTML=`<span>${d}</span> <i class="fas fa-chevron-${op?'up':'down'}"></i>`;if(op)h.classList.add('active');const ct=document.createElement('div');ct.className=`accordion-content ${op?'show':''}`;if(!has&&!q){ct.innerHTML='<div style="padding:10px;text-align:center;color:#ccc;">本日無課</div>'}else{Object.keys(slots).forEach(s=>{const items=slots[s].filter(e=>{if(!q)return true;return JSON.stringify(e).toLowerCase().includes(q)});if(items.length===0)return;ct.innerHTML+=`<div class="time-slot-header">${s}</div>`;const g=document.createElement('div');g.className='compact-grid';items.forEach(e=>{let p=escapeHtml(e.playerA?.name||'');if(e.playerB&&e.playerB.name)p+=`<br><span style="font-size:0.9em;color:#666">&</span><br>${escapeHtml(e.playerB.name)}`;g.innerHTML+=`<div class="compact-card"><div class="table-badge">T${e.table}</div><div class="coach-name">${escapeHtml(e.coach?.name||'')}</div><div class="players">${p}</div></div>`});ct.appendChild(g)})}h.onclick=()=>{h.classList.toggle('active');ct.classList.toggle('show');h.querySelector('i').className=`fas fa-chevron-${ct.classList.contains('show')?'up':'down'}`};c.appendChild(h);c.appendChild(ct)})}
function renderMedia(){const c=document.getElementById('media-list');if(!c)return;c.innerHTML='';const vs=matches.filter(m=>m.video&&m.video.url);if(vs.length===0){c.innerHTML='<div style="grid-column:1/-1;text-align:center;color:#888;">暫無影音</div>';return}vs.forEach(m=>{const y=getYouTubeID(m.video.url);const t=y?`https://img.youtube.com/vi/${y}/mqdefault.jpg`:'https://via.placeholder.com/320x180?text=Video';const d=document.createElement('div');d.className='video-card';d.innerHTML=`<div class="video-thumb-container"><img src="${t}" class="video-thumb"><div class="play-icon-overlay"><i class="far fa-play-circle"></i></div></div><div class="video-info"><div class="video-title">${m.players.map(getPlayerName).join('/')} vs ${m.opponents.map(getPlayerName).join('/')}</div></div>`;d.onclick=()=>{y?openVideoModal(y):window.open(m.video.url,'_blank')};c.appendChild(d)})}

// Utils & Admin (保持不變)
function getPlayerName(id) { const p = players.find(x => x.id === id); return p ? p.name : id; }
function escapeHtml(t) { return t ? String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;') : ''; }
function showAnnouncementDetail(item) {const m=document.getElementById('announcement-detail');m.innerHTML=`<button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button><h3 style="margin-top:10px; color:var(--primary-color);">${escapeHtml(item.title)}</h3><div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;"><i class="far fa-calendar-alt"></i> ${item.date}</div><div style="line-height:1.8; color:#333; font-size:0.95rem; white-space: pre-wrap;">${escapeHtml(item.content)}</div>`;document.body.classList.add('modal-open');m.classList.add('active')}
function hideModal() { document.querySelectorAll('.modal').forEach(m => { m.classList.remove('active'); m.innerHTML=''; }); document.body.classList.remove('modal-open'); }
function showMatchDetail(m) {const md=document.getElementById('player-analysis');const p=m.players.map(getPlayerName).join(' & ');const o=m.opponents.map(getPlayerName).join(' & ');md.innerHTML=`<button class="btn-close-absolute" onclick="document.getElementById('player-analysis').classList.add('hidden')"><i class="fas fa-times"></i></button><h3 style="margin:0 0 10px 0; color:var(--primary-color);">比賽詳情</h3><div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:10px;"><div style="font-weight:bold; font-size:1.1rem; margin-bottom:5px;">${escapeHtml(p)} <span style="color:#e74c3c">VS</span> ${escapeHtml(o)}</div><div style="color:#666; font-size:0.9rem;">${m.date} | ${m.type === 'singles' ? '單打' : '雙打'}</div><div style="margin-top:5px; font-weight:bold; color:var(--primary-dark); font-size:1.2rem;">比分: ${escapeHtml(m.score)}</div></div>${m.video && m.video.url ? `<div style="margin-top:10px;"><button class="hero-btn" style="width:100%;" onclick="window.open('${m.video.url}', '_blank')"><i class="fas fa-video"></i> 觀看影片</button></div>` : ''}`;md.classList.remove('hidden')}
function openVideoModal(ytId) {const m=document.getElementById('announcement-detail');m.innerHTML=`<button class="btn-close-absolute" onclick="hideModal()" style="color:white; z-index:100;"><i class="fas fa-times"></i></button><iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`;m.style.background='black';m.style.padding='0';m.classList.add('active');document.body.classList.add('modal-open')}
function getYouTubeID(url) { const match = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match&&match[1].length===11)?match[1]:null; }
function renderLeave() { renderLeaveList(); const f=document.getElementById('leave-form'); if(f) f.onsubmit=(e)=>{ e.preventDefault(); const p={ name:document.getElementById('leave-name').value, date:document.getElementById('leave-date').value, slot:document.getElementById('leave-slot').value, reason:document.getElementById('leave-reason').value }; sendToGas('add_leave',p).then(()=>f.reset()); }; }
async function sendToGas(action, payload) { const res=await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action,payload})}); const j=await res.json(); showToast(j.message); if(j.success) loadAllData(); }
function renderAdmin() { if(!sessionStorage.getItem('admin_pwd')) { document.getElementById('admin-login').classList.remove('hidden'); document.getElementById('admin-dashboard').classList.add('hidden'); const loginBtn = document.getElementById('admin-login-btn'); loginBtn.onclick = async () => { const pwd = document.getElementById('admin-password').value; if(!pwd) return showToast('請輸入密碼'); loginBtn.innerText = '驗證中...'; try { const res = await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action:'check_auth',password:pwd})}); const j = await res.json(); if(j.success) { sessionStorage.setItem('admin_pwd',pwd); renderAdmin(); showToast('登入成功'); } else { showToast('密碼錯誤'); } } catch(e) { showToast('連線失敗'); } finally { loginBtn.innerText = '登入'; } }; } else { document.getElementById('admin-login').classList.add('hidden'); document.getElementById('admin-dashboard').classList.remove('hidden'); bindAdminButtons(); } }
function bindAdminButtons() { const btnAnn = document.getElementById('admin-add-announcement'); if(btnAnn) btnAnn.onclick = showAdminAddAnnouncement; const btnLeave = document.getElementById('admin-view-leave'); if(btnLeave) btnLeave.onclick = showAdminLeaveList; const btnSet = document.getElementById('admin-settings'); if(btnSet) btnSet.onclick = showAdminSettings; const btnP = document.getElementById('admin-manage-players'); if(btnP) btnP.onclick = () => showToast('功能開發中：球員管理'); const btnM = document.getElementById('admin-manage-matches'); if(btnM) btnM.onclick = () => showToast('功能開發中：比賽紀錄管理'); }
function showAdminAddAnnouncement() { const c = document.getElementById('admin-content'); c.innerHTML = `<div class="card"><h3>發布新公告</h3><input id="new-ann-title" class="admin-input" placeholder="標題"><input type="date" id="new-ann-date" class="admin-input"><textarea id="new-ann-content" class="admin-textarea" placeholder="內容..."></textarea><button class="hero-btn" onclick="submitAnnouncement()">發布</button></div>`; }
async function submitAnnouncement() { const p = { title: document.getElementById('new-ann-title').value, date: document.getElementById('new-ann-date').value, content: document.getElementById('new-ann-content').value }; if(!p.title) return; await sendToGasWithAuth('add_announcement', p); showAdminAddAnnouncement(); }
function showAdminLeaveList() { const c = document.getElementById('admin-content'); c.innerHTML = '<h3>請假管理</h3><div id="adm-leave-list">載入中...</div>'; let html = ''; leaveRequestsData.forEach(l => { html += `<div class="card" style="display:flex;justify-content:space-between;"><div><b>${escapeHtml(l.name)}</b> (${l.date})<br>${escapeHtml(l.reason)}</div><button class="action-btn delete" onclick="deleteLeave('${l.rowId}')"><i class="fas fa-trash"></i></button></div>`; }); document.getElementById('adm-leave-list').innerHTML = html || '無資料'; }
async function deleteLeave(rowId) { if(confirm('確定刪除?')) await sendToGasWithAuth('delete_leave', {rowId}); }
function showAdminSettings() { const c = document.getElementById('admin-content'); const curr = window.heroConfig?.hero_bg_url || ''; c.innerHTML = `<div class="card"><h3>網站設定</h3><label>首頁背景圖 URL</label><input id="conf-bg" class="admin-input" value="${escapeHtml(curr)}"><button class="hero-btn" onclick="saveConfig()">儲存設定</button></div>`; }
async function saveConfig() { await sendToGasWithAuth('update_config', { hero_bg_url: document.getElementById('conf-bg').value }); }
async function sendToGasWithAuth(action, payload) { const pwd = sessionStorage.getItem('admin_pwd'); if(!pwd) return; const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action, payload, password: pwd }) }); const j = await res.json(); showToast(j.message); if(j.success) { loadAllData(); setTimeout(() => { if(action.includes('leave')) showAdminLeaveList(); }, 1000); } }
function convertDriveLink(url) { if(!url) return ''; if(url.includes('googleusercontent')) return url; const m=url.match(/\/d\/([a-zA-Z0-9_-]+)/)||url.match(/id=([a-zA-Z0-9_-]+)/); return m?`https://drive.google.com/uc?export=view&id=${m[1]}`:url; }
function showToast(m){ const c=document.getElementById('toast-container'); if(!c)return; const t=document.createElement('div'); t.className='toast show'; t.innerHTML=m; c.appendChild(t); setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),500)},3000); }

function navigateTo(id, push=true) {
    document.querySelectorAll('main>section').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    const target = document.getElementById(id);
    if(target) {
        target.classList.remove('hidden'); 
        target.classList.add('active');
        if(id==='announcements') renderAnnouncements(); 
        if(id==='schedule') renderSchedule();
        if(id==='matches') renderMatches();
        if(id==='roster') renderRoster();
        if(id==='leave') renderLeaveList();
        if(id==='media') renderMedia();
        if(id==='admin') renderAdmin();
    }
    if(push) history.pushState({section:id},'',`#${id}`);
    document.querySelectorAll('nav a, #bottom-nav button').forEach(el => {
        el.classList.remove('active');
        if(el.dataset.section === id) el.classList.add('active');
    });
}

function initNavigation() {
    document.querySelectorAll('[data-section]').forEach(el => {
        el.onclick = (e) => { 
            e.preventDefault(); 
            navigateTo(el.dataset.section); 
            document.body.classList.remove('sidebar-open'); 
        }
    });
    const menu = document.getElementById('menu-toggle');
    if(menu) menu.onclick = () => document.body.classList.toggle('sidebar-open');
    const over = document.getElementById('overlay');
    if(over) over.onclick = () => document.body.classList.remove('sidebar-open');
}

document.addEventListener('DOMContentLoaded', () => {
  checkAppVersion();
  loadAllData();
  initNavigation();
  
  const bindSearch = (id, fn) => { const el = document.getElementById(id); if(el) el.oninput = fn; };
  bindSearch('schedule-search', renderSchedule);
  bindSearch('roster-search', renderRoster);
  bindSearch('match-keyword', renderMatches);
  const bindCheck = (id, fn) => { const el = document.getElementById(id); if(el) el.onchange = fn; };
  bindCheck('filter-singles', renderMatches);
  bindCheck('filter-doubles', renderMatches);
  
  const hash = location.hash.replace('#','') || 'home';
  if(hash) navigateTo(hash, false);

  window.onscroll = () => {
      const btn = document.getElementById('back-to-top');
      if (btn) btn.classList.toggle('show', window.scrollY > 300);
  };
});