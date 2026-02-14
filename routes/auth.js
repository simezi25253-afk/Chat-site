const express = require('express');
const router = express.Router();
const User = require('../models/User');

// ユーザー登録
router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = new User({ username, password });
    await user.save();
    req.session.userId = user._id;
    res.status(201).json({ message: '登録成功', user: { username: user.username } });
  } catch (err) {
    res.status(400).json({ error: '登録に失敗しました' });
  }
});

// ログイン
router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const user = await User.findOne({ username });
    if (!user || !(await user.comparePassword(password))) {
      return res.status(401).json({ error: 'ユーザー名またはパスワードが間違っています' });
    }
    req.session.userId = user._id;
    res.json({ message: 'ログイン成功', user: { username: user.username } });
  } catch (err) {
    res.status(500).json({ error: 'ログイン中にエラーが発生しました' });
  }
});

// ログアウト
router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('connect.sid');
    res.json({ message: 'ログアウトしました' });
  });
});

module.exports = router;
