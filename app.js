/**
 * DIGITAL CLOAKROOM & REGISTRATION SYSTEM (Sistem Penitipan Barang Digital)
 * PCC Event - Organisasi & UKM
 */

// Storage Keys
const STORAGE_KEY = 'PCC_CLOAKROOM_DATA_V1';
const EMAILJS_CONFIG_KEY = 'PCC_EMAILJS_CONFIG_V1';

// Global State
let cloakroomData = [];
let currentFilterStatus = 'all';
let html5QrScanner = null;
let currentActiveTicketForReceipt = null;
let currentTicketForCheckout = null;

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

// Sample Initial Demo Data
const SAMPLE_DATA = [
  {
    id: "TIK-001",
    name: "Ahmad Farhan",
    category: "Web Design",
    phone: "081234567891",
    email: "farhan.dev@gmail.com",
    items: "Tas Ransel Eiger Hitam + Tumbler Biru",
    rack: "Rak A-01",
    notes: "Ada laptop di dalam ransel",
    status: "ACTIVE",
    checkInTime: "01 Nov 2026, 08:15 WIB",
    checkInTimestamp: Date.now() - 3600000 * 3,
    checkOutTime: null,
    checkOutTimestamp: null
  },
  {
    id: "TIK-002",
    name: "Siti Rahmawati",
    category: "UI/UX Design",
    phone: "085712345678",
    email: "rahma.siti@gmail.com",
    items: "Tote Bag Putih Kanvas + Payung Lipat",
    rack: "Rak A-02",
    notes: "Barang pakaian dan dokumen",
    status: "ACTIVE",
    checkInTime: "01 Nov 2026, 08:30 WIB",
    checkInTimestamp: Date.now() - 3600000 * 2.5,
    checkOutTime: null,
    checkOutTimestamp: null
  },
  {
    id: "TIK-003",
    name: "Dwi Prasetyo",
    category: "Competitive Programming",
    phone: "089698765432",
    email: "dwiprasetyo@yahoo.com",
    items: "Tas Selempang Abu-abu",
    rack: "Loker B-05",
    notes: "Charger & Jaket Hoodie",
    status: "COMPLETED",
    checkInTime: "01 Nov 2026, 07:45 WIB",
    checkInTimestamp: Date.now() - 3600000 * 4,
    checkOutTime: "01 Nov 2026, 11:20 WIB",
    checkOutTimestamp: Date.now() - 3600000 * 1
  }
];

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

  loadData();
  initLiveClock();
  updateNextTicketBadge();
  initCameraList();
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
      cloakroomData = [...SAMPLE_DATA];
      saveData();
    }
  } else {
    // If first time visit, populate with sample data
    cloakroomData = [...SAMPLE_DATA];
    saveData();
  }
  renderDashboardStats();
  renderTable();
  updateNextTicketBadge();
}

// Save Data to LocalStorage
function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(cloakroomData));
}

// Next Ticket Code Generator (TIK-001, TIK-002, etc.)
function getNextTicketCode() {
  if (!cloakroomData || cloakroomData.length === 0) {
    return 'TIK-001';
  }
  let maxNumber = 0;
  cloakroomData.forEach(item => {
    if (item.id && typeof item.id === 'string') {
      const match = item.id.match(/^TIK-(\d+)$/i);
      if (match) {
        const num = parseInt(match[1], 10);
        if (num > maxNumber) maxNumber = num;
      }
    }
  });
  const nextNumber = maxNumber + 1;
  return `TIK-${String(nextNumber).padStart(3, '0')}`;
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
    btn.classList.remove('bg-white', 'text-sky-600', 'shadow-sm');
    btn.classList.add('text-slate-600');
  });
  const activeDesktopBtn = document.getElementById(`nav-${tabId}`);
  if (activeDesktopBtn) {
    activeDesktopBtn.classList.add('bg-white', 'text-sky-600', 'shadow-sm');
    activeDesktopBtn.classList.remove('text-slate-600');
  }

  // Update Mobile Tab Buttons
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => {
    btn.classList.remove('text-sky-600', 'font-bold');
    btn.classList.add('text-slate-500');
  });
  const activeMobileBtn = document.getElementById(`mobile-nav-${tabId}`);
  if (activeMobileBtn) {
    activeMobileBtn.classList.add('text-sky-600', 'font-bold');
    activeMobileBtn.classList.remove('text-slate-500');
  }

  // Scanner lifecycle management
  if (tabId === 'scanner') {
    updateQuickTestDropdown();
    if (window.location.protocol !== 'file:') {
      startScanner();
    }
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
  
  if (currentVal.length === 0) {
    inputEl.value = itemName;
  } else {
    // Check if already contains
    if (currentVal.toLowerCase().includes(itemName.toLowerCase())) {
      // Remove it
      const parts = currentVal.split(',').map(s => s.trim()).filter(s => s.toLowerCase() !== itemName.toLowerCase() && s.length > 0);
      inputEl.value = parts.join(', ');
    } else {
      // Append it
      inputEl.value = `${currentVal}, ${itemName}`;
    }
  }
}

// Reset Check-in Form
function resetCheckInForm() {
  document.getElementById('checkInForm').reset();
  updateNextTicketBadge();
}

// Handle Check-In Form Submission
function handleCheckInSubmit(event) {
  event.preventDefault();

  const nama = document.getElementById('inputNama').value.trim();
  const kategori = document.getElementById('inputKategori').value;
  const kontak = document.getElementById('inputKontak').value.trim() || '-';
  const email = document.getElementById('inputEmail').value.trim() || '-';
  const barang = document.getElementById('inputBarang').value.trim();
  const rak = document.getElementById('inputLokasiRak').value.trim() || 'Umum';
  const catatan = document.getElementById('inputCatatan').value.trim() || '-';
  const autoSendPdf = document.getElementById('autoSendPdfCheckbox') ? document.getElementById('autoSendPdfCheckbox').checked : true;

  if (!nama || !kategori || !barang) {
    Swal.fire({
      icon: 'warning',
      title: 'Data Belum Lengkap',
      text: 'Harap isi Nama Peserta, Kategori Lomba, dan Rincian Barang.',
      confirmButtonColor: '#0284c7'
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

  // If Auto Send PDF is checked
  if (autoSendPdf) {
    setTimeout(() => {
      // Auto download PDF receipt
      generateTicketPDF(newRecord, true);

      // If email provided, send email
      if (email && email !== '-') {
        sendTicketToEmail(newRecord, false);
      }
    }, 600);
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
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200 badge-pulse">
           <i class="fa-solid fa-clock"></i> Dititipkan
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
           <i class="fa-solid fa-check"></i> Sudah Diambil
         </span>`;

    const actionButton = isActive
      ? `<button onclick="triggerDirectCheckOut('${item.id}')" title="Serahkan Barang" class="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition shadow-sm">
           <i class="fa-solid fa-hand-holding-hand"></i> Serahkan
         </button>`
      : `<button onclick="undoItemRelease('${item.id}')" title="Batalkan / Kembalikan ke Dititipkan" class="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-lg text-xs font-medium flex items-center gap-1 transition">
           <i class="fa-solid fa-rotate-left"></i> Batal Ambil
         </button>`;

    tableHtml += `
      <tr class="hover:bg-slate-50/80 transition">
        <td class="py-3 px-4 font-mono font-bold text-sky-700 whitespace-nowrap">
          ${item.id}
        </td>
        <td class="py-3 px-4">
          <div class="font-bold text-slate-800">${item.name}</div>
          <div class="text-[11px] text-slate-500 flex flex-wrap items-center gap-1.5">
            <span class="text-sky-600 font-semibold">${item.category}</span>
            ${item.phone && item.phone !== '-' ? `<span>• <i class="fa-brands fa-whatsapp text-emerald-600"></i> ${item.phone}</span>` : ''}
            ${item.email && item.email !== '-' ? `<span>• <i class="fa-solid fa-envelope text-sky-500"></i> ${item.email}</span>` : ''}
          </div>
        </td>
        <td class="py-3 px-4 max-w-xs">
          <p class="font-medium text-slate-700 line-clamp-2">${item.items}</p>
          ${item.notes && item.notes !== '-' ? `<span class="text-[10px] text-slate-400 italic">Catatan: ${item.notes}</span>` : ''}
        </td>
        <td class="py-3 px-4 whitespace-nowrap">
          <span class="inline-block px-2 py-0.5 rounded-md text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200">
            ${item.rack || 'Umum'}
          </span>
        </td>
        <td class="py-3 px-4 whitespace-nowrap text-[11px] text-slate-500 font-mono">
          <div><i class="fa-solid fa-arrow-down text-amber-500 mr-1"></i> ${item.checkInTime}</div>
          ${item.checkOutTime ? `<div><i class="fa-solid fa-arrow-up text-emerald-500 mr-1"></i> ${item.checkOutTime}</div>` : ''}
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          ${statusBadge}
        </td>
        <td class="py-3 px-4 text-center whitespace-nowrap">
          <div class="flex items-center justify-center gap-1.5">
            <button onclick="viewTicketReceipt('${item.id}')" title="Lihat & Cetak Tiket" class="p-2 text-slate-500 hover:text-sky-600 hover:bg-sky-50 rounded-lg transition">
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
      ? `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
           <i class="fa-solid fa-clock"></i> Dititipkan
         </span>`
      : `<span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
           <i class="fa-solid fa-check"></i> Sudah Diambil
         </span>`;

    cardHtml += `
      <div class="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm space-y-3">
        <div class="flex items-center justify-between">
          <span class="font-mono text-base font-extrabold text-sky-600">${item.id}</span>
          ${statusBadge}
        </div>
        
        <div>
          <h4 class="font-bold text-slate-900 text-sm">${item.name}</h4>
          <p class="text-xs text-sky-700 font-medium">${item.category}</p>
        </div>

        <div class="p-2.5 bg-slate-50 rounded-xl text-xs space-y-1 text-slate-700">
          <div><strong class="text-slate-500">Barang:</strong> ${item.items}</div>
          <div class="flex justify-between">
            <span><strong class="text-slate-500">Rak:</strong> ${item.rack || '-'}</span>
            <span class="font-mono text-[11px] text-slate-500">${item.checkInTime}</span>
          </div>
          ${item.checkOutTime ? `<div class="text-emerald-700 font-semibold"><strong class="text-slate-500">Diambil:</strong> ${item.checkOutTime}</div>` : ''}
        </div>

        <div class="flex items-center gap-2 pt-1">
          <button onclick="viewTicketReceipt('${item.id}')" class="flex-1 py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition">
            <i class="fa-solid fa-qrcode"></i> Tiket QR
          </button>
          ${isActive ? `
            <button onclick="triggerDirectCheckOut('${item.id}')" class="flex-1 py-2 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition shadow-sm">
              <i class="fa-solid fa-hand-holding-hand"></i> Serahkan
            </button>
          ` : `
            <button onclick="undoItemRelease('${item.id}')" class="py-2 px-3 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-xl text-xs font-medium transition">
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
  
  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text: textToEncode,
      width: size,
      height: size,
      colorDark: "#000000",
      colorLight: "#ffffff",
      correctLevel: QRCode.CorrectLevel.M // Medium level = larger blocks, scans 10x faster & easier!
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

  const statusBadge = document.getElementById('modalTicketStatusBadge');
  if (record.status === 'ACTIVE') {
    statusBadge.className = 'inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-amber-100 text-amber-800';
    statusBadge.textContent = 'DITITIPKAN';
  } else {
    statusBadge.className = 'inline-block text-[11px] font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800';
    statusBadge.textContent = 'SUDAH DIAMBIL';
  }

  // QR Code payload: Encode Ticket ID directly (e.g. TIK-001) for maximum scan clarity & speed!
  const qrPayload = record.id;

  renderQRCodeImage('qrcodeContainer', qrPayload, 170);

  // Also prepare printable container
  document.getElementById('printTicketCode').textContent = record.id;
  document.getElementById('printTicketName').textContent = record.name;
  document.getElementById('printTicketCategory').textContent = record.category;
  document.getElementById('printTicketPhone').textContent = record.phone || '-';
  document.getElementById('printTicketItems').textContent = record.items;
  document.getElementById('printTicketRack').textContent = record.rack || 'Umum';
  document.getElementById('printTicketTime').textContent = record.checkInTime;
  renderQRCodeImage('printQrCodeContainer', qrPayload, 140);

  // Also prepare PDF container
  const pdfQrEl = document.getElementById('pdfQrContainer');
  if (pdfQrEl) {
    renderQRCodeImage('pdfQrContainer', qrPayload, 130);
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

// Get EmailJS configuration from LocalStorage
function getEmailJSConfig() {
  try {
    const raw = localStorage.getItem(EMAILJS_CONFIG_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function openEmailConfigModal() {
  const config = getEmailJSConfig();
  if (config) {
    document.getElementById('emailjsServiceId').value = config.serviceId || '';
    document.getElementById('emailjsTemplateId').value = config.templateId || '';
    document.getElementById('emailjsPublicKey').value = config.publicKey || '';
  }
  document.getElementById('emailConfigModal').classList.remove('hidden');
}

function closeEmailConfigModal() {
  document.getElementById('emailConfigModal').classList.add('hidden');
}

function saveEmailConfig(event) {
  event.preventDefault();
  const serviceId = document.getElementById('emailjsServiceId').value.trim();
  const templateId = document.getElementById('emailjsTemplateId').value.trim();
  const publicKey = document.getElementById('emailjsPublicKey').value.trim();

  if (!serviceId || !templateId || !publicKey) {
    Swal.fire({
      icon: 'warning',
      title: 'Data Belum Lengkap',
      text: 'Harap isi Service ID, Template ID, dan Public Key akun EmailJS Anda.',
      confirmButtonColor: '#0284c7'
    });
    return;
  }

  localStorage.setItem(EMAILJS_CONFIG_KEY, JSON.stringify({ serviceId, templateId, publicKey }));
  closeEmailConfigModal();

  Swal.fire({
    icon: 'success',
    title: 'Pengaturan Email Disimpan!',
    text: 'Struk PDF digital kini akan dikirimkan otomatis ke email peserta.',
    timer: 2500,
    showConfirmButton: false
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
    title: 'Tes Pengiriman Email',
    input: 'email',
    inputLabel: 'Masukkan alamat email penerima tes:',
    inputPlaceholder: 'emailAnda@example.com',
    showCancelButton: true,
    confirmButtonText: 'Kirim Tes',
    cancelButtonText: 'Batal',
    confirmButtonColor: '#0284c7',
    showLoaderOnConfirm: true,
    preConfirm: (targetEmail) => {
      if (!targetEmail) {
        Swal.showValidationMessage('Email tidak boleh kosong');
        return false;
      }
      return emailjs.send(serviceId, templateId, {
        to_email: targetEmail,
        to_name: "Peserta Uji Coba",
        ticket_code: "TIK-TEST",
        category: "Uji Coba Sistem",
        phone: "08123456789",
        items: "Barang Pengujian",
        rack: "Rak Tes",
        check_in_time: formatDateTime(new Date()),
        notes: "Pengujian integrasi EmailJS"
      }, publicKey);
    }
  }).then((result) => {
    if (result.isConfirmed) {
      Swal.fire({
        icon: 'success',
        title: 'Berhasil Terkirim!',
        text: 'Email uji coba berhasil dikirim. Periksa inbox/spam email Anda.',
        confirmButtonColor: '#10b981'
      });
    }
  }).catch((err) => {
    console.error('EmailJS test send error:', err);
    Swal.fire({
      icon: 'error',
      title: 'Pengiriman Gagal',
      text: 'Pastikan Service ID, Template ID, dan Public Key sudah benar serta Template di EmailJS memiliki variabel {{to_email}}.',
      confirmButtonColor: '#0284c7'
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
  renderQRCodeImage('pdfQrContainer', target.id, 130);

  const element = document.getElementById('pdfReceiptContainer');
  const filename = `Struk_Penitipan_${target.id}_${(target.name || 'Peserta').replace(/\s+/g, '_')}.pdf`;

  const opt = {
    margin: [6, 6, 6, 6],
    filename: filename,
    image: { type: 'jpeg', quality: 0.98 },
    html2canvas: { scale: 2.2, useCORS: true, logging: false },
    jsPDF: { unit: 'mm', format: 'a5', orientation: 'portrait' }
  };

  if (typeof html2pdf !== 'undefined') {
    if (shouldDownload) {
      return html2pdf().set(opt).from(element).save();
    } else {
      return html2pdf().set(opt).from(element).outputPdf('datauristring');
    }
  } else {
    console.warn('html2pdf library is not loaded');
    return Promise.resolve(null);
  }
}

// Trigger PDF Download from Modal or Table
function downloadTicketPDF(ticketId = null) {
  const target = ticketId ? cloakroomData.find(d => d.id === ticketId) : currentActiveTicketForReceipt;
  if (target) {
    generateTicketPDF(target, true);
  }
}

// Send Ticket Receipt to Participant Email
function sendTicketToEmail(record, showPromptIfNoConfig = true) {
  const target = record || currentActiveTicketForReceipt;
  if (!target) return;

  // If email not provided, prompt for email
  if (!target.email || target.email === '-') {
    Swal.fire({
      title: 'Kirim Struk ke Email',
      input: 'email',
      inputLabel: 'Masukkan alamat email peserta:',
      inputPlaceholder: 'peserta@example.com',
      showCancelButton: true,
      confirmButtonText: 'Kirim Struk',
      cancelButtonText: 'Batal',
      confirmButtonColor: '#0284c7'
    }).then(res => {
      if (res.isConfirmed && res.value) {
        target.email = res.value;
        saveData();
        renderTable();
        const modalEmail = document.getElementById('modalTicketEmail');
        if (modalEmail) modalEmail.textContent = target.email;
        sendTicketToEmail(target, true);
      }
    });
    return;
  }

  const config = getEmailJSConfig();

  // If EmailJS is properly configured, send directly in the background
  if (config && config.serviceId && config.templateId && config.publicKey && typeof emailjs !== 'undefined') {
    Swal.fire({
      title: 'Mengirim Email...',
      text: `Mengirimkan struk resmi ke ${target.email}`,
      allowOutsideClick: false,
      didOpen: () => {
        Swal.showLoading();
      }
    });

    const templateParams = {
      to_email: target.email,
      to_name: target.name,
      ticket_code: target.id,
      category: target.category,
      phone: target.phone || '-',
      items: target.items,
      rack: target.rack || 'Umum',
      check_in_time: target.checkInTime,
      notes: target.notes || '-'
    };

    emailjs.send(config.serviceId, config.templateId, templateParams, config.publicKey)
      .then(() => {
        Swal.fire({
          icon: 'success',
          title: 'Email Berhasil Terkirim!',
          html: `Struk bukti penitipan tiket <b>${target.id}</b> telah terkirim ke <b>${target.email}</b>. Berkas PDF juga otomatis diunduh.`,
          confirmButtonColor: '#10b981',
          timer: 3500
        });
      })
      .catch(err => {
        console.error('EmailJS Send Error:', err);
        fallbackEmailClient(target);
      });
  } else {
    // If EmailJS is not configured yet and prompt is enabled
    if (showPromptIfNoConfig) {
      fallbackEmailClient(target);
    }
  }
}

// Fallback to default email client (mailto) & explain PDF
function fallbackEmailClient(target) {
  const subject = encodeURIComponent(`[PCC CLOAKROOM] Bukti Penitipan Barang - Tiket ${target.id} (${target.name})`);
  const body = encodeURIComponent(
    `Halo ${target.name},\n\n` +
    `Terima kasih telah menitipkan barang Anda di PCC Cloakroom.\n` +
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
    `Panitia PCC Event`
  );

  Swal.fire({
    icon: 'info',
    title: 'Kirim Struk ke Email',
    html: `
      <div class="text-left text-xs space-y-2">
        <p>Struk PDF <b>Struk_Penitipan_${target.id}.pdf</b> telah otomatis terunduh di perangkat Anda.</p>
        <p>Untuk mengirimkan langsung ke <b>${target.email}</b>:</p>
        <div class="p-2.5 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
          <p class="font-bold text-slate-700">Pilihan 1: Buka Aplikasi Email</p>
          <p class="text-[11px] text-slate-500">Klik tombol di bawah untuk membuka aplikasi email (Gmail / Outlook) dengan draf pesan otomatis.</p>
        </div>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: '<i class="fa-solid fa-paper-plane mr-1.5"></i> Buka Aplikasi Email',
    cancelButtonText: 'Selesai',
    confirmButtonColor: '#0284c7'
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
    `*BUKTI RESMI PENITIPAN BARANG DIGITAL - PCC EVENT*\n\n` +
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
        option.text = device.label || `Kamera ${index + 1}`;
        select.appendChild(option);
      });
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

function startScanner() {
  const laser = document.getElementById('scannerLaser');
  const placeholder = document.getElementById('scannerPlaceholder');
  const btnStart = document.getElementById('btnStartScan');
  const btnStop = document.getElementById('btnStopScan');
  const cameraSelect = document.getElementById('cameraSelect');

  if (html5QrScanner && html5QrScanner.isScanning) {
    return;
  }

  if (!html5QrScanner) {
    html5QrScanner = new Html5Qrcode("qr-reader");
  }

  const cameraId = (cameraSelect && cameraSelect.value) ? cameraSelect.value : { facingMode: "environment" };

  const config = {
    fps: 15,
    qrbox: function(viewfinderWidth, viewfinderHeight) {
      const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
      const edge = Math.floor(minEdge * 0.75);
      return { width: edge, height: edge };
    },
    aspectRatio: 1.0,
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
  }).catch(err => {
    console.error('Error starting html5QrScanner', err);
    Swal.fire({
      icon: 'warning',
      title: 'Akses Kamera Terkendala',
      html: `
        <div class="text-left text-xs space-y-2">
          <p>Jika Anda membuka file ini langsung (<code>file://</code>), browser membatasi izin kamera.</p>
          <p><b>Solusi Mudah:</b></p>
          <ul class="list-disc pl-4 space-y-1">
            <li>Gunakan tombol <b>"Scan Foto QR"</b> untuk memilih gambar QR dari laptop/HP Anda.</li>
            <li>Gunakan fitur <b>"Simulasi Cepat"</b> di bawah untuk tes tanpa kamera.</li>
            <li>Buka melalui localhost (VS Code Live Server).</li>
          </ul>
        </div>
      `,
      confirmButtonColor: '#0284c7'
    });
  });
}

function stopScanner() {
  const laser = document.getElementById('scannerLaser');
  const placeholder = document.getElementById('scannerPlaceholder');
  const btnStart = document.getElementById('btnStartScan');
  const btnStop = document.getElementById('btnStopScan');

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
        confirmButtonColor: '#0284c7'
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
      confirmButtonColor: '#0284c7'
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

  // Extract Ticket ID: Could be JSON `{"ticket":"TIK-001"}` or plain `TIK-001`
  let targetTicketId = decodedText.trim();
  try {
    const parsed = JSON.parse(decodedText);
    if (parsed && parsed.ticket) {
      targetTicketId = parsed.ticket;
    }
  } catch (e) {
    // Plain string format
  }

  // Normalize ticket code
  const match = targetTicketId.match(/TIK-\d+/i);
  if (match) {
    targetTicketId = match[0].toUpperCase();
  }

  const foundItem = cloakroomData.find(item => item.id.toUpperCase() === targetTicketId.toUpperCase());

  if (!foundItem) {
    Swal.fire({
      icon: 'error',
      title: 'Tiket Tidak Ditemukan',
      text: `Nomor tiket "${targetTicketId}" tidak terdaftar di sistem.`,
      confirmButtonColor: '#0284c7'
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

  const match = inputVal.match(/TIK-\d+/i);
  const searchCode = match ? match[0].toUpperCase() : inputVal.toUpperCase();

  const foundItem = cloakroomData.find(item => 
    item.id.toUpperCase() === searchCode ||
    item.name.toLowerCase().includes(inputVal.toLowerCase())
  );

  if (!foundItem) {
    Swal.fire({
      icon: 'error',
      title: 'Data Tidak Ditemukan',
      text: `Tidak ditemukan titipan dengan kode/nama: "${inputVal}".`,
      confirmButtonColor: '#0284c7'
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
    badgeContainer.innerHTML = `<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
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
    confirmButtonColor: '#0284c7',
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
  link.setAttribute('download', `Rekap_Penitipan_PCC_${new Date().toISOString().slice(0, 10)}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// Load Demo Sample Data
function loadSampleData() {
  Swal.fire({
    title: 'Muat Data Contoh?',
    text: 'Data contoh akan ditambahkan ke dalam daftar penitipan.',
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#0284c7',
    cancelButtonColor: '#64748b',
    confirmButtonText: 'Muat Contoh',
    cancelButtonText: 'Batal'
  }).then(result => {
    if (result.isConfirmed) {
      cloakroomData = [...SAMPLE_DATA];
      saveData();
      renderDashboardStats();
      renderTable();
      updateNextTicketBadge();

      Swal.fire({
        icon: 'success',
        title: 'Berhasil',
        text: 'Data contoh berhasil dimuat.',
        timer: 1800,
        showConfirmButton: false
      });
    }
  });
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
      cloakroomData = [];
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
