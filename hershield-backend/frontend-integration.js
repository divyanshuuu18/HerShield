/* Replace the FINAL application <script> in index.html with this file's contents.
   Keep the Tailwind config script. Remove the old demo timer and simulator handlers.
   Set the token after /api/auth/login or /api/auth/register:
   sessionStorage.setItem('hershieldToken', response.token)
   The snippets in README show registration, circle setup and starting a commute. */
const API = 'http://localhost:5000';
let currentSession = null;
let gpsWatch = null;
let lastUpload = 0;
let uploadBusy = false;
const $ = id => document.getElementById(id);
function showToast(message) {
  const toast = document.createElement('div');
  toast.className = 'bg-slate-900 text-white p-3 rounded-xl shadow-lg';
  toast.textContent = message;
  $('toast-container')?.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
}
async function api(path, body) {
  const token = sessionStorage.getItem('hershieldToken');
  if (!token) throw new Error('Log in first (see README)');
  const response = await fetch(API + path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'API request failed');
  return data;
}
function paint() {
  if (!currentSession) return;
  const safe = currentSession.status === 'safe', stage = currentSession.stage;
  for (let n = 1; n <= 5; n++) $('banner-stage-' + n)?.classList.toggle('hidden', safe || stage !== n);
  if ($('commute-status-pill')) $('commute-status-pill').textContent = safe ? 'SAFE AT HOME' : ['','EN ROUTE','CHECK-IN DUE','ARE YOU SAFE?','CIRCLE ALERT QUEUED','EMERGENCY ALERT QUEUED'][stage];
  const seconds = Math.max(0, Math.ceil((new Date(currentSession.expectedArrivalAt) - Date.now()) / 1000));
  if ($('countdown-timer')) $('countdown-timer').textContent = safe ? 'SAFE' : `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  if ($('expected-time-text')) $('expected-time-text').textContent = 'Expected check-in by ' + new Date(currentSession.expectedArrivalAt).toLocaleTimeString();
  const l = currentSession.lastLocation;
  if ($('lat-val')) $('lat-val').textContent = l ? String(l.lat) : 'Unavailable';
  if ($('lng-val')) $('lng-val').textContent = l ? String(l.lng) : 'Unavailable';
  if ($('gps-timestamp')) $('gps-timestamp').textContent = l ? 'Received ' + new Date(l.receivedAt).toLocaleTimeString() : 'No GPS received';
  const link = $('google-maps-link');
  if (link) { if (currentSession.mapsUrl) link.href = currentSession.mapsUrl; else link.removeAttribute('href'); }
  if ($('gps-status-badge')) $('gps-status-badge').textContent = l ? 'LAST RECEIVED GPS' : 'GPS UNAVAILABLE';
}
async function startCommute(durationMinutes = 14) {
  try {
    currentSession = await api('/api/commute/start', { durationMinutes, route: 'Rajiv Chowk Metro Station to Malviya Nagar' });
    paint(); startLocationWatch(); showToast('Commute started');
  } catch (e) { showToast(e.message); }
}
async function uploadPosition(position) {
  if (!currentSession || currentSession.status !== 'active' || uploadBusy) return;
  uploadBusy = true;
  const id = currentSession.sessionId;
  try {
    const data = await api('/api/commute/update-location', { sessionId: id,
      location: { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy } });
    // Avoid a late location response undoing a successful safe check-in locally.
    if (currentSession?.sessionId === id && currentSession.status === 'active') currentSession = data;
    lastUpload = Date.now(); paint();
  } finally { uploadBusy = false; }
}
function startLocationWatch() {
  if (gpsWatch !== null) navigator.geolocation.clearWatch(gpsWatch);
  if (!navigator.geolocation) return showToast('GPS is unavailable on this browser');
  gpsWatch = navigator.geolocation.watchPosition(p => {
    if (Date.now() - lastUpload >= 15000) uploadPosition(p).catch(e => showToast(e.message));
  }, e => showToast('GPS unavailable: ' + e.message), { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}
function captureGPS() {
  if (!currentSession || currentSession.status !== 'active') return showToast('Start a commute first');
  if (!navigator.geolocation) return showToast('GPS unavailable');
  navigator.geolocation.getCurrentPosition(p => uploadPosition(p).catch(e => showToast(e.message)),
    e => showToast('GPS unavailable: ' + e.message), { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
}
async function markSafe() {
  if (!currentSession) return showToast('No commute to check in');
  try {
    currentSession = await api('/api/commute/safe', { sessionId: currentSession.sessionId });
    if (gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
    paint(); showToast('Safe check-in saved; pending escalation cancelled');
  } catch (e) { showToast(e.message); }
}
async function triggerFast2SMS() {
  if (!currentSession) return showToast('No active commute');
  try { const result = await api('/api/commute/dispatch', { sessionId: currentSession.sessionId }); showToast(result.message); }
  catch (e) { showToast(e.message); }
}
function closeModal() { $('fast2sms-modal')?.classList.add('hidden'); }
function setStage() { showToast('Stages are controlled by the server clock'); }
async function refresh() {
  try {
    const data = await api('/api/commute/current');
    currentSession = data; paint();
    if (data?.status === 'active' && gpsWatch === null) startLocationWatch();
    if (data?.status !== 'active' && gpsWatch !== null) { navigator.geolocation.clearWatch(gpsWatch); gpsWatch = null; }
  } catch (e) { showToast(e.message); }
}
// Existing demo has no Start button: add a real one beside the commute actions.
const startButton = document.createElement('button');
startButton.textContent = 'Start 14-minute commute';
startButton.className = 'p-3 rounded-xl bg-violet-600 text-white font-bold';
startButton.onclick = () => startCommute(14);
$('commute-status-pill')?.parentElement?.after(startButton);
for (let n = 1; n <= 5; n++) { const b = $('btn-stage-' + n); if (b) b.disabled = true; }
// Clear demo's fabricated location even before login.
for (const id of ['lat-val','lng-val']) if ($(id)) $(id).textContent = 'Unavailable';
$('google-maps-link')?.removeAttribute('href');
if (sessionStorage.getItem('hershieldToken')) refresh();
setInterval(() => { if (sessionStorage.getItem('hershieldToken')) refresh(); }, 15000);
setInterval(paint, 1000);
