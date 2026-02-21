const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { authenticateToken, requireRole } = require('../middleware/auth');

// Seed/manual bootstrap de roles y permisos (solo admin)
router.post(
  '/seed',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.seed
);

// Catálogo de roles/permisos para pantalla Settings
router.get(
  '/',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.listRoles
);

router.get(
  '/catalogo-permisos',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.getPermisoCatalog
);

router.post(
  '/',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.createRole
);

router.put(
  '/:id',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.updateRole
);

router.get(
  '/:id/permisos',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.getRolePermissions
);

router.put(
  '/:id/permisos',
  authenticateToken,
  requireRole('ADMINISTRADOR'),
  roleController.updateRolePermissions
);

module.exports = router;
