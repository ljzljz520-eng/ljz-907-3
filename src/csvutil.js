// CSV 解析 + 课程行校验
// 规则：标题/视频链接/讲师/适用岗位/时长/更新日期 六列均为必填；
// 任何一行缺讲师或缺链接（或格式非法）都会被拦截，绝不导入成空课程。

const REQUIRED_HEADERS = ['课程标题', '视频链接', '讲师', '适用岗位', '时长', '更新日期'];

// 兼容常见表头别名
const HEADER_ALIASES = {
  '课程标题': ['课程标题', '标题', '课程名称', '课程', 'title'],
  '视频链接': ['视频链接', '链接', '视频地址', '地址', 'url', 'link', 'video_url'],
  '讲师': ['讲师', '讲师姓名', '授课人', '老师', 'instructor', 'teacher'],
  '适用岗位': ['适用岗位', '岗位', '适用对象', '面向岗位', 'position', 'positions'],
  '时长': ['时长', '课程时长', '视频时长', 'duration'],
  '更新日期': ['更新日期', '更新时间', '日期', 'updated_at', 'update_date', 'date'],
};

/** 解析 CSV 文本为二维数组，支持引号包裹、双引号转义、逗号/换行内嵌、CRLF、BOM */
function parseCSV(text) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // 去 BOM
  const rows = [];
  let row = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field); field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

/** 把表头映射到标准列，返回 { colIndex: {标准名: 下标}, missing: [] } */
function mapHeaders(headerRow) {
  const norm = headerRow.map(h => String(h || '').trim().toLowerCase());
  const colIndex = {};
  const missing = [];
  for (const [std, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex(h => aliases.map(a => a.toLowerCase()).includes(h));
    if (idx === -1) missing.push(std);
    else colIndex[std] = idx;
  }
  return { colIndex, missing };
}

/** 校验并规范化日期：接受 2026-09-14 / 2026/9/4 / 2026.09.14，返回 YYYY-MM-DD 或 null */
function normalizeDate(s) {
  const m = String(s).trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (date.getFullYear() !== Number(y) || date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d)) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** 校验并规范化岗位：支持 "销售、客服" "销售/客服" "销售,客服" 等写法 */
function normalizePositions(s, knownPositions) {
  const parts = String(s).split(/[、,，;；/|＋+\s]+/).map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: '适用岗位为空' };
  if (parts.includes('全部')) return { ok: true, value: '全部' };
  const unknown = parts.filter(p => !knownPositions.includes(p));
  if (unknown.length > 0) {
    return { ok: false, error: `未知岗位「${unknown.join('、')}」（可选：${knownPositions.join('、')}、全部）` };
  }
  return { ok: true, value: [...new Set(parts)].join(',') };
}

/**
 * 校验一行课程数据。返回 { ok, errors: [], course? }
 * 缺讲师、缺链接等任何问题都会使 ok=false，该行被拦截。
 */
function validateCourseRow(cells, colIndex, knownPositions) {
  const get_ = name => String(cells[colIndex[name]] ?? '').trim();
  const errors = [];

  const title = get_('课程标题');
  const url = get_('视频链接');
  const instructor = get_('讲师');
  const positionsRaw = get_('适用岗位');
  const duration = get_('时长');
  const dateRaw = get_('更新日期');

  if (!title) errors.push('缺少课程标题');
  if (!instructor) errors.push('缺少讲师');                       // ← 关键拦截点
  if (!url) errors.push('缺少视频链接');                          // ← 关键拦截点
  else if (!/^https?:\/\/\S+$/i.test(url)) errors.push(`视频链接格式非法「${url}」（须以 http:// 或 https:// 开头）`);
  if (!duration) errors.push('缺少时长');

  let positions = null;
  if (!positionsRaw) errors.push('缺少适用岗位');
  else {
    const r = normalizePositions(positionsRaw, knownPositions);
    if (!r.ok) errors.push(r.error);
    else positions = r.value;
  }

  let updatedAt = null;
  if (!dateRaw) errors.push('缺少更新日期');
  else {
    updatedAt = normalizeDate(dateRaw);
    if (!updatedAt) errors.push(`更新日期格式非法「${dateRaw}」（应为 YYYY-MM-DD）`);
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, course: { title, video_url: url, instructor, positions, duration, updated_at: updatedAt } };
}

module.exports = { parseCSV, mapHeaders, validateCourseRow, normalizeDate, REQUIRED_HEADERS };
