// script.js - Refactored & Merged Version (2026-01-07)

// === 1. 設定與全域變數 ===
const SPREADSHEET_ID = '1mRcCNQSlTVwRRy7u9Yhx9knsw_0ZUyI0p6dMFgO-6os'; // 請確認此 ID 是否正確
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";

// GID 對照表 (用於直接讀取 CSV fallback)
const GID_MAPPING = {
  config: '837241302',
  announcements: '1966814983',
  players: '1460096031',
  parents: '1006978286',
  parent_child: '1784910850',
  staff: '389602556',
  accounts: '1754002404',
  training_schedule: '732203007',
  leave_requests: '1300638614',
  matches: '1739165902',
  player_stats: '1827474791',
  pair_stats: '1647550522',
  audit_log: '844087473',
  media: '1763674563'
};

// 全域資料容器
let announcements = [];
let schedule = {};
let players = [];
let staff = [];
let matches = [];
let parents = [];
let parentChild = [];
let accounts = [];
let leaveRequestsData = [];
let adminLoggedIn = false;
let navStack = [];

// 訓練排程常數
const weekdays = ['週一', '週二', '週三', '週四', '週五', '週六', '週日'];
const defaultSlots = [
  '17:00-18:00', '18:00-19:00', '19:00-20:00', '20:00-21:00',
  '11:00-12:00', '12:00-13:00', '13:00-14:00', '14:00-15:00',
  '15:00-16:00', '16:00-17:00'
];

// 初始化空排程結構
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

// === 2. 資料載入與 API ===

// 載入所有資料 (API + Normalize)
async function loadAllData() {
  // 顯示 Loading (若有的話)
  const loader = document.getElementById('app-loader');
  
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_all_data`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // 資料正規化
    const data = normalizeData(result);

    // 賦值全域變數
    announcements = data.announcements || [];
    players = data.players || [];
    staff = data.staff || [];
    matches = data.matches || [];
    leaveRequestsData = data.leaveRequests || [];
    window.heroConfig = data.hero || {};

    // 處理排程資料結構
    initEmptySchedule();
    if (data.schedules && Array.isArray(data.schedules)) {
      data.schedules.forEach(item => {
        const day = item.date || item.day;
        const slot = item.slot;
        // 確保該 day/slot 在結構中存在，若無則初始化 (容錯)
        if (!schedule[day]) schedule[day] = {};
        if (!schedule[day][slot]) schedule[day][slot] = [];
        schedule[day][slot].push(item);
      });
    }

    console.log('資料同步完成');
  } catch (e) {
    console.error('載入失敗，使用 Fallback 模式', e);
    // Fallback: 至少讓 UI 不會空白
    announcements = [{ title: '系統連線提示', date: new Date().toISOString().split('T')[0], content: '目前使用離線/暫存資料。' }];
  } finally {
    // 移除 Loading 畫面
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500);
    }
  }
}

// 通用 GAS 寫入函式 (無須權限)
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
      await loadAllData(); // 重讀資料
      // 根據當前頁面刷新
      const currentSection = document.querySelector('section.active')?.id;
      if (currentSection === 'schedule') renderSchedule();
      if (currentSection === 'leave') renderLeaveList();
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

// 管理功能：需要密碼驗證的 GAS 寫入
async function sendToGasWithAuth(action, payload) {
    // 優先使用 sessionStorage 中的密碼，若無則跳出提示
    let password = sessionStorage.getItem('admin_pwd');
    if (!password) {
        password = document.getElementById('admin-password')?.value || prompt('請輸入管理密碼確認操作：');
    }
    
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
            // 若密碼正確且尚未儲存，則存入 Session
            if (!sessionStorage.getItem('admin_pwd')) {
                sessionStorage.setItem('admin_pwd', password);
            }
            
            await loadAllData(); 
            
            // 刷新對應的管理介面
            if (action.includes('leave') && typeof showAdminLeaveList === 'function') showAdminLeaveList();
            if (action.includes('player') && typeof showAdminPlayerList === 'function') showAdminPlayerList();
            if (action.includes('match') && typeof showAdminMatchList === 'function') showAdminMatchList();
            if (action.includes('schedule') && typeof showAdminScheduleList === 'function') showAdminScheduleList();
            if (action === 'update_config') renderHome();
        } else {
            showToast('失敗: ' + result.message);
        }
    } catch(e) {
        console.error(e);
        showToast('連線錯誤');
    }
}

// === 3. 導覽與路由邏輯 ===

function initNavigation() {
  // 1. Sidebar Links
  const sidebarNav = document.querySelector('nav#sidebar');
  if (sidebarNav) {
    sidebarNav.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-section]');
      if (!link) return;
      e.preventDefault();
      navigateTo(link.dataset.section);
      if (window.innerWidth < 768) closeSidebar();
    });
  }

  // 2. Bottom Nav
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (btn) navigateTo(btn.dataset.section);
    });
  }

  // 3. Header Toggle (漢堡選單) & Title Click
  const menuToggle = document.getElementById('menu-toggle');
  const headerTitle = document.querySelector('header h1');
  
  const toggleHandler = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
  };

  if (menuToggle) menuToggle.onclick = toggleHandler;
  if (headerTitle) headerTitle.onclick = toggleHandler;

  // 4. Overlay & Back Button
  const overlay = document.getElementById('overlay');
  if (overlay) {
      overlay.addEventListener('click', () => {
          if (document.body.classList.contains('sidebar-open')) closeSidebar();
          else hideModal();
      });
  }

  const backBtn = document.getElementById('back-button');
  if (backBtn) backBtn.addEventListener('click', () => goBack());

  // Handle Browser Back
  window.addEventListener('popstate', (e) => {
    const section = (e.state && e.state.section) ? e.state.section : 'home';
    navigateTo(section, false);
    if (navStack.length > 1) navStack.pop();
    updateBackButton();
  });

  // RWD Check
  window.addEventListener('resize', () => {
      const bNav = document.getElementById('bottom-nav');
      if (bNav) {
          if (window.innerWidth < 768) bNav.classList.remove('hidden');
          else bNav.classList.add('hidden');
      }
      // Force schedule redraw on resize to fix layout
      if (document.getElementById('schedule').classList.contains('active')) {
          renderSchedule();
      }
  });
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

    // Lazy Render
    switch (targetId) {
      case 'home': renderHome(); break;
      case 'announcements': renderAnnouncements(); break;
      case 'schedule': renderSchedule(); break;
      case 'leave': renderLeave(); break;
      case 'matches': renderMatches(); break;
      case 'roster': renderRoster(); break;
      case 'media': renderMedia(); break;
      case 'admin': renderAdmin(); break;
    }
  }

  // Update Nav State
  document.querySelectorAll('[data-section]').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.section === targetId) el.classList.add('active');
  });

  if (pushState) {
      history.pushState({ section: targetId }, '', '#' + targetId);
      navStack.push(targetId);
      updateBackButton();
  }
  
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateBackButton() {
  const backBtn = document.getElementById('back-button');
  if (!backBtn) return;
  if (navStack.length > 1) backBtn.classList.remove('hidden');
  else backBtn.classList.add('hidden');
}

function goBack() {
  if (navStack.length <= 1) return;
  history.back();
}

function openSidebar() { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() { document.body.classList.toggle('sidebar-open'); }

// === 4. UI 渲染邏輯 ===

// --- A. 首頁 ---
function renderHome() {
  // Hero Background
  const bgUrl = window.heroConfig && (window.heroConfig.hero_bg_url || window.heroConfig.heroBgUrl);
  const heroBg = document.querySelector('#home .hero-bg-placeholder');
  if (heroBg && bgUrl) {
    heroBg.style.backgroundImage = `url(${convertDriveLink(bgUrl)})`;
    heroBg.style.backgroundSize = 'cover';
  }

  // Recent Announcements
  const homeAnn = document.getElementById('home-announcements');
  if (homeAnn) {
    homeAnn.innerHTML = '';
    const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 3);
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

  // Today's Leaves
  const leaveContainer = document.getElementById('home-leave-overview');
  if (leaveContainer) {
    leaveContainer.innerHTML = '';
    const todayStr = new Date().toISOString().split('T')[0];
    const todaysLeaves = loadLeaveRequests().filter(l => (l.date || '') === todayStr);

    if (todaysLeaves.length === 0) {
        leaveContainer.innerHTML = `<div class="card" style="text-align:center; color:#888; padding:10px;">今日無人請假</div>`;
    } else {
        todaysLeaves.forEach(l => {
            const div = document.createElement('div');
            div.className = 'card';
            div.style.cssText = 'padding:10px; border-left:4px solid #e74c3c; margin-bottom:10px;';
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; font-weight:bold;">
                    <span>${escapeHtml(l.name)}</span>
                    <span style="font-size:0.9rem; color:#666;">${escapeHtml(l.slot)}</span>
                </div>
                <div style="font-size:0.85rem; color:#888;">${escapeHtml(l.reason)}</div>
            `;
            leaveContainer.appendChild(div);
        });
    }
  }
}

// --- B. 公告 ---
function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';
  
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  if (sorted.length === 0) {
      listDiv.innerHTML = '<div style="text-align:center; padding:20px; color:#888;">暫無公告</div>';
      return;
  }

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center;">
        <h4 style="margin:0;">${escapeHtml(item.title)}</h4>
        <span style="font-size:0.8rem; color:#888;">${item.date}</span>
      </div>
      <p style="margin-top:8px; color:#555; font-size:0.95rem; line-height:1.5;">${escapeHtml(item.content).substring(0, 80)}...</p>
    `;
    card.onclick = () => showAnnouncementDetail(item);
    listDiv.appendChild(card);
  });
}

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

function hideModal() {
    const modals = document.querySelectorAll('.modal');
    modals.forEach(m => {
        m.classList.remove('active');
        // Clean up video iframe if exists
        if (m.classList.contains('video-modal-content') || m.innerHTML.includes('iframe')) {
            m.classList.remove('video-modal-content');
            m.innerHTML = ''; 
        }
    });
    document.body.classList.remove('modal-open');
    
    // Close match analysis panel
    const analysis = document.getElementById('player-analysis');
    if (analysis) analysis.classList.add('hidden');
    document.querySelectorAll('.match-card.selected').forEach(c => c.classList.remove('selected'));
}

// --- C. 排程 (Accordion + Compact Grid) ---
function renderSchedule() {
    const container = document.getElementById('schedule-container');
    if (!container) return;
    container.innerHTML = '';

    const isMobile = window.innerWidth < 768;
    const query = (document.getElementById('schedule-search')?.value || '').trim().toLowerCase();
    
    let hasResult = false;

    weekdays.forEach((day, index) => {
        // Filter Logic
        const matchedSlots = {};
        let dayHasMatch = false;

        defaultSlots.forEach(slot => {
            const entries = schedule[day]?.[slot] || [];
            if (entries.length === 0) return;

            const filtered = entries.filter(e => {
                if (!query) return true;
                const txt = [e.playerA?.name, e.playerB?.name, e.coach?.name, e.table].join(' ').toLowerCase();
                return txt.includes(query);
            });

            if (filtered.length > 0) {
                matchedSlots[slot] = filtered;
                dayHasMatch = true;
            }
        });

        if (query && !dayHasMatch) return; // Skip day if searching and no match
        hasResult = true;

        // Render Accordion Header
        const header = document.createElement('div');
        header.className = 'accordion-header';
        const todayIdx = (new Date().getDay() + 6) % 7; // Adjust to Mon=0
        const isToday = index === todayIdx;
        const isOpen = query ? true : isToday; // Auto expand on search

        header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-${isOpen ? 'up' : 'down'}"></i>`;
        if (isOpen) header.classList.add('active');

        // Render Content
        const content = document.createElement('div');
        content.className = `accordion-content ${isOpen ? 'show' : ''}`;

        if (!dayHasMatch && !query) {
             content.innerHTML = '<div style="padding:10px; color:#ccc; text-align:center;">本日無排程</div>';
        } else {
             Object.keys(matchedSlots).forEach(slot => {
                 const slotHeader = document.createElement('div');
                 slotHeader.className = 'time-slot-header';
                 slotHeader.innerText = slot;
                 content.appendChild(slotHeader);

                 const grid = document.createElement('div');
                 grid.className = isMobile ? 'compact-grid' : 'card-container';

                 matchedSlots[slot].forEach(entry => {
                     const card = document.createElement('div');
                     if (isMobile) {
                         card.className = 'compact-card';
                         card.innerHTML = `
                            <div class="table-badge">T${escapeHtml(entry.table)}</div>
                            <div class="coach-name">${escapeHtml(entry.coach?.name || '')}</div>
                            <div class="players">${escapeHtml(entry.playerA?.name || '')}<br>${escapeHtml(entry.playerB?.name || '')}</div>
                         `;
                     } else {
                         card.className = 'card';
                         card.innerHTML = `
                            <h4 style="margin:0 0 5px;">桌次 ${escapeHtml(entry.table)}</h4>
                            <div style="color:var(--primary-color); font-weight:bold;">${escapeHtml(entry.coach?.name)}</div>
                            <div style="color:#666;">${escapeHtml(entry.playerA?.name)} vs ${escapeHtml(entry.playerB?.name)}</div>
                         `;
                     }
                     grid.appendChild(card);
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

    if (!hasResult) {
        container.innerHTML = '<div class="card" style="text-align:center; padding:20px; color:#888;">查無排程資料</div>';
    }
}

// --- D. 請假 (Card Style) ---
function loadLeaveRequests() { return leaveRequestsData; }

function renderLeave() {
    renderLeaveList();
    const form = document.getElementById('leave-form');
    if (form) {
        form.onsubmit = (e) => {
            e.preventDefault();
            const payload = {
                name: document.getElementById('leave-name').value.trim(),
                date: document.getElementById('leave-date').value,
                slot: document.getElementById('leave-slot').value,
                reason: document.getElementById('leave-reason').value.trim()
            };
            if (!payload.name || !payload.date) return;
            sendToGas('add_leave', payload).then(() => {
                form.reset();
            });
        };
    }
}

function renderLeaveList() {
    const container = document.getElementById('leave-list');
    if (!container) return;
    container.innerHTML = '';
    
    const list = loadLeaveRequests();
    if (list.length === 0) {
        container.innerHTML = '<div style="text-align:center; color:#888;">尚無請假紀錄</div>';
        return;
    }
    
    // 使用 Card Style 避免 Table 跑版
    const wrapper = document.createElement('div');
    wrapper.className = 'leave-list-container';
    
    list.forEach(item => {
        const card = document.createElement('div');
        card.className = 'leave-item';
        card.innerHTML = `
            <div class="leave-item-header">
                <span class="leave-item-name">${escapeHtml(item.name)}</span>
                <span class="leave-item-date">${escapeHtml(item.date)} <span>${escapeHtml(item.slot)}</span></span>
            </div>
            <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
        `;
        wrapper.appendChild(card);
    });
    container.appendChild(wrapper);
}

// --- E. 比賽紀錄 (Multi-Filter + Detail Toggle) ---
function renderMatches() {
    const container = document.getElementById('match-list');
    if (!container) return;

    // Filters
    const keyInput = document.getElementById('match-keyword');
    const chkSingle = document.getElementById('filter-singles');
    const chkDouble = document.getElementById('filter-doubles');

    const doRender = () => {
        container.innerHTML = '';
        const keyword = keyInput ? keyInput.value.trim().toLowerCase() : '';
        const showS = chkSingle ? chkSingle.checked : true;
        const showD = chkDouble ? chkDouble.checked : true;

        const filtered = matches.filter(m => {
            const isS = m.type === 'singles';
            if (isS && !showS) return false;
            if (!isS && !showD) return false;
            
            if (keyword) {
                const txt = [...m.players, ...m.opponents].map(id => getPlayerName(id)).join(' ').toLowerCase();
                return txt.includes(keyword);
            }
            return true;
        });

        if (filtered.length === 0) {
            container.innerHTML = '<div style="text-align:center; padding:20px; color:#999;">無符合紀錄</div>';
            return;
        }

        filtered.forEach(m => {
            const card = document.createElement('div');
            card.className = 'match-card';
            
            const pNames = m.players.map(getPlayerName).join('、');
            const oNames = m.opponents.map(getPlayerName).join('、');
            
            card.innerHTML = `
                <div class="match-card-header">
                    <span class="match-type-badge">${m.type === 'singles' ? '單打' : '雙打'}</span>
                    <span>${m.date}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="match-card-vs">
                        <span>${escapeHtml(pNames)}</span> <i class="fas fa-times" style="font-size:0.7rem; color:#ccc;"></i> <span>${escapeHtml(oNames)}</span>
                    </div>
                    <div class="match-card-score">${escapeHtml(m.score)}</div>
                </div>
            `;
            
            card.onclick = () => {
                const isActive = card.classList.contains('selected');
                document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
                if (!isActive) {
                    card.classList.add('selected');
                    showMatchDetail(m);
                } else {
                    document.getElementById('player-analysis').classList.add('hidden');
                }
            };
            container.appendChild(card);
        });
    };

    // Attach Listeners Once
    if (keyInput && !keyInput.hasAttribute('data-bound')) {
        keyInput.oninput = doRender;
        keyInput.setAttribute('data-bound', 'true');
    }
    if (chkSingle && !chkSingle.hasAttribute('data-bound')) {
        chkSingle.onchange = doRender;
        chkSingle.setAttribute('data-bound', 'true');
    }
    if (chkDouble && !chkDouble.hasAttribute('data-bound')) {
        chkDouble.onchange = doRender;
        chkDouble.setAttribute('data-bound', 'true');
    }

    doRender();
}

function showMatchDetail(m) {
    const modal = document.getElementById('player-analysis');
    const pNames = m.players.map(getPlayerName).join('、');
    const oNames = m.opponents.map(getPlayerName).join('、');
    
    modal.innerHTML = `
        <button class="btn-close-absolute" onclick="hideModal()"><i class="fas fa-times"></i></button>
        <h3 style="margin:0 0 10px 0; color:var(--primary-color);">比賽詳情</h3>
        <div style="background:#f9f9f9; padding:15px; border-radius:8px; margin-bottom:10px;">
             <div style="font-weight:bold; font-size:1.1rem; margin-bottom:5px;">${escapeHtml(pNames)} <span style="color:#e74c3c">vs</span> ${escapeHtml(oNames)}</div>
             <div style="color:#666; font-size:0.9rem;">${m.date} | ${m.type === 'singles' ? '單打' : '雙打'}</div>
             <div style="margin-top:5px; font-weight:bold; color:var(--primary-dark);">比分: ${escapeHtml(m.score)}</div>
             ${m.sets ? `<div style="font-size:0.85rem; color:#888; margin-top:2px;">(${escapeHtml(m.sets)})</div>` : ''}
        </div>
        ${m.video && m.video.url ? `
            <div style="margin-top:10px;">
                <button class="hero-btn" style="width:100%;" onclick="window.open('${m.video.url}', '_blank')"><i class="fas fa-video"></i> 觀看影片</button>
            </div>
        ` : ''}
    `;
    modal.classList.remove('hidden');
    modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// --- F. 名冊 ---
function renderRoster() {
    const pDiv = document.getElementById('roster-players');
    const sDiv = document.getElementById('roster-staff');
    if (!pDiv || !sDiv) return;
    
    pDiv.innerHTML = ''; sDiv.innerHTML = '';
    const query = (document.getElementById('roster-search')?.value || '').trim().toLowerCase();
    
    // Staff
    staff.forEach(s => {
        if (query && !s.name.includes(query)) return;
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `<div class="img-placeholder"><i class="fas fa-user-tie"></i></div><h4>${escapeHtml(s.name)}</h4><p>教練</p>`;
        sDiv.appendChild(card);
    });
    
    // Players
    players.forEach(p => {
        const txt = [p.name, p.grade, p.class, p.paddle].join(' ').toLowerCase();
        if (query && !txt.includes(query)) return;
        
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
            <div class="img-placeholder"><i class="fas fa-user"></i></div>
            <h4>${escapeHtml(p.name)}</h4>
            <p>${p.grade ? p.grade + '年' : ''} ${p.class ? p.class + '班' : ''}<br><span style="font-size:0.8rem; color:#888;">${escapeHtml(p.paddle || '')}</span></p>
        `;
        pDiv.appendChild(card);
    });
}

// --- G. 影音 (Video Grid + Lightbox) ---
function renderMedia() {
    const container = document.getElementById('media-list');
    if (!container) return;
    container.innerHTML = '';
    
    const videos = matches.filter(m => m.video && m.video.url);
    if (videos.length === 0) {
        container.innerHTML = '<div style="grid-column:1/-1; text-align:center; color:#888;">暫無影音</div>';
        return;
    }

    videos.forEach(m => {
        const ytId = getYouTubeID(m.video.url);
        const thumb = ytId ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg` : 'https://via.placeholder.com/320x180?text=Video';
        
        const card = document.createElement('div');
        card.className = 'video-card';
        card.innerHTML = `
            <div class="video-thumb-container">
                <img src="${thumb}" class="video-thumb">
                <div class="play-icon-overlay"><i class="far fa-play-circle"></i></div>
            </div>
            <div class="video-info">
                <div class="video-title">${m.players.map(getPlayerName).join('/')} vs ${m.opponents.map(getPlayerName).join('/')}</div>
                <div class="video-meta"><span>${m.date}</span></div>
            </div>
        `;
        card.onclick = () => {
            if (ytId) openVideoModal(ytId);
            else window.open(m.video.url, '_blank');
        };
        container.appendChild(card);
    });
}

function openVideoModal(ytId) {
    const modal = document.getElementById('announcement-detail');
    modal.innerHTML = `
        <button class="video-modal-close" onclick="hideModal()"><i class="fas fa-times"></i></button>
        <iframe src="https://www.youtube.com/embed/${ytId}?autoplay=1" style="width:100%; height:100%; border:none;" allow="autoplay; encrypted-media" allowfullscreen></iframe>
    `;
    modal.className = 'modal video-modal-content active';
    document.body.classList.add('modal-open');
}

// === 5. 管理後台邏輯 (Merged) ===

function renderAdmin() {
    // Check Session
    if (sessionStorage.getItem('admin_pwd')) adminLoggedIn = true;

    const loginDiv = document.getElementById('admin-login');
    const dashDiv = document.getElementById('admin-dashboard');
    
    if (!adminLoggedIn) {
        loginDiv.classList.remove('hidden');
        dashDiv.classList.add('hidden');
        
        const loginBtn = document.getElementById('admin-login-btn');
        loginBtn.onclick = async () => {
            const pwd = document.getElementById('admin-password').value;
            if (!pwd) return alert('請輸入密碼');
            
            loginBtn.innerText = '驗證中...';
            // Verify via GAS "check_auth" action
            try {
                const res = await fetch(GAS_API_URL, {
                     method: 'POST',
                     body: JSON.stringify({ action: 'check_auth', password: pwd })
                });
                const json = await res.json();
                if (json.success) {
                    adminLoggedIn = true;
                    sessionStorage.setItem('admin_pwd', pwd); // Save session
                    renderAdmin();
                    showToast('登入成功');
                } else {
                    document.getElementById('admin-login-error').classList.remove('hidden');
                }
            } catch(e) { showToast('驗證錯誤'); }
            finally { loginBtn.innerText = '登入'; }
        };
    } else {
        loginDiv.classList.add('hidden');
        dashDiv.classList.remove('hidden');
        bindAdminButtons();
    }
}

function bindAdminButtons() {
    const map = {
        'admin-add-announcement': showAdminAddAnnouncement,
        'admin-view-leave': showAdminLeaveList,
        'admin-manage-players': showAdminPlayerList,
        'admin-manage-matches': showAdminMatchList,
        'admin-settings': showAdminSettings
    };
    for (const [id, fn] of Object.entries(map)) {
        const btn = document.getElementById(id);
        if (btn) btn.onclick = fn;
    }
}

// --- Admin Sub-pages ---
function showAdminAddAnnouncement() {
    const content = document.getElementById('admin-content');
    content.innerHTML = `
        <div class="admin-form-card">
            <h3>新增公告</h3>
            <div class="admin-form-group"><label>標題</label><input id="ann-title" class="admin-input"></div>
            <div class="admin-form-group"><label>日期</label><input type="date" id="ann-date" class="admin-input" value="${new Date().toISOString().split('T')[0]}"></div>
            <div class="admin-form-group"><label>內容</label><textarea id="ann-content" class="admin-textarea" rows="5"></textarea></div>
            <button class="hero-btn" onclick="submitAnnouncement()">發布</button>
        </div>
    `;
}

async function submitAnnouncement() {
    const payload = {
        title: document.getElementById('ann-title').value,
        date: document.getElementById('ann-date').value,
        content: document.getElementById('ann-content').value
    };
    if (!payload.title) return;
    await sendToGasWithAuth('add_announcement', payload);
    document.getElementById('ann-title').value = ''; 
    document.getElementById('ann-content').value = '';
}

function showAdminLeaveList() {
    const content = document.getElementById('admin-content');
    content.innerHTML = '<h4>請假管理</h4><div id="adm-leave-list" class="leave-list-container"></div>';
    const container = document.getElementById('adm-leave-list');
    
    const list = loadLeaveRequests();
    if (list.length === 0) { container.innerHTML = '無資料'; return; }
    
    list.forEach(item => {
        const div = document.createElement('div');
        div.className = 'leave-item';
        div.innerHTML = `
            <div class="leave-item-header">
                <span class="leave-item-name">${escapeHtml(item.name)}</span>
                <span class="leave-item-date">${item.date} ${item.slot}</span>
            </div>
            <div class="leave-item-reason">${escapeHtml(item.reason)}</div>
            <div class="leave-item-actions">
                <button class="action-btn delete" onclick="deleteLeave('${item.rowId}')"><i class="fas fa-trash"></i> 刪除</button>
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
    const currBg = window.heroConfig?.hero_bg_url || '';
    content.innerHTML = `
        <div class="admin-form-card">
            <h3>網站設定</h3>
            <div class="admin-form-group">
                <label>首頁背景圖連結 (Google Drive / Direct Link)</label>
                <input id="conf-bg" class="admin-input" value="${escapeHtml(currBg)}">
            </div>
            <button class="hero-btn" onclick="saveConfig()">儲存</button>
        </div>
    `;
}

async function saveConfig() {
    const url = document.getElementById('conf-bg').value.trim();
    await sendToGasWithAuth('update_config', { hero_bg_url: url });
}

// 示意：若需要完整的球員/比賽管理後台，可在此擴充類似 showAdminLeaveList 的邏輯
function showAdminPlayerList() {
    document.getElementById('admin-content').innerHTML = '<div class="card">功能開發中：球員管理</div>';
}
function showAdminMatchList() {
    document.getElementById('admin-content').innerHTML = '<div class="card">功能開發中：比賽紀錄管理</div>';
}

// === 6. Helpers & Init ===

function getPlayerName(id) {
    const p = players.find(x => x.id === id);
    return p ? p.name : id;
}

function getYouTubeID(url) {
    const match = url.match(/(?:youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/);
    return (match && match[1].length === 11) ? match[1] : null;
}

function convertDriveLink(url) {
    if (!url) return '';
    if (url.includes('googleusercontent')) return url;
    const match = url.match(/\/d\/([a-zA-Z0-9_-]+)/) || url.match(/id=([a-zA-Z0-9_-]+)/);
    return match ? `https://drive.google.com/uc?export=view&id=${match[1]}` : url;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function showToast(msg) {
    const c = document.getElementById('toast-container');
    if (!c) return;
    const t = document.createElement('div');
    t.className = 'toast show';
    t.innerHTML = `<i class="fas fa-info-circle"></i> ${escapeHtml(msg)}`;
    c.appendChild(t);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 500); }, 3000);
}

// Data Normalizer
// script.js - 改良版 normalizeData (支援中英文欄位 + 除錯)

function normalizeData(data) {
    console.log("Raw Data from GAS:", data); // ★ 除錯用：請在 F12 Console 查看

    // 1. Staff Map
    const mapStaff = (data.staff || []).map(r => ({ 
        id: String(r.staff_id || r.id || ''), 
        name: r.name || r.staff_name || '未命名'
    }));

    // 2. Player Map
    const mapPlayers = (data.players || []).map(r => ({
        id: String(r.player_id || r.id || ''),
        name: r.student_name || r.name || '未命名',
        grade: r.grade,
        class: r.class,
        paddle: r.paddle || r.team_no
    }));

    // 3. Schedule Normalization (關鍵修正)
    // 支援: weekday/星期, slot/時段, table_no/桌次, coach_id/教練ID...
    const schedules = (data.training_schedule || []).map(r => {
        // 嘗試讀取多種可能的欄位名稱
        const day = r.weekday || r.date || r.day || r.星期 || ''; 
        const slot = r.slot || r.time || r.時段 || '';
        const table = r.table_no || r.table || r.桌次 || '';

        // ID 查找 (容錯：轉成字串比對)
        const cId = String(r.coach_id || r.coachId || '');
        const paId = String(r.player_a_id || r.playerAId || '');
        const pbId = String(r.player_b_id || r.playerBId || '');

        return {
            rowId: r.rowId,
            date: day, // 前端 renderSchedule 使用 .date 或 .day
            day: day,
            slot: slot,
            table: table,
            coach: mapStaff.find(s => s.id === cId) || { name: cId }, // 若找不到對應ID，直接顯示ID
            playerA: mapPlayers.find(p => p.id === paId) || { name: paId },
            playerB: mapPlayers.find(p => p.id === pbId) || { name: pbId }
        };
    });

    console.log("Normalized Schedules:", schedules); // ★ 除錯用：確認這裡是否有資料

    return {
        hero: data.hero,
        announcements: data.announcements,
        leaveRequests: data.leave_requests || [],
        staff: mapStaff,
        players: mapPlayers,
        schedules: schedules,
        matches: (data.matches || []).map(r => ({
            rowId: r.rowId,
            date: r.match_date || r.date,
            type: (r.match_type || '').includes('雙') ? 'doubles' : 'singles',
            score: r.game_score || r.score,
            sets: r.set_scores || r.sets,
            players: [r.player1_id || r.p1, r.player2_id || r.p2].filter(Boolean),
            opponents: [r.opponent1 || r.o1, r.opponent2 || r.o2].filter(Boolean),
            video: { url: r.media_url || r.video }
        }))
    };
}


// Init
document.addEventListener('DOMContentLoaded', () => {
    loadAllData();
    initNavigation();
    
    // Hash routing init
    const hash = location.hash.replace('#', '') || 'home';
    navigateTo(hash, false);
    
    // Auto-search listener
    const schedSearch = document.getElementById('schedule-search');
    if (schedSearch) schedSearch.oninput = () => renderSchedule();
    
    // Back to top
    window.onscroll = () => {
        const btn = document.getElementById('back-to-top');
        if (btn) btn.classList.toggle('show', window.scrollY > 300);
    };
});
