// routes/myRooms.js
const express = require('express');
const router = express.Router();
const Room = require('../models/Room');
const { Types } = require('mongoose');

router.get('/my-rooms', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未ログインです' });
  }

  try {
    const userId = new Types.ObjectId(req.session.userId);
    const rooms = await Room.find({ members: userId }).select('name _id');
    res.json({ rooms });
  } catch (err) {
    console.error('❌ /my-rooms エラー:', err);
    res.status(500).json({ error: 'ルーム情報の取得に失敗しました' });
  }
});

module.exports = router;
