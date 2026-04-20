const router = require('express').Router();
const db     = require('../../db/database');

const _stmtVentas = db.prepare(`
    SELECT v.*, cl.nombre as cliente_nombre, s.nombre as servicio_nombre, p.nombre_perfil
    FROM ventas v
    LEFT JOIN pedidos pd ON pd.id = v.pedido_id
    LEFT JOIN clientes cl ON cl.id = pd.cliente_id
    LEFT JOIN perfiles p ON p.id = v.perfil_id
    LEFT JOIN cuentas c ON c.id = p.cuenta_id
    LEFT JOIN servicios s ON s.id = c.servicio_id
    ORDER BY v.fecha DESC
`);
const _stmtHoy = db.prepare(`SELECT COALESCE(SUM(precio), 0) as total FROM ventas WHERE date(fecha) = date('now')`);
const _stmtMes = db.prepare(`SELECT COALESCE(SUM(precio), 0) as total FROM ventas WHERE strftime('%Y-%m', fecha) = strftime('%Y-%m', 'now')`);

router.get('/', (_req, res) => {
    const ventas = _stmtVentas.all();
    const hoy    = _stmtHoy.get().total;
    const mes    = _stmtMes.get().total;
    res.json({ ventas, resumen: { hoy: hoy.toFixed(2), mes: mes.toFixed(2) } });
});

module.exports = router;
