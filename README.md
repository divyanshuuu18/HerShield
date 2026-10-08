# HerShield local backend

## Run

Install Node.js 20+ and start MongoDB locally (or use a MongoDB Atlas URI).

```bash
npm install
cp .env.example .env
npm run seed
npm start
```

Open http://localhost:5000. Enter `hershield-local-demo-you` when prompted.
Start a commute explicitly; loading or refreshing never creates one.
To test peer alerts, open another browser profile and enter
`hershield-local-demo-riya`, start a commute, and choose immediate escalation.
The first browser displays Riya's alert on its next 10-second poll.
Edit the seeded User.phone field in MongoDB to enable a real call link.
`npm test` checks time boundaries and terminal states.

## Files

- server.js: Express endpoints, membership/token authorization, cron, startup.
- models/: User, Circle, CheckInSession Mongoose models.
- public/index.html: supplied layout with minimal wiring changes.
- public/app.js: replacement for the original Interactive Logic script.
- seed.js: repeatable local demo identities and circle (no active sessions).

Use the included HTML and app.js together: the JavaScript needs the added
Start button, dynamic member grid, and label IDs in that HTML.
The original History and Settings navigation buttons had no functionality;
they remain visual placeholders. Circle status is already visible on Home.
Simulator buttons preview stages without changing database records. Stage 4
preview displays a label; actual peer alert cards require real session data.
The concern card's immediate escalation button writes to the backend.

## API (Bearer token required)

| Method | Path | Body / query |
|---|---|---|
| POST | /api/commute/start | {circleId, durationMinutes:15, destination:"Home", route:"Metro Route"} |
| POST | /api/commute/safe | {sessionId}; peer confirmation also requires confirmedSpoken:true |
| POST | /api/commute/snooze | {sessionId, minutes:5} |
| GET | /api/circle/status | optional ?circleId=...; defaults to your circle |
| PATCH | /api/commute/destination | {sessionId, destination} |
| POST | /api/commute/escalate | {sessionId} |

GET /api/circle/status returns serverNow, currentUserId, circle, and members.
Each member contains id, name, phone and a latest-session status summary.
The current user's session additionally includes destination and route.
Mutations return {session}; errors return {error} with an appropriate HTTP code.
A user's token defines identity; user IDs supplied by clients cannot impersonate
another user. Membership is checked for each session operation. Peers can close
only sessions belonging to their circle and must explicitly confirm contact.
Confirmation records the actor, time, and self/spoken method.

## Timer policy

Default arrival is start + 15 minutes. Reminder is at arrival, concern is
arrival + 5 minutes, escalation is arrival + 10 minutes (15/20/25 from start).
The original HTML's "overdue by 25 minutes" was inconsistent with these times.
Snooze shifts all three deadlines. When already overdue, it starts from now.
Extensions are limited to 15 minutes per request and 60 minutes per session.
Escalated sessions cannot be snoozed. Safe sessions are terminal.

Cron runs once per minute; persistence may lag a deadline by roughly a minute.
Status reads derive the current stage from timestamps, and the UI polls every
10 seconds. The countdown uses the server clock offset. On restart the job
catches up overdue sessions directly to the correct stage. Atomic conditional
updates prevent stale timer work from undoing a concurrent check-in or snooze.
A partial unique index allows at most one active session per user.

## Scope and deployment

This is a local runnable prototype. Demo tokens are publicly documented, not
production credentials. There is no registration/login UI: replace the seed
and token provisioning with verified authentication and revocable credentials
before deployment. The server binds to loopback; production hosting needs an
explicit bind/proxy setup, HTTPS, suitable CORS origins, abuse controls, and
secure credential storage. Limit access to phone numbers to agreed circle
members. No GPS is collected.

Escalation persists status in MongoDB and displays a call prompt to peers who
have the app open. It does NOT send push notifications, SMS, place calls, or
contact emergency services. For background delivery add an authenticated push
or SMS provider with a durable outbox, retry handling, and deduplication.
Browser polling stops when a page closes and may slow in background tabs.
MongoDB session updates remain durable while the server is down, but cron runs
only while the Node process is running. No browser action claims successful
check-in until the server accepts it.

## Validation performed

Node syntax checks and the two timing tests passed. Full MongoDB-backed HTTP
integration and browser rendering were not run in the authoring environment
because a MongoDB server was unavailable. Run the setup and peer-alert scenario
above against your own MongoDB instance before using the app.
# HerShield
# HerShield
