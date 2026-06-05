const API_URL = 'https://script.google.com/macros/s/AKfycbys4YZOVsEX7kEz0RFaQe90h4ye3fpZEkFWgsGzqgbL9CERoLbdKhEOE-wLez76hC68/exec';

const statusFilter = document.getElementById('adminStatus');
const dateFilter = document.getElementById('adminDate');
const refreshButton = document.getElementById('adminRefresh');
const rowsEl = document.getElementById('adminBookingRows');
const messageEl = document.getElementById('adminMessage');

let bookings = [];

function localDateValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function setMessage(message, state = '') {
  messageEl.textContent = message;
  messageEl.dataset.state = state;
}

function readField(row, names) {
  if (!row || typeof row !== 'object') return '';
  const lowerMap = Object.fromEntries(Object.keys(row).map(key => [key.toLowerCase(), row[key]]));
  for (const name of names) {
    if (row[name] !== undefined) return row[name];
    if (lowerMap[name.toLowerCase()] !== undefined) return lowerMap[name.toLowerCase()];
  }
  return '';
}

function parseStart(row) {
  const start = readField(row, ['start', 'startTime', 'dateTime', 'bookingStart']);
  const date = readField(row, ['date', 'bookingDate']);
  const time = readField(row, ['time', 'from', 'startHour']);
  const raw = start || (date && time ? `${date}T${time}` : date);
  const parsed = raw ? new Date(raw) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function parseEnd(row, start) {
  const end = readField(row, ['end', 'endTime', 'bookingEnd']);
  const parsedEnd = end ? new Date(end) : null;
  if (parsedEnd && !Number.isNaN(parsedEnd.getTime())) return parsedEnd;

  const duration = parseFloat(readField(row, ['duration', 'durationHours', 'hours']) || 1);
  return new Date(start.getTime() + (Number.isFinite(duration) ? duration : 1) * 3600000);
}

function normalizeStatus(value) {
  const raw = String(value || 'pending').toLowerCase();
  if (raw.includes('reject')) return 'rejected';
  if (raw.includes('approve') || raw.includes('booked') || raw.includes('confirm')) return 'approved';
  return 'pending';
}

function normalizeBookings(data) {
  const rows = Array.isArray(data) ? data : (data?.bookings || data?.data || []);
  if (!Array.isArray(rows)) return [];

  return rows.map((row, index) => {
    const start = parseStart(row);
    const end = start ? parseEnd(row, start) : null;
    const id = String(readField(row, ['id', 'bookingId', 'rowId', 'ref', 'reference', 'referenceNumber']) || index);

    return {
      raw: row,
      id,
      ref: String(readField(row, ['ref', 'reference', 'referenceNumber', 'bookingRef']) || id),
      memberCode: String(readField(row, ['memberCode', 'member', 'memberId']) || ''),
      name: String(readField(row, ['name', 'fullName', 'requester']) || ''),
      email: String(readField(row, ['email', 'emailAddress']) || ''),
      phone: String(readField(row, ['phone', 'phoneNumber', 'contact']) || ''),
      title: String(readField(row, ['eventTitle', 'title', 'event']) || 'Untitled event'),
      venue: String(readField(row, ['location', 'venue', 'room']) || 'Unassigned'),
      notes: String(readField(row, ['notes', 'remarks', 'comment']) || ''),
      start,
      end,
      status: normalizeStatus(readField(row, ['status', 'approvalStatus']))
    };
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateTime(date) {
  if (!date) return 'Date not set';
  return date.toLocaleString('en-MY', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatSchedule(booking) {
  if (!booking.start) return 'Date not set';
  return `${formatDateTime(booking.start)}<br><span>${booking.end ? `Until ${formatDateTime(booking.end)}` : ''}</span>`;
}

function visibleBookings() {
  const status = statusFilter.value;
  const date = dateFilter.value;

  return bookings.filter(booking => {
    const statusMatch = status === 'all' || booking.status === status;
    const dateMatch = !date || (booking.start && localDateValue(booking.start) === date);
    return statusMatch && dateMatch;
  });
}

function updateCounts() {
  document.getElementById('totalCount').textContent = bookings.length;
  document.getElementById('pendingCount').textContent = bookings.filter(b => b.status === 'pending').length;
  document.getElementById('approvedCount').textContent = bookings.filter(b => b.status === 'approved').length;
  document.getElementById('rejectedCount').textContent = bookings.filter(b => b.status === 'rejected').length;
}

function renderRows() {
  const rows = visibleBookings();
  updateCounts();

  if (!rows.length) {
    rowsEl.innerHTML = '<tr><td colspan="7" class="empty-cell">No bookings match the selected filters.</td></tr>';
    return;
  }

  rowsEl.innerHTML = rows.map(booking => {
    const approveDisabled = booking.status === 'approved' ? 'disabled' : '';
    const rejectDisabled = booking.status === 'rejected' ? 'disabled' : '';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(booking.ref)}</strong>
          <span>${escapeHtml(booking.memberCode)}</span>
        </td>
        <td>
          <strong>${escapeHtml(booking.title)}</strong>
          <span>${escapeHtml(booking.notes || 'No notes')}</span>
        </td>
        <td>
          <strong>${escapeHtml(booking.name || 'Unknown')}</strong>
          <span>${escapeHtml([booking.email, booking.phone].filter(Boolean).join(' | ') || 'No contact')}</span>
        </td>
        <td>${escapeHtml(booking.venue)}</td>
        <td>${formatSchedule(booking)}</td>
        <td><span class="status-pill status-${booking.status}">${booking.status}</span></td>
        <td>
          <div class="admin-actions">
            <button type="button" class="btn-approve" data-action="approved" data-id="${escapeHtml(booking.id)}" ${approveDisabled}>Approve</button>
            <button type="button" class="btn-reject" data-action="rejected" data-id="${escapeHtml(booking.id)}" ${rejectDisabled}>Reject</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function loadBookings() {
  setMessage('Loading bookings...', 'loading');
  rowsEl.innerHTML = '<tr><td colspan="7" class="empty-cell">Loading bookings...</td></tr>';

  const params = new URLSearchParams({ action: 'getBookings' });
  if (dateFilter.value) params.set('date', dateFilter.value);
  if (statusFilter.value !== 'all') params.set('status', statusFilter.value);

  try {
    const res = await fetch(`${API_URL}?${params.toString()}`);
    const data = await res.json();
    bookings = normalizeBookings(data);
    renderRows();
    setMessage(`Showing ${visibleBookings().length} booking${visibleBookings().length === 1 ? '' : 's'}.`, 'ready');
  } catch (err) {
    bookings = [];
    renderRows();
    setMessage('Could not load bookings from Google Sheets. Check that your Apps Script supports getBookings.', 'error');
    console.error('Admin load error:', err);
  }
}

async function updateBookingStatus(bookingId, status) {
  const booking = bookings.find(item => item.id === bookingId);
  if (!booking) return;

  const previousStatus = booking.status;
  booking.status = status;
  renderRows();
  setMessage(`Updating ${booking.ref}...`, 'loading');

  const payload = {
    action: status === 'approved' ? 'approveBooking' : 'rejectBooking',
    bookingId: booking.id,
    id: booking.id,
    ref: booking.ref,
    reference: booking.ref,
    status
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success === false) {
      throw new Error(result.message || 'The server did not update this booking.');
    }

    setMessage(`${booking.ref} has been ${status}.`, 'ready');
    loadBookings();
  } catch (err) {
    booking.status = previousStatus;
    renderRows();
    setMessage(`Could not update ${booking.ref}. Check that your Apps Script supports ${payload.action}.`, 'error');
    console.error('Admin update error:', err);
  }
}

rowsEl.addEventListener('click', event => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;

  updateBookingStatus(button.dataset.id, button.dataset.action);
});

refreshButton.addEventListener('click', loadBookings);
statusFilter.addEventListener('change', () => {
  renderRows();
  setMessage(`Showing ${visibleBookings().length} booking${visibleBookings().length === 1 ? '' : 's'}.`, 'ready');
});
dateFilter.addEventListener('change', loadBookings);

loadBookings();
