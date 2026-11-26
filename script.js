/* Church Venue Booking — Multi-Venue Support */

const API_URL = 'https://script.google.com/macros/s/AKfycby12gKfymyAJPgXuZA6Z--R1SdZxAOlhZzOsAowZdLuQGfRU1RFhwJP83E2ZUqrqmVmxg/exec';

const CHART_START_HOUR = 9;
const CHART_END_HOUR = 22;
const SLOT_MINUTES = 60;

let currentVenues = [];
let currentBookings = [];

let venueBlocks = JSON.parse(
  localStorage.getItem('adminBlockedRules') || '[]'
).filter(r => r.type === 'specific' || r.type === 'weekly');

/* ==========================================
   Multiple venue helpers
========================================== */

function splitVenues(value) {
  return [...new Set(
    String(value ?? '')
      .split(',')
      .map(v => v.trim())
      .filter(Boolean)
  )];
}

function venueMatches(location, venue) {
  return splitVenues(location).includes(
    String(venue ?? '').trim()
  );
}

function selectedVenues(id) {
  return Array.from(
    document.getElementById(id)
      .querySelectorAll('input[type="checkbox"]:checked'),
    input => input.value
  );
}

function populateVenuePicker(
  id,
  list,
  selected = selectedVenues(id)
) {
  const picker = document.getElementById(id);
  const previous = new Set(selected);

  const options = [...new Set([
    ...list,
    ...selected
  ])];

  picker.replaceChildren();

  for (const venue of options) {
    const label = document.createElement('label');
    label.className = 'venue-choice';

    const checkbox = document.createElement('input');

    checkbox.type = 'checkbox';
    checkbox.value = venue;
    checkbox.checked = previous.has(venue);

    const text = document.createElement('span');

    text.textContent = venue +
      (list.includes(venue)
        ? ''
        : ' (not in current venue list)');

    label.append(checkbox, text);
    picker.append(label);
  }

  if (!options.length) {
    picker.textContent = 'No venues available.';
  }
}

/* ==========================================
   Venue blocks
========================================== */

async function loadVenueBlocks() {
  try {
    const res = await fetch(
      API_URL + '?action=getVenueBlocks'
    );

    const server = await res.json();

    if (Array.isArray(server)) {
      venueBlocks = server.filter(
        r => r.type === 'specific' ||
          r.type === 'weekly'
      );
    }
  } catch {
    console.warn(
      'Could not fetch venue blocks — using local cache.'
    );
  }
}

function timeToMins(t) {
  if (!t) return null;

  const parts = String(t).split(':').map(Number);

  return isNaN(parts[0])
    ? null
    : parts[0] * 60 + (parts[1] || 0);
}

function venueKey(v) {
  return String(v || '').trim();
}

function isBlockedSlot(dateValue, hour, vkey) {
  const slotStart = hour * 60;
  const slotEnd = slotStart + 60;

  for (const rule of venueBlocks) {

    const venueMatch =
      !rule.venue ||
      venueMatches(rule.venue, vkey);

    if (!venueMatch) continue;

    let dateMatch = false;

    if (rule.type === 'specific') {
      dateMatch = rule.date === dateValue;

    } else if (rule.type === 'weekly') {
      const dow = new Date(
        `${dateValue}T00:00:00`
      ).getDay();

      dateMatch =
        dow === parseInt(rule.weekday) &&
        (!rule.fromDate ||
          dateValue >= rule.fromDate) &&
        (!rule.untilDate ||
          dateValue <= rule.untilDate);
    }

    if (!dateMatch) continue;

    const hasTime =
      rule.startTime &&
      rule.startTime.trim() &&
      rule.endTime &&
      rule.endTime.trim();

    if (hasTime) {
      const rs = timeToMins(rule.startTime);
      const re = timeToMins(rule.endTime);

      if (
        rs === null ||
        re === null ||
        slotStart >= re ||
        slotEnd <= rs
      ) {
        continue;
      }
    }

    return rule.reason || 'Blocked';
  }

  return null;
}

function isWindowBlocked(start, end, venue) {
  const day = localDateValue(start);
  const weekday = start.getDay();

  const s =
    start.getHours() * 60 + start.getMinutes();

  const e =
    end.getHours() * 60 + end.getMinutes();

  return venueBlocks.some(rule => {

    if (
      rule.venue &&
      !venueMatches(rule.venue, venue)
    ) {
      return false;
    }

    if (
      rule.type === 'specific' &&
      rule.date !== day
    ) {
      return false;
    }

    if (
      rule.type === 'weekly' &&
      (
        Number(rule.weekday) !== weekday ||
        (rule.fromDate && day < rule.fromDate) ||
        (rule.untilDate && day > rule.untilDate)
      )
    ) {
      return false;
    }

    if (!['specific', 'weekly'].includes(rule.type)) {
      return false;
    }

    if (!rule.startTime || !rule.endTime) {
      return true;
    }

    return (
      s < timeToMins(rule.endTime) &&
      e > timeToMins(rule.startTime)
    );
  });
}

/* ==========================================
   Load venues from Google Sheets
========================================== */

async function loadVenues() {
  const picker = document.getElementById('location');

  if (!picker) return currentVenues;

  try {
    const res = await fetch(
      API_URL + '?action=getVenues'
    );

    const venues = normalizeVenueList(
      await res.json()
    );

    if (!venues.length) {
      throw new Error('No venues returned');
    }

    setVenueOptions(venues);

  } catch (err) {
    setVenueOptions([]);

    showError(
      'location',
      'Unable to load venues. Please reload the page.'
    );

    console.warn(
      'Could not load venues from server.',
      err
    );
  }

  return currentVenues;
}

function normalizeVenueList(data) {
  if (!Array.isArray(data)) {
    data = data?.venues;
  }

  if (!Array.isArray(data)) return [];

  return [...new Set(
    data
      .map(v =>
        typeof v === 'string'
          ? v
          : (v?.name || v?.venue || v?.location || '')
      )
      .map(v => String(v).trim())
      .filter(Boolean)
  )];
}

function setVenueOptions(venues) {
  const picker = document.getElementById('location');

  currentVenues = [...venues];

  if (!picker) return;

  populateVenuePicker(
    'location',
    currentVenues,
    selectedVenues('location').filter(
      v => currentVenues.includes(v)
    )
  );

  renderAvailabilityChart();
}

/* ==========================================
   Availability chart
========================================== */

const availabilityDate =
  document.getElementById('availabilityDate');

const availabilityChart =
  document.getElementById('availabilityChart');

const availabilityMessage =
  document.getElementById('availabilityMessage');

const refreshAvailability =
  document.getElementById('refreshAvailability');

function localDateValue(date) {
  const offsetDate = new Date(
    date.getTime() -
    date.getTimezoneOffset() * 60000
  );

  return offsetDate.toISOString().slice(0, 10);
}

function setAvailabilityMessage(message, state = '') {
  if (!availabilityMessage) return;

  availabilityMessage.textContent = message;
  availabilityMessage.dataset.state = state;
}

function readBookingField(booking, names) {
  if (!booking || typeof booking !== 'object') {
    return undefined;
  }

  const lowerMap = Object.fromEntries(
    Object.keys(booking).map(
      key => [key.toLowerCase(), booking[key]]
    )
  );

  for (const name of names) {
    if (booking[name] !== undefined) {
      return booking[name];
    }

    if (lowerMap[name.toLowerCase()] !== undefined) {
      return lowerMap[name.toLowerCase()];
    }
  }

  return undefined;
}

function parseBookingStart(booking) {
  const start = readBookingField(
    booking,
    ['start', 'startTime', 'dateTime', 'bookingStart']
  );

  const date = readBookingField(
    booking,
    ['date', 'bookingDate']
  );

  const time = readBookingField(
    booking,
    ['time', 'from', 'startHour']
  );

  const raw =
    start || (date && time ? `${date}T${time}` : date);

  const parsed = raw ? new Date(raw) : null;

  return parsed &&
    !Number.isNaN(parsed.getTime())
    ? parsed
    : null;
}

function parseBookingEnd(booking, start) {
  const end = readBookingField(
    booking,
    ['end', 'endTime', 'bookingEnd']
  );

  const parsedEnd = end ? new Date(end) : null;

  if (
    parsedEnd &&
    !Number.isNaN(parsedEnd.getTime())
  ) {
    return parsedEnd;
  }

  const duration = parseFloat(
    readBookingField(
      booking,
      ['duration', 'durationHours', 'hours']
    ) || 1
  );

  return new Date(
    start.getTime() +
    (Number.isFinite(duration) ? duration : 1) *
    3600000
  );
}

function normalizeBookings(data) {
  if (!data) return [];

  const rows = Array.isArray(data)
    ? data
    : (data.bookings || data.data || []);

  if (!Array.isArray(rows)) return [];

  return rows.map(booking => {
    const start = parseBookingStart(booking);

    if (!start) return null;

    const rawStatus = String(
      readBookingField(
        booking,
        ['status', 'approvalStatus']
      ) || 'approved'
    ).toLowerCase();

    if (
      ['rejected', 'cancelled', 'canceled']
        .includes(rawStatus)
    ) {
      return null;
    }

    return {
      start,
      end: parseBookingEnd(booking, start),

      venue: String(
        readBookingField(
          booking,
          ['location', 'venue', 'room']
        ) || ''
      ).trim(),

      title: String(
        readBookingField(
          booking,
          ['eventTitle', 'title', 'event']
        ) || 'Reserved'
      ).trim(),

      status: rawStatus.includes('pending')
        ? 'pending'
        : 'booked'
    };

  }).filter(Boolean);
}

async function fetchBookingsForDate(dateValue) {
  const url =
    `${API_URL}?action=getBookings&date=` +
    encodeURIComponent(dateValue);

  const res = await fetch(url);
  const data = await res.json();

  if (data?.success === false) {
    throw new Error(
      data.error ||
      data.message ||
      'Unable to load bookings'
    );
  }

  return normalizeBookings(data).filter(
    booking =>
      localDateValue(booking.start) === dateValue
  );
}

function getRequestedWindow() {
  const startValue =
    document.getElementById('start')?.value;

  const venue = selectedVenues('location').join(', ');

  const duration = parseFloat(
    document.getElementById('duration')?.value || ''
  );

  if (
    !startValue ||
    !venue ||
    !Number.isFinite(duration)
  ) {
    return null;
  }

  const start = new Date(startValue);

  if (Number.isNaN(start.getTime())) {
    return null;
  }

  return {
    start,
    end: new Date(
      start.getTime() + duration * 3600000
    ),
    venue
  };
}

function formatSlotTime(date) {
  return date.toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit'
  });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function renderAvailabilityChart() {
  if (!availabilityChart || !availabilityDate) {
    return;
  }

  const dateValue =
    availabilityDate.value ||
    localDateValue(new Date());

  const requested = getRequestedWindow();

  const requestedDate = requested
    ? localDateValue(requested.start)
    : '';

  const chartDay = new Date(
    `${dateValue}T00:00:00`
  );

  const head = `
    <thead>
      <tr>
        <th scope="col">Time</th>
        ${currentVenues.map(venue => `
          <th scope="col">
            ${escapeHtml(venue)}
          </th>
        `).join('')}
      </tr>
    </thead>
  `;

  const rows = [];

  for (
    let hour = CHART_START_HOUR;
    hour <= CHART_END_HOUR;
    hour += SLOT_MINUTES / 60
  ) {
    const slotStart = new Date(chartDay);

    slotStart.setHours(hour, 0, 0, 0);

    const slotEnd = new Date(
      slotStart.getTime() + SLOT_MINUTES * 60000
    );

    const cells = currentVenues.map(venue => {
      const vkey = venueKey(venue);

      // Match each venue individually.
      const booking = currentBookings.find(item =>
        venueMatches(item.venue, vkey) &&
        localDateValue(item.start) === dateValue &&
        overlaps(
          slotStart,
          slotEnd,
          item.start,
          item.end
        )
      );

      const blockReason = !booking
        ? isBlockedSlot(dateValue, hour, vkey)
        : null;

      // Highlight every selected venue.
      const isRequested =
        requested &&
        requestedDate === dateValue &&
        venueMatches(requested.venue, vkey) &&
        overlaps(
          slotStart,
          slotEnd,
          requested.start,
          requested.end
        );

      let state;
      let label;
      let titleText;

      if (booking) {
        state = 'booked';
        label = 'Unavailable';
        titleText = 'Unavailable';

      } else if (blockReason) {
        state = 'booked';
        label = 'Unavailable';

        titleText = blockReason !== 'Blocked'
          ? `Unavailable: ${blockReason}`
          : 'Unavailable';

      } else {
        state = 'open';
        label = 'Available';
        titleText = 'Available';
      }

      return `
        <td class="availability-cell
          availability-cell-${state}${isRequested
          ? ' availability-cell-selected'
          : ''
        }"
          title="${escapeHtml(titleText)}">

          <span>${label}</span>
        </td>
      `;

    }).join('');

    rows.push(`
      <tr>
        <th scope="row">
          ${formatSlotTime(slotStart)}
        </th>
        ${cells}
      </tr>
    `);
  }

  availabilityChart.innerHTML =
    `${head}<tbody>${rows.join('')}</tbody>`;
}

async function loadAvailability() {
  if (!availabilityDate) return;

  const dateValue =
    availabilityDate.value ||
    localDateValue(new Date());

  availabilityDate.value = dateValue;

  setAvailabilityMessage(
    'Loading availability…',
    'loading'
  );

  renderAvailabilityChart();

  try {
    currentBookings = await fetchBookingsForDate(
      dateValue
    );

    renderAvailabilityChart();

    setAvailabilityMessage(
      currentBookings.length
        ? `Showing ${currentBookings.length} booking${currentBookings.length === 1 ? '' : 's'
        } for ${dateValue}.`
        : `No bookings found for ${dateValue}.`,
      'ready'
    );

  } catch (err) {
    currentBookings = [];

    renderAvailabilityChart();

    setAvailabilityMessage(
      'Could not load booking data. Do not rely on this chart until you refresh successfully.',
      'error'
    );

    console.warn(
      'Could not load availability:',
      err
    );
  }
}

/* ==========================================
   Validation
========================================== */

const validators = {

  memberCode(val) {
    if (!val.trim()) {
      return 'Member code is required.';
    }

    if (!/^M\d{5}$/i.test(val.trim())) {
      return 'Format must be M followed by exactly 5 digits (e.g. M12345).';
    }

    return '';
  },

  name(val) {
    if (!val.trim()) {
      return 'Full name is required.';
    }

    if (val.trim().length < 2) {
      return 'Name must be at least 2 characters.';
    }

    return '';
  },

  email(val) {
    if (!val.trim()) {
      return 'Email address is required.';
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
      return 'Please enter a valid email address.';
    }

    return '';
  },

  phone(val) {
    const digits = val.replace(/\D/g, '');

    if (!val.trim()) {
      return 'Phone number is required.';
    }

    if (digits.length < 9 || digits.length > 15) {
      return 'Please enter a valid phone number (9–15 digits).';
    }

    return '';
  },

  eventTitle(val) {
    if (!val.trim()) {
      return 'Event title is required.';
    }

    if (val.trim().length < 3) {
      return 'Event title must be at least 3 characters.';
    }

    return '';
  },

  start(val) {
    if (!val) {
      return 'Please select a date and start time.';
    }

    const chosen = new Date(val);
    const now = new Date();

    if (chosen <= now) {
      return 'Start time must be in the future.';
    }

    if ((chosen - now) / 3600000 < 1) {
      return 'Booking must be at least 1 hour from now.';
    }

    if (chosen.getHours() < 9) {
      return 'Bookings can only start from 9:00 AM.';
    }

    if (chosen.getHours() >= 23) {
      return 'Bookings cannot start at or after 11:00 PM.';
    }

    return '';
  },

  duration(val) {
    const n = parseFloat(val);

    if (!val) {
      return 'Duration is required.';
    }

    if (isNaN(n) || n <= 0) {
      return 'Please enter a positive duration.';
    }

    if (n > 14) {
      return 'Maximum booking duration is 14 hours.';
    }

    if (n % 0.5 !== 0) {
      return 'Duration must be in 0.5-hour increments.';
    }

    const startVal =
      document.getElementById('start')?.value;

    if (startVal) {
      const startDt = new Date(startVal);

      const endDt = new Date(
        startDt.getTime() + n * 3600000
      );

      const endH = endDt.getHours();
      const endM = endDt.getMinutes();

      if (
        endDt.toDateString() !== startDt.toDateString() ||
        endH > 23 ||
        (endH === 23 && endM > 0)
      ) {
        return 'Booking must end by 11:00 PM.';
      }
    }

    return '';
  },

  location(val) {
    if (!val) {
      return 'Please select at least one venue.';
    }

    return '';
  }
};

/* ==========================================
   Form helpers
========================================== */

function showError(fieldId, message) {
  const el = document.getElementById(fieldId);

  const errEl = document.getElementById(
    fieldId + 'Error'
  );

  if (message) {
    el.classList.add('invalid');

    if (errEl) {
      errEl.textContent = message;
    }

  } else {
    el.classList.remove('invalid');

    if (errEl) {
      errEl.textContent = '';
    }
  }
}

function validateField(fieldId) {
  const el = document.getElementById(fieldId);

  if (!el || !validators[fieldId]) {
    return '';
  }

  const value = fieldId === 'location'
    ? selectedVenues('location').join(', ')
    : el.value;

  const err = validators[fieldId](value);

  showError(fieldId, err);

  return err;
}

const formFields = [
  'memberCode',
  'name',
  'email',
  'phone',
  'eventTitle',
  'start',
  'duration',
  'location'
];

function validateAll() {
  let ok = true;

  formFields.forEach(field => {
    if (validateField(field)) {
      ok = false;
    }
  });

  return ok;
}

const touched = new Set();

formFields.forEach(id => {
  const el = document.getElementById(id);

  if (!el) return;

  el.addEventListener('blur', () => {
    touched.add(id);
    validateField(id);
  });

  el.addEventListener('input', () => {
    if (touched.has(id)) {
      validateField(id);
    }
  });

  el.addEventListener('change', () => {
    touched.add(id);
    validateField(id);
  });
});

availabilityDate?.addEventListener(
  'change',
  loadAvailability
);

refreshAvailability?.addEventListener(
  'click',
  () => {
    loadVenueBlocks().then(() => loadAvailability());
  }
);

document.getElementById('start')
  ?.addEventListener('change', () => {

    const startValue =
      document.getElementById('start').value;

    if (!startValue || !availabilityDate) {
      renderAvailabilityChart();
      return;
    }

    if (touched.has('duration')) {
      validateField('duration');
    }

    const dateValue = startValue.slice(0, 10);

    if (availabilityDate.value !== dateValue) {
      availabilityDate.value = dateValue;
      loadAvailability();

    } else {
      renderAvailabilityChart();
    }
  });

document.getElementById('duration')
  ?.addEventListener(
    'input',
    renderAvailabilityChart
  );

document.getElementById('location')
  ?.addEventListener(
    'change',
    renderAvailabilityChart
  );

/* ==========================================
   Confirmation modal
========================================== */

const modal =
  document.getElementById('confirmModal');

const confirmBtn =
  document.getElementById('confirmBtn');

const cancelBtn =
  document.getElementById('cancelBtn');

let pendingBooking = null;

function openModal(booking) {
  pendingBooking = booking;

  const startDt = new Date(booking.start);

  const endDt = new Date(
    startDt.getTime() + booking.duration * 3600000
  );

  const fmt = dt => dt.toLocaleString('en-MY', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });

  const rows = [
    [
      'Member',
      booking.memberCode + ' — ' + booking.name
    ],
    ['Email', booking.email],
    ['Phone', booking.phone],
    ['Event', booking.eventTitle],
    ['Venue', booking.location],
    ['Start', fmt(startDt)],
    ['End', fmt(endDt)],
    [
      'Duration',
      booking.duration +
      (booking.duration === 1 ? ' hour' : ' hours')
    ],
    ...(booking.notes
      ? [['Notes', booking.notes]]
      : [])
  ];

  document.getElementById('confirmDetails')
    .innerHTML = rows.map(([label, val]) => `
      <div class="detail-row">
        <span class="detail-label">
          ${label}
        </span>

        <span class="detail-value">
          ${escapeHtml(val)}
        </span>
      </div>
    `).join('');

  modal.hidden = false;

  document.body.style.overflow = 'hidden';

  confirmBtn.focus();
}

function closeModal() {
  modal.hidden = true;
  document.body.style.overflow = '';
  pendingBooking = null;
}

cancelBtn.addEventListener('click', closeModal);

modal.addEventListener('click', e => {
  if (e.target === modal) {
    closeModal();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !modal.hidden) {
    closeModal();
  }
});

/* ==========================================
   Submit booking to Apps Script
========================================== */

confirmBtn.addEventListener('click', async () => {
  if (!pendingBooking) return;

  confirmBtn.disabled = true;
  confirmBtn.textContent = 'Submitting…';

  try {
    const payload = {
      action: 'createBooking',
      memberCode: pendingBooking.memberCode,
      name: pendingBooking.name,
      email: pendingBooking.email,
      phone: pendingBooking.phone,
      eventTitle: pendingBooking.eventTitle,
      start: pendingBooking.start,
      duration: pendingBooking.duration,

      // Comma-separated venue names.
      location: pendingBooking.location,

      notes: pendingBooking.notes || ''
    };

    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    const result = await res.json();

    if (!result.success) {
      closeModal();

      const startEl =
        document.getElementById('start');

      startEl.classList.add('invalid');

      document.getElementById('startError')
        .textContent =
        result.message ||
        'One or more selected venues are unavailable.';

      startEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      return;
    }

    const confirmedData = {
      ...pendingBooking,

      ref: result.ref ||
        ('BK-' + Date.now().toString(36).toUpperCase()),

      bookedAt: new Date().toISOString()
    };

    sessionStorage.setItem(
      'confirmedBooking',
      JSON.stringify(confirmedData)
    );

    closeModal();

    window.location.href = 'success.html';

  } catch (err) {
    closeModal();

    alert(
      'A network error occurred. Please check your connection and try again.'
    );

    console.error('Booking error:', err);

  } finally {
    confirmBtn.disabled = false;
    confirmBtn.textContent = 'Confirm Booking';
  }
});

/* ==========================================
   Form submission
========================================== */

document.getElementById('bookingForm')
  .addEventListener('submit', e => {

    e.preventDefault();

    formFields.forEach(id => touched.add(id));

    if (!validateAll()) {
      const firstInvalid =
        document.querySelector('.invalid');

      if (firstInvalid) {
        firstInvalid.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }

      return;
    }

    const startVal =
      document.getElementById('start').value;

    const duration = parseFloat(
      document.getElementById('duration').value
    );

    const selected = selectedVenues('location');

    // Convert multiple venues into one string.
    const location = selected.join(', ');

    const startDate = new Date(startVal);

    const endDate = new Date(
      startDate.getTime() + duration * 3600000
    );

    // Check ALL selected venues.
    const blockedVenue = selected.find(
      venue => isWindowBlocked(
        startDate,
        endDate,
        venue
      )
    );

    if (blockedVenue) {
      const startEl =
        document.getElementById('start');

      startEl.classList.add('invalid');

      document.getElementById('startError')
        .textContent =
        `${blockedVenue} is blocked during the selected time. Please choose a different date, time, or venue.`;

      startEl.scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });

      return;
    }

    const booking = {
      memberCode: document
        .getElementById('memberCode')
        .value.trim().toUpperCase(),

      name: document
        .getElementById('name')
        .value.trim(),

      email: document
        .getElementById('email')
        .value.trim().toLowerCase(),

      phone: document
        .getElementById('phone')
        .value.trim(),

      eventTitle: document
        .getElementById('eventTitle')
        .value.trim(),

      start: startVal,
      duration,
      location,

      notes: document
        .getElementById('notes')
        .value.trim()
    };

    openModal(booking);
  });

/* ==========================================
   Initialize
========================================== */

(function setMinDatetime() {
  const input = document.getElementById('start');

  if (!input) return;

  const now = new Date();

  now.setMinutes(now.getMinutes() + 60);
  now.setSeconds(0);

  const earliest = new Date(now);

  if (earliest.getHours() < 9) {
    earliest.setHours(9, 0, 0, 0);
  }

  const minDt = earliest > now ? earliest : now;

  input.min = new Date(
    minDt - minDt.getTimezoneOffset() * 60000
  ).toISOString().slice(0, 16);

  if (availabilityDate) {
    availabilityDate.min =
      localDateValue(new Date());

    availabilityDate.value =
      availabilityDate.value ||
      localDateValue(new Date());
  }
})();

loadVenues()
  .then(() => loadVenueBlocks())
  .then(() => loadAvailability());