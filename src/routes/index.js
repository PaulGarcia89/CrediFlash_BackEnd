// src/routes/index.js
const express = require('express');
const router = express.Router();

// Importar todas las rutas
const analistaRoutes = require('./analistaRoutes');
const clienteRoutes = require('./clienteRoutes');
const solicitudRoutes = require('./solicitudRoutes');
const prestamoRoutes = require('./prestamoRoutes');
const cuotaRoutes = require('./cuotaRoutes');
const ratingRoutes = require('./ratingRoutes');
const newClientRoutes = require('./newClientRoutes');
const modeloAprobacionRoutes = require('./modeloAprobacionRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const rolesRoutes = require('./rolesRoutes');
const documentoRoutes = require('./documentoRoutes');

// Rutas principales
router.use('/analistas', analistaRoutes);
router.use('/clientes', clienteRoutes);
router.use('/solicitudes', solicitudRoutes);
router.use('/prestamos', prestamoRoutes);
router.use('/cuotas', cuotaRoutes);
router.use('/modelos-aprobacion', modeloAprobacionRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/roles', rolesRoutes);
router.use('/documentos', documentoRoutes);

// Ruta de salud
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'CrediFlash Backend API'
  });
});

module.exports = router;


