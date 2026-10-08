'use strict';
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const crypto = require('node:crypto');
const { promisify } = require('node:util');
const { stageAt, locationInput, mapsLink, phoneInput } = require('./safety');
const scrypt = promisify(crypto.scrypt);
const E = process.env;
const app = express();
app.use(helmet());
const origins = (E.FRONTEND_ORIGINS || 'http://localhost:5500,http://127.0.0.1:5500').split(',');
app.use(cors({ origin: (origin, cb) => cb(null, !origin || origins.includes(origin)) }));
app.use(express.json({ limit: '16kb' }));
app.use('/api', rateLimit({ windowMs: 60000, limit: 120 }));
const authLimit = rateLimit({ windowMs: 15 * 60000, limit: 20 });
const objectId = mongoose.Schema.Types.ObjectId;
const User = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, maxlength: 80 },
  phone: { type: String, required: true, unique: true },
  passwordHash: { type: String, required: true, select: false },
  emergencyContacts: [{ name: String, phone: String, whatsapp: Boolean }]
}, { timestamps: true }));
const Circle = mongoose.model('Circle', new mongoose.Schema({
  owner: { type: objectId, ref: 'User', required: true, unique: true },
  contacts: [{ name: String, phone: String, whatsapp: Boolean }]
}, { timestamps: true }));
const locationSchema = new mongoose.Schema({ lat: Number, lng: Number, accuracy: Number, receivedAt: Date }, { _id: false });
const sessionSchema = new mongoose.Schema({
  user: { type: objectId, ref: 'User', required: true },
  status: { type: String, enum: ['active', 'safe'], default: 'active' },
  stage: { type: Number, min: 1, max: 5, default: 1 },
  startedAt: { type: Date, default: Date.now }, expectedArrivalAt: { type: Date, required: true },
  safeAt: Date, route: { type: String, maxlength: 160 }, lastLocation: locationSchema,
  // Snapshot configured contacts at start; never trust alert recipients in location requests.
  circleContacts: [{ name: String, phone: String, whatsapp: Boolean }],
  emergencyContacts: [{ name: String, phone: String, whatsapp: Boolean }]
}, { timestamps: true });
// MongoDB enforces one active commute, even when requests arrive simultaneously.
sessionSchema.index({ user: 1 }, { unique: true, partialFilterExpression: { status: 'active' } });
sessionSchema.index({ status: 1, expectedArrivalAt: 1 });
const CheckInSession = mongoose.model('CheckInSession', sessionSchema);
const AlertJob = mongoose.model('AlertJob', new mongoose.Schema({
  session: { type: objectId, ref: 'CheckInSession', required: true },
  stage: Number, phone: String, channel: { type: String, enum: ['sms', 'whatsapp'] },
  state: { type: String, enum: ['pending', 'sending', 'accepted', 'failed', 'cancelled', 'simulated'], default: 'pending' },
  attempts: { type: Number, default: 0 }, nextAttemptAt: { type: Date, default: Date.now },
  leaseUntil: Date, claim: String, providerRequestId: String, lastError: String
}, { timestamps: true }).index({ session: 1, stage: 1, phone: 1, channel: 1 }, { unique: true }));
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function text(value, name, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[|\r\n]/.test(value)) fail(400, `${name} is invalid`);
  return value.trim();
}
function contacts(value = []) {
  if (!Array.isArray(value) || value.length > 10) fail(400, 'Use at most 10 contacts per list');
  return value.map(c => ({ name: text(c.name, 'contact name', 80), phone: phoneInput(c.phone), whatsapp: c.whatsapp === true }));
}
function tokenFor(user) { return jwt.sign({}, E.JWT_SECRET, { subject: String(user._id), expiresIn: '12h', issuer: 'hershield', audience: 'hershield-web' }); }
app.post('/api/auth/register', authLimit, asyncRoute(async (req, res) => {
  const name = text(req.body.name, 'name', 80), phone = phoneInput(req.body.phone);
  const password = req.body.password;
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) fail(400, 'Password must have 12–128 characters');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = (await scrypt(password, salt, 64)).toString('hex');
  const user = await User.create({ name, phone, passwordHash: `${salt}:${hash}`, emergencyContacts: contacts(req.body.emergencyContacts) });
  res.status(201).json({ token: tokenFor(user), user: { id: user.id, name: user.name } });
}));
app.post('/api/auth/login', authLimit, asyncRoute(async (req, res) => {
  const phone = phoneInput(req.body.phone);
  if (typeof req.body.password !== 'string' || req.body.password.length > 128) fail(400, 'Invalid password');
  const user = await User.findOne({ phone }).select('+passwordHash');
  // Perform scrypt even for unknown accounts.
  const [salt, hash] = user ? user.passwordHash.split(':') : ['dummy-salt', '00'.repeat(64)];
  const actual = await scrypt(req.body.password, salt, 64);
  if (!user || !crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'))) fail(401, 'Invalid credentials');
  res.json({ token: tokenFor(user), user: { id: user.id, name: user.name } });
}));
app.use('/api', (req, res, next) => {
  try {
    const token = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
    req.userId = jwt.verify(token, E.JWT_SECRET, { algorithms: ['HS256'], issuer: 'hershield', audience: 'hershield-web' }).sub;
    if (!mongoose.isValidObjectId(req.userId)) throw new Error();
    next();
  } catch { res.status(401).json({ error: 'Valid Bearer token required' }); }
});
app.put('/api/circle', asyncRoute(async (req, res) => {
  const circle = await Circle.findOneAndUpdate({ owner: req.userId }, { $set: { contacts: contacts(req.body.contacts) } }, { upsert: true, new: true, runValidators: true });
  res.json(circle);
}));
app.put('/api/user/emergency-contacts', asyncRoute(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.userId, { $set: { emergencyContacts: contacts(req.body.contacts) } }, { new: true, runValidators: true });
  if (!user) fail(404, 'User not found');
  res.json({ emergencyContacts: user.emergencyContacts });
}));
function publicSession(s) {
  return s ? { sessionId: s.id, status: s.status, stage: s.stage, startedAt: s.startedAt,
    expectedArrivalAt: s.expectedArrivalAt, safeAt: s.safeAt, lastLocation: s.lastLocation,
    mapsUrl: mapsLink(s.lastLocation), locationSharedWithEmergencyContacts: s.status === 'active' && s.stage === 5 } : null;
}
function sessionId(req) {
  if (!mongoose.isValidObjectId(req.body.sessionId)) fail(400, 'Valid sessionId required');
  return req.body.sessionId;
}
app.post('/api/commute/start', asyncRoute(async (req, res) => {
  const minutes = req.body.durationMinutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) fail(400, 'durationMinutes must be an integer from 1 to 1440');
  const user = await User.findById(req.userId), circle = await Circle.findOne({ owner: req.userId });
  if (!user) fail(404, 'User not found');
  const session = await CheckInSession.create({ user: user.id, expectedArrivalAt: new Date(Date.now() + minutes * 60000),
    route: req.body.route === undefined ? '' : text(req.body.route, 'route', 160),
    lastLocation: req.body.location === undefined ? undefined : locationInput(req.body.location),
    circleContacts: circle?.contacts || [], emergencyContacts: user.emergencyContacts });
  res.status(201).json(publicSession(session));
}));
app.post('/api/commute/update-location', asyncRoute(async (req, res) => {
  const id = sessionId(req), location = locationInput(req.body.location);
  const s = await CheckInSession.findOneAndUpdate({ _id: id, user: req.userId, status: 'active' }, { $set: { lastLocation: location } }, { new: true });
  if (!s) fail(404, 'Active commute not found');
  res.json(publicSession(s));
}));
app.post('/api/commute/safe', asyncRoute(async (req, res) => {
  const id = sessionId(req);
  await CheckInSession.updateOne({ _id: id, user: req.userId, status: 'active' }, { $set: { status: 'safe', safeAt: new Date() } });
  const s = await CheckInSession.findOne({ _id: id, user: req.userId });
  if (!s) fail(404, 'Commute not found');
  await AlertJob.updateMany({ session: id, state: { $in: ['pending', 'failed', 'sending'] } }, { $set: { state: 'cancelled' } });
  res.json(publicSession(s));
}));
app.get('/api/commute/current', asyncRoute(async (req, res) => {
  res.json(publicSession(await CheckInSession.findOne({ user: req.userId }).sort({ startedAt: -1 })));
}));
app.get('/api/circle/status', asyncRoute(async (req, res) => {
  const s = await CheckInSession.findOne({ user: req.userId }).sort({ startedAt: -1 });
  const jobs = s ? await AlertJob.find({ session: s.id }).select('stage channel state attempts providerRequestId lastError') : [];
  res.json({ session: publicSession(s), alerts: jobs });
}));
// Manual dispatch is restricted to stage 5, and uses the SAME idempotent jobs as cron.
app.post('/api/commute/dispatch', asyncRoute(async (req, res) => {
  const s = await CheckInSession.findOne({ _id: sessionId(req), user: req.userId, status: 'active', stage: 5 });
  if (!s) fail(409, 'Emergency dispatch is available only at stage 5');
  await reconcileJobs(s);
  res.status(202).json({ queued: true, message: 'Queued; query /api/circle/status for provider acceptance' });
}));
async function reconcileJobs(s) {
  const user = await User.findById(s.user);
  if (!user) return;
  for (let stage = 2; stage <= s.stage; stage++) {
    const list = stage < 4 ? [{ phone: user.phone, whatsapp: false }] : stage === 4 ? s.circleContacts : [...s.circleContacts, ...s.emergencyContacts];
    for (const c of list) {
      for (const channel of c.whatsapp ? ['sms', 'whatsapp'] : ['sms']) {
        try {
          await AlertJob.updateOne({ session: s.id, stage, phone: c.phone, channel },
            { $setOnInsert: { state: 'pending', attempts: 0, nextAttemptAt: new Date() } }, { upsert: true });
        } catch (e) { if (e.code !== 11000) throw e; }
      }
    }
  }
}
function template(stage, channel) {
  const key = channel === 'sms' ? `SMS_MESSAGE_ID_STAGE_${stage}` : `WA_MESSAGE_ID_STAGE_${stage}`;
  if (!E[key]) throw new Error(`Missing ${key}`);
  return E[key];
}
async function sendAlert(job, s, user) {
  const label = { 2: 'Arrival due: please check in', 3: '5 minutes overdue: are you safe?', 4: '10 minutes overdue: please call the traveller', 5: '30 minutes overdue: emergency check required' }[job.stage];
  // Approved templates must have these FIVE variables in this exact order.
  const location = job.stage === 5 ? mapsLink(s.lastLocation) || 'Location unavailable' : 'Location not shared at this stage';
  const timestamp = job.stage === 5 && s.lastLocation ? s.lastLocation.receivedAt.toISOString() : 'No location shared';
  const values = [user.name, label, user.phone, location, timestamp].join('|');
  if (E.ALERTS_DRY_RUN !== 'false') return { simulated: true };
  if (!E.FAST2SMS_API_KEY) throw new Error('Missing FAST2SMS_API_KEY');
  let url, options;
  const headers = { Authorization: E.FAST2SMS_API_KEY, 'Content-Type': 'application/json' };
  if (job.channel === 'sms') {
    if (!E.FAST2SMS_SENDER_ID) throw new Error('Missing FAST2SMS_SENDER_ID');
    url = 'https://www.fast2sms.com/dev/bulkV2';
    options = { method: 'POST', headers, body: JSON.stringify({ route: 'dlt', sender_id: E.FAST2SMS_SENDER_ID,
      message: template(job.stage, 'sms'), variables_values: values, numbers: job.phone, udf1: job.id }) };
  } else {
    if (!E.FAST2SMS_WA_PHONE_NUMBER_ID) throw new Error('Missing FAST2SMS_WA_PHONE_NUMBER_ID');
    url = new URL('https://www.fast2sms.com/dev/whatsapp');
    url.search = new URLSearchParams({ message_id: template(job.stage, 'whatsapp'), phone_number_id: E.FAST2SMS_WA_PHONE_NUMBER_ID,
      numbers: job.phone, variables_values: values, udf1: job.id });
    options = { method: 'GET', headers };
  }
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10000) });
  const body = await response.json();
  if (!response.ok || body.return === false || body.status === 'error' || body.error) throw new Error(`Fast2SMS rejected request (HTTP ${response.status})`);
  const accepted = body.return === true || body.status === 'success' || body.request_id || body.messages?.[0]?.id;
  if (!accepted) throw new Error('Unrecognized Fast2SMS response; acceptance not confirmed');
  return { requestId: String(body.request_id || body.messages?.[0]?.id || '') };
}
async function deliverJobs() {
  // Bounded batch. Atomic claim leases allow several server instances to run safely.
  for (let n = 0; n < 50; n++) {
    const now = new Date(), claim = crypto.randomUUID();
    const job = await AlertJob.findOneAndUpdate({ attempts: { $lt: 5 }, $or: [
      { state: { $in: ['pending', 'failed'] }, nextAttemptAt: { $lte: now } },
      { state: 'sending', leaseUntil: { $lt: now } }
    ] }, { $set: { state: 'sending', claim, leaseUntil: new Date(Date.now() + 60000) }, $inc: { attempts: 1 } }, { new: true, sort: { stage: -1, createdAt: 1 } });
    if (!job) break;
    try {
      const s = await CheckInSession.findById(job.session);
      // Do not send stale nudges after a higher stage has already been reached.
      if (!s || s.status !== 'active' || job.stage < s.stage) {
        await AlertJob.updateOne({ _id: job.id, claim, state: 'sending' }, { $set: { state: 'cancelled' } });
        continue;
      }
      const user = await User.findById(s.user);
      if (!user) throw new Error('User missing');
      const result = await sendAlert(job, s, user);
      await AlertJob.updateOne({ _id: job.id, claim, state: 'sending' }, { $set: {
        state: result.simulated ? 'simulated' : 'accepted', providerRequestId: result.requestId || '', lastError: ''
      } });
    } catch (e) {
      await AlertJob.updateOne({ _id: job.id, claim, state: 'sending' }, { $set: {
        state: 'failed', lastError: e.message.slice(0, 200), nextAttemptAt: new Date(Date.now() + Math.min(15, 2 ** job.attempts) * 60000)
      } });
      console.error('Alert attempt failed', job.id, e.message);
    }
  }
}
let tickRunning = false;
async function escalationTick() {
  if (tickRunning) return;
  tickRunning = true;
  try {
    for await (const s of CheckInSession.find({ status: 'active', expectedArrivalAt: { $lte: new Date() } }).cursor()) {
      const target = stageAt(s.expectedArrivalAt);
      await CheckInSession.updateOne({ _id: s.id, status: 'active' }, { $max: { stage: target } });
      const fresh = await CheckInSession.findOne({ _id: s.id, status: 'active' });
      if (fresh) await reconcileJobs(fresh); // repairs a crash between stage persistence and job creation
    }
    await deliverJobs();
  } finally { tickRunning = false; }
}
app.use((err, req, res, next) => {
  if (err.code === 11000) return res.status(409).json({ error: 'Phone already registered or an active commute already exists' });
  const status = err.status || (err.name === 'ValidationError' || err.name === 'CastError' ? 400 : 500);
  if (status === 500) console.error('Request failed', err.name);
  res.status(status).json({ error: status === 500 ? 'Internal server error' : err.message });
});
async function main() {
  if (!E.MONGODB_URI || !E.JWT_SECRET || E.JWT_SECRET.length < 32) throw new Error('Set MONGODB_URI and a JWT_SECRET of at least 32 characters');
  await mongoose.connect(E.MONGODB_URI, { serverSelectionTimeoutMS: 10000 });
  await Promise.all([User.init(), Circle.init(), CheckInSession.init(), AlertJob.init()]);
  const task = cron.schedule('* * * * *', () => escalationTick().catch(e => console.error('Escalation failed', e.name)));
  const server = app.listen(Number(E.PORT || 5000), E.HOST || '127.0.0.1', () => console.log('HerShield API listening on port', E.PORT || 5000));
  escalationTick().catch(e => console.error('Startup escalation failed', e.name));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    task.stop();
    server.close(async () => { await mongoose.disconnect(); process.exit(0); });
  });
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { app, User, Circle, CheckInSession, AlertJob, escalationTick, sendAlert };
