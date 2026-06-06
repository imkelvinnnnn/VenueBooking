/*
  Add this handler inside your existing doPost(e):

  if (data.action === 'createRecurringBookings') {
    return createRecurringBookings(data);
  }

  This file uses your existing SPREADSHEET_ID, CALENDAR_ID, and jsonResponse().
*/

function createRecurringBookings(data) {
  try {
    validateRecurringBookingInput(data);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName('Bookings');
    const calendar = CalendarApp.getCalendarById(CALENDAR_ID);
    const existingRows = sheet.getDataRange().getValues().slice(1);
    const dates = buildWeeklyDates(data.fromDate, data.untilDate, Number(data.weekday));

    const created = [];
    const skipped = [];

    dates.forEach(function(date) {
      const start = combineDateAndTime(date, data.startTime);
      const end = combineDateAndTime(date, data.endTime);

      if (hasRecurringConflict(existingRows, data.location, start, end)) {
        skipped.push({
          date: formatDateForResponse(date),
          reason: 'Venue already booked during this time'
        });
        return;
      }

      const event = calendar.createEvent(
        data.eventTitle,
        start,
        end,
        {
          location: data.location,
          description:
            'Booked By: ' + (data.organizer || 'Church Admin') +
            '\nMember Code: ' + (data.memberCode || 'ADMIN') +
            '\nPhone: ' + (data.phone || '') +
            '\nStatus: Approved' +
            '\nRecurring Booking: Weekly'
        }
      );

      const id = Utilities.getUuid();
      const duration = (end.getTime() - start.getTime()) / (60 * 60 * 1000);
      const row = [
        id,
        data.memberCode || 'ADMIN',
        data.organizer || 'Church Admin',
        data.phone || '',
        data.eventTitle,
        start,
        end,
        duration,
        data.location,
        'Approved',
        event.getId(),
        new Date()
      ];

      sheet.appendRow(row);
      existingRows.push(row);
      created.push({
        id: id,
        date: formatDateForResponse(date),
        eventId: event.getId()
      });
    });

    return jsonResponse({
      success: true,
      message: 'Recurring bookings created',
      createdCount: created.length,
      skippedCount: skipped.length,
      created: created,
      skipped: skipped
    });
  } catch (err) {
    return jsonResponse({
      success: false,
      message: err.message
    });
  }
}

function validateRecurringBookingInput(data) {
  if (!data.eventTitle) throw new Error('Event title required');
  if (!data.location) throw new Error('Venue required');
  if (!data.fromDate || !data.untilDate) throw new Error('Date range required');
  if (!data.startTime || !data.endTime) throw new Error('Start and end time required');

  const weekday = Number(data.weekday);
  if (weekday < 0 || weekday > 6) throw new Error('Invalid weekday');

  const from = parseLocalDate(data.fromDate);
  const until = parseLocalDate(data.untilDate);
  if (from > until) throw new Error('Until date must be on or after from date');

  const sampleStart = combineDateAndTime(from, data.startTime);
  const sampleEnd = combineDateAndTime(from, data.endTime);
  if (sampleEnd <= sampleStart) throw new Error('End time must be later than start time');
}

function buildWeeklyDates(fromDate, untilDate, weekday) {
  const from = parseLocalDate(fromDate);
  const until = parseLocalDate(untilDate);
  const first = new Date(from);
  const daysUntilWeekday = (weekday - first.getDay() + 7) % 7;
  first.setDate(first.getDate() + daysUntilWeekday);

  const dates = [];
  for (let date = new Date(first); date <= until; date.setDate(date.getDate() + 7)) {
    dates.push(new Date(date));
    if (dates.length > 104) {
      throw new Error('A recurring booking can contain at most 104 occurrences');
    }
  }

  if (!dates.length) throw new Error('No matching weekday occurs inside this date range');
  return dates;
}

function parseLocalDate(value) {
  const parts = String(value).split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) throw new Error('Invalid date');
  return new Date(parts[0], parts[1] - 1, parts[2]);
}

function combineDateAndTime(date, time) {
  const parts = String(time).split(':').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) throw new Error('Invalid time');
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), parts[0], parts[1], 0, 0);
}

function hasRecurringConflict(rows, location, start, end) {
  return rows.some(function(row) {
    const existingLocation = row[8];
    const existingStart = new Date(row[5]);
    const existingEnd = new Date(row[6]);
    const status = String(row[9] || '').toLowerCase();

    if (status === 'rejected') return false;
    if (existingLocation !== location) return false;

    return start < existingEnd && end > existingStart;
  });
}

function formatDateForResponse(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}
