const PARTICIPANT_CONFIG = window.VONEXUS_SUPABASE_CONFIG || {};
const PARTICIPANT_EMAIL_CONFIG_KEY = 'PCC_EMAIL_CONFIG_V2';
const PARTICIPANT_LEGACY_EMAIL_CONFIG_KEY = 'PCC_EMAILJS_CONFIG_V1';
const PARTICIPANT_DEFAULT_EMAIL_CONFIG = {
  provider: 'emailjs',
  gasUrl: '',
  emailjs: {
    serviceId: 'service_koorlap',
    templateId: 'template_vonexus',
    publicKey: 'vyV-uoZw2LAOOKupU'
  }
};

function getParticipantEmailConfig() {
  try {
    const stored = localStorage.getItem(PARTICIPANT_EMAIL_CONFIG_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      const provider = parsed.provider || 'emailjs';
      const candidate = {
        provider,
        gasUrl: parsed.gasUrl?.trim() || '',
        emailjs: {
          serviceId: parsed.emailjs?.serviceId || '',
          templateId: parsed.emailjs?.templateId || '',
          publicKey: parsed.emailjs?.publicKey || ''
        }
      };

      if (provider === 'emailjs' &&
        candidate.emailjs.serviceId &&
        candidate.emailjs.templateId &&
        candidate.emailjs.publicKey) {
        return candidate;
      }
      if (provider === 'gas' && candidate.gasUrl) {
        return candidate;
      }
    }

    const legacy = localStorage.getItem(PARTICIPANT_LEGACY_EMAIL_CONFIG_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (parsed.serviceId && parsed.templateId && parsed.publicKey) {
        return {
          provider: 'emailjs',
          gasUrl: '',
          emailjs: parsed
        };
      }
    }
  } catch (error) {
    console.warn('Gagal membaca konfigurasi email:', error);
  }
  return PARTICIPANT_DEFAULT_EMAIL_CONFIG;
}

function formatParticipantTicketNumber(ticketCode) {
  const match = String(ticketCode).match(/^(?:TIK-)?(\d+)$/i);
  return match ? String(parseInt(match[1], 10)).padStart(2, '0') : String(ticketCode);
}

function buildParticipantEmailParams(record, qrCodeUrl) {
  const email = record.email.trim().toLowerCase();
  return {
    to_email: email,
    email,
    participant_email: email,
    recipient_email: email,
    user_email: email,
    to_name: record.name,
    name: record.name,
    title: `Struk Penitipan #${record.id}`,
    ticket_code: record.id,
    ticket_number: formatParticipantTicketNumber(record.id),
    category: record.category,
    phone: record.phone || '-',
    items: record.items,
    rack: record.rack || 'Umum',
    check_in_time: record.checkInTime,
    qr_code_url: qrCodeUrl,
    notes: record.notes || '-'
  };
}

async function sendParticipantTicketEmail(record) {
  const config = getParticipantEmailConfig();
  const qrCodeUrl = `https://api.qrserver.com/v1/create-qr-code/?size=400x400&qzone=4&ecc=M&data=${encodeURIComponent(record.id)}`;
  const emailStatus = document.getElementById('participantEmailStatus');

  if (config.provider === 'emailjs') {
    const emailjsConfig = config.emailjs;
    if (!emailjsConfig.serviceId || !emailjsConfig.templateId || !emailjsConfig.publicKey) {
      throw new Error('Pengaturan EmailJS belum lengkap di dashboard panitia.');
    }
    if (typeof emailjs === 'undefined') {
      throw new Error('Library EmailJS belum siap.');
    }
    emailjs.init({ publicKey: emailjsConfig.publicKey });
    await emailjs.send(
      emailjsConfig.serviceId,
      emailjsConfig.templateId,
      buildParticipantEmailParams(record, qrCodeUrl),
      { publicKey: emailjsConfig.publicKey }
    );
  } else {
    if (!config.gasUrl) {
      throw new Error('URL Google Apps Script belum diatur di dashboard panitia.');
    }
    await fetch(config.gasUrl, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        ...buildParticipantEmailParams(record, qrCodeUrl),
        to_name: record.name,
        check_in_time: record.checkInTime
      })
    });
  }

  if (emailStatus) {
    emailStatus.className = 'mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700';
    emailStatus.textContent = `Struk dan kode QR berhasil dikirim ke ${record.email}.`;
    emailStatus.classList.remove('hidden');
  }
}

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
  if (response.status === 204) return null;

  const responseText = await response.text();
  if (!responseText.trim()) return null;

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new Error('Respons Supabase tidak valid. Periksa aturan akses tabel cloakroom_records.');
  }
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

    try {
      if ('BroadcastChannel' in window) {
        const participantChannel = new BroadcastChannel('vonexus-cloakroom');
        participantChannel.postMessage({ type: 'record-added', ticketId: record.id });
        participantChannel.close();
      }
      localStorage.setItem('PCC_CLOAKROOM_LAST_UPDATE_V1', String(now.getTime()));
    } catch (signalError) {
      console.warn('Gagal mengirim sinyal pembaruan dashboard:', signalError);
    }

    if (document.getElementById('participantAutoSendEmail').checked) {
      const emailStatus = document.getElementById('participantEmailStatus');
      if (emailStatus) {
        emailStatus.className = 'mt-3 rounded-xl bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700';
        emailStatus.textContent = 'Mengirim struk dan kode QR ke email...';
        emailStatus.classList.remove('hidden');
      }
      try {
        await sendParticipantTicketEmail(record);
      } catch (emailError) {
        try {
          const pendingKey = 'PCC_PENDING_EMAILS_V1';
          const pending = JSON.parse(localStorage.getItem(pendingKey) || '[]');
          if (!pending.includes(record.id)) {
            pending.push(record.id);
            localStorage.setItem(pendingKey, JSON.stringify(pending));
          }
        } catch (queueError) {
          console.warn('Gagal menyimpan antrean email:', queueError);
        }
        if (emailStatus) {
          emailStatus.className = 'mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700';
          const emailErrorDetail = emailError?.text || emailError?.message || 'Pengiriman EmailJS ditolak atau koneksi tidak tersedia.';
          emailStatus.textContent = `Data tersimpan, tetapi email gagal dikirim: ${emailErrorDetail}`;
          emailStatus.classList.remove('hidden');
        }
      }
    }

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
