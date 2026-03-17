const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const authRoutes = require('./routes/auth');
const myRoomsRoutes = require('./routes/myRooms');
const requireLogin = require('./middleware/auth');
const Room = require('./models/Room');

// MongoDB 接続
const mongoURI = 'mongodb+srv://simezi25253:DJAtPESi3iluSnab@chat-site-app.quoghij.mongodb.net/?retryWrites=true&w=majority';
mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

// ルームごとのメッセージコレクションを作る関数（OverwriteModelError対策済み）
function getRoomMessageModel(roomName) {
  const safeName = roomName.replace(/[^a-zA-Z0-9]/g, "_");
  const modelName = `room_${safeName}`;

  if (mongoose.models[modelName]) {
    return mongoose.models[modelName];
  }

  return mongoose.model(
    modelName,
    new mongoose.Schema({
      userId: String,
      nickname: String,
      text: String,
      ts: Number,
      readBy: [String]
    }),
    modelName
  );
}

// セッション設定
const sessionMiddleware = session({
  secret: 'your-secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: mongoURI,
    collectionName: 'sessions'
  }),
  cookie: {
    maxAge: 1000 * 60 * 60,
    sameSite: 'lax',
    secure: false,
    httpOnly: true
  }
});

app.use(sessionMiddleware);
io.use((socket, next) => {
  sessionMiddleware(socket.request, {}, next);
});

// ミドルウェアとルーティング
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ホーム画面
app.get('/', (req, res) => res.redirect('/page1.html'));

app.use('/', authRoutes);
app.use('/', myRoomsRoutes);

// 🔥 ルーム固有URL（動的ルーティング）
app.get('/room/:roomName', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

// チャット作成時のセッション保存
app.post('/join-room', (req, res) => {
  const { room, password, nickname } = req.body;
  if (!room || !nickname) return res.json({ ok: false, error: 'ルーム名とニックネームは必須です' });

  if (!req.session.userId) {
    req.session.userId = new mongoose.Types.ObjectId().toString();
  }

  req.session.nickname = nickname;
  req.session.room = room;
  req.session.password = password;

  // 🔥 ルーム固有URLを返す
  const roomUrl = `/room/${encodeURIComponent(room)}`;

  res.json({ ok: true, url: roomUrl });
});

// セッション情報取得API
app.get('/session-info', (req, res) => {
  res.json({
    userId: req.session.userId,
    nickname: req.session.nickname,
    room: req.session.room,
    password: req.session.password
  });
});

// ルーム名とパスワードの一致確認
app.post('/check-room', async (req, res) => {
  const { room, password } = req.body;
  if (!room || !password) {
    return res.json({ ok: false, error: 'ルーム名とパスワードは必須です' });
  }

  try {
    const found = await Room.findOne({ name: room });
    if (!found) {
      return res.json({ ok: false, error: 'ルームが存在しません' });
    }

    const savedPassword = found.password ?? '';
    if (savedPassword !== '' && savedPassword !== password) {
      return res.json({ ok: false, error: 'パスワードが一致しません' });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('❌ /check-room エラー:', err);
    res.status(500).json({ ok: false, error: 'サーバーエラー' });
  }
});

// ルーム情報の初期化
const rooms = {};
const loadRoomsFromDB = async () => {
  try {
    const allRooms = await Room.find({});
    allRooms.forEach(r => {
      rooms[r.name] = {
        password: r.password,
        users: {},
        userMap: {},
        leader: r.leader,
        members: r.members
      };
    });
    console.log('🔁 MongoDBからルーム一覧を復元しました');
  } catch (err) {
    console.error('❌ MongoDBからの読み込みに失敗:', err);
  }
};
loadRoomsFromDB();

// ソケット通信
io.on('connection', (socket) => {
  let currentRoom = null;

  socket.on('joinRoom', async ({ room, password, nickname }, callback) => {
    const userId = socket.request.session?.userId;
    if (!userId) return callback({ ok: false, error: 'ログイン情報が見つかりません' });

    if (!rooms[room]) {
      rooms[room] = {
        password,
        users: {},
        userMap: {},
        leader: userId,
        members: [userId]
      };

      await Room.create({
        name: room,
        password,
        leader: userId,
        members: [userId]
      });

      getRoomMessageModel(room);
    } else {
      const savedPassword = rooms[room].password ?? '';
      const inputPassword = password ?? '';
      const isAlreadyMember = rooms[room].members.includes(userId);

      if (!isAlreadyMember && savedPassword !== '' && savedPassword !== inputPassword) {
        return callback({ ok: false, error: 'Wrong password' });
      }

      if (!isAlreadyMember) {
        await Room.updateOne({ name: room }, { $addToSet: { members: userId } });
        rooms[room].members.push(userId);
      }
    }

    currentRoom = room;
    rooms[room].users[socket.id] = nickname;
    rooms[room].userMap[userId] = { nickname, userId };

    socket.join(room);
    socket.emit('leader', rooms[room].leader);
    io.to(room).emit('onlineUsers', rooms[room].userMap);

    const MessageModel = getRoomMessageModel(room);
    const messages = await MessageModel.find({}).lean();

    callback({
      ok: true,
      isLeader: rooms[room].leader === userId,
      messages,
      userId
    });
  });

  socket.on('newMessage', async ({ room, text }) => {
    const userId = socket.request.session?.userId;
    const nickname = rooms[room]?.users[socket.id] || '名無し';

    const msg = {
      userId,
      nickname,
      text,
      ts: Date.now(),
      readBy: [socket.id]
    };

    const MessageModel = getRoomMessageModel(room);
    await MessageModel.create(msg);

    io.to(room).emit('newMessage', msg);
  });

  socket.on('messageRead', async ({ room, messageId }) => {
    const MessageModel = getRoomMessageModel(room);
    const msg = await MessageModel.findById(messageId);

    if (msg && !msg.readBy.includes(socket.id)) {
      msg.readBy.push(socket.id);
      await msg.save();

      io.to(room).emit('updateRead', {
        messageId,
        readCount: msg.readBy.length - 1
      });
    }
  });

  socket.on('deleteMessage', async ({ room, messageId }) => {
    const userId = socket.request.session?.userId;
    const MessageModel = getRoomMessageModel(room);

    const msg = await MessageModel.findById(messageId);
    if (msg && msg.userId === userId) {
      await MessageModel.deleteOne({ _id: messageId });
      io.to(room).emit('deleteMessage', { messageId });
    }
  });

  socket.on('changePassword', ({ room, newPassword }) => {
    const userId = socket.request.session?.userId;
    if (rooms[room]?.leader === userId) {
      rooms[room].password = newPassword;
      Room.updateOne({ name: room }, { password: newPassword }).exec();
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const nickname = rooms[currentRoom].users[socket.id];
      const userId = socket.request.session?.userId;

      delete rooms[currentRoom].users[socket.id];
      if (userId && rooms[currentRoom].userMap[userId]) {
        delete rooms[currentRoom].userMap[userId];
      }

      if (nickname) {
        io.to(currentRoom).emit('systemMessage', `${nickname} が一時退席しました`);
      }

      io.to(currentRoom).emit('onlineUsers', rooms[currentRoom].userMap);

      if (Object.keys(rooms[currentRoom].userMap).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

// サーバー起動
const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
