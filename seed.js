require('dotenv').config();
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const User = require('./models/User');
const Circle = require('./models/Circle');
async function main() {
  if (process.env.NODE_ENV === 'production') throw new Error('Demo seed is disabled in production.');
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/hershield');
  const members = [];
  for (const [key,name] of [['priya','Priya Patel'],['riya','Riya Sharma'],['sneha','Sneha Gupta'],['you','You']]) {
    const tokenHash = crypto.createHash('sha256').update('hershield-local-demo-' + key).digest('hex');
    const user = await User.findOneAndUpdate({ tokenHash }, { $setOnInsert: { name, phone: '', tokenHash } }, { upsert: true, new: true });
    members.push(user._id);
  }
  await Circle.findOneAndUpdate({ code: 'HER-8921' }, { $setOnInsert: { name: 'Night-Shift', members, capacity: 6 } }, { upsert: true });
  console.log('Demo circle ready. Your token: hershield-local-demo-you');
  await mongoose.disconnect();
}
main().catch(async e => { console.error(e.message); await mongoose.disconnect(); process.exitCode = 1; });
