// script.js - v7.0 (Roster Sync, Match Update, Full Edit)

// === 1. 設定區 ===
const SPREADSHEET_ID = '1mRcCNQSlTVwRRy7u9Yhx9knsw_0ZUyI0p6dMFgO-6os';
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// === 2. 全域變數 ===
let announcements = [], schedule = {}, players = [], staff = [], matches = [], leaveRequestsData = [];
let adminLoggedIn = false;
let navStack = [];

const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = [
  '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00',
  '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
  '15:00-16:00', '16:00-17:00'
];

// === 3. 初始化 ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initNavigation();
  
  // 綁定排程搜尋
  const scheduleSearch = document.getElementById('schedule-search');
  if (scheduleSearch) {
    scheduleSearch.addEventListener('input', () => {
      if (!document.getElementById('schedule').classList.contains('hidden')) renderSchedule();
    });
  }

  // Hero Button
  const heroBtn = document.getElementById('hero-btn');
  if (heroBtn) heroBtn.addEventListener('click', () => navigateTo('schedule'));

  // 初始路由
  const initial = (location.hash ? location.hash.replace('#', '') : 'home') || 'home';
  history.replaceState({ section: initial }, '', '#' + initial);
  navStack = [initial];
  updateBackButton();
  navigateTo(initial, false);

  // RWD
  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      const bottomNav = document.getElementById('bottom-nav');
      if (bottomNav) {
        if (window.innerWidth < 768) bottomNav.classList.remove('hidden');
        else bottomNav.classList.add('hidden');
      }
    }
  });
  
  // 管理員登入
  const loginBtn = document.getElementById('admin-login-btn');
  if (loginBtn) {
      loginBtn.onclick = async () => {
          const pwd = document.getElementById('admin-password').value.trim();
          if(!pwd) return;
          loginBtn.textContent = '驗證中...'; loginBtn.disabled = true;
          try {
            const res = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({action:'check_auth', password:pwd})});
            const r = await res.json();
            if(r.success) { 
                adminLoggedIn = true; 
                document.getElementById('admin-password').value = pwd; 
                renderAdmin(); 
                showToast('登入成功'); 
            } else {
                document.getElementById('admin-login-error')?.classList.remove('hidden');
                showToast('密碼錯誤');
            }
          } catch(e) { showToast('連線錯誤'); } 
          finally { loginBtn.textContent = '登入'; loginBtn.disabled = false; }
      };
  }
});

// === 4. 資料載入 ===
async function loadAllData() {
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_all_data`);
    const result = await response.json();
    const data = normalizeData(result);

    announcements = data.announcements || [];
    players = data.players || [];
    staff = data.staff || [];
    matches = data.matches || [];
    leaveRequestsData = data.leaveRequests || [];
    window.heroConfig = data.hero || {};

    schedule = {};
    weekdays.forEach(d => { schedule[d] = {}; defaultSlots.forEach(s => schedule[d][s] = []); });
    (data.schedules || []).forEach(item => {
      if (schedule[item.date] && schedule[item.date][item.slot]) {
        schedule[item.date][item.slot].push(item);
      }
    });

    console.log('Data Loaded:', data);
  } catch (e) {
    console.error('Load Error', e);
    showToast('連線異常，請檢查網路');
  } finally {
    const loader = document.getElementById('app-loader');
    if (loader) { loader.style.opacity = '0'; setTimeout(() => loader.remove(), 500); }
  }
}

// === 資料正規化 (關鍵修復 undefined) ===
function normalizeData(rawData) {
  const players = (rawData.players || []).map(r => ({
    rowId: r.rowId, id: r.player_id, name: r.student_name, nickname: r.nickname||'',
    grade: r.grade||'', class: r.class||'', paddle: r.paddle||'', 
    hand: r.hand||'', style: r.play_style||'', isActive: String(r.is_active||'TRUE').toUpperCase()
  }));

  const scheduleData = (rawData.training_schedule || []).map(r => ({
    rowId: r.rowId, date: r.weekday, slot: r.slot, table: r.table_no,
    coach: { name: r.coach_id }, playerA: { name: r.player_a_id }, playerB: { name: r.player_b_id }, remark: r.note
  }));

  const matches = (rawData.matches || []).map(r => ({
    rowId: r.rowId, date: formatDate(r.match_date), type: r.match_type,
    // 對外賽對手可能是純文字，這裡不做 filter(x=>x) 以免空字串造成對齊問題
    players: [r.player1_id, r.player2_id], 
    opponents: [r.opponent1, r.opponent2],
    score: r.game_score, sets: r.set_scores, video: { url: r.media_url }
  }));

  // ★ Fix 4: 請假欄位對應增強
  const leaveRequests = (rawData.leave_requests || []).map(r => ({
    rowId: r.rowId,
    // 嘗試讀取多種可能的欄位名稱
    name: r.created_by_email || r.name || r['姓名'] || '未知', 
    date: formatDate(r.leave_date || r.date),
    slot: r.slot || '', 
    reason: r.reason || '', 
    status: r.status || 'pending'
  }));

  return {
    hero: rawData.hero||{}, announcements: rawData.announcements||[],
    players, schedules: scheduleData, staff: rawData.staff||[], matches, leaveRequests
  };
}

// === 5. API 請求 ===
async function sendToGasWithAuth(action, payload) {
    let password = payload.password || document.getElementById('admin-password')?.value;
    if (action !== 'check_auth' && !password) {
        password = prompt('請輸入管理密碼確認操作：');
        if (!password) return false;
    }
    showToast('處理中...');
    try {
        const response = await fetch(GAS_API_URL, { method: 'POST', body: JSON.stringify({ action, payload, password }) });
        const result = await response.json();
        if(result.success) {
            showToast(result.message);
            if (action !== 'check_auth') await loadAllData(); 
            // 刷新畫面
            if(action === 'update_config') renderHome();
            if(action.includes('leave')) { showAdminLeaveList(); renderLeaveList(); }
            if(action.includes('player')) { filterAdminPlayerList(); renderRoster(); }
            if(action.includes('schedule')) { showAdminScheduleList(); renderSchedule(); }
            if(action.includes('match')) { showAdminMatchList(); renderMatches(); }
            return true;
        } else {
            showToast('失敗: ' + result.message);
            return false;
        }
    } catch(e) { showToast('連線錯誤'); return false; }
}
function sendToGas(act, pl) { return sendToGasWithAuth(act, pl); }

// === 6. 導航 ===
function initNavigation() {
  document.querySelector('nav#sidebar')?.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-section]');
      if (link) {
        e.preventDefault(); navigateTo(link.dataset.section);
        if (window.innerWidth < 768) closeSidebar();
      }
  });
  document.getElementById('bottom-nav')?.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) navigateTo(btn.dataset.section);
  });
  const toggle = (e) => { e.preventDefault(); e.stopPropagation(); toggleSidebar(); };
  document.getElementById('menu-toggle')?.addEventListener('click', toggle);
  document.querySelector('header h1')?.addEventListener('click', toggle);
  
  document.getElementById('overlay')?.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) closeSidebar(); else hideModal();
  });
  document.getElementById('back-button')?.addEventListener('click', goBack);
  window.addEventListener('popstate', (e) => {
    navigateTo((e.state && e.state.section) ? e.state.section : 'home', false);
    if(navStack.length > 1) navStack.pop(); updateBackButton();
  });
}
function openSidebar() { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() { if (document.body.classList.contains('sidebar-open')) closeSidebar(); else openSidebar(); }
function navigateTo(targetId, pushState = true) {
  document.querySelectorAll('main > section').forEach(sec => { sec.classList.add('hidden'); sec.classList.remove('active'); });
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden'); target.classList.add('active');
    if (targetId === 'home') renderHome();
    if (targetId === 'roster') renderRoster(); // Fix 1: Trigger roster render
    if (targetId === 'matches') renderMatches();
    if (targetId === 'admin') renderAdmin();
  }
  document.querySelectorAll('.active[data-section]').forEach(el => el.classList.remove('active'));
  document.querySelector(`nav#sidebar a[data-section="${targetId}"]`)?.classList.add('active');
  document.querySelector(`#bottom-nav button[data-section="${targetId}"]`)?.classList.add('active');
  if (pushState && navStack[navStack.length-1] !== targetId) {
    history.pushState({ section: targetId }, '', '#' + targetId); navStack.push(targetId); updateBackButton();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
function updateBackButton() {
  const btn = document.getElementById('back-button');
  if(btn) navStack.length > 1 ? btn.classList.remove('hidden') : btn.classList.add('hidden');
}
function goBack() { if(navStack.length > 1) history.back(); }

// === 7. 頁面渲染 ===

// Fix 1: 前台名冊 (使用後台版型)
function renderRoster() {
  const pd = document.getElementById('roster-players');
  const sd = document.getElementById('roster-staff'); // Staff 暫時隱藏或保持原樣? 假設只改球員
  if(!pd) return;
  pd.innerHTML = ''; 
  if(sd) sd.innerHTML = ''; // 清空 Staff

  // 教練 (保持簡單卡片)
  staff.forEach(s => {
      if(sd) sd.innerHTML += `<div class="card" style="padding:15px; display:flex; align-items:center; gap:15px;"><div style="background:#eee;width:50px;height:50px;border-radius:50%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-user-tie"></i></div><div><h4 style="margin:0">${escapeHtml(s.name)}</h4><small>教練</small></div></div>`;
  });

  const keyword = (document.getElementById('roster-search')?.value || '').toLowerCase();

  // 排序：年級 > 班級
  const sorted = players.filter(p => p.isActive !== 'FALSE').slice().sort((a,b) => {
      const ga = Number(a.grade)||99, gb = Number(b.grade)||99;
      if(ga !== gb) return ga - gb;
      return (a.class||'').localeCompare(b.class||'', 'zh-Hant');
  });

  const filtered = sorted.filter(p => !keyword || [p.name, p.grade, p.class, p.paddle].some(s => String(s).toLowerCase().includes(keyword)));

  if(filtered.length === 0) { pd.innerHTML = '<div style="text-align:center;color:#888;">無符合資料</div>'; return; }

  filtered.forEach(p => {
      const card = document.createElement('div'); 
      card.className = 'player-card'; // 使用 styles.css 的樣式
      const gradeClass = `${p.grade?p.grade+'年':''} ${p.class?p.class+'班':''}`.trim();
      
      card.innerHTML = `
        <div class="player-header" onclick="this.parentElement.classList.toggle('expanded')">
            <div class="player-info-main">
                <span class="player-name">${escapeHtml(p.name)}</span>
                <span class="player-class">${gradeClass || '隊員'}</span>
            </div>
            <i class="fas fa-chevron-down toggle-icon"></i>
        </div>
        <div class="player-details">
            <div class="detail-grid">
                <div><span class="detail-label">暱稱:</span> ${escapeHtml(p.nickname || '-')}</div>
                <div><span class="detail-label">性別:</span> ${escapeHtml(p.gender || '-')}</div>
                <div><span class="detail-label">膠皮:</span> ${escapeHtml(p.paddle || '-')}</div>
                <div><span class="detail-label">持拍:</span> ${escapeHtml(p.hand || '-')}</div>
                <div style="grid-column:1/-1"><span class="detail-label">打法:</span> ${escapeHtml(p.style || '-')}</div>
            </div>
        </div>`;
      pd.appendChild(card);
  });
}

// Home & Others (Standard)
function renderHome() {
  const bg = window.heroConfig?.hero_bg_url;
  const hero = document.querySelector('#home .hero-bg-placeholder');
  if(hero && bg) { hero.style.backgroundImage = `url(${convertDriveLink(bg)})`; hero.style.backgroundSize = 'cover'; }
  const annDiv = document.getElementById('home-announcements');
  if(annDiv) {
      annDiv.innerHTML = '';
      announcements.slice(0, 3).forEach(i => {
          const c=document.createElement('div');c.className='card';c.innerHTML=`<div style="display:flex;justify-content:space-between"><h4 style="margin:0;color:var(--primary-color)">${escapeHtml(i.title)}</h4><small>${i.date}</small></div><p>${escapeHtml(i.content).substring(0,60)}...</p>`;
          c.onclick=()=>showAnnouncementDetail(i); annDiv.appendChild(c);
      });
  }
  const leaveDiv = document.getElementById('home-leave-overview');
  if(leaveDiv) {
      leaveDiv.innerHTML = '';
      const today = new Date().toISOString().split('T')[0];
      const tl = leaveRequestsData.filter(l=>l.date===today);
      if(tl.length===0) leaveDiv.innerHTML='<div class="card" style="text-align:center;color:#888">今日無請假</div>';
      else tl.forEach(l=>{
          const c=document.createElement('div');c.className='card';c.style.cssText='padding:10px;border-left:4px solid #e74c3c';
          c.innerHTML=`<div style="display:flex;justify-content:space-between"><strong>${escapeHtml(l.name)}</strong><span>${escapeHtml(l.slot)}</span></div><small>${escapeHtml(l.reason)}</small>`;
          leaveDiv.appendChild(c);
      });
  }
}
function renderAnnouncements() { 
    const div = document.getElementById('announcement-list'); if(!div)return; div.innerHTML='';
    announcements.forEach(i=>{ const c=document.createElement('div');c.className='card';c.innerHTML=`<h4>${i.title}</h4><p>${i.content}</p>`;c.onclick=()=>showAnnouncementDetail(i);div.appendChild(c);});
}
function showAnnouncementDetail(item) {
    const m = document.getElementById('announcement-detail');
    m.innerHTML = `<button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button><h3>${escapeHtml(item.title)}</h3><p>${item.date}</p><div>${item.content.replace(/\n/g,'<br>')}</div>`;
    document.body.classList.add('modal-open'); m.classList.add('active');
}
function hideModal() { document.querySelectorAll('.modal').forEach(m=>{m.classList.remove('active');m.innerHTML=''}); document.body.classList.remove('modal-open'); document.getElementById('player-analysis')?.classList.add('hidden'); }

// Schedule
function renderSchedule() {
    const container = document.getElementById('schedule-container'); if(!container) return; container.innerHTML = '';
    const query = (document.getElementById('schedule-search')?.value||'').toLowerCase();
    weekdays.forEach((day, idx) => {
        let hasMatch = false;
        defaultSlots.forEach(s => { if(schedule[day]?.[s]?.some(e => !query || JSON.stringify(e).toLowerCase().includes(query))) hasMatch = true; });
        if(query && !hasMatch) return;
        const header = document.createElement('div'); header.className = 'accordion-header';
        header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-down"></i>`;
        const content = document.createElement('div'); content.className = 'accordion-content';
        const isToday = (idx + 1) === new Date().getDay() || (idx===6 && new Date().getDay()===0);
        if(isToday || query) { content.classList.add('show'); header.classList.add('active'); }
        header.onclick = () => { content.classList.toggle('show'); header.classList.toggle('active'); };
        container.appendChild(header); container.appendChild(content);
        defaultSlots.forEach(slot => {
            const entries = schedule[day]?.[slot] || [];
            const matched = entries.filter(e => !query || JSON.stringify(e).toLowerCase().includes(query));
            if(matched.length === 0) return;
            content.innerHTML += `<div class="time-slot-header">${slot}</div>`;
            const grid = document.createElement('div'); grid.className = 'compact-grid';
            matched.forEach(e => {
                const c = document.createElement('div'); c.className = 'compact-card';
                c.innerHTML = `<div class="table-badge">T${e.table}</div><div class="coach-name">${e.coach?.name||''}</div><div class="players">${e.playerA?.name||''}<br>${e.playerB?.name||''}</div>`;
                grid.appendChild(c);
            });
            content.appendChild(grid);
        });
    });
}

// Leave
function renderLeave() {
    renderLeaveList();
    const form = document.getElementById('leave-form');
    if(form) {
        form.onsubmit = async (e) => {
            e.preventDefault();
            await sendToGas('add_leave', {
                name: document.getElementById('leave-name').value,
                date: document.getElementById('leave-date').value,
                slot: document.getElementById('leave-slot').value,
                reason: document.getElementById('leave-reason').value
            });
            form.reset();
        };
    }
}
function renderLeaveList() {
    const div = document.getElementById('leave-list'); if(!div) return; div.innerHTML = '';
    leaveRequestsData.forEach(l => {
        const c=document.createElement('div');c.className='leave-item';
        c.innerHTML=`<div class="leave-item-header"><span>${escapeHtml(l.name)}</span><span>${l.date} ${l.slot}</span></div><p>${l.reason}</p>`;
        div.appendChild(c);
    });
}

// Matches
function renderMatches() {
    const div = document.getElementById('match-list'); if(!div) return; div.innerHTML = '';
    const key = (document.getElementById('match-keyword')?.value||'').toLowerCase();
    matches.filter(m => !key || JSON.stringify(m).toLowerCase().includes(key)).forEach(m => {
        const c=document.createElement('div');c.className='match-card';
        const pNames = m.players.map(id => players.find(p=>p.id==id)?.name||id).join(',');
        const oNames = m.opponents.join(',');
        c.innerHTML=`<div class="match-card-header"><span>${m.type}</span><span>${m.date}</span></div><div style="display:flex;justify-content:space-between"><div>${pNames} vs ${oNames}</div><b>${m.score}</b></div>`;
        c.onclick=()=>showMatchDetail(m); div.appendChild(c);
    });
}
function showMatchDetail(m) {
    const modal = document.getElementById('player-analysis');
    const pNames = m.players.map(id => players.find(p=>p.id==id)?.name||id).join(',');
    const oNames = m.opponents.join(',');
    modal.innerHTML = `<button class="btn-close-absolute" onclick="document.getElementById('player-analysis').classList.add('hidden')"><i class="fas fa-times"></i></button><h3>${m.date}</h3><p>${pNames} vs ${oNames}</p><p>比分: ${m.score}</p><p>局分: ${m.sets}</p>${m.video?.url?`<a href="${m.video.url}" target="_blank">影片</a>`:''}`;
    modal.classList.remove('hidden');
}

// === 8. 管理後台 ===
function renderAdmin() {
    if(!adminLoggedIn) { document.getElementById('admin-login').classList.remove('hidden'); document.getElementById('admin-dashboard').classList.add('hidden'); return; }
    document.getElementById('admin-login').classList.add('hidden'); document.getElementById('admin-dashboard').classList.remove('hidden');
    
    // Fix 2: 綁定所有按鈕
    document.getElementById('admin-add-announcement').onclick = renderAdminAnnouncementForm;
    document.getElementById('admin-view-leave').onclick = showAdminLeaveList;
    document.getElementById('admin-manage-players').onclick = showAdminPlayerList;
    // ★ 關鍵修復：綁定排程管理
    const btnSch = document.getElementById('admin-manage-schedule'); if(btnSch) btnSch.onclick = showAdminScheduleList;
    const btnMatch = document.getElementById('admin-manage-matches'); if(btnMatch) btnMatch.onclick = showAdminMatchList;
    document.getElementById('admin-settings').onclick = showAdminSettings;
}

// 8-1. 公告
function renderAdminAnnouncementForm() { 
    document.getElementById('admin-content').innerHTML = `
        <div class="admin-form-card"><h3>新增公告</h3><form id="af">
        <div class="admin-form-group"><label>標題</label><input id="at" class="admin-input" required></div>
        <div class="admin-form-group"><label>日期</label><input type="date" id="ad" class="admin-input" required value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="admin-form-group"><label>內容</label><textarea id="ac" class="admin-textarea" rows="4" required></textarea></div>
        <button class="hero-btn" style="width:100%">發布</button></form></div>`;
    document.getElementById('af').onsubmit = (e) => {
        e.preventDefault();
        sendToGasWithAuth('add_announcement', {
            title: document.getElementById('at').value,
            date: document.getElementById('ad').value,
            content: document.getElementById('ac').value
        }).then(() => document.getElementById('af').reset());
    };
}

// 8-2. 請假管理 (Fix 4 & 5: Undefined & Full Edit)
function showAdminLeaveList() {
    const c = document.getElementById('admin-content');
    c.innerHTML = '<h4>請假管理</h4><div id="all" class="leave-list-container"></div>';
    const list = document.getElementById('all');
    if(leaveRequestsData.length === 0) { list.innerHTML='無資料'; return; }
    
    leaveRequestsData.forEach(l => {
        const d = document.createElement('div'); d.className='leave-item';
        d.innerHTML = `
            <div class="leave-item-header">
                <span class="leave-item-name">${escapeHtml(l.name)}</span>
                <span class="leave-item-date">${l.date} ${l.slot}</span>
            </div>
            <div class="leave-item-reason">${escapeHtml(l.reason)}</div>
            <div class="leave-item-actions">
                <button class="action-btn edit">編輯</button>
                <button class="action-btn delete">刪除</button>
            </div>`;
        // 綁定編輯 (開啟完整表單)
        d.querySelector('.edit').onclick = () => renderAdminLeaveForm(l);
        d.querySelector('.delete').onclick = () => confirmDel('delete_leave', l.rowId, l.name);
        list.appendChild(d);
    });
}

// 新增：請假編輯表單
function renderAdminLeaveForm(l) {
    document.getElementById('admin-content').innerHTML = `
        <div class="admin-form-card"><h3>編輯請假</h3><form id="alf">
        <div class="admin-form-group"><label>姓名</label><input id="ln" class="admin-input" value="${l.name}"></div>
        <div class="admin-form-group"><label>日期</label><input type="date" id="ld" class="admin-input" value="${l.date}"></div>
        <div class="admin-form-group"><label>時段</label><select id="ls" class="admin-select">${defaultSlots.map(s=>`<option ${l.slot==s?'selected':''}>${s}</option>`).join('')}</select></div>
        <div class="admin-form-group"><label>原因</label><input id="lr" class="admin-input" value="${l.reason}"></div>
        <button class="hero-btn" style="width:100%">儲存</button></form></div>`;
    
    document.getElementById('alf').onsubmit = (e) => {
        e.preventDefault();
        sendToGasWithAuth('update_leave', {
            rowId: l.rowId,
            name: document.getElementById('ln').value,
            date: document.getElementById('ld').value,
            slot: document.getElementById('ls').value,
            reason: document.getElementById('lr').value
        }).then(showAdminLeaveList);
    };
}

// 8-3. 名冊 (同前)
function showAdminPlayerList() { 
    const c = document.getElementById('admin-content');
    c.innerHTML = `<div style="display:flex;justify-content:space-between;margin-bottom:10px"><h4>名冊</h4><button class="hero-btn" onclick="renderAdminPlayerForm()"><i class="fas fa-plus"></i></button></div><input id="aps" class="admin-input" oninput="filterAdminPlayerList()" placeholder="搜尋..."><div id="apl"></div>`;
    filterAdminPlayerList();
}
function filterAdminPlayerList() {
    const k = (document.getElementById('aps')?.value||'').trim().toLowerCase();
    const list = document.getElementById('apl'); list.innerHTML='';
    players.slice().sort((a,b)=>(Number(a.grade)||99)-(Number(b.grade)||99)||(a.class||'').localeCompare(b.class||'')).filter(p=>!k||[p.name,p.paddle,p.class].some(s=>s&&s.includes(k))).forEach(p=>{
        const d=document.createElement('div');d.className='player-card';
        d.innerHTML=`<div class="player-header" onclick="this.parentElement.classList.toggle('expanded')"><div class="player-info-main"><span>${p.name}</span><span>${p.grade}年${p.class}班</span></div><i class="fas fa-chevron-down toggle-icon"></i></div><div class="player-details"><p>膠皮:${p.paddle} 打法:${p.style}</p><div class="leave-item-actions"><button class="action-btn edit">編輯</button><button class="action-btn delete">刪除</button></div></div>`;
        d.querySelector('.edit').onclick=(e)=>{e.stopPropagation();renderAdminPlayerForm(p);};
        d.querySelector('.delete').onclick=(e)=>{e.stopPropagation();confirmDel('delete_player',p.rowId,p.name);};
        list.appendChild(d);
    });
}
function renderAdminPlayerForm(p={}) { 
    const isEdit=!!p.rowId; document.getElementById('admin-content').innerHTML = `<div class="admin-form-card"><h3>${isEdit?'編輯':'新增'}</h3><form id="apf"><input id="pn" value="${p.name||''}" class="admin-input" placeholder="姓名" required><input id="pg" value="${p.grade||''}" class="admin-input" placeholder="年級"><input id="pc" value="${p.class||''}" class="admin-input" placeholder="班級"><input id="pp" value="${p.paddle||''}" class="admin-input" placeholder="膠皮"><button class="hero-btn" style="width:100%;margin-top:10px">儲存</button></form></div>`;
    document.getElementById('apf').onsubmit=(e)=>{e.preventDefault(); sendToGasWithAuth('save_player', {rowId:p.rowId, name:document.getElementById('pn').value, grade:document.getElementById('pg').value, class:document.getElementById('pc').value, paddle:document.getElementById('pp').value, isActive:'TRUE'}).then(showAdminPlayerList);}
}

// 8-4. 排程 (同前)
function showAdminScheduleList() { 
    document.getElementById('admin-content').innerHTML = '<div style="display:flex;justify-content:space-between"><h4>排程</h4><button class="hero-btn" onclick="renderAdminScheduleForm()">+</button></div><div id="asl" class="leave-list-container"></div>';
    const flat=[]; weekdays.forEach(d=>defaultSlots.forEach(s=>{if(schedule[d]?.[s]) schedule[d][s].forEach(i=>flat.push({...i,day:d,slot:s}))}));
    flat.forEach(i=>{ const d=document.createElement('div');d.className='leave-item'; d.innerHTML=`<div class="leave-item-header"><span>${i.day} ${i.slot}</span></div><p>T${i.table} ${i.playerA?.name} vs ${i.playerB?.name}</p><div class="leave-item-actions"><button class="action-btn delete">刪除</button></div>`; d.querySelector('.delete').onclick=()=>confirmDel('delete_schedule',i.rowId,'排程'); document.getElementById('asl').appendChild(d); });
}
function renderAdminScheduleForm() { 
    const pOpts = players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    document.getElementById('admin-content').innerHTML=`<div class="admin-form-card"><h3>新增排程</h3><form id="asf"><select id="sd" class="admin-select">${weekdays.map(d=>`<option>${d}</option>`).join('')}</select><select id="ss" class="admin-select">${defaultSlots.map(s=>`<option>${s}</option>`).join('')}</select><input id="st" class="admin-input" placeholder="桌次"><select id="spa" class="admin-select"><option value="">選手A</option>${pOpts}</select><select id="spb" class="admin-select"><option value="">選手B</option>${pOpts}</select><button class="hero-btn" style="width:100%">儲存</button></form></div>`;
    document.getElementById('asf').onsubmit=(e)=>{e.preventDefault(); sendToGasWithAuth('save_schedule',{weekday:document.getElementById('sd').value, slot:document.getElementById('ss').value, table:document.getElementById('st').value, playerAId:document.getElementById('spa').value, playerBId:document.getElementById('spb').value}).then(showAdminScheduleList);};
}

// 8-5. 比賽 (Fix 3: 對外賽欄位)
function showAdminMatchList() { 
    const c=document.getElementById('admin-content'); c.innerHTML=`<div style="display:flex;justify-content:space-between"><h4>比賽紀錄</h4><button class="hero-btn" onclick="renderAdminMatchForm()">+</button></div><div id="aml" class="leave-list-container"></div>`;
    matches.forEach(m=>{
        const d=document.createElement('div');d.className='leave-item';
        d.innerHTML=`<div class="leave-item-header"><span>${m.date} ${m.type}</span></div><p>${m.players.map(x=>players.find(p=>p.id==x)?.name||x).join(',')} vs ${m.opponents.join(',')}</p><b>${m.score}</b><div class="leave-item-actions"><button class="action-btn delete">刪除</button></div>`;
        d.querySelector('.delete').onclick=()=>confirmDel('delete_match',m.rowId,'紀錄'); document.getElementById('aml').appendChild(d);
    });
}
function renderAdminMatchForm() {
    const pOpts = players.map(p=>`<option value="${p.id}">${p.name}</option>`).join('');
    // Fix: 對手改為 Input
    document.getElementById('admin-content').innerHTML = `
      <div class="admin-form-card"><h3>新增紀錄</h3><form id="amf">
        <div class="admin-form-group"><label>日期</label><input type="date" id="md" class="admin-input" value="${new Date().toISOString().split('T')[0]}"></div>
        <div class="admin-form-group"><label>賽制</label><select id="mt" class="admin-select" onchange="toggleM(this.value)"><option value="singles">單打</option><option value="doubles">雙打</option></select></div>
        <div style="display:grid;grid-template-columns:1fr 0.2fr 1fr;gap:5px;align-items:center">
            <div id="my-team"></div> <div>vs</div> <div id="op-team"></div>
        </div>
        <div class="admin-form-group"><label>賽事名稱/備註</label><input id="mn" class="admin-input" placeholder="例如: 教育盃"></div>
        <div class="admin-form-group"><label>總分</label><input id="ms" class="admin-input" placeholder="3:1"></div>
        <div class="admin-form-group"><label>局分</label><input id="mss" class="admin-input" placeholder="11-9, 8-11"></div>
        <div class="admin-form-group"><label>影片</label><input id="mv" class="admin-input"></div>
        <button class="hero-btn" style="width:100%">儲存</button></form></div>`;
    
    window.toggleM = (t) => {
        const myDiv = document.getElementById('my-team');
        const opDiv = document.getElementById('op-team');
        // 我方選單
        const pSel = `<select class="admin-select my-p"><option value="">我方</option>${pOpts}</select>`;
        // 對手輸入框 (Fix)
        const oInp = `<input class="admin-input op-p" placeholder="對手姓名">`;
        
        if(t==='singles') {
            myDiv.innerHTML = pSel; opDiv.innerHTML = oInp;
        } else {
            myDiv.innerHTML = pSel + pSel; opDiv.innerHTML = oInp + oInp;
        }
    };
    window.toggleM('singles');

    document.getElementById('amf').onsubmit = (e) => {
        e.preventDefault();
        const myPs = Array.from(document.querySelectorAll('.my-p')).map(s=>s.value);
        const opPs = Array.from(document.querySelectorAll('.op-p')).map(i=>i.value);
        sendToGasWithAuth('save_match', {
            date: document.getElementById('md').value, type: document.getElementById('mt').value,
            p1: myPs[0], p2: myPs[1]||'', o1: opPs[0], o2: opPs[1]||'',
            score: document.getElementById('ms').value, sets: document.getElementById('mss').value, 
            video: document.getElementById('mv').value
            // 備註欄位尚未傳送，若需要可加在 save_match payload
        }).then(showAdminMatchList);
    };
}

// Utils
function showAdminSettings() {
    const c = document.getElementById('admin-content');
    c.innerHTML = `<div class="admin-form-card"><h3>設定</h3><label>Hero圖片</label><input id="bg" class="admin-input" value="${window.heroConfig.hero_bg_url||''}"><button class="hero-btn" style="width:100%;margin-top:10px" onclick="saveConf()">儲存</button></div>`;
    window.saveConf = () => sendToGasWithAuth('update_config', {hero_bg_url: document.getElementById('bg').value});
}
function confirmDel(act, rid, n) { if(confirm(`刪除 ${n}?`)) sendToGasWithAuth(act, {rowId:rid}); }
function escapeHtml(s) { return s?String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'):''; }
function formatDate(d) { return d?new Date(d).toISOString().split('T')[0]:''; }
function convertDriveLink(u) { return u.includes('drive')?`https://drive.google.com/uc?export=view&id=${u.match(/[-\w]{25,}/)?.[0]}`:u; }
function showToast(m) { const t=document.createElement('div'); t.className='toast show'; t.innerHTML=m; document.body.appendChild(t); setTimeout(()=>t.remove(),3000); }