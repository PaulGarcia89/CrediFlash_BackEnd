const sequelize = require('../config/database');
const { ensureAccessControlSeed } = require('../utils/accessControlSeed');

// ========== IMPORTAR TODOS LOS MODELOS ==========
const Cliente = require('./Cliente');
const Analista = require('./Analista');
const ModeloAprobacion = require('./ModeloAprobacion');
const Solicitud = require('./Solicitud');
const SolicitudDocumento = require('./SolicitudDocumento');
const Prestamo = require('./Prestamo');
const Cuota = require('./Cuota');
const Role = require('./Role');
const Permiso = require('./Permiso');
const RolePermiso = require('./RolePermiso');
const AnalistaRole = require('./AnalistaRole');

// ========== DEFINIR RELACIONES ==========

// 1. CLIENTE - SOLICITUD (1:N)
Cliente.hasMany(Solicitud, {
  foreignKey: 'cliente_id',
  as: 'solicitudes',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

Solicitud.belongsTo(Cliente, {
  foreignKey: 'cliente_id',
  as: 'cliente',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// 2. ANALISTA - SOLICITUD (1:N)
Analista.hasMany(Solicitud, {
  foreignKey: 'analista_id',
  as: 'solicitudes_revisadas',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

Solicitud.belongsTo(Analista, {
  foreignKey: 'analista_id',
  as: 'analista',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

// 3. MODELO APROBACIÓN - SOLICITUD (1:N)
ModeloAprobacion.hasMany(Solicitud, {
  foreignKey: 'modelo_aprobacion_id',
  as: 'solicitudes_evaluadas',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

Solicitud.belongsTo(ModeloAprobacion, {
  foreignKey: 'modelo_aprobacion_id',
  as: 'modelo_aprobacion',
  onDelete: 'SET NULL',
  onUpdate: 'CASCADE'
});

// 4. SOLICITUD - PRÉSTAMO (1:1)
Solicitud.hasOne(Prestamo, {
  foreignKey: 'solicitud_id',
  as: 'prestamo',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

Prestamo.belongsTo(Solicitud, {
  foreignKey: 'solicitud_id',
  as: 'solicitud',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// 4.1. SOLICITUD - DOCUMENTOS (1:N)
Solicitud.hasMany(SolicitudDocumento, {
  foreignKey: 'solicitud_id',
  as: 'documentos',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

SolicitudDocumento.belongsTo(Solicitud, {
  foreignKey: 'solicitud_id',
  as: 'solicitud',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// 5. PRÉSTAMO - CUOTA (1:N)
Prestamo.hasMany(Cuota, {
  foreignKey: 'prestamo_id',
  as: 'cuotas',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

Cuota.belongsTo(Prestamo, {
  foreignKey: 'prestamo_id',
  as: 'prestamo',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// 6. ROLES Y PERMISOS
Role.belongsToMany(Permiso, {
  through: RolePermiso,
  foreignKey: 'role_id',
  otherKey: 'permiso_id',
  as: 'permisos'
});

Permiso.belongsToMany(Role, {
  through: RolePermiso,
  foreignKey: 'permiso_id',
  otherKey: 'role_id',
  as: 'roles'
});

// 7. ASIGNACIÓN DE ROL A ANALISTA
Analista.belongsToMany(Role, {
  through: AnalistaRole,
  foreignKey: 'analista_id',
  otherKey: 'role_id',
  as: 'roles_acceso'
});

Role.belongsToMany(Analista, {
  through: AnalistaRole,
  foreignKey: 'role_id',
  otherKey: 'analista_id',
  as: 'analistas'
});

AnalistaRole.belongsTo(Role, {
  foreignKey: 'role_id',
  as: 'role',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

AnalistaRole.belongsTo(Analista, {
  foreignKey: 'analista_id',
  as: 'analista',
  onDelete: 'CASCADE',
  onUpdate: 'CASCADE'
});

// ========== RELACIONES ADICIONALES PARA CONSULTAS ==========

// Cliente puede acceder a préstamos a través de solicitudes
Cliente.prototype.obtenerPrestamos = async function() {
  const solicitudes = await this.getSolicitudes({
    include: [{
      model: Prestamo,
      as: 'prestamo'
    }]
  });
  
  return solicitudes
    .map(s => s.prestamo)
    .filter(p => p !== null);
};

// Préstamo puede acceder a cliente a través de solicitud
Prestamo.prototype.obtenerCliente = async function() {
  const solicitud = await this.getSolicitud({
    include: [{
      model: Cliente,
      as: 'cliente'
    }]
  });
  
  return solicitud ? solicitud.cliente : null;
};

// Cuota puede acceder a cliente a través de préstamo y solicitud
Cuota.prototype.obtenerCliente = async function() {
  const prestamo = await this.getPrestamo({
    include: [{
      model: Solicitud,
      as: 'solicitud',
      include: [{
        model: Cliente,
        as: 'cliente'
      }]
    }]
  });
  
  return prestamo && prestamo.solicitud ? prestamo.solicitud.cliente : null;
};

// ========== EXPORTAR TODO ==========
const models = {
  sequelize,
  Cliente,
  Analista,
  ModeloAprobacion,
  Solicitud,
  SolicitudDocumento,
  Prestamo,
  Cuota,
  Role,
  Permiso,
  RolePermiso,
  AnalistaRole
};

// ========== FUNCIONES DE INICIALIZACIÓN ==========
models.inicializarBaseDeDatos = async (opciones = {}) => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a la base de datos establecida');
    
    const syncOptions = {
      force: opciones.force || false,
      alter: opciones.alter || true
    };
    
    await sequelize.sync(syncOptions);
    console.log(`✅ Modelos sincronizados (force: ${syncOptions.force}, alter: ${syncOptions.alter})`);
    
    // Crear datos iniciales si la base está vacía
    await models.crearDatosIniciales();
    
    return true;
  } catch (error) {
    console.error('❌ Error inicializando base de datos:', error);
    throw error;
  }
};

models.crearDatosIniciales = async () => {
  try {
    // Verificar si ya existen datos
    const cuentaAnalistas = await Analista.count();
    const cuentaClientes = await Cliente.count();
    const cuentaModelos = await ModeloAprobacion.count();
    
    // Crear admin por defecto si no existe
    if (cuentaAnalistas === 0) {
      const bcrypt = require('bcrypt');
      const passwordHash = await bcrypt.hash(
        process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!', 
        10
      );
      
      await Analista.create({
        fecha_registro: new Date(),
        nombre: process.env.DEFAULT_ADMIN_NAME || 'Admin',
        apellido: process.env.DEFAULT_ADMIN_LASTNAME || 'Sistema',
        telefono: process.env.DEFAULT_ADMIN_PHONE || '+1234567890',
        email: process.env.DEFAULT_ADMIN_EMAIL || 'admin@crediflash.com',
        password: passwordHash,
        rol: 'ADMINISTRADOR',
        estado: 'ACTIVO',
        codigo_analista: process.env.DEFAULT_ADMIN_CODIGO || 'ADM001',
        departamento: process.env.DEFAULT_ADMIN_DEPARTAMENTO || 'Administración',
        created_at: new Date(),
        updated_at: new Date()
      });
      
      console.log(`✅ Administrador creado: ${process.env.DEFAULT_ADMIN_EMAIL || 'admin@crediflash.com'}`);
    }
    
    // Crear cliente de prueba si no existe
    if (cuentaClientes === 0) {
      await Cliente.create({
        nombre: 'Juan',
        apellido: 'Pérez',
        telefono: '555-1234',
        email: 'juan.perez@email.com',
        direccion: 'Calle Principal 123',
        estado: 'ACTIVO',
        fecha_registro: new Date()
      });
      
      console.log('✅ Cliente de prueba creado');
    }
    
    // Crear modelo de aprobación por defecto si no existe
    if (cuentaModelos === 0) {
      await ModeloAprobacion.create({
        nombre: 'Modelo Estándar',
        reglas: {
          edad_minima: 18,
          edad_maxima: 65,
          ingreso_minimo: 1000,
          score_minimo: 650,
          antiguedad_laboral: 6,
          monto_maximo: 50000,
          plazo_maximo: 60
        },
        puntaje_minimo: 70,
        activo: true,
        creado_en: new Date()
      });
      
      console.log('✅ Modelo de aprobación creado');
    }
    
    const accessControlResult = await ensureAccessControlSeed(models);

    return {
      analistas: cuentaAnalistas,
      clientes: cuentaClientes,
      modelos: cuentaModelos,
      accessControl: accessControlResult
    };
  } catch (error) {
    console.error('❌ Error creando datos iniciales:', error);
    throw error;
  }
};

// ========== FUNCIONES DE CONSULTA ÚTILES ==========
models.obtenerEstadisticas = async () => {
  try {
    const [
      totalClientes,
      totalAnalistas,
      totalSolicitudes,
      totalPrestamos,
      totalCuotas,
      solicitudesPendientes,
      prestamosActivos,
      cuotasVencidas
    ] = await Promise.all([
      Cliente.count(),
      Analista.count(),
      Solicitud.count(),
      Prestamo.count(),
      Cuota.count(),
      Solicitud.count({ where: { estado: 'PENDIENTE' } }),
      Prestamo.count({ where: { status: 'ACTIVO' } }),
      Cuota.count({ where: { estado: 'VENCIDO' } })
    ]);
    
    return {
      clientes: totalClientes,
      analistas: totalAnalistas,
      solicitudes: {
        total: totalSolicitudes,
        pendientes: solicitudesPendientes,
        aprobadas: totalSolicitudes - solicitudesPendientes
      },
      prestamos: {
        total: totalPrestamos,
        activos: prestamosActivos
      },
      cuotas: {
        total: totalCuotas,
        vencidas: cuotasVencidas
      }
    };
  } catch (error) {
    console.error('Error obteniendo estadísticas:', error);
    throw error;
  }
};

models.buscarPorTexto = async (texto) => {
  try {
    const { Op } = require('sequelize');
    
    const [clientes, analistas, solicitudes] = await Promise.all([
      Cliente.findAll({
        where: {
          [Op.or]: [
            { nombre: { [Op.iLike]: `%${texto}%` } },
            { apellido: { [Op.iLike]: `%${texto}%` } },
            { email: { [Op.iLike]: `%${texto}%` } },
            { telefono: { [Op.iLike]: `%${texto}%` } }
          ]
        },
        limit: 10
      }),
      Analista.findAll({
        where: {
          [Op.or]: [
            { nombre: { [Op.iLike]: `%${texto}%` } },
            { apellido: { [Op.iLike]: `%${texto}%` } },
            { email: { [Op.iLike]: `%${texto}%` } },
            { codigo_analista: { [Op.iLike]: `%${texto}%` } }
          ]
        },
        attributes: { exclude: ['password'] },
        limit: 10
      }),
      Solicitud.findAll({
        include: [
          { model: Cliente, as: 'cliente' }
        ],
        where: {
          [Op.or]: [
            { estado: { [Op.iLike]: `%${texto}%` } },
            { '$cliente.nombre$': { [Op.iLike]: `%${texto}%` } },
            { '$cliente.apellido$': { [Op.iLike]: `%${texto}%` } }
          ]
        },
        limit: 10
      })
    ]);
    
    return {
      clientes,
      analistas,
      solicitudes,
      total: clientes.length + analistas.length + solicitudes.length
    };
  } catch (error) {
    console.error('Error en búsqueda por texto:', error);
    throw error;
  }
};

// ========== CONFIGURACIÓN GLOBAL DE MODELOS ==========
// Deshabilitar logging en producción
if (process.env.NODE_ENV === 'production') {
  sequelize.options.logging = false;
}

// Asegurar que las fechas se manejen correctamente
sequelize.options.dialectOptions = {
  ...sequelize.options.dialectOptions,
  dateStrings: true,
  typeCast: true
};

module.exports = models;
