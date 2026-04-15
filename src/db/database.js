// =============================================
// BASE DE DATOS SQLite
// =============================================
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_PATH  = path.join(__dirname, '../../data/pingu-steam.db');
const SQL_PATH = path.join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);

// Activar WAL mode (más rápido y seguro)
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Crear tablas si no existen
const schema = fs.readFileSync(SQL_PATH, 'utf8');
db.exec(schema);

console.log('✅ Base de datos lista:', DB_PATH);

module.exports = db;
