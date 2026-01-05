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
  // init empty schedule
  initEmptySchedule();
  // 讀取各分頁
  const [cfg, ann, ply, par, pchild, stf, acc, sched, leave, mtc] = await Promise.all([
    fetchSheetData('config'),
    fetchSheetData('announcements'),
    fetchSheetData('players'),
    fetchSheetData('parents'),
    fetchSheetData('parent_child'),
    fetchSheetData('staff'),
    fetchSheetData('accounts'),
    fetchSheetData('training_schedule'),
    fetchSheetData('leave_requests'),
    fetchSheetData('matches')
  ]);
  if (ann.length) {
    announcements = ann.map(row => ({
      id: row.id || row.ID || row.Id || row.序號 || row.sn,
      date: row.date || row.日期 || '',
      title: row.title || row.標題 || '',
      content: row.content || row.內容 || '',
      images: row.images ? row.images.split(';').filter(x => x) : [],
      link: row.link || row.連結 || ''
    }));
  } else {
    // fallback 與原假資料
    announcements = [
      { id: 1, date: '2025-12-25', title: '跨年聯誼賽公告', content: '本週末將舉辦跨年聯誼賽，歡迎大家踴躍參與！', images: [], link: '' },
      { id: 2, date: '2025-11-01', title: '教練人事異動', content: '自本月起，由李教練接任總教練。', images: [], link: '' },
      { id: 3, date: '2025-10-15', title: '會刊第十期發佈', content: '最新一期會刊已上線，請至後援會專區下載。', images: [], link: '' }
    ];
  }
  if (ply.length) {
    players = ply.map(row => ({
      id: row.id || row.ID || row.PlayerID || row.學生編號 || '',
      name: row.name || row.姓名 || '',
      class: row.class || row.班級 || '',
      number: row.number || row.隊號 || row.背號 || ''
    }));
  } else {
    players = [
      { id: 'P01', name: '張三', class: '五年甲班', number: '1' },
      { id: 'P02', name: '李四', class: '五年乙班', number: '2' },
      { id: 'P03', name: '王五', class: '四年甲班', number: '3' },
      { id: 'P04', name: '趙六', class: '四年乙班', number: '4' },
      { id: 'P05', name: '陳七', class: '六年甲班', number: '5' },
      { id: 'P06', name: '林八', class: '六年乙班', number: '6' }
    ];
  }
  if (stf.length) {
    staff = stf.map(row => ({
      id: row.id || row.ID || row.coach_id || row.教練編號 || '',
      name: row.name || row.姓名 || row.coach_name || '',
      rate: parseInt(row.rate || row.鐘點費 || 0)
    }));
  } else {
    staff = [ { id: 'C01', name: '李教練', rate: 500 }, { id: 'C02', name: '張教練', rate: 500 } ];
  }
  if (mtc.length) {
    matches = mtc.map(row => {
      // players/opponents may be separated by ',' or '/'
      const p = (row.players || row.球員 || '').split(/[\/;,\s]+/).filter(x => x);
      const opp = (row.opponents || row.對手 || '').split(/[\/;,\s]+/).filter(x => x);
      const details = (row.details || row.局分 || '').split(/[;\s]+/).filter(x => x);
      return {
        id: row.id || row.ID || row.序號 || '',
        type: row.type || row.類型 || 'singles',
        date: row.date || row.日期 || '',
        players: p,
        opponents: opp,
        score: row.score || row.比分 || '',
        details: details,
        note: row.note || row.備註 || '',
        video: {
          provider: row.provider || row.平台 || '',
          url: row.url || row.連結 || ''
        }
      };
    });
  } else {
    matches = [
      {
        id: 1,
        type: 'singles',
        date: '2025-12-01',
        players: ['P01'],
        opponents: ['P02'],
        score: '3-1',
        details: ['11-7', '9-11', '11-9', '11-6'],
        note: '表現穩定',
        video: { provider: 'yt', url: 'https://www.youtube.com/watch?v=ScMzIvxBSi4' }
      },
      {
        id: 2,
        type: 'doubles',
        date: '2025-12-05',
        players: ['P01','P03'],
        opponents: ['P02','P04'],
        score: '2-3',
        details: ['11-9', '7-11', '9-11', '11-8', '8-11'],
        note: '需加強默契',
        video: { provider: 'fb', url: 'https://www.facebook.com/watch/?v=123456' }
      },
      {
        id: 3,
        type: 'singles',
        date: '2025-11-20',
        players: ['P04'],
        opponents: ['P05'],
        score: '0-3',
        details: ['8-11', '7-11', '9-11'],
        note: '加油',
        video: { provider: '', url: '' }
      }
    ];
  }
  // parents & parent_child & accounts & leave_requests
  parents = par;
  parentChild = pchild;
  accounts = acc;
  leaveRequestsData = leave;
  // training schedule: build schedule structure
  if (sched.length) {
    // reset schedule
    initEmptySchedule();
    sched.forEach(row => {
      const day = row.weekday || row.day || row.星期 || '';
      const slot = row.slot || row.time || row.時段 || '';
      const tableNo = row.table_no || row.table || row.桌號 || row.桌次 || '';
      if (!day || !slot || !tableNo) return;
      if (!schedule[day]) schedule[day] = {};
      if (!schedule[day][slot]) schedule[day][slot] = [];
      const coachId = row.coach_id || row.coach || row.教練 || '';
      const playerAId = row.player_a_id || row.playerA || row.學生A || '';
      const playerBId = row.player_b_id || row.playerB || row.學生B || '';
      schedule[day][slot].push({
        table: parseInt(tableNo),
        coach: staff.find(c => c.id === coachId) || { id: coachId, name: coachId },
        playerA: players.find(p => p.id === playerAId) || { id: playerAId, name: playerAId },
        playerB: players.find(p => p.id === playerBId) || { id: playerBId, name: playerBId },
        note: row.note || row.備註 || ''
      });
    });
  } else {
    // fallback：使用示範排程
    populateSampleSchedule();
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
function showAnnouncementDetail(item) {
  const modal = document.getElementById('announcement-detail');
  if (!modal) return;

  const linkHtml = item.link
    ? `<div style="margin-top:12px;"><a href="${escapeAttr(item.link)}" target="_blank" rel="noopener" style="color:var(--primary-color); font-weight:700;">相關連結</a></div>`
    : '';

  modal.innerHTML = `
    <div class="modal-header">
      <h3>${escapeHtml(item.title || '')}</h3>
      <button class="modal-close-button" type="button" onclick="hideModal()">&times;</button>
    </div>
    <div style="color:#666; font-size:0.9rem; margin-bottom:12px;">${escapeHtml(item.date || '')}</div>
    <div style="line-height:1.7; color:#444;">${escapeHtml(String(item.content || '')).replace(/\n/g, '<br>')}</div>
    ${linkHtml}
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
    form.onsubmit = (e) => {
      e.preventDefault();
      const name = (document.getElementById('leave-name')?.value || '').trim();
      const date = document.getElementById('leave-date')?.value || '';
      const slot = document.getElementById('leave-slot')?.value || '';
      const reason = (document.getElementById('leave-reason')?.value || '').trim();

      if (!name || !date || !slot) return;

      const list = loadLeaveRequests();
      const id = Date.now().toString();
      list.push({ id, name, date, slot, reason });
      saveLeaveRequests(list);

      renderLeaveList();
      showToast('請假已送出');
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

function renderMatches() {
  const listDiv = document.getElementById('match-list');
  if (!listDiv) return;
  listDiv.innerHTML = '';

  if (!matches || matches.length === 0) {
    listDiv.innerHTML = `<div class="card" style="text-align:center; color:#888;">尚無比賽紀錄</div>`;
    return;
  }

  const sorted = matches.slice().sort((a, b) => new Date(b.date) - new Date(a.date));

  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';

    const playerNames = (item.players || []).map(id => getPlayerName(id)).join('、');
    const opponentNames = (item.opponents || []).map(id => getPlayerName(id) || id).join('、');
    const typeLabel = item.type === 'doubles' ? '雙打' : '單打';

    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:10px;">
        <h4 style="margin:0;">${typeLabel}</h4>
        <span style="font-size:0.85rem; color:#888; white-space:nowrap;">${escapeHtml(item.date || '')}</span>
      </div>
      <p style="margin:6px 0 0; color:#555;">對戰：${escapeHtml(playerNames)} vs ${escapeHtml(opponentNames)}</p>
      <p style="margin:6px 0 0; color:#666;">比分：${escapeHtml(item.score || '')}</p>
    `;
    card.addEventListener('click', () => showMatchDetail(item));
    listDiv.appendChild(card);
  });
}

function showMatchDetail(item) {
  const panel = document.getElementById('player-analysis');
  if (!panel) return;

  panel.innerHTML = '';

  const typeLabel = item.type === 'doubles' ? '雙打' : '單打';
  const playerNames = (item.players || []).map(id => getPlayerName(id)).join('、');
  const opponentNames = (item.opponents || []).map(id => getPlayerName(id) || id).join('、');

  const headerBar = document.createElement('div');
  headerBar.className = 'modal-header';
  headerBar.innerHTML = `
    <h3 style="margin:0;">${typeLabel}紀錄</h3>
    <button class="btn-close-modal" type="button">關閉</button>
  `;
  panel.appendChild(headerBar);

  const info = document.createElement('p');
  info.innerHTML = `
    日期：${escapeHtml(item.date || '')}<br>
    對戰：${escapeHtml(playerNames)} vs ${escapeHtml(opponentNames)}<br>
    比分：${escapeHtml(item.score || '')}<br>
    備註：${escapeHtml(item.note || '')}
  `;
  panel.appendChild(info);

  if (item.details && item.details.length > 0) {
    const table = document.createElement('table');
    table.innerHTML = `
      <thead><tr><th>局數</th><th>比分</th></tr></thead>
      <tbody>
        ${item.details.map((score, idx) => `<tr><td>${idx + 1}</td><td>${escapeHtml(score)}</td></tr>`).join('')}
      </tbody>
    `;
    panel.appendChild(table);
  }

  // 影片
  if (item.video && item.video.url) {
    const vidDiv = document.createElement('div');
    vidDiv.className = 'video-container';

    if (item.video.provider === 'yt') {
      const iframe = document.createElement('iframe');
      iframe.src = item.video.url.replace('watch?v=', 'embed/');
      iframe.width = '100%';
      iframe.height = '315';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      vidDiv.appendChild(iframe);
    } else {
      const link = document.createElement('a');
      link.href = item.video.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '觀看影片';
      vidDiv.appendChild(link);
    }
    panel.appendChild(vidDiv);
  }

  panel.classList.remove('hidden');

  // close handler
  panel.querySelector('.btn-close-modal')?.addEventListener('click', () => {
    panel.classList.add('hidden');
  });

  try { panel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
}

// 11) 影音區（沿用原概念：從 matches 收集影片）
function renderMedia() {
  const mediaList = document.getElementById('media-list');
  if (!mediaList) return;
  mediaList.innerHTML = '';

  const videos = (matches || []).filter(m => m.video && m.video.url);
  if (videos.length === 0) {
    mediaList.innerHTML = `<div class="card" style="text-align:center; color:#888;">尚無影音紀錄</div>`;
    return;
  }

  videos.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    const pName = (item.players || []).map(id => getPlayerName(id)).join('、');
    card.innerHTML = `<h4 style="margin:0 0 6px;">比賽影片</h4><p style="margin:0 0 10px; color:#666;">${escapeHtml(pName)} - ${escapeHtml(item.date || '')}</p>`;

    if (item.video.provider === 'yt') {
      const iframe = document.createElement('iframe');
      iframe.src = item.video.url.replace('watch?v=', 'embed/');
      iframe.width = '100%';
      iframe.height = '200';
      iframe.allow = 'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture';
      iframe.allowFullscreen = true;
      card.appendChild(iframe);
    } else {
      const link = document.createElement('a');
      link.href = item.video.url;
      link.target = '_blank';
      link.rel = 'noopener';
      link.textContent = '前往觀看';
      card.appendChild(link);
    }

    mediaList.appendChild(card);
  });
}

// 12) 管理模式（加上 null guard，避免按鈕不存在報錯）
let adminLoggedIn = false;
const adminPassword = 'kfet2026';

// 預設登入（維持你原本的行為）
adminLoggedIn = true;

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

function showAdminAddAnnouncement() {
  const contentDiv = document.getElementById('admin-content');
  if (!contentDiv) return;
  contentDiv.innerHTML = '';

  const form = document.createElement('form');
  form.innerHTML = `
    <h4>新增公告</h4>
    <label style="display:block; margin:10px 0;">日期：<input type="date" id="new-ann-date" required style="width:100%; padding:8px;"></label>
    <label style="display:block; margin:10px 0;">標題：<input type="text" id="new-ann-title" required style="width:100%; padding:8px;"></label>
    <label style="display:block; margin:10px 0;">內容：<textarea id="new-ann-content" required style="width:100%; padding:8px; min-height:120px;"></textarea></label>
    <label style="display:block; margin:10px 0;">相關連結：<input type="text" id="new-ann-link" style="width:100%; padding:8px;"></label>
    <button type="submit" class="hero-btn" style="width:100%;">新增</button>
  `;

  form.onsubmit = (e) => {
    e.preventDefault();
    const date = document.getElementById('new-ann-date')?.value || '';
    const title = (document.getElementById('new-ann-title')?.value || '').trim();
    const content = (document.getElementById('new-ann-content')?.value || '').trim();
    const link = (document.getElementById('new-ann-link')?.value || '').trim();
    if (!date || !title || !content) return;

    const id = announcements.length ? (Math.max(...announcements.map(a => Number(a.id) || 0)) + 1) : 1;
    announcements.push({ id, date, title, content, images: [], link });

    showToast('公告已新增');
    navigateTo('announcements');
  };

  contentDiv.appendChild(form);
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
