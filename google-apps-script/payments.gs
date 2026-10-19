/**
 * TVC payments sync: paste this into the tracker sheet's Apps Script editor
 * (Extensions > Apps Script) and deploy it as a web app. See readme.md.
 *
 * Every paid Stripe Checkout session is logged in the "Payments" tab.
 * When the purchase includes Vibe Approved, the matching event row in the
 * tracker gets Vibe Approved = Yes, so the badge appears on Where's The Vibe.
 * Anything it cannot match is flagged and emailed to the sheet owner.
 */

const TRACKER_TAB = 'Event Tracker';
const PAYMENTS_TAB = 'Payments';
const PAYMENT_HEADERS = [
  'Paid at', 'Amount', 'Currency', 'Customer', 'Email', 'Phone', 'Event name', 'Event date',
  'Instagram', 'Items', 'Vibe Approved bought', 'Sheet status', 'Matched row', 'Mode', 'Stripe session',
];

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);
    // Flyer uploads from Claude's Event Inbox task use their own secret (FLYER_SECRET).
    if (body.action === 'uploadFlyer') {
      const flyerSecret = PropertiesService.getScriptProperties().getProperty('FLYER_SECRET');
      if (!flyerSecret || body.secret !== flyerSecret) return json_({ ok: false, error: 'unauthorised' });
      return json_(uploadFlyer_(body));
    }

    const expected = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
    if (!expected || body.secret !== expected) return json_({ ok: false, error: 'unauthorised' });

    const lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      // Newsletter sign-ups from the pop-up on Where's The Vibe (/api/subscribe).
      if (body.action === 'subscribe') return json_(recordSubscriber_(body.subscriber || {}));
      return json_(recordPayment_(body.payment));
    } finally {
      lock.releaseLock();
    }
  } catch (error) {
    console.error(error);
    return json_({ ok: false, error: String(error) });
  }
}

function recordPayment_(payment) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const payments = paymentsSheet_(spreadsheet);

  // Stripe can deliver the same event more than once: skip sessions already logged.
  const sessionColumn = PAYMENT_HEADERS.indexOf('Stripe session') + 1;
  const lastRow = payments.getLastRow();
  if (lastRow > 1) {
    const logged = payments.getRange(2, sessionColumn, lastRow - 1, 1).getValues().flat();
    if (logged.indexOf(payment.sessionId) !== -1) return { ok: true, status: 'duplicate' };
  }

  let status = 'Logged';
  let matchedRow = '';

  if (payment.vibeApproved) {
    const match = markVibeApproved_(spreadsheet, payment);
    status = match.status;
    matchedRow = match.row || '';
  } else if (!payment.lineItemsChecked) {
    status = 'Logged (extras not checked: add STRIPE_SECRET_KEY in Netlify)';
  }

  payments.appendRow([
    new Date(payment.paidAt), payment.amount, payment.currency, payment.customerName, payment.customerEmail,
    payment.customerPhone, payment.eventName, payment.eventDate, payment.instagram, payment.items,
    payment.vibeApproved ? 'Yes' : 'No', status, matchedRow, payment.livemode ? 'Live' : 'Test', payment.sessionId,
  ]);

  notify_(payment, status, matchedRow);
  return { ok: true, status: status };
}

function markVibeApproved_(spreadsheet, payment) {
  const tracker = spreadsheet.getSheetByName(TRACKER_TAB);
  if (!tracker) return { status: 'Needs manual match: tab "' + TRACKER_TAB + '" not found' };

  const values = tracker.getDataRange().getValues();
  const headers = values[0].map(normalise_);
  const titleColumn = headers.indexOf('title');
  const dateColumn = headers.indexOf('date');
  const approvedColumn = headers.indexOf('vibeapproved');
  if (titleColumn === -1 || approvedColumn === -1) {
    return { status: 'Needs manual match: Title or Vibe Approved column not found' };
  }

  const wantedTitle = normalise_(payment.eventName);
  const wantedDate = parseDate_(payment.eventDate);
  if (!wantedTitle) return { status: 'Needs manual match: no event name given' };

  const candidates = [];
  for (let index = 1; index < values.length; index += 1) {
    const title = normalise_(values[index][titleColumn]);
    if (!title) continue;
    let score = 0;
    if (title === wantedTitle) score = 3;
    else if (title.indexOf(wantedTitle) !== -1 || wantedTitle.indexOf(title) !== -1) score = 1;
    if (!score) continue;
    if (wantedDate && dateColumn !== -1 && sameDay_(values[index][dateColumn], wantedDate)) score += 2;
    candidates.push({ row: index + 1, score: score });
  }

  if (!candidates.length) return { status: 'Needs manual match: no event called "' + payment.eventName + '"' };
  candidates.sort(function (a, b) { return b.score - a.score; });
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    return { status: 'Needs manual match: ' + candidates.length + ' possible rows' };
  }

  const best = candidates[0];
  const cell = tracker.getRange(best.row, approvedColumn + 1);
  cell.setValue('Yes');
  cell.setNote('Paid via Stripe ' + new Date(payment.paidAt).toDateString() + ' (' + payment.sessionId + ')');
  return { status: 'Vibe Approved set to Yes', row: best.row };
}

function paymentsSheet_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName(PAYMENTS_TAB);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(PAYMENTS_TAB);
    sheet.appendRow(PAYMENT_HEADERS);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, PAYMENT_HEADERS.length).setFontWeight('bold');
  }
  return sheet;
}

function notify_(payment, status, matchedRow) {
  const owner = Session.getEffectiveUser().getEmail();
  if (!owner) return;
  const needsYou = status.indexOf('Needs manual match') === 0;
  const subject = (needsYou ? 'Action needed: ' : 'New payment: ') +
    payment.currency + ' ' + Number(payment.amount).toFixed(2) + ' from ' + (payment.customerName || payment.customerEmail);
  const lines = [
    'Items: ' + payment.items,
    'Event: ' + (payment.eventName || '-') + ' on ' + (payment.eventDate || '-'),
    'Instagram: ' + (payment.instagram || '-'),
    'Customer: ' + payment.customerName + ' <' + payment.customerEmail + '>',
    'Sheet: ' + status + (matchedRow ? ' (row ' + matchedRow + ')' : ''),
    'Mode: ' + (payment.livemode ? 'Live' : 'Test'),
  ];
  MailApp.sendEmail(owner, subject, lines.join('\n'));
}

function normalise_(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function parseDate_(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})$/);
  if (match) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return new Date(year, Number(match[2]) - 1, Number(match[1]));
  }
  const parsed = new Date(text);
  return isNaN(parsed) ? null : parsed;
}

function sameDay_(cell, date) {
  const value = cell instanceof Date ? cell : parseDate_(cell);
  return Boolean(value) && value.getFullYear() === date.getFullYear() &&
    value.getMonth() === date.getMonth() && value.getDate() === date.getDate();
}

// Only these Drive folders can receive uploads: TVC Event Flyers and
// Vibe Approved & Concert Flyers. Both are shared by link, so the map can show them.
const FLYER_FOLDERS = ['1mFTJoHZrv3AthYslDpbq8Wo6OuHjU7w0', '17ZC2XJHXo8bBaSpHdziZUNcliPdGbsqK'];

function uploadFlyer_(body) {
  if (FLYER_FOLDERS.indexOf(body.folderId) === -1) return { ok: false, error: 'folder not allowed' };
  const mime = body.mimeType || 'image/jpeg';
  if (!/^image\/(jpeg|png|webp)$/.test(mime)) return { ok: false, error: 'images only' };
  const bytes = Utilities.base64Decode(body.base64 || '');
  if (!bytes.length || bytes.length > 8 * 1024 * 1024) return { ok: false, error: 'empty or over 8 MB' };
  const name = String(body.name || 'flyer.jpg').replace(/[\\/:*?"<>|]/g, '-').slice(0, 150);
  const file = DriveApp.getFolderById(body.folderId).createFile(Utilities.newBlob(bytes, mime, name));
  return {
    ok: true,
    id: file.getId(),
    url: 'https://drive.google.com/file/d/' + file.getId() + '/view?usp=drivesdk',
  };
}

// Separate, private spreadsheet for newsletter emails, so subscriber
// addresses never sit in the published tracker sheet.
const SUBSCRIBERS_SHEET_ID = '1ePEB07EvPtfrhpfXS6jd5Zrd2DCfBAsQhJy9miXREDA';
const SUBSCRIBER_HEADERS = ['Signed up', 'Email', 'Source', 'Page'];

function recordSubscriber_(subscriber) {
  const email = String(subscriber.email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) {
    return { ok: false, error: 'invalid email' };
  }

  const sheet = SpreadsheetApp.openById(SUBSCRIBERS_SHEET_ID).getSheets()[0];
  if (sheet.getLastRow() === 0) sheet.appendRow(SUBSCRIBER_HEADERS);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, SUBSCRIBER_HEADERS.length).setFontWeight('bold');

  const emailColumn = SUBSCRIBER_HEADERS.indexOf('Email') + 1;
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const existing = sheet.getRange(2, emailColumn, lastRow - 1, 1).getValues().flat()
      .map(function (value) { return String(value).trim().toLowerCase(); });
    if (existing.indexOf(email) !== -1) return { ok: true, status: 'already subscribed' };
  }

  sheet.appendRow([
    new Date(), email, String(subscriber.source || 'popup').slice(0, 40), String(subscriber.page || '').slice(0, 200),
  ]);
  return { ok: true, status: 'subscribed' };
}

/** Run once from the editor to check the newsletter sheet is reachable. */
function testRecordSubscriber() {
  console.log(recordSubscriber_({ email: 'test+' + Date.now() + '@example.com', source: 'manual test', page: '' }));
}

function json_(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the editor to check the setup without Stripe. */
function testRecordPayment() {
  console.log(recordPayment_({
    sessionId: 'cs_test_manual_' + Date.now(), livemode: false, paidAt: new Date().toISOString(),
    amount: 130, currency: 'GBP', customerName: 'Test Promoter', customerEmail: 'test@example.com',
    customerPhone: '', eventName: 'Test event', eventDate: '', instagram: '@test',
    items: '1 x Vibe Approved Sticker', skus: ['x_vibe_approved'], vibeApproved: true, lineItemsChecked: true,
  }));
}
