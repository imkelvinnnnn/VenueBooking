
/* Venue Desk admin SPA — requires the matching Code.gs deployment.
 * Keep this URL synced with your CURRENT Apps Script Web App deployment.
 */
const API_URL = 'https://script.google.com/macros/s/AKfycby12gKfymyAJPgXuZA6Z--R1SdZxAOlhZzOsAowZdLuQGfRU1RFhwJP83E2ZUqrqmVmxg/exec';
const TOKEN_KEY = 'venueDeskAdminToken';
const DEFAULT_VENUES = ['Main Hall', 'Chapel', 'Fellowship Room', 'Prayer Room', 'Youth Hall'];
const el = id => document.getElementById(id);
const val = id => el(id)?.value?.trim() || '';
const setText = (id, txt, state = '') => { const node = el(id); if (node) { node.textContent = txt; node.dataset.state = state; } };
const htmlEscape = value => String(value ?? '').replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[x]));
const localDate = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const localDateTime = date => new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
const formatDate = date => date ? date.toLocaleString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Not specified';
const slotTime = date => date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
const lower = x => String(x ?? '').toLowerCase();
let token = sessionStorage.getItem(TOKEN_KEY) || '';
let allBookings = [];
let venues = [];
let blockedRules = [];
let sortState = { col: 'start', dir: 'asc' };
let busyBookings = new Set();
let loading = false;

/* Authenticated transport. No Admin action is sent through public doPost. */
async function request(data) {
  let res;
  try { res = await fetch(API_URL, { method: 'POST', body: JSON.stringify(data), redirect: 'follow', cache: 'no-store' }); }
  catch (err) { throw new Error('Cannot reach Apps Script. Verify deployment URL and network access. ' + err.message); }
  if (!res.ok) throw new Error(`API returned HTTP ${res.status}`);
  let json;
  try { json = await res.json(); } catch (e) { throw new Error('API did not return JSON. Check deployment and permissions.'); }
  if (json?.success === false) throw new Error(json.message || json.error || 'The request was rejected.');
  return json;
}
async function publicGet(action, params = {}) {
  const url = new URL(API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data?.success === false) throw new Error(data.error || data.message || 'Request failed');
  return data;
}
async function rpc(command, payload = {}) {
  if (!token) throw new Error('Please sign in.');
  try { return await request({ action: 'adminRpc', token, command, payload }); }
  catch (err) { if (/session expired|unauthorized|please log in/i.test(err.message)) showLogin('Session expired. Sign in again.'); throw err; }
}
function showLogin(message = '') {
  token = ''; sessionStorage.removeItem(TOKEN_KEY);
  el('loginView').hidden = false; el('dashboard').hidden = true;
  el('logoutBtn').hidden = true; el('navLinks').hidden = true;
  setText('loginMessage', message, message ? 'error' : '');
}
function showDashboard() {
  el('loginView').hidden = true; el('dashboard').hidden = false;
  el('logoutBtn').hidden = false; el('navLinks').hidden = false;
}
el('loginForm').addEventListener('submit', async e => {
  e.preventDefault(); const btn = el('loginBtn'); btn.disabled = true;
  setText('loginMessage', 'Signing in…');
  try {
    const data = await request({ action: 'adminLogin', username: val('loginUsername'), password: el('loginPassword').value });
    token = data.token; sessionStorage.setItem(TOKEN_KEY, token);
    el('loginPassword').value = ''; showDashboard(); await loadEverything();
  } catch (err) { setText('loginMessage', err.message, 'error'); }
  finally { btn.disabled = false; }
});
el('logoutBtn').addEventListener('click', async () => {
  const old = token; showLogin();
  try { await request({ action: 'adminRpc', token: old, command: 'logout', payload: {} }); } catch (_) {/* local logout is already done */ }
});

function normalizeBooking(row) {
  const start = row.start ? new Date(row.start) : null;
  const end = row.end ? new Date(row.end) : null;
  return {
    id: String(row.id || ''), ref: String(row.id || ''),
    name: String(row.name || ''), memberCode: String(row.memberCode || ''),
    email: String(row.email || ''), phone: String(row.phone || ''),
    title: String(row.eventTitle || 'Untitled event'), venue: String(row.location || ''),
    notes: String(row.notes || ''), start: start && !isNaN(start) ? start : null, end: end && !isNaN(end) ? end : null,
    duration: Number(row.duration || 1), status: lower(row.status || 'Pending'),
    bookingType: lower(row.bookingType || 'normalbooking')
  };
}

async function loadVenues() {
  try {
    const data = await publicGet('getVenues');

    // Accept array responses from Google Apps Script.
    const venueList = Array.isArray(data)
      ? data
      : Array.isArray(data.venues)
        ? data.venues
        : null;

    if (!venueList) {
      throw new Error('Invalid venues response from Google Sheets.');
    }

    // Preserve the exact venue names and order in Google Sheets.
    venues = [...new Set(
      venueList
        .map(item => {
          if (typeof item === 'string') return item.trim();
          return String(
            item.name || item.venue || item.location || ''
          ).trim();
        })
        .filter(Boolean)
    )];

    if (venues.length === 0) {
      throw new Error('No venues found in Google Sheets.');
    }

    // Populate all venue dropdowns dynamically.
    const selectors = [
      ['normalVenue', 'Select venue'],
      ['recurringVenue', 'Select venue'],
      ['filterVenue', 'All venues'],
      ['blockVenue', 'All venues'],
      ['editLocation', 'Select venue']
    ];

    for (const [id, placeholder] of selectors) {
      const select = el(id);
      if (!select) continue;

      const previousValue = select.value;

      select.innerHTML =
        `<option value="">${htmlEscape(placeholder)}</option>` +
        venues.map(venue =>
          `<option value="${htmlEscape(venue)}">${htmlEscape(venue)}</option>`
        ).join('');

      if (venues.includes(previousValue)) {
        select.value = previousValue;
      }
    }

    console.log(
      `Successfully loaded ${venues.length} venues from Google Sheets:`,
      venues
    );

    renderAvailabilityChart();

  } catch (err) {
    venues = [];

    console.error('Failed to load venues:', err);

    setText(
      'adminAvailabilityMessage',
      'Unable to load venues from Google Sheets: ' + err.message,
      'error'
    );

    el('adminAvailabilityChart').innerHTML = '';

    throw err;
  }
}

async function loadBookings() {
  setText('adminMessage', 'Loading bookings…');
  const data = await rpc('getBookings');
  allBookings = (data.bookings || []).map(normalizeBooking);
  renderRows(); renderAvailabilityChart();
  setText('adminMessage', `Loaded ${allBookings.length} bookings. Choose filters to narrow the list.`, 'ready');
}
async function loadBlocks() {
  const data = await rpc('getVenueBlocks');
  blockedRules = Array.isArray(data.blocks) ? data.blocks : [];
  renderBlockedList(); renderAvailabilityChart();
}

async function loadEverything() {
  if (loading) return;

  loading = true;

  try {
    // Load independently so one failure does not stop the others.
    const [venueResult, bookingResult, blockResult] =
      await Promise.allSettled([
        loadVenues(),
        loadBookings(),
        loadBlocks()
      ]);

    // Venue loading error
    if (venueResult.status === 'rejected') {
      console.error('Venue loading failed:', venueResult.reason);

      setText(
        'adminAvailabilityMessage',
        'Unable to load venues from Google Sheets: ' +
        venueResult.reason.message,
        'error'
      );
    }

    // Booking loading error
    if (bookingResult.status === 'rejected') {
      console.error('Booking loading failed:', bookingResult.reason);

      setText(
        'adminMessage',
        'Unable to load bookings: ' +
        bookingResult.reason.message,
        'error'
      );

      el('adminBookingRows').innerHTML = `
        <tr>
          <td colspan="7" class="empty">
            Unable to load bookings.
            Please check the connection to Google Apps Script.
          </td>
        </tr>
      `;
    }

    // Venue block loading error
    if (blockResult.status === 'rejected') {
      console.error('Block loading failed:', blockResult.reason);
    }

  } finally {
    loading = false;
  }
}

el('adminRefresh').addEventListener('click', () => loadEverything().catch(err => setText('adminMessage', err.message, 'error')));
el('adminAvailabilityRefresh').addEventListener('click', () => loadEverything().catch(err => setText('adminAvailabilityMessage', err.message, 'error')));

/* Filter + sorting */
function getFilters() { return { time: val('filterFuture'), bookingType: val('filterBookingType'), status: val('filterStatus'), venue: val('filterVenue'), from: val('filterFromDate'), to: val('filterToDate'), search: lower(val('filterSearch')) }; }
function applyFilters(bookings) {
  const f = getFilters(), now = new Date();
  return bookings.filter(b => {
    if (f.time === 'future' && (!b.start || b.start < now)) return false;
    if (f.time === 'past' && (!b.start || b.start >= now)) return false;
    if (f.bookingType && b.bookingType !== f.bookingType) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.venue && b.venue !== f.venue) return false;
    if (f.from && (!b.start || localDate(b.start) < f.from)) return false;
    if (f.to && (!b.start || localDate(b.start) > f.to)) return false;
    if (f.search && !`${b.name} ${b.title} ${b.ref} ${b.venue} ${b.memberCode} ${b.phone}`.toLowerCase().includes(f.search)) return false;
    return true;
  });
}
function sortedBookings(items) {
  return [...items].sort((a, b) => {
    const aa = a[sortState.col], bb = b[sortState.col];
    const c = aa < bb ? -1 : aa > bb ? 1 : 0;
    return sortState.dir === 'asc' ? c : -c;
  });
}
function updateCounts(bookings) {
  setText('totalCount', bookings.length);
  setText('pendingCount', bookings.filter(b => b.status === 'pending').length);
  setText('approvedCount', bookings.filter(b => b.status === 'approved').length);
  setText('rejectedCount', bookings.filter(b => b.status === 'rejected').length);
}
function renderRows() {
  const filtered = applyFilters(allBookings), sorted = sortedBookings(filtered);
  updateCounts(filtered);
  for (const th of document.querySelectorAll('.data-table th[data-sort]')) {
    th.querySelector('.sort-icon').textContent = th.dataset.sort === sortState.col ? (sortState.dir === 'asc' ? '↑' : '↓') : '↕';
  }
  if (!sorted.length) { el('adminBookingRows').innerHTML = '<tr><td class="empty" colspan="7">No bookings match these filters.</td></tr>'; return; }
  el('adminBookingRows').innerHTML = sorted.map(b => {
    const pending = b.status === 'pending', rejected = b.status === 'rejected';
    const busy = busyBookings.has(b.id);
    const displayName = b.name || 'Not provided';
    const wa = buildWhatsAppUrl(b);
    const action = b.status === 'approved'
      ? (wa ? `<button type="button" class="btn-link wa" data-action="whatsapp" data-id="${htmlEscape(b.id)}">WhatsApp</button>` : '<span class="muted tiny">No WhatsApp phone</span>')
      : '';
    const type = b.bookingType === 'recurringbooking' ? 'Recurring' : 'Normal';
    return `<tr>
      <td><strong class="reference">${htmlEscape(b.ref)}</strong></td>
      <td><strong>${htmlEscape(b.title)}</strong><small class="type-label">${type}</small>${b.notes ? `<small>${htmlEscape(b.notes)}</small>` : ''}</td>
      <td><strong>${htmlEscape(displayName)}</strong><small>${htmlEscape(b.memberCode || 'No member code')}</small><small>${htmlEscape([b.phone, b.email].filter(Boolean).join(' · '))}</small></td>
      <td>${htmlEscape(b.venue)}</td>
      <td><strong>${htmlEscape(formatDate(b.start))}</strong><small>${b.end ? 'To ' + htmlEscape(formatDate(b.end)) : ''}</small></td>
      <td><span class="status-pill ${htmlEscape(b.status)}">${htmlEscape(b.status)}</span></td>
      <td><div class="row-actions"><button class="btn-small approve" data-action="approve" data-id="${htmlEscape(b.id)}" ${!pending || busy ? 'disabled' : ''}>Approve</button><button class="btn-small reject" data-action="reject" data-id="${htmlEscape(b.id)}" ${rejected || busy ? 'disabled' : ''}>Reject</button><button class="btn-small" data-action="edit" data-id="${htmlEscape(b.id)}" ${busy ? 'disabled' : ''}>Edit</button>${action}</div></td>
    </tr>`;
  }).join('');
}
for (const id of ['filterFuture', 'filterBookingType', 'filterStatus', 'filterVenue', 'filterFromDate', 'filterToDate']) el(id).addEventListener('change', renderRows);
el('filterSearch').addEventListener('input', renderRows);
el('resetFilters').addEventListener('click', () => {
  for (const id of ['filterSearch', 'filterStatus', 'filterVenue', 'filterFromDate', 'filterToDate']) el(id).value = '';
  el('filterFuture').value = 'future'; el('filterBookingType').value = 'normalbooking'; renderRows();
});
for (const th of document.querySelectorAll('.data-table th[data-sort]')) {
  function onSort() { const col = th.dataset.sort; sortState = sortState.col === col ? { col, dir: sortState.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' }; renderRows(); }
  th.addEventListener('click', onSort);
  th.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSort(); } });
}

/* Generic collapsible management panels */
for (const trigger of document.querySelectorAll('.tool-trigger')) {
  trigger.addEventListener('click', () => {
    const body = el(trigger.getAttribute('aria-controls'));
    const open = body.hidden; body.hidden = !open; trigger.setAttribute('aria-expanded', String(open));
    trigger.closest('.tool-panel').classList.toggle('expanded', open);
  });
}
el('jumpAddBooking').addEventListener('click', () => {
  el('management').scrollIntoView({ behavior: 'smooth', block: 'start' });
  const panel = el('normalBookingPanel'), trigger = panel.querySelector('.tool-trigger');
  if (el('normalBookingBody').hidden) trigger.click();
  setTimeout(() => el('normalEventTitle').focus(), 250);
});

function normalizeWhatsAppPhone(value) {
  const raw = String(value || '').trim();
  if (!raw || !/^\+?[\d\s()-]+$/.test(raw)) return '';
  const digits = raw.replace(/\D/g, '');
  let phone = '';
  if (raw[0] === '+') phone = digits;
  else if (digits.startsWith('00')) phone = digits.slice(2);
  else if (digits.startsWith('0')) phone = '60' + digits.slice(1);
  else if (digits.startsWith('60')) phone = digits;
  return /^601\d{8,9}$/.test(phone) ? phone : '';
}
function whatsappMessage(b, updated = false) {
  const pending = b.status === 'pending';

  const intro = updated
    ? (
      pending
        ? '您的场地申请备注已更新，目前仍待审核。以下是最新的申请信息。'
        : '您的场地预定备注已更新，以下是最新的预定信息。'
    )
    : '这个是您已预定的场地通知。';

  return [
    `${b.name || '您好'}，平安。`,
    '这个是您已预定的场地通知，若有任何更改，请再通知行政部电话号码019-262 8331，或活动与场地负责人-朱凯仪姐妹012-522 2528，谢谢。',

    '',

    '_注：离开前，请关闭所有电源开关，保持场地清洁整齐。让我们一起爱护神的教会，谢谢。_',

    '',

    pending ? '*申请信息*' : '*预定信息*',

    `活动: ${b.title}`,
    `地点: ${b.venue}`,
    `开始时间: ${formatDate(b.start)}`,
    `结束时间: ${formatDate(b.end)}`,

    '',

    '*备注*',
    String(b.notes || '').trim() || '无',

    '',
    '谢谢'

  ].join('\n');
}
function buildWhatsAppUrl(b, updated = false) {
  const phone = normalizeWhatsAppPhone(b.phone);

  const allowed =
    b.status === 'approved' ||
    (updated && b.status === 'pending');

  if (!allowed || !phone) return '';

  return `https://wa.me/${phone}?text=${encodeURIComponent(whatsappMessage(b, updated))
    }`;
}
function openWhatsAppModal(b, updated = false) {
  const allowed =
    b.status === 'approved' ||
    (updated && b.status === 'pending');

  if (!allowed) return;

  const phone = normalizeWhatsAppPhone(b.phone);
  const url = buildWhatsAppUrl(b, updated);

  setText(
    'whatsappModalTitle',
    updated ? 'Booking notes updated' : 'Booking approved'
  );

  setText(
    'whatsappModalRecipient',
    `Recipient: ${b.name || 'Organizer'} (${phone ? '+' + phone : 'No valid phone number'
    })`
  );

  setText(
    'whatsappModalMessage',
    whatsappMessage(b, updated)
  );

  el('whatsappOpenBtn').hidden = !url;

  if (url) {
    el('whatsappOpenBtn').href = url;
  } else {
    el('whatsappOpenBtn').removeAttribute('href');
  }

  setText(
    'whatsappModalNotice',
    url
      ? 'The message is prepared. Press Send in WhatsApp manually.'
      : 'No valid phone number. Edit this booking to add one.',
    url ? 'ready' : 'error'
  );

  openModal('whatsappModal');
}
function openModal(id) { el(id).hidden = false; document.body.classList.add('modal-open'); }
function closeModal(id) { el(id).hidden = true; if (el('editModal').hidden && el('whatsappModal').hidden) document.body.classList.remove('modal-open'); }
for (const [button, modal] of [['editCancelBtn', 'editModal'], ['editCloseIcon', 'editModal'], ['whatsappCloseBtn', 'whatsappModal'], ['whatsappCloseIcon', 'whatsappModal']]) el(button).addEventListener('click', () => closeModal(modal));
for (const id of ['editModal', 'whatsappModal']) el(id).addEventListener('click', e => { if (e.target === e.currentTarget) closeModal(id); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') { if (!el('whatsappModal').hidden) closeModal('whatsappModal'); else if (!el('editModal').hidden) closeModal('editModal'); } });

/* Approve / Reject / Edit / WhatsApp */
el('adminBookingRows').addEventListener('click', async e => {
  const button = e.target.closest('button[data-action]'); if (!button) return;
  const b = allBookings.find(b => b.id === button.dataset.id); if (!b) return;
  if (button.dataset.action === 'edit') { openEditModal(b); return; }
  if (button.dataset.action === 'whatsapp') { openWhatsAppModal(b); return; }
  if (busyBookings.has(b.id)) return;
  const approving = button.dataset.action === 'approve';
  if (!approving && !confirm(`Reject booking for ${b.title}? The calendar event will be removed.`)) return;
  busyBookings.add(b.id); renderRows(); setText('adminMessage', 'Updating booking…');
  try {
    await rpc(approving ? 'approveBooking' : 'rejectBooking', { bookingId: b.id });
    const wasPending = b.status === 'pending';
    await loadBookings();
    if (approving && wasPending) {
      const saved = allBookings.find(x => x.id === b.id);
      if (saved?.status === 'approved') openWhatsAppModal(saved);
    }
    setText('adminMessage', approving ? 'Booking approved.' : 'Booking rejected.', 'success');
  } catch (err) { setText('adminMessage', err.message, 'error'); }
  finally { busyBookings.delete(b.id); renderRows(); }
});
function openEditModal(b) {
  const values = { editRef: b.id, editBookingType: b.bookingType === 'recurringbooking' ? 'Recurring booking' : 'Normal booking', editMemberCode: b.memberCode, editName: b.name, editEmail: b.email, editPhone: b.phone, editEventTitle: b.title, editStart: b.start ? localDateTime(b.start) : '', editDuration: b.duration, editLocation: b.venue, editNotes: b.notes };
  for (const [id, value] of Object.entries(values)) el(id).value = value;
  el('editMemberCode').required = b.bookingType !== 'recurringbooking';
  el('editName').required = b.bookingType !== 'recurringbooking';
  el('editPhone').required = b.bookingType !== 'recurringbooking';
  setText('editMessage', ''); openModal('editModal');
}
el('editForm').addEventListener('submit', async e => {
  e.preventDefault();

  const button = el('editSaveBtn');
  button.disabled = true;

  const payload = {
    bookingId: val('editRef'),
    name: val('editName'),
    memberCode: val('editMemberCode'),
    email: val('editEmail'),
    phone: val('editPhone'),
    eventTitle: val('editEventTitle'),
    start: val('editStart'),
    duration: Number(val('editDuration')),
    location: val('editLocation'),
    notes: val('editNotes')
  };

  setText('editMessage', 'Saving...');

  try {
    const result = await rpc('editBooking', payload);

    closeModal('editModal');

    // Show WhatsApp only if notes were changed.
    if (result.notesChanged && result.booking) {
      const savedBooking = normalizeBooking(
        result.booking
      );

      if (
        savedBooking.status === 'approved' ||
        savedBooking.status === 'pending'
      ) {
        openWhatsAppModal(savedBooking, true);
      }
    }

    try {
      await loadBookings();

      setText(
        'adminMessage',
        result.notesChanged
          ? 'Booking notes updated successfully.'
          : 'Booking details updated.',
        'success'
      );

    } catch (refreshError) {
      setText(
        'adminMessage',
        'Booking saved, but dashboard refresh failed. Please refresh manually.',
        'error'
      );
    }

  } catch (err) {
    setText(
      'editMessage',
      err.message,
      'error'
    );

  } finally {
    button.disabled = false;
  }
});

/* Admin creates one-time booking, immediately Approved. */
el('normalBookingForm').addEventListener('submit', async e => {
  e.preventDefault(); const button = el('createNormalButton');
  const phone = val('normalPhone');
  if (!normalizeWhatsAppPhone(phone)) { setText('normalBookingMessage', 'Enter a valid Malaysian mobile phone number.', 'error'); return; }
  const payload = { name: val('normalOrganizer'), memberCode: val('normalMemberCode').toUpperCase(), phone, email: val('normalEmail'), eventTitle: val('normalEventTitle'), location: val('normalVenue'), start: val('normalStart'), duration: Number(val('normalDuration')), notes: val('normalNotes') };
  button.disabled = true; setText('normalBookingMessage', 'Creating booking…');
  try {
    const result = await rpc('createAdminBooking', payload);
    setText('normalBookingMessage', `Booking created and approved. Reference: ${result.bookingId}`, 'success');
    e.target.reset(); el('normalDuration').value = '2';
    await loadBookings(); renderAvailabilityChart();
  } catch (err) { setText('normalBookingMessage', err.message, 'error'); }
  finally { button.disabled = false; }
});

/* Weekly recurring */
function recurringDates() {
  const from = val('recurringFromDate'), until = val('recurringUntilDate');
  if (!from || !until || from > until) return [];
  let first = new Date(from + 'T00:00:00'), last = new Date(until + 'T00:00:00');
  if (isNaN(first) || isNaN(last)) return [];
  const weekday = Number(val('recurringWeekday'));
  first.setDate(first.getDate() + (weekday - first.getDay() + 7) % 7);
  const dates = [];
  for (const d = new Date(first); d <= last && dates.length <= 104; d.setDate(d.getDate() + 7))dates.push(new Date(d));
  return dates;
}
function renderRecurringPreview() {
  const dates = recurringDates();
  setText('recurringCount', dates.length > 104 ? 'More than 104 dates' : `${dates.length} occurrence${dates.length === 1 ? '' : 's'}`);
  el('recurringPreview').innerHTML = dates.slice(0, 8).map(d => `<span>${htmlEscape(d.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span>`).join('') + (dates.length > 8 ? `<span>+${dates.length - 8} more</span>` : '');
}
for (const input of el('recurringBookingForm').querySelectorAll('input,select')) { input.addEventListener('input', renderRecurringPreview); input.addEventListener('change', renderRecurringPreview); }
el('recurringBookingForm').addEventListener('submit', async e => {
  e.preventDefault(); const dates = recurringDates(), button = el('createRecurringButton');
  if (!dates.length || dates.length > 104) { setText('recurringMessage', 'Choose a date range containing 1–104 matching weekdays.', 'error'); return; }
  const start = val('recurringStartTime'), end = val('recurringEndTime');
  if (end <= start) { setText('recurringMessage', 'End time must follow start time.', 'error'); return; }
  if (val('recurringPhone') && !normalizeWhatsAppPhone(val('recurringPhone'))) { setText('recurringMessage', 'Enter a valid phone number or leave it empty.', 'error'); return; }
  const payload = { eventTitle: val('recurringEventTitle'), location: val('recurringVenue'), weekday: Number(val('recurringWeekday')), startTime: start, endTime: end, fromDate: val('recurringFromDate'), untilDate: val('recurringUntilDate'), organizer: val('recurringOrganizer'), memberCode: val('recurringMemberCode').toUpperCase(), phone: val('recurringPhone'), email: val('recurringEmail'), notes: val('recurringNotes') };
  button.disabled = true; setText('recurringMessage', `Creating ${dates.length} recurring bookings…`);
  try {
    const result = await rpc('createRecurringBookings', payload);
    setText('recurringMessage', `Created ${result.createdCount} bookings. Skipped ${result.skippedCount} blocked/conflicting/error dates.`, 'success');
    if (result.skipped?.length) console.info('Skipped recurring dates:', result.skipped);
    await loadBookings();
  } catch (err) { setText('recurringMessage', err.message, 'error'); }
  finally { button.disabled = false; }
});

/* Blocks */

/* Blocks */

function validBlockDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  if (date < '2000-01-01') return false;

  const parsed = new Date(date + 'T00:00:00Z');

  return !isNaN(parsed.getTime()) &&
    parsed.toISOString().slice(0, 10) === date;
}

function updateBlockFields() {
  const weekly = val('blockType') === 'weekly';

  // Specific date fields
  el('blockDateField').hidden = weekly;
  el('blockDate').required = !weekly;
  el('blockDate').disabled = weekly;
  el('blockDate').min = '2000-01-01';

  // Weekly fields
  el('blockWeekdayField').hidden = !weekly;
  el('blockFromDateField').hidden = !weekly;
  el('blockUntilDateField').hidden = !weekly;
  el('blockPreviewField').hidden = !weekly;

  el('blockWeekday').disabled = !weekly;
  el('blockFromDate').disabled = !weekly;
  el('blockUntilDate').disabled = !weekly;

  el('blockWeekday').required = weekly;
  el('blockFromDate').required = weekly;
  el('blockUntilDate').required = weekly;

  renderBlockPreview();
}

function getBlockOccurrences() {
  const from = val('blockFromDate');
  const until = val('blockUntilDate');
  const weekday = Number(val('blockWeekday'));

  if (
    !validBlockDate(from) ||
    !validBlockDate(until) ||
    from > until
  ) {
    return { count: 0, dates: [] };
  }

  const first = new Date(from + 'T00:00:00Z');
  const last = new Date(until + 'T00:00:00Z');

  // Find the first matching weekday.
  first.setUTCDate(
    first.getUTCDate() +
    (weekday - first.getUTCDay() + 7) % 7
  );

  if (first > last) {
    return { count: 0, dates: [] };
  }

  const weekMs = 7 * 24 * 60 * 60 * 1000;

  const count = Math.floor(
    (last.getTime() - first.getTime()) / weekMs
  ) + 1;

  const dates = [];

  // Only display the first eight occurrences.
  for (let i = 0; i < Math.min(count, 8); i++) {
    dates.push(
      new Date(first.getTime() + i * weekMs)
    );
  }

  return { count, dates };
}

function renderBlockPreview() {
  if (val('blockType') !== 'weekly') return;

  const from = val('blockFromDate');

  el('blockUntilDate').min =
    from || '2000-01-01';

  const { count, dates } = getBlockOccurrences();

  setText(
    'blockCount',
    `${count} occurrence${count === 1 ? '' : 's'}`
  );

  el('blockPreview').innerHTML = dates.map(date => `
        <span>
            ${htmlEscape(
    date.toLocaleDateString('en-MY', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC'
    })
  )}
        </span>
    `).join('') + (
      count > 8
        ? `<span>+${count - 8} more</span>`
        : ''
    );
}

el('blockType').addEventListener(
  'change',
  updateBlockFields
);

for (const id of [
  'blockFromDate',
  'blockUntilDate',
  'blockWeekday'
]) {
  el(id).addEventListener(
    'change',
    renderBlockPreview
  );

  el(id).addEventListener(
    'input',
    renderBlockPreview
  );
}

function renderBlockedList() {
  const days = [
    'Sunday', 'Monday', 'Tuesday',
    'Wednesday', 'Thursday', 'Friday',
    'Saturday'
  ];

  if (!blockedRules.length) {
    el('blockedList').innerHTML =
      '<p class="muted">No venue blocks added.</p>';

    return;
  }

  el('blockedList').innerHTML = blockedRules.map(b => {
    const weekly = b.type === 'weekly';

    const when = weekly
      ? 'Every ' + days[b.weekday]
      : b.date;

    const dateRange = weekly
      ? (b.fromDate || 'No start date') +
      ' → ' +
      (b.untilDate || 'No end date')
      : '';

    const timeRange = b.startTime && b.endTime
      ? b.startTime + '–' + b.endTime
      : 'All day';

    return `
            <div class="block-tag">
                <span>
                    <strong>${htmlEscape(when)}</strong>
                    · ${htmlEscape(b.venue || 'All venues')}
                    · ${htmlEscape(timeRange)}

                    ${dateRange
        ? `<br>${htmlEscape(dateRange)}`
        : ''}

                    ${b.reason
        ? `<br>${htmlEscape(b.reason)}`
        : ''}
                </span>

                <button
                    type="button"
                    class="icon-button"
                    data-delete-block="${htmlEscape(b.id)}"
                    aria-label="Remove block"
                >✕</button>
            </div>
        `;
  }).join('');
}

el('blockedList').addEventListener('click', async e => {
  const button = e.target.closest(
    'button[data-delete-block]'
  );

  if (!button) return;

  if (!confirm('Remove this venue block?')) return;

  button.disabled = true;

  try {
    await rpc('deleteBlock', {
      id: button.dataset.deleteBlock
    });

    await loadBlocks();

    setText(
      'blockMessage',
      'Block removed.',
      'success'
    );

  } catch (err) {
    button.disabled = false;

    setText(
      'blockMessage',
      err.message,
      'error'
    );
  }
});

el('blockForm').addEventListener('submit', async e => {
  e.preventDefault();

  const button = el('createBlockButton');
  const type = val('blockType');
  const weekly = type === 'weekly';

  const payload = {
    type,

    date: weekly ? '' : val('blockDate'),

    weekday: weekly
      ? Number(val('blockWeekday'))
      : undefined,

    fromDate: weekly
      ? val('blockFromDate')
      : '',

    untilDate: weekly
      ? val('blockUntilDate')
      : '',

    venue: val('blockVenue'),
    startTime: val('blockStartTime'),
    endTime: val('blockEndTime'),
    reason: val('blockReason')
  };

  // Validate specific date.
  if (!weekly && !validBlockDate(payload.date)) {
    setText(
      'blockMessage',
      'Select a valid date.',
      'error'
    );
    return;
  }

  // Validate weekly date range.
  if (weekly) {
    if (
      !validBlockDate(payload.fromDate) ||
      !validBlockDate(payload.untilDate)
    ) {
      setText(
        'blockMessage',
        'Select both a valid from date and until date.',
        'error'
      );
      return;
    }

    if (payload.untilDate < payload.fromDate) {
      setText(
        'blockMessage',
        'Until date must not be before from date.',
        'error'
      );
      return;
    }

    if (getBlockOccurrences().count === 0) {
      setText(
        'blockMessage',
        'No matching weekday in the selected date range.',
        'error'
      );
      return;
    }
  }

  // Validate time.
  if (
    Boolean(payload.startTime) !==
    Boolean(payload.endTime)
  ) {
    setText(
      'blockMessage',
      'Set both start and end time, or leave both empty.',
      'error'
    );
    return;
  }

  if (
    payload.startTime &&
    payload.endTime <= payload.startTime
  ) {
    setText(
      'blockMessage',
      'End time must follow start time.',
      'error'
    );
    return;
  }

  button.disabled = true;

  setText('blockMessage', 'Adding block…');

  try {
    await rpc('addBlock', payload);

    await loadBlocks();

    setText(
      'blockMessage',
      'Block saved.',
      'success'
    );

    e.target.reset();

    updateBlockFields();

  } catch (err) {
    setText(
      'blockMessage',
      err.message,
      'error'
    );

  } finally {
    button.disabled = false;
  }
});

updateBlockFields();


/* Availability: uses ALL bookings independently of the dashboard booking-type filter. */
const dateMatch = (b, date) => b.start && localDate(b.start) === date;
function intersect(aStart, aEnd, bStart, bEnd) { return aStart < bEnd && aEnd > bStart; }
function timeMins(time) { if (!time) return null; const [h, m] = time.split(':').map(Number); return h * 60 + m; }

function findBlock(venue, date, weekday, startMins, endMins) {
  return blockedRules.find(b => {

    // Check venue.
    if (b.venue && b.venue !== venue) {
      return false;
    }

    // Specific date block.
    if (b.type === 'specific') {
      if (b.date !== date) return false;
    }

    // Weekly block.
    else if (b.type === 'weekly') {

      if (Number(b.weekday) !== weekday) {
        return false;
      }

      // Check effective start date.
      if (b.fromDate && date < b.fromDate) {
        return false;
      }

      // Check effective end date.
      if (b.untilDate && date > b.untilDate) {
        return false;
      }

    } else {
      return false;
    }

    // Whole-day block.
    if (!b.startTime || !b.endTime) {
      return true;
    }

    // Check overlapping time slots.
    return (
      startMins < timeMins(b.endTime) &&
      endMins > timeMins(b.startTime)
    );
  });
}

function renderAvailabilityChart() {
  const day = val('adminAvailabilityDate') || localDate(new Date());
  const date = new Date(day + 'T00:00:00');
  if (isNaN(date.getTime())) return;
  const bookings = allBookings.filter(b => b.status !== 'rejected' && dateMatch(b, day));
  let out = '<thead><tr><th>Time</th>' + venues.map(v => `<th>${htmlEscape(v)}</th>`).join('') + '</tr></thead><tbody>';
  for (let hour = 9; hour < 23; hour++) {
    const begin = new Date(date); begin.setHours(hour, 0, 0, 0);
    const end = new Date(begin.getTime() + 3600000);
    out += `<tr><th>${htmlEscape(slotTime(begin))}</th>`;
    for (const v of venues) {
      const b = bookings.find(b => b.venue === v && b.end && intersect(begin, end, b.start, b.end));
      const blocked = findBlock(v, day, date.getDay(), hour * 60, (hour + 1) * 60);
      const state = b ? (b.status === 'pending' ? 'pending' : 'booked') : blocked ? 'booked' : 'open';
      const label = b ? (b.status === 'pending' ? 'Pending' : 'Booked') : blocked ? 'Blocked' : 'Available';
      const title = b ? b.title + (b.bookingType === 'recurringbooking' ? ' (Recurring)' : '') : blocked ? (blocked.reason || 'Blocked') : 'Available';
      out += `<td class="slot ${state}" title="${htmlEscape(title)}">${label}</td>`;
    }
    out += '</tr>';
  }
  out += '</tbody>'; el('adminAvailabilityChart').innerHTML = out;
  setText('adminAvailabilityMessage', `${bookings.length} active booking${bookings.length === 1 ? '' : 's'} for ${day}.`);
}
el('adminAvailabilityDate').addEventListener('change', renderAvailabilityChart);

/* Initialize UI; never use admin privileges until login succeeds. */
(function init() {
  const today = new Date(), threeMonths = new Date(today); threeMonths.setMonth(threeMonths.getMonth() + 3);
  el('adminAvailabilityDate').value = localDate(today);
  el('normalStart').value = localDateTime(new Date(Date.now() + 3600000));
  el('recurringFromDate').value = localDate(today); el('recurringUntilDate').value = localDate(threeMonths);
  el('recurringStartTime').value = '13:30'; el('recurringEndTime').value = '15:30';
  renderRecurringPreview();
  if (token) { showDashboard(); loadEverything().catch(err => { setText('adminMessage', err.message, 'error'); }); }
  else showLogin();
})();
