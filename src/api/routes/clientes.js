const router = require('express').Router();
const db     = require('../../db/database');

// GET /api/clientes — lista todos los clientes
router.get('/', (_req, res) => {
    const clientes = db.prepare(`
        SELECT id, whatsapp, nombre, puntos, total_compras, registrado_en
        FROM clientes
        ORDER BY registrado_en DESC
    `).all();
    res.json(clientes);
});

// GET /api/clientes/:id — detalle de un cliente
router.get('/:id', (req, res) => {
    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const historial = db.prepare(`
        SELECT * FROM puntos_historial
        WHERE cliente_id = ?
        ORDER BY fecha DESC
        LIMIT 50
    `).all(req.params.id);

    const compras = db.prepare(`
        SELECT p.id, s.nombre AS servicio, p.estado, p.creado_en
        FROM pedidos p
        LEFT JOIN servicios s ON s.id = p.servicio_id
        WHERE p.cliente_id = ?
        ORDER BY p.creado_en DESC
        LIMIT 20
    `).all(req.params.id);

    res.json({ ...cliente, historial, compras });
});

// PUT /api/clientes/:id — editar nombre
router.put('/:id', (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    db.prepare('UPDATE clientes SET nombre = ? WHERE id = ?').run(nombre, req.params.id);
    res.json({ ok: true });
});

// POST /api/clientes/:id/puntos — agregar o descontar puntos manualmente
router.post('/:id/puntos', (req, res) => {
    const { cantidad, tipo, motivo } = req.body;
    if (!cantidad || !tipo) return res.status(400).json({ error: 'cantidad y tipo requeridos' });
    if (!['ganado', 'canjeado'].includes(tipo)) return res.status(400).json({ error: 'tipo debe ser ganado o canjeado' });

    const cliente = db.prepare('SELECT * FROM clientes WHERE id = ?').get(req.params.id);
    if (!cliente) return res.status(404).json({ error: 'Cliente no encontrado' });

    const delta = tipo === 'ganado' ? Math.abs(cantidad) : -Math.abs(cantidad);
    const nuevosSaldo = cliente.puntos + delta;
    if (nuevosSaldo < 0) return res.status(400).json({ error: 'El cliente no tiene suficientes puntos' });

    db.transaction(() => {
        db.prepare('UPDATE clientes SET puntos = ? WHERE id = ?').run(nuevosSaldo, req.params.id);
        db.prepare(`
            INSERT INTO puntos_historial (cliente_id, tipo, cantidad, motivo)
            VALUES (?, ?, ?, ?)
        `).run(req.params.id, tipo, Math.abs(cantidad), motivo || null);
    })();

    res.json({ ok: true, puntos_nuevos: nuevosSaldo });
});

// GET /api/clientes/:id/puntos — historial de puntos
router.get('/:id/puntos', (req, res) => {
    const historial = db.prepare(`
        SELECT * FROM puntos_historial
        WHERE cliente_id = ?
        ORDER BY fecha DESC
    `).all(req.params.id);
    res.json(historial);
});

module.exports = router;
