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

const mongoURI = 'mongodb+srv://simezi25253:DJAtPESi3iluSnab@chat-site-app.quoghij.mongodb.net/?retryWrites=true&w=majority';

mongoose.connect(mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(() => {
  console.log('✅ Connected to MongoDB');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
});

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

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.redirect('/login.html');
});

app.use('/', authRoutes);
app.use('/', myRoomsRoutes);

app.get('/chat', requireLogin, (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

const rooms = {};
const loadRoomsFromDB = async () => {
  try {
    const allRooms = await Room.find({});
    allRooms.forEach(r => {
      rooms[r.name] = {
        password: r.password,
        users: {},
        userMap: {},
        messages: r.messages,
        leader: r.leader,
        members: r.members.map(id => id.toString())
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

  socket.on('joinRoom', async ({ room, password, nickname }, callback) => {
    const userId = socket.request.session?.userId;
    if (!userId) return callback({ ok: false, error: 'ログイン情報が見つかりません' });

    if (!rooms[room]) {
      rooms[room] = {
        password,
        users: {},
        userMap: {},
        messages: [],
        leader: userId,
        members: [userId]
      };

      try {
        await Room.create({
          name: room,
          password,
          leader: userId,
          members: [userId],
          messages: []
        });
      } catch (err) {
        console.error('❌ ルーム作成時の保存失敗:', err);
      }
    } else {
      const savedPassword = rooms[room].password ?? '';
      const inputPassword = password ?? '';
      const isAlreadyMember = rooms[room].members?.includes(userId);

      if (!isAlreadyMember && savedPassword !== '' && String(savedPassword) !== String(inputPassword)) {
        return callback({ ok: false, error: 'Wrong password' });
      }

      if (!isAlreadyMember) {
        try {
          await Room.updateOne(
            { name: room },
            { $addToSet: { members: userId } }
          );
          rooms[room].members.push(userId);
        } catch (err) {
          console.error('❌ メンバー追加失敗:', err);
        }
      }
    }

    currentRoom = room;
    rooms[room].users[socket.id] = nickname;
    rooms[room].userMap[userId] = { nickname, userId };

    socket.join(room);
    socket.emit('leader', rooms[room].leader);
    io.to(room).emit('onlineUsers', rooms[room].userMap);
    callback({
      ok: true,
      isLeader: rooms[room].leader === userId,
      messages: rooms[room].messages
    });
  });

  socket.on('newMessage', async ({ room, text }) => {
    if (!rooms[room]) return;

    const userId = socket.request.session?.userId;
    const nickname = rooms[room].users[socket.id] || '名無し';

    const msg = {
      id: `${Date.now()}-${socket.id}`,
      userId,
      nickname,
      text,
      ts: Date.now(),
      readBy: [socket.id]
    };

    rooms[room].messages.push(msg);
    io.to(room).emit('newMessage', msg);

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
        readCount: msg.readBy.length - 1
      });
    }
  });

  socket.on('deleteMessage', async ({ room, messageId }) => {
    const index = rooms[room]?.messages.findIndex(
      m => m.id === messageId && m.userId?.toString() === socket.request.session?.userId
    );
    if (index !== -1 && index !== undefined) {
      rooms[room].messages.splice(index, 1);
      io.to(room).emit('deleteMessage', { messageId });

      try {
        await Room.updateOne(
          { name: room },
          { $pull: { messages: { id: messageId, userId: socket.request.session?.userId } } }
        );
      } catch (err) {
        console.error('❌ MongoDBからのメッセージ削除に失敗:', err);
      }
    }
  });

  socket.on('changePassword', ({ room, newPassword }) => {
    const userId = socket.request.session?.userId;
    if (rooms[room]?.leader === userId) {
      rooms[room].password = newPassword;
    }
  });

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const nickname = rooms[currentRoom].users[socket.id];
      const userId = socket.request.session?.userId;

      delete rooms[currentRoom].users[socket.id];
      delete rooms[currentRoom].userMap[userId];

      if (nickname) {
        io.to(currentRoom).emit('systemMessage', `${nickname} が一時退席しました`);
      }

      io.to(currentRoom).emit('onlineUsers', rooms[currentRoom].userMap);

      if (userId === rooms[currentRoom].leader) {
        const remainingUserIds = Object.values(rooms[currentRoom].userMap).map(u => u.userId);
        rooms[currentRoom].leader = remainingUserIds[0] || null;
        io.to(currentRoom).emit('leader', rooms[currentRoom].leader);
      }

      if (Object.keys(rooms[currentRoom].userMap).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
