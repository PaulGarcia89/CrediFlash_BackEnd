// src/routes/analistaRoutes.js - RUTAS REALES
const express = require('express');
const router = express.Router();
const analistaController = require('../controllers/analistaController');
const roleController = require('../controllers/roleController');
const { authenticateToken, requirePermission } = require('../middleware/auth');

// ========== RUTAS PÚBLICAS ==========
router.post('/registrar', authenticateToken, requirePermission('analistas.manage'), analistaController.registrarAnalista);
router.post('/login', analistaController.login);

// ========== RUTAS PROTEGIDAS (requieren token) ==========
router.get('/perfil', authenticateToken, analistaController.getPerfil);
router.put('/perfil', authenticateToken, analistaController.updatePerfil);
router.get('/permisos-efectivos', authenticateToken, analistaController.getPermisosEfectivos);

// ========== RUTAS PARA ADMIN/SUPERVISOR ==========
router.get('/', authenticateToken, requirePermission('analistas.view'), analistaController.listarAnalistas);
router.get('/:id', authenticateToken, requirePermission('analistas.view'), analistaController.getAnalistaById);

// ========== RUTAS SOLO PARA ADMIN ==========
router.put('/:id', authenticateToken, requirePermission('analistas.manage'), analistaController.updateAnalista);
router.post('/:id/reset-password', authenticateToken, requirePermission('analistas.manage'), analistaController.resetPasswordByAdmin);
router.delete('/:id', authenticateToken, requirePermission('analistas.manage'), analistaController.deleteAnalista);
router.put(
  '/:id/rol-acceso',
  authenticateToken,
  requirePermission('roles.manage'),
  roleController.assignRoleToAnalista
);
router.get(
  '/:id/permisos-efectivos',
  authenticateToken,
  requirePermission('roles.view'),
  roleController.getAnalistaPermissions
);

module.exports = router;
