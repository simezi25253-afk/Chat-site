// ...（前半はそのまま）

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
    rooms[room].userMap[socket.id] = { nickname, userId };

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

  socket.on('disconnect', () => {
    if (currentRoom && rooms[currentRoom]) {
      const nickname = rooms[currentRoom].users[socket.id];
      delete rooms[currentRoom].users[socket.id];
      delete rooms[currentRoom].userMap[socket.id];

      if (nickname) {
        io.to(currentRoom).emit('systemMessage', `${nickname} が一時退席しました`);
      }

      io.to(currentRoom).emit('onlineUsers', rooms[currentRoom].userMap);

      if (socket.id === rooms[currentRoom].leader) {
        const userIds = Object.keys(rooms[currentRoom].users);
        rooms[currentRoom].leader = userIds[0] || null;
        io.to(currentRoom).emit('leader', rooms[currentRoom].leader);
      }

      if (Object.keys(rooms[currentRoom].users).length === 0) {
        delete rooms[currentRoom];
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
http.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
