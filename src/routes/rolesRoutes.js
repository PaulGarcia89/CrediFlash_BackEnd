const express = require('express');
const router = express.Router();
const roleController = require('../controllers/roleController');
const { authenticateToken, requirePermission } = require('../middleware/auth');

// Seed/manual bootstrap de roles y permisos (solo admin)
router.post(
  '/seed',
  authenticateToken,
  requirePermission('roles.manage'),
  roleController.seed
);

// Catálogo de roles/permisos para pantalla Settings
router.get(
  '/',
  authenticateToken,
  requirePermission('roles.view'),
  roleController.listRoles
);

router.get(
  '/catalogo-permisos',
  authenticateToken,
  requirePermission('roles.view'),
  roleController.getPermisoCatalog
);

router.post(
  '/',
  authenticateToken,
  requirePermission('roles.manage'),
  roleController.createRole
);

router.put(
  '/:id',
  authenticateToken,
  requirePermission('roles.manage'),
  roleController.updateRole
);

router.get(
  '/:id/permisos',
  authenticateToken,
  requirePermission('roles.view'),
  roleController.getRolePermissions
);

router.put(
  '/:id/permisos',
  authenticateToken,
  requirePermission('roles.manage'),
  roleController.updateRolePermissions
);

module.exports = router;
