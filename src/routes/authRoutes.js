const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { Analista } = require('../models');

// Importar middleware desde el nuevo archivo
const { authenticateToken, requireRole } = require('../middleware/auth');

// POST /api/analistas/register - Registrar nuevo analista
router.post('/register', async (req, res) => {
  try {
    const { nombre, apellido, telefono, email, password, rol } = req.body;
    
    // Validaciones básicas
    if (!nombre || !apellido || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Nombre, apellido, email y password son requeridos'
      });
    }
    
    // Verificar si el email ya existe
    const analistaExistente = await Analista.findOne({ where: { email } });
    if (analistaExistente) {
      return res.status(409).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }
    
    // Hashear password
    const saltRounds = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;
    const passwordHash = await bcrypt.hash(password, saltRounds);
    
    // Crear analista
    const analista = await Analista.create({
      fecha_registro: new Date(),
      nombre,
      apellido,
      telefono: telefono || '',
      email: email.toLowerCase(),
      password: passwordHash,
      rol: rol || 'ANALISTA',
      estado: 'ACTIVO',
      codigo_analista: `ANL${Date.now().toString().slice(-6)}`,
      created_at: new Date(),
      updated_at: new Date()
    });
    
    // Excluir password de la respuesta
    const analistaResponse = analista.toJSON();
    delete analistaResponse.password;
    
    res.status(201).json({
      success: true,
      message: 'Analista registrado exitosamente',
      data: analistaResponse
    });
  } catch (error) {
    console.error('Error registrando analista:', error);
    
    // Manejar errores de validación de Sequelize
    if (error.name === 'SequelizeValidationError') {
      const errors = error.errors.map(err => ({
        field: err.path,
        message: err.message
      }));
      
      return res.status(400).json({
        success: false,
        message: 'Error de validación',
        errors
      });
    }
    
    // Manejar errores de restricción única
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(409).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// POST /api/analistas/login - Iniciar sesión
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email y password son requeridos'
      });
    }
    
    // Buscar analista
    const analista = await Analista.findOne({ 
      where: { email: email.toLowerCase() } 
    });
    
    if (!analista) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }
    
    // Verificar estado
    if (analista.estado !== 'ACTIVO') {
      return res.status(403).json({
        success: false,
        message: `Cuenta ${analista.estado.toLowerCase()}. Contacte al administrador.`,
        estado: analista.estado
      });
    }
    
    // Verificar password
    const passwordValido = await bcrypt.compare(password, analista.password);
    
    if (!passwordValido) {
      return res.status(401).json({
        success: false,
        message: 'Credenciales inválidas'
      });
    }
    
    // Actualizar último acceso
    await analista.update({ 
      ultimo_acceso: new Date(),
      updated_at: new Date()
    });
    
    // Generar JWT
    const token = jwt.sign(
      {
        id: analista.id,
        email: analista.email,
        nombre: analista.nombre,
        apellido: analista.apellido,
        rol: analista.rol,
        codigo_analista: analista.codigo_analista
      },
      process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production',
      { 
        expiresIn: process.env.JWT_EXPIRES_IN || '24h'
      }
    );
    
    // Preparar respuesta (excluir password)
    const analistaResponse = analista.toJSON();
    delete analistaResponse.password;
    
    res.json({
      success: true,
      message: 'Login exitoso',
      data: {
        token,
        token_type: 'Bearer',
        expires_in: process.env.JWT_EXPIRES_IN || '24h',
        analista: analistaResponse
      }
    });
  } catch (error) {
    console.error('Error en login:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/analistas/profile - Obtener perfil del usuario autenticado
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    // Buscar analista
    const analista = await Analista.findByPk(req.user.id, {
      attributes: { exclude: ['password'] }
    });
    
    if (!analista) {
      return res.status(404).json({
        success: false,
        message: 'Analista no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: analista
    });
  } catch (error) {
    console.error('Error obteniendo perfil:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor'
    });
  }
});

// POST /api/auth/refresh - Refrescar token (opcional)
router.post('/refresh', async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(400).json({
        success: false,
        message: 'Refresh token requerido'
      });
    }
    
    // Verificar refresh token (en una implementación real)
    // Por ahora solo devolvemos un nuevo token si el actual es válido
    const decoded = jwt.verify(
      refreshToken,
      process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET
    );
    
    const newToken = jwt.sign(
      {
        id: decoded.id,
        email: decoded.email,
        nombre: decoded.nombre,
        apellido: decoded.apellido,
        rol: decoded.rol
      },
      process.env.JWT_SECRET || 'your_super_secret_jwt_key_change_in_production',
      { expiresIn: process.env.JWT_EXPIRES_IN || '24h' }
    );
    
    res.json({
      success: true,
      data: {
        token: newToken,
        token_type: 'Bearer',
        expires_in: process.env.JWT_EXPIRES_IN || '24h'
      }
    });
  } catch (error) {
    res.status(403).json({
      success: false,
      message: 'Refresh token inválido'
    });
  }
});

module.exports = router;