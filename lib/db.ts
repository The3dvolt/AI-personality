import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'aura.db');

const db = new Database(DB_PATH);

// Initialize schema
db.exec(`
CREATE TABLE IF NOT EXISTS object_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  object_name TEXT,
  model_details TEXT,
  user_answer TEXT,
  last_seen INTEGER
);
`);

export function saveObjectMemory(object_name: string, model_details: string, user_answer?: string) {
  const stmt = db.prepare(`INSERT INTO object_memory (object_name, model_details, user_answer, last_seen) VALUES (?, ?, ?, ?)`);
  stmt.run(object_name, model_details || null, user_answer || null, Date.now());
}

export function updateObjectMemory(id: number, user_answer: string) {
  const stmt = db.prepare(`UPDATE object_memory SET user_answer = ?, last_seen = ? WHERE id = ?`);
  stmt.run(user_answer, Date.now(), id);
}

export function findObjectByName(object_name: string) {
  const stmt = db.prepare(`SELECT * FROM object_memory WHERE object_name = ? ORDER BY last_seen DESC LIMIT 1`);
  return stmt.get(object_name);
}

export function listMemories(limit = 100) {
  const stmt = db.prepare(`SELECT * FROM object_memory ORDER BY last_seen DESC LIMIT ?`);
  return stmt.all(limit);
}

export default db;
