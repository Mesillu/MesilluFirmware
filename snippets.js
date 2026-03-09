/**
 * ═══════════════════════════════════════════
 *  MESILLU FIRMWARE — API  /api/snippets.js
 *  Vercel Serverless Function
 * ═══════════════════════════════════════════
 *
 *  GET    /api/snippets          → list all snippets (public)
 *  POST   /api/snippets          → add snippet (admin only)
 *  DELETE /api/snippets?id=<id>  → delete snippet (admin only)
 *
 *  Set env vars in Vercel dashboard:
 *    ADMIN_KEY  → your secret admin password (default: mesillu-admin-2024)
 *
 *  NOTE: SQLite is stored in /tmp on Vercel (ephemeral per cold start).
 *  For persistent storage across deployments, migrate to:
 *    - Vercel Postgres / Neon
 *    - PlanetScale (MySQL)
 *    - Vercel KV (Redis)
 *  The schema and logic below is identical — only the driver changes.
 * ═══════════════════════════════════════════
 */

const path = require('path');
const fs   = require('fs');

/* ── RATE LIMITER (in-memory, resets on cold start) ── */
const rateLimitMap = new Map();
const RATE_LIMIT   = 20;    // max requests
const RATE_WINDOW  = 60000; // per 60 seconds (ms)

function getClientIp(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.socket?.remoteAddress ||
    'unknown'
  );
}

function isRateLimited(ip) {
  const now = Date.now();
  const record = rateLimitMap.get(ip);

  if (!record || now - record.start > RATE_WINDOW) {
    rateLimitMap.set(ip, { count: 1, start: now });
    return false;
  }

  if (record.count >= RATE_LIMIT) return true;

  record.count++;
  return false;
}

/* ── DB SETUP ── */
let db;

function getDb() {
  if (db) return db;

  const Database = require('better-sqlite3');

  // Vercel only allows writes to /tmp
  const dbDir  = '/tmp';
  const dbPath = path.join(dbDir, 'mesillu.db');

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  db = new Database(dbPath);

  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Create table
  db.exec(`
    CREATE TABLE IF NOT EXISTS snippets (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      title       TEXT    NOT NULL,
      description TEXT    DEFAULT '',
      date        TEXT    DEFAULT '',
      code        TEXT    NOT NULL,
      created_at  TEXT    DEFAULT (datetime('now'))
    );
  `);

  // Seed with sample data if empty (so new deploys aren't blank)
  const count = db.prepare('SELECT COUNT(*) as c FROM snippets').get();
  if (count.c === 0) {
    const insert = db.prepare(`
      INSERT INTO snippets (title, description, date, code)
      VALUES (?, ?, ?, ?)
    `);

    insert.run(
      'UART Init — STM32',
      'Initialize UART1 at 115200 baud on STM32 using HAL',
      '2024-01-15',
      `// STM32 UART1 Initialization via HAL
UART_HandleTypeDef huart1;

void MX_USART1_UART_Init(void) {
  huart1.Instance        = USART1;
  huart1.Init.BaudRate   = 115200;
  huart1.Init.WordLength = UART_WORDLENGTH_8B;
  huart1.Init.StopBits   = UART_STOPBITS_1;
  huart1.Init.Parity     = UART_PARITY_NONE;
  huart1.Init.Mode       = UART_MODE_TX_RX;
  huart1.Init.HwFlowCtl  = UART_HWCONTROL_NONE;
  HAL_UART_Init(&huart1);
}

// Usage
HAL_UART_Transmit(&huart1, (uint8_t*)"BOOT OK\\r\\n", 9, HAL_MAX_DELAY);`
    );

    insert.run(
      'CRC-16 Checksum',
      'Fast CRC-16/CCITT implementation in C for packet validation',
      '2024-02-03',
      `// CRC-16/CCITT-FALSE
uint16_t crc16(const uint8_t *data, size_t length) {
  uint16_t crc = 0xFFFF;
  for (size_t i = 0; i < length; i++) {
    crc ^= (uint16_t)data[i] << 8;
    for (int j = 0; j < 8; j++) {
      crc = (crc & 0x8000) ? (crc << 1) ^ 0x1021 : crc << 1;
    }
  }
  return crc;
}

// Usage
uint8_t packet[] = {0xAA, 0xBB, 0xCC};
uint16_t checksum = crc16(packet, sizeof(packet));`
    );

    insert.run(
      'I2C Read Byte',
      'Read a single byte from an I2C device register on AVR',
      '2024-03-10',
      `// AVR I2C single-byte read
#include <util/twi.h>
#define F_SCL 100000UL

uint8_t i2c_read_byte(uint8_t addr, uint8_t reg) {
  // START
  TWCR = (1<<TWINT)|(1<<TWSTA)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));

  // WRITE address + W
  TWDR = (addr << 1) | TW_WRITE;
  TWCR = (1<<TWINT)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));

  // WRITE register
  TWDR = reg;
  TWCR = (1<<TWINT)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));

  // REPEATED START + READ
  TWCR = (1<<TWINT)|(1<<TWSTA)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));
  TWDR = (addr << 1) | TW_READ;
  TWCR = (1<<TWINT)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));

  // READ byte (NACK)
  TWCR = (1<<TWINT)|(1<<TWEN);
  while (!(TWCR & (1<<TWINT)));
  uint8_t data = TWDR;

  // STOP
  TWCR = (1<<TWINT)|(1<<TWSTO)|(1<<TWEN);
  return data;
}`
    );
  }

  return db;
}

/* ── AUTH CHECK ── */
function isAdmin(req) {
  const adminKey = process.env.ADMIN_KEY || '***db.admin';
  const provided = req.headers['x-admin-key'] || '';
  return provided === adminKey && provided.length > 0;
}

/* ── CORS HEADERS ── */
function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-key');
}

/* ── JSON RESPONSE ── */
function send(res, status, data) {
  res.setHeader('Content-Type', 'application/json');
  res.status(status).json(data);
}

/* ══════════════════════════════════════════
   HANDLER
══════════════════════════════════════════ */
module.exports = async function handler(req, res) {
  setCors(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Rate limit (all routes)
  const ip = getClientIp(req);
  if (isRateLimited(ip)) {
    return send(res, 429, {
      error: 'Too many requests. Please wait before trying again.',
      retryAfter: 60
    });
  }

  try {
    const database = getDb();

    /* ─── GET: list all snippets ─── */
    if (req.method === 'GET') {
      const snippets = database
        .prepare('SELECT id, title, description, date, code FROM snippets ORDER BY id DESC')
        .all();
      return send(res, 200, { snippets });
    }

    /* ─── POST: add snippet ─── */
    if (req.method === 'POST') {
      if (!isAdmin(req)) {
        return send(res, 401, { error: 'Unauthorized — invalid admin key' });
      }

      const body = req.body || {};

      // Validation-only ping (used by login form)
      if (body.__validate) {
        return send(res, 200, { ok: true });
      }

      const { title, description, date, code } = body;

      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return send(res, 400, { error: 'Title is required' });
      }
      if (!code || typeof code !== 'string' || code.trim().length === 0) {
        return send(res, 400, { error: 'Code is required' });
      }
      if (title.length > 200) {
        return send(res, 400, { error: 'Title must be under 200 characters' });
      }

      const safeDate = date || new Date().toISOString().split('T')[0];

      const result = database
        .prepare('INSERT INTO snippets (title, description, date, code) VALUES (?, ?, ?, ?)')
        .run(title.trim(), (description || '').trim(), safeDate, code.trim());

      const snippet = database
        .prepare('SELECT * FROM snippets WHERE id = ?')
        .get(result.lastInsertRowid);

      return send(res, 201, { snippet });
    }

    /* ─── DELETE: remove snippet ─── */
    if (req.method === 'DELETE') {
      if (!isAdmin(req)) {
        return send(res, 401, { error: 'Unauthorized — invalid admin key' });
      }

      const id = parseInt(req.query?.id);
      if (!id || isNaN(id)) {
        return send(res, 400, { error: 'Valid snippet id is required' });
      }

      const existing = database.prepare('SELECT id FROM snippets WHERE id = ?').get(id);
      if (!existing) {
        return send(res, 404, { error: 'Snippet not found' });
      }

      database.prepare('DELETE FROM snippets WHERE id = ?').run(id);
      return send(res, 200, { deleted: id });
    }

    return send(res, 405, { error: 'Method not allowed' });

  } catch (err) {
    console.error('[snippets API]', err);
    return send(res, 500, { error: 'Internal server error' });
  }
};
