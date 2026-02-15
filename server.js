const express = require('express');
const session = require('express-session');
const path = require('path');
const mongoose = require('mongoose');
const http = require('http');
const { Server } = require('socket.io');
const MongoStore = require('connect-mongo');
const Room = require('./models/Room');
const authRoutes = require('./routes/auth');
const myRoomsRoutes = require('./routes/myRooms');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-app');

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sessionMiddleware = session({
  secret: 'secret-key',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI || 'mongodb://localhost:27017/chat-app' })
});

app.use(sessionMiddleware);

// Socket.IO でセッションを共有
io.engine.use(sessionMiddleware);

app.use(authRoutes);
app.use(myRoomsRoutes);

app.get('/chat', (req, res) => {
  if (!req.session.userId) return res.redirect('/login.html');
  res.sendFile(path.join(__dirname, 'public', 'chat.html'));
});

const rooms = {};

io.on('connection', (socket) => {
  socket.on('joinRoom', async ({ room, password, nickname }, callback) => {
    try {
      const userId = socket.request.session.userId;
      if (!userId) return callback({ ok: false, error: 'ログインしていません' });

      if (!rooms[room]) {
        // 新規ルーム作成
        rooms[room] = {
          password,
          leader: socket.id,
          members: new Set([socket.id]),
          messages: [],
          userMap: { [socket.id]: nickname },
          userIdMap: { [socket.id]: userId }
        };

        await Room.create({
          name: room,
          password,
          leader: userId,
          members: [userId],
          messages: []
        });
      } else {
        // ✅ パスワードが設定されている場合のみチェック
        if (rooms[room].password && rooms[room].password !== password) {
          return callback({ ok: false, error: 'Wrong password' });
        }

        rooms[room].members.add(socket.id);
        rooms[room].userMap[socket.id] = nickname;
        rooms[room].userIdMap[socket.id] = userId;

        await Room.updateOne(
          { name: room },
          { $addToSet: { members: userId } }
        );
      }

      socket.join(room);
      socket.room = room;

      socket.emit('leader', rooms[room].leader);
      io.to(room).emit('onlineUsers', rooms[room].userMap);
      callback({ ok: true, messages: rooms[room].messages });
    } catch (err) {
      console.error('❌ joinRoom エラー:', err);
      callback({ ok: false, error: 'ルーム参加に失敗しました' });
    }
  });

  socket.on('newMessage', async ({ room, text }) => {
    const userId = socket.request.session.userId;
    if (!userId || !rooms[room]) return;

    const msg = {
      text,
      nickname: rooms[room].userMap[socket.id],
      userId: rooms[room].userIdMap[socket.id],
      ts: Date.now()
    };

    rooms[room].messages.push(msg);
    io.to(room).emit('newMessage', msg);

    await Room.updateOne(
      { name: room },
      { $push: { messages: msg } }
    );
  });

  socket.on('disconnect', () => {
    const room = socket.room;
    if (!room || !rooms[room]) return;

    rooms[room].members.delete(socket.id);
    delete rooms[room].userMap[socket.id];
    delete rooms[room].userIdMap[socket.id];

    if (rooms[room].members.size === 0) {
      delete rooms[room];
    } else {
      io.to(room).emit('onlineUsers', rooms[room].userMap);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});
