require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const cron = require('node-cron');
const crypto = require('node:crypto');
const path = require('node:path');
const User = require('./models/User');
const Circle = require('./models/Circle');
const CheckInSession = require('./models/CheckInSession');
const { stageAt, MINUTE } = require('./timing');
const app = express();
app.disable('x-powered-by');
const origins = (process.env.FRONTEND_ORIGINS || 'http://localhost:5000,http://localhost:5500,http://127.0.0.1:5500').split(',');
app.use(cors({ origin(origin, cb) { cb(null, !origin || origins.includes(origin)); } }));
app.use(express.json({ limit: '8kb' }));
app.use(express.static(path.join(__dirname, 'public')));
const hash = token => crypto.createHash('sha256').update(token).digest('hex');
const fail = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req,res,next)).catch(next);
const id = value => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
app.get('/api/health', (req,res) => res.json({ connected: mongoose.connection.readyState === 1 }));
app.use('/api', wrap(async (req,res,next) => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  if (!token) throw fail(401, 'A Bearer token is required.');
  req.user = await User.findOne({ tokenHash: hash(token) });
  if (!req.user) throw fail(401, 'Invalid token.');
  next();
}));
async function circleFor(req, value) {
  if (!id(value)) throw fail(400, 'Invalid circleId.');
  const circle = await Circle.findOne({ _id: value, members: req.user._id });
  if (!circle) throw fail(403, 'Circle membership required.');
  return circle;
}
async function ownActive(req) {
  if (!id(req.body.sessionId)) throw fail(400, 'Invalid sessionId.');
  const session = await CheckInSession.findOne({ _id: req.body.sessionId, user: req.user._id, active: true });
  if (!session) throw fail(409, 'No active session found. Refresh your circle.');
  await circleFor(req, String(session.circle));
  return session;
}
// Database deadlines survive restarts. Optimistic predicates prevent stale cron writes
// from undoing a concurrent safe check-in, snooze, or immediate escalation.
async function advanceTimers() {
  const now = new Date();
  for await (const s of CheckInSession.find({ active: true, expectedAt: { $lte: now } }).cursor()) {
    const next = stageAt(s, now);
    if (next !== s.stage) await CheckInSession.updateOne({
      _id: s._id, active: true, stage: s.stage,
      expectedAt: s.expectedAt, concernAt: s.concernAt, escalateAt: s.escalateAt
    }, { $set: { stage: next } });
  }
}
app.post('/api/commute/start', wrap(async (req,res) => {
  const circle = await circleFor(req, req.body.circleId);
  const { durationMinutes = 15, destination = 'Home', route = 'Metro Route' } = req.body;
  if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > 240) throw fail(400, 'durationMinutes must be 1–240.');
  if (typeof destination !== 'string' || !destination.trim() || destination.length > 120 || typeof route !== 'string' || route.length > 80) throw fail(400, 'Invalid destination or route.');
  const startedAt = new Date();
  const expectedAt = new Date(+startedAt + durationMinutes * MINUTE);
  const session = await CheckInSession.create({ user: req.user._id, circle: circle._id,
    destination: destination.trim(), route, startedAt, expectedAt,
    concernAt: new Date(+expectedAt + 5 * MINUTE), escalateAt: new Date(+expectedAt + 10 * MINUTE) });
  res.status(201).json({ session });
}));
app.post('/api/commute/safe', wrap(async (req,res) => {
  if (!id(req.body.sessionId)) throw fail(400, 'Invalid sessionId.');
  const s = await CheckInSession.findById(req.body.sessionId);
  if (!s) throw fail(404, 'Session not found.');
  await circleFor(req, String(s.circle));
  const self = s.user.equals(req.user._id);
  if (!self && req.body.confirmedSpoken !== true) throw fail(400, 'Confirm that you spoke to your peer and verified safety.');
  const session = await CheckInSession.findOneAndUpdate({ _id: s._id, active: true }, {
    $set: { active: false, stage: 'SAFE', safeAt: new Date(), confirmedBy: req.user._id, confirmationMethod: self ? 'self' : 'spoken' }
  }, { new: true }) || await CheckInSession.findById(s._id);
  res.json({ session });
}));
app.post('/api/commute/snooze', wrap(async (req,res) => {
  const s = await ownActive(req);
  const minutes = req.body.minutes;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 15) throw fail(400, 'minutes must be 1–15.');
  if (stageAt(s) === 'STAGE_4') throw fail(409, 'Escalated sessions require a safe check-in.');
  // For an overdue commute, extension starts now, avoiding a still-overdue result.
  const expectedAt = new Date(Math.max(Date.now(), +s.expectedAt) + minutes * MINUTE);
  const session = await CheckInSession.findOneAndUpdate({ _id: s._id, active: true, stage: s.stage, expectedAt: s.expectedAt, snoozedMinutes: { $lte: 60 - minutes } }, {
    $set: { expectedAt, concernAt: new Date(+expectedAt + 5 * MINUTE), escalateAt: new Date(+expectedAt + 10 * MINUTE), stage: 'STAGE_1' },
    $inc: { snoozedMinutes: minutes }
  }, { new: true });
  if (!session) throw fail(409, 'Session changed or 60-minute extension limit reached. Refresh and retry.');
  res.json({ session });
}));
app.patch('/api/commute/destination', wrap(async (req,res) => {
  const s = await ownActive(req);
  const value = req.body.destination;
  if (typeof value !== 'string' || !value.trim() || value.length > 120) throw fail(400, 'Destination must be 1–120 characters.');
  const session = await CheckInSession.findOneAndUpdate({ _id: s._id, active: true }, { $set: { destination: value.trim() } }, { new: true });
  if (!session) throw fail(409, 'Session already closed.');
  res.json({ session });
}));
app.post('/api/commute/escalate', wrap(async (req,res) => {
  const s = await ownActive(req);
  const session = await CheckInSession.findOneAndUpdate({ _id: s._id, active: true }, { $set: { stage: 'STAGE_4' } }, { new: true });
  if (!session) throw fail(409, 'Session already closed.');
  res.json({ session });
}));
app.get('/api/circle/status', wrap(async (req,res) => {
  const circle = req.query.circleId ? await circleFor(req, req.query.circleId) : await Circle.findOne({ members: req.user._id });
  if (!circle) throw fail(404, 'No circle found.');
  const users = await User.find({ _id: { $in: circle.members } }).lean();
  const members = await Promise.all(users.map(async user => {
    const s = await CheckInSession.findOne({ circle: circle._id, user: user._id }).sort({ startedAt: -1, _id: -1 }).lean();
    // No peer destination, route, token, or GPS data leaves this endpoint.
    return { id: String(user._id), name: user.name, phone: user.phone,
      session: s ? { id: String(s._id), active: s.active, stage: stageAt(s), expectedAt: s.expectedAt,
        concernAt: s.concernAt, escalateAt: s.escalateAt, safeAt: s.safeAt,
        ...(user._id.equals(req.user._id) ? { destination: s.destination, route: s.route } : {}) } : null };
  }));
  res.json({ serverNow: new Date(), currentUserId: String(req.user._id), circle: { id: String(circle._id), name: circle.name, code: circle.code, capacity: circle.capacity }, members });
}));
app.use('/api', (req,res) => res.status(404).json({ error: 'Endpoint not found.' }));
app.use((err,req,res,next) => {
  const status = err.code === 11000 ? 409 : err.status || (err.name === 'ValidationError' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.code === 11000 ? 'An active commute already exists.' : status === 500 ? 'Server error.' : err.message });
});
async function main() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hershield');
  await Promise.all([User.init(), Circle.init(), CheckInSession.init()]);
  await advanceTimers();
  const task = cron.schedule('* * * * *', async () => { try { await advanceTimers(); } catch (e) { console.error('Escalation job failed:', e.message); } }, { noOverlap: true });
  const server = app.listen(Number(process.env.PORT || 5000), '127.0.0.1', () => console.log('HerShield: http://localhost:5000'));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => { task.stop(); server.close(async () => { await mongoose.disconnect(); process.exit(0); }); });
}
if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });
module.exports = { app, advanceTimers };
