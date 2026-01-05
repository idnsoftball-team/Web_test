// script.js

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

/*
 * 若要連線到 Google Sheets，請設定下列常數：
 * - SPREADSHEET_ID：活頁簿的 ID（從網址取得）。
 * - GID_MAPPING：每個分頁名稱對應的 gid（從網址 #gid= 取得）。
 * 如果系統無法存取 Google 服務（例如離線環境），程式會回退到預設假資料。
 */
const SPREADSHEET_ID = '1mRcCNQSlTVwRRy7u9Yhx9knsw_0ZUyI0p6dMFgO-6os';


// === GAS 後端設定 ===
const GAS_API_URL = "https://script.google.com/macros/s/AKfycby2mZbg7Wbs9jRjgzPDzXM_3uldQfsSKv_D0iJjY1aN0qQkGl4ZtPDHcQ8k3MqAp9pxHA/exec";
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

// 假資料作為 fallback，當無法從遠端取得時使用
let announcements = [];
let schedule = {};
let players = [];
let staff = [];
let matches = [];
let parents = [];
let parentChild = [];
let accounts = [];
let leaveRequestsData = [];

// 訓練排程相關常數（用於建立空結構與高亮週期）
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

// 填入示範排程，僅當遠端排程無資料時使用
function populateSampleSchedule() {
  // 使用 players/staff 數組，如為空則建立簡易範例
  const samplePlayers = players && players.length >= 6 ? players.slice(0, 6) : [
    { id: 'P01', name: '張三', number: '1' },
    { id: 'P02', name: '李四', number: '2' },
    { id: 'P03', name: '王五', number: '3' },
    { id: 'P04', name: '趙六', number: '4' },
    { id: 'P05', name: '陳七', number: '5' },
    { id: 'P06', name: '林八', number: '6' }
  ];
  const sampleCoach = staff && staff.length >= 2 ? staff.slice(0, 2) : [
    { id: 'C01', name: '李教練' },
    { id: 'C02', name: '張教練' }
  ];
  // 週一～週五使用 18:00-20:00 兩時段，週六使用 12:00-16:00 四時段
  initEmptySchedule();
  weekdays.forEach((day, dIndex) => {
    if (day === '週日') {
      return;
    }
    if (day === '週六') {
      ['12:00-13:00','13:00-14:00','14:00-15:00','15:00-16:00'].forEach((slot, sIndex) => {
        for (let table = 1; table <= 2; table++) {
          const idx = (dIndex * 4 + sIndex + table) % samplePlayers.length;
          const idx2 = (idx + 1) % samplePlayers.length;
          schedule[day][slot].push({
            table,
            coach: sampleCoach[(table + sIndex) % sampleCoach.length],
            playerA: samplePlayers[idx],
            playerB: samplePlayers[idx2]
          });
        }
      });
    } else {
      ['18:00-19:00','19:00-20:00'].forEach((slot, sIndex) => {
        for (let table = 1; table <= 2; table++) {
          const idx = (dIndex * 2 + sIndex + table) % samplePlayers.length;
          const idx2 = (idx + 2) % samplePlayers.length;
          schedule[day][slot].push({
            table,
            coach: sampleCoach[(table + sIndex) % sampleCoach.length],
            playerA: samplePlayers[idx],
            playerB: samplePlayers[idx2]
          });
        }
      });
    }
  });
}
initEmptySchedule();

// CSV 解析函式：將 CSV 字串轉成物件陣列
function csvToObjects(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = lines[0].split(',');
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCsvLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      obj[h] = values[idx] || '';
    });
    rows.push(obj);
  }
  return rows;
}

// 解析單行 CSV；處理引號與逗號
function parseCsvLine(line) {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// 讀取指定 gid 的 CSV 並解析
async function fetchSheetData(sheetName) {
  const gid = GID_MAPPING[sheetName];
  if (!gid) return [];
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${gid}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error('HTTP ' + resp.status);
    const text = await resp.text();
    return csvToObjects(text);
  } catch (err) {
    console.warn(`fetchSheetData(${sheetName}) failed`, err);
    return [];
  }
}

// 載入所有資料：從 Google Sheets 或 fallback
async function loadAllData() {
  try {
    const response = await fetch(`${GAS_API_URL}?action=get_all_data`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    // 使用 normalizeData 進行欄位轉換
    const data = normalizeData(result);

    // 1) 全域變數賦值（核心功能）
    announcements = data.announcements || [];
    players = data.players || [];
    staff = data.staff || [];
    matches = data.matches || [];
    parents = data.parents || [];
    parentChild = data.parentChild || [];
    accounts = data.accounts || [];
    leaveRequestsData = data.leaveRequests || data.leave_requests || [];

    // 2) 排程處理：轉為 UI 需要的巢狀物件 schedule[day][slot] = []
    initEmptySchedule();

    if (data.schedules && Array.isArray(data.schedules)) {
      data.schedules.forEach(item => {
        const day = item.date;   // 例如：'週一'
        const slot = item.slot; // 例如：'18:00-19:00'

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

    // fallback：至少讓首頁能顯示錯誤提示
    announcements = [
      { id: 1, date: '2025-01-01', title: '系統連線異常', content: '目前無法連線至資料庫，顯示為暫存資料。' }
    ];
    // fallback：使用示範排程，避免 UI 整體空白
    initEmptySchedule();
    populateSampleSchedule();
  }
}

// 通用 GAS 寫入函式
async function sendToGas(action, payload) {
  // 簡單 loading 提示（若目前焦點在按鈕上）
  const activeEl = document.activeElement;
  const isBtn = activeEl && activeEl.tagName === 'BUTTON';
  const originalText = isBtn ? activeEl.innerText : '';

  if (isBtn) {
    activeEl.innerText = '處理中...';
    activeEl.disabled = true;
  }

  try {
    // 使用 text/plain 避免瀏覽器觸發 CORS preflight
    const response = await fetch(GAS_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, payload })
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();

    if (result && result.success) {
      showToast(result.message || '操作成功');

      // 重新載入資料以更新畫面
      await loadAllData();

      // 若目前在排程頁，重新渲染
      const scheduleSection = document.getElementById('schedule');
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) {
        renderSchedule();
      }

      // 若目前在請假頁，刷新列表
      const leaveSection = document.getElementById('leave');
      if (leaveSection && !leaveSection.classList.contains('hidden')) {
        renderLeaveList();
      }
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


// leaveRequests 將保存在 localStorage，以 email/姓名為 key 代表不同使用者
// 請假資料存取
function loadLeaveRequests() {
  // 如果已從遠端載入 leaveRequestsData，則使用該資料集；
  // fallback: 若遠端無資料，從 localStorage 讀取。
  if (leaveRequestsData && leaveRequestsData.length > 0) {
    return leaveRequestsData;
  }
  const data = localStorage.getItem('leaveRequests');
  if (data) {
    try {
      return JSON.parse(data);
    } catch (err) {
      console.error('Failed to parse leaveRequests from localStorage:', err);
    }
  }
  return [];
}

function saveLeaveRequests(list) {
  // 更新本地緩存
  leaveRequestsData = list;
  // fallback: 存回 localStorage
  localStorage.setItem('leaveRequests', JSON.stringify(list));
  // TODO: 若有 GAS API，可在此發送 POST 請求寫回後端
}

// -------------------------------------------------------------
// === 核心功能與 UI 邏輯（Full Fixed Version）===
// 目標：
// 1) 修復導覽列監聽（避免點到 icon/text 失效）
// 2) 全新「層級式排程」渲染（星期 Accordion → 時段 → 微型卡片網格）
// 3) 名冊搜尋（姓名/背號）
// 4) 置頂按鈕顯示/隱藏
// -------------------------------------------------------------

// === Sidebar 開合 ===
function openSidebar() { document.body.classList.add('sidebar-open'); }
function closeSidebar() { document.body.classList.remove('sidebar-open'); }
function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) closeSidebar();
  else openSidebar();
}

// === 導航堆疊（提供瀏覽器返回/自訂返回按鈕一致行為；若頁面未提供 back-button 也不影響）===
let navStack = [];

// 1) 導覽系統（修復連結失效問題）
function initNavigation() {
  // Sidebar（事件委派）
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

  // Bottom Nav（事件委派，防止點到 icon/text 無效）
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (!btn) return;
      const section = btn.dataset.section;
      if (section) navigateTo(section);
    });
  }

  // 漢堡選單
  const menuToggleEl = document.getElementById('menu-toggle');
  if (menuToggleEl) {
    menuToggleEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleSidebar();
    });
  }

  // 標題點擊（僅手機）
  const headerTitle = document.querySelector('header h1');
  if (headerTitle) {
    headerTitle.addEventListener('click', () => {
      if (window.innerWidth < 768) toggleSidebar();
    });
  }

  // 遮罩層：優先關側欄，否則關 Modal/詳情
  const overlayEl = document.getElementById('overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) closeSidebar();
      else hideModal();
    });
  }

  // 自訂返回按鈕（若存在）
  const backBtn = document.getElementById('back-button');
  if (backBtn) {
    backBtn.addEventListener('click', () => goBack());
  }

  // 底部導覽列顯示/隱藏（桌機隱藏、手機顯示；如你希望桌機也顯示，移除此段即可）
  const syncBottomNavVisibility = () => {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    if (window.innerWidth < 768) nav.classList.remove('hidden');
    else nav.classList.add('hidden');
  };
  syncBottomNavVisibility();
  window.addEventListener('resize', syncBottomNavVisibility);

  // 瀏覽器返回/前進
  window.addEventListener('popstate', (e) => {
    const section = (e.state && e.state.section) ? e.state.section : (location.hash ? location.hash.replace('#', '') : 'home');
    navigateTo(section, false);
    if (navStack.length > 1) navStack.pop();
    updateBackButton();
  });
}

// 返回按鈕顯示控制（若頁面有 back-button）
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

// 回上一頁（使用 history.back 與 popstate 保持一致）
function goBack() {
  if (navStack.length <= 1) return;
  history.back();
}

// 頁面切換邏輯（全站共用）
function navigateTo(sectionId, pushState = true) {
  const targetId = sectionId || 'home';

  // 隱藏所有 Section
  document.querySelectorAll('main > section').forEach(sec => {
    sec.classList.add('hidden');
    sec.classList.remove('active');
  });

  // 顯示目標 Section
  const target = document.getElementById(targetId);
  if (target) {
    target.classList.remove('hidden');
    target.classList.add('active');

    // 觸發特定頁面的渲染（避免每次全渲染）
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

  // 更新導覽列 Active 狀態（Sidebar & Bottom Nav）
  document.querySelectorAll('nav#sidebar a[data-section], #bottom-nav button[data-section]').forEach(el => {
    el.classList.remove('active');
    if (el.dataset.section === targetId) el.classList.add('active');
  });

  // history / stack
  const last = navStack.length ? navStack[navStack.length - 1] : null;
  if (pushState && last !== targetId) {
    history.pushState({ section: targetId }, '', '#' + targetId);
    navStack.push(targetId);
    updateBackButton();
  }

  // 捲動到頂部
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// 2) 首頁渲染（修復「今日概況/請假」呈現）
function renderHome() {
  // 最新公告（前 3 筆）
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

  // 今日概況（請假名單）
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

// 3) 公告頁
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

// 4) 公告彈窗（Overlay/Modal）
// === 優化 1：公告詳情 (修正按鈕位置與樣式) ===
function showAnnouncementDetail(item) {
    const modal = document.getElementById('announcement-detail');

    // 使用 .btn-close-absolute class
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


// Modal 關閉（同時關閉 matches 詳情卡，避免 overlay 卡住）
function hideModal() {
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('active'));
  document.body.classList.remove('modal-open');

  const analysis = document.getElementById('player-analysis');
  if (analysis) analysis.classList.add('hidden');
}

// === Stage 4: 影片燈箱支援（關閉時停止播放並清除樣式）===
const _originalHideModal = hideModal;
hideModal = function () {
  const modal = document.getElementById('announcement-detail');
  if (modal) {
    // 僅針對影片模式做清理，避免 iframe 繼續播放聲音
    if (modal.classList.contains('video-modal-content') || modal.querySelector('iframe')) {
      modal.classList.remove('video-modal-content');
      modal.innerHTML = '';
    }
  }
  _originalHideModal();
};


// 5) 訓練排程（重構：層級式 + 微型卡片）
function renderSchedule() {
  const container = document.getElementById('schedule-container');
  if (!container) return;
  container.innerHTML = '';

  const isMobile = window.innerWidth < 768;
  const qEl = document.getElementById('schedule-search');
  const query = (qEl ? qEl.value : '').trim().toLowerCase();

  // helper：是否符合搜尋
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
    // 收集該日符合條件的資料（依 slot 分組）
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

    // 有搜尋時：只顯示有符合的星期
    if (query && !dayHasMatch) return;

    if (query && dayHasMatch) anyMatchOverall = true;

    // 第一層：星期標題（Accordion）
    const header = document.createElement('div');
    header.className = 'accordion-header';

    const todayDayIndex = new Date().getDay(); // 0=Sun, 1=Mon...
    const isToday = (index + 1) === todayDayIndex || (index === 6 && todayDayIndex === 0);

    header.innerHTML = `<span>${day}</span> <i class="fas fa-chevron-down"></i>`;

    // 第二層：內容容器
    const content = document.createElement('div');
    content.className = 'accordion-content';

    // 預設展開：有搜尋時全部展開；無搜尋時展開「今天」
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

    // 無資料狀態（無搜尋時才顯示）
    if (!query && !dayHasAny) {
      content.innerHTML = '<div style="padding:10px; color:#999; text-align:center;">本日無排程</div>';
      return;
    }

    // 渲染時段
    const slotsToRender = query ? Object.keys(matchedBySlot) : defaultSlots.filter(s => (schedule[day] && schedule[day][s] && schedule[day][s].length > 0));
    if (slotsToRender.length === 0) {
      // 有搜尋但該日無符合（理論上不會進來）；保底
      content.innerHTML = '<div style="padding:10px; color:#999; text-align:center;">無符合的排程</div>';
      return;
    }

    slotsToRender.forEach(slot => {
      const entries = query ? (matchedBySlot[slot] || []) : (schedule[day] && schedule[day][slot] ? schedule[day][slot] : []);
      if (!entries || entries.length === 0) return;

      // 時段標題
      const slotHeader = document.createElement('div');
      slotHeader.className = 'time-slot-header';
      slotHeader.textContent = slot;
      content.appendChild(slotHeader);

      // 第三層：卡片容器
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

// 6) 名冊（加入搜尋）
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

  // 教練
  staff.forEach(c => {
    const name = c?.name || '';
    const info = '教練';
    const hit = !searchVal || name.toLowerCase().includes(searchVal);
    if (!hit) return;
    staffDiv.appendChild(createRosterCard(name, info, 'fa-user-tie'));
  });

  // 球員
  players.forEach(p => {
    const name = p?.name || '';
    const number = String(p?.number ?? '');
    const info = `${p?.class || ''} | #${number}`;
    const hit = !searchVal
      || name.toLowerCase().includes(searchVal)
      || number.toLowerCase().includes(searchVal);
    if (!hit) return;
    playerDiv.appendChild(createRosterCard(name, info, 'fa-user'));
  });

  // 重新初始化 3D Tilt
  if (window.VanillaTilt) {
    VanillaTilt.init(document.querySelectorAll('.card[data-tilt]'), {
      max: 10, speed: 400, glare: true, 'max-glare': 0.2, scale: 1.02
    });
  }
}

// 7) 置頂按鈕
window.addEventListener('scroll', () => {
  const btn = document.getElementById('back-to-top');
  if (!btn) return;
  if (window.scrollY > 300) btn.classList.add('show');
  else btn.classList.remove('show');
});

// 8) Toast（保留原功能，避免 alert）
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<i class="fas fa-info-circle" style="margin-right:8px; color:var(--accent-gold);"></i> ${escapeHtml(message)}`;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

// 9) 請假（沿用原本邏輯，強化 null guard）
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

      // sendToGas 內部會重新載入資料並刷新請假列表
      form.reset();
    };
  }

  if (delBtn) {
    delBtn.onclick = () => {
      const list = loadLeaveRequests();
      const checkboxes = document.querySelectorAll('#leave-list input[type="checkbox"]:checked');
      const idsToDelete = Array.from(checkboxes).map(cb => cb.value);
      if (idsToDelete.length === 0) return;

      const newList = list.filter(item => !idsToDelete.includes(item.id));
      saveLeaveRequests(newList);
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
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th></th><th>姓名</th><th>日期</th><th>時段</th><th>原因</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  list.forEach(item => {
    const tr = document.createElement('tr');

    const checkboxTd = document.createElement('td');
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = item.id;
    checkboxTd.appendChild(checkbox);

    tr.appendChild(checkboxTd);
    tr.innerHTML += `<td>${escapeHtml(item.name || '')}</td><td>${escapeHtml(item.date || '')}</td><td>${escapeHtml(item.slot || '')}</td><td>${escapeHtml(item.reason || '')}</td>`;
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  listDiv.appendChild(table);

  if (delBtn) delBtn.disabled = false;
}

// 10) 比賽紀錄（修復：HTML 無篩選器時不報錯）
function getPlayerName(id) {
  const p = players.find(pp => pp.id === id);
  return p ? p.name : id;
}

// === 優化版：比賽紀錄渲染 (緊湊 + 選取變色) ===
// === 優化 2：比賽紀錄渲染 (Multi-Filter + Toggle Logic) ===
function renderMatches() {
    const listDiv = document.getElementById('match-list');
    listDiv.innerHTML = '';

    // 取得新的篩選器元件
    const keywordInput = document.getElementById('match-keyword');
    const chkSingles = document.getElementById('filter-singles');
    const chkDoubles = document.getElementById('filter-doubles');

    function updateList() {
        listDiv.innerHTML = '';
        const keyword = keywordInput ? keywordInput.value.trim() : '';
        const showSingles = chkSingles ? chkSingles.checked : true;
        const showDoubles = chkDoubles ? chkDoubles.checked : true;

        // 篩選邏輯：類型複選 + 關鍵字
        const filtered = matches.filter(m => {
            // 類型檢查 (只要符合勾選的其中一項即可)
            let typeMatch = false;
            if (showSingles && m.type === 'singles') typeMatch = true;
            if (showDoubles && m.type === 'doubles') typeMatch = true;

            // 名字檢查 helper
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
            card.className = 'match-card'; // 保持之前的緊湊樣式

            const playerNames = item.players.map(id => players.find(p => p.id === id)?.name || id).join('、');
            const opponentNames = item.opponents.map(id => players.find(p => p.id === id)?.name || id).join('、');
            const typeLabel = item.type === 'singles' ? '單打' : '雙打';

            card.innerHTML = `
                <div class="match-card-header">
                    <span class="match-type-badge">${typeLabel}</span>
                    <span>${item.date}</span>
                </div>
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <div class="match-card-vs">
                        <span>${playerNames}</span>
                        <i class="fas fa-times"></i>
                        <span>${opponentNames}</span>
                    </div>
                    <div class="match-card-score">${item.score}</div>
                </div>
            `;

            // === 關鍵修改：Toggle 點擊邏輯 ===
            card.addEventListener('click', () => {
                const detailPanel = document.getElementById('player-analysis');

                // 檢查是否點擊了「已經選取」的卡片
                if (card.classList.contains('selected')) {
                    // 情況 A：再次點擊 -> 取消選取並關閉詳情
                    card.classList.remove('selected');
                    detailPanel.classList.add('hidden');
                } else {
                    // 情況 B：點擊新卡片 -> 切換選取並顯示詳情
                    document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
                    card.classList.add('selected');
                    showMatchDetail(item);
                }
            });

            listDiv.appendChild(card);
        });
    }

    // 綁定事件監聽
    if(keywordInput) keywordInput.oninput = updateList;
    if(chkSingles) chkSingles.onchange = updateList;
    if(chkDoubles) chkDoubles.onchange = updateList;

    updateList();
}



// === 優化 3：比賽詳情面板 (右上角關閉按鈕) ===
function showMatchDetail(item) {
    const modal = document.getElementById('player-analysis');

    // 使用 getPlayerName helper (假設 script.js 上方已有定義，若無請補上)
    const getPName = (id) => players.find(p => p.id === id)?.name || id;
    const playerNames = item.players.map(getPName).join('、');
    const opponentNames = item.opponents.map(getPName).join('、');

    // 構建新的 HTML，將關閉按鈕移至右上角
    modal.innerHTML = `
        <button class="btn-close-absolute" onclick="closeMatchDetail()"><i class="fas fa-times"></i></button>

        <h3 style="margin:0 0 10px 0; color:var(--primary-color);">
            ${item.type === 'singles' ? '單打' : '雙打'}詳情
        </h3>

        <div style="background:#f9f9f9; padding:10px; border-radius:8px; margin-bottom:15px;">
            <div style="font-weight:bold; color:#333; margin-bottom:5px;">${playerNames} <span style="color:#e74c3c;">vs</span> ${opponentNames}</div>
            <div style="font-size:0.9rem; color:#666;">日期：${item.date}</div>
            <div style="font-size:0.9rem; color:#666;">比分：<span style="font-weight:bold; color:var(--primary-dark);">${item.score}</span></div>
        </div>

        ${item.details && item.details.length > 0 ? `
        <div style="margin-bottom:15px;">
            <h4 style="font-size:0.9rem; color:#888; margin-bottom:5px;">局分細節</h4>
            <div style="display:flex; gap:5px; flex-wrap:wrap;">
                ${item.details.map((s, i) => 
                    `<span style="background:white; border:1px solid #ddd; padding:2px 8px; border-radius:4px; font-size:0.85rem;">G${i+1}: ${s}</span>`
                ).join('')}
            </div>
        </div>` : ''}

        ${item.note ? `<div style="font-size:0.9rem; color:#555; line-height:1.5; margin-bottom:15px; border-left:3px solid #ddd; padding-left:8px;">備註：${item.note}</div>` : ''}

        ${item.video && item.video.url ? `
        <div style="margin-top:10px;">
             ${item.video.provider === 'yt' ? 
                `<iframe src="${item.video.url.replace('watch?v=', 'embed/')}" style="width:100%; height:200px; border-radius:8px; border:none;" allowfullscreen></iframe>` : 
                `<a href="${item.video.url}" target="_blank" class="hero-btn" style="display:block; text-align:center; font-size:0.9rem;">前往觀看影片</a>`
             }
        </div>` : ''}
    `;

    modal.classList.remove('hidden');

    // 滾動到詳情位置
    modal.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 新增：專門用於關閉比賽詳情的 helper，同時移除卡片選取狀態
function closeMatchDetail() {
    const modal = document.getElementById('player-analysis');
    modal.classList.add('hidden');
    // 移除所有卡片的選取狀態
    document.querySelectorAll('.match-card').forEach(c => c.classList.remove('selected'));
}




// 11) 影音區（沿用原概念：從 matches 收集影片）
// === Stage 4: 影音專區渲染（沈浸式網格 + YouTube 縮圖）===
function renderMedia() {
  const container = document.getElementById('media-list');
  if (!container) return;

  // 切換為 grid 佈局
  container.className = 'video-grid';
  container.innerHTML = '';

  // 篩選出有影片連結的比賽
  const videos = (matches || []).filter(m => m.video && m.video.url);

  if (videos.length === 0) {
    container.innerHTML = '<div style="grid-column:1/-1; text-align:center; padding:40px; color:#aaa;">目前尚無影音紀錄</div>';
    return;
  }

  // Helper: 從 YouTube URL 提取 ID
  const getYouTubeID = (url) => {
    if (!url) return null;
    const regExp = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]{11}).*/;
    const match = String(url).match(regExp);
    return match ? match[2] : null;
  };

  // Fallback 縮圖（非 YouTube 或無法解析 ID 時）
  const fallbackThumb = `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="450" viewBox="0 0 800 450">
      <defs>
        <linearGradient id="g" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stop-color="#222"/>
          <stop offset="1" stop-color="#111"/>
        </linearGradient>
      </defs>
      <rect width="800" height="450" fill="url(#g)"/>
      <circle cx="400" cy="225" r="70" fill="rgba(255,255,255,0.08)"/>
      <polygon points="385,190 385,260 445,225" fill="rgba(255,255,255,0.55)"/>
      <text x="400" y="350" text-anchor="middle" fill="rgba(255,255,255,0.55)" font-family="Arial" font-size="22">
        Video
      </text>
    </svg>`
  )}`;

  videos.forEach(item => {
    const ytId = getYouTubeID(item.video.url);

    const thumbUrl = ytId
      ? `https://img.youtube.com/vi/${ytId}/mqdefault.jpg`
      : fallbackThumb;

    const playerNames = (item.players || []).map(getPlayerName).join('、');
    const opponentNames = (item.opponents || []).map(getPlayerName).join('、');
    const typeLabel = item.type === 'singles' ? '單打' : '雙打';

    const card = document.createElement('div');
    card.className = 'video-card';
    card.innerHTML = `
      <div class="video-thumb-container">
        <img src="${thumbUrl}" class="video-thumb" loading="lazy" alt="video thumbnail">
        <div class="play-icon-overlay"><i class="far fa-play-circle"></i></div>
      </div>
      <div class="video-info">
        <div class="video-title">${playerNames} <span style="color:#bbb;">vs</span> ${opponentNames}</div>
        <div class="video-meta">
          <span><i class="fas fa-calendar-alt"></i> ${item.date || ''}</span>
          <span>${typeLabel}</span>
        </div>
      </div>
    `;

    // 點擊播放：YouTube -> 燈箱；其他平台 -> 新分頁
    card.onclick = () => {
      if (ytId) {
        openVideoModal(ytId);
      } else {
        window.open(item.video.url, '_blank');
      }
    };

    container.appendChild(card);
  });
}

// 開啟影片燈箱（暫用公告 Modal 容器）
function openVideoModal(ytId) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;

  modal.innerHTML = `
    <div style="position:relative; width:100%; height:100%;">
      <button class="btn-close-absolute" onclick="hideModal()" style="top:10px; right:10px; color:white;">
        <i class="fas fa-times"></i>
      </button>
      <iframe
        src="https://www.youtube.com/embed/${ytId}?autoplay=1&rel=0"
        style="width:100%; height:100%; border:none; border-radius:8px;"
        allow="autoplay; encrypted-media"
        allowfullscreen>
      </iframe>
    </div>
  `;

  // 加上特殊 class 讓它變黑底全寬
  modal.classList.add('video-modal-content');

  document.body.classList.add('modal-open');
  modal.classList.add('active');
}

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
    loginBtn.onclick = () => {
      const pwd = (document.getElementById('admin-password')?.value || '').trim();
      if (pwd) {
        adminLoggedIn = true;
        renderAdmin();
      } else {
        if (errorP) errorP.classList.remove('hidden');
      }
    };
  }

  const addAnnBtn = document.getElementById('admin-add-announcement');
  if (addAnnBtn) addAnnBtn.onclick = () => showAdminAddAnnouncement();

  const viewLeaveBtn = document.getElementById('admin-view-leave');
  if (viewLeaveBtn) viewLeaveBtn.onclick = () => showAdminLeaveList();

  const manageScheduleBtn = document.getElementById('admin-manage-schedule');
  if (manageScheduleBtn) manageScheduleBtn.onclick = () => showAdminManageSchedule();
}

function renderAdminAnnouncementForm() {
  const content = document.getElementById('admin-content');
  if (!content) return;

  content.innerHTML = `
    <div class="admin-form-card">
      <h3 style="margin-top:0; color:var(--primary-color);">發布新公告</h3>
      <form id="admin-ann-form">
        <div class="admin-form-group">
          <label>公告標題</label>
          <input type="text" id="new-ann-title" class="admin-input" placeholder="例如：112學年度下學期訓練時間異動" required>
        </div>
        <div class="admin-form-group">
          <label>發布日期</label>
          <input type="date" id="new-ann-date" class="admin-input" required>
        </div>
        <div class="admin-form-group">
          <label>公告內容</label>
          <textarea id="new-ann-content" class="admin-textarea" rows="6" placeholder="請輸入詳細內容..." required></textarea>
        </div>
        <button type="submit" class="hero-btn" style="width:100%;">確認發布</button>
      </form>
    </div>
  `;

  // 預設日期為今天
  const dateEl = document.getElementById('new-ann-date');
  if (dateEl && !dateEl.value) {
    dateEl.value = new Date().toISOString().split('T')[0];
  }

  const form = document.getElementById('admin-ann-form');
  if (!form) return;

  form.onsubmit = (e) => {
    e.preventDefault();

    const title = document.getElementById('new-ann-title').value.trim();
    const date = document.getElementById('new-ann-date').value;
    const contentText = document.getElementById('new-ann-content').value.trim();

    if (!title || !date || !contentText) return;

    // 更新前端顯示（實際寫回資料表的邏輯請接續您的原本流程）
    announcements.unshift({ title, date, content: contentText });

    // 立即刷新公告列表 & 首頁
    renderAnnouncements();
    renderHome();

    showToast(`公告「${title}」已發布`);

    form.reset();
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  };
}

function showAdminAddAnnouncement() {
  renderAdminAnnouncementForm();
}


function showAdminLeaveList() {
  const contentDiv = document.getElementById('admin-content');
  if (!contentDiv) return;

  contentDiv.innerHTML = '<h4>全部請假紀錄</h4>';
  const list = loadLeaveRequests();

  if (!list || list.length === 0) {
    contentDiv.innerHTML += '<p style="color:#888;">尚無請假紀錄</p>';
    return;
  }

  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>姓名</th><th>日期</th><th>時段</th><th>原因</th></tr></thead>
    <tbody>
      ${list.map(item => `
        <tr>
          <td>${escapeHtml(item.name || '')}</td>
          <td>${escapeHtml(item.date || '')}</td>
          <td>${escapeHtml(item.slot || '')}</td>
          <td>${escapeHtml(item.reason || '')}</td>
        </tr>
      `).join('')}
    </tbody>
  `;
  contentDiv.appendChild(table);
}

function showAdminManageSchedule() {
  const contentDiv = document.getElementById('admin-content');
  if (!contentDiv) return;
  contentDiv.innerHTML = '<h4>管理排程（示意）</h4><p style="color:#666;">此區域日後可嵌入表單或進階排程管理介面。</p>';
}

// 13) 手勢滑動開合側欄（沿用你原本的 UX）
let touchStartX = 0;
let touchStartY = 0;

document.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }
});

document.addEventListener('touchend', (e) => {
  if (e.changedTouches.length === 1) {
    const endX = e.changedTouches[0].clientX;
    const endY = e.changedTouches[0].clientY;
    const deltaX = endX - touchStartX;
    const deltaY = Math.abs(endY - touchStartY);

    if (deltaY < 50) {
      // 從左邊緣滑動開啟
      if (!document.body.classList.contains('sidebar-open') && touchStartX < 30 && deltaX > 70 && window.innerWidth < 768) {
        openSidebar();
      }
      // 從側欄內滑動關閉
      if (document.body.classList.contains('sidebar-open') && deltaX < -70 && window.innerWidth < 768) {
        closeSidebar();
      }
    }
  }
});

// 14) 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 1. 載入資料
  await loadAllData();

  // 2. 初始化導覽監聽（重要）
  initNavigation();

  // 3. Schedule 搜尋：輸入即重繪（避免必須切頁）
  const scheduleSearch = document.getElementById('schedule-search');
  if (scheduleSearch) {
    scheduleSearch.addEventListener('input', () => {
      const scheduleSection = document.getElementById('schedule');
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) renderSchedule();
    });
  }

  // 4. Hero Button：前往排程
  const heroBtn = document.getElementById('hero-btn');
  if (heroBtn) heroBtn.addEventListener('click', () => navigateTo('schedule'));

  // 5. 初次進入頁面：hash 優先，其次 home；使用 replaceState 避免多一層 history
  const initial = (location.hash ? location.hash.replace('#', '') : 'home') || 'home';
  history.replaceState({ section: initial }, '', '#' + initial);
  navStack = [initial];
  updateBackButton();
  navigateTo(initial, false);

  // 6. 視窗尺寸變化：排程頁若可見則重繪（確保手機/桌機切換）
  // === Bug Fix: 防止手機滑動時網址列伸縮導致排程重置 ===
  let lastWidth = window.innerWidth;

  window.addEventListener('resize', () => {
    // 只有當「寬度」發生改變時，才視為需要重新佈局 (例如旋轉手機)
    if (window.innerWidth !== lastWidth) {
      lastWidth = window.innerWidth;

      const scheduleSection = document.getElementById('schedule');
      // 只有當目前正在看排程頁面時，才重新渲染
      if (scheduleSection && !scheduleSection.classList.contains('hidden')) {
        renderSchedule();
      }

      // 更新底部導航顯示狀態
      const bottomNav = document.getElementById('bottom-nav');
      if (bottomNav) {
        if (window.innerWidth < 768) bottomNav.classList.remove('hidden');
        else bottomNav.classList.add('hidden');
      }
    }
  });

  // 7. Modal close button 代理（保險）
  document.body.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.classList) return;
    if (t.classList.contains('modal-close-button')) hideModal();
  });
});

// -------------------------------------------------------------
// === 安全字串處理（避免插入 HTML 造成版面/安全問題）===
// -------------------------------------------------------------
function escapeHtml(str) {
  return String(str)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function escapeAttr(str) {
  // attribute 用：避免引號破壞屬性
  return escapeHtml(str).replaceAll('`', '&#96;');
}

// -------------------------------------------------------------
// Data Normalization (Backend -> UI)
// -------------------------------------------------------------

// 將各種日期格式標準化為 YYYY-MM-DD（支援 Date / Excel serial / 可解析字串）
// 注意：此 helper 僅供 normalizeData 使用；若你已有更完整的實作，可保留你的版本並移除此段。
function formatDate(value) {
  if (value === null || value === undefined) return '';
  // Date 物件
  if (value instanceof Date && !isNaN(value.getTime())) {
    return value.toISOString().split('T')[0];
  }
  // Excel serial number（以 1899-12-30 為基準）
  if (typeof value === 'number' && isFinite(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + value * 86400000);
    return d.toISOString().split('T')[0];
  }
  const s = String(value).trim();
  if (!s) return '';
  // 已是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // 常見 YYYY/MM/DD
  if (/^\d{4}\/\d{1,2}\/\d{1,2}$/.test(s)) {
    const [y, m, d] = s.split('/').map(x => parseInt(x, 10));
    const dt = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
    return dt.toISOString().split('T')[0];
  }
  // 其他可解析字串
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().split('T')[0];
  return s; // 無法解析則原樣回傳
}

// 將 Google Drive 分享連結轉換為可直接顯示的連結（圖片用）
// 支援：.../file/d/<id>/view、open?id=<id>、uc?id=<id>
function convertDriveLink(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!s) return '';
  // 若已是可用的 direct link，直接回傳
  if (s.includes('lh3.googleusercontent.com') || s.includes('googleusercontent.com')) return s;

  let id = '';
  const m1 = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (m1) id = m1[1];

  if (!id) {
    const m2 = s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
    if (m2) id = m2[1];
  }

  if (!id) return s;

  // export=view 對圖片最常用；若你是要下載可改 export=download
  return `https://drive.google.com/uc?export=view&id=${id}`;
}

// 將後端回傳的 Excel 欄位轉為前端 UI 變數
function normalizeData(rawData) {
  // 取得 Config（容錯：有些後端可能回傳 config 或 hero）
  const config = rawData.hero || rawData.config || {};

  // 1. 公告
  const announcements = (rawData.announcements || []).map(r => ({
    id: r.announcement_id ?? r.id ?? r.rowId,
    date: formatDate(r.date),
    title: r.title || '',
    content: r.content || ''
  }));

  // 2. 球員 (注意欄位對應)
  const players = (rawData.players || []).map(r => ({
    rowId: r.rowId, // 重要：用於編輯/刪除
    id: r.player_id ?? r.id,
    name: r.student_name ?? r.name ?? '', // Excel: student_name -> UI: name
    number: r.team_no ?? r.number ?? '',  // Excel: team_no -> UI: number
    class: r.class ?? '',
    photo: convertDriveLink(r.photo_url ?? r.photo ?? ''), // Excel: photo_url
    positions: r.positions ?? ''
  }));

  // 3. 賽程 (Schedule) - Excel slot 欄位為字串，例如 18:00-19:00
  const scheduleData = [];
  (rawData.training_schedule || []).forEach(r => {
    scheduleData.push({
      rowId: r.rowId,
      date: r.weekday,           // 確保 Excel 填的是 '週一'
      slot: r.slot,              // 確保 Excel 填的是 '18:00-19:00' 且與 defaultSlots 一致
      table: r.table_no,
      coach: { name: r.coach_id },    // 暫時顯示 ID（進階可對照 staff 表）
      playerA: { name: r.player_a_id },
      playerB: { name: r.player_b_id },
      remark: r.note || ''
    });
  });

  // 4. 請假（容錯支援 leave_requests / leaveRequests）
  const leaveRequests = (rawData.leave_requests || rawData.leaveRequests || []).map(r => ({
    id: r.leave_id ?? r.id ?? r.rowId ?? String(Date.now()),
    name: r.name || r.student_name || '',
    date: formatDate(r.date),
    slot: r.slot || '',
    reason: r.reason || r.note || ''
  }));

  // 5. 比賽紀錄（若後端已回前端格式，直接沿用；否則保持原樣）
  const matches = rawData.matches || rawData.match_records || rawData.match || [];

  return {
    hero: config,
    announcements,
    players,
    schedules: scheduleData,
    staff: rawData.staff || [],
    matches,
    leaveRequests,
    parents: rawData.parents || [],
    parentChild: rawData.parent_child || rawData.parentChild || [],
    accounts: rawData.accounts || [],
    videos: rawData.media || rawData.videos || []
  };
}

