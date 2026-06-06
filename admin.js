const API_URL = 'https://script.google.com/macros/s/AKfycbys4YZOVsEX7kEz0RFaQe90h4ye3fpZEkFWgsGzqgbL9CERoLbdKhEOE-wLez76hC68/exec';

const statusFilter = document.getElementById('adminStatus');
const dateFilter = document.getElementById('adminDate');
const refreshButton = document.getElementById('adminRefresh');
const rowsEl = document.getElementById('adminBookingRows');
const messageEl = document.getElementById('adminMessage');
const availabilityDate = document.getElementById('adminAvailabilityDate');
const availabilityRefresh = document.getElementById('adminAvailabilityRefresh');
const availabilityChart = document.getElementById('adminAvailabilityChart');
const availabilityMessage = document.getElementById('adminAvailabilityMessage');
const recurringForm = document.getElementById('recurringBookingForm');
const recurringVenue = document.getElementById('recurringVenue');
const recurringCount = document.getElementById('recurringCount');
const recurringMessage = document.getElementById('recurringMessage');
const recurringPreview = document.getElementById('recurringPreview');
const createRecurringButton = document.getElementById('createRecurringButton');

const DEFAULT_VENUES = ['Main Hall', 'Chapel', 'Fellowship Room', 'Prayer Room', 'Youth Hall'];
const CHART_START_HOUR = 8;
const CHART_END_HOUR = 22;
const MAX_RECURRING_OCCURRENCES = 104;

let bookings = [];
let availabilityBookings = [];
let venues = [...DEFAULT_VENUES];

function localDateValue(date) {
  const offsetDate = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return offsetDate.toISOString().slice(0, 10);
}

function setMessage(message, state = '') {
  messageEl.textContent = message;
  messageEl.dataset.state = state;
}

function setAvailabilityMessage(message, state = '') {
  availabilityMessage.textContent = message;
  availabilityMessage.dataset.state = state;
}

function setRecurringMessage(message, state = '') {
  recurringMessage.textContent = message;
  recurringMessage.dataset.state = state;
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

function formatSlotTime(date) {
  return date.toLocaleTimeString('en-MY', { hour: 'numeric', minute: '2-digit' });
}

function parseLocalDate(value) {
  const date = value ? new Date(`${value}T00:00:00`) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function recurringOccurrences() {
  const from = parseLocalDate(document.getElementById('recurringFromDate').value);
  const until = parseLocalDate(document.getElementById('recurringUntilDate').value);
  const weekday = Number(document.getElementById('recurringWeekday').value);

  if (!from || !until || from > until || !Number.isInteger(weekday)) return [];

  const first = new Date(from);
  first.setDate(first.getDate() + ((weekday - first.getDay() + 7) % 7));

  const occurrences = [];
  for (const date = new Date(first); date <= until && occurrences.length <= MAX_RECURRING_OCCURRENCES; date.setDate(date.getDate() + 7)) {
    occurrences.push(new Date(date));
  }

  return occurrences;
}

function validateRecurringBooking() {
  const title = document.getElementById('recurringEventTitle').value.trim();
  const venue = recurringVenue.value;
  const startTime = document.getElementById('recurringStartTime').value;
  const endTime = document.getElementById('recurringEndTime').value;
  const from = parseLocalDate(document.getElementById('recurringFromDate').value);
  const until = parseLocalDate(document.getElementById('recurringUntilDate').value);
  const occurrences = recurringOccurrences();

  if (!title || !venue || !startTime || !endTime || !from || !until) {
    return 'Complete all required recurring booking fields.';
  }
  if (from > until) return 'The until date must be on or after the from date.';
  if (endTime <= startTime) return 'The end time must be later than the start time.';
  if (!occurrences.length) return 'No matching weekday occurs inside this date range.';
  if (occurrences.length > MAX_RECURRING_OCCURRENCES) {
    return `A recurring booking can contain at most ${MAX_RECURRING_OCCURRENCES} occurrences.`;
  }
  return '';
}

function renderRecurringPreview() {
  const occurrences = recurringOccurrences();
  const visibleOccurrences = occurrences.slice(0, 8);

  recurringCount.textContent = `${Math.min(occurrences.length, MAX_RECURRING_OCCURRENCES)} occurrence${occurrences.length === 1 ? '' : 's'}`;
  recurringPreview.innerHTML = visibleOccurrences.map(date =>
    `<span>${escapeHtml(date.toLocaleDateString('en-MY', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }))}</span>`
  ).join('') + (occurrences.length > visibleOccurrences.length ? `<span>+${occurrences.length - visibleOccurrences.length} more</span>` : '');
}

function venueKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function renderAvailabilityChart() {
  const dateValue = availabilityDate.value || localDateValue(new Date());
  const chartDay = new Date(`${dateValue}T00:00:00`);
  const chartBookings = availabilityBookings.filter(booking =>
    booking.status !== 'rejected' &&
    booking.start &&
    localDateValue(booking.start) === dateValue
  );

  const head = `
    <thead>
      <tr>
        <th scope="col">Time</th>
        ${venues.map(venue => `<th scope="col">${escapeHtml(venue)}</th>`).join('')}
      </tr>
    </thead>
  `;

  const rows = [];
  for (let hour = CHART_START_HOUR; hour < CHART_END_HOUR; hour++) {
    const slotStart = new Date(chartDay);
    slotStart.setHours(hour, 0, 0, 0);
    const slotEnd = new Date(slotStart.getTime() + 3600000);

    const cells = venues.map(venue => {
      const booking = chartBookings.find(item =>
        venueKey(item.venue) === venueKey(venue) &&
        item.end &&
        overlaps(slotStart, slotEnd, item.start, item.end)
      );
      const state = booking ? (booking.status === 'pending' ? 'pending' : 'booked') : 'open';
      const label = booking ? (booking.status === 'pending' ? 'Pending' : 'Approved') : 'Available';
      const title = booking
        ? `${booking.title}: ${formatSlotTime(booking.start)}-${formatSlotTime(booking.end)}`
        : 'Available';

      return `
        <td class="availability-cell availability-cell-${state}" title="${escapeHtml(title)}">
          <span>${label}</span>
        </td>
      `;
    }).join('');

    rows.push(`
      <tr>
        <th scope="row">${formatSlotTime(slotStart)}</th>
        ${cells}
      </tr>
    `);
  }

  availabilityChart.innerHTML = `${head}<tbody>${rows.join('')}</tbody>`;
}

async function loadVenues() {
  try {
    const res = await fetch(`${API_URL}?action=getVenues`);
    const data = await res.json();
    const loadedVenues = Array.isArray(data)
      ? data.map(venue => String(typeof venue === 'string' ? venue : (venue?.name || venue?.venue || venue?.location || '')).trim()).filter(Boolean)
      : [];

    venues = loadedVenues.length ? [...new Set(loadedVenues)] : [...DEFAULT_VENUES];
  } catch (err) {
    venues = [...DEFAULT_VENUES];
    console.warn('Could not load venues for admin availability:', err);
  }

  renderAvailabilityChart();
  recurringVenue.innerHTML = '<option value="">Select venue</option>' + venues
    .map(venue => `<option value="${escapeHtml(venue)}">${escapeHtml(venue)}</option>`)
    .join('');
}

async function loadAdminAvailability() {
  const dateValue = availabilityDate.value || localDateValue(new Date());
  availabilityDate.value = dateValue;
  setAvailabilityMessage('Loading availability...', 'loading');
  renderAvailabilityChart();

  try {
    const params = new URLSearchParams({ action: 'getBookings', date: dateValue });
    const res = await fetch(`${API_URL}?${params.toString()}`);
    const data = await res.json();

    availabilityBookings = normalizeBookings(data);
    renderAvailabilityChart();

    const activeCount = availabilityBookings.filter(booking =>
      booking.status !== 'rejected' &&
      booking.start &&
      localDateValue(booking.start) === dateValue
    ).length;

    setAvailabilityMessage(
      activeCount
        ? `Showing ${activeCount} pending or approved booking${activeCount === 1 ? '' : 's'} for ${dateValue}.`
        : `No pending or approved bookings found for ${dateValue}.`,
      'ready'
    );
  } catch (err) {
    availabilityBookings = [];
    renderAvailabilityChart();
    setAvailabilityMessage('Could not load availability from Google Sheets.', 'error');
    console.error('Admin availability error:', err);
  }
}

async function createRecurringBookings(event) {
  event.preventDefault();

  const validationError = validateRecurringBooking();
  if (validationError) {
    setRecurringMessage(validationError, 'error');
    return;
  }

  const occurrences = recurringOccurrences();
  const payload = {
    action: 'createRecurringBookings',
    eventTitle: document.getElementById('recurringEventTitle').value.trim(),
    location: recurringVenue.value,
    weekday: Number(document.getElementById('recurringWeekday').value),
    startTime: document.getElementById('recurringStartTime').value,
    endTime: document.getElementById('recurringEndTime').value,
    fromDate: document.getElementById('recurringFromDate').value,
    untilDate: document.getElementById('recurringUntilDate').value,
    organizer: document.getElementById('recurringOrganizer').value.trim() || 'Church Admin',
    memberCode: document.getElementById('recurringMemberCode').value.trim() || 'ADMIN',
    phone: document.getElementById('recurringPhone').value.trim(),
    status: 'Approved'
  };

  createRecurringButton.disabled = true;
  createRecurringButton.textContent = 'Creating...';
  setRecurringMessage(`Creating ${occurrences.length} recurring bookings...`, 'loading');

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const result = await res.json();

    if (result.success !== true) {
      throw new Error(result.message || result.error || 'The recurring bookings could not be created.');
    }

    const created = Number(result.createdCount ?? result.created ?? occurrences.length);
    const skipped = Number(result.skippedCount ?? result.skipped ?? 0);
    setRecurringMessage(
      `Created ${created} approved booking${created === 1 ? '' : 's'}${skipped ? `; skipped ${skipped} conflicting date${skipped === 1 ? '' : 's'}` : ''}.`,
      'success'
    );
    await Promise.all([loadBookings(), loadAdminAvailability()]);
  } catch (err) {
    setRecurringMessage(`Could not create recurring bookings. ${err.message}`, 'error');
    console.error('Recurring booking error:', err);
  } finally {
    createRecurringButton.disabled = false;
    createRecurringButton.textContent = 'Create Recurring Bookings';
  }
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
    await Promise.all([loadBookings(), loadAdminAvailability()]);
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
availabilityRefresh.addEventListener('click', loadAdminAvailability);
availabilityDate.addEventListener('change', loadAdminAvailability);
recurringForm.addEventListener('submit', createRecurringBookings);
recurringForm.querySelectorAll('input, select').forEach(input => {
  input.addEventListener('input', renderRecurringPreview);
  input.addEventListener('change', renderRecurringPreview);
});
statusFilter.addEventListener('change', () => {
  renderRows();
  setMessage(`Showing ${visibleBookings().length} booking${visibleBookings().length === 1 ? '' : 's'}.`, 'ready');
});
dateFilter.addEventListener('change', loadBookings);

const today = new Date();
const threeMonthsFromToday = new Date(today);
threeMonthsFromToday.setMonth(threeMonthsFromToday.getMonth() + 3);

availabilityDate.value = localDateValue(today);
document.getElementById('recurringFromDate').value = localDateValue(today);
document.getElementById('recurringUntilDate').value = localDateValue(threeMonthsFromToday);
document.getElementById('recurringStartTime').value = '13:30';
document.getElementById('recurringEndTime').value = '15:30';
renderRecurringPreview();
loadVenues();
loadAdminAvailability();
loadBookings();
