const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  circle: { type: mongoose.Schema.Types.ObjectId, ref: 'Circle', required: true },
  destination: { type: String, required: true, maxlength: 120 },
  route: { type: String, default: 'Metro Route', maxlength: 80 },
  startedAt: { type: Date, required: true },
  expectedAt: { type: Date, required: true },
  concernAt: { type: Date, required: true },
  escalateAt: { type: Date, required: true },
  stage: { type: String, enum: ['STAGE_1','STAGE_2','STAGE_3','STAGE_4','SAFE'], default: 'STAGE_1' },
  active: { type: Boolean, default: true },
  snoozedMinutes: { type: Number, default: 0 },
  safeAt: Date,
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmationMethod: { type: String, enum: ['self','spoken'] }
}, { timestamps: true });
schema.index({ user: 1 }, { unique: true, partialFilterExpression: { active: true } });
schema.index({ active: 1, expectedAt: 1 });
schema.index({ circle: 1, user: 1, startedAt: -1 });
module.exports = mongoose.model('CheckInSession', schema);
