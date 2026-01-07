// script.js - v11.0 Fix Announcements & Admin UI

// ★★★ 請確認這是否為您最新部署的 GAS 網址 ★★★
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// Global Data
let announcements = [], schedule = {}, players = [], staff = [], matches = [], leaveRequestsData = [];
const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = ['17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'];

function initEmptySchedule() {
  schedule = {};
  weekdays.forEach(d => { schedule[d] = {}; defaultSlots.forEach(s => schedule[d][s] = []); });
}
initEmptySchedule();

// === 1. Data Loading ===
async function loadAllData() {
  const loader = document.getElementById('app-loader');
  try {
    const res = await fetch(`${GAS_API_URL}?action=get_all_data`);
    const data = await res.json();
    console.log("Raw Data:", data);

    const norm = normalizeData(data);
    
    announcements = norm.announcements;
    players = norm.players;
    staff = norm.staff;
    matches = norm.matches;
    leaveRequestsData = norm.leaveRequests;
    window.heroConfig = norm.hero;

    // 排程處理
    initEmptySchedule();
    norm.schedules.forEach(item => {
      const d = item.date, s = item.slot;
      if (!schedule[d]) schedule[d] = {};
      if (!schedule[d][s]) schedule[d][s] = [];
      schedule[d][s].push(item);
    });

    console.log("Normalized:", norm);
    renderHome(); // 載入後刷新首頁
  } catch (e) {
    console.error("Load Error", e);
    showToast("資料載入異常");
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

// === Data Normalization (依據 CSV 欄位) ===
function normalizeData(data) {
  // Helper to find value by multiple keys
  const getVal = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== "") return obj[k];
    }
    return "";
  };

  // 1. 公告
  const anns = (data.announcements || []).map(r => ({
    title: getVal(r, ['title', '標題', 'announcement_title']),
    date: formatDate(getVal(r, ['date', '日期', 'announcement_date'])),
    content: getVal(r, ['content', '內容', 'announcement_content'])
  })).filter(a => a.title);

  // 2. 教練
  const mapStaff = (data.staff || []).map(r => ({ 
    id: String(getVal(r, ['staff_id', 'id'])), 
    name: getVal(r, ['name', 'staff_name', '姓名']) || '教練'
  }));

  // 3. 球員
  const mapPlayers = (data.players || []).map(r => ({
    id: String(getVal(r, ['player_id', 'id'])),
    name: getVal(r, ['student_name', 'name', '姓名']),
    grade: getVal(r, ['grade', '年級']),
    class: getVal(r, ['class', '班級']),
    paddle: getVal(r, ['paddle', 'team_no'])
  }));

  // 4. 排程
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
      remark: getVal(r, ['note', 'remark', '備註'])
    };
  });
  
  // 5. 請假
  const leaves = (data.leave_requests || []).map(r => ({
    rowId: r.rowId,
    name: getVal(r, ['created_by_email', 'name', '姓名']) || '未知',
    date: formatDate(getVal(r, ['leave_date', 'date', '日期'])),
    slot: getVal(r, ['slot', '時段']),
    reason: getVal(r, ['reason', '事由'])
  }));

  // 6. 比賽
  const mapMatches = (data.matches || []).map(r => ({
    rowId: r.rowId,
    date: formatDate(getVal(r, ['match_date', 'date', '日期'])),
    type: getVal(r, ['match_type', 'type']).includes('雙') ? 'doubles' : 'singles',
    score: getVal(r, ['game_score', 'score', '比分']),
    sets: getVal(r, ['set_scores', 'sets']),
    players: [getVal(r, ['player1_id', 'p1']), getVal(r, ['player2_id', 'p2'])].filter(Boolean),
    opponents: [getVal(r, ['opponent1', 'o1']), getVal(r, ['opponent2', 'o2'])].filter(Boolean),
    video: { url: getVal(r, ['media_url', 'video', '影片']) }
  }));

  return {
    hero: data.hero || {},
    announcements: anns,
    staff: mapStaff,
    players: mapPlayers,
    schedules: schedules,
    leaveRequests: leaves,
    matches: mapMatches
  };
}

function formatDate(d) {
    if(!d) return '';
    if(d.includes && d.includes('T')) return d.split('T')[0];
    return d;
}

// === 2. Render Functions ===

function renderHome() {
  const bgUrl = window.heroConfig?.hero_bg_url;
  const heroBg = document.querySelector('#home .hero-bg-placeholder');
  if (heroBg && bgUrl) heroBg.style.backgroundImage = `url(${convertDriveLink(bgUrl)})`;

  const homeAnn = document.getElementById('home-announcements');
  if (homeAnn) {
    homeAnn.innerHTML = '';
    const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);
    if (sorted.length === 0) {
        homeAnn.innerHTML = '<div style="text-align:center;padding:15px;color:#999;">目前無最新動態</div>';
    } else {
        sorted.forEach(item => {
          const card = document.createElement('div');
          card.className = 'card';
          card.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:center;">
              <h4 style="margin:0; color:var(--primary-color);">${escapeHtml(item.title)}</h4>
              <span style="font-size:0.8rem; color:#888;">${item.date}</span>
            </div>
            <p style="margin-top:6px; font-size:0.9rem; color:#555; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
                ${escapeHtml(item.content)}
            </p>
          `;
          card.onclick = () => showAnnouncementDetail(item);
          homeAnn.appendChild(card);
        });
    }
  }
  renderLeaveList(); 
}

// ★★★ 關鍵修復：公告渲染函式，確保切換分頁時執行 ★★★
function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  
  if(sorted.length === 0) { listDiv.innerHTML = '<div style="text-align:center;padding:20px;">無公告</div>'; return; }

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0;">${escapeHtml(item.title)}</h4>
        <span style="font-size:0.8rem; color:#888;">${item.date}</span>
      </div>
      <p style="margin-top:8px; color:#555; font-size:0.95rem;">${escapeHtml(item.content)}</p>
    `;
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
        card.innerHTML = `
            <div class="leave-header-row"><span class="leave-name-large">${escapeHtml(item.name)}</span></div>
            <div class="leave-tags-row">
                <div class="tag-date"><i class="far fa-calendar-alt"></i> ${escapeHtml(d)}</div>
                <div class="tag-time"><i class="far fa-clock"></i> ${escapeHtml(item.slot)}</div>
            </div>
            <div class="leave-reason-box">${escapeHtml(item.reason)}</div>
        `;
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
    card.innerHTML = `
      <div class="match-score-header">
        <span>${m.date}</span>
        <span>${m.type === 'singles' ? '單打' : '雙打'}</span>
      </div>
      <div class="match-score-body">
        <div class="match-players-container">
           <div class="match-side"><span class="side-names">${escapeHtml(pNames)}</span></div>
           <div style="font-size:0.8rem;color:#ccc;">VS</div>
           <div class="match-side"><span class="side-names">${escapeHtml(oNames)}</span></div>
        </div>
        <div class="match-score-box">${escapeHtml(m.score)}</div>
      </div>
    `;
    card.onclick = () => showMatchDetail(m);
    div.appendChild(card);
  });
}

function renderRoster() {
  const pDiv = document.getElementById('roster-players');
  const sDiv = document.getElementById('roster-staff');
  if(!pDiv || !sDiv) return;
  pDiv.className = 'roster-grid'; sDiv.className = 'roster-grid';
  pDiv.innerHTML = ''; sDiv.innerHTML = '';
  const query = (document.getElementById('roster-search')?.value || '').toLowerCase();

  staff.forEach(s => {
    if(query && !s.name.includes(query)) return;
    sDiv.innerHTML += `<div class="roster-card-compact"><div class="roster-name">${escapeHtml(s.name)}</div><div class="roster-info">教練</div></div>`;
  });
  players.forEach(p => {
    const txt = [p.name, p.grade, p.class].join(' ');
    if(query && !txt.includes(query)) return;
    let info = (p.grade?p.grade+'年':'') + (p.class?p.class+'班':'');
    if(!info) info='學員';
    pDiv.innerHTML += `<div class="roster-card-compact"><div class="roster-name">${escapeHtml(p.name)}</div><div class="roster-info">${info}</div></div>`;
  });
}

function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if(!container) return;
  container.innerHTML = '';
  const query = (document.getElementById('schedule-search')?.value || '').toLowerCase();
  
  weekdays.forEach((day, idx) => {
    const slots = schedule[day] || {};
    let hasData = false;
    defaultSlots.forEach(s => { if(slots[s]?.length) hasData = true; });
    const header = document.createElement('div');
    header.className = 'accordion-header';
    const todayIdx = (new Date().getDay() + 6) % 7;
    const isOpen = (idx === todayIdx) || query;

    header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-${isOpen?'up':'down'}"></i>`;
    if(isOpen) header.classList.add('active');

    const content = document.createElement('div');
    content.className = `accordion-content ${isOpen ? 'show' : ''}`;

    if(!hasData && !query) {
        content.innerHTML = '<div style="padding:10px;text-align:center;color:#ccc;">本日無課</div>';
    } else {
        Object.keys(slots).forEach(slot => {
            const items = slots[slot].filter(e => {
                if(!query) return true;
                return JSON.stringify(e).toLowerCase().includes(query);
            });
            if(items.length === 0) return;

            content.innerHTML += `<div class="time-slot-header">${slot}</div>`;
            const grid = document.createElement('div');
            grid.className = 'compact-grid';
            items.forEach(e => {
                let pText = escapeHtml(e.playerA?.name || '');
                if(e.playerB && e.playerB.name) {
                    pText += `<br><span style="font-size:0.9em;color:#666">&</span><br>${escapeHtml(e.playerB.name)}`;
                }
                grid.innerHTML += `
                    <div class="compact-card">
                        <div class="table-badge">T${e.table}</div>
                        <div class="coach-name">${escapeHtml(e.coach?.name || '')}</div>
                        <div class="players">${pText}</div>
                    </div>
                `;
            });
            content.appendChild(grid);
        });
    }
    header.onclick = () => {
        header.classList.toggle('active');
        content.classList.toggle('show');
        header.querySelector('i').className = `fas fa-chevron-${content.classList.contains('show')?'up':'down'}`;
    };
    container.appendChild(header);
    container.appendChild(content);
  });
}

function renderMedia() {
    const container = document.getElementById('media-list');
    if (!container) return;
    container.innerHTML = '';
    const videos = matches.filter(m => m.video && m.video.url);
    if (videos.length === 0) { container.innerHTML = '<div style="grid-column:1/-1;text-align:center;color:#888;">暫無影音</div>'; return; }
    videos.forEach(m => {
        const ytId = getYouTubeID(m.video.url);
        const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : 'https://via.placeholder.com/320x180?text=Video';
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `<div class="video-thumb-container"><img src="${thumb}" class="video-thumb"><div class="play-icon-overlay"><i class="far fa-play-circle"></i></div></div><div class="video-info"><div class="video-title">${m.players.map(getPlayerName).join('/')} vs ${m.opponents.map(getPlayerName).join('/')}</div></div>`;
        card.onclick = () => { ytId ? openVideoModal(ytId) : window.open(m.video.url, '_blank'); };
        container.appendChild(card);
    });
}

// Utils
function getPlayerName(id) { const p = players.find(x => x.id === id); return p ? p.name : id; }
function escapeHtml(t) { return t ? String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;') : ''; }
function showAnnouncementDetail(item) {
    const modal = document.getElementById('announcement-detail');
    modal.innerHTML = `
        <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
        <h3 style="margin-top:10px; color:var(--primary-color);">${escapeHtml(item.title)}</h3>
        <div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;">
            <i class="far fa-calendar-alt"></i> ${item.date}
        </div>
        <div style="line-height:1.8; color:#333; font-size:0.95rem; white-space: pre-wrap;">${escapeHtml(item.content)}</div>
    `;
    document.body.classList.add('modal-open');
    modal.classList.add('active');
}
function hideModal() { document.querySelectorAll('.modal').forEach(m => { m.classList.remove('active'); m.innerHTML=''; }); document.body.classList.remove('modal-open'); }
function showMatchDetail(m) {
    const modal = document.getElementById('player-analysis');
    const pNames = m.players.map(getPlayerName).join(' & ');
    const oNames = m.opponents.map(getPlayerName).join(' & ');
    modal.innerHTML = `
        <button class="btn-close-absolute" onclick="document.getElementById('player-analysis').classList.add('hidden')"><i class="fas fa-times"></i></button>
        <h3 style="margin:0 0 10px 0; color:var(--primary-color);">比賽詳情</h3>
        <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:10px;">
             <div style="font-weight:bold; font-size:1.1rem; margin-bottom:5px;">${escapeHtml(pNames)} <span style="color:#e74c3c">VS</span> ${escapeHtml(oNames)}</div>
             <div style="color:#666; font-size:0.9rem;">${m.date} | ${m.type === 'singles' ? '單打' : '雙打'}</div>
             <div style="margin-top:5px; font-weight:bold; color:var(--primary-dark); font-size:1.2rem;">比分: ${escapeHtml(m.score)}</div>
        </div>
        ${m.video && m.video.url ? `<div style="margin-top:10px;"><button class="hero-btn" style="width:100%;" onclick="window.open('${m.video.url}', '_blank')"><i class="fas fa-video"></i> 觀看影片</button></div>` : ''}
    `;
    modal.classList.remove('hidden');
}
function openVideoModal(ytId) {
    const modal = document.getElementById('announcement-detail');
    modal.innerHTML = `<button class="btn-close-absolute" onclick="hideModal()" style="color:white; z-index:100;"><i class="fas fa-times"></i></button><iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`;
    modal.style.background='black'; modal.style.padding='0'; modal.classList.add('active'); document.body.classList.add('modal-open');
}
function getYouTubeID(url) { const match = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match&&match[1].length===11)?match[1]:null; }

function renderLeave() { 
    renderLeaveList(); 
    const f=document.getElementById('leave-form'); 
    if(f) f.onsubmit=(e)=>{ 
        e.preventDefault(); 
        const p={ 
            name:document.getElementById('leave-name').value, 
            date:document.getElementById('leave-date').value, 
            slot:document.getElementById('leave-slot').value, 
            reason:document.getElementById('leave-reason').value 
        }; 
        sendToGas('add_leave',p).then(()=>f.reset()); 
    }; 
}

// Login & Init
async function sendToGas(action, payload) { 
    const res=await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action,payload})}); 
    const j=await res.json(); 
    showToast(j.message); 
    if(j.success) loadAllData(); 
}

function renderAdmin() { 
    if(!sessionStorage.getItem('admin_pwd')) { 
        document.getElementById('admin-login').classList.remove('hidden'); 
        document.getElementById('admin-dashboard').classList.add('hidden'); 
        const loginBtn = document.getElementById('admin-login-btn');
        // ★★★ 關鍵優化：防止重複綁定與提供按鈕回饋 ★★★
        loginBtn.onclick = async () => { 
            const pwd = document.getElementById('admin-password').value;
            if(!pwd) return showToast('請輸入密碼');
            
            loginBtn.innerText = '驗證中...'; // 視覺回饋
            try {
                const res = await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action:'check_auth',password:pwd})});
                const j = await res.json();
                if(j.success) { 
                    sessionStorage.setItem('admin_pwd',pwd); 
                    renderAdmin(); 
                    showToast('登入成功'); 
                } else { 
                    showToast('密碼錯誤'); 
                }
            } catch(e) {
                showToast('連線失敗');
            } finally {
                loginBtn.innerText = '登入';
            }
        }; 
    } else { 
        document.getElementById('admin-login').classList.add('hidden'); 
        document.getElementById('admin-dashboard').classList.remove('hidden'); 
    } 
}

function convertDriveLink(url) { if(!url) return ''; if(url.includes('googleusercontent')) return url; const m=url.match(/\/d\/([a-zA-Z0-9_-]+)/)||url.match(/id=([a-zA-Z0-9_-]+)/); return m?`https://drive.google.com/uc?export=view&id=${m[1]}`:url; }
function showToast(m){ const c=document.getElementById('toast-container'); if(!c)return; const t=document.createElement('div'); t.className='toast show'; t.innerHTML=m; c.appendChild(t); setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),500)},3000); }

// ★★★ 關鍵修正：確保 navigateTo 包含所有分頁 ★★★
function navigateTo(id, push=true) {
    document.querySelectorAll('main>section').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
    const target = document.getElementById(id);
    if(target) {
        target.classList.remove('hidden'); 
        target.classList.add('active');
        
        if(id==='announcements') renderAnnouncements(); // ★ 補回這一行！
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