const router = require('express').Router();
const db     = require('../../db/database');

// GET /api/pedidos
router.get('/', (req, res) => {
    const { estado, limit } = req.query;
    let sql = `
        SELECT p.*, cl.nombre as cliente_nombre, cl.whatsapp,
               s.nombre as servicio_nombre,
               a.usuario as atendido_por_nombre
        FROM pedidos p
        LEFT JOIN clientes cl ON cl.id = p.cliente_id
        LEFT JOIN servicios s  ON s.id  = p.servicio_id
        LEFT JOIN admins    a  ON a.id  = p.atendido_por
    `;
    const params = [];
    if (estado) { sql += ' WHERE p.estado = ?'; params.push(estado); }
    sql += ' ORDER BY p.creado_en DESC';
    if (limit)  { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
    res.json(db.prepare(sql).all(...params));
});

// GET /api/pedidos/:id
router.get('/:id', (req, res) => {
    const pedido = db.prepare(`
        SELECT p.*, cl.nombre as cliente_nombre, cl.whatsapp,
               s.nombre as servicio_nombre
        FROM pedidos p
        LEFT JOIN clientes cl ON cl.id = p.cliente_id
        LEFT JOIN servicios s  ON s.id  = p.servicio_id
        WHERE p.id = ?
    `).get(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    res.json(pedido);
});

// POST /api/pedidos/:id/tomar
router.post('/:id/tomar', (req, res) => {
    const { admin_id } = req.body;
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });
    if (pedido.estado !== 'pendiente') return res.status(400).json({ error: `El pedido ya está ${pedido.estado}` });

    db.prepare(`UPDATE pedidos SET estado = 'tomado', tomado_por = ?, tomado_en = datetime('now') WHERE id = ?`)
        .run(admin_id || null, req.params.id);
    res.json({ ok: true });
});

// POST /api/pedidos/:id/atender  (compatibilidad panel web)
router.post('/:id/atender', (req, res) => {
    const { admin_id } = req.body;
    db.prepare(`UPDATE pedidos SET estado = 'atendido', atendido_por = ?, atendido_en = datetime('now') WHERE id = ?`)
        .run(admin_id || null, req.params.id);
    res.json({ ok: true });
});

// POST /api/pedidos/:id/aprobar  (desde panel web)
router.post('/:id/aprobar', (req, res) => {
    const { admin_id } = req.body;
    const pedido = db.prepare('SELECT * FROM pedidos WHERE id = ?').get(req.params.id);
    if (!pedido) return res.status(404).json({ error: 'Pedido no encontrado' });

    const perfil = db.prepare(`
        SELECT pf.*, c.correo, c.contrasena
        FROM perfiles pf
        JOIN cuentas c ON c.id = pf.cuenta_id
        WHERE c.servicio_id = ? AND c.activa = 1 AND pf.estado = 'libre'
        ORDER BY pf.id ASC LIMIT 1
    `).get(pedido.servicio_id);

    if (!perfil) return res.status(400).json({ error: 'Sin perfiles libres para este servicio' });

    const vence = new Date();
    vence.setDate(vence.getDate() + 30);
    const venceStr = vence.toISOString().slice(0, 10);

    db.transaction(() => {
        db.prepare(`UPDATE perfiles SET estado = 'vendido', cliente_id = ?,
            fecha_vencimiento = ?, vendido_en = datetime('now') WHERE id = ?`)
            .run(pedido.cliente_id, venceStr, perfil.id);

        db.prepare('INSERT INTO ventas (pedido_id, perfil_id, precio) VALUES (?, ?, ?)')
            .run(pedido.id, perfil.id, perfil.precio_venta || 0);

        db.prepare(`UPDATE pedidos SET estado = 'atendido', atendido_por = ?,
            atendido_en = datetime('now') WHERE id = ?`)
            .run(admin_id || null, pedido.id);

        db.prepare('UPDATE clientes SET total_compras = total_compras + 1 WHERE id = ?')
            .run(pedido.cliente_id);
    })();

    res.json({
        ok: true,
        perfil: {
            correo:       perfil.correo,
            contrasena:   perfil.contrasena,
            nombre_perfil: perfil.nombre_perfil,
            pin:          perfil.pin,
            vence:        venceStr
        }
    });
});

// POST /api/pedidos/:id/rechazar
router.post('/:id/rechazar', (req, res) => {
    const { admin_id, motivo } = req.body;
    db.prepare(`UPDATE pedidos SET estado = 'cancelado', atendido_por = ?,
        atendido_en = datetime('now'), notas = notas || ? WHERE id = ?`)
        .run(admin_id || null, motivo ? ` | Rechazado: ${motivo}` : ' | Rechazado', req.params.id);
    res.json({ ok: true });
});

// POST /api/pedidos/:id/cancelar
router.post('/:id/cancelar', (req, res) => {
    db.prepare("UPDATE pedidos SET estado = 'cancelado' WHERE id = ?").run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
