/* ──────────────────────────────────────────────
   Church Venue Booking — admin.js  (v2)
   Changes from original:
   • Collapsible panels: Recurring, Block Dates, Availability Chart
   • Bookings default to future-only; sortable & filterable table
   • Member code shown in Requester column
   • Edit booking modal (Approve / Reject / Edit per row)
   • Admin can block specific date or every-weekday time range
   ────────────────────────────────────────────── */

const API_URL = 'https://script.google.com/macros/s/AKfycbys4YZOVsEX7kEz0RFaQe90h4ye3fpZEkFWgsGzqgbL9CERoLbdKhEOE-wLez76hC68/exec';

const rowsEl              = document.getElementById('adminBookingRows');
const messageEl           = document.getElementById('adminMessage');
const availabilityDate    = document.getElementById('adminAvailabilityDate');
const availabilityChart   = document.getElementById('adminAvailabilityChart');
const availabilityMessage = document.getElementById('adminAvailabilityMessage');
const recurringForm       = document.getElementById('recurringBookingForm');
const recurringVenue      = document.getElementById('recurringVenue');
const recurringCount      = document.getElementById('recurringCount');
const recurringMessage    = document.getElementById('recurringMessage');
const recurringPreview    = document.getElementById('recurringPreview');
const createRecurringBtn  = document.getElementById('createRecurringButton');

const DEFAULT_VENUES             = ['Main Hall', 'Chapel', 'Fellowship Room', 'Prayer Room', 'Youth Hall'];
const CHART_START_HOUR           = 9;
const CHART_END_HOUR             = 22;
const MAX_RECURRING_OCCURRENCES  = 104;

let allBookings        = [];
let availabilityBookings = [];
let venues             = [...DEFAULT_VENUES];
let sortState          = { col: 'start', dir: 'asc' };
let blockedRules       = JSON.parse(localStorage.getItem('adminBlockedRules') || '[]');

/* ════════════════════════════════════════════
   Collapsible panels
════════════════════════════════════════════ */
document.querySelectorAll('.collapsible-trigger').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel  = btn.closest('.collapsible-panel');
    const isOpen = panel.classList.toggle('open');
    btn.setAttribute('aria-expanded', isOpen);
  });
});

/* ════════════════════════════════════════════
   Utilities
════════════════════════════════════════════ */
function localDateValue(date) {
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function escapeHtml(v) {
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function readField(row, names) {
  if (!row || typeof row !== 'object') return '';
  const lm = Object.fromEntries(Object.keys(row).map(k => [k.toLowerCase(), row[k]]));
  for (const n of names) {
    if (row[n] !== undefined) return row[n];
    if (lm[n.toLowerCase()] !== undefined) return lm[n.toLowerCase()];
  }
  return '';
}

function parseStart(row) {
  const start = readField(row, ['start', 'startTime', 'dateTime', 'bookingStart']);
  const date  = readField(row, ['date', 'bookingDate']);
  const time  = readField(row, ['time', 'from', 'startHour']);
  const raw   = start || (date && time ? `${date}T${time}` : date);
  const parsed = raw ? new Date(raw) : null;
  return parsed && !isNaN(parsed) ? parsed : null;
}

function parseEnd(row, start) {
  const end = readField(row, ['end', 'endTime', 'bookingEnd']);
  const parsedEnd = end ? new Date(end) : null;
  if (parsedEnd && !isNaN(parsedEnd)) return parsedEnd;
  const dur = parseFloat(readField(row, ['duration', 'durationHours', 'hours']) || 1);
  return new Date(start.getTime() + (isFinite(dur) ? dur : 1) * 3600000);
}

function normalizeStatus(v) {
  const raw = String(v || 'pending').toLowerCase();
  if (raw.includes('reject') || raw.includes('cancel')) return 'rejected';
  if (raw.includes('approve') || raw.includes('booked') || raw.includes('confirm')) return 'approved';
  return 'pending';
}

function normalizeBookings(data) {
  const rows = Array.isArray(data) ? data : (data?.bookings || data?.data || []);
  if (!Array.isArray(rows)) return [];
  return rows.map((row, idx) => {
    const start = parseStart(row);
    const end   = start ? parseEnd(row, start) : null;
    const id    = String(readField(row, ['id','bookingId','rowId','ref','reference','referenceNumber']) || idx);
    const dur   = parseFloat(readField(row, ['duration','durationHours','hours']) || 1);
    return {
      raw: row, id,
      ref:        String(readField(row, ['ref','reference','referenceNumber','bookingRef']) || id),
      memberCode: String(readField(row, ['memberCode','member','memberId']) || ''),
      name:       String(readField(row, ['name','fullName','requester']) || ''),
      email:      String(readField(row, ['email','emailAddress']) || ''),
      phone:      String(readField(row, ['phone','phoneNumber','contact']) || ''),
      title:      String(readField(row, ['eventTitle','title','event']) || 'Untitled event'),
      venue:      String(readField(row, ['location','venue','room']) || 'Unassigned'),
      notes:      String(readField(row, ['notes','remarks','comment']) || ''),
      start, end,
      duration: isFinite(dur) ? dur : 1,
      status: normalizeStatus(readField(row, ['status','approvalStatus']))
    };
  });
}

function venueKey(v)  { return String(v || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function overlaps(as, ae, bs, be) { return as < be && ae > bs; }

function parseLocalDate(v) {
  const d = v ? new Date(`${v}T00:00:00`) : null;
  return d && !isNaN(d) ? d : null;
}

function formatDateTime(date) {
  if (!date) return 'Date not set';
  return date.toLocaleString('en-MY', {
    weekday: 'short', year: 'numeric', month: 'short',
    day: 'numeric', hour: '2-digit', minute: '2-digit'
  });
}

function formatSlotTime(date) {
  return date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
}

/* ════════════════════════════════════════════
   Messages
════════════════════════════════════════════ */
function setMessage(msg, state = '')             { messageEl.textContent = msg; messageEl.dataset.state = state; }
function setAvailabilityMessage(msg, state = '') { availabilityMessage.textContent = msg; availabilityMessage.dataset.state = state; }
function setRecurringMessage(msg, state = '')    { recurringMessage.textContent = msg; recurringMessage.dataset.state = state; }

/* ════════════════════════════════════════════
   Venue loading
════════════════════════════════════════════ */
async function loadVenues() {
  try {
    const res  = await fetch(`${API_URL}?action=getVenues`);
    const data = await res.json();
    const list = Array.isArray(data)
      ? data.map(v => String(typeof v === 'string' ? v : (v?.name || v?.venue || v?.location || '')).trim()).filter(Boolean)
      : [];
    if (list.length) venues = [...new Set(list)];
  } catch { /* use defaults */ }
  populateVenueSelects();
}

function populateVenueSelects() {
  const selects = [
    { id: 'recurringVenue',  placeholder: '<option value="">Select venue</option>' },
    { id: 'blockVenue',      placeholder: '<option value="">All venues</option>' },
    { id: 'filterVenue',     placeholder: '<option value="">All venues</option>' },
    { id: 'editLocation',    placeholder: '<option value="">— Select —</option>' }
  ];
  selects.forEach(({ id, placeholder }) => {
    const el = document.getElementById(id);
    if (!el) return;
    const cur = el.value;
    el.innerHTML = placeholder + venues.map(v =>
      `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join('');
    if (venues.includes(cur)) el.value = cur;
  });
}

/* ════════════════════════════════════════════
   Availability chart (admin)
════════════════════════════════════════════ */
function timeToMins(t) {
  if (!t) return null;
  const parts = String(t).split(':').map(Number);
  return isNaN(parts[0]) ? null : parts[0] * 60 + (parts[1] || 0);
}

function isBlocked(dateValue, hour, vkey) {
  const slotStart = hour * 60;
  const slotEnd   = slotStart + 60;

  for (const rule of blockedRules) {
    // 1. Venue match (empty = all venues)
    const venueMatch = !rule.venue || venueKey(rule.venue) === vkey;
    if (!venueMatch) continue;

    // 2. Date / weekday match
    let dateMatch = false;
    if (rule.type === 'specific') {
      dateMatch = rule.date === dateValue;
    } else if (rule.type === 'weekly') {
      const dow = new Date(`${dateValue}T00:00:00`).getDay();
      dateMatch = dow === parseInt(rule.weekday);
    }
    if (!dateMatch) continue;

    // 3. Time range match
    const hasTime = rule.startTime && rule.startTime.trim() &&
                    rule.endTime   && rule.endTime.trim();
    if (hasTime) {
      const rs = timeToMins(rule.startTime);
      const re = timeToMins(rule.endTime);
      if (rs === null || re === null || slotStart >= re || slotEnd <= rs) continue;
    }

    return rule.reason || 'Blocked';
  }
  return null;
}

function renderAvailabilityChart() {
  if (!availabilityChart || !availabilityDate) return;
  const dateValue = availabilityDate.value || localDateValue(new Date());
  const chartDay  = new Date(`${dateValue}T00:00:00`);
  const chartBookings = availabilityBookings.filter(b =>
    b.status !== 'rejected' && b.start && localDateValue(b.start) === dateValue
  );

  const head = `<thead><tr>
    <th scope="col">Time</th>
    ${venues.map(v => `<th scope="col">${escapeHtml(v)}</th>`).join('')}
  </tr></thead>`;

  const rows = [];
  for (let hour = CHART_START_HOUR; hour <= CHART_END_HOUR; hour++) {
    const slotStart = new Date(chartDay); slotStart.setHours(hour, 0, 0, 0);
    const slotEnd   = new Date(slotStart.getTime() + 3600000);

    const cells = venues.map(venue => {
      const booking = chartBookings.find(b =>
        venueKey(b.venue) === venueKey(venue) && b.end && overlaps(slotStart, slotEnd, b.start, b.end)
      );
      const blocked = !booking && isBlocked(dateValue, hour, venueKey(venue));
      if (blocked) {
        return `<td class="availability-cell availability-cell-booked" title="Blocked: ${escapeHtml(blocked)}"><span>Blocked</span></td>`;
      }
      const state = booking ? (booking.status === 'pending' ? 'pending' : 'booked') : 'open';
      const label = booking ? (booking.status === 'pending' ? 'Pending' : 'Approved') : 'Available';
      const title = booking ? `${booking.title}: ${formatSlotTime(booking.start)}–${formatSlotTime(booking.end)}` : 'Available';
      return `<td class="availability-cell availability-cell-${state}" title="${escapeHtml(title)}"><span>${label}</span></td>`;
    }).join('');

    rows.push(`<tr><th scope="row">${formatSlotTime(slotStart)}</th>${cells}</tr>`);
  }
  availabilityChart.innerHTML = `${head}<tbody>${rows.join('')}</tbody>`;
}

async function loadAdminAvailability() {
  const dateValue = availabilityDate.value || localDateValue(new Date());
  availabilityDate.value = dateValue;
  setAvailabilityMessage('Loading availability…', 'loading');
  renderAvailabilityChart();
  try {
    const res  = await fetch(`${API_URL}?action=getBookings&date=${encodeURIComponent(dateValue)}`);
    const data = await res.json();
    availabilityBookings = normalizeBookings(data);
    renderAvailabilityChart();
    const count = availabilityBookings.filter(b => b.status !== 'rejected' && b.start && localDateValue(b.start) === dateValue).length;
    setAvailabilityMessage(
      count ? `Showing ${count} booking${count === 1 ? '' : 's'} for ${dateValue}.` : `No bookings found for ${dateValue}.`,
      'ready'
    );
  } catch (err) {
    availabilityBookings = [];
    renderAvailabilityChart();
    setAvailabilityMessage('Could not load availability from Google Sheets.', 'error');
    console.error(err);
  }
}

availabilityDate?.addEventListener('change', loadAdminAvailability);
document.getElementById('adminAvailabilityRefresh')?.addEventListener('click', loadAdminAvailability);
document.getElementById('adminRefresh')?.addEventListener('click', () => { loadBookings(); loadAdminAvailability(); });

/* ════════════════════════════════════════════
   Recurring booking
════════════════════════════════════════════ */
function recurringOccurrences() {
  const from    = parseLocalDate(document.getElementById('recurringFromDate').value);
  const until   = parseLocalDate(document.getElementById('recurringUntilDate').value);
  const weekday = Number(document.getElementById('recurringWeekday').value);
  if (!from || !until || from > until || !Number.isInteger(weekday)) return [];

  const first = new Date(from);
  first.setDate(first.getDate() + ((weekday - first.getDay() + 7) % 7));

  const occ = [];
  for (const d = new Date(first); d <= until && occ.length < MAX_RECURRING_OCCURRENCES; d.setDate(d.getDate() + 7)) {
    occ.push(new Date(d));
  }
  return occ;
}

function validateRecurring() {
  const title    = document.getElementById('recurringEventTitle').value.trim();
  const venue    = recurringVenue.value;
  const start    = document.getElementById('recurringStartTime').value;
  const end      = document.getElementById('recurringEndTime').value;
  const from     = parseLocalDate(document.getElementById('recurringFromDate').value);
  const until    = parseLocalDate(document.getElementById('recurringUntilDate').value);
  const occ      = recurringOccurrences();
  if (!title || !venue || !start || !end || !from || !until) return 'Complete all required recurring booking fields.';
  if (from > until) return 'The until date must be on or after the from date.';
  if (end <= start)  return 'End time must be later than start time.';
  if (!occ.length)   return 'No matching weekday occurs in this date range.';
  return '';
}

function renderRecurringPreview() {
  const occ     = recurringOccurrences();
  const visible = occ.slice(0, 8);
  if (recurringCount) recurringCount.textContent = `${Math.min(occ.length, MAX_RECURRING_OCCURRENCES)} occurrence${occ.length === 1 ? '' : 's'}`;
  if (recurringPreview) {
    recurringPreview.innerHTML = visible.map(d =>
      `<span>${escapeHtml(d.toLocaleDateString('en-MY', { weekday:'short', day:'numeric', month:'short', year:'numeric' }))}</span>`
    ).join('') + (occ.length > visible.length ? `<span>+${occ.length - visible.length} more</span>` : '');
  }
}

recurringForm?.querySelectorAll('input, select').forEach(el => {
  el.addEventListener('input',  renderRecurringPreview);
  el.addEventListener('change', renderRecurringPreview);
});

recurringForm?.addEventListener('submit', async e => {
  e.preventDefault();
  const err = validateRecurring();
  if (err) { setRecurringMessage(err, 'error'); return; }

  const occ = recurringOccurrences();
  createRecurringBtn.disabled   = true;
  createRecurringBtn.textContent = 'Creating…';
  setRecurringMessage(`Creating ${occ.length} recurring bookings…`, 'loading');

  const payload = {
    action:     'createRecurringBookings',
    eventTitle: document.getElementById('recurringEventTitle').value.trim(),
    location:   recurringVenue.value,
    weekday:    Number(document.getElementById('recurringWeekday').value),
    startTime:  document.getElementById('recurringStartTime').value,
    endTime:    document.getElementById('recurringEndTime').value,
    fromDate:   document.getElementById('recurringFromDate').value,
    untilDate:  document.getElementById('recurringUntilDate').value,
    organizer:  document.getElementById('recurringOrganizer').value.trim() || 'Church Admin',
    memberCode: document.getElementById('recurringMemberCode').value.trim() || 'ADMIN',
    phone:      document.getElementById('recurringPhone').value.trim(),
    status:     'Approved'
  };

  try {
    const res    = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    const result = await res.json();
    if (result.success !== true) throw new Error(result.message || result.error || 'Failed to create recurring bookings.');
    const created = Number(result.createdCount ?? result.created ?? occ.length);
    const skipped = Number(result.skippedCount ?? result.skipped ?? 0);
    setRecurringMessage(
      `Created ${created} approved booking${created === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} conflicting date${skipped === 1 ? '' : 's'}` : ''}.`,
      'success'
    );
    await Promise.all([loadBookings(), loadAdminAvailability()]);
  } catch (err) {
    setRecurringMessage(`Could not create recurring bookings. ${err.message}`, 'error');
    console.error(err);
  } finally {
    createRecurringBtn.disabled   = false;
    createRecurringBtn.textContent = 'Create Recurring Bookings';
  }
});

/* ════════════════════════════════════════════
   Block dates / times
════════════════════════════════════════════ */
document.querySelectorAll('input[name="blockType"]').forEach(radio => {
  radio.addEventListener('change', () => {
    const weekly = radio.value === 'weekly';
    document.getElementById('blockDateField').style.display    = weekly ? 'none' : '';
    document.getElementById('blockWeekdayField').style.display = weekly ? ''     : 'none';
  });
});

function saveBlockedRules() { localStorage.setItem('adminBlockedRules', JSON.stringify(blockedRules)); }

function renderBlockedList() {
  const list = document.getElementById('blockedList');
  if (!list) return;
  if (!blockedRules.length) {
    list.innerHTML = '<span style="color:var(--text-muted);font-size:12px;">No blocks set.</span>';
    return;
  }
  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  list.innerHTML = blockedRules.map((rule, idx) => {
    const when   = rule.type === 'weekly' ? `Every ${DAYS[rule.weekday]}` : rule.date;
    const venue  = rule.venue ? ` · ${rule.venue}` : ' · All venues';
    const time   = rule.startTime ? ` · ${rule.startTime}–${rule.endTime}` : ' · Full day';
    const reason = rule.reason ? ` — ${rule.reason}` : '';
    return `<span class="blocked-tag">${escapeHtml(when + venue + time + reason)}
      <button type="button" data-idx="${idx}" aria-label="Remove block">✕</button></span>`;
  }).join('');
}

document.getElementById('blockedList')?.addEventListener('click', async e => {
  const btn = e.target.closest('button[data-idx]');
  if (!btn) return;
  const idx  = parseInt(btn.dataset.idx);
  const rule = blockedRules[idx];
  // Tell server to delete if it has an id
  if (rule && rule.id) {
    fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'deleteBlock', id: rule.id }) }).catch(() => {});
  }
  blockedRules.splice(idx, 1);
  saveBlockedRules(); renderBlockedList(); renderAvailabilityChart();
});

document.getElementById('blockForm')?.addEventListener('submit', async e => {
  e.preventDefault();
  const msgEl   = document.getElementById('blockMessage');
  const weekly  = document.querySelector('input[name="blockType"]:checked').value === 'weekly';
  const rule = {
    type:      weekly ? 'weekly' : 'specific',
    date:      !weekly ? document.getElementById('blockDate').value : undefined,
    weekday:   weekly  ? parseInt(document.getElementById('blockWeekday').value) : undefined,
    venue:     document.getElementById('blockVenue').value,
    startTime: document.getElementById('blockStartTime').value || null,
    endTime:   document.getElementById('blockEndTime').value   || null,
    reason:    document.getElementById('blockReason').value.trim()
  };
  if (!weekly && !rule.date)               { msgEl.textContent = 'Please select a date.'; msgEl.dataset.state = 'error'; return; }
  if (rule.startTime && !rule.endTime)     { msgEl.textContent = 'Please set an end time.'; msgEl.dataset.state = 'error'; return; }

  // Disable submit button while saving
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) submitBtn.disabled = true;
  msgEl.textContent = 'Saving…'; msgEl.dataset.state = '';

  // Send to server first — blocks must persist server-side so index.html can read them
  try {
    const res    = await fetch(API_URL, { method: 'POST', body: JSON.stringify({ action: 'addBlock', ...rule }) });
    const result = await res.json();
    if (result.success === false) throw new Error(result.message || 'Server rejected the block.');
    if (result.id) rule.id = result.id; // store server id for future deletion
  } catch (err) {
    msgEl.textContent = `Could not save block to server: ${err.message}. Check your connection and try again.`;
    msgEl.dataset.state = 'error';
    if (submitBtn) submitBtn.disabled = false;
    return;
  }

  blockedRules.push(rule);
  saveBlockedRules();
  renderBlockedList();
  // If block is for a specific date, jump the chart to that date so changes are visible immediately
  if (rule.type === 'specific' && rule.date && availabilityDate.value !== rule.date) {
    availabilityDate.value = rule.date;
    loadAdminAvailability();
  } else {
    renderAvailabilityChart();
  }
  e.target.reset();
  document.getElementById('blockDateField').style.display    = '';
  document.getElementById('blockWeekdayField').style.display = 'none';
  document.querySelectorAll('input[name="blockType"]')[0].checked = true;
  if (submitBtn) submitBtn.disabled = false;
  msgEl.textContent = 'Block added.'; msgEl.dataset.state = 'success';
  setTimeout(() => { msgEl.textContent = ''; }, 3000);
});

/* ════════════════════════════════════════════
   Filter + Sort + Render bookings table
════════════════════════════════════════════ */
function getFilters() {
  return {
    fromDate: document.getElementById('filterFromDate')?.value || '',
    toDate:   document.getElementById('filterToDate')?.value   || '',
    venue:    document.getElementById('filterVenue')?.value    || '',
    status:   document.getElementById('filterStatus')?.value   || '',
    search:   (document.getElementById('filterSearch')?.value || '').toLowerCase().trim(),
    time:     document.getElementById('filterFuture')?.value   || 'future'
  };
}

function applyFilters(bookings) {
  const f   = getFilters();
  const now = new Date();
  return bookings.filter(b => {
    if (!b.start) return f.time === 'all';
    if (f.time === 'future' && b.start <= now) return false;
    if (f.time === 'past'   && b.start >= now) return false;
    if (f.fromDate && localDateValue(b.start) < f.fromDate) return false;
    if (f.toDate   && localDateValue(b.start) > f.toDate)   return false;
    if (f.venue  && venueKey(b.venue) !== venueKey(f.venue)) return false;
    if (f.status && b.status !== f.status) return false;
    if (f.search) {
      const hay = `${b.name} ${b.title} ${b.memberCode} ${b.email} ${b.ref}`.toLowerCase();
      if (!hay.includes(f.search)) return false;
    }
    return true;
  });
}

function applySort(bookings) {
  const { col, dir } = sortState;
  return [...bookings].sort((a, b) => {
    const map = { ref: 'ref', event: 'title', name: 'name', venue: 'venue', start: 'start', status: 'status' };
    const key = map[col] || 'start';
    const av = a[key], bv = b[key];
    const cmp = av < bv ? -1 : av > bv ? 1 : 0;
    return dir === 'asc' ? cmp : -cmp;
  });
}

function updateCounts(filtered) {
  document.getElementById('totalCount').textContent    = filtered.length;
  document.getElementById('pendingCount').textContent  = filtered.filter(b => b.status === 'pending').length;
  document.getElementById('approvedCount').textContent = filtered.filter(b => b.status === 'approved').length;
  document.getElementById('rejectedCount').textContent = filtered.filter(b => b.status === 'rejected').length;
}

function renderRows() {
  const filtered = applyFilters(allBookings);
  const sorted   = applySort(filtered);
  updateCounts(filtered);

  // Update sort icons
  document.querySelectorAll('.sort-icon').forEach(icon => {
    const col = icon.dataset.col;
    if (col === sortState.col) {
      icon.classList.add('active');
      icon.textContent = sortState.dir === 'asc' ? '↑' : '↓';
    } else {
      icon.classList.remove('active');
      icon.textContent = '↕';
    }
  });

  if (!sorted.length) {
    rowsEl.innerHTML = `<tr><td colspan="7" class="empty-cell">No bookings match the current filters.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = sorted.map(b => {
    const isPending  = b.status === 'pending';
    const isRejected = b.status === 'rejected';
    const statusClass = isPending ? 'pending' : isRejected ? 'rejected' : 'approved';
    const statusLabel = isPending ? 'Pending'  : isRejected ? 'Rejected'  : 'Approved';

    return `<tr data-id="${escapeHtml(b.id)}">
      <td><strong>${escapeHtml(b.ref || '—')}</strong></td>
      <td>
        <strong>${escapeHtml(b.title)}</strong>
        <span>${escapeHtml(b.notes || '')}</span>
      </td>
      <td>
        <strong>${escapeHtml(b.name || 'Unknown')}</strong>
        <span>${escapeHtml(b.memberCode || '—')}</span>
        <span>${escapeHtml([b.email, b.phone].filter(Boolean).join(' | ') || '')}</span>
      </td>
      <td><strong>${escapeHtml(b.venue)}</strong></td>
      <td>
        <strong>${formatDateTime(b.start)}</strong>
        <span>${b.end ? 'Until ' + formatDateTime(b.end) : ''}</span>
      </td>
      <td><span class="status-pill status-${statusClass}">${statusLabel}</span></td>
      <td>
        <div class="admin-actions">
          <button class="btn-approve" data-action="approved" data-id="${escapeHtml(b.id)}" ${!isPending ? 'disabled' : ''}>Approve</button>
          <button class="btn-reject"  data-action="rejected" data-id="${escapeHtml(b.id)}" ${isRejected  ? 'disabled' : ''}>Reject</button>
          <button class="btn-edit"    data-action="edit"     data-id="${escapeHtml(b.id)}">Edit</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

/* Sort on column header click */
document.querySelectorAll('.admin-table th[data-sort]').forEach(th => {
  th.addEventListener('click', () => {
    const col = th.dataset.sort;
    sortState = sortState.col === col
      ? { col, dir: sortState.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'asc' };
    renderRows();
  });
});

/* Filter bar listeners */
['filterFromDate','filterToDate','filterVenue','filterStatus','filterFuture'].forEach(id => {
  document.getElementById(id)?.addEventListener('change', renderRows);
});
document.getElementById('filterSearch')?.addEventListener('input', renderRows);

document.getElementById('resetFilters')?.addEventListener('click', () => {
  ['filterFromDate','filterToDate','filterSearch'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  const fv = document.getElementById('filterVenue');   if (fv) fv.value = '';
  const fs = document.getElementById('filterStatus');  if (fs) fs.value = '';
  const ff = document.getElementById('filterFuture');  if (ff) ff.value = 'future';
  renderRows();
});

/* ════════════════════════════════════════════
   Load bookings from server
════════════════════════════════════════════ */
async function loadBookings() {
  setMessage('Loading bookings…', 'loading');
  rowsEl.innerHTML = '<tr><td colspan="7" class="empty-cell">Loading bookings…</td></tr>';
  try {
    const res  = await fetch(`${API_URL}?action=getBookings`);
    const data = await res.json();
    allBookings = normalizeBookings(data);
    renderRows();
    const vis = applyFilters(allBookings);
    setMessage(`Showing ${vis.length} booking${vis.length === 1 ? '' : 's'}.`, 'ready');
  } catch (err) {
    allBookings = [];
    renderRows();
    setMessage('Could not load bookings from Google Sheets.', 'error');
    console.error(err);
  }
}

/* ════════════════════════════════════════════
   Approve / Reject (delegated)
════════════════════════════════════════════ */
async function updateBookingStatus(bookingId, status) {
  const booking = allBookings.find(b => b.id === bookingId);
  if (!booking) return;

  const prev = booking.status;
  booking.status = status;
  renderRows();
  setMessage(`Updating ${booking.ref}…`, 'loading');

  const payload = {
    action:    status === 'approved' ? 'approveBooking' : 'rejectBooking',
    bookingId: booking.id, id: booking.id,
    ref: booking.ref, reference: booking.ref, status
  };

  try {
    const res    = await fetch(API_URL, { method: 'POST', body: JSON.stringify(payload) });
    const result = await res.json();
    if (result.success === false) throw new Error(result.message || 'Server did not update this booking.');
    setMessage(`${booking.ref} has been ${status}.`, 'ready');
    await Promise.all([loadBookings(), loadAdminAvailability()]);
  } catch (err) {
    booking.status = prev;
    renderRows();
    setMessage(`Could not update ${booking.ref}. Check your Apps Script supports ${payload.action}.`, 'error');
    console.error(err);
  }
}

/* ════════════════════════════════════════════
   Edit modal
════════════════════════════════════════════ */
function openEditModal(booking) {
  document.getElementById('editRef').value        = booking.id;
  document.getElementById('editMemberCode').value = booking.memberCode;
  document.getElementById('editName').value       = booking.name;
  document.getElementById('editEmail').value      = booking.email;
  document.getElementById('editPhone').value      = booking.phone;
  document.getElementById('editEventTitle').value = booking.title;
  document.getElementById('editDuration').value   = booking.duration;
  document.getElementById('editNotes').value      = booking.notes;

  if (booking.start) {
    const local = new Date(booking.start.getTime() - booking.start.getTimezoneOffset() * 60000)
      .toISOString().slice(0, 16);
    document.getElementById('editStart').value = local;
  }

  populateVenueSelects();
  document.getElementById('editLocation').value = booking.venue;
  document.getElementById('editMessage').textContent = '';
  document.getElementById('editModal').hidden = false;
  document.body.style.overflow = 'hidden';
}

function closeEditModal() {
  document.getElementById('editModal').hidden = true;
  document.body.style.overflow = '';
}

document.getElementById('editCancelBtn')?.addEventListener('click', closeEditModal);
document.getElementById('editModal')?.addEventListener('click', e => {
  if (e.target === document.getElementById('editModal')) closeEditModal();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('editModal').hidden) closeEditModal();
});

document.getElementById('editSaveBtn')?.addEventListener('click', async () => {
  const id      = document.getElementById('editRef').value;
  const booking = allBookings.find(b => b.id === id);
  if (!booking) return;

  const updated = {
    action:     'editBooking',
    id, ref: booking.ref,
    memberCode: document.getElementById('editMemberCode').value.trim().toUpperCase(),
    name:       document.getElementById('editName').value.trim(),
    email:      document.getElementById('editEmail').value.trim(),
    phone:      document.getElementById('editPhone').value.trim(),
    eventTitle: document.getElementById('editEventTitle').value.trim(),
    start:      document.getElementById('editStart').value,
    duration:   parseFloat(document.getElementById('editDuration').value),
    location:   document.getElementById('editLocation').value,
    notes:      document.getElementById('editNotes').value.trim()
  };

  const msgEl = document.getElementById('editMessage');
  const saveBtn = document.getElementById('editSaveBtn');
  saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; msgEl.textContent = '';

  try {
    const res    = await fetch(API_URL, { method: 'POST', body: JSON.stringify(updated) });
    const result = await res.json();
    if (result.success === false) throw new Error(result.message || 'Failed to save changes.');
    // Update local copy
    Object.assign(booking, {
      memberCode: updated.memberCode, name: updated.name,
      email: updated.email, phone: updated.phone,
      title: updated.eventTitle,
      start: new Date(updated.start),
      end:   new Date(new Date(updated.start).getTime() + updated.duration * 3600000),
      duration: updated.duration, venue: updated.location, notes: updated.notes
    });
    closeEditModal();
    renderRows();
    loadAdminAvailability();
  } catch (err) {
    msgEl.textContent = err.message || 'Network error. Please try again.';
    console.error(err);
  } finally {
    saveBtn.disabled = false; saveBtn.textContent = 'Save Changes';
  }
});

/* Delegated click handler for Approve / Reject / Edit buttons */
rowsEl.addEventListener('click', e => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'edit') {
    const booking = allBookings.find(b => b.id === id);
    if (booking) openEditModal(booking);
  } else {
    updateBookingStatus(id, action);
  }
});

/* ════════════════════════════════════════════
   Boot
════════════════════════════════════════════ */
(async () => {
  const today            = new Date();
  const threeMonthsLater = new Date(today);
  threeMonthsLater.setMonth(threeMonthsLater.getMonth() + 3);

  availabilityDate.value = localDateValue(today);
  document.getElementById('recurringFromDate').value  = localDateValue(today);
  document.getElementById('recurringUntilDate').value = localDateValue(threeMonthsLater);
  document.getElementById('recurringStartTime').value = '13:30';
  document.getElementById('recurringEndTime').value   = '15:30';

  renderRecurringPreview();
  renderBlockedList();

  await loadVenues();
  // load bookings and availability in parallel
  await Promise.all([loadBookings(), loadAdminAvailability()]);
})();