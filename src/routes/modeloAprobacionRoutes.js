const express = require('express');
const router = express.Router();
const modeloAprobacionController = require('../controllers/modeloAprobacionController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Rutas para modelos de aprobación
router.get('/', authenticateToken, modeloAprobacionController.getAll);
router.get('/:id', authenticateToken, modeloAprobacionController.getById);
router.post('/', authenticateToken, requireRole('ADMINISTRADOR'), modeloAprobacionController.create);
router.put('/:id', authenticateToken, requireRole('ADMINISTRADOR'), modeloAprobacionController.update);
router.delete('/:id', authenticateToken, requireRole('ADMINISTRADOR'), modeloAprobacionController.delete);

module.exports = router; // ✅ Solo exportar, no llamar
