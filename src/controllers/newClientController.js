// src/controllers/newClientController.js - VERSIÓN CORREGIDA
const simpleNewClientService = require('../models/simpleNewClientService');

console.log('✅ newClientController cargado');

class NewClientController {
    
    // Endpoint para calificar cliente nuevo - VERSIÓN CORREGIDA
    async rateNewClient(req, res) {
        try {
            console.log('🌐 API Call: POST /api/ratings/new-client');
            
            // Verificar que hay cuerpo en la solicitud
            if (!req.body || Object.keys(req.body).length === 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Se requiere un cuerpo JSON en la solicitud',
                    ejemplo: {
                        nombre: 'Juan Pérez',
                        ingresoMensual: 15000,
                        antiguedadLaboralMeses: 12
                    }
                });
            }
            
            const clientData = req.body;
            console.log('📥 Datos recibidos:', JSON.stringify(clientData, null, 2));
            
            // Validar que los datos sean un objeto
            if (typeof clientData !== 'object') {
                return res.status(400).json({
                    success: false,
                    message: 'Los datos deben ser un objeto JSON',
                    tipoRecibido: typeof clientData
                });
            }
            
            // Validar datos mínimos con mensajes claros
            const errores = [];
            
            if (!clientData.nombre) {
                errores.push('El campo "nombre" es requerido');
            }
            
            if (!clientData.ingresoMensual) {
                errores.push('El campo "ingresoMensual" es requerido');
            } else if (isNaN(Number(clientData.ingresoMensual))) {
                errores.push('El campo "ingresoMensual" debe ser un número');
            } else if (Number(clientData.ingresoMensual) <= 0) {
                errores.push('El campo "ingresoMensual" debe ser mayor a 0');
            }
            
            if (!clientData.antiguedadLaboralMeses) {
                errores.push('El campo "antiguedadLaboralMeses" es requerido');
            } else if (isNaN(Number(clientData.antiguedadLaboralMeses))) {
                errores.push('El campo "antiguedadLaboralMeses" debe ser un número');
            } else if (Number(clientData.antiguedadLaboralMeses) < 0) {
                errores.push('El campo "antiguedadLaboralMeses" no puede ser negativo');
            }
            
            if (errores.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: 'Error en los datos de entrada',
                    errores: errores,
                    ejemploCompleto: {
                        nombre: 'MARÍA GARCÍA',
                        ingresoMensual: 18000,
                        gastosMensuales: 9000,
                        antiguedadLaboralMeses: 18,
                        montoSolicitado: 25000
                    }
                });
            }
            
            // Preparar datos para el servicio
            const datosProcesados = {
                nombre: String(clientData.nombre).trim(),
                ingresoMensual: Number(clientData.ingresoMensual),
                gastosMensuales: clientData.gastosMensuales ? Number(clientData.gastosMensuales) : 0,
                antiguedadLaboralMeses: Number(clientData.antiguedadLaboralMeses),
                montoSolicitado: clientData.montoSolicitado ? Number(clientData.montoSolicitado) : 0
            };
            
            console.log('📊 Datos procesados:', datosProcesados);
            
            // Calificar cliente
            const rating = await simpleNewClientService.rateNewClientSimple(datosProcesados);
            
            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                ...rating
            });
            
        } catch (error) {
            console.error('❌ Error en rateNewClient:', error);
            console.error('Stack trace:', error.stack);
            
            res.status(500).json({
                success: false,
                message: error.message || 'Error interno del servidor',
                timestamp: new Date().toISOString(),
                // Solo mostrar stack en desarrollo
                ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
            });
        }
    }
    
    // Endpoint de prueba - VERSIÓN SIMPLIFICADA
    async testNewClientRating(req, res) {
        try {
            console.log('🧪 Probando sistema de calificación para clientes nuevos');
            
            res.json({
                success: true,
                message: '✅ Sistema de calificación para clientes nuevos funcionando',
                timestamp: new Date().toISOString(),
                instrucciones: {
                    metodo: 'POST',
                    endpoint: '/api/ratings/new-client',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    cuerpoEjemplo: {
                        nombre: 'CARLOS LÓPEZ',
                        ingresoMensual: 20000,
                        antiguedadLaboralMeses: 24,
                        gastosMensuales: 12000,
                        montoSolicitado: 30000
                    }
                },
                pruebaRapida: 'Usa Postman o curl con el ejemplo anterior'
            });
            
        } catch (error) {
            console.error('❌ Error en testNewClientRating:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
    
    // Nuevo endpoint: Prueba con datos de ejemplo
    async testWithExample(req, res) {
        try {
            console.log('🧪 Ejecutando prueba con datos de ejemplo');
            
            // Datos de ejemplo predefinidos
            const ejemploCliente = {
                nombre: 'EJEMPLO CLIENTE',
                ingresoMensual: 18000,
                gastosMensuales: 9000,
                antiguedadLaboralMeses: 18,
                montoSolicitado: 25000
            };
            
            const resultado = await simpleNewClientService.rateNewClientSimple(ejemploCliente);
            
            res.json({
                success: true,
                message: '✅ Prueba con datos de ejemplo completada',
                timestamp: new Date().toISOString(),
                datosUsados: ejemploCliente,
                resultado: resultado
            });
            
        } catch (error) {
            console.error('❌ Error en testWithExample:', error);
            res.status(500).json({
                success: false,
                message: error.message
            });
        }
    }
}

module.exports = new NewClientController();