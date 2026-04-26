const router    = require('express').Router();
const db        = require('../../db/database');
const getConfig = db.getConfig;

// GET /api/servicios
router.get('/', (_req, res) => {
    const tc = parseFloat(getConfig('tipo_cambio', '6.96'));
    const servicios = db.prepare(`
        SELECT s.*,
               COUNT(CASE WHEN p.estado = 'libre' THEN 1 END) as libres
        FROM servicios s
        LEFT JOIN cuentas c ON c.servicio_id = s.id AND c.activa = 1
        LEFT JOIN perfiles p ON p.cuenta_id = c.id
        WHERE s.activo = 1
        GROUP BY s.id
    `).all();

    // Calcular precio en Bs y margen actual en tiempo real
    const result = servicios.map(s => {
        const perfs        = s.perfiles_por_cuenta || 1;
        const ingresoUsd   = s.precio_usd ? s.precio_usd * perfs : null;
        const margenActual = (s.costo_usd && ingresoUsd)
            ? +(((ingresoUsd - s.costo_usd) / s.costo_usd) * 100).toFixed(1)
            : null;
        return {
            ...s,
            precio_bs:         s.precio_usd ? +(s.precio_usd * tc).toFixed(2) : null,
            tipo_cambio:       tc,
            margen_actual:     margenActual,
            precio_minimo_usd: s.costo_usd
                ? +(s.costo_usd * (1 + (s.margen_minimo || 20) / 100) / perfs).toFixed(2)
                : null,
        };
    });

    res.json(result);
});

// POST /api/servicios
router.post('/', (req, res) => {
    const { nombre, descripcion, imagen, precio_usd, costo_usd, margen_minimo, perfiles_por_cuenta } = req.body;
    if (!nombre) return res.status(400).json({ error: 'Nombre requerido' });
    const result = db.prepare(`
        INSERT INTO servicios (nombre, descripcion, imagen, precio_usd, costo_usd, margen_minimo, perfiles_por_cuenta)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(nombre, descripcion || null, imagen || null,
           precio_usd || null, costo_usd || null, margen_minimo || 20, perfiles_por_cuenta || 1);
    res.json({ ok: true, id: result.lastInsertRowid });
});

// PUT /api/servicios/:id — editar precios y datos
router.put('/:id', (req, res) => {
    const { nombre, descripcion, precio_usd, costo_usd, margen_minimo, perfiles_por_cuenta } = req.body;
    db.prepare(`
        UPDATE servicios
        SET nombre              = COALESCE(?, nombre),
            descripcion         = COALESCE(?, descripcion),
            precio_usd          = ?,
            costo_usd           = ?,
            margen_minimo       = COALESCE(?, margen_minimo),
            perfiles_por_cuenta = COALESCE(?, perfiles_por_cuenta)
        WHERE id = ?
    `).run(nombre || null, descripcion || null,
           precio_usd ?? null, costo_usd ?? null,
           margen_minimo || null, perfiles_por_cuenta || null, req.params.id);
    res.json({ ok: true });
});

// POST /api/servicios/:id/imagen
router.post('/:id/imagen', (req, res) => {
    const { imagen } = req.body;
    if (!imagen) return res.status(400).json({ error: 'Imagen requerida' });
    db.prepare('UPDATE servicios SET imagen = ? WHERE id = ?').run(imagen, req.params.id);
    res.json({ ok: true });
});

// DELETE /api/servicios/:id
router.delete('/:id', (req, res) => {
    db.prepare('UPDATE servicios SET activo = 0 WHERE id = ?').run(req.params.id);
    res.json({ ok: true });
});

module.exports = router;
