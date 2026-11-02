const PARTICIPANT_CONFIG = window.VONEXUS_SUPABASE_CONFIG || {};

document.querySelectorAll('.quick-item').forEach(button => {
  button.addEventListener('click', function () {
    const itemsInput = document.getElementById('participantItems');
    const item = this.dataset.item;
    const currentItems = itemsInput.value
      .split('\n')
      .map(value => value.trim())
      .filter(Boolean);

    const itemIndex = currentItems.findIndex(value =>
      value.toLowerCase() === item.toLowerCase()
    );

    if (itemIndex >= 0) {
      currentItems.splice(itemIndex, 1);
      this.classList.remove('border-[#b8e2b3]', 'bg-[#eaf7e8]', 'text-[#186301]');
    } else {
      currentItems.push(item);
      this.classList.add('border-[#b8e2b3]', 'bg-[#eaf7e8]', 'text-[#186301]');
    }

    itemsInput.value = currentItems.join('\n');
  });
});

function formatParticipantDate(date = new Date()) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${String(date.getDate()).padStart(2, '0')} ${months[date.getMonth()]} ${date.getFullYear()}, ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')} WIB`;
}

async function participantSupabase(path, options = {}) {
  if (!PARTICIPANT_CONFIG.url || !PARTICIPANT_CONFIG.anonKey) {
    throw new Error('Konfigurasi Supabase belum lengkap. Isi anonKey pada supabase-config.js.');
  }

  const response = await fetch(`${PARTICIPANT_CONFIG.url}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: PARTICIPANT_CONFIG.anonKey,
      Authorization: `Bearer ${PARTICIPANT_CONFIG.anonKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.status === 204 ? null : response.json();
}

async function getNextParticipantTicket() {
  const rows = await participantSupabase('cloakroom_records?select=id&order=id.asc');
  let maxNumber = 0;

  rows.forEach(row => {
    const match = String(row.id || '').match(/^(?:TIK-)?(\d+)$/i);
    if (match) maxNumber = Math.max(maxNumber, parseInt(match[1], 10));
  });

  return String(maxNumber + 1).padStart(2, '0');
}

document.getElementById('participantForm').addEventListener('submit', async function (event) {
  event.preventDefault();

  const submitButton = document.getElementById('participantSubmit');
  submitButton.disabled = true;
  submitButton.classList.add('opacity-60');

  try {
    const ticketCode = await getNextParticipantTicket();
    const now = new Date();
    const brand = document.getElementById('participantBrand').value.trim();
    const color = document.getElementById('participantColor').value.trim();
    const itemDetails = document.getElementById('participantItems').value.trim();
    const itemDescriptionParts = [
      itemDetails,
      brand ? `Merk: ${brand}` : '',
      color ? `Warna: ${color}` : ''
    ].filter(Boolean);
    const record = {
      id: ticketCode,
      name: document.getElementById('participantName').value.trim(),
      category: document.getElementById('participantCategory').value,
      phone: document.getElementById('participantPhone').value.trim() || '-',
      email: document.getElementById('participantEmail').value.trim().toLowerCase(),
      items: itemDescriptionParts.join(' | '),
      rack: document.getElementById('participantRack').value.trim() || 'Umum',
      notes: document.getElementById('participantNotes').value.trim() || '-',
      status: 'ACTIVE',
      checkInTime: formatParticipantDate(now),
      checkInTimestamp: now.getTime(),
      checkOutTime: null,
      checkOutTimestamp: null
    };

    await participantSupabase('cloakroom_records?on_conflict=id', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify([{ id: record.id, data: record, updated_at: now.toISOString() }])
    });

    document.getElementById('participantTicketCode').textContent = ticketCode;
    document.getElementById('participantQr').innerHTML = '';
    new QRCode(document.getElementById('participantQr'), {
      text: ticketCode,
      width: 180,
      height: 180
    });

    const ticket = document.getElementById('participantTicket');
    ticket.classList.remove('hidden');
    ticket.classList.add('flex');
    this.reset();
    document.querySelectorAll('.quick-item').forEach(button => {
      button.classList.remove('border-[#b8e2b3]', 'bg-[#eaf7e8]', 'text-[#186301]');
    });
  } catch (error) {
    Swal.fire({
      icon: 'error',
      title: 'Data Belum Tersimpan',
      text: error.message,
      confirmButtonColor: '#186301'
    });
  } finally {
    submitButton.disabled = false;
    submitButton.classList.remove('opacity-60');
  }
});
