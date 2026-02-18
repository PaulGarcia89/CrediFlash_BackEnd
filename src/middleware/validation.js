// src/middlewares/validation.js
const { validationResult, body, param, query } = require('express-validator');
const models = require('../models');

// Middleware para manejar errores de validación
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));

    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }

    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      value: err.value
    }));

    return res.status(400).json({
      success: false,
      message: 'Error de validación',
      errors: formattedErrors
    });
  };
};

// Validaciones comunes
const commonValidations = {
  id: param('id')
    .isInt({ min: 1 })
    .withMessage('ID debe ser un número entero positivo'),

  pagination: [
    query('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('La página debe ser un número mayor a 0'),
    query('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('El límite debe estar entre 1 y 100')
  ]
};

// Validaciones para Cliente
const clienteValidations = {
  create: [
    body('nombre')
      .trim()
      .notEmpty()
      .withMessage('El nombre es requerido')
      .isLength({ min: 2, max: 50 })
      .withMessage('El nombre debe tener entre 2 y 50 caracteres'),
    
    body('apellido')
      .trim()
      .notEmpty()
      .withMessage('El apellido es requerido')
      .isLength({ min: 2, max: 50 })
      .withMessage('El apellido debe tener entre 2 y 50 caracteres'),
    
    body('email')
      .trim()
      .notEmpty()
      .withMessage('El email es requerido')
      .isEmail()
      .withMessage('Email inválido')
      .custom(async (email) => {
        const existing = await models.Cliente.findOne({ where: { email } });
        if (existing) {
          throw new Error('El email ya está registrado');
        }
      }),
    
    body('telefono')
      .trim()
      .notEmpty()
      .withMessage('El teléfono es requerido')
      .isLength({ min: 8, max: 20 })
      .withMessage('El teléfono debe tener entre 8 y 20 caracteres'),
    
    body('direccion')
      .optional()
      .trim()
      .isLength({ max: 200 })
      .withMessage('La dirección no puede exceder 200 caracteres'),
    
    body('estado')
      .optional()
      .isIn(['ACTIVO', 'INACTIVO', 'SUSPENDIDO'])
      .withMessage('Estado inválido')
  ],

  update: [
    param('id')
      .isInt({ min: 1 })
      .withMessage('ID inválido'),
    
    body('email')
      .optional()
      .trim()
      .isEmail()
      .withMessage('Email inválido')
      .custom(async (email, { req }) => {
        const existing = await models.Cliente.findOne({ 
          where: { 
            email,
            id: { [models.Sequelize.Op.ne]: req.params.id }
          }
        });
        if (existing) {
          throw new Error('El email ya está registrado');
        }
      })
  ]
};

// Validaciones para Analista
const analistaValidations = {
  create: [
    body('nombre')
      .trim()
      .notEmpty()
      .withMessage('El nombre es requerido')
      .isLength({ min: 2, max: 50 })
      .withMessage('El nombre debe tener entre 2 y 50 caracteres'),
    
    body('apellido')
      .trim()
      .notEmpty()
      .withMessage('El apellido es requerido')
      .isLength({ min: 2, max: 50 })
      .withMessage('El apellido debe tener entre 2 y 50 caracteres'),
    
    body('email')
      .trim()
      .notEmpty()
      .withMessage('El email es requerido')
      .isEmail()
      .withMessage('Email inválido')
      .custom(async (email) => {
        const existing = await models.Analista.findOne({ where: { email } });
        if (existing) {
          throw new Error('El email ya está registrado');
        }
      }),
    
    body('password')
      .trim()
      .notEmpty()
      .withMessage('La contraseña es requerida')
      .isLength({ min: 8 })
      .withMessage('La contraseña debe tener al menos 8 caracteres')
      .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .withMessage('La contraseña debe contener mayúsculas, minúsculas, números y caracteres especiales'),
    
    body('rol')
      .trim()
      .notEmpty()
      .withMessage('El rol es requerido')
      .isIn(['ADMINISTRADOR', 'ANALISTA', 'GESTOR'])
      .withMessage('Rol inválido'),
    
    body('codigo_analista')
      .trim()
      .notEmpty()
      .withMessage('El código de analista es requerido')
      .isLength({ min: 3, max: 20 })
      .withMessage('El código debe tener entre 3 y 20 caracteres')
      .custom(async (codigo) => {
        const existing = await models.Analista.findOne({ where: { codigo_analista: codigo } });
        if (existing) {
          throw new Error('El código de analista ya está registrado');
        }
      })
  ],

  login: [
    body('email')
      .trim()
      .notEmpty()
      .withMessage('El email es requerido')
      .isEmail()
      .withMessage('Email inválido'),
    
    body('password')
      .trim()
      .notEmpty()
      .withMessage('La contraseña es requerida')
  ]
};

// Validaciones para Solicitud
const solicitudValidations = {
  create: [
    body('cliente_id')
      .isInt({ min: 1 })
      .withMessage('Cliente ID inválido')
      .custom(async (clienteId) => {
        const cliente = await models.Cliente.findByPk(clienteId);
        if (!cliente) {
          throw new Error('Cliente no encontrado');
        }
      }),
    
    body('monto_solicitado')
      .isFloat({ min: 100, max: 100000 })
      .withMessage('El monto debe estar entre 100 y 100,000'),
    
    body('plazo_solicitado')
      .isInt({ min: 1, max: 120 })
      .withMessage('El plazo debe estar entre 1 y 120 meses'),
    
    body('tipo_prestamo')
      .isIn(['PERSONAL', 'HIPOTECARIO', 'AUTOMOTRIZ', 'EDUCATIVO'])
      .withMessage('Tipo de préstamo inválido'),
    
    body('descripcion')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('La descripción no puede exceder 500 caracteres')
  ],

  updateEstado: [
    param('id')
      .isInt({ min: 1 })
      .withMessage('ID inválido'),
    
    body('estado')
      .isIn(['PENDIENTE', 'APROBADA', 'RECHAZADA', 'EN_REVISION'])
      .withMessage('Estado inválido'),
    
    body('comentario')
      .optional()
      .trim()
      .isLength({ max: 500 })
      .withMessage('El comentario no puede exceder 500 caracteres')
  ]
};

// Validaciones para Préstamo
const prestamoValidations = {
  create: [
    body('solicitud_id')
      .isInt({ min: 1 })
      .withMessage('Solicitud ID inválido')
      .custom(async (solicitudId) => {
        const solicitud = await models.Solicitud.findByPk(solicitudId);
        if (!solicitud) {
          throw new Error('Solicitud no encontrada');
        }
        if (solicitud.estado !== 'APROBADA') {
          throw new Error('La solicitud debe estar aprobada');
        }
      }),
    
    body('tasa_interes')
      .isFloat({ min: 0.1, max: 30 })
      .withMessage('La tasa de interés debe estar entre 0.1% y 30%'),
    
    body('fecha_desembolso')
      .isISO8601()
      .withMessage('Fecha de desembolso inválida')
      .custom((fecha) => {
        const date = new Date(fecha);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        if (date < today) {
          throw new Error('La fecha de desembolso no puede ser en el pasado');
        }
        return true;
      }),
    
    body('metodo_pago')
      .isIn(['MENSUAL', 'QUINCENAL', 'SEMANAL'])
      .withMessage('Método de pago inválido')
  ]
};

// Validaciones para Cuota
const cuotaValidations = {
  create: [
    body('prestamo_id')
      .isInt({ min: 1 })
      .withMessage('Préstamo ID inválido')
      .custom(async (prestamoId) => {
        const prestamo = await models.Prestamo.findByPk(prestamoId);
        if (!prestamo) {
          throw new Error('Préstamo no encontrado');
        }
      }),
    
    body('numero_cuota')
      .isInt({ min: 1 })
      .withMessage('Número de cuota inválido'),
    
    body('monto_capital')
      .isFloat({ min: 0.01 })
      .withMessage('Monto de capital inválido'),
    
    body('monto_interes')
      .isFloat({ min: 0 })
      .withMessage('Monto de interés inválido'),
    
    body('fecha_vencimiento')
      .isISO8601()
      .withMessage('Fecha de vencimiento inválida'),
    
    body('estado')
      .optional()
      .isIn(['PENDIENTE', 'PAGADA', 'VENCIDA', 'PARCIAL'])
      .withMessage('Estado inválido')
  ],

  updatePago: [
    param('id')
      .isInt({ min: 1 })
      .withMessage('ID de cuota inválido'),
    
    body('monto_pagado')
      .isFloat({ min: 0.01 })
      .withMessage('Monto pagado inválido'),
    
    body('fecha_pago')
      .optional()
      .isISO8601()
      .withMessage('Fecha de pago inválida'),
    
    body('metodo_pago')
      .optional()
      .isIn(['EFECTIVO', 'TARJETA', 'TRANSFERENCIA', 'CHEQUE'])
      .withMessage('Método de pago inválido')
  ]
};

// Validaciones para ModeloAprobacion
const modeloAprobacionValidations = {
  create: [
    body('nombre')
      .trim()
      .notEmpty()
      .withMessage('El nombre es requerido')
      .isLength({ min: 3, max: 100 })
      .withMessage('El nombre debe tener entre 3 y 100 caracteres'),
    
    body('reglas')
      .isObject()
      .withMessage('Las reglas deben ser un objeto válido'),
    
    body('puntaje_minimo')
      .isInt({ min: 0, max: 100 })
      .withMessage('El puntaje mínimo debe estar entre 0 y 100'),
    
    body('activo')
      .optional()
      .isBoolean()
      .withMessage('Activo debe ser verdadero o falso')
  ]
};

// Middleware para validar que el usuario existe
const validateUserExists = async (req, res, next) => {
  try {
    const userId = req.userId || req.params.userId;
    const user = await models.Analista.findByPk(userId);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Usuario no encontrado'
      });
    }
    
    req.user = user;
    next();
  } catch (error) {
    next(error);
  }
};

// Middleware para validar que el cliente existe
const validateClienteExists = async (req, res, next) => {
  try {
    const clienteId = req.params.clienteId || req.body.cliente_id;
    const cliente = await models.Cliente.findByPk(clienteId);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }
    
    req.cliente = cliente;
    next();
  } catch (error) {
    next(error);
  }
};

// Exportar todo
module.exports = {
  validate,
  commonValidations,
  clienteValidations,
  analistaValidations,
  solicitudValidations,
  prestamoValidations,
  cuotaValidations,
  modeloAprobacionValidations,
  validateUserExists,
  validateClienteExists,
  
  // Shortcuts para uso común
  validateClienteCreate: validate(clienteValidations.create),
  validateAnalistaCreate: validate(analistaValidations.create),
  validateAnalistaLogin: validate(analistaValidations.login),
  validateSolicitudCreate: validate(solicitudValidations.create),
  validatePrestamoCreate: validate(prestamoValidations.create),
  validateCuotaCreate: validate(cuotaValidations.create),
  validateModeloAprobacionCreate: validate(modeloAprobacionValidations.create)
};