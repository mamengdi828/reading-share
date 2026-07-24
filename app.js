const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
app.use(express.json());
app.use(express.static('.'));

// PostgreSQL 连接
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
  max: 10
});

// 初始化数据库
async function initDB() {
  let retries = 5;
  while (retries > 0) {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          code VARCHAR(20) PRIMARY KEY,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT NOW()
        )
      `);
      console.log('Database initialized');
      return;
    } catch(e) {
      console.error(`DB init failed (${retries} retries left):`, e.message);
      retries--;
      if (retries === 0) throw e;
      await new Promise(r => setTimeout(r, 3000));
    }
  }
}

// 读取活动数据
async function getSession(code) {
  const result = await pool.query('SELECT data FROM sessions WHERE code = $1', [code]);
  return result.rows.length > 0 ? result.rows[0].data : null;
}

// 保存活动数据
async function saveSession(code, data) {
  await pool.query(
    'INSERT INTO sessions (code, data) VALUES ($1, $2) ON CONFLICT (code) DO UPDATE SET data = $2',
    [code, JSON.stringify(data)]
  );
}

// 健康检查
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// 创建活动（含第一本书）
app.post('/api/session', async (req, res) => {
  try {
    const { title, author, desc } = req.body;
    const code = generateCode();
    const bookId = generateId(10);
    
    const sessionData = {
      code,
      createdAt: Date.now(),
      books: {}
    };
    sessionData.books[bookId] = {
      id: bookId,
      title,
      author,
      desc,
      createdAt: Date.now(),
      ratings: [],
      comments: []
    };
    
    await saveSession(code, sessionData);
    res.json({ code });
  } catch(e) {
    console.error('Create session error:', e);
    res.status(500).json({ error: '创建失败' });
  }
});

// 获取活动数据
app.get('/api/session/:code', async (req, res) => {
  try {
    const data = await getSession(req.params.code.toUpperCase());
    if (!data) return res.status(404).json({ error: '活动不存在' });
    res.json(data);
  } catch(e) {
    console.error('Get session error:', e);
    res.status(500).json({ error: '服务器错误' });
  }
});

// 向已有活动添加书籍
app.post('/api/session/:code/book', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { title, author, desc } = req.body;
    
    const data = await getSession(code);
    if (!data) return res.status(404).json({ error: '活动不存在' });
    
    const bookId = generateId(10);
    data.books[bookId] = {
      id: bookId,
      title,
      author,
      desc,
      createdAt: Date.now(),
      ratings: [],
      comments: []
    };
    
    await saveSession(code, data);
    res.json({ success: true, bookId });
  } catch(e) {
    console.error('Add book error:', e);
    res.status(500).json({ error: '添加失败' });
  }
});

// 提交评分
app.post('/api/session/:code/book/:bookId/rating', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { bookId } = req.params;
    const { stars, fingerprint } = req.body;
    
    if (!stars || stars < 1 || stars > 5) {
      return res.status(400).json({ error: '评分需在1-5之间' });
    }
    
    const data = await getSession(code);
    if (!data || !data.books[bookId]) {
      return res.status(404).json({ error: '不存在' });
    }
    
    const existing = data.books[bookId].ratings.find(r => r.fingerprint === fingerprint);
    if (existing) {
      existing.stars = stars;
      existing.time = Date.now();
    } else {
      data.books[bookId].ratings.push({
        stars, fingerprint, time: Date.now()
      });
    }
    
    await saveSession(code, data);
    res.json({ success: true });
  } catch(e) {
    console.error('Rating error:', e);
    res.status(500).json({ error: '提交失败' });
  }
});

// 提交评论
app.post('/api/session/:code/book/:bookId/comment', async (req, res) => {
  try {
    const code = req.params.code.toUpperCase();
    const { bookId } = req.params;
    const { text } = req.body;
    
    if (!text || text.trim().length === 0) {
      return res.status(400).json({ error: '评论不能为空' });
    }
    if (text.length > 300) {
      return res.status(400).json({ error: '评论最多300字' });
    }
    
    const data = await getSession(code);
    if (!data || !data.books[bookId]) {
      return res.status(404).json({ error: '不存在' });
    }
    
    data.books[bookId].comments.push({
      text: text.trim(),
      time: Date.now(),
      id: generateId(8)
    });
    
    await saveSession(code, data);
    res.json({ success: true });
  } catch(e) {
    console.error('Comment error:', e);
    res.status(500).json({ error: '发布失败' });
  }
});

function generateCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function generateId(len) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let id = '';
  for (let i = 0; i < (len || 8); i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  try {
    await initDB();
  } catch(e) {
    console.error('Failed to initialize database:', e);
  }
});
