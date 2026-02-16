const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  id: String,
  userId: mongoose.Schema.Types.ObjectId,
  nickname: String,
  text: String,
  ts: Number,
  readBy: [String] // ← ObjectId から String に修正済み！
});

const roomSchema = new mongoose.Schema({
  name: String,
  password: String,
  leader: mongoose.Schema.Types.ObjectId,
  members: [mongoose.Schema.Types.ObjectId],
  messages: [messageSchema]
});

module.exports = mongoose.model('Room', roomSchema);
