-- =============================================
-- ESQUEMA BASE DE DATOS - PINGU STEAM V2
-- SQLite
-- =============================================

-- Configuración general del sistema (white-label)
CREATE TABLE IF NOT EXISTS config (
    clave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL
);

-- Administradores del panel
CREATE TABLE IF NOT EXISTS admins (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario     TEXT UNIQUE NOT NULL,
    telefono    TEXT UNIQUE NOT NULL,
    rol         TEXT NOT NULL DEFAULT 'admin', -- 'super_admin' | 'admin'
    activo      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Clientes (se registran automáticamente al escribirle al bot)
CREATE TABLE IF NOT EXISTS clientes (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    whatsapp        TEXT UNIQUE NOT NULL,
    nombre          TEXT,
    puntos          INTEGER NOT NULL DEFAULT 0,
    total_compras   INTEGER NOT NULL DEFAULT 0,
    registrado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Historial de movimientos de puntos por cliente
CREATE TABLE IF NOT EXISTS puntos_historial (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id  INTEGER NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'ganado', -- 'ganado' | 'canjeado'
    cantidad    INTEGER NOT NULL,
    motivo      TEXT,
    fecha       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

-- Servicios de streaming (Netflix, Crunchyroll, etc.)
CREATE TABLE IF NOT EXISTS servicios (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre          TEXT NOT NULL,
    descripcion     TEXT,
    imagen          TEXT,       -- nombre del archivo en /img/servicios/
    precio_usd      REAL,       -- precio de venta en dólares
    costo_usd       REAL,       -- precio de costo en dólares (privado)
    margen_minimo   REAL NOT NULL DEFAULT 20,  -- % mínimo de ganancia
    activo          INTEGER NOT NULL DEFAULT 1
);

-- Cuentas de streaming (cada fila = una cuenta completa)
CREATE TABLE IF NOT EXISTS cuentas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    servicio_id INTEGER NOT NULL,
    correo      TEXT NOT NULL,
    contrasena  TEXT NOT NULL,
    tipo        TEXT NOT NULL DEFAULT 'pantalla_completa', -- 'pantalla_completa' | 'perfil'
    activa      INTEGER NOT NULL DEFAULT 1,
    creado_en   TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id)
);

-- Perfiles dentro de una cuenta (para cuentas compartidas)
CREATE TABLE IF NOT EXISTS perfiles (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    cuenta_id           INTEGER NOT NULL,
    nombre_perfil       TEXT NOT NULL,
    pin                 TEXT,
    estado              TEXT NOT NULL DEFAULT 'libre', -- 'libre' | 'vendido'
    cliente_id          INTEGER,
    fecha_vencimiento   TEXT,
    precio_venta        REAL,
    vendido_en          TEXT,
    FOREIGN KEY (cuenta_id) REFERENCES cuentas(id),
    FOREIGN KEY (cliente_id) REFERENCES clientes(id)
);

-- Pedidos (cuando un cliente quiere comprar)
CREATE TABLE IF NOT EXISTS pedidos (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    cliente_id      INTEGER NOT NULL,
    servicio_id     INTEGER,
    estado          TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente' | 'atendido' | 'cancelado'
    metodo_pago     TEXT, -- 'qr' | 'transferencia' | 'yape' | 'efectivo'
    notas           TEXT,
    atendido_por    INTEGER, -- admin_id
    creado_en       TEXT NOT NULL DEFAULT (datetime('now')),
    atendido_en     TEXT,
    FOREIGN KEY (cliente_id) REFERENCES clientes(id),
    FOREIGN KEY (servicio_id) REFERENCES servicios(id),
    FOREIGN KEY (atendido_por) REFERENCES admins(id)
);

-- Ventas cerradas
CREATE TABLE IF NOT EXISTS ventas (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    pedido_id   INTEGER NOT NULL,
    perfil_id   INTEGER NOT NULL,
    precio      REAL NOT NULL,
    fecha       TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (pedido_id) REFERENCES pedidos(id),
    FOREIGN KEY (perfil_id) REFERENCES perfiles(id)
);

-- Métodos de pago configurables
CREATE TABLE IF NOT EXISTS metodos_pago (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    nombre      TEXT NOT NULL,  -- 'QR Banco X', 'Yape', etc.
    tipo        TEXT NOT NULL,  -- 'qr' | 'cuenta' | 'efectivo'
    detalle     TEXT,           -- número de cuenta, descripción
    imagen      TEXT,           -- archivo QR en /img/qr/
    activo      INTEGER NOT NULL DEFAULT 1
);

-- Datos iniciales de configuración
INSERT OR IGNORE INTO config (clave, valor) VALUES
    ('nombre_empresa',  'Pingu Steam'),
    ('nombre_bot',      'PinguBot'),
    ('logo',            'logo.png'),
    ('moneda',          'Bs'),
    ('saludo_bot',      'Hola! Soy {bot}, el asistente de {empresa}. ¿En qué te puedo ayudar hoy? 😊'),
    ('color_primario',  '#6c63ff'),
    ('color_secundario','#ff6584');
