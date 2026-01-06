// script.js - Comprehensive Frontend for Table Tennis Team App (v6)
//
// 本版整合了前端所有核心功能，提供：
// - 從 Google Apps Script 後端一次載入所有資料
// - 前台頁面的切換與渲染（首頁、公告、排程、請假、比賽、名冊、影音）
// - 名冊列表採用緊湊型摺疊卡片樣式，支援搜尋與排序
// - 管理後台：球員名冊管理、排程管理、比賽管理、公告管理、請假管理、網站設定
// - 支援密碼驗證的後端寫入函式 sendToGasWithAuth

// === 後端 API 設定 ===
// 更換為您的 Google Apps Script Web App URL
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// === 全域變數 ===
let announcements = [];
let players = [];
let staff = [];
let matches = [];
let leaveRequests = [];
let schedule = {};
let heroConfig = {};
let adminLoggedIn = false;

// 星期與預設時段（用於排程）
const weekdays = ['週一','週二','週三','週四','週五','週六','週日'];
const defaultSlots = [
  '17:00-18:00','18:00-19:00','19:00-20:00','20:00-21:00',
  '11:00-12:00','12:00-13:00','13:00-14:00','14:00-15:00',
  '15:00-16:00','16:00-17:00'
];

// === 工具函式 ===

// HTML escape（防止 XSS）
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 日期格式化為 YYYY-MM-DD
function formatDate(d) {
  if (!d) return '';
  const date = new Date(d);
  if (isNaN(date.getTime())) return d;
  return date.toISOString().split('T')[0];
}

// 顯示 Toast 提示訊息
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// 通用後端呼叫（帶密碼驗證）
async function sendToGasWithAuth(action, payload) {
  const passwordInput = document.getElementById('admin-password');
  const password = passwordInput ? passwordInput.value.trim() : prompt('請輸入管理密碼確認操作：');
  if (!password) return;
  showToast('處理中...');
  try {
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      body: JSON.stringify({ action, payload, password })
    });
    const result = await response.json();
    if (result.success) {
      showToast(result.message || '操作成功');
      await loadAllData();
      // 依 action 更新畫面
      if (action.includes('player')) {
        showAdminPlayerList();
      } else if (action.includes('schedule')) {
        showAdminScheduleList();
      } else if (action.includes('match')) {
        showAdminMatchList();
      } else if (action === 'update_config') {
        renderHome();
      } else if (action.includes('leave')) {
        showAdminLeaveList();
      }
    } else {
      showToast('失敗: ' + (result.message || '未知錯誤'));
    }
  } catch (e) {
    console.error(e);
    showToast('連線錯誤，請稍後再試');
  }
}

// 確認刪除後呼叫後端
function confirmDel(action, rowId, name) {
  if (confirm(`確定要刪除 ${name} 嗎？`)) {
    sendToGasWithAuth(action, { rowId });
  }
}

// === 資料處理 ===

// 將後端回傳的 Excel 欄位轉換為前端需要的結構
function normalizeData(rawData) {
  // 公告
  const announcements = (rawData.announcements || []).map(r => ({
    id: r.announcement_id || r.id,
    date: formatDate(r.date || r.match_date || ''),
    title: r.title || r.event_name || '',
    content: r.content || r.notes || '',
    // 可擴充 images/links 等
  }));
  // 球員
  const players = (rawData.players || []).map(r => ({
    rowId: r.rowId,
    id: r.player_id ?? r.id,
    name: r.student_name ?? r.name ?? '',
    nickname: r.nickname || '',
    grade: r.grade || '',
    class: r.class || '',
    paddle: r.paddle || '',
    gender: r.gender || '',
    hand: r.hand || '',
    style: r.play_style || r.style || '',
    photo: r.photo_url || '',
    isActive: String(r.is_active ?? r.isActive ?? 'TRUE').toUpperCase()
  }));
  // 教練與工作人員
  const staff = (rawData.staff || []).map(r => ({
    id: r.staff_id || r.id,
    name: r.name || '',
    role: r.role || '',
    email: r.email || '',
    phone: r.phone || '',
    isActive: String(r.is_active ?? 'TRUE').toUpperCase()
  }));
  // 排程（training_schedule）
  const schedules = [];
  (rawData.training_schedule || []).forEach(r => {
    schedules.push({
      rowId: r.rowId,
      date: r.weekday || r.date,
      slot: r.slot,
      table: r.table_no,
      coach: { id: r.coach_id, name: (staff.find(c => c.id === r.coach_id) || {}).name || r.coach_id },
      playerA: { id: r.player_a_id, name: (players.find(p => p.id === r.player_a_id) || {}).name || r.player_a_id },
      playerB: { id: r.player_b_id, name: (players.find(p => p.id === r.player_b_id) || {}).name || r.player_b_id },
      remark: r.note || ''
    });
  });
  // 比賽紀錄
  const matches = (rawData.matches || []).map(r => ({
    rowId: r.rowId,
    date: formatDate(r.match_date || r.date),
    eventName: r.event_name || '',
    type: r.match_type || r.type || 'singles',
    players: [r.player1_id, r.player2_id].filter(x => x),
    opponents: [r.opponent1, r.opponent2].filter(x => x),
    score: r.game_score || r.result || '',
    sets: r.set_scores || '',
    notes: r.notes || '',
    video: { url: r.media_url || '', provider: r.media_provider || '' }
  }));
  // 請假
  const leaveRequests = (rawData.leave_requests || []).map(r => ({
    id: r.request_id || r.id,
    rowId: r.rowId,
    name: r.created_by_email || r.name || '',
    date: formatDate(r.leave_date || r.date),
    slot: r.slot || '',
    reason: r.reason || '',
    status: r.status || 'pending'
  }));
  return {
    hero: rawData.hero || {},
    announcements,
    players,
    staff,
    schedules,
    matches,
    leaveRequests
  };
}

// 初始化 schedule 空結構
function initEmptySchedule() {
  schedule = {};
  weekdays.forEach(day => {
    schedule[day] = {};
    defaultSlots.forEach(slot => {
      schedule[day][slot] = [];
    });
  });
}

// 載入所有資料
async function loadAllData() {
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_all_data`);
    const rawData = await response.json();
    const data = normalizeData(rawData);
    announcements = data.announcements;
    players = data.players;
    staff = data.staff;
    matches = data.matches;
    leaveRequests = data.leaveRequests;
    heroConfig = data.hero || {};
    // 建立排程物件
    initEmptySchedule();
    (data.schedules || []).forEach(item => {
      if (!schedule[item.date]) schedule[item.date] = {};
      if (!schedule[item.date][item.slot]) schedule[item.date][item.slot] = [];
      schedule[item.date][item.slot].push(item);
    });
  } catch (e) {
    console.error(e);
    showToast('資料載入失敗');
  } finally {
    // 移除 loading
    const loader = document.getElementById('app-loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }
  }
}

// === 導覽與頁面切換 ===

// 更新側邊與底部導覽 active 狀態
function updateActiveNav(sectionId) {
  document.querySelectorAll('nav#sidebar a').forEach(a => {
    if (a.dataset.section === sectionId) a.classList.add('active');
    else a.classList.remove('active');
  });
  document.querySelectorAll('#bottom-nav button').forEach(btn => {
    if (btn.dataset.section === sectionId) btn.classList.add('active');
    else btn.classList.remove('active');
  });
}

// 導航堆疊與返回
let navStack = [];
function updateBackButton() {
  const backBtn = document.getElementById('back-button');
  if (!backBtn) return;
  if (navStack.length > 1) {
    backBtn.classList.remove('hidden');
  } else {
    backBtn.classList.add('hidden');
  }
}

function navigateTo(sectionId, pushState = true) {
  document.querySelectorAll('main > section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });
  const target = document.getElementById(sectionId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');
    // 特定頁面渲染
    if (sectionId === 'home') renderHome();
    if (sectionId === 'announcements') renderAnnouncements();
    if (sectionId === 'schedule') renderSchedule();
    if (sectionId === 'leave') renderLeave();
    if (sectionId === 'matches') renderMatches();
    if (sectionId === 'roster') renderRoster();
    if (sectionId === 'media') renderMedia();
    if (sectionId === 'admin') renderAdmin();
  }
  updateActiveNav(sectionId);
  if (pushState) {
    history.pushState({ section: sectionId }, '', '#' + sectionId);
    navStack.push(sectionId);
  }
  updateBackButton();
}

function goBack() {
  if (navStack.length > 1) {
    navStack.pop();
    const prev = navStack[navStack.length - 1] || 'home';
    navigateTo(prev, false);
  }
}

// 初始化導覽
function initNavigation() {
  // 側邊欄
  const sidebar = document.getElementById('sidebar');
  if (sidebar) {
    sidebar.addEventListener('click', e => {
      const link = e.target.closest('a[data-section]');
      if (!link) return;
      e.preventDefault();
      const section = link.dataset.section;
      navigateTo(section);
      if (window.innerWidth < 768) toggleSidebar();
    });
  }
  // 底部導覽
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', e => {
      const btn = e.target.closest('button[data-section]');
      if (!btn) return;
      const section = btn.dataset.section;
      navigateTo(section);
    });
  }
  // 漢堡選單
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    });
  }
  // 標題也能開關側邊欄（若 header h1 使用 pointer）
  const headerTitle = document.querySelector('header h1');
  if (headerTitle) {
    headerTitle.addEventListener('click', e => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    });
  }
  // 遮罩層關閉
  const overlay = document.getElementById('overlay');
  if (overlay) {
    overlay.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) toggleSidebar();
      else hideModal();
    });
  }
  // 返回按鈕
  const backBtn = document.getElementById('back-button');
  if (backBtn) backBtn.addEventListener('click', goBack);
  // 視窗調整：根據寬度顯示底部導覽
  const syncBottomNav = () => {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    if (window.innerWidth < 768) nav.classList.remove('hidden');
    else nav.classList.add('hidden');
  };
  syncBottomNav();
  window.addEventListener('resize', syncBottomNav);
}

// 側邊欄切換
function toggleSidebar() {
  document.body.classList.toggle('sidebar-open');
}

// 模態視窗隱藏
function hideModal() {
  const modal = document.getElementById('announcement-detail');
  if (modal) modal.classList.remove('active');
  document.body.classList.remove('modal-open');
}

// === 前台渲染 ===

function renderHome() {
  // 渲染公告簡覽
  const annContainer = document.getElementById('home-announcements');
  if (annContainer) {
    annContainer.innerHTML = '';
    const sorted = announcements.slice().sort((a,b) => new Date(b.date) - new Date(a.date));
    sorted.slice(0,3).forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <h4 style="margin:0; color:var(--primary-color);">${escapeHtml(item.title)}</h4>
          <span style="font-size:0.8rem; color:#888;">${escapeHtml(item.date)}</span>
        </div>
        <p style="margin:5px 0 0; color:#555; font-size:0.9rem;">${escapeHtml(item.content).substring(0,50)}...</p>
      `;
      card.addEventListener('click', () => showAnnouncementDetail(item));
      annContainer.appendChild(card);
    });
  }
  // 今日概況：顯示今天請假人數與排程數（示意）
  const statusGrid = document.getElementById('home-status-grid');
  if (statusGrid) {
    const scheduleCard = document.getElementById('home-schedule-card');
    const leaveCard = document.getElementById('home-leave-card');
    const today = formatDate(new Date());
    // 今日排程
    let todayCount = 0;
    if (schedule[today]) {
      Object.values(schedule[today]).forEach(arr => todayCount += arr.length);
    }
    scheduleCard.innerHTML = `<div class="card" style="padding:15px;"><h4 style="margin:0 0 10px 0;">今日排程</h4><p>場次：${todayCount}</p></div>`;
    // 今日請假
    const todaysLeaves = leaveRequests.filter(l => l.date === today);
    leaveCard.innerHTML = `<div class="card" style="padding:15px;"><h4 style="margin:0 0 10px 0;">今日請假</h4><p>人數：${todaysLeaves.length}</p></div>`;
  }
}

function showAnnouncementDetail(item) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;
  modal.innerHTML = `
    <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
    <h3 style="margin-top:10px; color:var(--primary-color);">${escapeHtml(item.title)}</h3>
    <div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;">
      <i class="far fa-calendar-alt"></i> ${escapeHtml(item.date)}
    </div>
    <div style="line-height:1.8; color:#333; font-size:0.95rem;">${escapeHtml(item.content).replace(/\n/g, '<br>')}</div>
  `;
  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a,b) => new Date(b.date) - new Date(a.date));
  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0; color:var(--primary-color);">${escapeHtml(item.title)}</h4>
        <span style="font-size:0.8rem; color:#888;">${escapeHtml(item.date)}</span>
      </div>
      <p style="margin:5px 0 0; color:#555; font-size:0.9rem;">${escapeHtml(item.content)}</p>
    `;
    card.addEventListener('click', () => showAnnouncementDetail(item));
    listDiv.appendChild(card);
  });
}

function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  container.innerHTML = '';
  // 搜尋功能
  const searchInput = document.getElementById('schedule-search');
  const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const isMobile = window.innerWidth < 768;
  weekdays.forEach(day => {
    // Accordion header
    const header = document.createElement('div');
    header.className = 'accordion-header';
    header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-down"></i>`;
    const content = document.createElement('div');
    content.className = 'accordion-content';
    // Expand current day by default
    const todayIdx = new Date().getDay();
    const isToday = ((weekdays.indexOf(day) + 1) % 7) === todayIdx;
    if (!keyword && isToday) {
      content.classList.add('show');
      header.classList.add('active');
    }
    header.addEventListener('click', () => {
      content.classList.toggle('show');
      header.classList.toggle('active');
    });
    container.appendChild(header);
    container.appendChild(content);
    let dayHasData = false;
    defaultSlots.forEach(slot => {
      const items = (schedule[day] && schedule[day][slot]) ? schedule[day][slot] : [];
      if (!items.length) return;
      // Filter by keyword
      const entries = items.filter(item => {
        if (!keyword) return true;
        const names = [item.coach.name || '', item.playerA.name || '', item.playerB.name || ''].join(',');
        return names.toLowerCase().includes(keyword);
      });
      if (!entries.length) return;
      dayHasData = true;
      // Slot header
      const slotHeader = document.createElement('div');
      slotHeader.className = 'time-slot-header';
      slotHeader.innerHTML = slot;
      content.appendChild(slotHeader);
      // Grid / list
      const grid = document.createElement('div');
      grid.className = isMobile ? 'compact-grid' : 'card-container';
      entries.forEach(item => {
        const card = document.createElement('div');
        if (isMobile) {
          card.className = 'compact-card';
          card.innerHTML = `
            <div class="table-badge">T${escapeHtml(item.table)}</div>
            <div class="coach-name">${escapeHtml(item.coach.name)}</div>
            <div class="players">${escapeHtml(item.playerA.name)}<br>${escapeHtml(item.playerB.name)}</div>
          `;
        } else {
          card.className = 'card';
          card.innerHTML = `
            <h4>桌次 ${escapeHtml(item.table)}</h4>
            <p><i class="fas fa-user-tie"></i> ${escapeHtml(item.coach.name)}</p>
            <p>${escapeHtml(item.playerA.name)} vs ${escapeHtml(item.playerB.name)}</p>
          `;
        }
        grid.appendChild(card);
      });
      content.appendChild(grid);
    });
    if (!dayHasData) {
      const empty = document.createElement('div');
      empty.style.padding = '10px';
      empty.style.color = '#999';
      empty.style.textAlign = 'center';
      empty.textContent = '本日無排程';
      content.appendChild(empty);
    }
  });
}

function renderLeave() {
  const form = document.getElementById('leave-form');
  if (form) {
    form.reset();
    form.onsubmit = async e => {
      e.preventDefault();
      const name = document.getElementById('leave-name').value.trim();
      const date = document.getElementById('leave-date').value;
      const slot = document.getElementById('leave-slot').value;
      const reason = document.getElementById('leave-reason').value.trim();
      if (!name || !date || !slot) { showToast('請填寫完整資訊'); return; }
      // 呼叫後端 add_leave
      try {
        const resp = await fetch(GAS_API_URL, {
          method: 'POST',
          body: JSON.stringify({ action: 'add_leave', payload: { name, date, slot, reason } })
        });
        const res = await resp.json();
        if (res.success) {
          showToast('請假申請已送出');
          await loadAllData();
          renderLeaveList();
          form.reset();
        } else {
          showToast('請假失敗');
        }
      } catch (e) {
        showToast('連線錯誤');
      }
    };
  }
  renderLeaveList();
}

// 請假列表（使用卡片式）
function renderLeaveList() {
  const listDiv = document.getElementById('leave-list');
  if (!listDiv) return;
  const delBtn = document.getElementById('delete-selected-leave');
  listDiv.innerHTML = '';
  if (!leaveRequests || leaveRequests.length === 0) {
    listDiv.textContent = '目前沒有請假紀錄';
    if (delBtn) delBtn.disabled = true;
    return;
  }
  const container = document.createElement('div');
  container.className = 'leave-list-container';
  leaveRequests.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item has-checkbox';
    card.innerHTML = `
      <div class="leave-item-header">
        <span class="leave-item-name">${escapeHtml(item.name)}</span>
        <span class="leave-item-date">${escapeHtml(item.date)} <span>${escapeHtml(item.slot)}</span></span>
      </div>
      <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
      <div class="leave-checkbox-wrapper"><input type="checkbox" value="${escapeHtml(item.rowId)}" style="transform:scale(1.5);"></div>
    `;
    container.appendChild(card);
  });
  listDiv.appendChild(container);
  if (delBtn) delBtn.disabled = false;
}

// 比賽紀錄頁面（前台）
function renderMatches() {
  const listDiv = document.getElementById('match-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  if (!matches || matches.length === 0) {
    listDiv.innerHTML = '<div class="card" style="padding:20px; text-align:center; color:#888;">目前無比賽紀錄</div>';
    return;
  }
  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'match-card';
    const playerNames = m.players.map(id => (players.find(p => p.id === id) || {}).name || id).join('、');
    const opponentNames = m.opponents.join('、');
    const typeLabel = m.type === 'singles' ? '單打' : '雙打';
    card.innerHTML = `
      <div class="match-card-header">
        <span class="match-type-badge">${typeLabel}</span>
        <span>${escapeHtml(m.date)}</span>
      </div>
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <div class="match-card-vs">
          <span>${escapeHtml(playerNames)}</span>
          <i class="fas fa-times"></i>
          <span>${escapeHtml(opponentNames)}</span>
        </div>
        <div class="match-card-score">${escapeHtml(m.score)}</div>
      </div>
      <div style="font-size:0.85rem; color:#888; margin-top:5px;">${escapeHtml(m.eventName)}</div>
    `;
    card.addEventListener('click', () => {
      // 展示詳情
      showMatchDetail(m);
    });
    listDiv.appendChild(card);
  });
}

function showMatchDetail(item) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;
  const playerNames = item.players.map(id => (players.find(p => p.id === id) || {}).name || id).join('、');
  const opponentNames = item.opponents.join('、');
  modal.innerHTML = `
    <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
    <h3 style="margin:0 0 10px 0; color:var(--primary-color);">${item.type === 'singles' ? '單打' : '雙打'}詳情</h3>
    <p style="font-size:0.9rem; color:#666;">賽事：${escapeHtml(item.eventName)}</p>
    <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:15px;">
      <div style="font-weight:bold; color:#333; margin-bottom:5px;">${escapeHtml(playerNames)} <span style="color:#e74c3c;">vs</span> ${escapeHtml(opponentNames)}</div>
      <div style="font-size:0.9rem; color:#666;">日期：${escapeHtml(item.date)}</div>
      <div style="font-size:0.9rem; color:#666;">比分：<span style="font-weight:bold; color:var(--primary-dark);">${escapeHtml(item.score)}</span></div>
      ${item.sets ? `<div style="font-size:0.9rem; color:#666;">局分：${escapeHtml(item.sets)}</div>` : ''}
    </div>
    ${item.notes ? `<div style="font-size:0.9rem; color:#555; margin-bottom:15px;">備註：${escapeHtml(item.notes)}</div>` : ''}
    ${item.video && item.video.url ? `<div style="margin-top:10px;"></div>` : ''}
  `;
  if (item.video && item.video.url) {
    // 偵測 YouTube ID
    const ytId = (() => {
      const url = item.video.url;
      const reg = /^.*(youtu.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;
      const match = url.match(reg);
      return (match && match[2].length === 11) ? match[2] : null;
    })();
    let videoHtml = '';
    if (item.video.provider === 'yt' || ytId) {
      const id = ytId || '';
      videoHtml = `<iframe src="https://www.youtube.com/embed/${id}?autoplay=1" style="width:100%; height:200px; border:none; border-radius:8px;" allowfullscreen></iframe>`;
    } else {
      videoHtml = `<a href="${escapeHtml(item.video.url)}" target="_blank" class="hero-btn" style="display:block; text-align:center; font-size:0.9rem;">觀看影片</a>`;
    }
    const container = document.createElement('div');
    container.innerHTML = videoHtml;
    modal.appendChild(container);
  }
  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

// 名冊頁面（前台）
function renderRoster() {
  const rosterDiv = document.getElementById('roster-players');
  const staffDiv = document.getElementById('roster-staff');
  const searchInput = document.getElementById('roster-search');
  const keyword = searchInput ? searchInput.value.toLowerCase().trim() : '';
  rosterDiv.innerHTML = '';
  staffDiv.innerHTML = '';
  // 渲染教練
  const filteredStaff = staff.filter(s => !keyword || (s.name && s.name.includes(keyword)));
  filteredStaff.forEach(c => {
    const card = document.createElement('div');
    card.className = 'player-card';
    card.innerHTML = `
      <div class="player-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="player-info-main">
          <span class="player-name">${escapeHtml(c.name)}</span>
          <span class="player-class">${escapeHtml(c.role || '')}</span>
        </div>
        <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="player-details">
        <div class="detail-grid">
          <div><span class="detail-label">角色:</span> ${escapeHtml(c.role || '-')}</div>
          <div><span class="detail-label">Email:</span> ${escapeHtml(c.email || '-')}</div>
          <div><span class="detail-label">電話:</span> ${escapeHtml(c.phone || '-')}</div>
        </div>
      </div>
    `;
    staffDiv.appendChild(card);
  });
  // 渲染球員
  // 排序：年級(小→大) > 班級(字串排序)
  const sorted = players.slice().sort((a, b) => {
    const gDiff = (Number(a.grade) || 99) - (Number(b.grade) || 99);
    if (gDiff !== 0) return gDiff;
    return (a.class || '').localeCompare(b.class || '', 'zh-Hant');
  });
  const filtered = sorted.filter(p => {
    return !keyword || (p.name && p.name.includes(keyword)) || (p.class && p.class.includes(keyword)) || (p.paddle && p.paddle.includes(keyword));
  });
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    const gradeClass = `${p.grade ? p.grade + '年' : ''} ${p.class ? p.class + '班' : ''}`.trim() || '未填';
    card.innerHTML = `
      <div class="player-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="player-info-main">
          <span class="player-name">${escapeHtml(p.name)}</span>
          <span class="player-class">${escapeHtml(gradeClass)}</span>
        </div>
        <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="player-details">
        <div class="detail-grid">
          <div><span class="detail-label">暱稱:</span> ${escapeHtml(p.nickname || '-')}</div>
          <div><span class="detail-label">性別:</span> ${escapeHtml(p.gender || '-')}</div>
          <div><span class="detail-label">膠皮:</span> ${escapeHtml(p.paddle || '-')}</div>
          <div><span class="detail-label">持拍:</span> ${escapeHtml(p.hand || '-')}</div>
          <div><span class="detail-label">打法:</span> ${escapeHtml(p.style || '-')}</div>
          <div style="grid-column:1/-1"><span class="detail-label">狀態:</span> <span style="color:${p.isActive==='FALSE'?'red':'green'}">${p.isActive==='FALSE'?'離隊':'在隊'}</span></div>
        </div>
      </div>
    `;
    rosterDiv.appendChild(card);
  });
}

function renderMedia() {
  // 媒體區：此處可擴充，暫不實作
  const container = document.getElementById('media-list');
  if (container) {
    container.innerHTML = '<div style="padding:20px; color:#888; text-align:center;">尚無影音資料</div>';
  }
}

// === 管理後台相關 ===
function renderAdmin() {
  const dash = document.getElementById('admin-dashboard');
  const login = document.getElementById('admin-login');
  if (!adminLoggedIn) {
    // 顯示登入頁
    dash.classList.add('hidden');
    login.classList.remove('hidden');
    bindLogin();
    return;
  }
  // 已登入
  dash.classList.remove('hidden');
  login.classList.add('hidden');
  // 綁定按鈕
  const btnPlayer = document.getElementById('admin-manage-players');
  if (btnPlayer) btnPlayer.onclick = showAdminPlayerList;
  const btnSchedule = document.getElementById('admin-manage-schedule');
  if (btnSchedule) btnSchedule.onclick = showAdminScheduleList;
  const btnMatches = document.getElementById('admin-manage-matches');
  if (btnMatches) btnMatches.onclick = showAdminMatchList;
  const btnLeave = document.getElementById('admin-view-leave');
  if (btnLeave) btnLeave.onclick = showAdminLeaveList;
  const btnAnn = document.getElementById('admin-add-announcement');
  if (btnAnn) btnAnn.onclick = renderAdminAnnouncementForm;
  const btnSettings = document.getElementById('admin-settings');
  if (btnSettings) btnSettings.onclick = showAdminSettings;
}

function bindLogin() {
  const loginBtn = document.getElementById('admin-login-btn');
  const errorP = document.getElementById('admin-login-error');
  if (!loginBtn) return;
  loginBtn.onclick = async () => {
    const pwd = document.getElementById('admin-password').value.trim();
    if (!pwd) {
      if (errorP) errorP.classList.remove('hidden');
      return;
    }
    loginBtn.textContent = '驗證中...';
    loginBtn.disabled = true;
    try {
      const res = await fetch(GAS_API_URL, {
        method: 'POST',
        body: JSON.stringify({ action: 'check_auth', password: pwd })
      });
      const result = await res.json();
      if (result.success) {
        adminLoggedIn = true;
        // 保存密碼於輸入框供後續操作
        document.getElementById('admin-password').value = pwd;
        renderAdmin();
        showToast('登入成功');
      } else {
        if (errorP) {
          errorP.textContent = '密碼錯誤';
          errorP.classList.remove('hidden');
        }
      }
    } catch (e) {
      showToast('連線錯誤');
    } finally {
      loginBtn.textContent = '登入';
      loginBtn.disabled = false;
    }
  };
}

// === 管理：公告 ===
function renderAdminAnnouncementForm() {
  const content = document.getElementById('admin-content');
  if (!content) return;
  content.innerHTML = `
    <div class="admin-form-card">
      <h3 style="margin-top:0; color:var(--primary-color);">發布新公告</h3>
      <form id="admin-ann-form">
        <div class="admin-form-group"><label>公告標題</label><input type="text" id="new-ann-title" class="admin-input" required></div>
        <div class="admin-form-group"><label>發布日期</label><input type="date" id="new-ann-date" class="admin-input" required></div>
        <div class="admin-form-group"><label>公告內容</label><textarea id="new-ann-content" class="admin-textarea" rows="6" required></textarea></div>
        <button type="submit" class="hero-btn" style="width:100%;">確認發布</button>
      </form>
    </div>
  `;
  document.getElementById('new-ann-date').value = formatDate(new Date());
  const form = document.getElementById('admin-ann-form');
  form.onsubmit = async e => {
    e.preventDefault();
    const title = document.getElementById('new-ann-title').value.trim();
    const date = document.getElementById('new-ann-date').value;
    const contentText = document.getElementById('new-ann-content').value.trim();
    if (!title || !date || !contentText) return;
    await sendToGasWithAuth('add_announcement', { title, date, content: contentText });
    form.reset();
    document.getElementById('new-ann-date').value = formatDate(new Date());
  };
}

// === 管理：球員名冊 ===
function showAdminPlayerList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">球員名冊管理</h4>
      <button id="btn-add-player" class="hero-btn" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增球員</button>
    </div>
    <div class="admin-form-group" style="margin-bottom:15px;">
      <input type="text" id="player-search" class="admin-input" placeholder="搜尋姓名、班級、膠皮..." onkeyup="filterAdminPlayerList()">
    </div>
    <div id="admin-player-list"></div>
  `;
  document.getElementById('btn-add-player').onclick = () => renderAdminPlayerForm();
  filterAdminPlayerList();
}

function filterAdminPlayerList() {
  const keyword = (document.getElementById('player-search')?.value || '').toLowerCase();
  const listContainer = document.getElementById('admin-player-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';
  // 排序：年級(小→大) > 班級
  const sorted = players.slice().sort((a, b) => {
    const gDiff = (Number(a.grade) || 99) - (Number(b.grade) || 99);
    if (gDiff !== 0) return gDiff;
    return (a.class || '').localeCompare(b.class || '', 'zh-Hant');
  });
  const filtered = sorted.filter(p => {
    return !keyword || (p.name && p.name.includes(keyword)) || (p.class && p.class.includes(keyword)) || (p.paddle && p.paddle.includes(keyword));
  });
  if (filtered.length === 0) {
    listContainer.innerHTML = '<div style="text-align:center; color:#888;">無符合資料</div>';
    return;
  }
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';
    const gradeClass = `${p.grade ? p.grade + '年' : ''} ${p.class ? p.class + '班' : ''}`.trim() || '未填';
    card.innerHTML = `
      <div class="player-header" onclick="this.parentElement.classList.toggle('expanded')">
        <div class="player-info-main">
          <span class="player-name">${escapeHtml(p.name)}</span>
          <span class="player-class">${escapeHtml(gradeClass)}</span>
        </div>
        <i class="fas fa-chevron-down toggle-icon"></i>
      </div>
      <div class="player-details">
        <div class="detail-grid">
          <div><span class="detail-label">暱稱:</span> ${escapeHtml(p.nickname || '-')}</div>
          <div><span class="detail-label">性別:</span> ${escapeHtml(p.gender || '-')}</div>
          <div><span class="detail-label">膠皮:</span> ${escapeHtml(p.paddle || '-')}</div>
          <div><span class="detail-label">持拍:</span> ${escapeHtml(p.hand || '-')}</div>
          <div><span class="detail-label">打法:</span> ${escapeHtml(p.style || '-')}</div>
          <div style="grid-column:1/-1"><span class="detail-label">狀態:</span> <span style="color:${p.isActive==='FALSE'?'red':'green'}">${p.isActive==='FALSE'?'離隊':'在隊'}</span></div>
        </div>
        <div class="leave-item-actions" style="margin-top:10px;">
          <button class="action-btn edit"><i class="fas fa-edit"></i> 編輯</button>
          <button class="action-btn delete"><i class="fas fa-trash-alt"></i> 刪除</button>
        </div>
      </div>
    `;
    card.querySelector('.edit').onclick = e => {
      e.stopPropagation();
      renderAdminPlayerForm(p);
    };
    card.querySelector('.delete').onclick = e => {
      e.stopPropagation();
      confirmDel('delete_player', p.rowId, p.name);
    };
    listContainer.appendChild(card);
  });
}

function renderAdminPlayerForm(player = null) {
  const content = document.getElementById('admin-content');
  const isEdit = !!player;
  const p = player || {};
  const paddles = ['平面','短顆','中顆','長顆','Anti','不詳'];
  const styles = ['刀板','直板','日直','削球'];
  const grades = [6,5,4,3,2,1];
  content.innerHTML = `
    <div class="admin-form-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h3 style="margin:0; color:var(--primary-color);">${isEdit ? '編輯球員' : '新增球員'}</h3>
        <button class="action-btn" onclick="showAdminPlayerList()" style="background:#eee; padding:5px 10px;">取消</button>
      </div>
      <form id="player-form">
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="admin-form-group"><label>姓名 *</label><input type="text" id="p-name" class="admin-input" value="${escapeHtml(p.name||'')}" required></div>
          <div class="admin-form-group"><label>暱稱</label><input type="text" id="p-nick" class="admin-input" value="${escapeHtml(p.nickname||'')}" placeholder="選填"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:10px;">
          <div class="admin-form-group"><label>年級</label><select id="p-grade" class="admin-select"><option value="">選擇</option>${grades.map(g => `<option value="${g}" ${p.grade==g?'selected':''}>${g}</option>`).join('')}</select></div>
          <div class="admin-form-group"><label>班級</label><input type="text" id="p-class" class="admin-input" value="${escapeHtml(p.class||'')}" placeholder="601"></div>
          <div class="admin-form-group"><label>性別</label><select id="p-gender" class="admin-select"><option value="男" ${p.gender==='男'?'selected':''}>男</option><option value="女" ${p.gender==='女'?'selected':''}>女</option></select></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="admin-form-group"><label>膠皮</label><select id="p-paddle" class="admin-select"><option value="">請選擇</option>${paddles.map(pd => `<option value="${pd}" ${p.paddle===pd?'selected':''}>${pd}</option>`).join('')}</select></div>
          <div class="admin-form-group"><label>持拍</label><select id="p-hand" class="admin-select"><option value="右手" ${p.hand==='右手'?'selected':''}>右手</option><option value="左手" ${p.hand==='左手'?'selected':''}>左手</option></select></div>
        </div>
        <div class="admin-form-group"><label>打法 (可複選)</label><div style="display:flex; gap:10px; flex-wrap:wrap; padding:10px; background:#f9f9f9; border-radius:8px;">${styles.map(s => `<label style="display:flex; align-items:center; gap:5px; font-weight:normal; cursor:pointer; font-size:0.9rem;"><input type="checkbox" name="p-style" value="${s}" ${(p.style||'').includes(s)?'checked':''}>${s}</label>`).join('')}</div></div>
        <div class="admin-form-group"><label>狀態</label><select id="p-active" class="admin-select"><option value="TRUE" ${p.isActive!=='FALSE'?'selected':''}>在隊</option><option value="FALSE" ${p.isActive==='FALSE'?'selected':''}>離隊</option></select></div>
        <button type="submit" class="hero-btn" style="width:100%; margin-top:10px;">儲存</button>
      </form>
    </div>
  `;
  document.getElementById('player-form').onsubmit = e => {
    e.preventDefault();
    const styleArr = Array.from(document.querySelectorAll('input[name="p-style"]:checked')).map(cb => cb.value);
    const payload = {
      rowId: p.rowId || null,
      name: document.getElementById('p-name').value.trim(),
      nickname: document.getElementById('p-nick').value.trim(),
      grade: document.getElementById('p-grade').value,
      class: document.getElementById('p-class').value.trim(),
      gender: document.getElementById('p-gender').value,
      paddle: document.getElementById('p-paddle').value,
      hand: document.getElementById('p-hand').value,
      style: styleArr.join('/'),
      photo: '',
      isActive: document.getElementById('p-active').value
    };
    if (!payload.name) { showToast('請輸入姓名'); return; }
    sendToGasWithAuth('save_player', payload);
  };
}

// === 管理：排程 ===
function showAdminScheduleList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">排程管理 (每週固定)</h4>
      <button class="hero-btn" onclick="renderAdminScheduleForm()" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增</button>
    </div>
    <div id="admin-schedule-list" class="leave-list-container"></div>
  `;
  const flatList = [];
  weekdays.forEach(d => {
    defaultSlots.forEach(s => {
      const arr = (schedule[d] && schedule[d][s]) ? schedule[d][s] : [];
      arr.forEach(item => flatList.push({ ...item, day: d, slot: s }));
    });
  });
  const listDiv = document.getElementById('admin-schedule-list');
  if (flatList.length === 0) {
    listDiv.innerHTML = '<div style="text-align:center;">目前無排程</div>';
    return;
  }
  flatList.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item';
    card.innerHTML = `
      <div class="leave-item-header">
        <div class="leave-item-name">${escapeHtml(item.day)} <span style="font-size:0.9rem; font-weight:normal;">${escapeHtml(item.slot)}</span></div>
        <div class="leave-item-date">T${escapeHtml(item.table)}</div>
      </div>
      <div class="leave-item-reason">
        教練: ${escapeHtml(item.coach?.name || '-')}
        <br>選手: ${escapeHtml(item.playerA?.name || '-')}
        ${item.playerB && item.playerB.name ? ' vs ' + escapeHtml(item.playerB.name) : ''}
      </div>
      <div class="leave-item-actions">
        <button class="action-btn edit">編輯</button>
        <button class="action-btn delete">刪除</button>
      </div>
    `;
    card.querySelector('.edit').onclick = () => renderAdminScheduleForm(item);
    card.querySelector('.delete').onclick = () => confirmDel('delete_schedule', item.rowId, '此排程');
    listDiv.appendChild(card);
  });
}

function renderAdminScheduleForm(item = null) {
  const isEdit = !!item;
  const s = item || {};
  const content = document.getElementById('admin-content');
  const coachOpts = staff.map(c => `<option value="${c.id}" ${s.coach && s.coach.id===c.id?'selected':''}>${escapeHtml(c.name)}</option>`).join('');
  const playerOpts = players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  content.innerHTML = `
    <div class="admin-form-card">
      <h3>${isEdit ? '編輯排程' : '新增排程'}</h3>
      <form id="schedule-form">
        <div class="admin-form-group"><label>星期</label><select id="s-day" class="admin-select">${weekdays.map(d => `<option value="${d}" ${s.day===d?'selected':''}>${d}</option>`).join('')}</select></div>
        <div class="admin-form-group"><label>時段</label><select id="s-slot" class="admin-select">${defaultSlots.map(t => `<option value="${t}" ${s.slot===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="admin-form-group"><label>桌次</label><input type="text" id="s-table" class="admin-input" value="${escapeHtml(s.table||'')}" required></div>
        <div class="admin-form-group"><label>教練</label><select id="s-coach" class="admin-select"><option value="">選擇教練</option>${coachOpts}</select></div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="admin-form-group"><label>選手A</label><select id="s-pa" class="admin-select"><option value="">選擇選手</option>${playerOpts}</select></div>
          <div class="admin-form-group"><label>選手B</label><select id="s-pb" class="admin-select"><option value="">選擇選手</option>${playerOpts}</select></div>
        </div>
        <div class="admin-form-group"><label>備註</label><input type="text" id="s-note" class="admin-input" value="${escapeHtml(s.remark||'')}"></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="hero-btn" style="flex:1;">儲存</button>
          <button type="button" class="action-btn" style="background:#eee; padding:10px;" onclick="showAdminScheduleList()">取消</button>
        </div>
      </form>
    </div>
  `;
  // 選擇值
  if (isEdit) {
    // Set selected values for players by id
    if (s.playerA && s.playerA.id) document.getElementById('s-pa').value = s.playerA.id;
    if (s.playerB && s.playerB.id) document.getElementById('s-pb').value = s.playerB.id;
  }
  document.getElementById('schedule-form').onsubmit = e => {
    e.preventDefault();
    const payload = {
      rowId: s.rowId,
      weekday: document.getElementById('s-day').value,
      slot: document.getElementById('s-slot').value,
      table: document.getElementById('s-table').value,
      coachId: document.getElementById('s-coach').value,
      playerAId: document.getElementById('s-pa').value,
      playerBId: document.getElementById('s-pb').value,
      note: document.getElementById('s-note').value
    };
    sendToGasWithAuth('save_schedule', payload);
  };
}

// === 管理：比賽紀錄 ===
function showAdminMatchList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">比賽紀錄</h4>
      <button class="hero-btn" onclick="renderAdminMatchForm()" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增</button>
    </div>
    <div id="admin-match-list" class="leave-list-container"></div>
  `;
  const list = document.getElementById('admin-match-list');
  if (!matches || matches.length === 0) {
    list.innerHTML = '<div style="text-align:center;">無紀錄</div>';
    return;
  }
  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'leave-item';
    const playerNames = m.players.map(id => (players.find(p => p.id === id) || {}).name || id).join('、');
    const opponentNames = m.opponents.join('、');
    card.innerHTML = `
      <div class="leave-item-header">
        <div class="leave-item-name">${escapeHtml(playerNames)} vs ${escapeHtml(opponentNames)}</div>
        <div class="leave-item-date">${escapeHtml(m.date)}</div>
      </div>
      <div class="leave-item-reason">
        <span class="match-type-badge">${m.type==='singles'?'單打':'雙打'}</span>
        總分: <b>${escapeHtml(m.score)}</b>${m.sets ? ` (局分: ${escapeHtml(m.sets)})` : ''}
        ${m.eventName ? `<br><span style="color:#888; font-size:0.9rem;">賽事：${escapeHtml(m.eventName)}</span>` : ''}
      </div>
      <div class="leave-item-actions">
        <button class="action-btn edit">編輯</button>
        <button class="action-btn delete">刪除</button>
      </div>
    `;
    card.querySelector('.edit').onclick = () => renderAdminMatchForm(m);
    card.querySelector('.delete').onclick = () => confirmDel('delete_match', m.rowId, '此紀錄');
    list.appendChild(card);
  });
}

function renderAdminMatchForm(item = null) {
  const isEdit = !!item;
  const m = item || {};
  const content = document.getElementById('admin-content');
  const playerOpts = players.map(p => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  content.innerHTML = `
    <div class="admin-form-card">
      <h3>${isEdit ? '編輯比賽紀錄' : '新增比賽紀錄'}</h3>
      <form id="match-form">
        <div class="admin-form-group"><label>日期</label><input type="date" id="m-date" class="admin-input" required value="${escapeHtml(isEdit ? m.date : formatDate(new Date()))}"></div>
        <div class="admin-form-group"><label>賽事名稱</label><input type="text" id="m-event" class="admin-input" value="${escapeHtml(m.eventName || '')}" placeholder="例如 校際盃"></div>
        <div class="admin-form-group"><label>賽制</label><select id="m-type" class="admin-select" onchange="toggleMatchType(this.value)"><option value="singles" ${m.type!=='doubles'?'selected':''}>單打</option><option value="doubles" ${m.type==='doubles'?'selected':''}>雙打</option></select></div>
        <div style="display:grid; grid-template-columns:1fr 0.2fr 1fr; gap:5px; align-items:center;">
          <div id="team-a"></div><div>vs</div><div id="team-b"></div>
        </div>
        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
          <div class="admin-form-group"><label>總比分 (ex: 3:1)</label><input type="text" id="m-score" class="admin-input" placeholder="3:1" required value="${escapeHtml(m.score || '')}"></div>
          <div class="admin-form-group"><label>局分 (ex: 11-9,8-11)</label><input type="text" id="m-sets" class="admin-input" placeholder="各局比分" value="${escapeHtml(m.sets || '')}"></div>
        </div>
        <div class="admin-form-group"><label>影片連結</label><input type="text" id="m-video" class="admin-input" value="${escapeHtml((m.video||{}).url || '')}"></div>
        <div class="admin-form-group"><label>備註</label><input type="text" id="m-note" class="admin-input" value="${escapeHtml(m.notes || '')}"></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="hero-btn" style="flex:1;">儲存</button>
          <button type="button" class="action-btn" style="background:#eee; padding:10px;" onclick="showAdminMatchList()">取消</button>
        </div>
      </form>
    </div>
  `;
  // 生成選手與對手輸入欄
  window.toggleMatchType = function(type) {
    const teamA = document.getElementById('team-a');
    const teamB = document.getElementById('team-b');
    const selectA = (id, val) => `<select id="${id}" class="admin-select" style="margin-bottom:5px;"><option value="">選擇選手</option>${playerOpts}</select>`;
    const inputOpp = (id, val) => `<input type="text" id="${id}" class="admin-input" placeholder="輸入對手姓名" value="${escapeHtml(val||'')}" style="margin-bottom:5px;">`;
    if (type === 'doubles') {
      teamA.innerHTML = selectA('m-p1') + selectA('m-p2');
      teamB.innerHTML = inputOpp('m-o1', m.opponents && m.opponents[0]) + inputOpp('m-o2', m.opponents && m.opponents[1]);
    } else {
      teamA.innerHTML = selectA('m-p1');
      teamB.innerHTML = inputOpp('m-o1', m.opponents && m.opponents[0]);
    }
    // 若有舊資料，選擇玩家
    if (isEdit) {
      if (m.players && m.players[0]) document.getElementById('m-p1').value = m.players[0] || '';
      if (m.players && m.players[1] && document.getElementById('m-p2')) document.getElementById('m-p2').value = m.players[1] || '';
    }
  };
  window.toggleMatchType(document.getElementById('m-type').value);
  document.getElementById('match-form').onsubmit = e => {
    e.preventDefault();
    const type = document.getElementById('m-type').value;
    const payload = {
      rowId: m.rowId,
      date: document.getElementById('m-date').value,
      eventName: document.getElementById('m-event').value.trim(),
      type: type,
      p1: document.getElementById('m-p1').value,
      p2: type==='doubles' ? (document.getElementById('m-p2') ? document.getElementById('m-p2').value : '') : '',
      o1: document.getElementById('m-o1').value.trim(),
      o2: type==='doubles' ? (document.getElementById('m-o2') ? document.getElementById('m-o2').value.trim() : '') : '',
      score: document.getElementById('m-score').value.trim(),
      sets: document.getElementById('m-sets').value.trim(),
      video: document.getElementById('m-video').value.trim(),
      notes: document.getElementById('m-note').value.trim()
    };
    sendToGasWithAuth('save_match', payload);
  };
}

// === 管理：請假管理 ===
function showAdminLeaveList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <h4 style="margin-bottom:15px; color:var(--primary-color); border-bottom:2px solid #eee; padding-bottom:10px;">全部請假紀錄</h4>
    <div id="admin-leave-list" class="leave-list-container"></div>
  `;
  const listContainer = document.getElementById('admin-leave-list');
  if (!leaveRequests || leaveRequests.length === 0) {
    listContainer.innerHTML = '<div class="card" style="text-align:center; color:#888; padding:20px;">目前尚無請假紀錄</div>';
    return;
  }
  leaveRequests.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item';
    card.innerHTML = `
      <div class="leave-item-header">
        <div class="leave-item-name">${escapeHtml(item.name)}</div>
        <div class="leave-item-date">${escapeHtml(item.date)}<br><span style="font-size:0.8em; opacity:0.8;">${escapeHtml(item.slot)}</span></div>
      </div>
      <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
      <div class="leave-item-actions">
        <button class="action-btn edit"><i class="fas fa-edit"></i> 編輯</button>
        <button class="action-btn delete"><i class="fas fa-trash-alt"></i> 刪除</button>
      </div>
    `;
    card.querySelector('.edit').onclick = () => renderAdminLeaveForm(item);
    card.querySelector('.delete').onclick = () => confirmDel('delete_leave', item.rowId, item.name);
    listContainer.appendChild(card);
  });
}

function renderAdminLeaveForm(item) {
  const content = document.getElementById('admin-content');
  const s = item || {};
  content.innerHTML = `
    <div class="admin-form-card">
      <h3>${s.rowId ? '編輯請假' : '新增請假'}</h3>
      <form id="leave-form-admin">
        <div class="admin-form-group"><label>姓名</label><input type="text" id="l-name" class="admin-input" value="${escapeHtml(s.name||'')}" required></div>
        <div class="admin-form-group"><label>日期</label><input type="date" id="l-date" class="admin-input" value="${escapeHtml(s.date||formatDate(new Date()))}" required></div>
        <div class="admin-form-group"><label>時段</label><select id="l-slot" class="admin-select">${defaultSlots.map(t => `<option value="${t}" ${s.slot===t?'selected':''}>${t}</option>`).join('')}</select></div>
        <div class="admin-form-group"><label>原因</label><textarea id="l-reason" class="admin-textarea" rows="4">${escapeHtml(s.reason||'')}</textarea></div>
        <div style="display:flex; gap:10px;">
          <button type="submit" class="hero-btn" style="flex:1;">儲存</button>
          <button type="button" class="action-btn" style="background:#eee; padding:10px;" onclick="showAdminLeaveList()">取消</button>
        </div>
      </form>
    </div>
  `;
  document.getElementById('leave-form-admin').onsubmit = e => {
    e.preventDefault();
    const payload = {
      rowId: s.rowId,
      name: document.getElementById('l-name').value.trim(),
      date: document.getElementById('l-date').value,
      slot: document.getElementById('l-slot').value,
      reason: document.getElementById('l-reason').value.trim()
    };
    if (s.rowId) {
      sendToGasWithAuth('update_leave', payload);
    } else {
      sendToGasWithAuth('add_leave', payload);
    }
  };
}

// === 管理：設定 ===
function showAdminSettings() {
  const content = document.getElementById('admin-content');
  const currentBg = (heroConfig && heroConfig.hero_bg_url) || '';
  content.innerHTML = `
    <div class="admin-form-card">
      <h3 style="margin-top:0; color:var(--primary-color);">網站外觀設定</h3>
      <div class="admin-form-group"><label>Hero Banner 圖片連結</label><input type="text" id="conf-hero-bg" class="admin-input" value="${escapeHtml(currentBg)}" placeholder="請輸入圖片 URL"></div>
      <small style="color:#666; display:block; margin-bottom:15px;">建議使用橫式高畫質圖片 (1920x1080)</small>
      <button id="btn-save-config" class="hero-btn" style="width:100%;">儲存設定</button>
    </div>
  `;
  document.getElementById('btn-save-config').onclick = () => {
    const url = document.getElementById('conf-hero-bg').value.trim();
    sendToGasWithAuth('update_config', { hero_bg_url: url });
  };
}

// === 入口初始化 ===
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initNavigation();
  // 綁定主動元素
  const scheduleSearch = document.getElementById('schedule-search');
  if (scheduleSearch) scheduleSearch.oninput = () => renderSchedule();
  const rosterSearch = document.getElementById('roster-search');
  if (rosterSearch) rosterSearch.oninput = () => renderRoster();
  // 初始路由
  const hash = location.hash ? location.hash.replace('#','') : 'home';
  navigateTo(hash, false);
});