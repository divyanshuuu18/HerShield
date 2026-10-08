const mongoose = require('mongoose');
module.exports = mongoose.model('Circle', new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true, unique: true },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  capacity: { type: Number, default: 6 }
}, { timestamps: true }));
