# 企业培训视频目录系统

管理员批量导入课程视频，员工按岗位筛选学习并标记，后台统计每个视频的学习人数。

## 快速启动

```bash
npm install     # 首次安装依赖（express / multer / cookie-parser / sql.js）
npm start       # 或 node server.js
```

访问 http://localhost:3000

| 角色 | 账号 | 密码 |
|------|------|------|
| 管理员 | admin | admin123 |
| 员工（销售） | wangfang | 123456 |
| 员工（技术） | liqiang | 123456 |
| 员工（客服） | zhaomin | 123456 |
| 员工（运营） | sunli | 123456 |

## 功能

**管理员（/admin.html）**
- 📊 学习统计：每个视频的学习人数 + 学员姓名/岗位明细
- 📥 批量导入：上传 CSV，逐行校验，坏行拦截并给出原因；可下载模板
- 📚 课程管理：查看、删除课程（学习记录级联删除）

**员工（/employee.html）**
- 登录后默认只看本岗位（含"全部"）的课程，可切换岗位筛选、只看未学习
- 观看视频、标记/取消"已学习"

## CSV 格式

```csv
课程标题,视频链接,讲师,适用岗位,时长,更新日期
新员工入职培训,https://video.example.com/onboarding,王芳,全部,45分钟,2026-09-01
```

- 六列全部必填（表头支持常见中英文别名，如 title/url/instructor）
- **缺讲师或缺链接的行直接拦截，绝不导入成空课程**
- 链接须以 `http(s)://` 开头；日期须为合法 `YYYY-MM-DD`
- 岗位限：销售、技术、客服、运营、人事、全部；多岗位用「、」分隔
- 标题+链接相同的重复课程自动跳过；文件须为 UTF-8 编码

## 技术栈

- 后端：Node.js + Express，SQLite（sql.js，WASM 免编译），数据落盘 `data/training.db`
- 认证：sha256 加盐密码 + HMAC 签名 Cookie 会话（httpOnly，7 天）
- 前端：原生 HTML/JS，无构建步骤

## 主要 API

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | /api/login · /api/logout | 登录 / 退出 |
| GET | /api/courses?position=销售 | 员工课程列表（含已学状态） |
| POST | /api/learn | 标记/取消已学 `{course_id, learned}` |
| GET | /api/admin/stats | 每视频学习人数 + 学员明细 |
| POST | /api/admin/import | CSV 批量导入（multipart） |
| GET/DELETE | /api/admin/courses(/:id) | 课程列表 / 删除 |
| GET | /api/admin/template.csv | 下载导入模板 |

测试文件 `sample_courses.csv` 含 4 条合法数据 + 6 条各类非法数据，可直接用于验证导入拦截。
