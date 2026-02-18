const ratingService = require('../models/ratingService');

class RatingController {
    
    // Obtener calificación DETALLADA de un cliente
    async getClientRating(req, res) {
        try {
            const { nombre } = req.params;
            const { formato = 'completo' } = req.query; // 'completo' o 'resumido'
            
            console.log(`🌐 API Call: getClientRating for ${nombre} (formato: ${formato})`);
            
            if (!nombre) {
                return res.status(400).json({
                    success: false,
                    message: 'Nombre del cliente es requerido'
                });
            }
            
            const rating = await ratingService.getClientRating(nombre, req.query);
            
            // Formatear respuesta según parámetro
            if (formato === 'resumido') {
                return res.json({
                    success: true,
                    timestamp: new Date().toISOString(),
                    resumen: {
                        nombre: rating.informacionCliente.nombre,
                        calificacion: rating.calificacionFinal.rating,
                        score: rating.calificacionFinal.score,
                        interpretacion: rating.calificacionFinal.interpretacion,
                        nivelRiesgo: rating.recomendaciones.nivelRiesgo,
                        totalPrestamos: rating.informacionCliente.totalPrestamos,
                        montoTotal: rating.metricas.resumen.totalSolicitado,
                        puntualidad: rating.metricas.desempeno.puntualidadPagos
                    }
                });
            }
            
            // Formato completo por defecto
            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                ...rating
            });
            
        } catch (error) {
            console.error('❌ Error en getClientRating:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Error al calcular calificación',
                timestamp: new Date().toISOString(),
                detalles: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    }
    
    // Obtener ranking DETALLADO
    async getAllClientsRanking(req, res) {
        try {
            const { limit = 50, formato = 'completo' } = req.query;
            
            console.log(`🌐 API Call: getAllClientsRanking (limit: ${limit}, formato: ${formato})`);
            
            const rankings = await ratingService.getAllClientsRanking(parseInt(limit));
            
            if (formato === 'simple') {
                return res.json({
                    success: true,
                    count: rankings.length,
                    timestamp: new Date().toISOString(),
                    data: rankings.map(item => ({
                        posicion: item.posicion,
                        nombre: item.nombre,
                        calificacion: item.calificacion,
                        score: item.score
                    }))
                });
            }
            
            // Formato completo
            res.json({
                success: true,
                count: rankings.length,
                timestamp: new Date().toISOString(),
                metadata: {
                    totalAnalizado: rankings.length,
                    fechaAnalisis: new Date().toISOString(),
                    criteriosOrden: 'Score descendente',
                    topCalificaciones: this.getTopRatings(rankings)
                },
                data: rankings
            });
            
        } catch (error) {
            console.error('❌ Error en getAllClientsRanking:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Error al generar ranking',
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Endpoint de prueba DETALLADO
    async testRatingSystem(req, res) {
        try {
            console.log('🧪 Iniciando prueba DETALLADA del sistema de rating...');
            
            // Test con un cliente específico para mostrar cálculo completo
            const testClient = 'ALFREDO FAURE';
            
            let testResult;
            try {
                testResult = await ratingService.getClientRating(testClient);
            } catch (error) {
                testResult = { error: error.message };
            }
            
            res.json({
                success: true,
                message: '✅ Sistema de Rating funcionando con cálculos detallados',
                timestamp: new Date().toISOString(),
                demostracion: {
                    clienteEjemplo: testClient,
                    resultado: testResult.error ? testResult : {
                        calificacion: testResult.calificacionFinal.rating,
                        score: testResult.calificacionFinal.score,
                        factores: testResult.calculos.desglosePuntajes.factores
                    }
                },
                endpoints: {
                    getClientRating: {
                        url: 'GET /api/ratings/client/{nombre}',
                        parametros: '?formato=completo|resumido',
                        ejemplo: '/api/ratings/client/ALFREDO%20FAURE?formato=completo'
                    },
                    getAllRankings: {
                        url: 'GET /api/ratings/ranking',
                        parametros: '?limit=50&formato=completo|simple',
                        ejemplo: '/api/ratings/ranking?limit=10&formato=simple'
                    },
                    test: 'GET /api/ratings/test'
                },
                caracteristicas: [
                    'Cálculos detallados paso a paso',
                    'Desglose de puntajes por factor',
                  'Datos crudos utilizados',
                  'Justificación de calificación',
                  'Recomendaciones específicas',
                  'Nivel de confianza del análisis'
                ]
            });
            
        } catch (error) {
            console.error('❌ Error en testRatingSystem:', error);
            res.status(500).json({
                success: false,
                message: 'Error en prueba del sistema',
                error: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }
    
    // Método auxiliar para estadísticas del ranking
    getTopRatings(rankings) {
        const counts = {};
        rankings.forEach(item => {
            counts[item.calificacion] = (counts[item.calificacion] || 0) + 1;
        });
        
        return {
            distribucion: counts,
            mejorCalificado: rankings[0] || null,
            promedioScore: rankings.length > 0 ? 
                (rankings.reduce((sum, item) => sum + item.score, 0) / rankings.length).toFixed(1) : 0
        };
    }
}

module.exports = new RatingController();
