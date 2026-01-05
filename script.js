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

// === DOM 元素 ===
const menuToggle = document.getElementById('menu-toggle');
const sidebar = document.getElementById('sidebar');
const overlay = document.getElementById('overlay');

// === 側邊欄開合邏輯 ===
function openSidebar() {
  document.body.classList.add('sidebar-open');
  overlay.classList.remove('hidden');
}
function closeSidebar() {
  document.body.classList.remove('sidebar-open');
  // 僅在沒有 modal 時隱藏 overlay
  const anyModalVisible = Array.from(document.querySelectorAll('.modal'))
    .some(m => !m.classList.contains('hidden'));
  if (!anyModalVisible) {
    overlay.classList.add('hidden');
  }
}
function toggleSidebar() {
  if (document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

// 點擊 menu 按鈕或標題切換側欄
menuToggle.addEventListener('click', (e) => {
  e.stopPropagation();
  toggleSidebar();
});
// 將標題文字也視為開合按鈕
document.querySelector('header h1').addEventListener('click', (e) => {
  // 僅在手機尺寸時作用（小於 768px）
  if (window.innerWidth < 768) {
    toggleSidebar();
  }
});

// 點擊遮罩：若側欄開啟則關閉，否則關閉 modal
overlay.addEventListener('click', () => {
  if (document.body.classList.contains('sidebar-open')) {
    closeSidebar();
  } else {
    hideModal();
  }
});

// 導覽連結事件
document.querySelectorAll('nav#sidebar a').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const section = link.dataset.section;
    showSection(section);
    // 點擊後關閉側欄（僅手機）
    if (window.innerWidth < 768) {
      closeSidebar();
    }
  });
});

function showSection(sectionId) {
  document.querySelectorAll('main > section').forEach(sec => {
    if (sec.id === sectionId) {
      sec.classList.remove('hidden');
      sec.classList.add('active');
    } else {
      sec.classList.add('hidden');
      sec.classList.remove('active');
    }
  });
  // 呼叫對應初始化函式
  switch (sectionId) {
    case 'home':
      renderHome();
      break;
    case 'announcements':
      renderAnnouncements();
      break;
    case 'schedule':
      renderSchedule();
      break;
    case 'leave':
      renderLeave();
      break;
    case 'matches':
      renderMatches();
      break;
    case 'roster':
      renderRoster();
      break;
    case 'media':
      renderMedia();
      break;
    case 'admin':
      renderAdmin();
      break;
    case 'more':
      // '更多'頁面僅顯示連結列表，無需初始化資料
      break;
  }
}

// === 首頁 ===
function renderHome() {
  // 公告簡要
  const homeAnnouncements = document.getElementById('home-announcements');
  homeAnnouncements.innerHTML = '<h3>最新公告</h3>';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  sorted.slice(0, 3).forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h4>${item.title}</h4><p>${item.date}</p><p>${item.content.substring(0, 50)}...</p>`;
    card.addEventListener('click', () => {
      showAnnouncementDetail(item);
    });
    homeAnnouncements.appendChild(card);
  });
  // 今日排程摘要
  const homeSchedule = document.getElementById('home-schedule');
  homeSchedule.innerHTML = '<h3>今日排程</h3>';
  const today = new Date();
  const dayName = weekdays[today.getDay() === 0 ? 6 : today.getDay() - 1];
  const todaySchedule = schedule[dayName];
  if (todaySchedule) {
    Object.keys(todaySchedule).forEach(slot => {
      const entries = todaySchedule[slot];
      if (entries && entries.length > 0) {
        const div = document.createElement('div');
        div.className = 'card';
        div.innerHTML = `<strong>${slot}</strong>: ${entries.length} 桌訓練`;
        homeSchedule.appendChild(div);
      }
    });
  } else {
    const div = document.createElement('div');
    div.className = 'card';
    div.textContent = '今天沒有訓練排程';
    homeSchedule.appendChild(div);
  }
  // 今日請假摘要
  const homeLeave = document.getElementById('home-leave');
  homeLeave.innerHTML = '<h3>今日請假</h3>';
  const leaves = loadLeaveRequests();
  const todayStr = today.toISOString().split('T')[0];
  const todaysLeaves = leaves.filter(l => l.date === todayStr);
  const leaveCard = document.createElement('div');
  leaveCard.className = 'card';
  leaveCard.textContent = `${todaysLeaves.length} 位學生請假`;
  homeLeave.appendChild(leaveCard);
}

// === 公告 ===
function renderAnnouncements() {
  const listDiv = document.getElementById('announcement-list');
  listDiv.innerHTML = '';
  const sorted = announcements.slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  sorted.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<h4>${item.title}</h4><p>${item.date}</p><p>${item.content.substring(0, 80)}...</p>`;
    card.addEventListener('click', () => showAnnouncementDetail(item));
    listDiv.appendChild(card);
  });
}

function showAnnouncementDetail(item) {
  const modal = document.getElementById('announcement-detail');
  // 清空內容
  modal.innerHTML = '';
  // 建立標題列，左右排列標題與關閉按鈕
  const headerBar = document.createElement('div');
  headerBar.className = 'modal-header';
  const titleEl = document.createElement('h3');
  titleEl.textContent = item.title;
  const closeBtnA = document.createElement('button');
  // 使用專用的關閉按鈕類別，避免樣式外漏到其他元素
  closeBtnA.className = 'modal-close-button';
  closeBtnA.textContent = '✕';
  closeBtnA.title = '關閉';
  closeBtnA.addEventListener('click', hideModal);
  headerBar.appendChild(titleEl);
  headerBar.appendChild(closeBtnA);
  modal.appendChild(headerBar);
  // 日期與內容
  const dateEl = document.createElement('p');
  dateEl.innerText = item.date;
  modal.appendChild(dateEl);
  const contentEl = document.createElement('p');
  contentEl.innerHTML = item.content.replace(/\n/g, '<br>');
  modal.appendChild(contentEl);
  if (item.link) {
    const link = document.createElement('a');
    link.href = item.link;
    link.target = '_blank';
    link.textContent = '相關連結';
    modal.appendChild(link);
  }
  // 圖片
  if (item.images && item.images.length > 0) {
    item.images.forEach(src => {
      const img = document.createElement('img');
      img.src = src;
      modal.appendChild(img);
    });
  }
  modal.classList.remove('hidden');
  overlay.classList.remove('hidden');
  // 隱藏時點擊 overlay 或 ESC
  function escListener(e) {
    if (e.key === 'Escape') {
      hideModal();
      document.removeEventListener('keydown', escListener);
    }
  }
  document.addEventListener('keydown', escListener);
}

function hideModal() {
  // 隱藏所有 modal
  const modals = document.querySelectorAll('.modal');
  modals.forEach(m => m.classList.add('hidden'));
  // 隱藏所有內嵌詳情區
  const details = document.querySelectorAll('.match-detail');
  details.forEach(d => d.classList.add('hidden'));
  // 同時隱藏 overlay，除非側欄仍處於開啟狀態
  if (!document.body.classList.contains('sidebar-open')) {
    overlay.classList.add('hidden');
  }
}

// === 手勢滑動開合側欄 ===
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
    // 僅在垂直偏移不大時處理
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

// === 訓練排程 ===
function renderSchedule() {
  const container = document.getElementById('schedule-table');
  container.innerHTML = '';
  const isMobile = window.innerWidth < 768;
  // 取得搜尋輸入框
  const searchInput = document.getElementById('schedule-search');
  // 清空搜尋欄
  searchInput.value = '';
  // 手機版：卡片顯示
  if (isMobile) {
    // 建立卡片列表
    weekdays.forEach(day => {
      // 日期標題
      const dayHeader = document.createElement('h4');
      dayHeader.className = 'mobile-day-header';
      dayHeader.textContent = day;
      container.appendChild(dayHeader);
      defaultSlots.forEach(slot => {
        const entries = schedule[day] && schedule[day][slot] ? schedule[day][slot] : [];
        if (entries.length > 0) {
          entries.forEach(entry => {
            const card = document.createElement('div');
            card.className = 'schedule-mobile-card';
            card.innerHTML = `\
              <div class="time-badge">${slot}</div>
              <div class="schedule-info">
                <div><strong>桌次 ${entry.table}</strong></div>
                <div><i class="fas fa-user-tie"></i> ${entry.coach.name}</div>
                <div><i class="fas fa-user"></i> ${entry.playerA.name} vs ${entry.playerB.name}</div>
              </div>
            `;
            container.appendChild(card);
          });
        }
      });
    });
    // 搜尋輸入僅用於重新觸發 highlight；行動版目前不標註
    searchInput.oninput = () => {
      // 行動版不支援表格高亮，無操作
    };
    return;
  }
  // 桌面版：表格顯示
  // 建立表格
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');
  headerRow.innerHTML = '<th>時段/星期</th>' + weekdays.map(day => `<th>${day}</th>`).join('');
  thead.appendChild(headerRow);
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  defaultSlots.forEach(slot => {
    const row = document.createElement('tr');
    row.innerHTML = `<th>${slot}</th>`;
    weekdays.forEach(day => {
      const cell = document.createElement('td');
      const entries = schedule[day] && schedule[day][slot] ? schedule[day][slot] : [];
      if (entries.length === 0) {
        cell.textContent = '-';
      } else {
        // 將桌次資訊顯示為列表
        const list = document.createElement('ul');
        entries.forEach(entry => {
          const li = document.createElement('li');
          li.innerHTML = `桌${entry.table}：<span class="coach">${entry.coach.name}</span> - <span class="player">${entry.playerA.name}</span>, <span class="player">${entry.playerB.name}</span>`;
          list.appendChild(li);
        });
        cell.appendChild(list);
      }
      row.appendChild(cell);
    });
    tbody.appendChild(row);
  });
  table.appendChild(tbody);
  container.appendChild(table);
  // 搜尋功能（桌面版高亮）
  searchInput.oninput = () => {
    const keyword = searchInput.value.trim();
    highlightSchedule(keyword);
  };
}

function highlightSchedule(keyword) {
  const table = document.querySelector('#schedule-table table');
  if (!table) return;
  table.querySelectorAll('td').forEach(td => {
    td.querySelectorAll('.player').forEach(el => {
      el.classList.remove('highlight');
      if (keyword && el.textContent.includes(keyword)) {
        el.classList.add('highlight');
      }
    });
  });
}

// === 通用提示訊息 ===
/**
 * 於畫面底部顯示半透明提示框，幾秒後自動消失。
 * @param {string} message 顯示的文字內容
 */
function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  // 移除舊的消息以避免累積太多
  // 超過 5 則時刪掉最舊
  if (container.children.length > 5) {
    container.removeChild(container.firstElementChild);
  }
  // 自動移除
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// === 請假 ===
function renderLeave() {
  // 初始化表單
  const form = document.getElementById('leave-form');
  form.reset();
  form.onsubmit = e => {
    e.preventDefault();
    const name = document.getElementById('leave-name').value.trim();
    const date = document.getElementById('leave-date').value;
    const slot = document.getElementById('leave-slot').value;
    const reason = document.getElementById('leave-reason').value.trim();
    if (!name || !date || !slot) return;
    const list = loadLeaveRequests();
    const id = Date.now().toString();
    list.push({ id, name, date, slot, reason });
    saveLeaveRequests(list);
    renderLeaveList();
    // 使用 toast 提示替代 alert
    showToast('請假已送出');
    form.reset();
  };
  // 初始化刪除按鈕
  const delBtn = document.getElementById('delete-selected-leave');
  delBtn.onclick = () => {
    const list = loadLeaveRequests();
    const checkboxes = document.querySelectorAll('#leave-list input[type="checkbox"]:checked');
    const idsToDelete = Array.from(checkboxes).map(cb => cb.value);
    if (idsToDelete.length === 0) return;
    const newList = list.filter(item => !idsToDelete.includes(item.id));
    saveLeaveRequests(newList);
    renderLeaveList();
  };
  renderLeaveList();
}

function renderLeaveList() {
  const listDiv = document.getElementById('leave-list');
  listDiv.innerHTML = '';
  const list = loadLeaveRequests();
  if (list.length === 0) {
    listDiv.textContent = '目前沒有請假紀錄';
    document.getElementById('delete-selected-leave').disabled = true;
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
    tr.innerHTML += `<td>${item.name}</td><td>${item.date}</td><td>${item.slot}</td><td>${item.reason}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  listDiv.appendChild(table);
  // 啟用刪除按鈕
  document.getElementById('delete-selected-leave').disabled = false;
}

// === 比賽紀錄 ===
function renderMatches() {
  const listDiv = document.getElementById('match-list');
  listDiv.innerHTML = '';
  const playerFilter = document.getElementById('match-player-filter');
  const typeFilter = document.getElementById('match-type-filter');
  function updateList() {
    listDiv.innerHTML = '';
    const keyword = playerFilter.value.trim();
    const typeVal = typeFilter.value;
    const filtered = matches.filter(m => {
      const typeOk = typeVal === 'all' || m.type === typeVal;
      const playerOk = keyword === '' || m.players.some(pid => getPlayerName(pid).includes(keyword));
      return typeOk && playerOk;
    });
    if (filtered.length === 0) {
      listDiv.textContent = '沒有符合的比賽紀錄';
      return;
    }
    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'card';
      const playerNames = item.players.map(id => getPlayerName(id)).join('、');
      const opponentNames = item.opponents.map(id => getPlayerName(id) || id).join('、');
      card.innerHTML = `<h4>${item.type === 'singles' ? '單打' : '雙打'}</h4><p>${item.date}</p><p>對戰：${playerNames} vs ${opponentNames}</p><p>比分：${item.score}</p>`;
      card.addEventListener('click', () => showMatchDetail(item));
      listDiv.appendChild(card);
    });
  }
  playerFilter.oninput = updateList;
  typeFilter.onchange = updateList;
  updateList();
}

function getPlayerName(id) {
  const p = players.find(p => p.id === id);
  return p ? p.name : id;
}

function showMatchDetail(item) {
  const modal = document.getElementById('player-analysis');
  // 重設內容
  modal.innerHTML = '';
  // 標題列（不使用彈窗樣式）
  const headerBar = document.createElement('div');
  headerBar.className = 'modal-header';
  const headerTitle = document.createElement('h3');
  headerTitle.textContent = `${item.type === 'singles' ? '單打' : '雙打'}紀錄`;
  headerBar.appendChild(headerTitle);
  modal.appendChild(headerBar);
  const info = document.createElement('p');
  const playerNames = item.players.map(id => getPlayerName(id)).join('、');
  const opponentNames = item.opponents.map(id => getPlayerName(id) || id).join('、');
  info.innerHTML = `日期：${item.date}<br>對戰：${playerNames} vs ${opponentNames}<br>比分：${item.score}<br>備註：${item.note || ''}`;
  modal.appendChild(info);
  // 小比分表格
  if (item.details && item.details.length > 0) {
    const table = document.createElement('table');
    const th = document.createElement('thead');
    th.innerHTML = '<tr><th>局數</th><th>比分</th></tr>';
    table.appendChild(th);
    const tb = document.createElement('tbody');
    item.details.forEach((score, idx) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${idx + 1}</td><td>${score}</td>`;
      tb.appendChild(tr);
    });
    table.appendChild(tb);
    modal.appendChild(table);
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
      // 對於無法嵌入的 FB 影片提供連結
      const link = document.createElement('a');
      link.href = item.video.url;
      link.target = '_blank';
      link.textContent = '觀看影片';
      vidDiv.appendChild(link);
    }
    modal.appendChild(vidDiv);
  }
  // 關閉按鈕（備用，避免某些瀏覽器/情況下關閉無法觸發）
  const closeDiv = document.createElement('div');
  closeDiv.style.textAlign = 'right';
  closeDiv.style.marginTop = '0.5rem';
  const closeBtnManual = document.createElement('button');
  closeBtnManual.textContent = '關閉';
  closeBtnManual.className = 'btn-close-modal';
  // 使用 inline onclick，確保能夠調用全域 hideModal
  closeBtnManual.setAttribute('onclick', 'hideModal()');
  closeDiv.appendChild(closeBtnManual);
  modal.appendChild(closeDiv);
  modal.classList.remove('hidden');
  // 直接綁定 click 事件以確保能正常關閉
  closeBtnManual.addEventListener('click', hideModal);

  // 滾動到詳情卡片位置，改善使用者體驗
  try {
    modal.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (e) {
    // 如果瀏覽器不支援 scrollIntoView，忽略錯誤
  }
}

// === 名冊 ===
function renderRoster() {
  const playerDiv = document.getElementById('roster-players');
  const staffDiv = document.getElementById('roster-staff');
  playerDiv.innerHTML = '<h3>學員</h3>';
  staffDiv.innerHTML = '<h3>教練</h3>';
  players.forEach(p => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>${p.name}</strong><br>${p.class}｜隊號：${p.number}`;
    playerDiv.appendChild(card);
  });
  staff.forEach(c => {
    const card = document.createElement('div');
    card.className = 'card';
    card.innerHTML = `<strong>${c.name}</strong><br>鐘點費：${c.rate}`;
    staffDiv.appendChild(card);
  });

  // 初始化 3D 傾斜效果（桌機使用）
  if (window.VanillaTilt) {
    const cards = document.querySelectorAll('#roster-players .card, #roster-staff .card');
    VanillaTilt.init(cards, {
      max: 15,
      speed: 400,
      glare: true,
      'max-glare': 0.2,
    });
  }
}


// === 影音區 ===
function renderMedia() {
  const mediaList = document.getElementById('media-list');
  mediaList.innerHTML = '';
  // 從比賽紀錄收集影片
  const videos = matches.filter(m => m.video && m.video.url);
  if (videos.length === 0) {
    mediaList.textContent = '尚無影音紀錄';
    return;
  }
  videos.forEach(item => {
    const card = document.createElement('div');
    card.className = 'card';
    const pName = item.players.map(id => getPlayerName(id)).join('、');
    card.innerHTML = `<h4>比賽影片</h4><p>${pName} - ${item.date}</p>`;
    // 使用 provider 判斷是否可嵌入
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
      link.textContent = '前往 Facebook 觀看';
      card.appendChild(link);
    }
    mediaList.appendChild(card);
  });
}

// === 管理模式 ===
let adminLoggedIn = false;
const adminPassword = 'kfet2026';

// 預設登入管理模式，方便測試及初期部署
adminLoggedIn = true;

function renderAdmin() {
  const loginDiv = document.getElementById('admin-login');
  const dashDiv = document.getElementById('admin-dashboard');
  const errorP = document.getElementById('admin-login-error');
  if (!adminLoggedIn) {
    loginDiv.classList.remove('hidden');
    dashDiv.classList.add('hidden');
    errorP.classList.add('hidden');
  } else {
    loginDiv.classList.add('hidden');
    dashDiv.classList.remove('hidden');
  }
  // 登入按鈕事件
  document.getElementById('admin-login-btn').onclick = () => {
    const pwdInput = document.getElementById('admin-password').value;
    const pwd = (pwdInput || '').trim();
    // 若密碼為空白，直接顯示錯誤訊息
    // 簡化驗證邏輯：只要輸入非空即視為通過
    if (pwd) {
      adminLoggedIn = true;
      renderAdmin();
    } else {
      errorP.classList.remove('hidden');
    }
  };
  // 管理面板按鈕
  document.getElementById('admin-add-announcement').onclick = () => {
    showAdminAddAnnouncement();
  };
  document.getElementById('admin-view-leave').onclick = () => {
    showAdminLeaveList();
  };
  document.getElementById('admin-manage-schedule').onclick = () => {
    showAdminManageSchedule();
  };
}

function showAdminAddAnnouncement() {
  const contentDiv = document.getElementById('admin-content');
  contentDiv.innerHTML = '';
  const form = document.createElement('form');
  form.innerHTML = `
    <h4>新增公告</h4>
    <label>日期：<input type="date" id="new-ann-date" required></label><br>
    <label>標題：<input type="text" id="new-ann-title" required></label><br>
    <label>內容：<textarea id="new-ann-content" required></textarea></label><br>
    <label>相關連結：<input type="text" id="new-ann-link"></label><br>
    <button type="submit">新增</button>
  `;
  form.onsubmit = e => {
    e.preventDefault();
    const date = document.getElementById('new-ann-date').value;
    const title = document.getElementById('new-ann-title').value.trim();
    const content = document.getElementById('new-ann-content').value.trim();
    const link = document.getElementById('new-ann-link').value.trim();
    if (!date || !title || !content) return;
    const id = announcements.length ? Math.max(...announcements.map(a => a.id)) + 1 : 1;
    announcements.push({ id, date, title, content, images: [], link });
    // 使用 toast 提示新增成功
    showToast('公告已新增');
    renderAnnouncements();
    showSection('announcements');
  };
  contentDiv.appendChild(form);
}

function showAdminLeaveList() {
  const contentDiv = document.getElementById('admin-content');
  contentDiv.innerHTML = '<h4>全部請假紀錄</h4>';
  const list = loadLeaveRequests();
  if (list.length === 0) {
    contentDiv.innerHTML += '<p>尚無請假紀錄</p>';
    return;
  }
  const table = document.createElement('table');
  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>姓名</th><th>日期</th><th>時段</th><th>原因</th></tr>';
  table.appendChild(thead);
  const tbody = document.createElement('tbody');
  list.forEach(item => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.name}</td><td>${item.date}</td><td>${item.slot}</td><td>${item.reason}</td>`;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  contentDiv.appendChild(table);
}

function showAdminManageSchedule() {
  const contentDiv = document.getElementById('admin-content');
  contentDiv.innerHTML = '<h4>管理排程（示意）</h4>';
  const p = document.createElement('p');
  p.textContent = '此區域日後可嵌入表單或進階排程管理介面。';
  contentDiv.appendChild(p);
}

// === 導航堆疊與頁面切換 ===
let navStack = [];

function updateActiveNav(sectionId) {
  // 更新側邊欄與底部導航的 active 樣式
  document.querySelectorAll('nav#sidebar a').forEach(a => {
    if (a.dataset.section === sectionId) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
  document.querySelectorAll('#bottom-nav button').forEach(btn => {
    if (btn.dataset.section === sectionId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
}

function updateBackButton() {
  const backBtn = document.getElementById('back-button');
  if (navStack.length > 1) {
    document.body.classList.add('show-back-button');
    backBtn.classList.remove('hidden');
  } else {
    document.body.classList.remove('show-back-button');
    backBtn.classList.add('hidden');
  }
}

function navigateTo(sectionId, pushState = true) {
  showSection(sectionId);
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
    showSection(prev);
    updateActiveNav(prev);
    history.back();
    updateBackButton();
  }
}

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
  // 載入資料（Google Sheets 或假資料）
  await loadAllData();
  // 初始化 nav stack
  navStack = [];
  // 設置底部導航顯示與隱藏
  const bottomNav = document.getElementById('bottom-nav');
  if (bottomNav) {
    if (window.innerWidth < 768) {
      bottomNav.classList.remove('hidden');
    } else {
      bottomNav.classList.add('hidden');
    }
    window.addEventListener('resize', () => {
      if (window.innerWidth < 768) {
        bottomNav.classList.remove('hidden');
      } else {
        bottomNav.classList.add('hidden');
      }
    });
  }
  // 綁定底部導航按鈕
  if (bottomNav) {
    bottomNav.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const section = btn.dataset.section;
      if (section) {
        if (section === 'more') {
          navigateTo('more');
        } else {
          navigateTo(section);
        }
      }
    });
  }
  // 綁定更多頁內連結
  const moreLinks = document.getElementById('more-links');
  if (moreLinks) {
    moreLinks.addEventListener('click', (e) => {
      e.preventDefault();
      const link = e.target.closest('a');
      if (!link) return;
      const section = link.dataset.section;
      if (section) {
        navigateTo(section);
      }
    });
  }
  // 綁定側邊欄連結
  document.querySelectorAll('nav#sidebar a').forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const section = a.dataset.section;
      if (section) {
        navigateTo(section);
        // 在手機上關閉側欄
        document.body.classList.remove('sidebar-open');
      }
    });
  });
  // 綁定漢堡按鈕
  const menuToggle = document.getElementById('menu-toggle');
  if (menuToggle) {
    menuToggle.addEventListener('click', () => {
      document.body.classList.toggle('sidebar-open');
    });
  }
  // 綁定返回按鈕
  const backButton = document.getElementById('back-button');
  if (backButton) {
    backButton.addEventListener('click', () => {
      goBack();
    });
  }
  // 綁定瀏覽器返回按鈕
  window.addEventListener('popstate', (e) => {
    const section = e.state && e.state.section ? e.state.section : navStack[navStack.length - 2] || 'home';
    // 當 history 返回時，不再 push 狀態
    navigateTo(section, false);
    // 也要同步修正 navStack
    if (navStack.length > 1) navStack.pop();
  });
  // 初次渲染首頁
  navigateTo('home', true);
  // Hero 按鈕點擊：切換至最新排程
  const heroBtn = document.getElementById('hero-btn');
  if (heroBtn) {
    heroBtn.addEventListener('click', () => {
      navigateTo('schedule');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }
  // 視窗尺寸變化時重新渲染排程（若頁面可見）
  window.addEventListener('resize', () => {
    const scheduleSection = document.getElementById('schedule');
    if (scheduleSection && !scheduleSection.classList.contains('hidden')) {
      renderSchedule();
    }
  });
  // 統一為所有 modal 添加關閉按鈕代理事件
  document.body.addEventListener('click', (e) => {
    if (!e.target || !e.target.classList) return;
    if (e.target.classList.contains('modal-close-button') || e.target.classList.contains('btn-close-modal')) {
      hideModal();
    }
  });
});