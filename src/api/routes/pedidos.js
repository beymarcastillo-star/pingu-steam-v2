const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    const { estado, limit } = req.query;
    let sql = `
        SELECT p.*, cl.nombre as cliente_nombre, cl.whatsapp,
               s.nombre as servicio_nombre
        FROM pedidos p
        LEFT JOIN clientes cl ON cl.id = p.cliente_id
        LEFT JOIN servicios s ON s.id = p.servicio_id
    `;
    const params = [];
    if (estado) { sql += ' WHERE p.estado = ?'; params.push(estado); }
    sql += ' ORDER BY p.creado_en DESC';
    if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    res.json(db.prepare(sql).all(...params));
});

router.post('/:id/atender', (req, res) => {
    db.prepare("UPDATE pedidos SET estado = 'atendido', atendido_en = datetime('now') WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
});

router.post('/:id/cancelar', (req, res) => {
    db.prepare("UPDATE pedidos SET estado = 'cancelado' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
