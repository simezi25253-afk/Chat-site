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

        // MongoDBにも保存
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

        // MongoDBにもメンバー追加（重複チェック付き）
        await Room.updateOne(
          { name: room },
          { $addToSet: { members: userId } }
        );
      }

      socket.join(room);
      socket.room = room;

      // クライアントにリーダーIDを通知
      socket.emit('leader', rooms[room].leader);

      // オンラインユーザー一覧を送信
      io.to(room).emit('onlineUsers', rooms[room].userMap);

      // 過去のメッセージを返す
      callback({ ok: true, messages: rooms[room].messages });
    } catch (err) {
      console.error('❌ joinRoom エラー:', err);
      callback({ ok: false, error: 'ルーム参加に失敗しました' });
    }
  });

  // 他のイベント（newMessage, disconnectなど）もここに続く…
});
