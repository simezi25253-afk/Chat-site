const mongoose = require('mongoose');

const RoomSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  password: { type: String, default: '' },
  leader: { type: String, required: true },   // userId を文字列で保存
  members: { type: [String], default: [] }    // メンバーも文字列で保存
});

module.exports = mongoose.model('Room', RoomSchema);
