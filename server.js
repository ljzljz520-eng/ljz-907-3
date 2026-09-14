// 企业培训视频目录系统
const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const db = require('./src/db');
const auth = require('./src/auth');
const { parseCSV, mapHeaders, validateCourseRow, REQUIRED_HEADERS } = require('./src/csvutil');

const app = express();
const PORT = process.env.PORT || 3000;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // CSV 限 2MB
});

app.use(express.json());
app.use(cookieParser());

// ---------- 页面路由 ----------
app.get('/', (req, res) => {
  const user = auth.currentUser(req);
  if (!user) return res.redirect('/login.html');
  res.redirect(user.role === 'admin' ? '/admin.html' : '/employee.html');
});
// 页面级保护：未登录/越权直接打回登录页
app.get('/admin.html', (req, res, next) => {
  const user = auth.currentUser(req);
  if (!user || user.role !== 'admin') return res.redirect('/login.html');
  next();
});
app.get('/employee.html', (req, res, next) => {
  if (!auth.currentUser(req)) return res.redirect('/login.html');
  next();
});
app.use(express.static(path.join(__dirname, 'public')));

// ---------- 认证 API ----------
app.post('/api/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '请输入用户名和密码' });
  const user = db.get(`SELECT * FROM users WHERE username = ?`, [String(username).trim()]);
  if (!user || !auth.verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  auth.issueCookie(res, user.id);
  res.json({ id: user.id, username: user.username, name: user.name, role: user.role, position: user.position });
});

app.post('/api/logout', (req, res) => {
  auth.clearCookie(res);
  res.json({ ok: true });
});

app.get('/api/me', auth.requireAuth, (req, res) => res.json(req.user));

app.get('/api/positions', auth.requireAuth, (req, res) => res.json(db.POSITIONS));

// ---------- 员工端 API ----------
// 课程列表：?position=销售 筛选；默认只看自己岗位（含"全部"）
app.get('/api/courses', auth.requireAuth, (req, res) => {
  const position = String(req.query.position || req.user.position || '').trim();
  const rows = db.all(`
    SELECT c.*, lr.id AS learned_id, lr.learned_at
    FROM courses c
    LEFT JOIN learning_records lr ON lr.course_id = c.id AND lr.user_id = ?
    ORDER BY c.updated_at DESC, c.id DESC
  `, [req.user.id]);

  const courses = rows
    .filter(c => {
      if (!position) return true;
      const list = c.positions.split(',');
      return list.includes('全部') || list.includes(position);
    })
    .map(c => ({
      id: c.id, title: c.title, video_url: c.video_url, instructor: c.instructor,
      positions: c.positions, duration: c.duration, updated_at: c.updated_at,
      learned: !!c.learned_id, learned_at: c.learned_at || null,
    }));
  res.json({ position, total: courses.length, courses });
});

// 标记 / 取消已学习
app.post('/api/learn', auth.requireAuth, (req, res) => {
  const { course_id, learned } = req.body || {};
  const course = db.get(`SELECT id FROM courses WHERE id = ?`, [Number(course_id)]);
  if (!course) return res.status(404).json({ error: '课程不存在' });
  if (learned) {
    db.run(`INSERT OR IGNORE INTO learning_records (user_id, course_id) VALUES (?, ?)`,
      [req.user.id, course.id]);
  } else {
    db.run(`DELETE FROM learning_records WHERE user_id = ? AND course_id = ?`,
      [req.user.id, course.id]);
  }
  res.json({ ok: true, course_id: course.id, learned: !!learned });
});

// ---------- 管理端 API ----------
// 学习统计：每个视频的学习人数 + 学员明细
app.get('/api/admin/stats', auth.requireAdmin, (req, res) => {
  const courses = db.all(`
    SELECT c.*, COUNT(lr.id) AS learn_count
    FROM courses c
    LEFT JOIN learning_records lr ON lr.course_id = c.id
    GROUP BY c.id
    ORDER BY learn_count DESC, c.id DESC
  `);
  const learners = db.all(`
    SELECT lr.course_id, u.name, u.position, lr.learned_at
    FROM learning_records lr JOIN users u ON u.id = lr.user_id
    ORDER BY lr.learned_at DESC
  `);
  const byCourse = {};
  for (const l of learners) (byCourse[l.course_id] ||= []).push(l);
  res.json({
    total_courses: courses.length,
    courses: courses.map(c => ({ ...c, learners: byCourse[c.id] || [] })),
  });
});

// CSV 批量导入：逐行校验，坏行拦截并说明原因，好行入库，重复行跳过
app.post('/api/admin/import', auth.requireAdmin, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择要上传的 CSV 文件' });

  const text = req.file.buffer.toString('utf8');
  if (text.includes('�')) {
    return res.status(400).json({ error: '文件编码无法识别，请将 CSV 保存为 UTF-8 编码后重试' });
  }
  const rows = parseCSV(text).filter(r => r.some(cell => String(cell).trim() !== ''));
  if (rows.length < 2) {
    return res.status(400).json({ error: 'CSV 内容为空或只有表头，没有可导入的数据行' });
  }

  const { colIndex, missing } = mapHeaders(rows[0]);
  if (missing.length > 0) {
    return res.status(400).json({
      error: `CSV 表头缺少必需列：${missing.join('、')}。必需列：${REQUIRED_HEADERS.join('、')}`,
    });
  }

  const imported = [], skipped = [], failed = [];
  for (let i = 1; i < rows.length; i++) {
    const rowNo = i + 1; // CSV 中的行号（含表头）
    const cells = rows[i];
    const result = validateCourseRow(cells, colIndex, db.POSITIONS);
    if (!result.ok) {
      failed.push({ row: rowNo, title: String(cells[colIndex['课程标题']] || '').trim() || '(无标题)', errors: result.errors });
      continue;
    }
    const c = result.course;
    const dup = db.get(`SELECT id FROM courses WHERE title = ? AND video_url = ?`, [c.title, c.video_url]);
    if (dup) {
      skipped.push({ row: rowNo, title: c.title, reason: '课程已存在（标题+链接相同），跳过' });
      continue;
    }
    db.run(
      `INSERT INTO courses (title, video_url, instructor, positions, duration, updated_at) VALUES (?,?,?,?,?,?)`,
      [c.title, c.video_url, c.instructor, c.positions, c.duration, c.updated_at]
    );
    imported.push({ row: rowNo, title: c.title });
  }

  res.json({
    total_rows: rows.length - 1,
    imported_count: imported.length,
    skipped_count: skipped.length,
    failed_count: failed.length,
    imported, skipped, failed,
  });
});

// 课程管理：列表 / 删除
app.get('/api/admin/courses', auth.requireAdmin, (req, res) => {
  res.json(db.all(`SELECT * FROM courses ORDER BY id DESC`));
});

app.delete('/api/admin/courses/:id', auth.requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (!db.get(`SELECT id FROM courses WHERE id = ?`, [id])) {
    return res.status(404).json({ error: '课程不存在' });
  }
  db.run(`DELETE FROM learning_records WHERE course_id = ?`, [id]);
  db.run(`DELETE FROM courses WHERE id = ?`, [id]);
  res.json({ ok: true });
});

// CSV 模板下载
app.get('/api/admin/template.csv', auth.requireAdmin, (req, res) => {
  const csv = '﻿课程标题,视频链接,讲师,适用岗位,时长,更新日期\n'
    + '新员工入职培训,https://video.example.com/onboarding,王芳,全部,45分钟,2026-09-01\n'
    + '销售话术进阶,https://video.example.com/sales-201,李强,销售,60分钟,2026-09-10\n';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="course_template.csv"');
  res.send(csv);
});

// ---------- 启动 ----------
db.init().then(() => {
  app.listen(PORT, () => console.log(`培训视频目录系统已启动: http://localhost:${PORT}`));
}).catch(err => { console.error('数据库初始化失败:', err); process.exit(1); });
