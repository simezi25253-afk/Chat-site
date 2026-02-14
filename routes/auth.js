const express = require('express');
const router = express.Router();
const User = require('../models/User');

router.post('/register', async (req, res) => {
  const { username, password, accessCode } = req.body;

  // アクセスコードが4桁の半角数字かチェック
  if (!/^\d{4}$/.test(accessCode)) {
    return res.status(400).json({ error: 'アクセスコードに使用できるのは半角数字のみです。' });
  }

  try {
    // アクセスコードの重複チェック
    const existingCode = await User.findOne({ accessCode });
    if (existingCode) {
      return res.status(400).json({ error: 'そのアクセスコードはすでに使用されています。' });
    }

    // ユーザー名の重複チェック（任意）
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

module.exports = router;
