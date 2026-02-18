const express = require('express');
const router = express.Router();

// Datos de prueba en memoria (temporal)
let clientes = [
  { id: 1, nombre: 'Juan Pérez', email: 'juan@email.com' },
  { id: 2, nombre: 'María García', email: 'maria@email.com' }
];

// GET - Obtener todos los clientes
router.get('/clientes', (req, res) => {
  res.json({
    success: true,
    count: clientes.length,
    data: clientes
  });
});

// GET - Obtener un cliente por ID
router.get('/clientes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const cliente = clientes.find(c => c.id === id);
  
  if (!cliente) {
    return res.status(404).json({
      success: false,
      error: 'Cliente no encontrado'
    });
  }
  
  res.json({
    success: true,
    data: cliente
  });
});

// POST - Crear nuevo cliente
router.post('/clientes', (req, res) => {
  const { nombre, email } = req.body;
  
  if (!nombre || !email) {
    return res.status(400).json({
      success: false,
      error: 'Nombre y email son requeridos'
    });
  }
  
  const nuevoCliente = {
    id: clientes.length + 1,
    nombre,
    email,
    fechaCreacion: new Date().toISOString()
  };
  
  clientes.push(nuevoCliente);
  
  res.status(201).json({
    success: true,
    message: 'Cliente creado exitosamente',
    data: nuevoCliente
  });
});

// PUT - Actualizar cliente
router.put('/clientes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const { nombre, email } = req.body;
  
  const clienteIndex = clientes.findIndex(c => c.id === id);
  
  if (clienteIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Cliente no encontrado'
    });
  }
  
  if (nombre) clientes[clienteIndex].nombre = nombre;
  if (email) clientes[clienteIndex].email = email;
  clientes[clienteIndex].fechaActualizacion = new Date().toISOString();
  
  res.json({
    success: true,
    message: 'Cliente actualizado',
    data: clientes[clienteIndex]
  });
});

// DELETE - Eliminar cliente
router.delete('/clientes/:id', (req, res) => {
  const id = parseInt(req.params.id);
  const clienteIndex = clientes.findIndex(c => c.id === id);
  
  if (clienteIndex === -1) {
    return res.status(404).json({
      success: false,
      error: 'Cliente no encontrado'
    });
  }
  
  const clienteEliminado = clientes.splice(clienteIndex, 1)[0];
  
  res.json({
    success: true,
    message: 'Cliente eliminado',
    data: clienteEliminado
  });
});

module.exports = router;