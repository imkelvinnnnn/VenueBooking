const API_URL = 'https://script.google.com/macros/s/AKfycbys4YZOVsEX7kEz0RFaQe90h4ye3fpZEkFWgsGzqgbL9CERoLbdKhEOE-wLez76hC68/exec';

loadVenues();

async function loadVenues() {

  const res = await fetch(
    API_URL + '?action=getVenues'
  );

  const venues = await res.json();

  const select = document.getElementById('location');

  venues.forEach(v => {

    const option = document.createElement('option');

    option.value = v;
    option.textContent = v;

    select.appendChild(option);
  });
}

document.getElementById('bookingForm')
.addEventListener('submit', async function(e) {

  e.preventDefault();

  const memberCode =
    document.getElementById('memberCode').value;

  const memberRegex = /^M\d{5}$/;

  if (!memberRegex.test(memberCode)) {
    showMessage('Invalid member code', true);
    return;
  }

  const data = {
    action: 'createBooking',
    memberCode: memberCode,
    name: document.getElementById('name').value,
    phone: document.getElementById('phone').value,
    eventTitle: document.getElementById('eventTitle').value,
    start: document.getElementById('start').value,
    duration: parseFloat(
      document.getElementById('duration').value
    ),
    location: document.getElementById('location').value
  };

  try {

    const res = await fetch(API_URL, {
      method: 'POST',
      body: JSON.stringify(data)
    });

    const result = await res.json();

    showMessage(
      result.message,
      !result.success
    );

    if (result.success) {
      document.getElementById('bookingForm').reset();
    }

  } catch(err) {

    showMessage(
      'System error',
      true
    );
  }
});

function showMessage(msg, isError) {

  const div = document.getElementById('message');

  div.innerText = msg;

  div.style.color =
    isError ? 'red' : 'green';
}