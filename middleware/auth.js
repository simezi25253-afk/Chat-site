function requireLogin(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login.html'); // 
  }
  next();
}

module.exports = requireLogin;
