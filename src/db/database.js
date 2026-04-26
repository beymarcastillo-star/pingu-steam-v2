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
    // Columnas para el flujo de aprobación por WhatsApp
    `ALTER TABLE pedidos ADD COLUMN tomado_por        INTEGER`,
    `ALTER TABLE pedidos ADD COLUMN tomado_en         TEXT`,
    `ALTER TABLE pedidos ADD COLUMN comprobante_imagen TEXT`,
    `ALTER TABLE pedidos ADD COLUMN ai_analisis        TEXT`,
    // Columna para recordatorios de vencimiento
    `ALTER TABLE perfiles ADD COLUMN recordatorio_enviado TEXT`,
    // Cantidad de perfiles por cuenta (para calcular ganancia real)
    `ALTER TABLE servicios ADD COLUMN perfiles_por_cuenta INTEGER NOT NULL DEFAULT 1`,
    // Indexes para DBs creadas antes de que se añadieran al schema
    `CREATE INDEX IF NOT EXISTS idx_clientes_wa      ON clientes(whatsapp)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_estado   ON pedidos(estado)`,
    `CREATE INDEX IF NOT EXISTS idx_pedidos_cliente  ON pedidos(cliente_id)`,
    `CREATE INDEX IF NOT EXISTS idx_perfiles_cuenta  ON perfiles(cuenta_id)`,
    `CREATE INDEX IF NOT EXISTS idx_perfiles_estado  ON perfiles(estado)`,
    `CREATE INDEX IF NOT EXISTS idx_cuentas_servicio ON cuentas(servicio_id)`,
];
for (const sql of migraciones) {
    try { db.exec(sql); } catch (_) { /* ya existe, ignorar */ }
}

// Valores de config que pueden no existir aún
const configExtras = [
    ['tipo_cambio', '6.96'],
    ['grupos_activo',        '0'],
    ['grupos_permitidos',    '[]'],
    ['grupos_solo_mencion',  '0'],
    ['horario_activo',       '0'],
    ['horario_inicio',       '08:00'],
    ['horario_fin',          '22:00'],
    ['horario_mensaje',      '¡Hola! Nuestro horario de atención es de {inicio} a {fin}. Te responderemos pronto 😊'],
    ['puntos_por_compra_baja',  '5'],
    ['puntos_por_compra_media', '15'],
    ['puntos_por_compra_alta',  '30'],
    ['puntos_umbral_bajo',  '50'],
    ['puntos_umbral_medio', '100'],
    ['puntos_umbral_alto',  '200'],
    ['descuento_puntos_bajo',  '5'],
    ['descuento_puntos_medio', '15'],
    ['descuento_puntos_alto',  '35'],
    ['vision_ia_activo',              '1'],
    ['recordatorios_activo',          '1'],
    ['recordatorios_dias',            '3'],
    ['recordatorio_mensaje_cliente',  '🔔 Hola *{nombre}*! Tu suscripción de *{servicio}* vence el *{fecha}* ({dias} días).\n\nEscribe *menu* para renovar y no perder el acceso 😊'],
];
const insertConfig = db.prepare('INSERT OR IGNORE INTO config (clave, valor) VALUES (?, ?)');
for (const [clave, valor] of configExtras) insertConfig.run(clave, valor);

console.log('✅ Base de datos lista:', DB_PATH);

const _stmtConfig = db.prepare('SELECT valor FROM config WHERE clave = ?');
function getConfig(clave, def = '') {
    return _stmtConfig.get(clave)?.valor || def;
}

module.exports = db;
module.exports.getConfig = getConfig;
