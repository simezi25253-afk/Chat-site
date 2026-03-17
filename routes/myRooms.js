// routes/myRooms.js
const express = require('express');
const router = express.Router();
const Room = require('../models/Room');

router.get('/my-rooms', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未ログインです' });
  }

  try {
    const userId = req.session.userId.toString();

    // 自分がメンバーのルームを取得
    const rooms = await Room.find({ members: userId }).select('name leader').lean();

    // 重複ルーム名を排除
    const uniqueNames = [...new Set(rooms.map(r => r.name))];

    res.json({
      ok: true,
      rooms: uniqueNames
    });

  } catch (err) {
    console.error('❌ /my-rooms エラー:', err);
    res.status(500).json({ error: 'ルーム情報の取得に失敗しました' });
  }
});

module.exports = router;
