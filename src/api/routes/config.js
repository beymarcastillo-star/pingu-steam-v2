const router = require('express').Router();
const db     = require('../../db/database');

const getConfig = (clave) => db.prepare('SELECT valor FROM config WHERE clave = ?').get(clave)?.valor;
const setConfig = (clave, valor) => db.prepare('INSERT OR REPLACE INTO config (clave, valor) VALUES (?, ?)').run(clave, valor);

// GET /api/config/public — datos públicos (sin auth)
router.get('/public', (_req, res) => {
    res.json({
        nombre_empresa: getConfig('nombre_empresa'),
        nombre_bot:     getConfig('nombre_bot'),
        logo:           getConfig('logo'),
        moneda:         getConfig('moneda'),
        tipo_cambio:    getConfig('tipo_cambio') || '6.96',
        prompt_sistema: getConfig('saludo_bot'),
        color_primario: getConfig('color_primario'),
        admin_number:        process.env.ADMIN_NUMBER || null,
        grupos_activo:       getConfig('grupos_activo')       || '0',
        grupos_permitidos:   getConfig('grupos_permitidos')   || '[]',
        grupos_solo_mencion: getConfig('grupos_solo_mencion') || '0',
        horario_activo:      getConfig('horario_activo')      || '0',
        horario_inicio:      getConfig('horario_inicio')      || '08:00',
        horario_fin:         getConfig('horario_fin')         || '22:00',
        horario_mensaje:     getConfig('horario_mensaje')     || ''
    });
});

// POST /api/config — guardar configuración
router.post('/', (req, res) => {
    const {
        nombre_empresa, nombre_bot, moneda, tipo_cambio, prompt_sistema, logo,
        grupos_activo, grupos_permitidos, grupos_solo_mencion,
        horario_activo, horario_inicio, horario_fin, horario_mensaje
    } = req.body;
    if (nombre_empresa)                   setConfig('nombre_empresa', nombre_empresa);
    if (nombre_bot)                       setConfig('nombre_bot', nombre_bot);
    if (moneda)                           setConfig('moneda', moneda);
    if (tipo_cambio)                      setConfig('tipo_cambio', tipo_cambio);
    if (prompt_sistema)                   setConfig('saludo_bot', prompt_sistema);
    if (logo)                             setConfig('logo', logo);
    if (grupos_activo       !== undefined) setConfig('grupos_activo',       grupos_activo ? '1' : '0');
    if (grupos_permitidos   !== undefined) setConfig('grupos_permitidos',   JSON.stringify(grupos_permitidos));
    if (grupos_solo_mencion !== undefined) setConfig('grupos_solo_mencion', grupos_solo_mencion ? '1' : '0');
    if (horario_activo      !== undefined) setConfig('horario_activo',      horario_activo ? '1' : '0');
    if (horario_inicio)                   setConfig('horario_inicio',       horario_inicio);
    if (horario_fin)                      setConfig('horario_fin',          horario_fin);
    if (horario_mensaje !== undefined)    setConfig('horario_mensaje',      horario_mensaje);
    res.json({ ok: true });
});

module.exports = router;
