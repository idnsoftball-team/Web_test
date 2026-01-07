// script.js - Refactored v7.0 (Logic Fixes for Roster, Matches, Leave, Schedule)

const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// Global Data
let announcements = [], schedule = {}, players = [], staff = [], matches = [], leaveRequestsData = [];
let adminLoggedIn = false;

const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = ['17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00', '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00', '15:00-16:00', '16:00-17:00'];

// Init Schedule
function initEmptySchedule() {
  schedule = {};
  weekdays.forEach(d => { schedule[d] = {}; defaultSlots.forEach(s => schedule[d][s] = []); });
}
initEmptySchedule();

// === 1. Data Loading & Normalization ===
async function loadAllData() {
  const loader = document.getElementById('app-loader');
  try {
    const res = await fetch(`${GAS_API_URL}?action=get_all_data`, { cache: 'no-store' });
    const data = await res.json();

    // Normalize Data (Fixing Mapping Issues)
    const norm = normalizeData(data);

    announcements = norm.announcements;
    players = norm.players;
    staff = norm.staff;
    matches = norm.matches;
    leaveRequestsData = norm.leaveRequests;
    window.heroConfig = norm.hero;

    // Process Schedule
    initEmptySchedule();
    norm.schedules.forEach(item => {
      const d = item.date, s = item.slot;
      if (!schedule[d]) schedule[d] = {};
      if (!schedule[d][s]) schedule[d][s] = [];
      schedule[d][s].push(item);
    });

    console.log("Data Loaded & Normalized:", norm); // Debug log

    // If currently on a rendered page, refresh it after data load
    const active = document.querySelector('main > section.active')?.id;
    if (active === 'schedule') renderSchedule();
    if (active === 'matches') renderMatches();
    if (active === 'roster') renderRoster();
    if (active === 'leave') renderLeaveList();
    if (active === 'admin') renderAdmin();

  } catch (e) {
    console.error("Load Error", e);
    showToast("資料載入異常，請稍後再試");
  } finally {
    if (loader) loader.style.display = 'none';
  }
}

// 關鍵修正：資料對應函式
function normalizeData(data) {
  console.log("Raw Data from GAS:", data);

  // Staff Map
  const mapStaff = (data.staff || []).map(r => ({
    id: String(r.staff_id || r.id || ''),
    name: r.name || r.staff_name || '教練'
  }));

  // Player Map
  const mapPlayers = (data.players || []).map(r => ({
    id: String(r.player_id || r.id || ''),
    name: r.student_name || r.name || '未命名',
    grade: r.grade || '',
    class: r.class || '',
    paddle: r.paddle || r.team_no
  }));

  // Schedule Map (supports common Chinese headers to prevent mismatch)
  const schedules = (data.training_schedule || []).map(r => {
    const day = r.weekday || r.date || r.day || r.星期 || '';
    const slot = r.slot || r.time || r.時段 || '';
    const table = r.table_no || r.table || r.桌次 || '';

    const cId = String(r.coach_id || r.coachId || r.教練ID || '');
    const paId = String(r.player_a_id || r.playerAId || r.球員A_ID || r.球員A || '');
    const pbId = String(r.player_b_id || r.playerBId || r.球員B_ID || r.球員B || '');

    return {
      rowId: r.rowId,
      date: day,
      slot,
      table,
      coach: mapStaff.find(s => s.id === cId) || { name: cId },
      playerA: mapPlayers.find(p => p.id === paId) || { name: paId },
      playerB: mapPlayers.find(p => p.id === pbId) || { name: pbId },
      remark: r.note || r.remark || r.備註 || ''
    };
  });

  // Leave Requests Map (Fixing the missing Name/Date bug)
  // Backend keys: created_by_email, leave_date
  const leaves = (data.leave_requests || data.leaveRequests || []).map(r => ({
    rowId: r.rowId,
    name: r.created_by_email || r.name || r.姓名 || r.請假人 || '未知',
    date: r.leave_date || r.date || r.請假日期 || '',
    slot: r.slot || r.時段 || '',
    reason: r.reason || r.原因 || ''
  }));

  const normalized = {
    hero: data.hero || {},
    announcements: data.announcements || [],
    staff: mapStaff,
    players: mapPlayers,
    schedules,
    leaveRequests: leaves,
    matches: (data.matches || []).map(r => ({
      rowId: r.rowId,
      date: r.match_date || r.date || '',
      type: (r.match_type || r.type || '').includes('雙') ? 'doubles' : 'singles',
      score: r.game_score || r.score || '',
      sets: r.set_scores || r.sets || '',
      players: [r.player1_id || r.p1, r.player2_id || r.p2].filter(Boolean),
      opponents: [r.opponent1 || r.o1, r.opponent2 || r.o2].filter(Boolean),
      video: { url: r.media_url || r.video || '' }
    }))
  };

  console.log("Normalized Schedules:", schedules);
  return normalized;
}

// === 2. Render Functions ===

// Roster: Compact Grid (3 cols, Name + Grade/Class only)
function renderRoster() {
  const pDiv = document.getElementById('roster-players');
  const sDiv = document.getElementById('roster-staff');
  if (!pDiv || !sDiv) return;

  pDiv.className = 'roster-grid';
  sDiv.className = 'roster-grid';
  pDiv.innerHTML = '';
  sDiv.innerHTML = '';

  const query = (document.getElementById('roster-search')?.value || '').trim().toLowerCase();

  // Render Staff
  staff.forEach(s => {
    const name = String(s.name || '').trim();
    if (query && !name.toLowerCase().includes(query)) return;
    sDiv.innerHTML += `
      <div class="roster-card-compact">
        <div class="roster-name">${escapeHtml(name)}</div>
        <div class="roster-info">教練</div>
      </div>`;
  });

  // Render Players
  players.forEach(p => {
    const txt = [p.name, p.grade, p.class].join(' ').toLowerCase();
    if (query && !txt.includes(query)) return;

    let info = '';
    if (p.grade) info += `${escapeHtml(p.grade)}年`;
    if (p.class) info += `${escapeHtml(p.class)}班`;
    if (!info) info = '學員';

    pDiv.innerHTML += `
      <div class="roster-card-compact">
        <div class="roster-name">${escapeHtml(p.name)}</div>
        <div class="roster-info">${info}</div>
      </div>`;
  });
}

// Matches: Scoreboard Style (Better layout)
function renderMatches() {
  const div = document.getElementById('match-list');
  if (!div) return;
  div.innerHTML = '';

  const key = (document.getElementById('match-keyword')?.value || '').trim().toLowerCase();
  const showS = document.getElementById('filter-singles')?.checked ?? true;
  const showD = document.getElementById('filter-doubles')?.checked ?? true;

  const list = matches.filter(m => {
    if (m.type === 'singles' && !showS) return false;
    if (m.type === 'doubles' && !showD) return false;
    const txt = [...(m.players || []), ...(m.opponents || [])].map(getPlayerName).join(' ').toLowerCase();
    return !key || txt.includes(key);
  });

  if (list.length === 0) {
    div.innerHTML = '<div style="text-align:center;color:#999;padding:20px;">無紀錄</div>';
    return;
  }

  list.forEach(m => {
    const pNames = (m.players || []).map(getPlayerName).join(' & ');
    const oNames = (m.opponents || []).map(getPlayerName).join(' & ');

    const card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML = `
      <div class="match-header">
        <span class="match-tag">${m.type === 'singles' ? '單打' : '雙打'}</span>
        <span>${escapeHtml(m.date)}</span>
      </div>
      <div class="match-body">
        <div class="match-vs">
          <div class="match-player">${escapeHtml(pNames)}</div>
          <div class="match-vs-icon">vs</div>
          <div class="match-opponent">${escapeHtml(oNames)}</div>
        </div>
        <div class="match-score">${escapeHtml(m.score)}</div>
      </div>
    `;
    card.onclick = () => showMatchDetail(m);
    div.appendChild(card);
  });
}

// Schedule: Fix "VS" -> "&" and ensure 2 players show up
function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  container.innerHTML = '';

  const query = (document.getElementById('schedule-search')?.value || '').trim().toLowerCase();

  weekdays.forEach((day, idx) => {
    const slots = schedule[day] || {};

    // Check if day has matches
    let hasData = false;
    defaultSlots.forEach(s => { if (slots[s]?.length) hasData = true; });

    // Accordion Logic
    const header = document.createElement('div');
    header.className = 'accordion-header';
    const todayIdx = (new Date().getDay() + 6) % 7;
    const isOpen = (idx === todayIdx) || !!query;

    header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-${isOpen ? 'up' : 'down'}"></i>`;
    if (isOpen) header.classList.add('active');

    const content = document.createElement('div');
    content.className = `accordion-content ${isOpen ? 'show' : ''}`;

    if (!hasData && !query) {
      content.innerHTML = '<div style="padding:10px;text-align:center;color:#ccc;">本日無課</div>';
    } else {
      Object.keys(slots).forEach(slot => {
        const items = (slots[slot] || []).filter(e => {
          if (!query) return true;
          const txt = [e.playerA?.name, e.playerB?.name, e.coach?.name, e.table, e.remark].join(' ').toLowerCase();
          return txt.includes(query);
        });
        if (items.length === 0) return;

        content.innerHTML += `<div class="time-slot-header">${escapeHtml(slot)}</div>`;
        const grid = document.createElement('div');
        grid.className = 'compact-grid';

        items.forEach(e => {
          let pText = escapeHtml(e.playerA?.name || '');
          if (e.playerB && e.playerB.name) {
            pText += `<br><span style="font-size:0.9em;color:#666">&</span><br>${escapeHtml(e.playerB.name)}`;
          }

          grid.innerHTML += `
            <div class="compact-card">
              <div class="table-badge">T${escapeHtml(e.table)}</div>
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
      header.querySelector('i').className = `fas fa-chevron-${content.classList.contains('show') ? 'up' : 'down'}`;
    };

    container.appendChild(header);
    container.appendChild(content);
  });
}

// Leave: List Rendering (Fixing missing name/date)
function renderLeaveList() {
  const div = document.getElementById('leave-list');
  if (!div) return;
  div.innerHTML = '';

  const list = leaveRequestsData || [];

  if (!list || list.length === 0) {
    div.innerHTML = '<div style="text-align:center;color:#888;padding:20px;">無請假紀錄</div>';
    return;
  }

  const container = document.createElement('div');
  container.className = 'leave-list-container';

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item';
    card.innerHTML = `
      <div class="leave-item-header">
        <span class="leave-item-name">${escapeHtml(item.name)}</span>
        <span class="leave-item-date">${escapeHtml(item.date)}</span>
      </div>
      <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
      <div style="font-size:0.8rem;color:#888;margin-top:5px;text-align:right;">${escapeHtml(item.slot)}</div>
    `;
    container.appendChild(card);
  });

  div.appendChild(container);

  // Optional: bind leave form if present (keeps prior UX)
  const form = document.getElementById('leave-form');
  if (form && !form.hasAttribute('data-bound')) {
    form.setAttribute('data-bound', 'true');
    form.onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        name: document.getElementById('leave-name')?.value?.trim() || '',
        date: document.getElementById('leave-date')?.value || '',
        slot: document.getElementById('leave-slot')?.value || '',
        reason: document.getElementById('leave-reason')?.value?.trim() || ''
      };
      if (!payload.name || !payload.date) return;
      await sendToGas('add_leave', payload);
      form.reset();
    };
  }
}

// Utils & Event Binding
document.addEventListener('DOMContentLoaded', () => {
  loadAllData();
  initNavigation();

  // Bind Search Inputs
  const bindSearch = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.oninput = fn;
  };
  bindSearch('schedule-search', renderSchedule);
  bindSearch('roster-search', renderRoster);
  bindSearch('match-keyword', renderMatches);

  // Filter checkboxes
  const bindCheck = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.onchange = fn;
  };
  bindCheck('filter-singles', renderMatches);
  bindCheck('filter-doubles', renderMatches);

  // Hash Routing
  const hash = location.hash.replace('#', '') || 'home';
  navigateTo(hash, false);
});

// Helper Functions
function getPlayerName(id) {
  const pid = String(id || '');
  const p = players.find(x => String(x.id) === pid);
  return p ? p.name : pid;
}

function escapeHtml(text) {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function navigateTo(id, push = true) {
  document.querySelectorAll('main>section').forEach(s => {
    s.classList.add('hidden');
    s.classList.remove('active');
  });

  const target = document.getElementById(id);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');

    if (id === 'schedule') renderSchedule();
    if (id === 'matches') renderMatches();
    if (id === 'roster') renderRoster();
    if (id === 'leave') renderLeaveList();
    if (id === 'admin') renderAdmin();
  }

  if (push) history.pushState({ section: id }, '', `#${id}`);

  // Update Nav
  document.querySelectorAll('nav a, #bottom-nav button').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.section === id) el.classList.add('active');
  });
}

// Required for navigation init
function initNavigation() {
  document.querySelectorAll('[data-section]').forEach(el => {
    el.onclick = (e) => {
      e.preventDefault();
      navigateTo(el.dataset.section);
      document.body.classList.remove('sidebar-open');
    };
  });

  const menu = document.getElementById('menu-toggle');
  if (menu) menu.onclick = () => document.body.classList.toggle('sidebar-open');

  const over = document.getElementById('overlay');
  if (over) over.onclick = () => document.body.classList.remove('sidebar-open');

  // Browser back
  window.addEventListener('popstate', (e) => {
    const section = e.state?.section || location.hash.replace('#', '') || 'home';
    navigateTo(section, false);
  });
}

// =============================
// Admin / GAS interaction (kept from previous version; required)
// =============================

// Generic GAS write (no auth)
async function sendToGas(action, payload) {
  const activeEl = document.activeElement;
  const isBtn = activeEl && activeEl.tagName === 'BUTTON';
  const originalText = isBtn ? activeEl.innerText : '';

  if (isBtn) {
    activeEl.innerText = '處理中...';
    activeEl.disabled = true;
  }

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });

    const result = await response.json();

    if (result && result.success) {
      showToast(result.message || '操作成功');
      await loadAllData();
    } else {
      showToast('操作失敗: ' + (result?.message || '未知錯誤'));
    }
  } catch (e) {
    console.error(e);
    showToast('連線錯誤，請稍後再試');
  } finally {
    if (isBtn) {
      activeEl.innerText = originalText;
      activeEl.disabled = false;
    }
  }
}

// Admin auth helper (optional)
async function sendToGasWithAuth(action, payload) {
  let password = sessionStorage.getItem('admin_pwd');
  if (!password) {
    password = document.getElementById('admin-password')?.value || '';
  }
  if (!password) return;

  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, payload, password })
    });
    const result = await response.json();

    if (result.success) {
      showToast(result.message || '完成');
      sessionStorage.setItem('admin_pwd', password);
      await loadAllData();
    } else {
      showToast('失敗: ' + (result.message || '未知錯誤'));
    }
  } catch (e) {
    console.error(e);
    showToast('連線錯誤');
  }
}

function renderAdmin() {
  // Check Session
  if (sessionStorage.getItem('admin_pwd')) adminLoggedIn = true;

  const loginDiv = document.getElementById('admin-login');
  const dashDiv = document.getElementById('admin-dashboard');

  // If DOM not present, do nothing
  if (!loginDiv && !dashDiv) return;

  if (!adminLoggedIn) {
    if (loginDiv) loginDiv.classList.remove('hidden');
    if (dashDiv) dashDiv.classList.add('hidden');

    const loginBtn = document.getElementById('admin-login-btn');
    const err = document.getElementById('admin-login-error');

    if (loginBtn) {
      loginBtn.onclick = async () => {
        const pwd = document.getElementById('admin-password')?.value || '';
        if (!pwd) return alert('請輸入密碼');

        const original = loginBtn.innerText;
        loginBtn.innerText = '驗證中...';
        loginBtn.disabled = true;

        try {
          const res = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'check_auth', password: pwd })
          });
          const json = await res.json();

          if (json.success) {
            adminLoggedIn = true;
            sessionStorage.setItem('admin_pwd', pwd);
            if (err) err.classList.add('hidden');
            renderAdmin();
            showToast('登入成功');
          } else {
            if (err) err.classList.remove('hidden');
          }
        } catch (e) {
          console.error(e);
          showToast('驗證錯誤');
        } finally {
          loginBtn.innerText = original;
          loginBtn.disabled = false;
        }
      };

      // UX: allow Enter key submit
      const pwdInput = document.getElementById('admin-password');
      if (pwdInput && !pwdInput.hasAttribute('data-enter-bound')) {
        pwdInput.setAttribute('data-enter-bound', 'true');
        pwdInput.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') loginBtn.click();
        });
      }
    }
  } else {
    if (loginDiv) loginDiv.classList.add('hidden');
    if (dashDiv) dashDiv.classList.remove('hidden');

    // (Optional) bind admin buttons if present
    const map = {
      'admin-add-announcement': showAdminAddAnnouncement,
      'admin-view-leave': showAdminLeaveList,
      'admin-manage-players': showAdminPlayerList,
      'admin-manage-matches': showAdminMatchList,
      'admin-settings': showAdminSettings
    };

    Object.entries(map).forEach(([id, fn]) => {
      const btn = document.getElementById(id);
      if (btn) btn.onclick = fn;
    });
  }
}

// Minimal admin sub-pages (compatible with older layout if present)
function showAdminAddAnnouncement() {
  const content = document.getElementById('admin-content');
  if (!content) return;
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">新增公告</h3>
      <div style="margin-bottom:10px;"><label>標題</label><input id="ann-title" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;"></div>
      <div style="margin-bottom:10px;"><label>日期</label><input type="date" id="ann-date" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;" value="${new Date().toISOString().split('T')[0]}"></div>
      <div style="margin-bottom:10px;"><label>內容</label><textarea id="ann-content" rows="5" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;"></textarea></div>
      <button class="hero-btn" style="width:100%;" onclick="submitAnnouncement()">發布</button>
    </div>
  `;
}

async function submitAnnouncement() {
  const payload = {
    title: document.getElementById('ann-title')?.value || '',
    date: document.getElementById('ann-date')?.value || '',
    content: document.getElementById('ann-content')?.value || ''
  };
  if (!payload.title) return;
  await sendToGasWithAuth('add_announcement', payload);
}

function showAdminLeaveList() {
  const content = document.getElementById('admin-content');
  if (!content) return;

  content.innerHTML = '<h4>請假管理</h4><div id="adm-leave-list" class="leave-list-container"></div>';
  const container = document.getElementById('adm-leave-list');

  const list = leaveRequestsData || [];
  if (list.length === 0) {
    container.innerHTML = '無資料';
    return;
  }

  list.forEach(item => {
    const div = document.createElement('div');
    div.className = 'leave-item';
    div.innerHTML = `
      <div class="leave-item-header">
        <span class="leave-item-name">${escapeHtml(item.name)}</span>
        <span class="leave-item-date">${escapeHtml(item.date)} ${escapeHtml(item.slot)}</span>
      </div>
      <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
      <div class="leave-item-actions">
        <button class="action-btn delete" onclick="deleteLeave('${escapeHtml(item.rowId)}')"><i class="fas fa-trash"></i> 刪除</button>
      </div>
    `;
    container.appendChild(div);
  });
}

function deleteLeave(rowId) {
  if (confirm('確定刪除?')) sendToGasWithAuth('delete_leave', { rowId });
}

function showAdminSettings() {
  const content = document.getElementById('admin-content');
  if (!content) return;
  const currBg = window.heroConfig?.hero_bg_url || window.heroConfig?.heroBgUrl || '';
  content.innerHTML = `
    <div class="card">
      <h3 style="margin-top:0;">網站設定</h3>
      <div style="margin-bottom:10px;">
        <label>首頁背景圖連結</label>
        <input id="conf-bg" style="width:100%;padding:10px;border-radius:8px;border:1px solid #ddd;" value="${escapeHtml(currBg)}">
      </div>
      <button class="hero-btn" style="width:100%;" onclick="saveConfig()">儲存</button>
    </div>
  `;
}

async function saveConfig() {
  const url = document.getElementById('conf-bg')?.value?.trim() || '';
  await sendToGasWithAuth('update_config', { hero_bg_url: url });
}

function showAdminPlayerList() {
  const content = document.getElementById('admin-content');
  if (content) content.innerHTML = '<div class="card">功能開發中：球員管理</div>';
}

function showAdminMatchList() {
  const content = document.getElementById('admin-content');
  if (content) content.innerHTML = '<div class="card">功能開發中：比賽紀錄管理</div>';
}

// Details
function showMatchDetail(m) {
  // Prefer a panel if exists
  const panel = document.getElementById('player-analysis') || document.getElementById('match-detail');
  if (!panel) return;

  const pNames = (m.players || []).map(getPlayerName).join(' & ');
  const oNames = (m.opponents || []).map(getPlayerName).join(' & ');

  panel.innerHTML = `
    <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
    <h3 style="margin:0 0 10px 0; color:var(--primary-color);">比賽詳情</h3>
    <div class="card" style="background:#f9f9f9;">
      <div style="font-weight:900; font-size:1.05rem; margin-bottom:6px;">${escapeHtml(pNames)} <span style="color:#999;">vs</span> ${escapeHtml(oNames)}</div>
      <div style="color:#666; font-size:0.9rem;">${escapeHtml(m.date)} | ${m.type === 'singles' ? '單打' : '雙打'}</div>
      <div style="margin-top:8px; font-weight:900; color:var(--primary-dark);">比分：${escapeHtml(m.score)}</div>
      ${m.sets ? `<div style="font-size:0.85rem; color:#888; margin-top:4px;">${escapeHtml(m.sets)}</div>` : ''}
    </div>
    ${m.video?.url ? `<button class="hero-btn" style="width:100%;" onclick="window.open('${m.video.url}', '_blank')"><i class="fas fa-video"></i> 觀看影片</button>` : ''}
  `;
  panel.classList.remove('hidden');
  panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function showAnnouncementDetail(a) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;
  modal.innerHTML = `
    <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
    <h3 style="margin-top:10px; color:var(--primary-color);">${escapeHtml(a.title || '')}</h3>
    <div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;">
      <i class="far fa-calendar-alt"></i> ${escapeHtml(a.date || '')}
    </div>
    <div style="line-height:1.8; color:#333; font-size:0.95rem; white-space: pre-wrap;">${escapeHtml(a.content || '')}</div>
  `;
  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

function hideModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.body.classList.remove('modal-open');

  const analysis = document.getElementById('player-analysis');
  if (analysis) analysis.classList.add('hidden');
  document.querySelectorAll('.match-card.selected').forEach(c => c.classList.remove('selected'));
}

function showToast(msg) {
  const c = document.getElementById('toast-container');
  if (!c) return;
  const t = document.createElement('div');
  t.className = 'toast show';
  t.innerHTML = `<i class="fas fa-info-circle"></i> ${escapeHtml(msg)}`;
  c.appendChild(t);
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 500);
  }, 3000);
}
