const express = require('express');
const router = express.Router();
const User = require('../models/User');
const { Types } = require('mongoose');

// --- 新規登録ルート ---
router.post('/register', async (req, res) => {
  const { username, password, accessCode } = req.body;

  if (!/^\d{4}$/.test(accessCode)) {
    return res.status(400).json({ error: 'アクセスコードに使用できるのは半角数字のみです。' });
  }

  try {
    const existingCode = await User.findOne({ accessCode });
    if (existingCode) {
      return res.status(400).json({ error: 'そのアクセスコードはすでに使用されています。' });
    }

    const existingUser = await User.findOne({ username });
    if (existingUser) {
      return res.status(400).json({ error: 'そのユーザー名はすでに使われています。' });
    }

    const user = new User({ username, password, accessCode });
    await user.save();
    req.session.userId = user._id;
    res.status(201).json({ message: '登録成功', user: { username: user.username } });
  } catch (err) {
    console.error('❌ 登録エラー:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// --- アクセスコードでのログインルート ---
router.post('/login', async (req, res) => {
  const { accessCode } = req.body;

  if (!/^\d{4}$/.test(accessCode)) {
    return res.status(400).json({ error: 'アクセスコードに使用できるのは半角数字のみです。' });
  }

  try {
    const user = await User.findOne({ accessCode });
    if (!user) {
      return res.status(401).json({ error: 'アクセスコードが無効です。' });
    }

    req.session.userId = user._id;
    res.json({ message: 'ログイン成功', user: { username: user.username } });
  } catch (err) {
    console.error('❌ ログインエラー:', err);
    res.status(500).json({ error: 'サーバーエラーが発生しました' });
  }
});

// --- ログイン中のユーザー情報取得ルート ---
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: '未ログインです' });
  }

  try {
    console.log('セッションのuserId:', req.session.userId);

    const objectId = new Types.ObjectId(req.session.userId); // ← 明示的に変換
    const user = await User.findById(objectId);

    if (!user) {
      return res.status(404).json({ error: 'ユーザーが見つかりません' });
    }

    res.json({ username: user.username });
  } catch (err) {
    console.error('❌ ユーザー情報取得エラー:', err);
    res.status(500).json({ error: 'ユーザー情報の取得に失敗しました' });
  }
});

module.exports = router;
