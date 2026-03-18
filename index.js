// index.js (en la raíz del backend)
require('dotenv').config();
const app = require('./src/app');

const PORT = process.env.PORT || 5001;
const HOST = process.env.HOST || '0.0.0.0';
const usingDatabaseUrl = Boolean(process.env.DATABASE_URL);

console.log('🚀 Iniciando API Crediflash...');
console.log('📊 Entorno:', process.env.NODE_ENV || 'development');
console.log('🗄️  Base de datos:', usingDatabaseUrl ? 'DATABASE_URL' : (process.env.DB_NAME || 'crediflash'));
console.log('🌐 Servidor DB:', usingDatabaseUrl ? 'provisto por DATABASE_URL' : (process.env.DB_HOST || 'localhost'));

const startServer = async () => {
  try {
    const server = app.listen(PORT, HOST, () => {
      console.log(`✅ Servidor corriendo en http://${HOST}:${PORT}`);
      console.log(`📊 Endpoints disponibles:`);
      console.log(`   • http://${HOST}:${PORT}/`);
      console.log(`   • http://${HOST}:${PORT}/health`);
      console.log(`   • http://${HOST}:${PORT}/sync-db`);
      console.log(`   • http://${HOST}:${PORT}/api/solicitudes`);
      console.log(`   • http://${HOST}:${PORT}/api/clientes`);
      console.log(`   • http://${HOST}:${PORT}/api/analistas`);
      console.log(`   • http://${HOST}:${PORT}/api/modelos-aprobacion`);
      console.log(`   • http://${HOST}:${PORT}/api/test`);
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
