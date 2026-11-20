
/* Venue Desk admin dashboard
 * Use with the matching Code.gs.
 * API_URL must match your Apps Script web-app deployment.
 */

const API_URL =
  'https://script.google.com/macros/s/AKfycbys4YZOVsEX7kEz0RFaQe90h4ye3fpZEkFWgsGzqgbL9CERoLbdKhEOE-wLez76hC68/exec';

const TOKEN_KEY = 'venueDeskAdminToken';

const el = id => document.getElementById(id);
const val = id => el(id)?.value?.trim() || '';

const setText = (id, txt, state = '') => {
  const node = el(id);
  if (node) {
    node.textContent = txt;
    node.dataset.state = state;
  }
};

const htmlEscape = value =>
  String(value ?? '').replace(
    /[&<>"']/g,
    x => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[x])
  );

const localDate = date =>
  new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 10);

const localDateTime = date =>
  new Date(
    date.getTime() - date.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);

const formatDate = date =>
  date
    ? date.toLocaleString('en-MY', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
    : 'Not specified';

const slotTime = date =>
  date.toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit'
  });

const lower = x => String(x ?? '').toLowerCase();

let token = sessionStorage.getItem(TOKEN_KEY) || '';
let allBookings = [];
let venues = [];
let blockedRules = [];
let sortState = { col: 'start', dir: 'asc' };
let busyBookings = new Set();
let loading = false;

/* ============================================
   API AND AUTHENTICATION
============================================ */

async function request(data) {
  let res;

  try {
    res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(data),
      redirect: 'follow',
      cache: 'no-store'
    });
  } catch (err) {
    throw new Error(
      'Cannot reach Apps Script. Verify deployment URL and network access. ' +
      err.message
    );
  }

  if (!res.ok) {
    throw new Error(`API returned HTTP ${res.status}`);
  }

  let json;

  try {
    json = await res.json();
  } catch (e) {
    throw new Error(
      'API did not return JSON. Check deployment and permissions.'
    );
  }

  if (json?.success === false) {
    throw new Error(
      json.message || json.error || 'The request was rejected.'
    );
  }

  return json;
}

async function rpc(command, payload = {}) {
  if (!token) {
    throw new Error('Please sign in.');
  }

  try {
    return await request({
      action: 'adminRpc',
      token,
      command,
      payload
    });
  } catch (err) {
    if (
      /session expired|unauthorized|please log in/i.test(
        err.message
      )
    ) {
      showLogin('Session expired. Sign in again.');
    }

    throw err;
  }
}

function showLogin(message = '') {
  token = '';
  sessionStorage.removeItem(TOKEN_KEY);

  el('loginView').hidden = false;
  el('dashboard').hidden = true;
  el('logoutBtn').hidden = true;
  el('navLinks').hidden = true;

  setText(
    'loginMessage',
    message,
    message ? 'error' : ''
  );
}

function showDashboard() {
  el('loginView').hidden = true;
  el('dashboard').hidden = false;
  el('logoutBtn').hidden = false;
  el('navLinks').hidden = false;
}

el('loginForm').addEventListener('submit', async e => {
  e.preventDefault();

  const btn = el('loginBtn');
  btn.disabled = true;

  setText('loginMessage', 'Signing in…');

  try {
    const data = await request({
      action: 'adminLogin',
      username: val('loginUsername'),
      password: el('loginPassword').value
    });

    token = data.token;
    sessionStorage.setItem(TOKEN_KEY, token);

    el('loginPassword').value = '';

    showDashboard();
    await loadEverything();
  } catch (err) {
    setText('loginMessage', err.message, 'error');
  } finally {
    btn.disabled = false;
  }
});

el('logoutBtn').addEventListener('click', async () => {
  const old = token;
  showLogin();

  try {
    await request({
      action: 'adminRpc',
      token: old,
      command: 'logout',
      payload: {}
    });
  } catch (_) {
    // Local logout is already completed.
  }
});

/* ============================================
   BOOKING DATA
============================================ */

function normalizeBooking(row) {
  const start = row.start ? new Date(row.start) : null;
  const end = row.end ? new Date(row.end) : null;

  return {
    id: String(row.id || ''),
    ref: String(row.id || ''),
    name: String(row.name || ''),
    memberCode: String(row.memberCode || ''),
    email: String(row.email || ''),
    phone: String(row.phone || ''),
    title: String(row.eventTitle || 'Untitled event'),
    venue: String(row.location || ''),
    notes: String(row.notes || ''),

    start:
      start && !isNaN(start) ? start : null,

    end:
      end && !isNaN(end) ? end : null,

    duration: Number(row.duration || 1),
    status: lower(row.status || 'Pending'),
    bookingType: lower(
      row.bookingType || 'normalbooking'
    )
  };
}

/* ============================================
   VENUES — GOOGLE SHEETS ONLY
============================================ */

async function loadVenues() {
  const data = await rpc('getVenues');

  if (!Array.isArray(data.venues)) {
    throw new Error(
      'Invalid venue list returned by Apps Script'
    );
  }

  venues = [
    ...new Set(
      data.venues
        .map(x => String(x || '').trim())
        .filter(Boolean)
    )
  ];

  if (!venues.length) {
    throw new Error(
      'No venues found in the Venues sheet'
    );
  }

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

    const before = select.value;

    select.innerHTML =
      `<option value="">${placeholder}</option>` +
      venues.map(v =>
        `<option value="${htmlEscape(v)}">${htmlEscape(v)}</option>`
      ).join('');

    if (venues.includes(before)) {
      select.value = before;
    }
  }

  renderAvailabilityChart();
}

async function loadBookings() {
  setText('adminMessage', 'Loading bookings…');

  const data = await rpc('getBookings');

  allBookings = (data.bookings || []).map(
    normalizeBooking
  );

  renderRows();
  renderAvailabilityChart();

  setText(
    'adminMessage',
    `Loaded ${allBookings.length} bookings. Choose filters to narrow the list.`,
    'ready'
  );
}

async function loadBlocks() {
  const data = await rpc('getVenueBlocks');

  blockedRules = Array.isArray(data.blocks)
    ? data.blocks
    : [];

  renderBlockedList();
  renderAvailabilityChart();
}

async function loadEverything() {
  if (loading) return;

  loading = true;

  try {
    const [
      venuesResult,
      bookingsResult,
      blocksResult
    ] = await Promise.allSettled([
      loadVenues(),
      loadBookings(),
      loadBlocks()
    ]);

    if (venuesResult.status === 'rejected') {
      console.error(
        'Venues failed:',
        venuesResult.reason
      );

      venues = [];
      renderAvailabilityChart();

      setText(
        'adminAvailabilityMessage',
        'Unable to load venues from Google Sheets: ' +
        venuesResult.reason.message,
        'error'
      );
    }

    if (bookingsResult.status === 'rejected') {
      console.error(
        'Bookings failed:',
        bookingsResult.reason
      );

      el('adminBookingRows').innerHTML = `
        <tr>
          <td class="empty" colspan="7">
            Unable to load bookings.
            Check your API deployment and session.
          </td>
        </tr>
      `;

      setText(
        'adminMessage',
        'Unable to load bookings: ' +
        bookingsResult.reason.message,
        'error'
      );
    }

    if (blocksResult.status === 'rejected') {
      console.error(
        'Blocks failed:',
        blocksResult.reason
      );

      setText(
        'blockMessage',
        'Unable to load blocks: ' +
        blocksResult.reason.message,
        'error'
      );
    }
  } finally {
    loading = false;
  }
}

el('adminRefresh').addEventListener(
  'click',
  () => loadEverything().catch(err =>
    setText('adminMessage', err.message, 'error')
  )
);

el('adminAvailabilityRefresh').addEventListener(
  'click',
  () => loadEverything().catch(err =>
    setText(
      'adminAvailabilityMessage',
      err.message,
      'error'
    )
  )
);

/* ============================================
   FILTERS AND SORTING
============================================ */

function getFilters() {
  return {
    time: val('filterFuture'),
    bookingType: val('filterBookingType'),
    status: val('filterStatus'),
    venue: val('filterVenue'),
    from: val('filterFromDate'),
    to: val('filterToDate'),
    search: lower(val('filterSearch'))
  };
}

function applyFilters(bookings) {
  const f = getFilters();
  const now = new Date();

  return bookings.filter(b => {
    if (
      f.time === 'future' &&
      (!b.start || b.start < now)
    ) return false;

    if (
      f.time === 'past' &&
      (!b.start || b.start >= now)
    ) return false;

    if (
      f.bookingType &&
      b.bookingType !== f.bookingType
    ) return false;

    if (f.status && b.status !== f.status) {
      return false;
    }

    if (f.venue && b.venue !== f.venue) {
      return false;
    }

    if (
      f.from &&
      (!b.start || localDate(b.start) < f.from)
    ) return false;

    if (
      f.to &&
      (!b.start || localDate(b.start) > f.to)
    ) return false;

    if (f.search) {
      const searchText = [
        b.name,
        b.title,
        b.ref,
        b.venue,
        b.memberCode,
        b.phone
      ].join(' ').toLowerCase();

      if (!searchText.includes(f.search)) {
        return false;
      }
    }

    return true;
  });
}

function sortedBookings(items) {
  return [...items].sort((a, b) => {
    const aa = a[sortState.col];
    const bb = b[sortState.col];

    const c = aa < bb ? -1 : aa > bb ? 1 : 0;

    return sortState.dir === 'asc' ? c : -c;
  });
}

function updateCounts(bookings) {
  setText('totalCount', bookings.length);

  setText(
    'pendingCount',
    bookings.filter(b => b.status === 'pending').length
  );

  setText(
    'approvedCount',
    bookings.filter(b => b.status === 'approved').length
  );

  setText(
    'rejectedCount',
    bookings.filter(b => b.status === 'rejected').length
  );
}

function renderRows() {
  const filtered = applyFilters(allBookings);
  const sorted = sortedBookings(filtered);

  updateCounts(filtered);

  for (
    const th of document.querySelectorAll(
      '.data-table th[data-sort]'
    )
  ) {
    th.querySelector('.sort-icon').textContent =
      th.dataset.sort === sortState.col
        ? (sortState.dir === 'asc' ? '↑' : '↓')
        : '↕';
  }

  if (!sorted.length) {
    el('adminBookingRows').innerHTML = `
      <tr>
        <td class="empty" colspan="7">
          No bookings match these filters.
        </td>
      </tr>
    `;
    return;
  }

  el('adminBookingRows').innerHTML = sorted.map(b => {
    const pending = b.status === 'pending';
    const rejected = b.status === 'rejected';
    const busy = busyBookings.has(b.id);
    const displayName = b.name || 'Not provided';

    const wa = buildWhatsAppUrl(b);

    const action = b.status === 'approved'
      ? (
        wa
          ? `<button type="button" class="btn-link wa"
                data-action="whatsapp"
                data-id="${htmlEscape(b.id)}">
                WhatsApp
              </button>`
          : `<span class="muted tiny">
                No WhatsApp phone
              </span>`
      )
      : '';

    const type =
      b.bookingType === 'recurringbooking'
        ? 'Recurring'
        : 'Normal';

    return `
      <tr>
        <td>
          <strong class="reference">
            ${htmlEscape(b.ref)}
          </strong>
        </td>

        <td>
          <strong>${htmlEscape(b.title)}</strong>
          <small class="type-label">${type}</small>
          ${b.notes
        ? `<small>${htmlEscape(b.notes)}</small>`
        : ''}
        </td>

        <td>
          <strong>${htmlEscape(displayName)}</strong>
          <small>
            ${htmlEscape(b.memberCode || 'No member code')}
          </small>
          <small>
            ${htmlEscape(
          [b.phone, b.email].filter(Boolean).join(' · ')
        )}
          </small>
        </td>

        <td>${htmlEscape(b.venue)}</td>

        <td>
          <strong>
            ${htmlEscape(formatDate(b.start))}
          </strong>
          <small>
            ${b.end
        ? 'To ' + htmlEscape(formatDate(b.end))
        : ''}
          </small>
        </td>

        <td>
          <span class="status-pill ${htmlEscape(b.status)}">
            ${htmlEscape(b.status)}
          </span>
        </td>

        <td>
          <div class="row-actions">
            <button
              class="btn-small approve"
              data-action="approve"
              data-id="${htmlEscape(b.id)}"
              ${!pending || busy ? 'disabled' : ''}>
              Approve
            </button>

            <button
              class="btn-small reject"
              data-action="reject"
              data-id="${htmlEscape(b.id)}"
              ${rejected || busy ? 'disabled' : ''}>
              Reject
            </button>

            <button
              class="btn-small"
              data-action="edit"
              data-id="${htmlEscape(b.id)}"
              ${busy ? 'disabled' : ''}>
              Edit
            </button>

            ${action}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

[
  'filterFuture',
  'filterBookingType',
  'filterStatus',
  'filterVenue',
  'filterFromDate',
  'filterToDate'
].forEach(id => {
  el(id).addEventListener('change', renderRows);
});

el('filterSearch').addEventListener(
  'input',
  renderRows
);

el('resetFilters').addEventListener('click', () => {
  [
    'filterSearch',
    'filterStatus',
    'filterVenue',
    'filterFromDate',
    'filterToDate'
  ].forEach(id => {
    el(id).value = '';
  });

  el('filterFuture').value = 'future';
  el('filterBookingType').value = 'normalbooking';

  renderRows();
});

for (
  const th of document.querySelectorAll(
    '.data-table th[data-sort]'
  )
) {
  function onSort() {
    const col = th.dataset.sort;

    sortState = sortState.col === col
      ? {
        col,
        dir: sortState.dir === 'asc' ? 'desc' : 'asc'
      }
      : {
        col,
        dir: 'asc'
      };

    renderRows();
  }

  th.addEventListener('click', onSort);

  th.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSort();
    }
  });
}

/* ============================================
   COLLAPSIBLE PANELS
============================================ */

for (
  const trigger of document.querySelectorAll(
    '.tool-trigger'
  )
) {
  trigger.addEventListener('click', () => {
    const body = el(
      trigger.getAttribute('aria-controls')
    );

    const open = body.hidden;

    body.hidden = !open;
    trigger.setAttribute(
      'aria-expanded',
      String(open)
    );

    trigger.closest('.tool-panel')
      .classList.toggle('expanded', open);
  });
}

el('jumpAddBooking').addEventListener('click', () => {
  el('management').scrollIntoView({
    behavior: 'smooth',
    block: 'start'
  });

  const panel = el('normalBookingPanel');
  const trigger = panel.querySelector('.tool-trigger');

  if (el('normalBookingBody').hidden) {
    trigger.click();
  }

  setTimeout(() => {
    el('normalEventTitle').focus();
  }, 250);
});

/* ============================================
   WHATSAPP
============================================ */

function normalizeWhatsAppPhone(value) {
  const raw = String(value || '').trim();

  if (!raw || !/^\+?[\d\s()-]+$/.test(raw)) {
    return '';
  }

  const digits = raw.replace(/\D/g, '');
  let phone = '';

  if (raw[0] === '+') {
    phone = digits;
  } else if (digits.startsWith('00')) {
    phone = digits.slice(2);
  } else if (digits.startsWith('0')) {
    phone = '60' + digits.slice(1);
  } else if (digits.startsWith('60')) {
    phone = digits;
  }

  return /^601\d{8,9}$/.test(phone)
    ? phone
    : '';
}

function whatsappMessage(b) {
  return [
    `Hi ${b.name || 'there'}, your booking has been confirmed.`,
    '',
    '*Booking Information*',
    `Booking Reference: ${b.ref}`,
    `Event: ${b.title}`,
    `Venue: ${b.venue}`,
    `Start: ${formatDate(b.start)}`,
    `End: ${formatDate(b.end)}`,
    'Status: Approved',
    '',
    'Thank you.'
  ].join('\n');
}

function buildWhatsAppUrl(b) {
  const phone = normalizeWhatsAppPhone(b.phone);

  return b.status === 'approved' && phone
    ? `https://wa.me/${phone}?text=${encodeURIComponent(
      whatsappMessage(b)
    )}`
    : '';
}

function openWhatsAppModal(b) {
  if (b.status !== 'approved') return;

  const phone = normalizeWhatsAppPhone(b.phone);
  const url = buildWhatsAppUrl(b);

  setText(
    'whatsappModalRecipient',
    `Recipient: ${b.name || 'Organizer'} (${phone ? '+' + phone : 'No valid phone number'
    })`
  );

  setText(
    'whatsappModalMessage',
    whatsappMessage(b)
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

/* ============================================
   MODALS
============================================ */

function openModal(id) {
  el(id).hidden = false;
  document.body.classList.add('modal-open');
}

function closeModal(id) {
  el(id).hidden = true;

  if (
    el('editModal').hidden &&
    el('whatsappModal').hidden
  ) {
    document.body.classList.remove('modal-open');
  }
}

for (const [button, modal] of [
  ['editCancelBtn', 'editModal'],
  ['editCloseIcon', 'editModal'],
  ['whatsappCloseBtn', 'whatsappModal'],
  ['whatsappCloseIcon', 'whatsappModal']
]) {
  el(button).addEventListener(
    'click',
    () => closeModal(modal)
  );
}

for (const id of ['editModal', 'whatsappModal']) {
  el(id).addEventListener('click', e => {
    if (e.target === e.currentTarget) {
      closeModal(id);
    }
  });
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!el('whatsappModal').hidden) {
      closeModal('whatsappModal');
    } else if (!el('editModal').hidden) {
      closeModal('editModal');
    }
  }
});

/* ============================================
   APPROVE / REJECT / EDIT
============================================ */

el('adminBookingRows').addEventListener(
  'click',
  async e => {
    const button = e.target.closest(
      'button[data-action]'
    );

    if (!button) return;

    const b = allBookings.find(
      b => b.id === button.dataset.id
    );

    if (!b) return;

    if (button.dataset.action === 'edit') {
      openEditModal(b);
      return;
    }

    if (button.dataset.action === 'whatsapp') {
      openWhatsAppModal(b);
      return;
    }

    if (busyBookings.has(b.id)) return;

    const approving =
      button.dataset.action === 'approve';

    if (
      !approving &&
      !confirm(
        `Reject booking for ${b.title}? The calendar event will be removed.`
      )
    ) return;

    busyBookings.add(b.id);

    renderRows();
    setText('adminMessage', 'Updating booking…');

    try {
      await rpc(
        approving ? 'approveBooking' : 'rejectBooking',
        { bookingId: b.id }
      );

      const wasPending = b.status === 'pending';

      await loadBookings();

      if (approving && wasPending) {
        const saved = allBookings.find(
          x => x.id === b.id
        );

        if (saved?.status === 'approved') {
          openWhatsAppModal(saved);
        }
      }

      setText(
        'adminMessage',
        approving
          ? 'Booking approved.'
          : 'Booking rejected.',
        'success'
      );
    } catch (err) {
      setText('adminMessage', err.message, 'error');
    } finally {
      busyBookings.delete(b.id);
      renderRows();
    }
  }
);

function openEditModal(b) {
  const values = {
    editRef: b.id,

    editBookingType:
      b.bookingType === 'recurringbooking'
        ? 'Recurring booking'
        : 'Normal booking',

    editMemberCode: b.memberCode,
    editName: b.name,
    editEmail: b.email,
    editPhone: b.phone,
    editEventTitle: b.title,

    editStart:
      b.start ? localDateTime(b.start) : '',

    editDuration: b.duration,
    editLocation: b.venue,
    editNotes: b.notes
  };

  for (const [id, value] of Object.entries(values)) {
    el(id).value = value;
  }

  const required =
    b.bookingType !== 'recurringbooking';

  el('editMemberCode').required = required;
  el('editName').required = required;
  el('editPhone').required = required;

  setText('editMessage', '');
  openModal('editModal');
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

  setText('editMessage', 'Saving…');

  try {
    await rpc('editBooking', payload);
    closeModal('editModal');
    await loadBookings();

    setText(
      'adminMessage',
      'Booking details updated.',
      'success'
    );
  } catch (err) {
    setText('editMessage', err.message, 'error');
  } finally {
    button.disabled = false;
  }
});

/* ============================================
   CREATE NORMAL BOOKING
============================================ */

el('normalBookingForm').addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    const button = el('createNormalButton');
    const phone = val('normalPhone');

    if (!normalizeWhatsAppPhone(phone)) {
      setText(
        'normalBookingMessage',
        'Enter a valid Malaysian mobile phone number.',
        'error'
      );
      return;
    }

    const payload = {
      name: val('normalOrganizer'),
      memberCode: val('normalMemberCode').toUpperCase(),
      phone,
      email: val('normalEmail'),
      eventTitle: val('normalEventTitle'),
      location: val('normalVenue'),
      start: val('normalStart'),
      duration: Number(val('normalDuration')),
      notes: val('normalNotes')
    };

    button.disabled = true;

    setText(
      'normalBookingMessage',
      'Creating booking…'
    );

    try {
      const result = await rpc(
        'createAdminBooking',
        payload
      );

      setText(
        'normalBookingMessage',
        `Booking created and approved. Reference: ${result.bookingId}`,
        'success'
      );

      e.target.reset();
      el('normalDuration').value = '2';

      await loadBookings();
      renderAvailabilityChart();
    } catch (err) {
      setText(
        'normalBookingMessage',
        err.message,
        'error'
      );
    } finally {
      button.disabled = false;
    }
  }
);

/* ============================================
   CREATE RECURRING BOOKINGS
============================================ */

function recurringDates() {
  const from = val('recurringFromDate');
  const until = val('recurringUntilDate');

  if (!from || !until || from > until) {
    return [];
  }

  let first = new Date(from + 'T00:00:00');
  let last = new Date(until + 'T00:00:00');

  if (isNaN(first) || isNaN(last)) {
    return [];
  }

  const weekday = Number(val('recurringWeekday'));

  first.setDate(
    first.getDate() +
    (weekday - first.getDay() + 7) % 7
  );

  const dates = [];

  for (
    const d = new Date(first);
    d <= last && dates.length <= 104;
    d.setDate(d.getDate() + 7)
  ) {
    dates.push(new Date(d));
  }

  return dates;
}

function renderRecurringPreview() {
  const dates = recurringDates();

  setText(
    'recurringCount',
    dates.length > 104
      ? 'More than 104 dates'
      : `${dates.length} occurrence${dates.length === 1 ? '' : 's'
      }`
  );

  el('recurringPreview').innerHTML =
    dates.slice(0, 8).map(d =>
      `<span>${htmlEscape(
        d.toLocaleDateString('en-MY', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
          year: 'numeric'
        })
      )}</span>`
    ).join('') +
    (
      dates.length > 8
        ? `<span>+${dates.length - 8} more</span>`
        : ''
    );
}

for (
  const input of el('recurringBookingForm')
    .querySelectorAll('input,select')
) {
  input.addEventListener(
    'input',
    renderRecurringPreview
  );

  input.addEventListener(
    'change',
    renderRecurringPreview
  );
}

el('recurringBookingForm').addEventListener(
  'submit',
  async e => {
    e.preventDefault();

    const dates = recurringDates();
    const button = el('createRecurringButton');

    if (!dates.length || dates.length > 104) {
      setText(
        'recurringMessage',
        'Choose a date range containing 1–104 matching weekdays.',
        'error'
      );
      return;
    }

    const start = val('recurringStartTime');
    const end = val('recurringEndTime');

    if (end <= start) {
      setText(
        'recurringMessage',
        'End time must follow start time.',
        'error'
      );
      return;
    }

    if (
      val('recurringPhone') &&
      !normalizeWhatsAppPhone(val('recurringPhone'))
    ) {
      setText(
        'recurringMessage',
        'Enter a valid phone number or leave it empty.',
        'error'
      );
      return;
    }

    const payload = {
      eventTitle: val('recurringEventTitle'),
      location: val('recurringVenue'),
      weekday: Number(val('recurringWeekday')),
      startTime: start,
      endTime: end,
      fromDate: val('recurringFromDate'),
      untilDate: val('recurringUntilDate'),

      organizer: val('recurringOrganizer'),
      memberCode:
        val('recurringMemberCode').toUpperCase(),

      phone: val('recurringPhone'),
      email: val('recurringEmail'),
      notes: val('recurringNotes')
    };

    button.disabled = true;

    setText(
      'recurringMessage',
      `Creating ${dates.length} recurring bookings…`
    );

    try {
      const result = await rpc(
        'createRecurringBookings',
        payload
      );

      setText(
        'recurringMessage',
        `Created ${result.createdCount} bookings. Skipped ${result.skippedCount} blocked/conflicting/error dates.`,
        'success'
      );

      if (result.skipped?.length) {
        console.info(
          'Skipped recurring dates:',
          result.skipped
        );
      }

      await loadBookings();
    } catch (err) {
      setText(
        'recurringMessage',
        err.message,
        'error'
      );
    } finally {
      button.disabled = false;
    }
  }
);

/* ============================================
   VENUE BLOCKS
============================================ */

/*
 * Automatically add weekly start/end date controls
 * to the existing admin.html.
 */
function ensureWeeklyBlockFields() {
  if (
    el('blockFromDate') &&
    el('blockUntilDate')
  ) return;

  const anchor = el('blockWeekdayField');

  if (!anchor) {
    throw new Error(
      'blockWeekdayField missing from admin.html'
    );
  }

  anchor.insertAdjacentHTML('afterend', `
    <div class="field" id="blockFromDateField" hidden>
      <label for="blockFromDate">Start date *</label>
      <input type="date" id="blockFromDate">
    </div>

    <div class="field" id="blockUntilDateField" hidden>
      <label for="blockUntilDate">
        End date
        <span class="optional">optional</span>
      </label>
      <input type="date" id="blockUntilDate">
    </div>
  `);
}

function syncBlockDateFields() {
  const weekly = val('blockType') === 'weekly';

  el('blockDateField').hidden = weekly;
  el('blockWeekdayField').hidden = !weekly;

  el('blockFromDateField').hidden = !weekly;
  el('blockUntilDateField').hidden = !weekly;

  el('blockDate').required = !weekly;
  el('blockFromDate').required = weekly;
}

ensureWeeklyBlockFields();

el('blockType').addEventListener(
  'change',
  syncBlockDateFields
);

function renderBlockedList() {
  const days = [
    'Sun', 'Mon', 'Tue', 'Wed',
    'Thu', 'Fri', 'Sat'
  ];

  if (!blockedRules.length) {
    el('blockedList').innerHTML =
      '<p class="muted">No venue blocks added.</p>';
    return;
  }

  el('blockedList').innerHTML = blockedRules.map(b => {
    const when = b.type === 'weekly'
      ? `Every ${days[b.weekday]} · ${b.fromDate
        ? 'From ' + b.fromDate
        : 'Legacy rule (no start date; inactive)'
      }${b.untilDate
        ? ' until ' + b.untilDate
        : ''
      }`
      : b.date;

    return `
      <div class="block-tag">
        <span>
          <strong>${htmlEscape(when)}</strong>
          · ${htmlEscape(b.venue || 'All venues')}
          · ${htmlEscape(
      b.startTime && b.endTime
        ? b.startTime + '–' + b.endTime
        : 'All day'
    )}
          ${b.reason
        ? ' · ' + htmlEscape(b.reason)
        : ''}
        </span>

        <button
          type="button"
          class="icon-button"
          data-delete-block="${htmlEscape(b.id)}"
          aria-label="Remove block">
          ✕
        </button>
      </div>
    `;
  }).join('');
}

el('blockedList').addEventListener('click', async e => {
  const button = e.target.closest(
    'button[data-delete-block]'
  );

  if (!button) return;

  if (!confirm('Remove this venue block?')) {
    return;
  }

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

    date:
      weekly ? '' : val('blockDate'),

    weekday:
      weekly
        ? Number(val('blockWeekday'))
        : undefined,

    fromDate:
      weekly ? val('blockFromDate') : '',

    untilDate:
      weekly ? val('blockUntilDate') : '',

    venue: val('blockVenue'),
    startTime: val('blockStartTime'),
    endTime: val('blockEndTime'),
    reason: val('blockReason')
  };

  if (!weekly && !payload.date) {
    setText(
      'blockMessage',
      'Select a specific date.',
      'error'
    );
    return;
  }

  if (weekly && !payload.fromDate) {
    setText(
      'blockMessage',
      'Select a weekly block start date.',
      'error'
    );
    return;
  }

  if (
    weekly &&
    payload.untilDate &&
    payload.untilDate < payload.fromDate
  ) {
    setText(
      'blockMessage',
      'End date must not be before start date.',
      'error'
    );
    return;
  }

  if (
    Boolean(payload.startTime) !==
    Boolean(payload.endTime)
  ) {
    setText(
      'blockMessage',
      'Provide both start and end times, or neither.',
      'error'
    );
    return;
  }

  if (
    payload.startTime &&
    payload.startTime >= payload.endTime
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

    el('blockFromDate').value =
      localDate(new Date());

    syncBlockDateFields();
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

/* ============================================
   AVAILABILITY TABLE
============================================ */

/*
 * Uses all bookings, regardless of dashboard filter.
 * The venue list comes from Google Sheets.
 */

const dateMatch = (b, date) =>
  b.start && localDate(b.start) === date;

function intersect(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function timeMins(time) {
  if (!time) return null;

  const [h, m] = time.split(':').map(Number);

  return h * 60 + m;
}

function findBlock(
  venue,
  date,
  weekday,
  startMins,
  endMins
) {
  return blockedRules.find(b => {
    if (b.venue && b.venue !== venue) {
      return false;
    }

    if (b.type === 'specific') {
      if (b.date !== date) return false;

    } else if (b.type === 'weekly') {

      // Legacy rules with no start date are inactive.
      if (!b.fromDate) return false;

      if (Number(b.weekday) !== weekday) {
        return false;
      }

      if (date < b.fromDate) {
        return false;
      }

      if (b.untilDate && date > b.untilDate) {
        return false;
      }

    } else {
      return false;
    }

    // No time = full-day block.
    if (!b.startTime || !b.endTime) {
      return true;
    }

    return (
      startMins < timeMins(b.endTime) &&
      endMins > timeMins(b.startTime)
    );
  });
}

function renderAvailabilityChart() {
  const day =
    val('adminAvailabilityDate') ||
    localDate(new Date());

  const date = new Date(
    day + 'T00:00:00'
  );

  if (isNaN(date.getTime())) return;

  const bookings = allBookings.filter(b =>
    b.status !== 'rejected' &&
    dateMatch(b, day)
  );

  let out =
    '<thead><tr><th>Time</th>' +
    venues.map(v =>
      `<th>${htmlEscape(v)}</th>`
    ).join('') +
    '</tr></thead><tbody>';

  for (let hour = 9; hour < 23; hour++) {
    const begin = new Date(date);
    begin.setHours(hour, 0, 0, 0);

    const end = new Date(
      begin.getTime() + 3600000
    );

    out += `
      <tr>
        <th>${htmlEscape(slotTime(begin))}</th>
    `;

    for (const v of venues) {
      const b = bookings.find(b =>
        b.venue === v &&
        b.end &&
        intersect(
          begin,
          end,
          b.start,
          b.end
        )
      );

      const blocked = findBlock(
        v,
        day,
        date.getDay(),
        hour * 60,
        (hour + 1) * 60
      );

      const state = b
        ? (
          b.status === 'pending'
            ? 'pending'
            : 'booked'
        )
        : blocked ? 'booked' : 'open';

      const label = b
        ? (
          b.status === 'pending'
            ? 'Pending'
            : 'Booked'
        )
        : blocked ? 'Blocked' : 'Available';

      const title = b
        ? b.title +
        (
          b.bookingType === 'recurringbooking'
            ? ' (Recurring)'
            : ''
        )
        : blocked
          ? (blocked.reason || 'Blocked')
          : 'Available';

      out += `
        <td
          class="slot ${state}"
          title="${htmlEscape(title)}">
          ${label}
        </td>
      `;
    }

    out += '</tr>';
  }

  out += '</tbody>';

  el('adminAvailabilityChart').innerHTML = out;

  setText(
    'adminAvailabilityMessage',
    `${bookings.length} active booking${bookings.length === 1 ? '' : 's'
    } for ${day}.`
  );
}

el('adminAvailabilityDate').addEventListener(
  'change',
  renderAvailabilityChart
);

/* ============================================
   INITIALIZATION
============================================ */

(function init() {
  const today = new Date();
  const threeMonths = new Date(today);

  threeMonths.setMonth(
    threeMonths.getMonth() + 3
  );

  el('adminAvailabilityDate').value =
    localDate(today);

  el('normalStart').value =
    localDateTime(
      new Date(Date.now() + 3600000)
    );

  el('recurringFromDate').value =
    localDate(today);

  el('recurringUntilDate').value =
    localDate(threeMonths);

  el('recurringStartTime').value = '13:30';
  el('recurringEndTime').value = '15:30';

  el('blockFromDate').value =
    localDate(today);

  syncBlockDateFields();
  renderRecurringPreview();

  if (token) {
    showDashboard();

    loadEverything().catch(err => {
      setText(
        'adminMessage',
        err.message,
        'error'
      );
    });
  } else {
    showLogin();
  }
})();
