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

// Migraciones para bases de datos existentes
const migraciones = [
    `ALTER TABLE clientes ADD COLUMN puntos        INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE clientes ADD COLUMN total_compras INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE servicios ADD COLUMN costo_usd    REAL`,
    `ALTER TABLE servicios ADD COLUMN precio_usd   REAL`,
    `ALTER TABLE servicios ADD COLUMN margen_minimo REAL NOT NULL DEFAULT 20`,
];
for (const sql of migraciones) {
    try { db.exec(sql); } catch (_) { /* columna ya existe, ignorar */ }
}

// Valores de config que pueden no existir aún
const configExtras = [
    ['tipo_cambio', '6.96'],
    ['puntos_por_compra_baja',  '5'],
    ['puntos_por_compra_media', '15'],
    ['puntos_por_compra_alta',  '30'],
    ['puntos_umbral_bajo',  '50'],
    ['puntos_umbral_medio', '100'],
    ['puntos_umbral_alto',  '200'],
    ['descuento_puntos_bajo',  '5'],
    ['descuento_puntos_medio', '15'],
    ['descuento_puntos_alto',  '35'],
];
const insertConfig = db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)');
for (const [clave, valor] of configExtras) insertConfig.run(clave, valor);

console.log('✅ Base de datos lista:', DB_PATH);

module.exports = db;
