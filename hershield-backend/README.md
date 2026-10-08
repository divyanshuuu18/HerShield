# HerShield backend

Node.js 22+ and MongoDB are required. This package implements your supplied frontend's five-stage timeline; it does not implement the frontend's advertised ML prediction, native push, audio alerts, actual phone calls, or an operating-system GPS override.

## Run

```bash
npm install
cp .env.example .env
# Edit .env: MongoDB URI, strong random JWT secret, exact frontend origins.
npm test
npm start
```

Run MongoDB locally or use an Atlas connection string. Serve index.html over localhost (for example port 5500), not file://. Replace the final application script in your HTML with frontend-integration.js, keeping the Tailwind configuration script in the head. Your attachment is Markdown-escaped HTML; use your original index.html rather than copying its Markdown escape characters. The included JavaScript targets your existing DOM IDs and handlers, adds a start button, disables demo stage selectors, removes fake GPS fallback, uploads GPS while the page is open, and polls server state. The SMS credentials always stay in .env, never in HTML.

The snippet has no login form; use your login UI to call the auth endpoints and save the returned token in sessionStorage. For initial local testing, run this in the browser console with your own test details:

```js
const response = await fetch('http://localhost:5000/api/auth/register', {
  method: 'POST', headers: {'Content-Type':'application/json'},
  body: JSON.stringify({name:'Riya Sharma', phone:'YOUR_10_DIGIT_NUMBER',
    password:'YOUR_LONG_UNIQUE_PASSWORD', emergencyContacts:[
      {name:'Emergency contact',phone:'CONTACT_10_DIGIT_NUMBER',whatsapp:true}
    ]})
});
const account = await response.json();
if (!response.ok) throw new Error(account.error);
sessionStorage.setItem('hershieldToken', account.token);
```

If already registered, POST /api/auth/login with phone and password instead. Configure circle contacts before starting a commute:

```js
const response = await fetch('http://localhost:5000/api/circle', {
  method:'PUT', headers:{'Content-Type':'application/json',
    Authorization:'Bearer '+sessionStorage.getItem('hershieldToken')},
  body:JSON.stringify({contacts:[
    {name:'Trusted friend',phone:'CONTACT_10_DIGIT_NUMBER',whatsapp:true}
  ]})
});
if (!response.ok) throw new Error((await response.json()).error);
// Reload page to resume, then click Start 14-minute commute.
```

Only add consenting recipients you control for testing. Registration currently authenticates a password but does not verify phone ownership or recipient consent. Add OTP verification and consent management before opening public registration. Tokens expire in 12 hours; a production app needs a complete login/refresh flow. Escalations continue on the backend if the browser closes, as long as MongoDB and the server remain available.

## APIs

All endpoints below require `Authorization: Bearer TOKEN`, except registration and login. Identity is taken from the token, never a client-supplied userId.

| Method | Path | JSON body / behavior |
|---|---|---|
| POST | /api/auth/register | name, phone, password (12–128 characters), optional emergencyContacts |
| POST | /api/auth/login | phone, password; returns token |
| PUT | /api/circle | contacts: [{name,phone,whatsapp}] (maximum 10) |
| PUT | /api/user/emergency-contacts | contacts: [{name,phone,whatsapp}] (maximum 10) |
| POST | /api/commute/start | durationMinutes (integer 1–1440), optional route and location; returns sessionId |
| POST | /api/commute/update-location | sessionId, location: {lat,lng,accuracy?}; requires an active owned session |
| POST | /api/commute/safe | sessionId; idempotent, marks safe and cancels queued alerts |
| GET | /api/commute/current | most recent owned session or null; use after reload |
| GET | /api/circle/status | owned session plus alert job statuses; does not claim recipient phone calls or confirmed delivery |
| POST | /api/commute/dispatch | sessionId; stage 5 only; queues the same jobs as cron |

Example start request:

```json
{"durationMinutes":14,"route":"Metro commute home","location":{"lat":26.9124,"lng":75.7873,"accuracy":20}}
```

The server stores a snapshot of both contact lists when the trip starts. Subsequent changes apply to the next trip. One active trip per user is enforced by a partial unique MongoDB index.

## Escalation

The server owns the arrival deadline: start time + durationMinutes. `node-cron` runs every minute and once immediately on startup. Stage changes can occur up to approximately one minute after a threshold, plus processing time. Stored deadlines and jobs survive restarts. A delayed tick jumps to the actual current stage and cancels obsolete lower-stage jobs instead of sending old nudges together with an emergency alert.

| Stage | Time relative to expected arrival | Action |
|---|---|---|
| 1 | Before arrival | Active; browser uploads latest GPS |
| 2 | Arrival due | SMS check-in reminder to traveller |
| 3 | 5 minutes overdue | SMS concern prompt to traveller |
| 4 | 10 minutes overdue | SMS and opted-in WhatsApp to circle; asks them to call |
| 5 | 30 minutes overdue | SMS and opted-in WhatsApp to union of circle and emergency contacts, with latest received GPS |

At stage 5, the backend constructs exactly `https://maps.google.com/?q=lat,lng`. It includes the coordinate receipt timestamp in the template. Missing GPS yields “Location unavailable” and still sends an alert. No dummy Jaipur coordinates are used. A Maps link is a static last-known point, not a live tracking link. If a fresh location arrives after the stage 5 alert was accepted, the stored location and API update but this implementation does not resend that alert automatically.

Browser GPS requires permission and a secure context (HTTPS or localhost). Background tabs may suspend updates; closed pages cannot report GPS. The backend cannot unlock GPS remotely or determine whether circle calls went unanswered. Remove those claims from your UI. The snippet preserves your layout, but existing decorative text/cards about WhatsApp delivery, ML, or emergency overrides remain mock content until you change them. Safe check-in updates server state; this version does not send a separate “arrived safely” SMS to contacts.

## Fast2SMS configuration

Alerts default to `ALERTS_DRY_RUN=true`: jobs end in **simulated** and no network request is made. Dry-run jobs are terminal; changing to live mode does not replay them. Start a new commute to test live alerts.

1. Set FAST2SMS_API_KEY from Dev API.
2. Set FAST2SMS_SENDER_ID and SMS_MESSAGE_ID_STAGE_2 through _5 from your approved DLT templates in Fast2SMS. The SMS adapter uses POST https://www.fast2sms.com/dev/bulkV2, route=dlt.
3. Set FAST2SMS_WA_PHONE_NUMBER_ID and WA_MESSAGE_ID_STAGE_4/_5 from your WhatsApp Manager. The WhatsApp adapter uses GET https://www.fast2sms.com/dev/whatsapp, with message_id, phone_number_id, numbers and variables_values. WhatsApp uses its own endpoint; bulkV2 cannot send WhatsApp.
4. All approved templates used here must contain exactly five text variables, in this order: traveller name, stage instruction, traveller phone, location/link (or withheld/unavailable notice), location receipt timestamp (or no-location notice). Match your actual approved template placeholders and supported variable lengths; adjust sendAlert if your approved template differs. Register any required URL/domain for the location link with your provider/template setup.
5. Set ALERTS_DRY_RUN=false only after configuring those templates and recipients.

Example WhatsApp template body (subject to provider approval):

“HerShield: {{1}}. {{2}}. Traveller phone: {{3}}. Location: {{4}}. Location received: {{5}}.”

DLT templates use {#var#} placeholders instead. IDs are account-specific and must be supplied by you. The API validates phone formats but template approval/credits/delivery remain provider responsibilities.

Provider references:
- https://docs.fast2sms.com/reference/dlt-sms-single
- https://docs.fast2sms.com/reference/send-template-message
- https://docs.fast2sms.com/reference/whatsapp-webhook

## Reliability and limits

AlertJob has a unique (session, stage, phone, channel) index. Atomic leases prevent concurrent workers from claiming one job; errors retry with backoff up to five attempts. Configuration failures remain visible as failed jobs. Workers process at most 50 jobs per tick, prioritizing high stages; larger deployments should run a dedicated queue worker and monitor queue age, failed jobs and provider balance.

A process crash or timeout after Fast2SMS accepted a request but before the database recorded it can cause duplicate alerts on retry: provider-independent exactly-once delivery is not promised. udf1 carries the job ID for correlation, not provider deduplication. Safe check-in cancels pending jobs and workers check the commute immediately before dispatch, but an HTTP request already in flight cannot be recalled. Likewise, cancelling a job cannot guarantee the recipient never receives an already accepted alert.

**accepted** means the provider accepted the request, not that the recipient received it. This package does not implement delivery webhooks; add authenticated provider callbacks before displaying “delivered” in the UI. No police/ambulance dispatch is implemented. Treat this as an application backend starting point, not a guaranteed emergency service.

The app uses password hashing, JWT authentication, ownership filters, CORS allowlisting, validation, security headers, and rate limits. Before production, use HTTPS, recipient verification/consent, restricted DB credentials, backups, monitoring and a defined location-data retention policy. Configure HOST and FRONTEND_ORIGINS explicitly for your hosting environment. The supplied default binds only localhost.

## Validation

`npm test` runs 18 passing tests for escalation boundaries, GPS validation, number normalization, SMS/WhatsApp payloads, dry-run behavior, provider rejection, API authentication and ownership filters. Provider calls and database queries in adapter/API tests are mocked. Dependencies installed successfully and JavaScript syntax checks passed. A live MongoDB instance and actual Fast2SMS credentials were unavailable, so live persistence, cron recovery across processes and real delivery were not end-to-end tested.
