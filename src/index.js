require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 5001;

// Importar los modelos y función de inicialización
const { 
  sequelize, 
  inicializarBaseDeDatos 
} = require('./models');

// Función para iniciar el servidor
const startServer = async () => {
  try {
    console.log('🚀 Iniciando aplicación Crediflash...');
    
    // 1. Inicializar base de datos
    console.log('📦 Inicializando base de datos...');
    await inicializarBaseDeDatos({ 
      alter: process.env.NODE_ENV === 'development',
      force: false // NUNCA usar force=true en producción
    });
    
    // 2. Verificar datos iniciales
    console.log('✅ Base de datos inicializada correctamente');
    
    // 3. Iniciar servidor Express
    const server = app.listen(PORT, () => {
      console.log(`
===========================================
🚀 SERVICIO CREDIFLASH INICIADO
===========================================
📡 Puerto: ${PORT}
🌍 Ambiente: ${process.env.NODE_ENV || 'development'}
🕐 Iniciado: ${new Date().toISOString()}
📊 API: http://localhost:${PORT}
📚 Documentación: http://localhost:${PORT}/
💾 Base de datos: ${process.env.DB_NAME || 'crediflash'}
===========================================
      `);
    });
    
    // 4. Configurar manejo de cierre elegante
    const shutdown = async (signal) => {
      console.log(`\n📴 Recibido ${signal}. Cerrando servidor...`);
      
      // Cerrar servidor HTTP
      server.close(async () => {
        console.log('✅ Servidor HTTP cerrado');
        
        // Cerrar conexión a base de datos
        try {
          await sequelize.close();
          console.log('✅ Conexión a base de datos cerrada');
        } catch (dbError) {
          console.error('❌ Error cerrando base de datos:', dbError);
        }
        
        console.log('👋 Aplicación finalizada correctamente');
        process.exit(0);
      });
      
      // Timeout forzar cierre después de 10 segundos
      setTimeout(() => {
        console.error('❌ Timeout de cierre. Forzando salida...');
        process.exit(1);
      }, 10000);
    };
    
    // Manejar señales de terminación
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
    
    // Manejar errores no capturados
    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Promesa rechazada no manejada:', reason);
      // No salir aquí, solo loguear
    });
    
    process.on('uncaughtException', (error) => {
      console.error('❌ Excepción no capturada:', error);
      shutdown('UNCAUGHT_EXCEPTION');
    });
    
    return server;
    
  } catch (error) {
    console.error('❌ Error fatal durante la inicialización:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
};

// Solo iniciar si es el archivo principal
if (require.main === module) {
  startServer();
}

// Exportar para pruebas
module.exports = { app, startServer };