const API = 'http://localhost:5000/api';
let state, selectedPeer, offset = 0, busy = false;
const $ = id => document.getElementById(id);
const time = date => new Date(date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
function token() {
  let value = sessionStorage.getItem('hershieldToken');
  if (!value) { value = prompt('Enter your HerShield access token (demo: hershield-local-demo-you)'); if (value) sessionStorage.setItem('hershieldToken', value); }
  return value;
}
async function api(path, method = 'GET', body) {
  const response = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + token(), ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(10000) });
  const data = await response.json();
  if (!response.ok) { if (response.status === 401) sessionStorage.removeItem('hershieldToken'); throw new Error(data.error || 'Request failed'); }
  return data;
}
const self = () => state?.members.find(m => m.id === state.currentUserId);
async function refresh() {
  state = await api('/circle/status'); offset = +new Date(state.serverNow) - Date.now(); render();
  $('connectionMessage').textContent = 'Connected • Circle status updates every 10 seconds';
}
async function action(fn) {
  if (busy) return;
  busy = true;
  try { await fn(); await refresh(); }
  catch (e) { $('connectionMessage').textContent = e.message; alert(e.message); }
  finally { busy = false; }
}
function needSession() { const s = self()?.session; if (!s?.active) throw new Error('Start a commute first.'); return s; }
window.startCommute = () => action(async () => {
  const destination = prompt('Destination', 'Home'); if (!destination) return;
  await api('/commute/start', 'POST', { circleId: state.circle.id, destination, durationMinutes: 15, route: 'Metro Route' });
});
window.markSelfSafe = () => action(() => api('/commute/safe', 'POST', { sessionId: needSession().id }));
window.snoozeTime = minutes => action(() => api('/commute/snooze', 'POST', { sessionId: needSession().id, minutes }));
window.editDestination = () => action(async () => {
  const s = needSession(); const destination = prompt('Destination', s.destination);
  if (destination) await api('/commute/destination', 'PATCH', { sessionId: s.id, destination });
});
window.escalateNow = () => action(() => api('/commute/escalate', 'POST', { sessionId: needSession().id }));
window.resolvePeerAlert = () => action(async () => {
  if (!selectedPeer) throw new Error('No peer alert to resolve.');
  if (confirm(`Did you speak to ${selectedPeer.name} and confirm she is safe?`))
    await api('/commute/safe', 'POST', { sessionId: selectedPeer.session.id, confirmedSpoken: true });
});
const labels = { STAGE_1: 'On the way', STAGE_2: 'Check-in reminder', STAGE_3: 'Are you okay?', STAGE_4: 'Needs a call', SAFE: 'Home, safe' };
const colors = { STAGE_1: 'text-blue-400', STAGE_2: 'text-amber-400', STAGE_3: 'text-orange-400', STAGE_4: 'text-red-400', SAFE: 'text-emerald-400' };
function memberCard(member) {
  const card = document.createElement('div'); card.className = 'glass-panel p-3.5 rounded-2xl flex items-center justify-between gap-3';
  const info = document.createElement('div');
  const name = document.createElement('h4'); name.className = 'font-bold text-sm'; name.textContent = member.id === state.currentUserId ? 'You' : member.name;
  const sub = document.createElement('p'); sub.className = 'text-[11px] text-gray-400';
  const s = member.session;
  sub.textContent = !s ? 'No active commute' : s.active ? 'Expected ' + time(s.expectedAt) : 'Safe at ' + time(s.safeAt);
  const badge = document.createElement('span'); badge.className = 'text-xs ' + (colors[s?.stage] || 'text-gray-400'); badge.textContent = labels[s?.stage] || 'Not travelling';
  info.append(name,sub); card.append(info,badge); return card;
}
function render() {
  $('circleName').textContent = `${state.circle.name} (#${state.circle.code})`;
  $('memberHeading').textContent = `Circle Members (${state.members.length}/${state.circle.capacity})`;
  $('membersGrid').replaceChildren(...state.members.map(memberCard));
  const s = self()?.session, active = !!s?.active;
  $('startBtn').classList.toggle('hidden', active);
  $('heroCommuteCard').classList.toggle('hidden', !active || s.stage === 'STAGE_3');
  $('areYouOkayCard').classList.toggle('hidden', !active || s.stage !== 'STAGE_3');
  $('nudgeBanner').classList.toggle('hidden', !active || s.stage !== 'STAGE_2');
  if (active) {
    $('commuteStatusLabel').textContent = `${s.stage.replace('STAGE_', 'Stage ')}: ${labels[s.stage]}`;
    $('commuteStatusLabel').className = 'text-xs font-semibold uppercase tracking-wider ' + colors[s.stage];
    $('expectedLabel').textContent = `EXPECTED CHECK-IN AT ${time(s.expectedAt)}`;
    $('routeLabel').textContent = s.route;
  }
  selectedPeer = state.members.find(m => m.id !== state.currentUserId && m.session?.active && m.session.stage === 'STAGE_4');
  $('peerAlertContainer').classList.toggle('hidden', !selectedPeer);
  if (selectedPeer) {
    $('peerName').textContent = `${selectedPeer.name} hasn't checked in!`;
    $('peerInitial').textContent = selectedPeer.name.charAt(0);
    $('peerDeadline').textContent = `Expected ${time(selectedPeer.session.expectedAt)}`;
    $('peerCall').textContent = 'Call ' + selectedPeer.name;
    const phone = selectedPeer.phone.replace(/[^+\d]/g, '');
    if (phone) $('peerCall').href = 'tel:' + phone; else $('peerCall').removeAttribute('href');
    $('peerCall').title = phone ? '' : 'No phone configured: add a real phone to the seeded user.';
  }
  tick();
}
function tick() {
  const s = self()?.session; if (!s?.active) return;
  const now = Date.now() + offset;
  const deadline = s.stage === 'STAGE_3' ? s.escalateAt : s.expectedAt;
  const seconds = Math.max(0, Math.ceil((+new Date(deadline) - now) / 1000));
  const display = `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`;
  $('countdownDisplay').textContent = display;
  $('concernDescription').textContent = `We haven't heard from you. Your circle will see an escalation in ${display}.`;
}
// Simulator previews cannot write or resolve anyone's real session.
window.setSimStage = stage => {
  $('simulationMessage').textContent = `Preview only: ${labels[stage]}. Live state returns on the next refresh.`;
  $('nudgeBanner').classList.toggle('hidden', stage !== 'STAGE_2');
  $('areYouOkayCard').classList.toggle('hidden', stage !== 'STAGE_3');
  $('heroCommuteCard').classList.toggle('hidden', stage === 'STAGE_3' || !self()?.session?.active);
};
setInterval(tick, 1000);
setInterval(() => { if (!busy) refresh().catch(e => { $('connectionMessage').textContent = 'Status unavailable: ' + e.message; }); }, 10000);
refresh().catch(e => { $('connectionMessage').textContent = e.message; });
