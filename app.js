/**
 * DIGITAL CLOAKROOM & REGISTRATION SYSTEM (Sistem Penitipan Barang Digital)
 * Vonexus 2026 - Digital Cloakroom
 */

// Storage Keys
const STORAGE_KEY = 'PCC_CLOAKROOM_DATA_V1';
const EMAIL_CONFIG_KEY = 'PCC_EMAIL_CONFIG_V2';
const LEGACY_EMAILJS_CONFIG_KEY = 'PCC_EMAILJS_CONFIG_V1';
const PENDING_EMAIL_KEY = 'PCC_PENDING_EMAILS_V1';
const DEFAULT_EMAILJS_CONFIG = {
  serviceId: 'service_koorlap',
  templateId: 'template_vonexus',
  publicKey: 'vyV-uoZw2LAOOKupU'
};
const SUPABASE_CONFIG = {
  url: 'https://iaafpcvuwbodxuzehpof.supabase.co',
  anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlhYWZwY3Z1d2JvZHh1emVocG9mIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM1MzI4NDEsImV4cCI6MjEwOTEwODg0MX0.4wdU2ADPc2Q1lceW913QClyM_WdSfhenoL465lmGMNY'
};

if (window.VONEXUS_SUPABASE_CONFIG) {
  SUPABASE_CONFIG.url = window.VONEXUS_SUPABASE_CONFIG.url || SUPABASE_CONFIG.url;
  SUPABASE_CONFIG.anonKey = window.VONEXUS_SUPABASE_CONFIG.anonKey || '';
}

// Global State
let cloakroomData = [];
let currentFilterStatus = 'all';
let html5QrScanner = null;
let currentActiveTicketForReceipt = null;
let currentTicketForCheckout = null;
let isClearingData = false;
let scannerRearRetryPending = true;

// Audio Context for Scanner Beep (synthetic sound, no external mp3 required)
let audioCtx = null;
function playBeep(freq = 880, duration = 0.15) {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!audioCtx) audioCtx = new AudioContextClass();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) {
    console.warn('AudioContext not available or blocked', e);
  }
}


// Helper: Format DateTime to Indonesian Locale
function formatDateTime(date = new Date()) {
  const d = new Date(date);
  const day = String(d.getDate()).padStart(2, '0');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day} ${month} ${year}, ${hours}:${minutes} WIB`;
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  // Check if opened via file:// protocol
  if (window.location.protocol === 'file:') {
    const notice = document.getElementById('fileProtocolNotice');
    if (notice) notice.classList.remove('hidden');
  }

  try {
    const leg = localStorage.getItem(LEGACY_EMAILJS_CONFIG_KEY);
    if (leg) {
      try {
        const parsed = JSON.parse(leg);
        if (parsed.serviceId || parsed.templateId || parsed.publicKey) {
          if (parsed.publicKey) {
            localStorage.setItem(EMAIL_CONFIG_KEY, JSON.stringify({
              provider: 'emailjs',
              gasUrl: '',
              emailjs: parsed
            }));
          }
        }
      } catch(e) {}
    }
  } catch(e) {}

  loadData();
  syncWithSupabase();
  processPendingAutomaticEmails();
  setInterval(syncWithSupabase, 5000);
  initLiveClock();
  updateNextTicketBadge();
  updateQuickTestDropdown();
});

// Live Clock Updater
function initLiveClock() {
  const clockEl = document.getElementById('liveClock');
  const dateEl = document.getElementById('liveDate');
  
  function updateTime() {
    const now = new Date();
    if (clockEl) {
      clockEl.textContent = now.toLocaleTimeString('id-ID', { hour12: false });
    }
    if (dateEl) {
      dateEl.textContent = now.toLocaleDateString('id-ID', { 
        weekday: 'long', 
        day: 'numeric', 
        month: 'short', 
        year: 'numeric' 
      });
    }
  }
  updateTime();
  setInterval(updateTime, 1000);
}

// Load Data from LocalStorage
function loadData() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    try {
      cloakroomData = JSON.parse(raw);
    } catch (e) {
      console.error('Failed to parse localStorage data', e);
      cloakroomData = [];
      saveData();
    }
  } else {
    cloakroomData = [];
    saveData();
  }
  renderDashboardStats();
  renderTable();
  updateNextTicketBadge();
}

// Save Data to LocalStorage
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cloakroomData));
  cloakroomData.forEach(saveRecordToSupabase);
}

async function supabaseRequest(path, options = {}) {
  const response = await fetch(`${SUPABASE_CONFIG.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_CONFIG.anonKey,
      Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...(options.headers || {})
    }
  });
  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase error: ${response.status}`);
  }
  return response.status === 204 ? null : response.json();
}

async function syncWithSupabase() {
  if (isClearingData) return;
  try {
    const rows = await supabaseRequest('cloakroom_records?select=id,data&order=updated_at.asc');
    if (Array.isArray(rows)) {
      cloakroomData = rows.map(row => ({ id: row.id, ...row.data }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cloakroomData));
      renderDashboardStats();
      renderTable();
      updateNextTicketBadge();
    }
  } catch (error) {
    console.warn('Supabase read failed:', error.message);
  }
}

async function saveRecordToSupabase(record) {
  try {
    const { id, ...data } = record;
    await supabaseRequest('cloakroom_records?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id, data, updated_at: new Date().toISOString() }])
    });
  } catch (error) {
    console.error('Supabase save failed:', error);
  }
}

async function deleteRecordFromSupabase(ticketId) {
  try {
    await supabaseRequest(`cloakroom_records?id=eq.${encodeURIComponent(ticketId)}`, {
      method: 'DELETE'
    });
  } catch (error) {
    console.error('Supabase delete failed:', error);
  }
}

// Next Ticket Code Generator (01, 02, etc.)
function getNextTicketCode() {
  if (!cloakroomData || cloakroomData.length === 0) {
    return '01';
  }
  let maxNumber = 0;
  cloakroomData.forEach(item => {
    if (item.id && typeof item.id === 'string') {
      const match = item.id.match(/^(?:TIK-)?(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }
  });
  const nextNumber = maxNumber + 1;
  return String(nextNumber).padStart(2, '0');
}

function updateNextTicketBadge() {
  const nextBadge = document.getElementById('nextTicketBadge');
  if (nextBadge) {
    nextBadge.textContent = getNextTicketCode();
  }
}

// Switch Active Tabs
function switchTab(tabId) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(el => {
    el.classList.add('hidden');
    el.classList.remove('block');
  });

  // Show target tab
  const activeTab = document.getElementById(`tab-${tabId}`);
  if (activeTab) {
    activeTab.classList.remove('hidden');
    activeTab.classList.add('block');
  }

  // Update Desktop Tab Buttons
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'text-[#186301]', 'shadow-sm', 'border', 'border-[#77d26f]/20');
    btn.classList.add('text-slate-600');
  });
  const activeDesktopBtn = document.getElementById(`nav-${tabId}`);
  if (activeDesktopBtn) {
    activeDesktopBtn.classList.add('bg-white', 'text-[#186301]', 'shadow-sm', 'border', 'border-[#77d26f]/20');
    activeDesktopBtn.classList.remove('text-slate-600');
  }

  // Update Mobile Tab Buttons
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.remove('text-[#186301]', 'font-bold');
    btn.classList.add('text-slate-500');
  });
  const activeMobileBtn = document.getElementById(`mobile-nav-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.classList.add('text-[#186301]', 'font-bold');
    activeMobileBtn.classList.remove('text-slate-500');
  }

  // Scanner lifecycle management
  if (tabId === 'scanner') {
    updateQuickTestDropdown();
  } else {
    stopScanner();
  }

  if (tabId === 'checkin') {
    updateNextTicketBadge();
  }
}

// Quick Item Selection Pills
function toggleQuickPill(itemName) {
  const inputEl = document.getElementById('inputBarang');
  let currentVal = inputEl.value.trim();
  const button = Array.from(document.querySelectorAll('#quickPillsContainer .tag-pill'))
    .find(element => element.getAttribute('onclick')?.includes(`'${itemName}'`));
  
  if (currentVal.length === 0) {
    inputEl.value = itemName;
    button?.classList.add('bg-[#eaf7e8]', 'text-[#186301]', 'border-[#b8e2b3]');
  } else {
    // Check if already contains
    if (currentVal.toLowerCase().includes(itemName.toLowerCase())) {
      // Remove it
      const parts = currentVal.split(',').map(s => s.trim()).filter(s => s.toLowerCase() !== itemName.toLowerCase() && s.length > 0);
      inputEl.value = parts.join(', ');
      button?.classList.remove('bg-[#eaf7e8]', 'text-[#186301]', 'border-[#b8e2b3]');
    } else {
      // Append it
      inputEl.value = `${currentVal}, ${itemName}`;
      button?.classList.add('bg-[#eaf7e8]', 'text-[#186301]', 'border-[#b8e2b3]');
    }
  }
}

// Reset Check-in Form
function resetCheckInForm() {
  document.getElementById('checkInForm').reset();
  document.querySelectorAll('#quickPillsContainer .tag-pill').forEach(button => {
    button.classList.remove('bg-[#eaf7e8]', 'text-[#186301]', 'border-[#b8e2b3]');
  });
  updateNextTicketBadge();
}

// Handle Check-In Form Submission
function handleCheckInSubmit(event) {
  event.preventDefault();

  const nama = document.getElementById('inputNama').value.trim();
  const kategori = document.getElementById('inputKategori').value;
  const kontak = document.getElementById('inputKontak').value.trim() || '-';
  const email = normalizeParticipantEmail(document.getElementById('inputEmail').value);
  const barangDetails = document.getElementById('inputBarang').value.trim();
  const merkBarang = document.getElementById('inputMerkBarang')?.value.trim() || '';
  const warnaBarang = document.getElementById('inputWarnaBarang')?.value.trim() || '';
  const barang = [
    barangDetails,
    merkBarang ? `Merk: ${merkBarang}` : '',
    warnaBarang ? `Warna: ${warnaBarang}` : ''
  ].filter(Boolean).join(' | ');
  const rak = document.getElementById('inputLokasiRak').value.trim() || 'Umum';
  const catatan = document.getElementById('inputCatatan').value.trim() || '-';
  const autoSendPdf = document.getElementById('autoSendPdfCheckbox') ? document.getElementById('autoSendPdfCheckbox').checked : true;

  if (!nama || !kategori || !barang) {
    Swal.fire({
      icon: 'warning',
      title: 'Data Belum Lengkap',
      text: 'Harap isi Nama Peserta, Kategori Lomba, dan Rincian Barang.',
      confirmButtonColor: '#297810'
    });
    return;
  }

  const ticketCode = getNextTicketCode();
  const now = new Date();

  const newRecord = {
    id: ticketCode,
    name: nama,
    category: kategori,
    phone: kontak,
    email: email,
    items: barang,
    rack: rak,
    notes: catatan,
    status: 'ACTIVE',
    checkInTime: formatDateTime(now),
    checkInTimestamp: now.getTime(),
    checkOutTime: null,
    checkOutTimestamp: null
  };

  cloakroomData.unshift(newRecord);
  saveData();
  renderDashboardStats();
  renderTable();
  resetCheckInForm();

  // Celebration Confetti
  if (window.confetti) {
    confetti({
      particleCount: 60,
      spread: 70,
      origin: { y: 0.6 }
    });
  }

  // Open Ticket / Receipt Modal Immediately
  openTicketModal(newRecord);

  // AUTOMATIC ZERO-CLICK PDF & EMAIL DELIVERY
  if (autoSendPdf) {
    if (email && email !== '-') {
      dispatchAutomaticEmail(newRecord);
    }
  }
}

// Render Dashboard Statistics
function renderDashboardStats() {
  const activeCount = cloakroomData.filter(item => item.status === 'ACTIVE').length;
  const completedCount = cloakroomData.filter(item => item.status === 'COMPLETED').length;
  const totalCount = cloakroomData.length;

  document.getElementById('statActiveCount').textContent = activeCount;
  document.getElementById('statCompletedCount').textContent = completedCount;
  document.getElementById('statTotalCount').textContent = totalCount;

  document.getElementById('countFilterAll').textContent = totalCount;
  document.getElementById('countFilterActive').textContent = activeCount;
  document.getElementById('countFilterCompleted').textContent = completedCount;

  updateQuickTestDropdown();
}

// Set Status Filter Button
function setStatusFilter(status) {
  currentFilterStatus = status;

  document.querySelectorAll('.status-filter-btn').forEach(btn => {
    btn.classList.remove('bg-white', 'text-slate-800', 'shadow-sm');
    btn.classList.add('text-slate-600');
  });

  const activeBtn = document.getElementById(`filter-status-${status}`);
  if (activeBtn) {
    activeBtn.classList.add('bg-white', 'text-slate-800', 'shadow-sm');
    activeBtn.classList.remove('text-slate-600');
  }

  renderTable();
}

// Render Table & Cards View
function renderTable() {
  const searchInput = document.getElementById('searchInput').value.trim().toLowerCase();
  const categoryFilter = document.getElementById('categoryFilter').value;
  const tableBody = document.getElementById('cloakroomTableBody');
  const cardList = document.getElementById('cloakroomCardList');
  const emptyState = document.getElementById('emptyState');

  let filtered = cloakroomData.filter(item => {
    // Status filter
    if (currentFilterStatus === 'active' && item.status !== 'ACTIVE') return false;
    if (currentFilterStatus === 'completed' && item.status !== 'COMPLETED') return false;

    // Category filter
    if (categoryFilter !== 'all' && item.category !== categoryFilter) return false;

    // Search query
    if (searchInput) {
      const matchId = item.id.toLowerCase().includes(searchInput);
      const matchName = item.name.toLowerCase().includes(searchInput);
      const matchPhone = (item.phone || '').toLowerCase().includes(searchInput);
      const matchItems = (item.items || '').toLowerCase().includes(searchInput);
      const matchRack = (item.rack || '').toLowerCase().includes(searchInput);
      if (!matchId && !matchName && !matchPhone && !matchItems && !matchRack) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = '';
    cardList.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  } else {
    emptyState.classList.add('hidden');
  }

  // Render Table (Desktop)
  let tableHtml = '';
  filtered.forEach(item => {
    const isActive = item.status === 'ACTIVE';
    const statusBadge = isActive
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#eaf7e8] text-[#186301] border border-[#b8e2b3] badge-pulse">
           <i class="fa-solid fa-clock"></i> Dititipkan
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
           <i class="fa-solid fa-check"></i> Sudah Diambil
         </span>`;

    const actionButton = isActive
      ? `<button onclick="triggerDirectCheckOut('${item.id}')" title="Serahkan Barang" class="px-3 py-1.5 bg-[#297810] hover:bg-[#186301] text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm shadow-[#297810]/20">
           <i class="fa-solid fa-hand-holding-hand"></i> Serahkan
         </button>`
      : `<button onclick="undoItemRelease('${item.id}')" title="Batalkan / Kembalikan ke Dititipkan" class="px-2.5 py-1.5 bg-[#f3fbf2] hover:bg-[#e3f6e1] text-[#186301] border border-[#d8ecd4] rounded-lg text-xs font-medium flex items-center gap-1 transition">
           <i class="fa-solid fa-rotate-left"></i> Batal Ambil
         </button>`;

    tableHtml += `
      <tr class="hover:bg-[#f4f9f2]/70 transition">
        <td class="py-3 px-4 font-mono font-bold text-[#186301] whitespace-nowrap">
          ${item.id}
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-800">${item.name}</div>
          <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
            <span class="text-[#297810] font-semibold">${item.category}</span>
            ${item.phone && item.phone !== '-' ? `<span>• <i class="fa-brands fa-whatsapp text-emerald-600"></i> ${item.phone}</span>` : ''}
            ${item.email && item.email !== '-' ? `<span>• <i class="fa-solid fa-envelope text-[#49a141]"></i> ${item.email}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4 max-w-xs">
          <p class="font-medium text-slate-700 line-clamp-2">${item.items}</p>
          ${item.notes && item.notes !== '-' ? `<span class="text-[10px] text-slate-400 italic">Catatan: ${item.notes}</span>` : ''}
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-[#f3fbf2] text-[#186301] border border-[#d8ecd4]">
            ${item.rack || 'Umum'}
          </span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-[11px] text-slate-500 font-mono">
          <div><i class="fa-solid fa-arrow-down text-[#297810] mr-1"></i> ${item.checkInTime}</div>
          ${item.checkOutTime ? `<div><i class="fa-solid fa-arrow-up text-[#49a141] mr-1"></i> ${item.checkOutTime}</div>` : ''}
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          ${statusBadge}
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="viewTicketReceipt('${item.id}')" title="Lihat & Cetak Tiket" class="p-2 text-slate-500 hover:text-[#186301] hover:bg-[#f3fbf2] rounded-lg transition">
              <i class="fa-solid fa-qrcode text-base"></i>
            </button>
            <button onclick="downloadTicketPDF('${item.id}')" title="Unduh Struk PDF" class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
              <i class="fa-solid fa-file-pdf text-sm"></i>
            </button>
            ${actionButton}
            <button onclick="deleteRecord('${item.id}')" title="Hapus Data" class="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition">
              <i class="fa-solid fa-trash text-xs"></i>
            </button>
          </div>
        </td>
      </tr>
    `;
  });
  tableBody.innerHTML = tableHtml;

  // Render Card List (Mobile)
  let cardHtml = '';
  filtered.forEach(item => {
    const isActive = item.status === 'ACTIVE';
    const statusBadge = isActive
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#eaf7e8] text-[#186301] border border-[#b8e2b3]">
           <i class="fa-solid fa-clock"></i> Dititipkan
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-[#e3f6e1] text-[#186301] border border-[#77d26f]/40">
           <i class="fa-solid fa-check text-[#49a141]"></i> Sudah Diambil
         </span>`;

    cardHtml += `
      <div class="p-4 bg-white rounded-3xl border border-[#d8ecd4] shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <span class="font-mono text-base font-extrabold text-[#186301]">${item.id}</span>
          ${statusBadge}
        </div>
        
        <div>
          <h4 class="font-bold text-slate-900 text-sm">${item.name}</h4>
          <p class="text-xs text-[#297810] font-semibold">${item.category}</p>
        </div>

        <div class="p-2.5 bg-[#f4f9f2] rounded-2xl text-xs space-y-1 text-slate-700 border border-[#d8ecd4]">
          <div><strong class="text-slate-500">Barang:</strong> ${item.items}</div>
          <div class="flex justify-between">
            <span><strong class="text-slate-500">Rak:</strong> ${item.rack || '-'}</span>
            <span class="font-mono text-[11px] text-slate-500">${item.checkInTime}</span>
          </div>
          ${item.checkOutTime ? `<div class="text-[#186301] font-semibold"><strong class="text-slate-500">Diambil:</strong> ${item.checkOutTime}</div>` : ''}
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button onclick="viewTicketReceipt('${item.id}')" class="flex-1 py-2 px-3 bg-[#f3fbf2] hover:bg-[#e3f6e1] text-[#186301] border border-[#d8ecd4] rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition">
            <i class="fa-solid fa-qrcode"></i> Tiket QR
          </button>
          ${isActive ? `
            <button onclick="triggerDirectCheckOut('${item.id}')" class="flex-1 py-2 px-3 bg-[#297810] hover:bg-[#186301] text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm shadow-[#297810]/20">
              <i class="fa-solid fa-hand-holding-hand"></i> Serahkan
            </button>
          ` : `
            <button onclick="undoItemRelease('${item.id}')" class="py-2 px-3 bg-[#f3fbf2] hover:bg-[#e3f6e1] text-[#186301] border border-[#d8ecd4] rounded-xl text-xs font-medium transition">
              <i class="fa-solid fa-rotate-left"></i> Undo
            </button>
          `}
        </div>
      </div>
    `;
  });
  cardList.innerHTML = cardHtml;
}

// Generate QR Code into a Container (Optimized for instant scanning)
function renderQRCodeImage(containerId, textToEncode, size = 170) {
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = '';
  container.style.backgroundColor = '#ffffff';
  container.style.padding = '10px';
  
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: textToEncode,
      width: size,
      height: size,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.H
    });
  } else {
    container.innerHTML = `<p class="text-xs text-red-500">QR Code library loading...</p>`;
  }
}

// View & Open Ticket Receipt Modal
function viewTicketReceipt(ticketId) {
  const item = cloakroomData.find(d => d.id === ticketId);
  if (item) {
    openTicketModal(item);
  }
}

function openTicketModal(record) {
  currentActiveTicketForReceipt = record;

  document.getElementById('modalTicketCode').textContent = record.id;
  document.getElementById('modalTicketName').textContent = record.name;
  document.getElementById('modalTicketCategory').textContent = record.category;
  document.getElementById('modalTicketPhone').textContent = record.phone || '-';
  const emailEl = document.getElementById('modalTicketEmail');
  if (emailEl) emailEl.textContent = record.email || '-';
  document.getElementById('modalTicketItems').textContent = record.items;
  document.getElementById('modalTicketRack').textContent = record.rack || 'Umum';
  document.getElementById('modalTicketTime').textContent = record.checkInTime;

  // Set Email Status Banner state
  const emailConfig = getEmailSenderConfig();
  if (record.email && record.email !== '-') {
    if (isEmailSenderConfigured(emailConfig)) {
      const provName = emailConfig.provider === 'gas' ? 'Google Apps Script (Gmail)' : 'EmailJS';
      updateModalEmailBanner('sending', 'Mengirimkan Struk ke Email...', `Tujuan: ${record.email} (via ${provName})`);
    } else {
      updateModalEmailBanner('warning', 'Pengiriman Email Otomatis Belum Terhubung', `Klik di sini untuk menghubungkan Gmail / EmailJS Anda agar struk terkirim.`);
    }
  } else {
    updateModalEmailBanner('none', 'Email Tidak Dicantumkan', 'Peserta dapat mengambil foto QR, kirim via WhatsApp, atau cetak tiket fisik.');
  }

  const statusBadge = document.getElementById('modalTicketStatusBadge');
  if (record.status === 'ACTIVE') {
    statusBadge.className = 'inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-[#eaf7e8] text-[#186301] border border-[#b8e2b3]';
    statusBadge.textContent = 'DITITIPKAN';
  } else {
    statusBadge.className = 'inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    statusBadge.textContent = 'SUDAH DIAMBIL';
  }

  // QR Code payload: Encode Ticket ID directly (e.g. TIK-001) for maximum scan clarity & speed!
  const qrPayload = record.id;

  renderQRCodeImage('qrcodeContainer', qrPayload, 210);

  // Also prepare printable container
  document.getElementById('printTicketCode').textContent = record.id;
  document.getElementById('printTicketName').textContent = record.name;
  document.getElementById('printTicketCategory').textContent = record.category;
  document.getElementById('printTicketPhone').textContent = record.phone || '-';
  document.getElementById('printTicketItems').textContent = record.items;
  document.getElementById('printTicketRack').textContent = record.rack || 'Umum';
  document.getElementById('printTicketTime').textContent = record.checkInTime;
  renderQRCodeImage('printQrCodeContainer', qrPayload, 180);

  // Also prepare PDF container
  document.getElementById('pdfTicketCode').textContent = record.id;
  document.getElementById('pdfTicketName').textContent = record.name;
  document.getElementById('pdfTicketCategory').textContent = record.category;
  document.getElementById('pdfTicketPhone').textContent = record.phone || '-';
  const pdfEmailEl = document.getElementById('pdfTicketEmail');
  if (pdfEmailEl) pdfEmailEl.textContent = record.email || '-';
  document.getElementById('pdfTicketItems').textContent = record.items;
  document.getElementById('pdfTicketRack').textContent = record.rack || 'Umum';
  document.getElementById('pdfTicketTime').textContent = record.checkInTime;
  const pdfQrEl = document.getElementById('pdfQrContainer');
  if (pdfQrEl) {
    renderQRCodeImage('pdfQrContainer', qrPayload, 180);
  }

  // Show Modal
  document.getElementById('ticketModal').classList.remove('hidden');
}

function closeTicketModal() {
  document.getElementById('ticketModal').classList.add('hidden');
}

// Download QR Code Image as PNG
function downloadQRCodeImage() {
  if (!currentActiveTicketForReceipt) return;
  const qrContainer = document.getElementById('qrcodeContainer');
  const img = qrContainer.querySelector('img');
  const canvas = qrContainer.querySelector('canvas');
  
  let dataUrl = '';
  if (img && img.src && img.src.startsWith('data:image')) {
    dataUrl = img.src;
  } else if (canvas) {
    dataUrl = canvas.toDataURL('image/png');
  }

  if (dataUrl) {
    const link = document.createElement('a');
    link.download = `QR_${currentActiveTicketForReceipt.id}_${currentActiveTicketForReceipt.name.replace(/\s+/g, '_')}.png`;
    link.href = dataUrl;
    link.click();
  } else {
    Swal.fire({
      icon: 'info',
      title: 'Tunggu Sebentar',
      text: 'Kode QR sedang diproses, coba klik sekali lagi.'
    });
  }
}

// Print Current Ticket
function printCurrentTicket() {
  window.print();
}

// ========================================================
// PDF GENERATION & EMAIL DELIVERY (HTML2PDF & EMAILJS)
// ========================================================

// ========================================================
// EMAIL PROVIDER MANAGEMENT (GOOGLE APPS SCRIPT & EMAILJS)
// ========================================================

// Get Email provider configuration from LocalStorage
function getEmailSenderConfig() {
  try {
    const raw = localStorage.getItem(EMAIL_CONFIG_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        provider: parsed.provider || 'gas',
        gasUrl: parsed.gasUrl || '',
        emailjs: {
          serviceId: (parsed.emailjs && parsed.emailjs.serviceId) || '',
          templateId: (parsed.emailjs && parsed.emailjs.templateId) || '',
          publicKey: (parsed.emailjs && parsed.emailjs.publicKey) || ''
        }
      };
    }

    // Check legacy EmailJS configuration
    const legacyRaw = localStorage.getItem(LEGACY_EMAILJS_CONFIG_KEY);
    if (legacyRaw) {
      const leg = JSON.parse(legacyRaw);
      if (leg.serviceId && leg.templateId && leg.publicKey) {
        return {
          provider: 'emailjs',
          gasUrl: '',
          emailjs: {
            serviceId: leg.serviceId || '',
            templateId: leg.templateId || '',
            publicKey: leg.publicKey || ''
          }
        };
      }
    }
  } catch (e) {
    console.warn('Error reading email config:', e);
  }

  return {
    provider: 'emailjs',
    gasUrl: '',
    emailjs: { ...DEFAULT_EMAILJS_CONFIG }
  };
}

function isEmailSenderConfigured(cfg) {
  if (!cfg) return false;
  if (cfg.provider === 'gas') {
    return Boolean(cfg.gasUrl && cfg.gasUrl.trim().startsWith('http'));
  }
  if (cfg.provider === 'emailjs') {
    const e = cfg.emailjs;
    return Boolean(
      e &&
      e.serviceId && e.serviceId.trim() &&
      e.templateId && e.templateId.trim() &&
      e.publicKey && e.publicKey.trim()
    );
  }
  return false;
}

function addPendingEmail(ticketId) {
  if (!ticketId) return;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_EMAIL_KEY) || '[]');
    if (!pending.includes(ticketId)) {
      pending.push(ticketId);
      localStorage.setItem(PENDING_EMAIL_KEY, JSON.stringify(pending));
    }
  } catch (error) {
    console.warn('Could not save pending email:', error);
  }
}

function removePendingEmail(ticketId) {
  if (!ticketId) return;
  try {
    const pending = JSON.parse(localStorage.getItem(PENDING_EMAIL_KEY) || '[]');
    localStorage.setItem(PENDING_EMAIL_KEY, JSON.stringify(pending.filter(id => id !== ticketId)));
  } catch (error) {
    console.warn('Could not update pending emails:', error);
  }
}

async function processPendingAutomaticEmails() {
  const config = getEmailSenderConfig();
  if (!isEmailSenderConfigured(config)) return;

  let pending;
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_EMAIL_KEY) || '[]');
  } catch (error) {
    pending = [];
  }

  for (const ticketId of pending) {
    const record = cloakroomData.find(item => item.id === ticketId);
    if (record && record.email && record.email !== '-') {
      await dispatchAutomaticEmail(record, false);
    } else {
      removePendingEmail(ticketId);
    }
  }
}

function normalizeParticipantEmail(email) {
  const normalized = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!normalized || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return '-';
  return normalized;
}

function formatShortTicketNumber(ticketCode) {
  if (typeof ticketCode !== 'string') return '';
  const match = ticketCode.match(/^(?:TIK-)?(\d+)$/i);
  if (!match) return ticketCode;
  return String(parseInt(match[1], 10)).padStart(2, '0');
}

function buildEmailTemplateParams(record, targetEmail, qrCodeUrl) {
  const email = normalizeParticipantEmail(targetEmail);
  return {
    to_email: email,
    email: email,
    participant_email: email,
    recipient_email: email,
    user_email: email,
    to_name: record.name,
    name: record.name,
    title: `Struk Penitipan #${record.id}`,
    ticket_code: record.id,
    ticket_number: formatShortTicketNumber(record.id),
    category: record.category,
    phone: record.phone || '-',
    items: record.items,
    rack: record.rack || 'Umum',
    check_in_time: record.checkInTime,
    qr_code_url: qrCodeUrl,
    notes: record.notes || '-'
  };
}

// Switch Tab inside Email Settings Modal (gas / emailjs)
function switchEmailProviderTab(provider) {
  const tabGas = document.getElementById('tabBtnGas');
  const tabEmailjs = document.getElementById('tabBtnEmailjs');
  const panelGas = document.getElementById('panelGas');
  const panelEmailjs = document.getElementById('panelEmailjs');
  if (!tabGas || !tabEmailjs || !panelGas || !panelEmailjs) return;

  if (provider === 'gas') {
    tabGas.className = 'flex-1 py-2 px-3 rounded-lg font-bold transition text-xs flex items-center justify-center gap-1.5 bg-white text-[#186301] shadow-sm';
    tabEmailjs.className = 'flex-1 py-2 px-3 rounded-lg font-bold transition text-xs flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900';
    panelGas.classList.remove('hidden');
    panelEmailjs.classList.add('hidden');
  } else {
    tabEmailjs.className = 'flex-1 py-2 px-3 rounded-lg font-bold transition text-xs flex items-center justify-center gap-1.5 bg-white text-[#186301] shadow-sm';
    tabGas.className = 'flex-1 py-2 px-3 rounded-lg font-bold transition text-xs flex items-center justify-center gap-1.5 text-slate-600 hover:text-slate-900';
    panelEmailjs.classList.remove('hidden');
    panelGas.classList.add('hidden');
  }
}

// Render status banner in Email Settings Modal
function renderEmailConfigStatus() {
  const container = document.getElementById('emailCurrentStatusAlert');
  if (!container) return;

  const cfg = getEmailSenderConfig();
  if (isEmailSenderConfigured(cfg)) {
    if (cfg.provider === 'gas') {
      container.className = 'p-3 rounded-xl border border-[#b8e2b3] bg-[#f4faf3] text-[#186301] flex items-center justify-between';
      container.innerHTML = `
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-check text-[#49a141] text-base"></i>
          <div>
            <p class="font-bold">Google Apps Script (Gmail) Aktif & Siap</p>
            <p class="text-[11px] text-slate-600">Email struk & QR akan terkirim otomatis lewat akun Gmail Anda</p>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-[#186301] text-white text-[10px] font-bold">Terhubung</span>
      `;
    } else {
      container.className = 'p-3 rounded-xl border border-[#b8e2b3] bg-[#f4faf3] text-[#186301] flex items-center justify-between';
      container.innerHTML = `
        <div class="flex items-center gap-2">
          <i class="fa-solid fa-circle-check text-[#49a141] text-base"></i>
          <div>
            <p class="font-bold">EmailJS Aktif & Siap</p>
            <p class="text-[11px] text-slate-600">Service ID: <code class="font-mono font-bold">${cfg.emailjs.serviceId}</code></p>
          </div>
        </div>
        <span class="px-2 py-0.5 rounded-full bg-[#186301] text-white text-[10px] font-bold">Terhubung</span>
      `;
    }
  } else {
    container.className = 'p-3 rounded-xl border border-amber-300 bg-amber-50 text-amber-900 flex items-center justify-between';
    container.innerHTML = `
      <div class="flex items-center gap-2">
        <i class="fa-solid fa-triangle-exclamation text-amber-600 text-base"></i>
        <div>
          <p class="font-bold">Penyedia Email Belum Terhubung</p>
          <p class="text-[11px] text-amber-800">Pilih Google Apps Script (direkomendasikan) atau EmailJS di bawah agar email terkirim otomatis.</p>
        </div>
      </div>
      <span class="px-2 py-0.5 rounded-full bg-amber-200 text-amber-900 text-[10px] font-bold">Belum Aktif</span>
    `;
  }
}

// Open Email Config Modal
function openEmailConfigModal() {
  const config = getEmailSenderConfig();
  
  const gasInput = document.getElementById('gasWebhookUrl');
  if (gasInput) gasInput.value = config.gasUrl || '';

  const svcInput = document.getElementById('emailjsServiceId');
  const tplInput = document.getElementById('emailjsTemplateId');
  const pubInput = document.getElementById('emailjsPublicKey');
  if (svcInput) svcInput.value = config.emailjs.serviceId || '';
  if (tplInput) tplInput.value = config.emailjs.templateId || '';
  if (pubInput) pubInput.value = config.emailjs.publicKey || '';

  switchEmailProviderTab(config.provider || 'gas');
  renderEmailConfigStatus();

  document.getElementById('emailConfigModal').classList.remove('hidden');
}

// Close Email Config Modal
function closeEmailConfigModal() {
  document.getElementById('emailConfigModal').classList.add('hidden');
}

// Save Google Apps Script Configuration
function saveGasConfig() {
  const gasUrl = (document.getElementById('gasWebhookUrl').value || '').trim();
  if (!gasUrl || !gasUrl.startsWith('http')) {
    Swal.fire({
      icon: 'warning',
      title: 'URL Tidak Valid',
      text: 'Harap masukkan URL Aplikasi Web Google Script yang valid (diawali https://script.google.com/macros/s/...)',
      confirmButtonColor: '#297810'
    });
    return;
  }

  const current = getEmailSenderConfig();
  current.provider = 'gas';
  current.gasUrl = gasUrl;

  localStorage.setItem(EMAIL_CONFIG_KEY, JSON.stringify(current));
  renderEmailConfigStatus();
  closeEmailConfigModal();
  processPendingAutomaticEmails();

  Swal.fire({
    icon: 'success',
    title: 'Google Apps Script Disimpan!',
    text: 'Sistem siap mengirimkan struk tiket & QR code langsung lewat akun Gmail Anda.',
    confirmButtonColor: '#186301'
  });
}

// Save EmailJS Configuration
function saveEmailjsConfig() {
  const serviceId = (document.getElementById('emailjsServiceId').value || '').trim();
  const templateId = (document.getElementById('emailjsTemplateId').value || '').trim();
  const publicKey = (document.getElementById('emailjsPublicKey').value || '').trim();

  if (!serviceId || !templateId || !publicKey) {
    Swal.fire({
      icon: 'warning',
      title: 'Data Belum Lengkap',
      text: 'Harap isi Service ID, Template ID, dan Public Key akun EmailJS Anda.',
      confirmButtonColor: '#297810'
    });
    return;
  }

  const current = getEmailSenderConfig();
  current.provider = 'emailjs';
  current.emailjs = { serviceId, templateId, publicKey };

  localStorage.setItem(EMAIL_CONFIG_KEY, JSON.stringify(current));
  renderEmailConfigStatus();
  closeEmailConfigModal();
  processPendingAutomaticEmails();

  Swal.fire({
    icon: 'success',
    title: 'Pengaturan EmailJS Disimpan!',
    text: 'Sistem siap mengirimkan struk otomatis menggunakan EmailJS.',
    confirmButtonColor: '#186301'
  });
}

// Copy Google Apps Script Code
function copyGoogleScriptCode() {
  const gasCode = `function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var data = JSON.parse(rawData);

    var toEmail = data.to_email || data.email;
    if (!toEmail) return ContentService.createTextOutput("No recipient");

    var ticketCode = data.ticket_code || "TIK-001";
    var participantName = data.to_name || "Peserta";
    var category = data.category || "Umum";
    var items = data.items || "Barang Titipan";
    var rack = data.rack || "Umum";
    var checkInTime = data.check_in_time || "";
    var qrCodeUrl = data.qr_code_url || "";

    var subject = "🎫 Tiket Penitipan Barang #" + ticketCode + " - " + participantName + " (Vonexus 2026)";

    var htmlBody = "" +
      "<div style='font-family: Arial, sans-serif; max-width: 540px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;'>" +
        "<div style='background: #186301; padding: 24px; text-align: center; color: #ffffff;'>" +
          "<div style='font-size: 10px; font-weight: bold; letter-spacing: 2px; text-transform: uppercase; color: #77d26f;'>STRUK RESMI DIGITAL</div>" +
          "<h1 style='margin: 4px 0 0 0; font-size: 22px; font-weight: 800;'>VONEXUS 2026 CLOAKROOM</h1>" +
          "<p style='margin: 4px 0 0 0; font-size: 13px; opacity: 0.9;'>Sistem Penitipan Barang & Registrasi Peserta</p>" +
        "</div>" +
        "<div style='padding: 24px;'>" +
          "<p style='margin-top: 0; font-size: 14px;'>Halo <b>" + participantName + "</b>,</p>" +
          "<p style='font-size: 13px; color: #475569;'>Barang titipan Anda telah berhasil didaftarkan di sistem penitipan Vonexus 2026.</p>" +
          "<div style='background: #f4faf3; border: 2px dashed #b8e2b3; border-radius: 12px; padding: 16px; text-align: center; margin: 18px 0;'>" +
            "<div style='font-size: 11px; font-weight: bold; color: #64748b;'>NOMOR TIKET ANDA:</div>" +
            "<div style='font-size: 32px; font-weight: 900; color: #186301; font-family: monospace; margin: 4px 0;'>" + ticketCode + "</div>" +
            "<div style='display:inline-block; font-size: 11px; font-weight: bold; background: #eaf7e8; color: #186301; padding: 3px 12px; border-radius: 20px; border: 1px solid #b8e2b3;'>STATUS: SEDANG DITITIPKAN</div>" +
          "</div>" +
          "<div style='text-align: center; margin: 20px 0;'>" +
            "<p style='font-size: 12px; font-weight: bold; color: #334155; margin-bottom: 8px;'>Tunjukkan Kode QR ini saat mengambil barang:</p>" +
            "<img src='" + qrCodeUrl + "' width='200' height='200' style='border: 2px solid #186301; border-radius: 10px; padding: 8px; background: #fff;' alt='QR Code'/>" +
          "</div>" +
          "<table style='width: 100%; font-size: 13px; border-collapse: collapse; margin-top: 14px;'>" +
            "<tr><td style='padding: 8px 0; color: #64748b;'>Nama Peserta</td><td style='padding: 8px 0; font-weight: bold; text-align: right;'>" + participantName + "</td></tr>" +
            "<tr><td style='padding: 8px 0; color: #64748b;'>Kategori Acara</td><td style='padding: 8px 0; font-weight: bold; color: #186301; text-align: right;'>" + category + "</td></tr>" +
            "<tr><td style='padding: 8px 0; color: #64748b;'>Rincian Barang</td><td style='padding: 8px 0; font-weight: bold; text-align: right;'>" + items + "</td></tr>" +
            "<tr><td style='padding: 8px 0; color: #64748b;'>Lokasi Rak/Loker</td><td style='padding: 8px 0; font-weight: bold; text-align: right;'>" + rack + "</td></tr>" +
            "<tr><td style='padding: 8px 0; color: #64748b;'>Waktu Check-In</td><td style='padding: 8px 0; font-weight: bold; text-align: right;'>" + checkInTime + "</td></tr>" +
          "</table>" +
        "</div>" +
        "<div style='background: #f8fafc; padding: 14px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0;'>" +
          "Sistem Penitipan Barang Digital Vonexus 2026 &bull; Simpan email ini dengan baik" +
        "</div>" +
      "</div>";

    MailApp.sendEmail({
      to: toEmail,
      subject: subject,
      htmlBody: htmlBody
    });

    return ContentService.createTextOutput(JSON.stringify({ status: "success" })).setMimeType(ContentService.MimeType.JSON);
  } catch(err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() })).setMimeType(ContentService.MimeType.JSON);
  }
}`;

  navigator.clipboard.writeText(gasCode).then(() => {
    Swal.fire({
      icon: 'success',
      title: 'Kode Google Script Disalin!',
      html: `
        <p class="text-xs text-left mb-2">Langkah selanjutnya:</p>
        <ol class="text-xs text-left list-decimal list-inside space-y-1 text-slate-600">
          <li>Buka <b>script.google.com</b> & buat Proyek Baru.</li>
          <li>Paste (tempel) kode ini di editor.</li>
          <li>Klik <b>Terapkan</b> &gt; <b>Deployment Baru</b> &gt; <b>Aplikasi Web</b>.</li>
          <li>Pilih Akses: <b>Siapa saja (Anyone)</b>.</li>
          <li>Salin URL Web App dan tempelkan di kotak URL!</li>
        </ol>
      `,
      confirmButtonColor: '#186301'
    });
  }).catch(() => {
    Swal.fire({
      icon: 'info',
      title: 'Salin Kode Manual',
      text: 'File kode juga tersedia di folder proyek: google_apps_script.js',
      confirmButtonColor: '#186301'
    });
  });
}

// Test Send via Google Apps Script
function testSendGasEmail() {
  const gasUrl = (document.getElementById('gasWebhookUrl').value || '').trim();
  if (!gasUrl || !gasUrl.startsWith('http')) {
    Swal.fire({
      icon: 'warning',
      title: 'Isi URL Google Script',
      text: 'Masukkan URL Web App Google Script Anda terlebih dahulu.'
    });
    return;
  }

  Swal.fire({
    title: 'Tes Kirim via Google Script',
    input: 'email',
    inputLabel: 'Masukkan alamat email tujuan tes:',
    inputPlaceholder: 'emailAnda@gmail.com',
    showCancelButton: true,
    confirmButtonText: 'Kirim Tes Sekarang',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#186301',
    showLoaderOnConfirm: true,
    preConfirm: (targetEmail) => {
      if (!targetEmail) {
        Swal.showValidationMessage('Email tidak boleh kosong');
        return false;
      }
      const testRecord = {
        id: 'TIK-TEST',
        name: 'Pengujian Sistem',
        category: 'Uji Coba Pengiriman',
        phone: '08123456789',
        items: '1x Paket Uji Coba Email',
        rack: 'Rak Percobaan',
        checkInTime: formatDateTime(new Date()),
        notes: 'Uji coba Google Apps Script'
      };
      const qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=TIK-TEST';
      return sendViaGoogleAppsScript(gasUrl, testRecord, targetEmail, qrUrl);
    }
  }).then(result => {
    if (result.isConfirmed) {
      Swal.fire({
        icon: 'success',
        title: 'Permintaan Kirim Berhasil Dikirim!',
        text: 'Permintaan kirim telah diteruskan ke Google Apps Script. Periksa kotak masuk / spam email tujuan dalam beberapa detik.',
        confirmButtonColor: '#186301'
      });
    }
  }).catch(err => {
    console.error('GAS Test error:', err);
    Swal.fire({
      icon: 'error',
      title: 'Pengiriman Gagal',
      text: 'Terjadi kesalahan saat memanggil URL Google Script. Pastikan deployment diatur ke Akses: "Siapa saja (Anyone)".',
      confirmButtonColor: '#297810'
    });
  });
}

// Test Send Email via EmailJS
function testSendEmailJS() {
  const serviceId = document.getElementById('emailjsServiceId').value.trim();
  const templateId = document.getElementById('emailjsTemplateId').value.trim();
  const publicKey = document.getElementById('emailjsPublicKey').value.trim();

  if (!serviceId || !templateId || !publicKey) {
    Swal.fire({
      icon: 'warning',
      title: 'Isi Semua Kunci',
      text: 'Harap lengkapi Service ID, Template ID, dan Public Key terlebih dahulu untuk melakukan pengujian.'
    });
    return;
  }

  Swal.fire({
    title: 'Tes Pengiriman EmailJS',
    input: 'email',
    inputLabel: 'Masukkan alamat email penerima tes:',
    inputPlaceholder: 'emailAnda@example.com',
    showCancelButton: true,
    confirmButtonText: 'Kirim Tes',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#297810',
    showLoaderOnConfirm: true,
    preConfirm: (targetEmail) => {
      if (!targetEmail) {
        Swal.showValidationMessage('Email tidak boleh kosong');
        return false;
      }
      if (typeof emailjs !== 'undefined' && emailjs.init) {
        emailjs.init({ publicKey });
      }
      return emailjs.send(serviceId, templateId, {
        to_email: targetEmail,
        email: targetEmail,
        participant_email: targetEmail,
        recipient_email: targetEmail,
        user_email: targetEmail,
        to_name: "Peserta Uji Coba",
        name: "Peserta Uji Coba",
        title: "Uji Coba Pengiriman Email",
        ticket_code: "TIK-TEST",
        ticket_number: "TEST",
        category: "Uji Coba Sistem",
        phone: "08123456789",
        items: "Barang Pengujian",
        rack: "Rak Tes",
        check_in_time: formatDateTime(new Date()),
        qr_code_url: "https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=TIK-TEST",
        notes: "Pengujian integrasi EmailJS"
      }, { publicKey });
    }
  }).then((result) => {
    if (result.isConfirmed) {
      Swal.fire({
        icon: 'success',
        title: 'Berhasil Terkirim!',
        text: 'Email uji coba berhasil dikirim lewat EmailJS. Periksa inbox/spam email Anda.',
        confirmButtonColor: '#10b981'
      });
    }
  }).catch((err) => {
    console.error('EmailJS test send error:', err);
    Swal.fire({
      icon: 'error',
      title: 'Pengiriman Gagal',
      text: 'Pastikan Service ID, Template ID, dan Public Key sudah benar dari akun emailjs.com Anda.',
      confirmButtonColor: '#297810'
    });
  });
}
// Generate & Download PDF Receipt using html2pdf
function generateTicketPDF(record, shouldDownload = true) {
  const target = record || currentActiveTicketForReceipt;
  if (!target) return Promise.resolve(null);

  // Fill PDF Template Elements
  document.getElementById('pdfTicketCode').textContent = target.id;
  document.getElementById('pdfTicketName').textContent = target.name;
  document.getElementById('pdfTicketCategory').textContent = target.category;
  document.getElementById('pdfTicketPhone').textContent = target.phone || '-';
  document.getElementById('pdfTicketEmail').textContent = target.email || '-';
  document.getElementById('pdfTicketItems').textContent = target.items;
  document.getElementById('pdfTicketRack').textContent = target.rack || 'Umum';
  document.getElementById('pdfTicketTime').textContent = target.checkInTime;

  // Render sharp QR code for PDF
  renderQRCodeImage('pdfQrContainer', target.id, 180);

  const element = document.getElementById('pdfReceiptContainer');
  const filename = `Struk_Penitipan_${target.id}_${(target.name || 'Peserta').replace(/\s+/g, '_')}.pdf`;

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: {
      scale: 2.2,
      useCORS: true,
      logging: false,
      backgroundColor: '#ffffff',
      scrollX: 0,
      scrollY: 0,
      windowWidth: 700
    },
    jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
  };

  if (typeof html2pdf !== 'undefined') {
    return new Promise(async resolve => {
      const originalPosition = {
        left: element.style.left,
        top: element.style.top,
        zIndex: element.style.zIndex,
        visibility: element.style.visibility
      };

      // html2canvas must be able to see the template in the browser viewport.
      // Keeping it far off-screen (left: -9999px) can produce a blank PDF.
      element.style.left = '0px';
      element.style.top = '0px';
      element.style.zIndex = '2147483647';
      element.style.visibility = 'visible';

      try {
        if (document.fonts && document.fonts.ready) {
          await document.fonts.ready;
        }
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        await new Promise(r => setTimeout(r, 300));

        const images = Array.from(element.querySelectorAll('img'));
        await Promise.all(images.map(img => img.complete ? Promise.resolve() : new Promise(r => {
          img.onload = r;
          img.onerror = r;
        })));

        const worker = html2pdf().set(opt).from(element);
        if (shouldDownload) {
          await worker.save();
          resolve(true);
        } else {
          const pdfDataUri = await worker.outputPdf('datauristring');
          resolve(pdfDataUri);
        }
      } catch (error) {
        console.error('PDF generation error:', error);
        resolve(shouldDownload ? false : null);
      } finally {
        element.style.left = originalPosition.left;
        element.style.top = originalPosition.top;
        element.style.zIndex = originalPosition.zIndex;
        element.style.visibility = originalPosition.visibility;
      }
    });
  } else {
    console.warn('html2pdf library is not loaded');
    return Promise.resolve(null);
  }
}

// Trigger PDF Download from Modal or Table
function downloadTicketPDF(ticketId = null) {
  const target = ticketId ? cloakroomData.find(d => d.id === ticketId) : currentActiveTicketForReceipt;
  if (target) {
    generateTicketPDF(target, true).then(result => {
      if (result === false) {
        Swal.fire({
          icon: 'error',
          title: 'PDF Gagal Dibuat',
          text: 'Struk tidak dapat dirender. Periksa koneksi atau muat ulang halaman.'
        });
      }
    });
  }
}

// Send Ticket Receipt via Google Apps Script (Fetch POST)
async function sendViaGoogleAppsScript(url, record, targetEmail, qrCodeUrl) {
  const payload = {
    to_email: targetEmail,
    email: targetEmail,
    to_name: record.name,
    ticket_code: record.id,
    category: record.category,
    phone: record.phone || '-',
    items: record.items,
    rack: record.rack || 'Umum',
    check_in_time: record.checkInTime,
    notes: record.notes || '-',
    qr_code_url: qrCodeUrl
  };

  return fetch(url, {
    method: 'POST',
    mode: 'no-cors',
    headers: {
      'Content-Type': 'text/plain;charset=utf-8'
    },
    body: JSON.stringify(payload)
  });
}

// Send Ticket Receipt via EmailJS
async function sendViaEmailJS(emailjsConfig, record, targetEmail, qrCodeUrl) {
  if (typeof emailjs === 'undefined') {
    throw new Error('Library EmailJS belum siap');
  }

  if (emailjs.init) {
    emailjs.init({ publicKey: emailjsConfig.publicKey });
  }

  const templateParams = buildEmailTemplateParams(record, targetEmail, qrCodeUrl);
  return emailjs.send(
    emailjsConfig.serviceId,
    emailjsConfig.templateId,
    templateParams,
    { publicKey: emailjsConfig.publicKey }
  );
}

// Send Ticket Receipt to Participant Email (Manual trigger from Modal/Table)
async function sendTicketToEmail(record, showPromptIfNoConfig = true) {
  const target = record || currentActiveTicketForReceipt;
  if (!target) return;
  target.email = normalizeParticipantEmail(target.email);

  // If email not provided, prompt user for recipient email
  if (!target.email || target.email === '-') {
    Swal.fire({
      title: 'Kirim Struk ke Email',
      input: 'email',
      inputLabel: 'Masukkan alamat email peserta:',
      inputPlaceholder: 'peserta@example.com',
      showCancelButton: true,
      confirmButtonText: 'Kirim Struk',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#297810'
    }).then(res => {
      if (res.isConfirmed && res.value) {
        target.email = normalizeParticipantEmail(res.value);
        if (target.email === '-') {
          Swal.fire({
            icon: 'warning',
            title: 'Email Tidak Valid',
            text: 'Masukkan alamat email peserta yang benar.',
            confirmButtonColor: '#297810'
          });
          return;
        }
        saveData();
        renderTable();
        const modalEmail = document.getElementById('modalTicketEmail');
        if (modalEmail) modalEmail.textContent = target.email;
        sendTicketToEmail(target, true);
      }
    });
    return;
  }

  const config = getEmailSenderConfig();
  if (!isEmailSenderConfigured(config)) {
    if (showPromptIfNoConfig) {
      Swal.fire({
        icon: 'warning',
        title: 'Penyedia Email Belum Terhubung',
        text: 'Aplikasi belum terhubung ke pengirim email (Google Apps Script atau EmailJS). Buka pengaturan untuk menghubungkan akun Gmail Anda dalam 1 menit.',
        showCancelButton: true,
        confirmButtonText: 'Atur Email Sekarang',
        cancelButtonText: 'Tutup',
        confirmButtonColor: '#186301'
      }).then(r => {
        if (r.isConfirmed) openEmailConfigModal();
      });
    }
    updateModalEmailBanner('warning', 'Pengiriman Email Belum Terhubung', 'Klik di sini untuk menghubungkan Akun Gmail Anda.');
    return;
  }

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&qzone=4&ecc=M&data=${encodeURIComponent(target.id)}`;
  const provName = config.provider === 'gas' ? 'Google Apps Script (Gmail)' : 'EmailJS';
  updateModalEmailBanner('sending', `Mengirimkan Struk ke Email...`, `Tujuan: ${target.email} via ${provName}`);

  try {
    if (config.provider === 'gas') {
      await sendViaGoogleAppsScript(config.gasUrl, target, target.email, qrCodeUrl);
    } else {
      await sendViaEmailJS(config.emailjs, target, target.email, qrCodeUrl);
    }

    removePendingEmail(target.id);
    updateModalEmailBanner('success', 'Struk & Kode QR Berhasil Terkirim ke Email!', `Terkirim ke: ${target.email}`);
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true
    });
    Toast.fire({
      icon: 'success',
      title: `Struk tiket ${target.id} & QR terkirim ke email!`
    });
  } catch (err) {
    console.error('Email send error:', err);
    updateModalEmailBanner('warning', 'Pengiriman Email Terkendala', (err && err.text) || (err && err.message) || 'Periksa pengaturan email di menu Opsi.');
  }
}

// Automatically Dispatch Email with Live QR Code in Background (Zero-click on Check-In)
async function dispatchAutomaticEmail(record, addToQueue = true) {
  if (!record || !record.email || record.email === '-') return;
  record.email = normalizeParticipantEmail(record.email);
  if (record.email === '-') return;

  const config = getEmailSenderConfig();
  if (!isEmailSenderConfigured(config)) {
    if (addToQueue) addPendingEmail(record.id);
    updateModalEmailBanner('warning', 'Pengiriman Email Belum Terhubung', `Email peserta: ${record.email}. Klik di sini untuk menghubungkan Gmail Anda.`);
    return;
  }

  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&qzone=4&ecc=M&data=${encodeURIComponent(record.id)}`;
  const provName = config.provider === 'gas' ? 'Google Apps Script' : 'EmailJS';
  updateModalEmailBanner('sending', 'Mengirimkan Struk ke Email...', `Tujuan: ${record.email} (via ${provName})`);

  try {
    if (config.provider === 'gas') {
      await sendViaGoogleAppsScript(config.gasUrl, record, record.email, qrCodeUrl);
    } else {
      await sendViaEmailJS(config.emailjs, record, record.email, qrCodeUrl);
    }

    removePendingEmail(record.id);
    updateModalEmailBanner('success', 'Struk & Kode QR Berhasil Terkirim ke Email!', `Terkirim otomatis ke: ${record.email}`);
    const Toast = Swal.mixin({
      toast: true,
      position: 'top-end',
      showConfirmButton: false,
      timer: 3500,
      timerProgressBar: true
    });
    Toast.fire({
      icon: 'success',
      title: `Struk tiket ${record.id} & QR otomatis terkirim ke email!`
    });
  } catch (err) {
    console.error('Email auto-dispatch error:', err);
    updateModalEmailBanner('warning', 'Pengiriman Otomatis Terkendala', (err && err.text) || (err && err.message) || 'Periksa konfigurasi email di menu Opsi.');
  }
}

// Update Modal Email Banner State
function updateModalEmailBanner(type, title, subtext) {
  const banner = document.getElementById('modalEmailStatusBanner');
  const icon = document.getElementById('modalEmailStatusIcon');
  const text = document.getElementById('modalEmailStatusText');
  const sub = document.getElementById('modalEmailStatusSubtext');
  if (!banner || !icon || !text || !sub) return;

  banner.classList.remove('hidden');

  if (type === 'sending') {
    banner.className = 'p-3 rounded-2xl text-xs flex items-center gap-2.5 bg-sky-50 border border-sky-200 text-sky-950 transition';
    icon.className = 'fa-solid fa-spinner fa-spin text-sky-600 text-sm';
    banner.onclick = null;
    banner.style.cursor = 'default';
  } else if (type === 'success') {
    banner.className = 'p-3 rounded-2xl text-xs flex items-center gap-2.5 bg-[#eaf7e8] border border-[#b8e2b3] text-[#186301] transition';
    icon.className = 'fa-solid fa-circle-check text-[#49a141] text-sm';
    banner.onclick = null;
    banner.style.cursor = 'default';
  } else if (type === 'warning') {
    banner.className = 'p-3 rounded-2xl text-xs flex items-center gap-2.5 bg-amber-50 border border-amber-200 text-amber-950 transition cursor-pointer hover:bg-amber-100/80';
    icon.className = 'fa-solid fa-triangle-exclamation text-amber-600 text-sm';
    banner.title = 'Klik untuk membuka Pengaturan Email';
    banner.onclick = () => openEmailConfigModal();
  } else {
    banner.className = 'p-3 rounded-2xl text-xs flex items-center gap-2.5 bg-slate-50 border border-slate-200 text-slate-700 transition';
    icon.className = 'fa-solid fa-circle-info text-slate-500 text-sm';
    banner.onclick = null;
    banner.style.cursor = 'default';
  }

  text.textContent = title;
  sub.textContent = subtext;
}
// Copy Ready-to-Use EmailJS HTML Template (with QR Image variable)
function copyEmailTemplateHTML() {
  const template = `<style>
  .pcc-details td { overflow-wrap: anywhere; word-break: break-word; }
  @media only screen and (max-width: 480px) {
    .pcc-email-card { padding: 14px !important; border-radius: 10px !important; }
    .pcc-email-title { font-size: 17px !important; }
    .pcc-ticket-code { font-size: 22px !important; letter-spacing: 1px !important; word-break: break-word !important; }
    .pcc-qr { width: 140px !important; height: 140px !important; }
    .pcc-details td { font-size: 11px !important; padding: 7px 2px !important; }
    .pcc-details td:first-child { width: 38% !important; }
  }
</style>
<div class="pcc-email-card" style="font-family: Arial, sans-serif; width: 100%; max-width: 500px; box-sizing: border-box; margin: 0 auto; padding: 20px; border: 2px solid #297810; border-radius: 14px; background: #ffffff;">
  <div style="text-align: center; border-bottom: 2px dashed #b2dfab; padding-bottom: 12px;">
    <h2 class="pcc-email-title" style="color: #186301; margin: 0; font-size: 20px; font-weight: bold;">VONEXUS 2026 CLOAKROOM</h2>
    <p style="color: #49a141; font-size: 11px; margin: 4px 0 0 0; font-weight: 600;">Bukti Resmi Penitipan Barang & Registrasi</p>
  </div>
  <div style="text-align: center; background: #f3fbf2; border: 1.5px dashed #77d26f; padding: 12px; margin: 15px 0; border-radius: 10px;">
    <div style="font-size: 11px; color: #186301; font-weight: bold; letter-spacing: 1px;">NOMOR TIKET</div>
    <div class="pcc-ticket-code" style="font-size: 28px; font-weight: bold; color: #186301; letter-spacing: 2px; font-family: monospace; word-break: break-word;">{{ticket_number}}</div>
  </div>
  <div style="text-align: center; margin: 15px 0;">
    <img class="pcc-qr" src="{{qr_code_url}}" alt="QR Code Tiket" width="180" height="180" style="max-width: 100%; height: auto; border: 1.5px solid #b2dfab; border-radius: 10px; padding: 6px; background: #fff;" />
    <p style="font-size: 11px; color: #64748b; margin-top: 6px;">Tunjukkan Kode QR ini kepada Panitia saat pengambilan barang</p>
  </div>
  <table class="pcc-details" style="width: 100%; table-layout: fixed; font-size: 12px; border-collapse: collapse; margin-bottom: 12px;">
    <tr><td style="padding: 6px 0; color: #64748b; width: 35%;">Nama Peserta</td><td style="padding: 6px 0; font-weight: bold; text-align: right; color: #0f172a;">{{to_name}}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b;">Kategori Lomba</td><td style="padding: 6px 0; font-weight: bold; color: #186301; text-align: right;">{{category}}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b;">Rincian Barang</td><td style="padding: 6px 0; font-weight: bold; text-align: right; color: #0f172a;">{{items}}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b;">Lokasi Rak/Loker</td><td style="padding: 6px 0; font-weight: bold; color: #186301; text-align: right;">{{rack}}</td></tr>
    <tr><td style="padding: 6px 0; color: #64748b;">Waktu Check-In</td><td style="padding: 6px 0; font-family: monospace; text-align: right; color: #475569;">{{check_in_time}}</td></tr>
  </table>
  <div style="border-top: 1px dashed #b2dfab; margin-top: 15px; padding-top: 10px; font-size: 11px; color: #186301; text-align: center;">
    Harap simpan email ini sebagai bukti verifikasi yang sah. Terima kasih atas partisipasi Anda!
  </div>
</div>`;

  navigator.clipboard.writeText(template).then(() => {
    Swal.fire({
      icon: 'success',
      title: 'Template Berhasil Disalin!',
      text: 'Buka EmailJS ➔ Email Templates ➔ Tempel (paste) kode HTML ini pada Content template Anda.',
      confirmButtonColor: '#297810'
    });
  }).catch(() => {
    Swal.fire({
      icon: 'info',
      title: 'Salin Template',
      text: 'Gunakan tombol Salin Template dari menu Opsi ➔ Pengaturan Email.'
    });
  });
}

// Fallback to default email client (mailto) & explain PDF
function fallbackEmailClient(target) {
  const subject = encodeURIComponent(`[VONEXUS 2026 CLOAKROOM] Bukti Penitipan Barang - Tiket ${target.id} (${target.name})`);
  const body = encodeURIComponent(
    `Halo ${target.name},\n\n` +
    `Terima kasih telah menitipkan barang Anda di Vonexus 2026 Cloakroom.\n` +
    `Berikut adalah rincian data penitipan resmi Anda:\n\n` +
    `========================================\n` +
    `NOMOR TIKET  : ${target.id}\n` +
    `NAMA PESERTA : ${target.name}\n` +
    `KATEGORI     : ${target.category}\n` +
    `BARANG       : ${target.items}\n` +
    `LOKASI RAK   : ${target.rack || 'Umum'}\n` +
    `WAKTU TITIP  : ${target.checkInTime}\n` +
    `========================================\n\n` +
    `Berkas PDF Struk Resmi Anda telah dibuat dan otomatis terunduh di perangkat.\n` +
    `Harap simpan email atau PDF ini untuk ditunjukkan kepada panitia saat pengambilan barang.\n\n` +
    `Salam hormat,\n` +
    `Panitia Vonexus 2026`
  );

  Swal.fire({
    icon: 'info',
    title: 'Kirim Struk ke Email',
    html: `
      <div class="text-left text-xs space-y-2">
        <p>Struk PDF <b>Struk_Penitipan_${target.id}.pdf</b> telah otomatis terunduh di perangkat Anda.</p>
        <p>Untuk mengirimkan langsung ke <b>${target.email}</b>:</p>
        <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p class="font-bold text-slate-700">Pilihan: Buka Aplikasi Email</p>
          <p class="text-[11px] text-slate-500">Klik tombol di bawah untuk membuka aplikasi email (Gmail / Outlook) dengan draf pesan otomatis.</p>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-paper-plane mr-1.5"></i> Buka Aplikasi Email',
    cancelButtonText: 'Selesai',
    confirmButtonColor: '#297810'
  }).then(res => {
    if (res.isConfirmed) {
      window.open(`mailto:${target.email}?subject=${subject}&body=${body}`, '_blank');
    }
  });
}

// Share Ticket to WhatsApp
function shareTicketToWhatsApp(record) {
  const target = record || currentActiveTicketForReceipt;
  if (!target) return;

  let phone = (target.phone || '').replace(/\D/g, '');
  if (phone.startsWith('0')) {
    phone = '62' + phone.slice(1);
  }

  const text = encodeURIComponent(
    `*BUKTI RESMI PENITIPAN BARANG DIGITAL - VONEXUS 2026*\n\n` +
    `Halo *${target.name}*,\n` +
    `Barang titipan Anda telah terdaftar di sistem dengan rincian:\n\n` +
    `🔖 *Nomor Tiket :* ${target.id}\n` +
    `🏆 *Kategori    :* ${target.category}\n` +
    `🎒 *Barang      :* ${target.items}\n` +
    `📦 *Lokasi Rak  :* ${target.rack || 'Umum'}\n` +
    `⏰ *Waktu Titip :* ${target.checkInTime}\n\n` +
    `Tunjukkan tiket ini kepada panitia saat mengambil barang. Terima kasih!`
  );

  const waUrl = phone ? `https://wa.me/${phone}?text=${text}` : `https://api.whatsapp.com/send?text=${text}`;
  window.open(waUrl, '_blank');
}

// ========================================================
// QR SCANNER (CAMERA & CHECK-OUT INTEGRATION)
// ========================================================

function initCameraList() {
  if (typeof Html5Qrcode === 'undefined') return;

  Html5Qrcode.getCameras().then(devices => {
    const select = document.getElementById('cameraSelect');
    if (!select) return;
    select.innerHTML = '';
    if (devices && devices.length) {
      devices.forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.id;
        const label = device.label || `Kamera ${index + 1}`;
        option.text = /back|rear|belakang|environment/i.test(label)
          ? `${label} - Kamera Belakang`
          : label;
        select.appendChild(option);
      });
      const rearCamera = devices.find(device =>
        /back|rear|belakang|environment/i.test(device.label || '')
      );
      if (rearCamera) select.value = rearCamera.deviceId;
      select.onchange = () => {
        select.dataset.manualSelection = 'true';
        stopScanner();
        setTimeout(startScanner, 150);
      };
    } else {
      const option = document.createElement('option');
      option.value = '';
      option.text = 'Deteksi otomatis kamera...';
      select.appendChild(option);
    }
  }).catch(err => {
    console.warn('Unable to get cameras', err);
  });
}

function toggleScannerFullscreen() {
  const frame = document.querySelector('.scanner-frame');
  if (!frame) return;

  const isFullscreen = frame.classList.toggle('fullscreen-scanner');
  document.body.style.overflow = isFullscreen ? 'hidden' : '';

  if (html5QrScanner && html5QrScanner.isScanning) {
    setTimeout(() => {
      if (html5QrScanner.stop) {
        html5QrScanner.stop().then(() => startScanner()).catch(() => {});
      }
    }, 120);
  }
}

function configureScannerVideoForIOS() {
  const reader = document.getElementById('qr-reader');
  if (!reader) return;

  const configureVideo = () => {
    reader.querySelectorAll('video').forEach(video => {
      video.setAttribute('autoplay', '');
      video.setAttribute('muted', '');
      video.setAttribute('playsinline', '');
      video.setAttribute('webkit-playsinline', '');
      video.muted = true;
      video.playsInline = true;
      video.style.width = '100%';
      video.style.height = '100%';
      video.style.objectFit = 'cover';
      if (video.paused) {
        video.play().catch(() => {});
      }
    });
  };

  configureVideo();
  if (!reader.__scannerVideoObserver) {
    reader.__scannerVideoObserver = new MutationObserver(configureVideo);
    reader.__scannerVideoObserver.observe(reader, { childList: true, subtree: true });
  }

  if (!reader.__scannerVideoVerified) {
    reader.__scannerVideoVerified = true;
    setTimeout(() => {
      const video = reader.querySelector('video');
      const isBlank = !video ||
        video.readyState < 2 ||
        video.videoWidth === 0 ||
        video.videoHeight === 0;

      if (isBlank && html5QrScanner && html5QrScanner.isScanning && !reader.__scannerVideoRetry) {
        reader.__scannerVideoRetry = true;
        html5QrScanner.stop().catch(() => {}).finally(() => {
          setTimeout(() => startScanner(), 300);
        });
      }
    }, 1800);
  }
}

async function startScanner() {
  scannerRearRetryPending = true;
  const laser = document.getElementById('scannerLaser');
  const placeholder = document.getElementById('scannerPlaceholder');
  const btnStart = document.getElementById('btnStartScan');
  const btnStop = document.getElementById('btnStopScan');
  const cameraSelect = document.getElementById('cameraSelect');
  configureScannerVideoForIOS();
  const manuallySelectedCamera = cameraSelect && cameraSelect.dataset.manualSelection === 'true';

  if (html5QrScanner && html5QrScanner.isScanning) {
    return;
  }

  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("qr-reader");
  }

  const cameraId = manuallySelectedCamera && cameraSelect.value
    ? cameraSelect.value
    : { facingMode: { ideal: "environment" } };

  const config = {
    fps: 15,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const edge = Math.floor(minEdge * (window.innerWidth < 640 ? 0.82 : 0.75));
      return { width: edge, height: edge };
    },
    aspectRatio: 0,
    videoConstraints: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920 },
      height: { ideal: 1080 }
    },
    showTorchButtonIfSupported: true
  };

  html5QrScanner.start(
    cameraId,
    config,
    onQrScanSuccess,
    (errorMessage) => {
      // Ignored for normal scan frame searching
    }
  ).then(() => {
    laser.classList.remove('hidden');
    placeholder.classList.add('hidden');
    btnStart.classList.add('hidden');
    btnStop.classList.remove('hidden');
    configureScannerVideoForIOS();
    initCameraList();
  }).catch(err => {
    console.error('Error starting html5QrScanner', err);
    if (scannerRearRetryPending) {
      scannerRearRetryPending = false;
      const fallbackConfig = { ...config };
      if (fallbackConfig.videoConstraints) {
        fallbackConfig.videoConstraints.facingMode = { ideal: 'environment' };
      }
      html5QrScanner.start(
        { facingMode: { ideal: 'environment' } },
        fallbackConfig,
        onQrScanSuccess,
        () => {}
      ).then(() => {
        laser.classList.remove('hidden');
        placeholder.classList.add('hidden');
        btnStart.classList.add('hidden');
        btnStop.classList.remove('hidden');
        configureScannerVideoForIOS();
        initCameraList();
      }).catch(() => {
        showScannerError();
      });
      return;
    }
    showScannerError();
  });
}

function showScannerError() {
    const secureContext = window.isSecureContext;
    Swal.fire({
      icon: 'warning',
      title: 'Akses Kamera Terkendala',
      html: `
        <div class="text-left text-xs space-y-2">
          <p>${secureContext ? 'Izinkan akses kamera pada ikon gembok/kamera di bilah alamat browser.' : 'Kamera hanya aktif pada <code>https://</code> atau <code>localhost</code>, bukan <code>file://</code>.'}</p>
          <p><b>Solusi Mudah:</b></p>
          <ul class="list-disc pl-4 space-y-1">
            <li>Gunakan tombol <b>"Scan Foto QR"</b> untuk memilih gambar QR dari laptop/HP Anda.</li>
            <li>Gunakan fitur <b>"Simulasi Cepat"</b> di bawah untuk tes tanpa kamera.</li>
            <li>Buka melalui localhost (VS Code Live Server).</li>
          </ul>
        </div>
      `,
      confirmButtonColor: '#297810'
    });
}

function stopScanner() {
  const laser = document.getElementById('scannerLaser');
  const placeholder = document.getElementById('scannerPlaceholder');
  const btnStart = document.getElementById('btnStartScan');
  const btnStop = document.getElementById('btnStopScan');
  const reader = document.getElementById('qr-reader');
  if (reader) {
    reader.__scannerVideoVerified = false;
    reader.__scannerVideoRetry = false;
  }

  if (html5QrScanner && html5QrScanner.isScanning) {
    html5QrScanner.stop().then(() => {
      laser.classList.add('hidden');
      placeholder.classList.remove('hidden');
      btnStart.classList.remove('hidden');
      btnStop.classList.add('hidden');
    }).catch(err => {
      console.warn('Error stopping scanner', err);
    });
  }
}

// Scan QR Code from an Image File
function handleQrFileScan(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("qr-reader");
  }

  html5QrScanner.scanFile(file, true)
    .then(decodedText => {
      onQrScanSuccess(decodedText);
    })
    .catch(err => {
      console.error('Error scanning file', err);
      Swal.fire({
        icon: 'error',
        title: 'QR Code Tidak Terbaca',
        text: 'Pastikan gambar yang diunggah memuat kode QR yang jelas dan tidak blur.',
        confirmButtonColor: '#297810'
      });
    })
    .finally(() => {
      event.target.value = '';
    });
}

// Update Quick Test Dropdown
function updateQuickTestDropdown() {
  const select = document.getElementById('quickTestSelect');
  if (!select) return;
  select.innerHTML = '<option value="">Pilih Tiket Aktif...</option>';
  const activeItems = cloakroomData.filter(d => d.status === 'ACTIVE');
  if (activeItems.length === 0) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = '(Tidak ada titipan aktif)';
    select.appendChild(opt);
    return;
  }
  activeItems.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id;
    opt.textContent = `${item.id} - ${item.name}`;
    select.appendChild(opt);
  });
}

// Quick Simulation Handler
function handleQuickSimulation() {
  const select = document.getElementById('quickTestSelect');
  const ticketId = select ? select.value : '';
  if (!ticketId) {
    Swal.fire({
      icon: 'info',
      title: 'Pilih Tiket Terlebih Dahulu',
      text: 'Pilih salah satu nomor tiket aktif pada pilihan dropdown simulasi.',
      confirmButtonColor: '#297810'
    });
    return;
  }
  onQrScanSuccess(ticketId);
}

// On QR Code Successfully Decoded
function onQrScanSuccess(decodedText) {
  // Beep sound confirmation
  playBeep(980, 0.12);

  // Pause scanner temporarily to avoid duplicate triggers
  if (html5QrScanner && html5QrScanner.isScanning) {
    try {
      html5QrScanner.pause(true);
    } catch(e) {}
  }

  // Accept plain ticket IDs, JSON payloads, and URLs containing a ticket ID.
  let targetTicketId = decodedText.trim();
  try {
    const parsed = JSON.parse(decodedText);
    targetTicketId = parsed.ticket || parsed.ticketCode || parsed.ticket_code || parsed.id || targetTicketId;
  } catch (e) {
    try {
      const url = new URL(targetTicketId);
      targetTicketId = url.searchParams.get('ticket')
        || url.searchParams.get('ticketCode')
        || url.searchParams.get('id')
        || url.pathname.split('/').pop()
        || targetTicketId;
    } catch (urlError) {
      // Plain string format
    }
  }

  let ticketLookupText = targetTicketId;
  try {
    ticketLookupText = decodeURIComponent(targetTicketId);
  } catch (e) {
    // Keep the original text if it is not valid URI encoding.
  }
  const normalizeTicketLookup = (value) => {
    const text = String(value || '').trim().toUpperCase();
    const match = text.match(/(?:TIK-)?(\d+)/i);
    return match ? String(parseInt(match[1], 10)).padStart(2, '0') : text;
  };

  targetTicketId = normalizeTicketLookup(ticketLookupText);
  const foundItem = cloakroomData.find(item => normalizeTicketLookup(item.id) === targetTicketId);

  if (!foundItem) {
    Swal.fire({
      icon: 'error',
      title: 'Tiket Tidak Ditemukan',
      text: `Nomor tiket "${targetTicketId}" tidak terdaftar di sistem.`,
      confirmButtonColor: '#297810'
    }).then(() => {
      if (html5QrScanner && html5QrScanner.isScanning) {
        try { html5QrScanner.resume(); } catch(e) {}
      }
    });
    return;
  }

  // Open Checkout Confirmation Modal
  openCheckoutModal(foundItem);
}

// Manual Check-Out Search Trigger
function handleManualCheckOutSearch(event) {
  event.preventDefault();
  const inputVal = document.getElementById('manualTicketInput').value.trim();
  if (!inputVal) return;

  const normalizeTicketLookup = (value) => {
    const text = String(value || '').trim().toUpperCase();
    const match = text.match(/(?:TIK-)?(\d+)/i);
    return match ? String(parseInt(match[1], 10)).padStart(2, '0') : text;
  };

  const searchCode = normalizeTicketLookup(inputVal);
  const foundItem = cloakroomData.find(item =>
    normalizeTicketLookup(item.id) === searchCode ||
    item.name.toLowerCase().includes(inputVal.toLowerCase())
  );

  if (!foundItem) {
    Swal.fire({
      icon: 'error',
      title: 'Data Tidak Ditemukan',
      text: `Tidak ditemukan titipan dengan kode/nama: "${inputVal}".`,
      confirmButtonColor: '#297810'
    });
    return;
  }

  document.getElementById('manualTicketInput').value = '';
  openCheckoutModal(foundItem);
}

// Open Checkout Modal
function openCheckoutModal(record) {
  currentTicketForCheckout = record;

  document.getElementById('checkoutConfirmTicketCode').textContent = record.id;
  document.getElementById('checkoutConfirmName').textContent = record.name;
  document.getElementById('checkoutConfirmCategory').textContent = record.category;
  document.getElementById('checkoutConfirmPhone').textContent = record.phone || '-';
  document.getElementById('checkoutConfirmItems').textContent = record.items;
  document.getElementById('checkoutConfirmRack').textContent = record.rack || 'Umum';
  document.getElementById('checkoutConfirmCheckInTime').textContent = record.checkInTime;

  const header = document.getElementById('checkoutModalHeader');
  const title = document.getElementById('checkoutModalTitle');
  const subtitle = document.getElementById('checkoutModalSubtitle');
  const badgeContainer = document.getElementById('checkoutConfirmStatusBadge');
  const completedRow = document.getElementById('checkoutCompletedInfoRow');
  const btnExecute = document.getElementById('btnExecuteCheckOut');

  if (record.status === 'ACTIVE') {
    // Ready for release
    header.className = 'bg-gradient-to-r from-emerald-600 to-teal-700 px-6 py-4 text-white text-center relative';
    title.textContent = 'Verifikasi Serah Terima Barang';
    subtitle.textContent = 'Barang siap diserahkan kepada peserta';
    badgeContainer.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-[#eaf7e8] text-[#186301] border border-[#b8e2b3]">
      <i class="fa-solid fa-clock"></i> Status: Sedang Dititipkan
    </span>`;
    completedRow.classList.add('hidden');
    btnExecute.classList.remove('hidden');
    btnExecute.innerHTML = `<i class="fa-solid fa-hand-holding-hand"></i> Serahkan Barang & Selesaikan`;
  } else {
    // Already released
    header.className = 'bg-gradient-to-r from-slate-700 to-slate-800 px-6 py-4 text-white text-center relative';
    title.textContent = 'Barang Sudah Diambil Sebelumnya';
    subtitle.textContent = 'Tiket ini telah diselesaikan';
    badgeContainer.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800">
      <i class="fa-solid fa-circle-check"></i> Status: Sudah Diambil
    </span>`;
    completedRow.classList.remove('hidden');
    document.getElementById('checkoutConfirmCheckOutTime').textContent = record.checkOutTime || '-';
    btnExecute.classList.add('hidden'); // Hide execute button
  }

  document.getElementById('checkoutConfirmModal').classList.remove('hidden');
}

function closeCheckoutModal() {
  document.getElementById('checkoutConfirmModal').classList.add('hidden');
  if (html5QrScanner && html5QrScanner.isScanning) {
    try {
      html5QrScanner.resume();
    } catch(e) {}
  }
}

// Direct Checkout Trigger from Table
function triggerDirectCheckOut(ticketId) {
  const item = cloakroomData.find(d => d.id === ticketId);
  if (item) {
    openCheckoutModal(item);
  }
}

// Execute Item Release (Check-Out)
function executeItemRelease() {
  if (!currentTicketForCheckout) return;

  const now = new Date();
  const timeFormatted = formatDateTime(now);

  const idx = cloakroomData.findIndex(d => d.id === currentTicketForCheckout.id);
  if (idx !== -1) {
    cloakroomData[idx].status = 'COMPLETED';
    cloakroomData[idx].checkOutTime = timeFormatted;
    cloakroomData[idx].checkOutTimestamp = now.getTime();
    saveData();
    renderDashboardStats();
    renderTable();

    // Sound and Confetti
    playBeep(1200, 0.2);
    if (window.confetti) {
      confetti({ particleCount: 50, spread: 60 });
    }

    closeCheckoutModal();

    Swal.fire({
      icon: 'success',
      title: 'Barang Berhasil Diserahkan!',
      html: `Tiket <b>${currentTicketForCheckout.id}</b> atas nama <b>${currentTicketForCheckout.name}</b> telah berstatus <b>Sudah Diambil</b>.`,
      confirmButtonColor: '#10b981',
      timer: 3000
    });
  }
}

// Undo Item Release
function undoItemRelease(ticketId) {
  Swal.fire({
    title: 'Kembalikan Status?',
    text: `Ubah status tiket ${ticketId} kembali menjadi "Dititipkan"?`,
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#297810',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Ya, Kembalikan',
    cancelButtonText: 'Batal'
  }).then(result => {
    if (result.isConfirmed) {
      const idx = cloakroomData.findIndex(d => d.id === ticketId);
      if (idx !== -1) {
        cloakroomData[idx].status = 'ACTIVE';
        cloakroomData[idx].checkOutTime = null;
        cloakroomData[idx].checkOutTimestamp = null;
        saveData();
        renderDashboardStats();
        renderTable();

        Swal.fire({
          icon: 'success',
          title: 'Status Diperbarui',
          text: `Tiket ${ticketId} dikembalikan ke status Dititipkan.`,
          timer: 2000,
          showConfirmButton: false
        });
      }
    }
  });
}

// Delete Record
function deleteRecord(ticketId) {
  Swal.fire({
    title: 'Hapus Data Penitipan?',
    text: `Data tiket ${ticketId} akan dihapus secara permanen.`,
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Hapus',
    cancelButtonText: 'Batal'
  }).then(result => {
    if (result.isConfirmed) {
      cloakroomData = cloakroomData.filter(d => d.id !== ticketId);
      deleteRecordFromSupabase(ticketId);
      saveData();
      renderDashboardStats();
      renderTable();
      updateNextTicketBadge();

      Swal.fire({
        icon: 'success',
        title: 'Terhapus',
        text: 'Data berhasil dihapus.',
        timer: 1500,
        showConfirmButton: false
      });
    }
  });
}

// Export Data to CSV
function exportDataCSV() {
  if (cloakroomData.length === 0) {
    Swal.fire({
      icon: 'info',
      title: 'Tidak Ada Data',
      text: 'Belum ada data penitipan untuk diekspor.'
    });
    return;
  }

  const headers = ['No. Tiket', 'Nama Peserta', 'Kategori Lomba', 'Kontak WhatsApp', 'Email Peserta', 'Barang Titipan', 'Lokasi Rak', 'Catatan', 'Status', 'Waktu Dititipkan', 'Waktu Diambil'];
  
  const rows = cloakroomData.map(item => [
    `"${item.id}"`,
    `"${(item.name || '').replace(/"/g, '""')}"`,
    `"${(item.category || '').replace(/"/g, '""')}"`,
    `"${(item.phone || '').replace(/"/g, '""')}"`,
    `"${(item.email || '').replace(/"/g, '""')}"`,
    `"${(item.items || '').replace(/"/g, '""')}"`,
    `"${(item.rack || '').replace(/"/g, '""')}"`,
    `"${(item.notes || '').replace(/"/g, '""')}"`,
    `"${item.status === 'ACTIVE' ? 'DITITIPKAN' : 'SUDAH DIAMBIL'}"`,
    `"${item.checkInTime || ''}"`,
    `"${item.checkOutTime || ''}"`
  ]);

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(e => e.join(','))].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Clear All Data
function clearAllData() {
  Swal.fire({
    title: 'Hapus Semua Data?',
    text: 'Seluruh riwayat penitipan akan dikosongkan. Tindakan ini tidak dapat dibatalkan!',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Ya, Kosongkan Semua',
    cancelButtonText: 'Batal'
  }).then(result => {
    if (result.isConfirmed) {
      isClearingData = true;
      cloakroomData = [];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cloakroomData));
      supabaseRequest('cloakroom_records?id=not.is.null', { method: 'DELETE' }).catch(error => {
        console.error('Supabase clear failed:', error);
      }).finally(() => {
        isClearingData = false;
      });
      saveData();
      renderDashboardStats();
      renderTable();
      updateNextTicketBadge();

      Swal.fire({
        icon: 'success',
        title: 'Dikosongkan',
        text: 'Semua data telah dibersihkan.',
        timer: 1800,
        showConfirmButton: false
      });
    }
  });
}
