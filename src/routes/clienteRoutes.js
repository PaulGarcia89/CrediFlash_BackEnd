const express = require('express');
const router = express.Router();
const { Cliente, Prestamo, Solicitud } = require('../models');
const { Op } = require('sequelize');
const { sendCsv } = require('../utils/exporter');

// GET /api/clientes - Listar clientes con paginación
router.get('/', async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 10, 
      search, 
      estado,
      format,
      sortBy = 'fecha_registro',
      sortOrder = 'DESC' 
    } = req.query;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    
    // Construir condiciones de búsqueda
    const where = {};
    
    if (estado) {
      where.estado = estado;
    }
    
    if (search) {
      where[Op.or] = [
        { nombre: { [Op.iLike]: `%${search}%` } },
        { apellido: { [Op.iLike]: `%${search}%` } },
        { email: { [Op.iLike]: `%${search}%` } },
        { telefono: { [Op.iLike]: `%${search}%` } }
      ];
    }

    const queryOptions = {
      where,
      order: [[sortBy, sortOrder]]
    };

    if (format !== 'csv') {
      queryOptions.limit = parseInt(limit);
      queryOptions.offset = offset;
    }

    const { count, rows: clientes } = await Cliente.findAndCountAll(queryOptions);

    // Transformar datos para incluir nombre completo
    const clientesTransformados = clientes.map(cliente => ({
      id: cliente.id,
      fecha_registro: cliente.fecha_registro,
      nombre: cliente.nombre,
      apellido: cliente.apellido,
      nombre_completo: `${cliente.nombre} ${cliente.apellido}`, // Forma alternativa
      telefono: cliente.telefono,
      email: cliente.email,
      direccion: cliente.direccion,
      nombre_contacto: cliente.nombre_contacto,
      apellido_contacto: cliente.apellido_contacto,
      telefono_contacto: cliente.telefono_contacto,
      email_contacto: cliente.email_contacto,
      direccion_contacto: cliente.direccion_contacto,
      estado: cliente.estado,
      observaciones: cliente.observaciones
    }));

    if (format === 'csv') {
      return sendCsv(res, {
        filename: `clientes_${Date.now()}.csv`,
        headers: [
          { key: 'id', label: 'id' },
          { key: 'fecha_registro', label: 'fecha_registro' },
          { key: 'nombre', label: 'nombre' },
          { key: 'apellido', label: 'apellido' },
          { key: 'nombre_completo', label: 'nombre_completo' },
          { key: 'telefono', label: 'telefono' },
          { key: 'email', label: 'email' },
          { key: 'direccion', label: 'direccion' },
          { key: 'estado', label: 'estado' },
          { key: 'observaciones', label: 'observaciones' }
        ],
        rows: clientesTransformados
      });
    }

    res.json({
      success: true,
      data: clientesTransformados,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo clientes',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// GET /api/clientes/:id - Obtener cliente por ID
router.get('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }
    
    res.json({
      success: true,
      data: cliente
    });
  } catch (error) {
    console.error('Error obteniendo cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo cliente'
    });
  }
});

// GET /api/clientes/:id/prestamos - Historial de préstamos del cliente (paginado)
router.get('/:id/prestamos', async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    const cliente = await Cliente.findByPk(id);
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const { count, rows } = await Prestamo.findAndCountAll({
      include: [
        {
          model: Solicitud,
          as: 'solicitud',
          where: { cliente_id: id },
          required: true
        }
      ],
      order: [['fecha_inicio', 'DESC']],
      limit: parseInt(limit),
      offset
    });

    const prestamos = rows.map((prestamo) => ({
      ...prestamo.toJSON(),
      cliente_id: prestamo?.solicitud?.cliente_id || null
    }));

    return res.json({
      success: true,
      data: prestamos,
      pagination: {
        total: count,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(count / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('Error obteniendo historial de préstamos:', error);
    return res.status(500).json({
      success: false,
      message: 'Error obteniendo historial de préstamos'
    });
  }
});

// POST /api/clientes - Crear cliente
router.post('/', async (req, res) => {
  try {
    const { 
      nombre, 
      apellido, 
      telefono, 
      email, 
      direccion,
      nombre_contacto,
      apellido_contacto,
      telefono_contacto,
      email_contacto,
      direccion_contacto,
      estado,
      observaciones 
    } = req.body;

    // Validaciones básicas
    if (!nombre || !apellido) {
      return res.status(400).json({
        success: false,
        message: 'Nombre y apellido son requeridos'
      });
    }

    const cliente = await Cliente.create({
      nombre,
      apellido,
      telefono,
      email,
      direccion,
      nombre_contacto,
      apellido_contacto,
      telefono_contacto,
      email_contacto,
      direccion_contacto,
      estado: estado || 'ACTIVO',
      observaciones,
      fecha_registro: new Date()
    });

    res.status(201).json({
      success: true,
      message: 'Cliente creado exitosamente',
      data: cliente
    });
  } catch (error) {
    console.error('Error creando cliente:', error);
    
    if (error.name === 'SequelizeUniqueConstraintError') {
      return res.status(400).json({
        success: false,
        message: 'El email ya está registrado'
      });
    }
    
    res.status(500).json({
      success: false,
      message: 'Error creando cliente',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// PUT /api/clientes/:id - Actualizar cliente
router.put('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    const updates = {};
    const camposPermitidos = [
      'nombre', 'apellido', 'telefono', 'email', 'direccion',
      'nombre_contacto', 'apellido_contacto', 'telefono_contacto',
      'email_contacto', 'direccion_contacto', 'estado', 'observaciones'
    ];

    // Solo actualizar campos permitidos que estén presentes en el body
    camposPermitidos.forEach(campo => {
      if (req.body[campo] !== undefined) {
        updates[campo] = req.body[campo];
      }
    });

    await cliente.update(updates);

    res.json({
      success: true,
      message: 'Cliente actualizado exitosamente',
      data: cliente
    });
  } catch (error) {
    console.error('Error actualizando cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error actualizando cliente'
    });
  }
});

// DELETE /api/clientes/:id - Eliminar cliente (cambiar estado a INACTIVO)
router.delete('/:id', async (req, res) => {
  try {
    const cliente = await Cliente.findByPk(req.params.id);
    
    if (!cliente) {
      return res.status(404).json({
        success: false,
        message: 'Cliente no encontrado'
      });
    }

    // En lugar de eliminar, cambiar estado a INACTIVO
    await cliente.update({ estado: 'INACTIVO' });

    res.json({
      success: true,
      message: 'Cliente marcado como INACTIVO'
    });
  } catch (error) {
    console.error('Error eliminando cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error eliminando cliente'
    });
  }
});

// GET /api/clientes/search/:term - Buscar clientes
router.get('/search/:term', async (req, res) => {
  try {
    const { term } = req.params;
    
    const clientes = await Cliente.findAll({
      where: {
        [Op.or]: [
          { nombre: { [Op.iLike]: `%${term}%` } },
          { apellido: { [Op.iLike]: `%${term}%` } },
          { email: { [Op.iLike]: `%${term}%` } },
          { telefono: { [Op.iLike]: `%${term}%` } }
        ]
      },
      limit: 20
    });

    res.json({
      success: true,
      data: clientes
    });
  } catch (error) {
    console.error('Error buscando clientes:', error);
    res.status(500).json({
      success: false,
      message: 'Error buscando clientes'
    });
  }
});

// GET /api/clientes/stats/estadisticas - Estadísticas de clientes
router.get('/stats/estadisticas', async (req, res) => {
  try {
    const totalClientes = await Cliente.count();
    const clientesActivos = await Cliente.count({ where: { estado: 'ACTIVO' } });
    const clientesInactivos = await Cliente.count({ where: { estado: 'INACTIVO' } });
    
    // Clientes registrados este mes
    const inicioMes = new Date();
    inicioMes.setDate(1);
    inicioMes.setHours(0, 0, 0, 0);
    
    const clientesEsteMes = await Cliente.count({
      where: {
        fecha_registro: {
          [Op.gte]: inicioMes
        }
      }
    });

    res.json({
      success: true,
      data: {
        total: totalClientes,
        activos: clientesActivos,
        inactivos: clientesInactivos,
        este_mes: clientesEsteMes,
        porcentaje_activos: totalClientes > 0 ? ((clientesActivos / totalClientes) * 100).toFixed(2) : 0
      }
    });
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    res.status(500).json({
      success: false,
      message: 'Error obteniendo estadísticas'
    });
  }
});

module.exports = router;
