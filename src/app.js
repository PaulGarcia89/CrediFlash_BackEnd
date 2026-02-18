// src/app.js - Versión actualizada con todas las rutas
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const path = require('path');

// Importar rutas principales
const routes = require('./routes');


// Importar rutas específicas
const ratingRoutes = require('./routes/ratingRoutes');
const newClientRoutes = require('./routes/newClientRoutes');

const app = express();

// Configuración
const environment = process.env.NODE_ENV || 'development';
const corsOrigins = (process.env.CORS_ORIGIN || 'http://localhost:3000,http://localhost:5173')
  .split(',')
  .map(origin => origin.trim());

// Middlewares
app.use(cors({
  origin: corsOrigins,
  credentials: true
}));

app.use(morgan(environment === 'production' ? 'combined' : 'dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));

// ========== RUTAS API PRINCIPALES ==========
app.use('/api', routes);

// ========== RUTAS DE CALIFICACIÓN (RATING) ==========
// ✅ Ambas rutas bajo /api/ratings para mantener compatibilidad
app.use('/api/ratings', ratingRoutes);     // Sistema de rating existente
app.use('/api/ratings', newClientRoutes);  // Cálculo de nuevos clientes

// ========== RUTA PRINCIPAL CON DOCUMENTACIÓN ==========
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: '🚀 API Crediflash - Sistema de Gestión de Préstamos',
    version: '1.0.0',
    environment: environment,
    timestamp: new Date().toISOString(),
    endpoints: {
      auth: {
        register: 'POST /api/analistas/register',
        login: 'POST /api/analistas/login',
        profile: 'GET /api/analistas/profile'
      },
      analistas: {
        list: 'GET /api/analistas',
        get: 'GET /api/analistas/:id',
        post: 'POST /api/analistas/login'
      },
      clientes: {
        create: 'POST /api/clientes',
        list: 'GET /api/clientes',
        get: 'GET /api/clientes/:id'
      },
      solicitudes: {
        create: 'POST /api/solicitudes',
        list: 'GET /api/solicitudes',
        get: 'GET /api/solicitudes/:id',
        aprobar: 'POST /api/solicitudes/:id/aprobar',
        rechazar: 'POST /api/solicitudes/:id/rechazar',
        porCliente: 'GET /api/solicitudes/cliente/:cliente_id',
        ejecutarModeloNuevo: 'POST /api/solicitudes/:id/ejecutar-modelo-nuevo',
        ejecutarModeloAntiguo: 'POST /api/solicitudes/:id/ejecutar-modelo-antiguo'
      },
      prestamos: {
        create: 'POST /api/prestamos',
        list: 'GET /api/prestamos',
        get: 'GET /api/prestamos/:id',
        createFromSolicitud: 'POST /api/prestamos/solicitud/:solicitudId'
      },
      cuotas: {
        // ✅ NUEVAS RUTAS DE CUOTAS
        list: 'GET /api/cuotas',
        get: 'GET /api/cuotas/:id',
        porPrestamo: 'GET /api/cuotas/prestamo/:prestamoId',
        porEstado: 'GET /api/cuotas/estado/:estado',
        create: 'POST /api/cuotas',
        generar: 'POST /api/cuotas/prestamo/:prestamoId/generar',
        pago: 'POST /api/cuotas/:id/pago',
        update: 'PUT /api/cuotas/:id',
        delete: 'DELETE /api/cuotas/:id',
        vencidas: 'GET /api/cuotas/reportes/vencidas',
        resumenPrestamo: 'GET /api/cuotas/prestamo/:prestamoId/resumen',
        estadisticas: 'GET /api/cuotas/estadisticas/resumen',
        actualizarEstados: 'POST /api/cuotas/actualizar-estados'
      },
      modelosAprobacion: {
        create: 'POST /api/modelos-aprobacion',
        list: 'GET /api/modelos-aprobacion',
        get: 'GET /api/modelos-aprobacion/:id'
      },
      ratingSystem: {
        test: 'GET /api/ratings/test',
        clientRating: 'GET /api/ratings/client/{nombre}',
        allRankings: 'GET /api/ratings/ranking',
        portfolioReport: 'GET /api/ratings/portfolio-report',
        // ✅ NUEVO: CALCULO DE CLIENTE NUEVO CON VARIABLES COMPLETAS
        newClient: {
          endpoint: 'POST /api/ratings/new-client',
          parameters: {
            edad: 'number (edad del cliente)',
            sexo: "string ('M' para masculino, 'F' para femenino)",
            tiempoSemanas: 'number (tiempo como cliente en semanas)',
            objetivoPrestamo: "string ('pago_deuda', 'inversion', 'consumo', 'emergencia', 'otros')",
            esReferido: 'boolean (si es referido por otro cliente)',
            tieneGarantia: 'boolean (si deja garantía)',
            montoGarantia: 'number (monto de la garantía, 0 si no tiene)',
            montoSolicitado: 'number (monto del préstamo solicitado)',
            ingresosMensuales: 'number (ingresos mensuales del cliente)'
          }
        }
      },
      system: {
        health: 'GET /health',
        test: 'GET /api/test',
        syncDb: 'GET /sync-db (solo desarrollo)'
      },
      analytics: {
        dashboard: 'GET /api/analytics/dashboard?fecha_desde=YYYY-MM-DD&fecha_hasta=YYYY-MM-DD'
      }
    },
    quickAccess: {
      healthCheck: 'http://localhost:' + (process.env.PORT || 5001) + '/health',
      apiDocs: 'http://localhost:' + (process.env.PORT || 5001) + '/',
      clientes: 'http://localhost:' + (process.env.PORT || 5001) + '/api/clientes',
      solicitudes: 'http://localhost:' + (process.env.PORT || 5001) + '/api/solicitudes',
      cuotas: 'http://localhost:' + (process.env.PORT || 5001) + '/api/cuotas',
      ratings: 'http://localhost:' + (process.env.PORT || 5001) + '/api/ratings/test'
    }
  });
});

// ========== HEALTH CHECK ==========
app.get('/health', async (req, res) => {
  try {
    const { sequelize } = require('./models');
    await sequelize.authenticate();
    res.json({
      status: 'OK',
      service: 'crediflash-backend',
      database: 'connected',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: '1.0.0',
      features: {
        clientes: true,
        analistas: true,
        solicitudes: true,
        prestamos: true,
        cuotas: true, // ✅ NUEVO: Cuotas habilitado
        ratingSystem: true,
        modelosAprobacion: true
      }
    });
  } catch (error) {
    console.error('❌ Health check failed:', error);
    const dbUrl = process.env.DATABASE_URL || '';
    let dbHost = null;
    try {
      if (dbUrl) {
        dbHost = new URL(dbUrl).hostname;
      }
    } catch (_) {
      dbHost = null;
    }

    const diagnostic = {
      code: error?.parent?.code || error?.original?.code || null,
      name: error?.name || null,
      message: error?.message || error?.parent?.message || error?.original?.message || 'Database connection error',
      host: dbHost || process.env.DB_HOST || null
    };

    res.status(503).json({
      status: 'ERROR',
      service: 'crediflash-backend',
      database: 'disconnected',
      timestamp: new Date().toISOString(),
      error: diagnostic.message,
      diagnostic
    });
  }
});

// ========== SINCRONIZACIÓN DE BASE DE DATOS (SOLO DESARROLLO) ==========
if (environment !== 'production') {
  app.get('/sync-db', async (req, res) => {
    try {
      const { sequelize } = require('./models');
      await sequelize.sync({ alter: true });
      
      res.json({
        success: true,
        message: '✅ Base de datos sincronizada',
        environment: environment,
        timestamp: new Date().toISOString(),
        modelos: [
          'Cliente',
          'Analista',
          'Solicitud',
          'SolicitudDocumento',
          'Prestamo',
          'Cuota', // ✅ NUEVO: Modelo Cuota
          'ModeloAprobacion'
        ]
      });
    } catch (error) {
      console.error('❌ Error sincronizando base de datos:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  });
  
  // Ruta de prueba para cuotas
  app.get('/api/test-cuotas', async (req, res) => {
    try {
      const { Cuota, sequelize } = require('./models');
      
      // Verificar conexión
      await sequelize.authenticate();
      
      // Verificar si la tabla existe
      const [results] = await sequelize.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'cuotas'
        )
      `);
      
      const tablaExiste = results[0].exists;
      
      res.json({
        success: true,
        message: '🔍 Prueba de sistema de cuotas',
        timestamp: new Date().toISOString(),
        database: {
          connected: true,
          tabla_cuotas_existe: tablaExiste
        },
        endpointsDisponibles: {
          cuotas: 'GET /api/cuotas',
          cuotaPorId: 'GET /api/cuotas/:id',
          cuotasPorPrestamo: 'GET /api/cuotas/prestamo/:prestamoId',
          generarCuotas: 'POST /api/cuotas/prestamo/:prestamoId/generar',
          registrarPago: 'POST /api/cuotas/:id/pago',
          cuotasVencidas: 'GET /api/cuotas/reportes/vencidas'
        }
      });
    } catch (error) {
      console.error('❌ Error en prueba de cuotas:', error);
      res.status(500).json({
        success: false,
        message: 'Error en prueba de cuotas',
        error: error.message
      });
    }
  });
}

// ========== MANEJO DE ERRORES 404 ==========
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    message: `🔍 Ruta no encontrada: ${req.method} ${req.originalUrl}`,
    sugerencia: 'Verifica la URL o consulta la documentación en GET /',
    timestamp: new Date().toISOString()
  });
});

// ========== MIDDLEWARE DE MANEJO DE ERRORES ==========
app.use((err, req, res, next) => {
  console.error('❌ Error:', err);
  
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Error interno del servidor',
    timestamp: new Date().toISOString(),
    ...(environment === 'development' && { 
      stack: err.stack,
      details: err 
    })
  });
});

module.exports = app;
