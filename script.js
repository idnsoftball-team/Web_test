// script.js - v10.0 Exact Mapping

// ★★★ 請替換成您最新的 Web App URL ★★★
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
    showToast("資料載入異常");
  } finally {
    if(loader) loader.style.display = 'none';
  }
}

// ★★★ 核心：依據您的 CSV 欄位名稱進行對應 ★★★
function normalizeData(data) {
  // 1. 公告 (announcements.csv: title, date, content)
  const anns = (data.announcements || []).map(r => ({
    title: r.title || '無標題',
    date: formatDate(r.date),
    content: r.content || ''
  }));

  // 2. 教練 (staff.csv: staff_id, name)
  const mapStaff = (data.staff || []).map(r => ({ 
    id: String(r.staff_id || r.id), 
    name: r.name || '教練' 
  }));

  // 3. 球員 (players.csv: player_id, student_name, grade, class)
  const mapPlayers = (data.players || []).map(r => ({
    id: String(r.player_id || r.id),
    name: r.student_name || r.name || '未命名', // CSV 欄位是 student_name
    grade: r.grade,
    class: r.class,
    paddle: r.paddle
  }));

  // 4. 排程 (training_schedule.csv: weekday, slot, table_no)
  const schedules = (data.training_schedule || []).map(r => {
    const cId = String(r.coach_id || '');
    const paId = String(r.player_a_id || '');
    const pbId = String(r.player_b_id || '');
    return {
      rowId: r.rowId,
      date: r.weekday || '', // CSV 欄位是 weekday
      slot: r.slot || '',
      table: r.table_no || '',
      coach: mapStaff.find(s => s.id === cId) || { name: cId },
      playerA: mapPlayers.find(p => p.id === paId) || { name: paId },
      playerB: mapPlayers.find(p => p.id === pbId) || { name: pbId },
      remark: r.note || ''
    };
  });
  
  // 5. 請假 (leave_requests.csv: created_by_email, leave_date, slot, reason)
  const leaves = (data.leave_requests || []).map(r => ({
    rowId: r.rowId,
    name: r.created_by_email || '未知', // CSV 用 email 欄位存姓名
    date: formatDate(r.leave_date),      // CSV 欄位是 leave_date
    slot: r.slot || '',
    reason: r.reason || ''
  }));

  // 6. 比賽 (matches.csv: match_date, match_type, game_score...)
  const mapMatches = (data.matches || []).map(r => ({
    rowId: r.rowId,
    date: formatDate(r.match_date), // CSV 欄位是 match_date
    type: (r.match_type || '').includes('雙') ? 'doubles' : 'singles',
    score: r.game_score || '',      // CSV 欄位是 game_score
    sets: r.set_scores || '',
    players: [r.player1_id, r.player2_id].filter(Boolean),
    opponents: [r.opponent1, r.opponent2].filter(Boolean),
    video: { url: r.media_url }
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

// === UI Renders ===
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
            <p style="margin-top:6px; font-size:0.9rem; color:#555; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.content)}</p>
          `;
          card.onclick = () => showAnnouncementDetail(item);
          homeAnn.appendChild(card);
        });
    }
  }
  renderLeaveList(); 
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
      <div class="match-score-header"><span>${m.date}</span><span>${m.type === 'singles' ? '單打' : '雙打'}</span></div>
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

function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if(sorted.length === 0) { listDiv.innerHTML = '<div style="text-align:center;padding:20px;">無公告</div>'; return; }
  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<div style="display:flex; justify-content:space-between; align-items:center;"><h4 style="margin:0;">${escapeHtml(item.title)}</h4><span style="font-size:0.8rem; color:#888;">${item.date}</span></div><p style="margin-top:8px; color:#555; font-size:0.95rem;">${escapeHtml(item.content)}</p>`;
    card.onclick = () => showAnnouncementDetail(item);
    listDiv.appendChild(card);
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
                grid.innerHTML += `<div class="compact-card"><div class="table-badge">T${e.table}</div><div class="coach-name">${escapeHtml(e.coach?.name || '')}</div><div class="players">${pText}</div></div>`;
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
    modal.innerHTML = `<button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button><h3 style="margin-top:10px; color:var(--primary-color);">${escapeHtml(item.title)}</h3><div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;"><i class="far fa-calendar-alt"></i> ${item.date}</div><div style="line-height:1.8; color:#333; font-size:0.95rem; white-space: pre-wrap;">${escapeHtml(item.content)}</div>`;
    document.body.classList.add('modal-open');
    modal.classList.add('active');
}
function hideModal() { document.querySelectorAll('.modal').forEach(m => { m.classList.remove('active'); m.innerHTML=''; }); document.body.classList.remove('modal-open'); }
function showMatchDetail(m) {
    const modal = document.getElementById('player-analysis');
    const pNames = m.players.map(getPlayerName).join(' & ');
    const oNames = m.opponents.map(getPlayerName).join(' & ');
    modal.innerHTML = `<button class="btn-close-absolute" onclick="document.getElementById('player-analysis').classList.add('hidden')"><i class="fas fa-times"></i></button><h3 style="margin:0 0 10px 0; color:var(--primary-color);">比賽詳情</h3><div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:10px;"><div style="font-weight:bold; font-size:1.1rem; margin-bottom:5px;">${escapeHtml(pNames)} <span style="color:#e74c3c">VS</span> ${escapeHtml(oNames)}</div><div style="color:#666; font-size:0.9rem;">${m.date} | ${m.type === 'singles' ? '單打' : '雙打'}</div><div style="margin-top:5px; font-weight:bold; color:var(--primary-dark); font-size:1.2rem;">比分: ${escapeHtml(m.score)}</div></div>${m.video && m.video.url ? `<div style="margin-top:10px;"><button class="hero-btn" style="width:100%;" onclick="window.open('${m.video.url}', '_blank')"><i class="fas fa-video"></i> 觀看影片</button></div>` : ''}`;
    modal.classList.remove('hidden');
}
function openVideoModal(ytId) {
    const modal = document.getElementById('announcement-detail');
    modal.innerHTML = `<button class="btn-close-absolute" onclick="hideModal()" style="color:white; z-index:100;"><i class="fas fa-times"></i></button><iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1" style="width:100%;height:100%;border:none;" allowfullscreen></iframe>`;
    modal.style.background='black'; modal.style.padding='0'; modal.classList.add('active'); document.body.classList.add('modal-open');
}
function getYouTubeID(url) { const match = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/); return (match&&match[1].length===11)?match[1]:null; }
function renderLeave() { renderLeaveList(); const f=document.getElementById('leave-form'); if(f) f.onsubmit=(e)=>{ e.preventDefault(); const p={ name:document.getElementById('leave-name').value, date:document.getElementById('leave-date').value, slot:document.getElementById('leave-slot').value, reason:document.getElementById('leave-reason').value }; sendToGas('add_leave',p).then(()=>f.reset()); }; }
async function sendToGas(action, payload) { const res=await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action,payload})}); const j=await res.json(); showToast(j.message); if(j.success) loadAllData(); }
function renderAdmin() { 
    if(!sessionStorage.getItem('admin_pwd')) { 
        document.getElementById('admin-login').classList.remove('hidden'); 
        document.getElementById('admin-dashboard').classList.add('hidden'); 
        document.getElementById('admin-login-btn').onclick=async()=>{ 
            const pwd = document.getElementById('admin-password').value;
            const res = await fetch(GAS_API_URL,{method:'POST',body:JSON.stringify({action:'check_auth',password:pwd})});
            const j = await res.json();
            if(j.success) { sessionStorage.setItem('admin_pwd',pwd); renderAdmin(); showToast('登入成功'); } else { showToast('密碼錯誤'); }
        }; 
    } else { 
        document.getElementById('admin-login').classList.add('hidden'); 
        document.getElementById('admin-dashboard').classList.remove('hidden'); 
    } 
}
function convertDriveLink(url) { if(!url) return ''; if(url.includes('googleusercontent')) return url; const m=url.match(/\/d\/([a-zA-Z0-9_-]+)/)||url.match(/id=([a-zA-Z0-9_-]+)/); return m?`https://drive.google.com/uc?export=view&id=${m[1]}`:url; }
function showToast(m){ const c=document.getElementById('toast-container'); if(!c)return; const t=document.createElement('div'); t.className='toast show'; t.innerHTML=m; c.appendChild(t); setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),500)},3000); }

document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
  const bindSearch = (id, fn) => { const el = document.getElementById(id); if(el) el.oninput = fn; };
  bindSearch('schedule-search', renderSchedule);
  bindSearch('roster-search', renderRoster);
  bindSearch('match-keyword', renderMatches);
  const bindCheck = (id, fn) => { const el = document.getElementById(id); if(el) el.onchange = fn; };
  bindCheck('filter-singles', renderMatches);
  bindCheck('filter-doubles', renderMatches);
  
  document.querySelectorAll('[data-section]').forEach(el => {
      el.onclick = (e) => { 
          e.preventDefault(); 
          const id = el.dataset.section;
          document.querySelectorAll('main>section').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
          document.getElementById(id).classList.remove('hidden');
          document.getElementById(id).classList.add('active');
          document.body.classList.remove('sidebar-open');
          
          if(id==='schedule') renderSchedule();
          if(id==='matches') renderMatches();
          if(id==='roster') renderRoster();
          if(id==='leave') renderLeaveList();
          if(id==='media') renderMedia();
          if(id==='admin') renderAdmin();
      }
  });
  document.getElementById('menu-toggle').onclick = () => document.body.classList.toggle('sidebar-open');
  document.getElementById('overlay').onclick = () => document.body.classList.remove('sidebar-open');
  
  const hash = location.hash.replace('#','') || 'home';
  if(hash) {
      document.querySelectorAll('main>section').forEach(s => { s.classList.add('hidden'); s.classList.remove('active'); });
      document.getElementById(hash)?.classList.remove('hidden');
      document.getElementById(hash)?.classList.add('active');
  }

  window.onscroll = () => {
      const btn = document.getElementById('back-to-top');
      if (btn) btn.classList.toggle('show', window.scrollY > 300);
  };
});