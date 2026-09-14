// 认证：sha256 加盐密码 + HMAC 签名 Cookie 会话（无状态，重启不失效）
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const db = require('./db');

const SECRET_PATH = path.join(__dirname, '..', 'data', '.secret');
const COOKIE_NAME = 'training_sid';
const SESSION_TTL_MS = 7 * 24 * 3600 * 1000; // 7 天

let secret;
if (fs.existsSync(SECRET_PATH)) {
  secret = fs.readFileSync(SECRET_PATH, 'utf8').trim();
} else {
  secret = crypto.randomBytes(32).toString('hex');
  fs.mkdirSync(path.dirname(SECRET_PATH), { recursive: true });
  fs.writeFileSync(SECRET_PATH, secret, { mode: 0o600 });
}

function sign(payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const candidate = db.hashPassword(password, salt);
  // 恒定时间比较，防时序攻击
  return crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(hash));
}

function issueCookie(res, userId) {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${userId}.${exp}`;
  res.cookie(COOKIE_NAME, `${payload}.${sign(payload)}`, {
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_TTL_MS,
  });
}

function clearCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

function currentUser(req) {
  const raw = req.cookies?.[COOKIE_NAME];
  if (!raw) return null;
  const parts = raw.split('.');
  if (parts.length !== 3) return null;
  const [uid, exp, sig] = parts;
  const payload = `${uid}.${exp}`;
  const expected = sign(payload);
  if (sig.length !== expected.length ||
      !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Number(exp) < Date.now()) return null;
  return db.get(`SELECT id, username, name, role, position FROM users WHERE id = ?`, [Number(uid)]);
}

function requireAuth(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  req.user = user;
  next();
}

function requireAdmin(req, res, next) {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '未登录或会话已过期' });
  if (user.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  req.user = user;
  next();
}

module.exports = { verifyPassword, issueCookie, clearCookie, currentUser, requireAuth, requireAdmin };
