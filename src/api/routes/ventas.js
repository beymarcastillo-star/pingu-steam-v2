const router = require('express').Router();
const db     = require('../../db/database');

router.get('/', (req, res) => {
    const ventas = db.prepare(`
        SELECT v.*, cl.nombre as cliente_nombre, s.nombre as servicio_nombre, p.nombre_perfil
        FROM ventas v
        LEFT JOIN pedidos pd ON pd.id = v.pedido_id
        LEFT JOIN clientes cl ON cl.id = pd.cliente_id
        LEFT JOIN perfiles p ON p.id = v.perfil_id
        LEFT JOIN cuentas c ON c.id = p.cuenta_id
        LEFT JOIN servicios s ON s.id = c.servicio_id
        ORDER BY v.fecha DESC
    `).all();

    const hoy = new Date().toISOString().slice(0, 10);
    const mes = new Date().toISOString().slice(0, 7);

    const ventasHoy = ventas.filter(v => v.fecha?.startsWith(hoy)).reduce((a, v) => a + v.precio, 0);
    const ventasMes = ventas.filter(v => v.fecha?.startsWith(mes)).reduce((a, v) => a + v.precio, 0);

    res.json({ ventas, resumen: { hoy: ventasHoy.toFixed(2), mes: ventasMes.toFixed(2) } });
});

module.exports = router;
