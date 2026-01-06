// script.js - Full Fixed Version

/*
 * 這個檔案包含前端邏輯，包括：
 * - 側邊導覽切換
 * - 渲染不同頁面內容
 * - 假資料初始化（可改成從 API 讀取）
 * - 提交/刪除請假
 * - 簡易比賽紀錄篩選與選手分析
 * - 管理模式登入與新增公告
 */

// === Google Sheets 設定區 ===
const SPREADSHEET_ID = '1mRcCNQSlTVwRRy7u9Yhx9knsw_0ZUyI0p6dMFgO-6os';

// === GAS 後端設定 ===
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// === 全域變數宣告 ===
let announcements = [];
let schedule = {};
let players = [];
let staff = [];
let matches = [];
let parents = [];
let parentChild = [];
let accounts = [];
let leaveRequestsData = [];
let adminLoggedIn = false;  // ★ 已補上：管理員登入狀態

// 訓練排程相關常數
const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = [
  '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00',
  '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
  '15:00-16:00', '16:00-17:00'
];

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
initEmptySchedule();

// 載入所有資料：從 GAS API 一次取回
async function loadAllData() {
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_all_data`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // 使用 normalizeData 進行欄位轉換
    const data = normalizeData(result);

    // 1) 全域變數賦值
    announcements = data.announcements || [];
    players = data.players || [];
    staff = data.staff || [];
    matches = data.matches || [];
    parents = data.parents || [];
    parentChild = data.parentChild || [];
    accounts = data.accounts || [];
    leaveRequestsData = data.leaveRequests || [];
    window.heroConfig = data.hero || {};

    // 2) 排程處理：轉為 UI 需要的巢狀物件 schedule[day][slot] = []
    initEmptySchedule();

    if (data.schedules && Array.isArray(data.schedules)) {
      data.schedules.forEach(item => {
        const day = item.date;   // 例如：'週一'
        const slot = item.slot;  // 例如：'18:00-19:00'

        if (schedule[day] && schedule[day][slot]) {
          schedule[day][slot].push({
            table: item.table,
            coach: item.coach,
            playerA: item.playerA,
            playerB: item.playerB,
            remark: item.remark || ''
          });
        }
      });
    }

    console.log('資料同步完成', data);
  } catch (e) {
    console.error('載入失敗', e);
    // Fallback: 顯示錯誤提示
    announcements = [
      { id: 1, date: new Date().toISOString().split('T')[0], title: '系統連線異常', content: '無法連線至資料庫，請稍後再試。' }
    ];
  } finally {
    // 移除 Loading 畫面
    const loader = document.getElementById('app-loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }
  }
}

// 通用 GAS 寫入函式 (公開操作用)
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
      body: JSON.stringify({ action, payload })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    if (result && result.success) {
      showToast(result.message || '操作成功');
      await loadAllData();
      
      // 刷新當前頁面
      const scheduleSection = document.getElementById('schedule');
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) renderSchedule();
      
      const leaveSection = document.getElementById('leave');
      if (leaveSection && !leaveSection.classList.contains('hidden')) renderLeaveList();
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

// ★ 新增：驗證並發送請求的通用函式 (管理功能核心)
async function sendToGasWithAuth(action, payload) {
    const password = document.getElementById('admin-password')?.value || prompt('請輸入管理密碼確認操作：');
    if(!password) return;

    showToast('處理中...');
    
    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action, payload, password })
        });
        const result = await response.json();
        if(result.success) {
            showToast(result.message);
            await loadAllData(); 
            
            // 根據 action 刷新畫面
            if(action === 'update_config') renderHome();
            if(action.includes('leave') && typeof showAdminLeaveList === 'function') showAdminLeaveList();
        } else {
            showToast('失敗: ' + result.message);
        }
    } catch(e) {
        console.error(e);
        showToast('連線錯誤');
    }
}

// 請假資料存取 (Local Fallback)
function loadLeaveRequests() {
  if (leaveRequestsData && leaveRequestsData.length > 0) return leaveRequestsData;
  return [];
}

// === UI 互動邏輯 ===
function openSidebar() { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

// 導航系統
let navStack = [];

function initNavigation() {
  const sidebarNav = document.querySelector('nav#sidebar');
  if (sidebarNav) {
    sidebarNav.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-section]');
      if (!link) return;
      e.preventDefault();
      const section = link.dataset.section;
      if (section) {
        navigateTo(section);
        if (window.innerWidth < 768) closeSidebar();
      }
    });
  }

  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (!btn) return;
      const section = btn.dataset.section;
      if (section) navigateTo(section);
    });
  }

  const menuToggleEl = document.getElementById('menu-toggle');
  if (menuToggleEl) {
    menuToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    });
  }

  const overlayEl = document.getElementById('overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) closeSidebar();
      else hideModal();
    });
  }

  const backBtn = document.getElementById('back-button');
  if (backBtn) {
    backBtn.addEventListener('click', () => goBack());
  }

  // 瀏覽器返回
  window.addEventListener('popstate', (e) => {
    const section = (e.state && e.state.section) ? e.state.section : (location.hash ? location.hash.replace('#', '') : 'home');
    navigateTo(section, false);
    if (navStack.length > 1) navStack.pop();
    updateBackButton();
  });
  
  // 底部導航 RWD
  const syncBottomNavVisibility = () => {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    if (window.innerWidth < 768) nav.classList.remove('hidden');
    else nav.classList.add('hidden');
  };
  syncBottomNavVisibility();
  window.addEventListener('resize', syncBottomNavVisibility);
}

function updateBackButton() {
  const backBtn = document.getElementById('back-button');
  if (!backBtn) return;
  if (navStack.length > 1) {
    backBtn.classList.remove('hidden');
    document.body.classList.add('show-back-button');
  } else {
    backBtn.classList.add('hidden');
    document.body.classList.remove('show-back-button');
  }
}

function goBack() {
  if (navStack.length <= 1) return;
  history.back();
}

function navigateTo(sectionId, pushState = true) {
  const targetId = sectionId || 'home';

  document.querySelectorAll('main > section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');

    switch (targetId) {
      case 'home': renderHome(); break;
      case 'announcements': renderAnnouncements(); break;
      case 'schedule': renderSchedule(); break;
      case 'leave': renderLeave(); break;
      case 'matches': renderMatches(); break;
      case 'roster': renderRoster(); break;
      case 'media': renderMedia(); break;
      case 'admin': renderAdmin(); break;
      default: break;
    }
  }

  document.querySelectorAll('nav#sidebar a[data-section], #bottom-nav button[data-section]').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.section === targetId) el.classList.add('active');
  });

  const last = navStack.length ? navStack[navStack.length - 1] : null;
  if (pushState && last !== targetId) {
    history.pushState({ section: targetId }, '', '#' + targetId);
    navStack.push(targetId);
    updateBackButton();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 頁面渲染邏輯
function renderHome() {
  // Hero Banner
  const bgUrl = window.heroConfig && (window.heroConfig.hero_bg_url || window.heroConfig.heroBgUrl);
  const heroBg = document.querySelector('#home .hero-bg-placeholder');
  if (heroBg) {
    if (bgUrl) {
      heroBg.style.backgroundImage = `url(${convertDriveLink(bgUrl)})`;
      heroBg.style.backgroundSize = 'cover';
      heroBg.style.backgroundPosition = 'center';
    } else {
      heroBg.style.backgroundImage = '';
    }
  }

  // 最新公告
  const homeAnnouncements = document.getElementById('home-announcements');
  if (homeAnnouncements) {
    homeAnnouncements.innerHTML = '';
    const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
    sorted.slice(0, 3).forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
          <h4 style="margin:0; color:var(--primary-color);">${item.title}</h4>
          <span style="font-size:0.8rem; color:#888; white-space:nowrap;">${item.date}</span>
        </div>
        <p style="margin:6px 0 0; color:#555; font-size:0.9rem; line-height:1.4;">
          ${escapeHtml(String(item.content || '')).substring(0, 60)}${(item.content && String(item.content).length > 60) ? '…' : ''}
        </p>
      `;
      card.addEventListener('click', () => showAnnouncementDetail(item));
      homeAnnouncements.appendChild(card);
    });
  }

  // 今日請假
  const leaveContainer = document.getElementById('home-leave-overview');
  if (leaveContainer) {
    leaveContainer.innerHTML = '';
    const leaves = loadLeaveRequests();
    const todayStr = new Date().toISOString().split('T')[0];
    const todaysLeaves = leaves.filter(l => (l.date || '') === todayStr);

    if (todaysLeaves.length === 0) {
      leaveContainer.innerHTML = `<div class="card" style="text-align:center; color:#888;">今日無人請假</div>`;
    } else {
      todaysLeaves.forEach(l => {
        const card = document.createElement('div');
        card.className = 'card';
        card.style.cssText = 'padding:10px; border-left:4px solid #e74c3c;';
        card.innerHTML = `
          <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
            <strong>${escapeHtml(l.name || '')}</strong>
            <span style="font-size:0.9rem; color:#666; white-space:nowrap;">${escapeHtml(l.slot || '')}</span>
          </div>
          <div style="margin-top:4px; font-size:0.85rem; color:#666;">${escapeHtml(l.reason || '')}</div>
        `;
        leaveContainer.appendChild(card);
      });
    }
  }
}

function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  if (sorted.length === 0) {
    listDiv.innerHTML = `<div class="card" style="text-align:center; color:#888;">尚無公告</div>`;
    return;
  }

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <h4 style="margin:0;">${escapeHtml(item.title || '')}</h4>
        <span style="font-size:0.8rem; color:#888; white-space:nowrap;">${escapeHtml(item.date || '')}</span>
      </div>
      <p style="margin:6px 0 0; color:#555; font-size:0.9rem; line-height:1.5;">
        ${escapeHtml(String(item.content || '')).substring(0, 90)}${(item.content && String(item.content).length > 90) ? '…' : ''}
      </p>
    `;
    card.addEventListener('click', () => showAnnouncementDetail(item));
    listDiv.appendChild(card);
  });
}

function showAnnouncementDetail(item) {
  const modal = document.getElementById('announcement-detail');
  modal.innerHTML = `
      <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
      <h3 style="margin-top:10px; color:var(--primary-color); padding-right:30px;">${item.title}</h3>
      <div style="color:#888; font-size:0.85rem; margin-bottom:15px; border-bottom:1px dashed #eee; padding-bottom:10px;">
          <i class="far fa-calendar-alt"></i> ${item.date}
      </div>
      <div style="line-height:1.8; color:#333; font-size:0.95rem;">
          ${item.content.replace(/\n/g, '<br>')}
      </div>
  `;
  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

function hideModal() {
  document.querySelectorAll('.modal').forEach(m => {
      m.classList.remove('active');
      if (m.classList.contains('video-modal-content')) {
        m.classList.remove('video-modal-content');
        m.innerHTML = '';
      }
  });
  document.body.classList.remove('modal-open');
  const analysis = document.getElementById('player-analysis');
  if (analysis) analysis.classList.add('hidden');
}

function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  container.innerHTML = '';

  const isMobile = window.innerWidth < 768;
  const qEl = document.getElementById('schedule-search');
  const query = (qEl ? qEl.value : '').trim().toLowerCase();

  const entryMatches = (entry) => {
    if (!query) return true;
    const a = (entry?.playerA?.name || '').toLowerCase();
    const b = (entry?.playerB?.name || '').toLowerCase();
    const coach = (entry?.coach?.name || '').toLowerCase();
    const table = String(entry?.table ?? '').toLowerCase();
    return a.includes(query) || b.includes(query) || coach.includes(query) || table.includes(query);
  };

  let anyMatchOverall = false;

  weekdays.forEach((day, index) => {
    const matchedBySlot = {};
    let dayHasAny = false;
    let dayHasMatch = false;

    defaultSlots.forEach(slot => {
      const entries = (schedule[day] && schedule[day][slot]) ? schedule[day][slot] : [];
      if (entries.length > 0) dayHasAny = true;
      const matched = entries.filter(entryMatches);
      if (matched.length > 0) {
        matchedBySlot[slot] = matched;
        dayHasMatch = true;
      }
    });

    if (query && !dayHasMatch) return;
    if (query && dayHasMatch) anyMatchOverall = true;

    const header = document.createElement('div');
    header.className = 'accordion-header';
    const todayDayIndex = new Date().getDay();
    const isToday = (index + 1) === todayDayIndex || (index === 6 && todayDayIndex === 0);
    header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-down"></i>`;

    const content = document.createElement('div');
    content.className = 'accordion-content';
    const shouldOpen = query ? true : isToday;
    if (shouldOpen) {
      content.classList.add('show');
      header.classList.add('active');
    }

    header.addEventListener('click', () => {
      content.classList.toggle('show');
      header.classList.toggle('active');
    });

    container.appendChild(header);
    container.appendChild(content);

    if (!query && !dayHasAny) {
      content.innerHTML = '<div style="padding:10px; color:#999; text-align:center;">本日無排程</div>';
      return;
    }

    const slotsToRender = query ? Object.keys(matchedBySlot) : defaultSlots.filter(s => (schedule[day] && schedule[day][s] && schedule[day][s].length > 0));
    
    slotsToRender.forEach(slot => {
      const entries = query ? (matchedBySlot[slot] || []) : (schedule[day] && schedule[day][slot] ? schedule[day][slot] : []);
      if (!entries || entries.length === 0) return;

      const slotHeader = document.createElement('div');
      slotHeader.className = 'time-slot-header';
      slotHeader.textContent = slot;
      content.appendChild(slotHeader);

      const grid = document.createElement('div');
      grid.className = isMobile ? 'compact-grid' : 'card-container';

      entries.forEach(entry => {
        const card = document.createElement('div');
        if (isMobile) {
          card.className = 'compact-card';
          card.innerHTML = `
            <div class="table-badge">T${escapeHtml(String(entry.table ?? ''))}</div>
            <div class="coach-name">${escapeHtml(entry?.coach?.name || '')}</div>
            <div class="players">${escapeHtml(entry?.playerA?.name || '')}<br>${escapeHtml(entry?.playerB?.name || '')}</div>
          `;
        } else {
          card.className = 'card';
          card.innerHTML = `
            <h4 style="margin:0 0 6px;">桌次 ${escapeHtml(String(entry.table ?? ''))}</h4>
            <p style="margin:0 0 6px;"><i class="fas fa-user-tie"></i> ${escapeHtml(entry?.coach?.name || '')}</p>
            <p style="margin:0; color:#666;">${escapeHtml(entry?.playerA?.name || '')} vs ${escapeHtml(entry?.playerB?.name || '')}</p>
          `;
        }
        grid.appendChild(card);
      });
      content.appendChild(grid);
    });
  });

  if (query && !anyMatchOverall) {
    container.innerHTML = `<div class="card" style="text-align:center; color:#888;">查無符合的排程</div>`;
  }
}

function renderRoster() {
  const playerDiv = document.getElementById('roster-players');
  const staffDiv = document.getElementById('roster-staff');
  if (!playerDiv || !staffDiv) return;

  const qEl = document.getElementById('roster-search');
  const searchVal = (qEl ? qEl.value : '').trim().toLowerCase();
  playerDiv.innerHTML = '';
  staffDiv.innerHTML = '';

  const createRosterCard = (name, info, icon) => {
    const card = document.createElement('div');
    card.className = 'card';
    card.setAttribute('data-tilt', '');
    card.innerHTML = `
      <div class="img-placeholder"><i class="fas ${icon}"></i></div>
      <h4>${escapeHtml(name || '')}</h4>
      <p>${escapeHtml(info || '')}</p>
    `;
    return card;
  };

  staff.forEach(c => {
    const name = c?.name || '';
    if (!searchVal || name.toLowerCase().includes(searchVal)) {
        staffDiv.appendChild(createRosterCard(name, '教練', 'fa-user-tie'));
    }
  });

  players.forEach(p => {
    const name = p?.name || '';
    const number = String(p?.number ?? '');
    const hit = !searchVal || name.toLowerCase().includes(searchVal) || number.toLowerCase().includes(searchVal);
    if (hit) {
        playerDiv.appendChild(createRosterCard(name, `${p?.class || ''} | #${number}`, 'fa-user'));
    }
  });

  if (window.VanillaTilt) {
    VanillaTilt.init(document.querySelectorAll('.card[data-tilt]'), {
      max: 10, speed: 400, glare: true, 'max-glare': 0.2, scale: 1.02
    });
  }
}

function renderLeave() {
  const form = document.getElementById('leave-form');
  const delBtn = document.getElementById('delete-selected-leave');

  if (form) {
    form.reset();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const name = (document.getElementById('leave-name')?.value || '').trim();
      const date = document.getElementById('leave-date')?.value || '';
      const slot = document.getElementById('leave-slot')?.value || '';
      const reason = (document.getElementById('leave-reason')?.value || '').trim();

      if (!name || !date || !slot) return;
      const payload = { name, date, slot, reason };
      await sendToGas('add_leave', payload);
      form.reset();
    };
  }
  
  // ★ 前台刪除：需要密碼驗證
  if (delBtn) {
    delBtn.onclick = async () => {
      const checkboxes = document.querySelectorAll('#leave-list input[type="checkbox"]:checked');
      const idsToDelete = Array.from(checkboxes).map(cb => cb.value); // rowId
      if (idsToDelete.length === 0) return;
      if (!confirm(`確定要刪除這 ${idsToDelete.length} 筆紀錄嗎？(需要管理密碼)`)) return;
      
      const password = prompt('請輸入管理密碼以確認刪除：');
      if(!password) return;

      showToast('刪除中...');
      for (const rowId of idsToDelete) {
          await fetch(GAS_API_URL, {
              method: 'POST',
              body: JSON.stringify({ action: 'delete_leave', payload: { rowId }, password })
          });
      }
      showToast('刪除完成');
      await loadAllData();
      renderLeaveList();
    };
  }

  renderLeaveList();
}

function renderLeaveList() {
  const listDiv = document.getElementById('leave-list');
  const delBtn = document.getElementById('delete-selected-leave');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  
  const list = loadLeaveRequests();
  if (!list || list.length === 0) {
    listDiv.textContent = '目前沒有請假紀錄';
    if (delBtn) delBtn.disabled = true;
    return;
  }

  const table = document.createElement('table');
  table.className = 'admin-table'; // Reuse style
  table.innerHTML = `<thead><tr><th></th><th>姓名</th><th>日期</th><th>時段</th><th>原因</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');

  list.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><input type="checkbox" value="${item.rowId}"></td>
      <td>${escapeHtml(item.name || '')}</td>
      <td>${escapeHtml(item.date || '')}</td>
      <td>${escapeHtml(item.slot || '')}</td>
      <td>${escapeHtml(item.reason || '')}</td>
    `;
    tbody.appendChild(tr);
  });
  
  const responsiveDiv = document.createElement('div');
  responsiveDiv.className = 'table-responsive';
  responsiveDiv.appendChild(table);
  listDiv.appendChild(responsiveDiv);

  if (delBtn) delBtn.disabled = false;
}

function renderMatches() {
    const listDiv = document.getElementById('match-list');
    listDiv.innerHTML = '';
    const keywordInput = document.getElementById('match-keyword');
    const chkSingles = document.getElementById('filter-singles');
    const chkDoubles = document.getElementById('filter-doubles');

    function updateList() {
        listDiv.innerHTML = '';
        const keyword = keywordInput ? keywordInput.value.trim() : '';
        const showSingles = chkSingles ? chkSingles.checked : true;
        const showDoubles = chkDoubles ? chkDoubles.checked : true;

        const filtered = matches.filter(m => {
            let typeMatch = false;
            if (showSingles && m.type === 'singles') typeMatch = true;
            if (showDoubles && m.type === 'doubles') typeMatch = true;

            const hasPlayer = (id) => {
                const name = (players.find(p => p.id === id)?.name || id);
                return name.includes(keyword);
            };
            const playerMatch = keyword === '' || m.players.some(hasPlayer) || m.opponents.some(hasPlayer);
            return typeMatch && playerMatch;
        });

        if (filtered.length === 0) {
            listDiv.innerHTML = '<div style="text-align:center; color:#999; padding:20px;">沒有符合的比賽紀錄</div>';
            return;
        }

        filtered.forEach(item => {
            const card = document.createElement('div');
            card.className = 'match-card';
            const playerNames = item.players.map(id => players.find(p => p.id === id)?.name || id).join('、');
            const opponentNames = item.opponents.map(id => players.find(p => p.id === id)?.name || id).join('、');
            const typeLabel = item.type === 'singles' ? '單打' : '雙打';

            card.innerHTML = `
                <div class="match-card-header"><span class="match-type-badge">${typeLabel}</span><span>${item.date}</span></div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="match-card-vs"><span>${playerNames}</span><i class="fas fa-times"></i><span>${opponentNames}</span></div>
                    <div class="match-card-score">${item.score}</div>
                </div>
            `;
            card.addEventListener('click', () => {
                const detailPanel = document.getElementById('player-analysis');
                if (card.classList.contains('selected')) {
                    card.classList.remove('selected');
                    detailPanel.classList.add('hidden');
                } else {
                    document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    showMatchDetail(item);
                }
            });
            listDiv.appendChild(card);
        });
    }

    if(keywordInput) keywordInput.oninput = updateList;
    if(chkSingles) chkSingles.onchange = updateList;
    if(chkDoubles) chkDoubles.onchange = updateList;
    updateList();
}

function showMatchDetail(item) {
    const modal = document.getElementById('player-analysis');
    const getPName = (id) => players.find(p => p.id === id)?.name || id;
    const playerNames = item.players.map(getPName).join('、');
    const opponentNames = item.opponents.map(getPName).join('、');

    modal.innerHTML = `
        <button class="btn-close-absolute" onclick="closeMatchDetail()"><i class="fas fa-times"></i></button>
        <h3 style="margin:0 0 10px 0; color:var(--primary-color);">${item.type === 'singles' ? '單打' : '雙打'}詳情</h3>
        <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:15px;">
            <div style="font-weight:bold; color:#333; margin-bottom:5px;">${playerNames} <span style="color:#e74c3c;">vs</span> ${opponentNames}</div>
            <div style="font-size:0.9rem; color:#666;">日期：${item.date}</div>
            <div style="font-size:0.9rem; color:#666;">比分：<span style="font-weight:bold; color:var(--primary-dark);">${item.score}</span></div>
        </div>
        ${item.video && item.video.url ? `
        <div style="margin-top:10px;">
             ${item.video.provider === 'yt' ? 
                `<iframe src="${item.video.url.replace('watch?v=', 'embed/')}" style="width:100%; height:200px; border-radius:8px; border:none;" allowfullscreen></iframe>` : 
                `<a href="${item.video.url}" target="_blank" class="hero-btn" style="display:block; text-align:center; font-size:0.9rem;">前往觀看影片</a>`}
        </div>` : ''}
    `;
    modal.classList.remove('hidden');
    modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function closeMatchDetail() {
    document.getElementById('player-analysis').classList.add('hidden');
    document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
}

function renderMedia() {
  const container = document.getElementById('media-list');
  if (!container) return;
  container.className = 'video-grid';
  container.innerHTML = '';
  const videos = (matches || []).filter(m => m.video && m.video.url);

  if (videos.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#aaa;">目前尚無影音紀錄</div>';
    return;
  }

  const getYouTubeID = (url) => {
    if (!url) return null;
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11}).*/;
    const match = String(url).match(regExp);
    return match ? match[2] : null;
  };
  
  // Fallback thumbnail
  const fallbackThumb = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450"><rect width="800" height="450" fill="#333"/><text x="400" y="225" text-anchor="middle" fill="#777" font-size="24">Video</text></svg>')}`;

  videos.forEach(item => {
    const ytId = getYouTubeID(item.video.url);
    const thumbUrl = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : fallbackThumb;
    const playerNames = (item.players || []).map(id => players.find(p=>p.id===id)?.name||id).join('、');
    const opponentNames = (item.opponents || []).map(id => players.find(p=>p.id===id)?.name||id).join('、');

    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="video-thumb-container">
        <img src="${thumbUrl}" class="video-thumb" loading="lazy">
        <div class="play-icon-overlay"><i class="far fa-play-circle"></i></div>
      </div>
      <div class="video-info">
        <div class="video-title">${playerNames} <span style="color:#bbb;">vs</span> ${opponentNames}</div>
        <div class="video-meta"><span>${item.date || ''}</span></div>
      </div>
    `;
    card.onclick = () => { if (ytId) openVideoModal(ytId); else window.open(item.video.url, '_blank'); };
    container.appendChild(card);
  });
}

function openVideoModal(ytId) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;
  modal.innerHTML = `
    <div style="position:relative; width:100%; height:100%;">
      <button class="btn-close-absolute" onclick="hideModal()" style="top:10px; right:10px; color:white;"><i class="fas fa-times"></i></button>
      <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0" style="width:100%; height:100%; border:none;" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    </div>
  `;
  modal.classList.add('video-modal-content');
  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

// === 管理後台邏輯 ===
function renderAdmin() {
  const loginDiv = document.getElementById('admin-login');
  const dashDiv = document.getElementById('admin-dashboard');
  const errorP = document.getElementById('admin-login-error');

  if (!loginDiv || !dashDiv) return;

  if (!adminLoggedIn) {
    loginDiv.classList.remove('hidden');
    dashDiv.classList.add('hidden');
    if (errorP) errorP.classList.add('hidden');
  } else {
    loginDiv.classList.add('hidden');
    dashDiv.classList.remove('hidden');
  }

  const loginBtn = document.getElementById('admin-login-btn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const pwd = (document.getElementById('admin-password')?.value || '').trim();
      if (!pwd) { if (errorP) errorP.classList.remove('hidden'); return; }

      loginBtn.textContent = '驗證中...';
      loginBtn.disabled = true;

      try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'check_auth', password: pwd })
        });
        const result = await response.json();

        if (result.success) {
            adminLoggedIn = true;
            document.getElementById('admin-password').value = pwd; 
            renderAdmin();
            showToast('登入成功');
        } else {
            if (errorP) { errorP.textContent = '密碼錯誤'; errorP.classList.remove('hidden'); }
        }
      } catch (e) {
          showToast('連線錯誤，無法登入');
      } finally {
          loginBtn.textContent = '登入';
          loginBtn.disabled = false;
      }
    };
  }

  const addAnnBtn = document.getElementById('admin-add-announcement');
  if (addAnnBtn) addAnnBtn.onclick = () => renderAdminAnnouncementForm();

  const viewLeaveBtn = document.getElementById('admin-view-leave');
  if (viewLeaveBtn) viewLeaveBtn.onclick = () => showAdminLeaveList();

  const manageScheduleBtn = document.getElementById('admin-manage-schedule');
  if (manageScheduleBtn) manageScheduleBtn.onclick = () => { document.getElementById('admin-content').innerHTML = '<p>排程管理功能即將開放。</p>'; };
}

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
  document.getElementById('new-ann-date').value = new Date().toISOString().split('T')[0];
  
  document.getElementById('admin-ann-form').onsubmit = (e) => {
    e.preventDefault();
    const title = document.getElementById('new-ann-title').value.trim();
    const date = document.getElementById('new-ann-date').value;
    const contentText = document.getElementById('new-ann-content').value.trim();
    if (!title || !date || !contentText) return;

    sendToGasWithAuth('add_announcement', { title, date, content: contentText });
    // 成功後會由 sendToGasWithAuth 重新載入
  };
}

// ★ 新增：管理後台 - 請假列表 (編輯/刪除)
function showAdminLeaveList() {
  const contentDiv = document.getElementById('admin-content');
  contentDiv.innerHTML = '<h4>全部請假紀錄</h4><div class="table-responsive"><table class="admin-table" id="admin-leave-table"></table></div>';
  
  const list = loadLeaveRequests();
  const table = document.getElementById('admin-leave-table');

  if (!list || list.length === 0) {
    contentDiv.innerHTML += '<p style="color:#888;">尚無請假紀錄</p>';
    return;
  }

  table.innerHTML = `<thead><tr><th>姓名</th><th>日期</th><th>時段</th><th>原因</th><th>操作</th></tr></thead><tbody></tbody>`;
  const tbody = table.querySelector('tbody');
  
  list.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.date)}</td>
      <td>${escapeHtml(item.slot)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;">${escapeHtml(item.reason)}</td>
      <td>
        <button class="btn-icon edit" title="編輯"><i class="fas fa-edit"></i></button>
        <button class="btn-icon delete" title="刪除"><i class="fas fa-trash-alt"></i></button>
      </td>
    `;
    tr.querySelector('.edit').onclick = () => {
       const newReason = prompt('修改請假原因：', item.reason);
       if(newReason !== null) sendToGasWithAuth('update_leave', { rowId: item.rowId, name: item.name, date: item.date, slot: item.slot, reason: newReason });
    };
    tr.querySelector('.delete').onclick = () => {
        if(confirm(`確定要刪除 ${item.name} 的請假嗎？`)) sendToGasWithAuth('delete_leave', { rowId: item.rowId });
    };
    tbody.appendChild(tr);
  });
}

// ★ 新增：管理後台 - 網站外觀設定
function showAdminSettings() {
    const contentDiv = document.getElementById('admin-content');
    const currentBg = (window.heroConfig && window.heroConfig.hero_bg_url) || '';
    
    contentDiv.innerHTML = `
        <div class="admin-form-card">
            <h3 style="margin-top:0; color:var(--primary-color);">網站外觀設定</h3>
            <div class="admin-form-group">
                <label>Hero Banner 圖片連結</label>
                <input type="text" id="conf-hero-bg" class="admin-input" value="${escapeHtml(currentBg)}" placeholder="請輸入圖片 URL (例如 Drive 圖片連結)">
                <small style="color:#666;">建議使用 1920x1080 圖片</small>
            </div>
            <button id="btn-save-config" class="hero-btn" style="width:100%;">儲存設定</button>
        </div>
    `;
    
    document.getElementById('btn-save-config').onclick = () => {
        const url = document.getElementById('conf-hero-bg').value.trim();
        sendToGasWithAuth('update_config', { hero_bg_url: url });
    };
}

// Utils & Helpers
function escapeHtml(str) {
  return String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function formatDate(value) {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString().split('T')[0];
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
  return s;
}

function convertDriveLink(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (s.includes('googleusercontent.com')) return s;
  let id = '';
  const m1 = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) id = m1[1];
  else { const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/); if (m2) id = m2[1]; }
  if (!id) return s;
  return `https://drive.google.com/uc?export=view&id=${id}`;
}

function normalizeData(rawData) {
  const config = rawData.hero || rawData.config || {};
  const announcements = (rawData.announcements || []).map(r => ({
    id: r.announcement_id ?? r.id,
    date: formatDate(r.date),
    title: r.title || '',
    content: r.content || ''
  }));

  const players = (rawData.players || []).map(r => ({
    rowId: r.rowId,
    id: r.player_id ?? r.id,
    name: r.student_name ?? r.name ?? '',
    number: r.team_no ?? r.number ?? '',
    class: r.class ?? '',
    photo: convertDriveLink(r.photo_url ?? r.photo ?? ''),
    positions: r.positions ?? ''
  }));

  const scheduleData = [];
  (rawData.training_schedule || []).forEach(r => {
    scheduleData.push({
      rowId: r.rowId,
      date: r.weekday,
      slot: r.slot,
      table: r.table_no,
      coach: { name: r.coach_id },
      playerA: { name: r.player_a_id },
      playerB: { name: r.player_b_id },
      remark: r.note || ''
    });
  });

  const leaveRequests = (rawData.leave_requests || []).map(r => ({
    id: r.request_id || r.id,
    rowId: r.rowId,
    name: r.created_by_email || r.name || '未填寫',
    date: formatDate(r.leave_date || r.date),
    slot: r.slot || '',
    reason: r.reason || '',
    status: r.status || 'pending'
  }));

  const matches = rawData.matches || [];

  return {
    hero: config,
    announcements,
    players,
    schedules: scheduleData,
    staff: rawData.staff || [],
    matches,
    leaveRequests,
    parents: rawData.parents || [],
    parentChild: rawData.parent_child || [],
    accounts: rawData.accounts || [],
    videos: rawData.media || []
  };
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-info-circle" style="margin-right:8px; color:var(--accent-gold);"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 400); }, 3000);
}

// Init
document.addEventListener('DOMContentLoaded', async () => {
  await loadAllData();
  initNavigation();
  const scheduleSearch = document.getElementById('schedule-search');
  if (scheduleSearch) {
    scheduleSearch.addEventListener('input', () => {
      const scheduleSection = document.getElementById('schedule');
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) renderSchedule();
    });
  }
  const heroBtn = document.getElementById('hero-btn');
  if (heroBtn) heroBtn.addEventListener('click', () => navigateTo('schedule'));

  const initial = (location.hash ? location.hash.replace('#', '') : 'home') || 'home';
  history.replaceState({ section: initial }, '', '#' + initial);
  navStack = [initial];
  updateBackButton();
  navigateTo(initial, false);

  let lastWidth = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;
      const scheduleSection = document.getElementById('schedule');
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) renderSchedule();
      const bottomNav = document.getElementById('bottom-nav');
      if (bottomNav) {
        if (window.innerWidth < 768) bottomNav.classList.remove('hidden');
        else bottomNav.classList.add('hidden');
      }
    }
  });

  document.body.addEventListener('click', (e) => {
    const t = e.target;
    if (t && t.classList && t.classList.contains('modal-close-button')) hideModal();
  });
});