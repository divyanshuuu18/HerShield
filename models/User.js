const mongoose = require('mongoose');
module.exports = mongoose.model('User', new mongoose.Schema({
  name: { type: String, required: true, maxlength: 80 },
  phone: { type: String, default: '' },
  tokenHash: { type: String, required: true, unique: true, select: false }
}, { timestamps: true }));
