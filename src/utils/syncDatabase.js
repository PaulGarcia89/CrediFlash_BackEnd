const bcrypt = require('bcrypt');
const { 
  Cliente, 
  Analista, 
  ModeloAprobacion, 
  Solicitud, 
  Prestamo, 
  Cuota, 
  sequelize 
} = require('../models');

const syncDatabase = async (force = false) => {
  try {
    await sequelize.authenticate();
    console.log('✅ Conexión a la base de datos establecida');
    
    await sequelize.sync({ force });
    console.log(`✅ Modelos sincronizados ${force ? '(forzado)' : ''}`);
    
    // Crear datos iniciales solo si la base está vacía
    const clienteCount = await Cliente.count();
    if (clienteCount === 0) {
      await Cliente.create({
        nombre: 'Juan',
        apellido: 'Pérez',
        telefono: '555-1234',
        email: 'juan@ejemplo.com',
        direccion: 'Calle Principal 123',
        nombre_contacto: 'María',
        apellido_contacto: 'González',
        telefono_contacto: '555-5678',
        email_contacto: 'maria@ejemplo.com',
        direccion_contacto: 'Calle Secundaria 456',
        estado: 'ACTIVO',
        observaciones: 'Cliente de prueba'
      });
      console.log('✅ Cliente de prueba creado');
    }
    
    const modeloCount = await ModeloAprobacion.count();
    if (modeloCount === 0) {
      await ModeloAprobacion.create({
        nombre: 'Modelo Estándar',
        reglas: {
          edad_minima: 18,
          edad_maxima: 65,
          ingreso_minimo: 1000,
          antiguedad_laboral: 6,
          score_minimo: 650
        },
        puntaje_minimo: 70,
        activo: true
      });
      console.log('✅ Modelo de aprobación creado');
    }
    
    const analistaCount = await Analista.count();
    if (analistaCount === 0) {
      const passwordHash = await bcrypt.hash(
        process.env.DEFAULT_ADMIN_PASSWORD || 'Admin123!', 
        parseInt(process.env.BCRYPT_SALT_ROUNDS || 10)
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
    
    return true;
  } catch (error) {
    console.error('❌ Error sincronizando modelos:', error);
    throw error;
  }
};

module.exports = syncDatabase;