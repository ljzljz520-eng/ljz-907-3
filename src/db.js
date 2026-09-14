// 数据库层：sql.js (WASM SQLite)，写操作后落盘到 data/training.db
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = path.join(DATA_DIR, 'training.db');

// 系统支持的岗位（课程"适用岗位"必须在此范围内，或填"全部"）
const POSITIONS = ['销售', '技术', '客服', '运营', '人事'];

let db = null;

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(`${salt}:${password}`).digest('hex');
}

function makeUser(username, password, name, role, position) {
  const salt = crypto.randomBytes(8).toString('hex');
  return [username, `${salt}:${hashPassword(password, salt)}`, name, role, position];
}

function initSchema() {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('admin','employee')),
      position TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS courses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      video_url TEXT NOT NULL,
      instructor TEXT NOT NULL,
      positions TEXT NOT NULL,          -- 逗号分隔，如 "销售,客服" 或 "全部"
      duration TEXT NOT NULL,
      updated_at TEXT NOT NULL,         -- 课程更新日期 YYYY-MM-DD
      created_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(title, video_url)          -- 防止重复导入
    );
    CREATE TABLE IF NOT EXISTS learning_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      course_id INTEGER NOT NULL REFERENCES courses(id),
      learned_at TEXT NOT NULL DEFAULT (datetime('now','localtime')),
      UNIQUE(user_id, course_id)
    );
    CREATE INDEX IF NOT EXISTS idx_learn_course ON learning_records(course_id);
    CREATE INDEX IF NOT EXISTS idx_learn_user ON learning_records(user_id);
  `);
}

function seed() {
  const row = get(`SELECT COUNT(*) AS n FROM users`);
  if (row.n > 0) return;
  const users = [
    makeUser('admin', 'admin123', '系统管理员', 'admin', ''),
    makeUser('wangfang', '123456', '王芳', 'employee', '销售'),
    makeUser('liqiang', '123456', '李强', 'employee', '技术'),
    makeUser('zhaomin', '123456', '赵敏', 'employee', '客服'),
    makeUser('sunli', '123456', '孙丽', 'employee', '运营'),
  ];
  const stmt = db.prepare(
    `INSERT INTO users (username, password_hash, name, role, position) VALUES (?,?,?,?,?)`
  );
  for (const u of users) stmt.run(u);
  stmt.free();
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// ---- 查询辅助 ----
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function get(sql, params = []) {
  return all(sql, params)[0];
}

function run(sql, params = []) {
  db.run(sql, params);
  save();
}

async function init() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    db = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    db = new SQL.Database();
  }
  initSchema();
  seed();
  save();
  console.log(`[db] ready, file: ${DB_PATH}`);
}

module.exports = { init, all, get, run, save, POSITIONS, hashPassword };
