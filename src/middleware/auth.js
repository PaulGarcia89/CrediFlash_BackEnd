// src/middleware/authMiddleware.js - MIDDLEWARE REAL
const jwt = require('jsonwebtoken');
const { AnalistaRole, Role, Permiso } = require('../models');

// Middleware para verificar token JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Token de autenticación requerido'
    });
  }

  jwt.verify(
    token, 
    process.env.JWT_SECRET || 'crediflash_jwt_secret_key_2024_change_in_production', 
    (err, user) => {
      if (err) {
        return res.status(403).json({
          success: false,
          message: 'Token inválido o expirado'
        });
      }
      req.user = user;
      next();
    }
  );
};

// Middleware para verificar roles
const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Usuario no autenticado'
      });
    }

    if (!allowedRoles.includes(req.user.rol)) {
      return res.status(403).json({
        success: false,
        message: `Acceso denegado. Rol requerido: ${allowedRoles.join(' o ')}`
      });
    }
    next();
  };
};

const getAnalistaPermissionCodes = async (analistaId) => {
  try {
    const assignment = await AnalistaRole.findOne({
      where: { analista_id: analistaId },
      include: [
        {
          model: Role,
          as: 'role',
          include: [
            {
              model: Permiso,
              as: 'permisos',
              through: { attributes: [] }
            }
          ]
        }
      ]
    });

    if (!assignment || !assignment.role) {
      return [];
    }

    return (assignment.role.permisos || []).map((item) => item.codigo);
  } catch (error) {
    return [];
  }
};

const requirePermission = (...allowedPermissionCodes) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          success: false,
          message: 'Usuario no autenticado'
        });
      }

      if (req.user.rol === 'ADMINISTRADOR') {
        return next();
      }

      const permissionCodes = await getAnalistaPermissionCodes(req.user.id);
      const hasPermission = allowedPermissionCodes.some((code) => permissionCodes.includes(code));

      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          message: `Acceso denegado. Permiso requerido: ${allowedPermissionCodes.join(' o ')}`
        });
      }

      req.user.permission_codes = permissionCodes;
      return next();
    } catch (error) {
      console.error('Error validando permisos:', error);
      return res.status(500).json({
        success: false,
        message: 'Error validando permisos del usuario'
      });
    }
  };
};

module.exports = {
  authenticateToken,
  requireRole,
  requirePermission,
  getAnalistaPermissionCodes
};
