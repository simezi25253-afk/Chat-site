const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const mongoose = require('mongoose'); // ← ✅ ここだけでOK！

// MongoDBの接続URI（パスワード埋め込み済み）
const mongoURI = 'mongodb+srv://simezi25253:DJAtPESi3iluSnab@chat-site-app.quoghij.mongodb.net/?retryWrites=true&w=majority';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// MongoDBに保存するデータの構造を定義
const messageSchema = new mongoose.Schema({
  userId: String,
  nickname: String,
  text: String,
  ts: Number,
  readBy: [String]
});

const roomSchema = new mongoose.Schema({
  name: String,
  password: String,
  leader: String,
  messages: [messageSchema]
});

const Room = mongoose.model('Room', roomSchema);

app.use(express.static(path.join(__dirname, 'public')));

// ★ トップページ（/）にアクセスがあったときに index.html を返す
app.get('/', (req, res) => {
  res.sendFile(__dirname + '/public/index.html');
});

const rooms = {};
const loadRoomsFromDB = async () => {
  try {
    const allRooms = await Room.find({});
    allRooms.forEach(r => {
      rooms[r.name] = {
        password: r.password,
        users: {}, // 起動時は誰も接続してないので空
        messages: r.messages,
        leader: r.leader
      };
    });
    console.log('🔁 MongoDBからルーム情報を復元しました');
  } catch (err) {
    console.error('❌ MongoDBからの読み込みに失敗:', err);
  }
};

loadRoomsFromDB();

io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinRoom', ({ room, password, nickname }, callback) => {
    if (!rooms[room]) {
      rooms[room] = {
        password,
        users: {},
        messages: [],
        leader: socket.id
      };
    } else if (rooms[room].password !== password) {
      return callback({ ok: false, error: 'Wrong password' });
    }

    currentRoom = room;
    rooms[room].users[socket.id] = nickname;

    socket.join(room);
    socket.emit('leader', rooms[room].leader);
    io.to(room).emit('onlineUsers', Object.values(rooms[room].users));
    callback({
      ok: true,
      isLeader: rooms[room].leader === socket.id,
      messages: rooms[room].messages
    });
  });

  socket.on('newMessage', async ({ room, text }) => {
  if (!rooms[room]) return;

  const msg = {
    id: `${Date.now()}-${socket.id}`,
    userId: socket.id,
    nickname: rooms[room].users[socket.id],
    text,
    ts: Date.now(),
    readBy: [socket.id]
  };

  rooms[room].messages.push(msg);
  io.to(room).emit('newMessage', msg);

  // MongoDBにも保存
  try {
    await Room.updateOne(
      { name: room },
      { $push: { messages: msg } },
      { upsert: true }
    );
  } catch (err) {
    console.error('❌ MongoDBへの保存に失敗:', err);
  }
});

  socket.on('messageRead', ({ room, messageId }) => {
    const msg = rooms[room]?.messages.find(m => m.id === messageId);
    if (msg && !msg.readBy.includes(socket.id)) {
      msg.readBy.push(socket.id);
      io.to(room).emit('updateRead', {
        messageId,
        readCount: msg.readBy.length
      });
    }
  });

 socket.on('deleteMessage', async ({ room, messageId }) => {
  const index = rooms[room]?.messages.findIndex(
    m => m.id === messageId && m.userId === socket.id
  );
  if (index !== -1 && index !== undefined) {
    rooms[room].messages.splice(index, 1);
    io.to(room).emit('deleteMessage', { messageId });

    // MongoDBからも削除
    try {
      await Room.updateOne(
        { name: room },
        { $pull: { messages: { id: messageId, userId: socket.id } } }
      );
    } catch (err) {
      console.error('❌ MongoDBからのメッセージ削除に失敗:', err);
    }
  }
});

  socket.on('changePassword', ({ room, newPassword }) => {
    if (rooms[room]?.leader === socket.id) {
      rooms[room].password = newPassword;
    }
  });

  socket.on('changeNickname', ({ room, newNick }) => {
    if (rooms[room]?.users[socket.id]) {
      rooms[room].users[socket.id] = newNick;
      io.to(room).emit('updateNickname', {
        userId: socket.id,
        newNick
      });
      io.to(room).emit('onlineUsers', Object.values(rooms[room].users));
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      delete rooms[currentRoom].users[socket.id];
      if (socket.id === rooms[currentRoom].leader) {
        const userIds = Object.keys(rooms[currentRoom].users);
        rooms[currentRoom].leader = userIds[0] || null;
        io.to(currentRoom).emit('leader', rooms[currentRoom].leader);
      }
      io.to(currentRoom).emit('onlineUsers', Object.values(rooms[currentRoom].users));
      if (Object.keys(rooms[currentRoom].users).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

// ★ Render対応：ポート番号を環境変数から取得
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
