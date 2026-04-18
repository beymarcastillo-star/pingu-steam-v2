const router = require('express').Router();
const db     = require('../../db/database');

// GET /api/perfiles?cuenta_id=X
router.get('/', (req, res) => {
    const { cuenta_id } = req.query;
    if (!cuenta_id) return res.status(400).json({ error: 'cuenta_id requerido' });

    const perfiles = db.prepare(`
        SELECT pf.*, cl.nombre as cliente_nombre, cl.whatsapp as cliente_wa
        FROM perfiles pf
        LEFT JOIN clientes cl ON cl.id = pf.cliente_id
        WHERE pf.cuenta_id = ?
        ORDER BY pf.id ASC
    `).all(cuenta_id);
    res.json(perfiles);
});

// POST /api/perfiles — agregar perfil a una cuenta
router.post('/', (req, res) => {
    const { cuenta_id, nombre_perfil, pin, precio_venta } = req.body;
    if (!cuenta_id || !nombre_perfil) return res.status(400).json({ error: 'cuenta_id y nombre_perfil requeridos' });
    const result = db.prepare(`
        INSERT INTO perfiles (cuenta_id, nombre_perfil, pin, precio_venta)
        VALUES (?, ?, ?, ?)
    `).run(cuenta_id, nombre_perfil, pin || null, precio_venta || null);
    res.json({ ok: true, id: result.lastInsertRowid });
});

// PUT /api/perfiles/:id — editar estado, vencimiento, precio
router.put('/:id', (req, res) => {
    const { estado, fecha_vencimiento, cliente_id, precio_venta, pin, nombre_perfil } = req.body;
    db.prepare(`
        UPDATE perfiles SET
            estado            = COALESCE(?, estado),
            fecha_vencimiento = COALESCE(?, fecha_vencimiento),
            cliente_id        = COALESCE(?, cliente_id),
            precio_venta      = COALESCE(?, precio_venta),
            pin               = COALESCE(?, pin),
            nombre_perfil     = COALESCE(?, nombre_perfil),
            vendido_en        = CASE WHEN ? = 'vendido' THEN datetime('now') ELSE vendido_en END
        WHERE id = ?
    `).run(estado||null, fecha_vencimiento||null, cliente_id||null,
           precio_venta||null, pin||null, nombre_perfil||null,
           estado||null, req.params.id);
    res.json({ ok: true });
});

// DELETE /api/perfiles/:id
router.delete('/:id', (req, res) => {
    db.prepare('DELETE FROM perfiles WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
