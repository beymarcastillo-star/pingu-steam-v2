const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    res.json({ admins: db.prepare('SELECT id, usuario, telefono, rol, activo FROM admins').all() });
});

router.post('/', (req, res) => {
    const { usuario, telefono, rol } = req.body;
    if (!usuario || !telefono) return res.status(400).json({ error: 'Datos incompletos' });
    try {
        db.prepare('INSERT INTO admins (usuario, telefono, rol) VALUES (?, ?, ?)').run(usuario, telefono, rol || 'admin');
        res.json({ ok: true });
    } catch (e) {
        res.status(400).json({ error: 'El usuario o teléfono ya existe' });
    }
});

// GET /api/admins/metricas — rendimiento por admin
router.get('/metricas', (req, res) => {
    const tc = parseFloat(db.getConfig('tipo_cambio', '6.96'));
    const metricas = db.prepare(`
        SELECT
            a.id, a.usuario, a.rol,
            COUNT(CASE WHEN date(v.fecha) = date('now')                               THEN 1 END) AS ventas_hoy_n,
            COALESCE(SUM(CASE WHEN date(v.fecha) = date('now')                               THEN v.precio END), 0) AS ventas_hoy_usd,
            COUNT(CASE WHEN strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now')     THEN 1 END) AS ventas_mes_n,
            COALESCE(SUM(CASE WHEN strftime('%Y-%m', v.fecha) = strftime('%Y-%m', 'now') THEN v.precio END), 0) AS ventas_mes_usd,
            COUNT(v.id)                 AS ventas_total_n,
            COALESCE(SUM(v.precio), 0)  AS ventas_total_usd
        FROM admins a
        LEFT JOIN pedidos p ON p.atendido_por = a.id
        LEFT JOIN ventas  v ON v.pedido_id    = p.id
        WHERE a.activo = 1
        GROUP BY a.id
        ORDER BY ventas_mes_n DESC
    `).all();
    res.json({ metricas, tc });
});

router.delete('/:usuario', (req, res) => {
    const admin = db.prepare('SELECT * FROM admins WHERE usuario = ?').get(req.params.usuario);
    if (!admin) return res.status(404).json({ error: 'No encontrado' });
    if (admin.rol === 'super_admin') return res.status(403).json({ error: 'No puedes eliminar al Super Admin' });
    db.prepare('DELETE FROM admins WHERE usuario = ?').run(req.params.usuario);
    res.json({ ok: true });
});

module.exports = router;
