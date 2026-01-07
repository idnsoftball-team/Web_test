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
let adminLoggedIn = false;  // 管理員登入狀態

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
    window.heroConfig = data.hero || {};

    // 2) 排程處理：轉為 UI 需要的巢狀物件 schedule[day][slot] = []
    initEmptySchedule();

    if (data.schedules && Array.isArray(data.schedules)) {
      data.schedules.forEach(item => {
        const day = item.date;   // 例如：'週一'
        const slot = item.slot; // 例如：'18:00-19:00'

        if (schedule[day] && schedule[day][slot]) {
          schedule[day][slot].push(item);
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
  } finally {
    // ★ 新增：移除 Loading 畫面（避免斷點感）
    const loader = document.getElementById('app-loader');
    if (loader) {
      loader.style.opacity = '0';
      setTimeout(() => loader.remove(), 500); // 等動畫跑完再移除 DOM
    }
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

// 管理功能：需要密碼驗證的 GAS 寫入
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
            if(action.includes('leave')) showAdminLeaveList();
            if(action.includes('config')) renderHome();
        } else {
            showToast('失敗: ' + result.message);
        }
    } catch(e) {
        showToast('連線錯誤');
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
// C. 確認：導覽初始化
function initNavigation() {
  // 1. 側邊欄連結點擊（事件委派）
  const sidebarNav = document.querySelector('nav#sidebar');
  if (sidebarNav) {
    sidebarNav.addEventListener('click', (e) => {
      const link = e.target.closest('a[data-section]');
      if (!link) return;
      e.preventDefault();
      const section = link.dataset.section;
      if (section) {
        navigateTo(section);
        if (window.innerWidth < 768 && typeof closeSidebar === 'function') closeSidebar();
      }
    });
  }

  // 2. 底部導覽（事件委派）
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-section]');
      if (!btn) return;
      const section = btn.dataset.section;
      if (section) navigateTo(section);
    });
  }

  // 3. 漢堡選單（關鍵：阻止冒泡避免被 overlay/其他層攔截）
  const menuToggleEl = document.getElementById('menu-toggle');
  if (menuToggleEl) {
    menuToggleEl.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof toggleSidebar === 'function') toggleSidebar();
      else document.body.classList.toggle('sidebar-open');
    };
  }

  // ★ 新增這段：讓標題也能開關側邊欄
  const headerTitle = document.querySelector('header h1');
  if (headerTitle) {
    headerTitle.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (typeof toggleSidebar === 'function') toggleSidebar();
    };
  }

  // 4. 遮罩層關閉
  const overlayEl = document.getElementById('overlay');
  if (overlayEl) {
    overlayEl.addEventListener('click', () => {
      if (document.body.classList.contains('sidebar-open')) {
        if (typeof closeSidebar === 'function') closeSidebar();
        else document.body.classList.remove('sidebar-open');
      } else {
        hideModal();
      }
    });
  }

  // 返回按鈕/歷史堆疊（若專案有用）
  const backBtn = document.getElementById('back-button');
  if (backBtn && typeof goBack === 'function') backBtn.addEventListener('click', () => goBack());

  if (typeof navStack !== 'undefined' && typeof updateBackButton === 'function') {
    window.addEventListener('popstate', (e) => {
      const section = (e.state && e.state.section) ? e.state.section : 'home';
      // 若 navigateTo 有第二參數控制 pushState，保險處理
      try { navigateTo(section, false); } catch(_) { navigateTo(section); }
      if (navStack.length > 1) navStack.pop();
      updateBackButton();
    });
  }

  // 底部導覽顯示狀態（RWD）
  const syncBottomNavVisibility = () => {
    const nav = document.getElementById('bottom-nav');
    if (!nav) return;
    if (window.innerWidth < 768) nav.classList.remove('hidden');
    else nav.classList.add('hidden');
  };
  syncBottomNavVisibility();
  window.addEventListener('resize', syncBottomNavVisibility);
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

  // 套用 Hero 設定（背景圖）
  try {
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
  } catch (e) {
    // ignore
  }

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
    const grade = String(p?.grade ?? '');
    const cls = String(p?.class ?? '');
    const paddle = String(p?.paddle ?? '');

    const infoParts = [];
    if (grade) infoParts.push(`${grade}年`);
    if (cls) infoParts.push(`${cls}班`);
    let info = infoParts.join(' ');
    if (paddle) info += (info ? ' | ' : '') + `膠皮:${paddle}`;

    const hay = [name, grade, cls, paddle, p?.nickname, p?.hand, p?.style].filter(Boolean).join(' ').toLowerCase();
    const hit = !searchVal || hay.includes(searchVal);
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

// B. 修復：請假列表改用卡片式排版 (解決左右卷軸問題)
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

  // 建立容器
  const container = document.createElement('div');
  container.className = 'leave-list-container';

  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item has-checkbox';

    card.innerHTML = `
      <div class="leave-item-header">
        <span class="leave-item-name">${escapeHtml(item.name || '')}</span>
        <span class="leave-item-date">${escapeHtml(item.date || '')} ${escapeHtml(item.slot || '')}</span>
      </div>
      <div class="leave-item-reason">${escapeHtml(item.reason || '')}</div>
      <div class="leave-checkbox-wrapper">
        <input type="checkbox" value="${escapeHtml(String(item.rowId || ''))}" style="transform: scale(1.5);">
      </div>
    `;

    container.appendChild(card);
  });

  listDiv.appendChild(container);

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

  // script.js - renderAdmin 內
  const loginBtn = document.getElementById('admin-login-btn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      const pwd = (document.getElementById('admin-password')?.value || '').trim();
      if (!pwd) {
        if (errorP) errorP.classList.remove('hidden');
        return;
      }

      // 修改：顯示處理中，並向後端驗證密碼
      loginBtn.textContent = '驗證中...';
      loginBtn.disabled = true;

      try {
        // 發送 check_auth 請求
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            body: JSON.stringify({ action: 'check_auth', password: pwd })
        });
        const result = await response.json();

        if (result.success) {
            // 驗證成功
            adminLoggedIn = true;
            // 把正確密碼暫存到欄位裡（給後續操作用），或者您也可以存到變數
            document.getElementById('admin-password').value = pwd; 
            renderAdmin();
            showToast('登入成功');
        } else {
            // 驗證失敗
            if (errorP) {
                errorP.textContent = '密碼錯誤';
                errorP.classList.remove('hidden');
            }
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

  const managePlayersBtn = document.getElementById('admin-manage-players');
  if (managePlayersBtn) managePlayersBtn.onclick = () => showAdminPlayerList();

  const manageMatchesBtn = document.getElementById('admin-manage-matches');
  if (manageMatchesBtn) manageMatchesBtn.onclick = () => showAdminMatchList();

  const manageScheduleBtn = document.getElementById('admin-manage-schedule');
  if (manageScheduleBtn) manageScheduleBtn.onclick = () => showAdminScheduleList();

  const settingsBtn = document.getElementById('admin-settings');
  if (settingsBtn) settingsBtn.onclick = () => showAdminSettings();

  const heroSettingsBtn = document.getElementById('admin-hero-settings');
  if (heroSettingsBtn) heroSettingsBtn.onclick = () => showAdminSettings();

  const siteSettingsBtn = document.getElementById('admin-site-settings');
  if (siteSettingsBtn) siteSettingsBtn.onclick = () => showAdminSettings();
}

// A. 修復：新增公告後自動清空表單
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
  const dateEl = document.getElementById('new-ann-date');
  if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];

  const form = document.getElementById('admin-ann-form');
  if (!form) return;

  form.onsubmit = async (e) => {
    e.preventDefault();
    const title = (document.getElementById('new-ann-title')?.value || '').trim();
    const date = (document.getElementById('new-ann-date')?.value || '').trim();
    const contentText = (document.getElementById('new-ann-content')?.value || '').trim();
    if (!title || !date || !contentText) return;

    await sendToGasWithAuth('add_announcement', { title, date, content: contentText });

    // ★ Bug Fix 1: 送出成功後清空表單
    form.reset();
    if (dateEl) dateEl.value = new Date().toISOString().split('T')[0];
  };
}


function showAdminAddAnnouncement() {
  renderAdminAnnouncementForm();
}


// A. 顯示管理後台：請假列表 (含編輯/刪除按鈕)
// ★ 更新：管理後台 - 請假列表 (卡片式檢視，無左右捲軸) 
function showAdminLeaveList() {
  const contentDiv = document.getElementById('admin-content');
  // 清空並重建容器
  contentDiv.innerHTML = `
    <h4 style="margin-bottom:15px; color:var(--primary-color); border-bottom:2px solid #eee; padding-bottom:10px;">
      全部請假紀錄
    </h4>
    <div id="admin-leave-list" class="leave-list-container"></div>
  `;

  const list = loadLeaveRequests();
  const listContainer = document.getElementById('admin-leave-list');

  if (!list || list.length === 0) {
    listContainer.innerHTML = '<div class="card" style="text-align:center; color:#888; padding:20px;">目前尚無請假紀錄</div>';
    return;
  }

  // 渲染卡片列表
  list.forEach(item => {
    const card = document.createElement('div');
    card.className = 'leave-item';

    card.innerHTML = `
      <div class="leave-item-header">
        <div class="leave-item-name">${escapeHtml(item.name)}</div>
        <div class="leave-item-date">
          ${escapeHtml(item.date)} <span>${escapeHtml(item.slot)}</span>
        </div>
      </div>

      <div class="leave-item-reason">
        ${escapeHtml(item.reason)}
      </div>

      <div class="leave-item-actions">
        <button class="action-btn edit"><i class="fas fa-edit"></i> 編輯</button>
        <button class="action-btn delete"><i class="fas fa-trash-alt"></i> 刪除</button>
      </div>
    `;

    // 綁定按鈕事件
    const btnEdit = card.querySelector('.edit');
    const btnDelete = card.querySelector('.delete');

    btnEdit.onclick = () => {
       const newReason = prompt('修改請假原因：', item.reason);
       if(newReason !== null) {
           sendToGasWithAuth('update_leave', {
               rowId: item.rowId,
               name: item.name,
               date: item.date,
               slot: item.slot,
               reason: newReason
           });
       }
    };

    btnDelete.onclick = () => {
        if(confirm(`確定要刪除 ${item.name} 的請假嗎？`)) {
            sendToGasWithAuth('delete_leave', { rowId: item.rowId });
        }
    };

    listContainer.appendChild(card);
  });
}



// B. 新增：網站設定 (Hero Banner)
function showAdminSettings() {
    const contentDiv = document.getElementById('admin-content');
    const currentBg = (window.heroConfig && window.heroConfig.hero_bg_url) || '';

    contentDiv.innerHTML = `
        <div class="admin-form-card">
            <h3 style="margin-top:0; color:var(--primary-color);">網站外觀設定</h3>
            <div class="admin-form-group">
                <label>Hero Banner 圖片連結</label>
                <input type="text" id="conf-hero-bg" class="admin-input" value="${escapeHtml(currentBg)}" placeholder="請輸入圖片 URL">
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


// === Patch: Ensure Admin Settings + Auth helpers exist (for index.html onclick) ===

// 1. 驗證並發送請求的通用函式 (管理功能核心)
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
            // 操作成功後重新載入資料
            await loadAllData(); 

            // 根據 action 刷新畫面 (若有更新背景，刷新首頁)
            if(action === 'update_config') renderHome();
            // 若是更新請假，刷新列表
            if(action.includes('leave') && typeof showAdminLeaveList === 'function') showAdminLeaveList();
        } else {
            showToast('失敗: ' + result.message);
        }
    } catch(e) {
        console.error(e);
        showToast('連線錯誤');
    }
}

// 2. 顯示網站外觀設定面板 (Hero Banner)
function showAdminSettings() {
    const contentDiv = document.getElementById('admin-content');
    // 從 hero config 讀取目前設定
    const currentBg = (window.heroConfig && window.heroConfig.hero_bg_url) || '';

    contentDiv.innerHTML = `
        <div class="admin-form-card">
            <h3 style="margin-top:0; color:var(--primary-color);">網站外觀設定</h3>
            <div class="admin-form-group">
                <label>Hero Banner 圖片連結</label>
                <input type="text" id="conf-hero-bg" class="admin-input" value="${escapeHtml(currentBg)}" placeholder="請輸入圖片 URL (例如 Drive 圖片連結)">
                <small style="color:#666;">建議使用橫式高畫質圖片 (1920x1080)</small>
            </div>
            <button id="btn-save-config" class="hero-btn" style="width:100%;">儲存設定</button>
        </div>
    `;

    document.getElementById('btn-save-config').onclick = () => {
        const url = document.getElementById('conf-hero-bg').value.trim();
        // 呼叫帶密碼驗證的發送函式
        sendToGasWithAuth('update_config', { hero_bg_url: url });
    };
}

// === Stage 5: 管理後台 - 球員/排程/比賽管理 ===

// 共用：刪除確認
function confirmDel(action, rowId, name) {
  if (confirm(`確定要刪除 ${name} 嗎？`)) {
    sendToGasWithAuth(action, { rowId });
  }
}

// --- A) 球員名冊：搜尋 + 年級/班級排序（小→大）+ 摺疊卡片 ---
function showAdminPlayerList() {
  const contentDiv = document.getElementById('admin-content');
  contentDiv.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">球員名冊</h4>
      <button class="hero-btn" id="btn-add-player" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增</button>
    </div>

    <div class="admin-form-group" style="margin-bottom:15px;">
      <input type="text" id="player-search" class="admin-input" placeholder="搜尋姓名、班級、膠皮..." />
    </div>

    <div id="admin-player-list"></div>
  `;

  const addBtn = document.getElementById('btn-add-player');
  if (addBtn) addBtn.onclick = () => renderAdminPlayerForm();

  const searchInput = document.getElementById('player-search');
  if (searchInput) searchInput.oninput = () => filterAdminPlayerList();

  filterAdminPlayerList(); // 初次渲染
}

function filterAdminPlayerList() {
  const keyword = (document.getElementById('player-search')?.value || '').trim().toLowerCase();
  const listContainer = document.getElementById('admin-player-list');
  if (!listContainer) return;
  listContainer.innerHTML = '';

  // 排序：年級(小→大) > 班級(小→大)
  const sorted = players.slice().sort((a, b) => {
    const ga = Number(a.grade) || 99;
    const gb = Number(b.grade) || 99;
    if (ga !== gb) return ga - gb;

    const ca = Number(String(a.class || '').replace(/\D/g, '')) || 999999;
    const cb = Number(String(b.class || '').replace(/\D/g, '')) || 999999;
    if (ca !== cb) return ca - cb;

    return String(a.class || '').localeCompare(String(b.class || ''), 'zh-Hant');
  });

  const filtered = sorted.filter(p => {
    if (!keyword) return true;
    const hay = [
      p.name, p.nickname,
      p.grade ? `${p.grade}` : '',
      p.class ? `${p.class}` : '',
      p.paddle, p.hand, p.style
    ].filter(Boolean).join(' ').toLowerCase();
    return hay.includes(keyword);
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = '<div style="text-align:center; color:#888;">無符合資料</div>';
    return;
  }

  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'player-card';

    const gradeClass = `${p.grade ? (p.grade + '年') : ''} ${p.class ? (p.class + '班') : ''}`.trim();

    card.innerHTML = `
      <div class="player-header">
        <div class="player-info-main">
          <span class="player-name">${escapeHtml(p.name)}</span>
          <span class="player-class">${escapeHtml(gradeClass || '未填班級')}</span>
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
          <div style="grid-column:1/-1"><span class="detail-label">狀態:</span> <span style="color:${p.isActive==='FALSE'?'red':'green'}">${p.isActive==='FALSE'?'離隊':'在隊'}</span></div>
        </div>

        <div class="leave-item-actions" style="margin-top:15px;">
          <button class="action-btn edit"><i class="fas fa-edit"></i> 編輯</button>
          <button class="action-btn delete"><i class="fas fa-trash-alt"></i> 刪除</button>
        </div>
      </div>
    `;

    // 展開/收合
    const header = card.querySelector('.player-header');
    if (header) header.onclick = () => card.classList.toggle('expanded');

    // 編輯/刪除
    const editBtn = card.querySelector('.edit');
    if (editBtn) editBtn.onclick = (e) => { e.stopPropagation(); renderAdminPlayerForm(p); };

    const delBtn = card.querySelector('.delete');
    if (delBtn) delBtn.onclick = (e) => { e.stopPropagation(); confirmDel('delete_player', p.rowId, p.name); };

    listContainer.appendChild(card);
  });
}

// --- B) 球員表單：移除照片欄位 ---
function renderAdminPlayerForm(player = null) {
  const contentDiv = document.getElementById('admin-content');
  const isEdit = !!player;
  const p = player || {};

  const paddles = ['平面', '短顆', '中顆', '長顆', 'Anti', '不詳'];
  const styles = ['刀板', '直板', '日直', '削球'];
  const grades = [1, 2, 3, 4, 5, 6]; // 小→大

  contentDiv.innerHTML = `
    <div class="admin-form-card">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
        <h3 style="margin:0; color:var(--primary-color);">${isEdit ? '編輯球員' : '新增球員'}</h3>
        <button class="action-btn" onclick="showAdminPlayerList()" style="background:#eee; padding:5px 10px;">取消</button>
      </div>

      <form id="player-form">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div class="admin-form-group">
            <label>姓名 *</label>
            <input type="text" id="p-name" class="admin-input" value="${escapeHtml(p.name||'')}" required>
          </div>
          <div class="admin-form-group">
            <label>暱稱</label>
            <input type="text" id="p-nick" class="admin-input" value="${escapeHtml(p.nickname||'')}" placeholder="選填">
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:10px;">
          <div class="admin-form-group">
            <label>年級</label>
            <select id="p-grade" class="admin-select">
              <option value="">選</option>
              ${grades.map(g => `<option value="${g}" ${String(p.grade)==String(g)?'selected':''}>${g}</option>`).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>班級</label>
            <input type="text" id="p-class" class="admin-input" value="${escapeHtml(p.class||'')}" placeholder="例：1 或 601">
          </div>
          <div class="admin-form-group">
            <label>性別</label>
            <select id="p-gender" class="admin-select">
              <option value="男" ${p.gender==='男'?'selected':''}>男</option>
              <option value="女" ${p.gender==='女'?'selected':''}>女</option>
            </select>
          </div>
        </div>

        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:10px;">
          <div class="admin-form-group">
            <label>膠皮</label>
            <select id="p-paddle" class="admin-select">
              <option value="">請選擇</option>
              ${paddles.map(pd => `<option value="${pd}" ${p.paddle===pd?'selected':''}>${pd}</option>`).join('')}
            </select>
          </div>
          <div class="admin-form-group">
            <label>持拍</label>
            <select id="p-hand" class="admin-select">
              <option value="右手" ${p.hand==='右手'?'selected':''}>右手</option>
              <option value="左手" ${p.hand==='左手'?'selected':''}>左手</option>
            </select>
          </div>
        </div>

        <div class="admin-form-group">
          <label>打法 (可複選)</label>
          <div style="display:flex; gap:10px; flex-wrap:wrap; padding:10px; background:#f9f9f9; border-radius:8px;">
            ${styles.map(s => `
              <label style="display:flex; align-items:center; gap:5px; font-weight:normal; cursor:pointer; font-size:0.9rem;">
                <input type="checkbox" name="p-style" value="${s}" ${(p.style||'').includes(s)?'checked':''}>
                ${s}
              </label>
            `).join('')}
          </div>
        </div>

        <div class="admin-form-group">
          <label>狀態</label>
          <select id="p-active" class="admin-select">
            <option value="TRUE" ${p.isActive!=='FALSE'?'selected':''}>在隊</option>
            <option value="FALSE" ${p.isActive==='FALSE'?'selected':''}>離隊</option>
          </select>
        </div>

        <button type="submit" class="hero-btn" style="width:100%; margin-top:10px;">儲存</button>
      </form>
    </div>
  `;

  document.getElementById('player-form').onsubmit = (e) => {
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
      photo: '', // 已移除照片欄位
      isActive: document.getElementById('p-active').value
    };

    if (!payload.name) { showToast('請輸入姓名'); return; }

    sendToGasWithAuth('save_player', payload).then(() => {
      showAdminPlayerList();
    });
  };
}

// --- C) 排程管理：每週固定課表 ---
function showAdminScheduleList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">排程管理 (每週固定)</h4>
      <button class="hero-btn" id="btn-add-schedule" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增</button>
    </div>
    <div id="admin-schedule-list" class="leave-list-container"></div>
  `;

  const addBtn = document.getElementById('btn-add-schedule');
  if (addBtn) addBtn.onclick = () => renderAdminScheduleForm();

  // 展平所有排程以便列表顯示
  const flatList = [];
  weekdays.forEach(d => {
    defaultSlots.forEach(s => {
      if (schedule[d] && schedule[d][s] && Array.isArray(schedule[d][s])) {
        schedule[d][s].forEach(item => flatList.push({ ...item, day: d, slot: s }));
      }
    });
  });

  const listDiv = document.getElementById('admin-schedule-list');
  if (!listDiv) return;

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
        <div class="leave-item-date">T${escapeHtml(item.table || '-')}</div>
      </div>
      <div class="leave-item-reason">
        教練: ${escapeHtml(item.coach?.name || '-')}<br>
        選手: ${escapeHtml(item.playerA?.name || '-')} vs ${escapeHtml(item.playerB?.name || '-')}
      </div>
      <div class="leave-item-actions">
        <button class="action-btn edit">編輯</button>
        <button class="action-btn delete">刪除</button>
      </div>
    `;

    const editBtn = card.querySelector('.edit');
    if (editBtn) editBtn.onclick = () => renderAdminScheduleForm(item);

    const delBtn = card.querySelector('.delete');
    if (delBtn) delBtn.onclick = () => confirmDel('delete_schedule', item.rowId, '此排程');

    listDiv.appendChild(card);
  });
}

function renderAdminScheduleForm(item = null) {
  const isEdit = !!item;
  const s = item || {};
  const content = document.getElementById('admin-content');

  const coachOpts = staff
    .filter(c => c && c.name)
    .map(c => `<option value="${escapeHtml(c.id || '')}" ${String(s.coachId||'')===String(c.id||'')?'selected':''}>${escapeHtml(c.name)}</option>`)
    .join('');

  const playerOpts = players
    .filter(p => p && p.name)
    .map(p => `<option value="${escapeHtml(p.id || '')}">${escapeHtml(p.name)}${p.grade?(' ('+escapeHtml(p.grade)+'年)'):''}</option>`)
    .join('');

  content.innerHTML = `
    <div class="admin-form-card">
      <h3 style="margin-top:0;">${isEdit ? '編輯排程' : '新增排程'}</h3>
      <form id="schedule-form">
        <div class="admin-form-group"><label>星期</label>
          <select id="s-day" class="admin-select">${weekdays.map(d => `<option value="${d}" ${s.day===d || s.date===d ? 'selected' : ''}>${d}</option>`).join('')}</select>
        </div>

        <div class="admin-form-group"><label>時段</label>
          <select id="s-slot" class="admin-select">${defaultSlots.map(t => `<option value="${t}" ${String(s.slot||'')===String(t)?'selected':''}>${t}</option>`).join('')}</select>
        </div>

        <div class="admin-form-group"><label>桌次</label>
          <input type="text" id="s-table" class="admin-input" value="${escapeHtml(s.table||'')}" required>
        </div>

        <div class="admin-form-group"><label>教練</label>
          <select id="s-coach" class="admin-select"><option value="">選教練</option>${coachOpts}</select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px;">
          <div class="admin-form-group"><label>選手A</label>
            <select id="s-pa" class="admin-select"><option value="">選選手</option>${playerOpts}</select>
          </div>
          <div class="admin-form-group"><label>選手B</label>
            <select id="s-pb" class="admin-select"><option value="">選選手</option>${playerOpts}</select>
          </div>
        </div>

        <div class="admin-form-group"><label>備註</label>
          <input type="text" id="s-note" class="admin-input" value="${escapeHtml(s.remark||'')}" placeholder="選填">
        </div>

        <div style="display:flex; gap:10px;">
          <button type="submit" class="hero-btn" style="flex:1;">儲存</button>
          <button type="button" class="action-btn" style="background:#eee; padding:10px;" onclick="showAdminScheduleList()">取消</button>
        </div>
      </form>
    </div>
  `;

  // 設定選單初始值（以 ID 優先）
  if (s.coachId) document.getElementById('s-coach').value = s.coachId;
  if (s.playerAId) document.getElementById('s-pa').value = s.playerAId;
  if (s.playerBId) document.getElementById('s-pb').value = s.playerBId;

  document.getElementById('schedule-form').onsubmit = (e) => {
    e.preventDefault();

    const payload = {
      rowId: s.rowId || null,
      weekday: document.getElementById('s-day').value,
      slot: document.getElementById('s-slot').value,
      table: document.getElementById('s-table').value.trim(),
      coachId: document.getElementById('s-coach').value,
      playerAId: document.getElementById('s-pa').value,
      playerBId: document.getElementById('s-pb').value,
      note: document.getElementById('s-note').value.trim()
    };

    sendToGasWithAuth('save_schedule', payload).then(() => showAdminScheduleList());
  };
}

// --- D) 比賽紀錄管理：單/雙打切換 + 總分/局分 ---
function showAdminMatchList() {
  const content = document.getElementById('admin-content');
  content.innerHTML = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:2px solid #eee; padding-bottom:10px;">
      <h4 style="margin:0; color:var(--primary-color);">比賽紀錄</h4>
      <button class="hero-btn" id="btn-add-match" style="padding:5px 12px; font-size:0.9rem;"><i class="fas fa-plus"></i> 新增</button>
    </div>
    <div id="admin-match-list" class="leave-list-container"></div>
  `;

  const addBtn = document.getElementById('btn-add-match');
  if (addBtn) addBtn.onclick = () => renderAdminMatchForm();

  const listDiv = document.getElementById('admin-match-list');
  if (!listDiv) return;

  if (!matches || matches.length === 0) {
    listDiv.innerHTML = '<div style="text-align:center;">無紀錄</div>';
    return;
  }

  matches.forEach(m => {
    const card = document.createElement('div');
    card.className = 'leave-item';

    const pNames = (m.players || []).map(getPlayerName).join('、');
    const oNames = (m.opponents || []).map(getPlayerName).join('、');

    card.innerHTML = `
      <div class="leave-item-header">
        <div class="leave-item-name">${escapeHtml(pNames)} vs ${escapeHtml(oNames)}</div>
        <div class="leave-item-date">${escapeHtml(m.date || '')}</div>
      </div>
      <div class="leave-item-reason">
        <span class="match-type-badge">${m.type==='singles'?'單打':'雙打'}</span>
        總分: <b>${escapeHtml(m.score || '-')}</b> (局分: ${escapeHtml(m.sets || '-')} )
      </div>
      <div class="leave-item-actions">
        <button class="action-btn delete"><i class="fas fa-trash-alt"></i> 刪除</button>
      </div>
    `;

    const delBtn = card.querySelector('.delete');
    if (delBtn) delBtn.onclick = () => confirmDel('delete_match', m.rowId, '此紀錄');

    listDiv.appendChild(card);
  });
}

function toggleMatchType(type) {
  const teamA = document.getElementById('team-a');
  const teamB = document.getElementById('team-b');
  if (!teamA || !teamB) return;

  const playerOpts = players.map(p => `<option value="${escapeHtml(p.id || '')}">${escapeHtml(p.name || '')}</option>`).join('');
  const createSelect = (id) => `
    <select id="${id}" class="admin-select" style="margin-bottom:5px;">
      <option value="">選選手</option>
      ${playerOpts}
    </select>
  `;

  if (type === 'singles') {
    teamA.innerHTML = createSelect('m-p1');
    teamB.innerHTML = createSelect('m-o1');
  } else {
    teamA.innerHTML = createSelect('m-p1') + createSelect('m-p2');
    teamB.innerHTML = createSelect('m-o1') + createSelect('m-o2');
  }
}

function renderAdminMatchForm() {
  const content = document.getElementById('admin-content');
  const today = new Date().toISOString().split('T')[0];

  content.innerHTML = `
    <div class="admin-form-card">
      <h3 style="margin-top:0;">新增比賽紀錄</h3>
      <form id="match-form">
        <div class="admin-form-group">
          <label>日期</label>
          <input type="date" id="m-date" class="admin-input" required value="${today}">
        </div>

        <div class="admin-form-group">
          <label>賽制</label>
          <select id="m-type" class="admin-select">
            <option value="singles">單打</option>
            <option value="doubles">雙打</option>
          </select>
        </div>

        <div style="display:grid; grid-template-columns:1fr 0.2fr 1fr; gap:5px; align-items:center;">
          <div id="team-a"></div>
          <div style="text-align:center;">vs</div>
          <div id="team-b"></div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px;">
          <div class="admin-form-group">
            <label>總比分 (ex: 3:1)</label>
            <input type="text" id="m-score" class="admin-input" placeholder="3:1" required>
          </div>
          <div class="admin-form-group">
            <label>局分 (ex: 11-9, 8-11)</label>
            <input type="text" id="m-sets" class="admin-input" placeholder="各局比分">
          </div>
        </div>

        <div class="admin-form-group">
          <label>影片連結</label>
          <input type="text" id="m-video" class="admin-input" placeholder="YouTube/Google Drive...">
        </div>

        <div style="display:flex; gap:10px;">
          <button type="submit" class="hero-btn" style="flex:1;">儲存</button>
          <button type="button" class="action-btn" style="background:#eee; padding:10px;" onclick="showAdminMatchList()">取消</button>
        </div>
      </form>
    </div>
  `;

  // init selectors
  toggleMatchType('singles');
  const typeSel = document.getElementById('m-type');
  if (typeSel) typeSel.onchange = () => toggleMatchType(typeSel.value);

  document.getElementById('match-form').onsubmit = (e) => {
    e.preventDefault();

    const type = document.getElementById('m-type').value;

    const payload = {
      date: document.getElementById('m-date').value,
      type,
      p1: document.getElementById('m-p1')?.value || '',
      p2: type === 'doubles' ? (document.getElementById('m-p2')?.value || '') : '',
      o1: document.getElementById('m-o1')?.value || '',
      o2: type === 'doubles' ? (document.getElementById('m-o2')?.value || '') : '',
      score: document.getElementById('m-score').value.trim(),
      sets: document.getElementById('m-sets').value.trim(),
      video: document.getElementById('m-video').value.trim()
    };

    sendToGasWithAuth('save_match', payload).then(() => showAdminMatchList());
  };
}


// 讓 onclick 可以穩定找到（在某些環境例如 module/嚴格模式下更安全）
window.sendToGasWithAuth = sendToGasWithAuth;
window.showAdminSettings = showAdminSettings;

// 3. (選用) 管理員登入邏輯：請確認 renderAdmin 內 loginBtn.onclick 會呼叫後端 check_auth 驗證。
// （此段為提示註解，無需額外程式碼）


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
  // --- staff ---
  const staff = (rawData.staff || []).map(r => ({
    ...r,
    rowId: r.rowId,
    id: r.staff_id ?? r.id ?? r.staffId ?? '',
    name: r.name ?? r.staff_name ?? r.staffName ?? ''
  }));

  // --- players ---
  const players = (rawData.players || []).map(r => ({
    rowId: r.rowId,
    id: r.player_id ?? r.id ?? '',
    name: r.student_name ?? r.name ?? '',
    nickname: r.nickname || '',
    grade: r.grade || '',
    class: r.class || '',
    paddle: r.paddle || r.team_no || '',
    gender: r.gender || '',
    hand: r.hand || r.birthdate || '',
    style: r.play_style || r.notes || '',
    photo: convertDriveLink(r.photo_url ?? r.photo ?? ''), // 前端目前不顯示，但保留欄位相容
    isActive: String(r.is_active || 'TRUE').toUpperCase()
  }));

  // quick maps for resolving names
  const staffMap = new Map(staff.map(s => [String(s.id), s]));
  const playerMap = new Map(players.map(p => [String(p.id), p]));

  // --- schedules ---
  const scheduleData = (rawData.training_schedule || []).map(r => {
    const coachId = r.coach_id || '';
    const paId = r.player_a_id || '';
    const pbId = r.player_b_id || '';
    return {
      rowId: r.rowId,
      id: r.schedule_id ?? r.id ?? '',
      date: r.weekday || '',   // 週一~週日
      day: r.weekday || '',
      slot: r.slot || '',
      table: r.table_no || '',
      coachId,
      playerAId: paId,
      playerBId: pbId,
      coach: staffMap.get(String(coachId)) ? { id: coachId, name: staffMap.get(String(coachId)).name } : (coachId ? { id: coachId, name: coachId } : null),
      playerA: playerMap.get(String(paId)) ? { id: paId, name: playerMap.get(String(paId)).name } : (paId ? { id: paId, name: paId } : null),
      playerB: playerMap.get(String(pbId)) ? { id: pbId, name: playerMap.get(String(pbId)).name } : (pbId ? { id: pbId, name: pbId } : null),
      remark: r.note || ''
    };
  });

  // --- matches ---
  const matches = (rawData.matches || []).map(r => {
    const typeRaw = String(r.match_type || '').toLowerCase();
    const type = typeRaw.includes('double') || typeRaw.includes('雙') ? 'doubles' : 'singles';

    const p1 = r.player1_id || '';
    const p2 = r.player2_id || '';
    const o1 = r.opponent1 || '';
    const o2 = r.opponent2 || '';

    return {
      rowId: r.rowId,
      id: r.match_id ?? r.id ?? '',
      date: formatDate(r.match_date),
      type,
      players: [p1, p2].filter(Boolean),
      opponents: [o1, o2].filter(Boolean),
      score: r.game_score || '',
      sets: r.set_scores || '',
      video: { url: r.media_url || '' }
    };
  });

  return {
    hero: rawData.hero || {},
    announcements: rawData.announcements || [],
    players,
    schedules: scheduleData,
    staff,
    matches,
    leaveRequests: rawData.leave_requests || rawData.leaveRequests || []
  };
}

