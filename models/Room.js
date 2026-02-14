const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
  id: String,
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' }, // ← ObjectIdに変更
  nickname: String,
  text: String,
  ts: Number,
  readBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }]
});

const roomSchema = new mongoose.Schema({
  name: { type: String, required: true },
  password: { type: String },
  members: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  leader: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  messages: [messageSchema]
});

module.exports = mongoose.model('Room', roomSchema);
