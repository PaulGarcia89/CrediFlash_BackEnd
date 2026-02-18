// index.js (en la raíz del backend)
require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5001;

console.log('🚀 Iniciando API Crediflash...');
console.log('📊 Entorno:', process.env.NODE_ENV || 'development');
console.log('🗄️  Base de datos:', process.env.DB_NAME || 'crediflash');
console.log('🌐 Servidor:', process.env.DB_HOST || 'localhost');

const startServer = async () => {
  try {
    const server = app.listen(PORT, () => {
      console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
      console.log(`📊 Endpoints disponibles:`);
      console.log(`   • http://localhost:${PORT}/`);
      console.log(`   • http://localhost:${PORT}/health`);
      console.log(`   • http://localhost:${PORT}/sync-db`);
      console.log(`   • http://localhost:${PORT}/api/solicitudes`);
      console.log(`   • http://localhost:${PORT}/api/clientes`);
      console.log(`   • http://localhost:${PORT}/api/analistas`);
      console.log(`   • http://localhost:${PORT}/api/modelos-aprobacion`);
      console.log(`   • http://localhost:${PORT}/api/test`);
    });
    
    process.on('SIGTERM', () => {
      console.log('🛑 Recibido SIGTERM, cerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
      });
    });
    
    process.on('SIGINT', () => {
      console.log('🛑 Recibido SIGINT, cerrando servidor...');
      server.close(() => {
        console.log('✅ Servidor cerrado');
        process.exit(0);
      });
    });
    
  } catch (error) {
    console.error('❌ Error al iniciar el servidor:', error.message);
    process.exit(1);
  }
};

// Manejar warning de EventEmitter
require('events').EventEmitter.defaultMaxListeners = 20;

// Iniciar servidor
startServer();