// src/services/ratingService.js - VERSIÓN CON CÁLCULOS DETALLADOS
console.log('🔄 Cargando ratingService.js (versión detallada)...');

let sequelize;
try {
    const models = require('../models');
    sequelize = models.sequelize;
    console.log('✅ Sequelize importado:', !!sequelize);
} catch (error) {
    console.error('❌ Error importando sequelize:', error.message);
    sequelize = null;
}

class RatingService {
    
    // Función principal CON CÁLCULOS DETALLADOS
    async getClientRating(nombre, input = {}) {
        try {
            console.log(`📊 RatingService: calculando calificación DETALLADA para ${nombre}`);
            
            if (!sequelize) {
                throw new Error('Sequelize no disponible');
            }
            
            // 1. Obtener todos los préstamos del cliente desde tabla prestamos
            const prestamos = await this.getClientLoans(nombre);

            const timestamp = new Date().toISOString();
            const requestId = `ANL-RET-${Date.now()}`;
            const montoSolicitadoActual = input?.montoSolicitado ? parseFloat(input.montoSolicitado) : null;

            if (prestamos.length === 0) {
                return {
                    success: true,
                    timestamp,
                    resumen: {
                        scoreFinal: 0,
                        decision: 'RECHAZADO',
                        aprobado: false,
                        riesgoTotal: 'ALTO',
                        colorRiesgo: '#EF4444'
                    },
                    inputsOriginales: {
                        prestamosPrevios: 0,
                        prestamosPagados: 0,
                        prestamosEnMora: 0,
                        diasMoraMax: 0,
                        diasMoraPromedio: 0,
                        puntualidadPct: 0,
                        ultimoPrestamoStatus: 'SIN_HISTORIAL',
                        tiempoDesdeUltimoPrestamoMeses: null
                    },
                    precalculos: {
                        plazoMeses: null,
                        ratioGarantia: null,
                        cuotaEstimadaMensual: null,
                        ratioCuotaIngresoMensual: null,
                        historial: {
                            tasaMoraHistorica: 0,
                            puntualidadPct: 0,
                            diasMoraPromedio: 0,
                            diasMoraMax: 0,
                            recencia: {
                                tiempoDesdeUltimoPrestamoMeses: null,
                                interpretacion: 'Sin historial'
                            }
                        },
                        flags: {
                            tuvoMora: false,
                            moraAlta: false,
                            ultimoPrestamoPagado: false,
                            puntualidadAlta: false
                        }
                    },
                    gates: {
                        hardRules: [],
                        softRules: []
                    },
                    scorecard: {
                        pesos: {
                            historialPago: 40,
                            capacidadPago: 25,
                            comportamientoUso: 15,
                            garantia: 10,
                            congruenciaMontoPlazo: 10
                        },
                        detalleBloques: [],
                        normalizacion: {
                            puntosFinal: 0,
                            metodo: 'SUMA_PONDERADA'
                        }
                    },
                    consideraciones: {
                        factoresMasPositivos: [],
                        factoresMasNegativos: [
                            {
                                factor: 'SIN_HISTORIAL',
                                detalle: 'No hay préstamos previos registrados',
                                severidad: 'ALTA'
                            }
                        ],
                        razonDeDecision: 'No existe historial para evaluar comportamiento de pago.'
                    },
                    decisionPolicy: {
                        tipo: 'RECHAZO_AUTOMATICO',
                        aplicaCondiciones: false,
                        condiciones: []
                    },
                    contraofertas: [],
                    auditoria: {
                        inputsFaltantes: ['diasMoraMax', 'diasMoraPromedio'],
                        warnings: ['Cliente sin historial en tabla prestamos'],
                        traceId: `trace-${requestId}`,
                        elapsedMs: 0
                    }
                };
            }

            console.log(`📊 Encontrados ${prestamos.length} préstamos para ${nombre}`);

            const now = Date.now();
            const prestamosPrevios = prestamos.length;
            const prestamosPagados = prestamos.filter(p => (p.status || '').toUpperCase() === 'PAGADO').length;
            const prestamosEnMora = prestamos.filter(p => {
                const status = (p.status || '').toUpperCase();
                const pendiente = parseFloat(p.pendiente) || 0;
                const pagosPendientes = parseFloat(p.pagos_pendientes) || 0;
                const moraPorStatus = ['MORA', 'VENCIDO', 'EN_MORA', 'MOROSO'].includes(status);
                const moraPorSaldo = pendiente > 0 && pagosPendientes > 0 && status !== 'PAGADO';
                return moraPorStatus || moraPorSaldo;
            }).length;
            const ultimoPrestamo = prestamos[0];

            const totalPagos = prestamos.reduce((sum, p) => sum + (parseFloat(p.pagos_hechos) || 0) + (parseFloat(p.pagos_pendientes) || 0), 0);
            const pagosHechos = prestamos.reduce((sum, p) => sum + (parseFloat(p.pagos_hechos) || 0), 0);
            const puntualidadPct = totalPagos > 0 ? pagosHechos / totalPagos : 0;

            const tiempoDesdeUltimoPrestamoMeses = ultimoPrestamo?.fecha_inicio
                ? Math.round((now - new Date(ultimoPrestamo.fecha_inicio).getTime()) / (1000 * 60 * 60 * 24 * 30))
                : null;

            const tasaMoraHistorica = prestamosPrevios > 0 ? prestamosEnMora / prestamosPrevios : 0;

            const completionRate = prestamosPrevios > 0 ? prestamosPagados / prestamosPrevios : 0;
            const scoreHistorial = Math.max(0, Math.min(40, Math.round(40 * (0.7 * puntualidadPct + 0.3 * (1 - tasaMoraHistorica)))));

            const promedioMonto = prestamosPrevios > 0
                ? prestamos.reduce((sum, p) => sum + (parseFloat(p.monto_solicitado) || 0), 0) / prestamosPrevios
                : 0;
            const promedioSemanas = prestamosPrevios > 0
                ? prestamos.reduce((sum, p) => sum + (parseFloat(p.num_semanas) || 0), 0) / prestamosPrevios
                : 0;
            const promedioPagoSemanal = prestamosPrevios > 0
                ? prestamos.reduce((sum, p) => sum + (parseFloat(p.pagos_semanales) || 0), 0) / prestamosPrevios
                : 0;
            const ratioPagoMonto = promedioMonto > 0 ? promedioPagoSemanal / promedioMonto : 0;
            const ratioPagoMontoNormalizado = Math.max(0, Math.min(1, ratioPagoMonto * 4.33)); // aproximación mensual
            const scoreCapacidad = Math.max(0, Math.min(25, Math.round(25 * ratioPagoMontoNormalizado)));

            const scoreComportamientoBase = prestamosPrevios >= 3 ? 1 : prestamosPrevios / 3;
            const recenciaFactor = tiempoDesdeUltimoPrestamoMeses === null
                ? 0
                : tiempoDesdeUltimoPrestamoMeses <= 6
                    ? 1
                    : tiempoDesdeUltimoPrestamoMeses <= 12
                        ? 0.6
                        : 0.2;
            const scoreComportamiento = Math.max(0, Math.min(15, Math.round(15 * (0.6 * scoreComportamientoBase + 0.4 * recenciaFactor))));
            const scoreGarantia = 0;
            const ratioMontoHistorico = montoSolicitadoActual && promedioMonto > 0 ? montoSolicitadoActual / promedioMonto : null;
            const scoreCongruencia = ratioMontoHistorico === null
                ? 0
                : ratioMontoHistorico <= 1
                    ? 10
                    : ratioMontoHistorico <= 1.5
                        ? 7
                        : ratioMontoHistorico <= 2
                            ? 4
                            : 0;

            const scoreFinal = scoreHistorial + scoreCapacidad + scoreComportamiento + scoreGarantia + scoreCongruencia;

            const decision = scoreFinal >= 70 ? 'APROBADO' : scoreFinal >= 55 ? 'APROBADO_CONDICIONES' : 'RECHAZADO';
            const aprobado = scoreFinal >= 55;
            const riesgoTotal = scoreFinal >= 70 ? 'BAJO' : scoreFinal >= 55 ? 'MODERADO' : 'ALTO';
            const colorRiesgo = scoreFinal >= 70 ? '#10B981' : scoreFinal >= 55 ? '#F59E0B' : '#EF4444';

            return {
                success: true,
                timestamp,
                resumen: {
                    scoreFinal,
                    decision,
                    aprobado,
                    riesgoTotal,
                    colorRiesgo
                },
                precalculos: {
                    plazoMeses: null,
                    ratioGarantia: null,
                    cuotaEstimadaMensual: null,
                    ratioCuotaIngresoMensual: null,
                    historial: {
                        tasaMoraHistorica: parseFloat(tasaMoraHistorica.toFixed(4)),
                        puntualidadPct: parseFloat(puntualidadPct.toFixed(2)),
                        diasMoraPromedio: 0,
                        diasMoraMax: 0,
                        recencia: {
                            tiempoDesdeUltimoPrestamoMeses,
                            interpretacion: tiempoDesdeUltimoPrestamoMeses === null ? 'Sin historial' : tiempoDesdeUltimoPrestamoMeses <= 6 ? 'Reciente' : 'No reciente'
                        }
                    },
                    plazoRecomendadoSemanas: promedioSemanas ? Math.round(promedioSemanas) : null,
                    montoSolicitadoActual: montoSolicitadoActual,
                    flags: {
                        tuvoMora: prestamosEnMora > 0,
                        moraAlta: tasaMoraHistorica > 0.25,
                        ultimoPrestamoPagado: (ultimoPrestamo?.status || '').toUpperCase() === 'PAGADO',
                        puntualidadAlta: puntualidadPct >= 0.85
                    }
                },
                gates: {
                    hardRules: [
                        {
                            id: 'HR-100',
                            rule: "ultimoPrestamoStatus != 'DEFAULT'",
                            passed: true,
                            value: (ultimoPrestamo?.status || 'DESCONOCIDO').toUpperCase(),
                            descripcion: 'Clientes con default previo se rechazan automáticamente'
                        },
                        {
                            id: 'HR-101',
                            rule: 'diasMoraMax <= 60',
                            passed: true,
                            value: 0,
                            descripcion: 'Mora extrema bloquea automáticamente'
                        }
                    ],
                    softRules: [
                        {
                            id: 'SR-120',
                            rule: 'tasaMoraHistorica <= 0.25',
                            passed: tasaMoraHistorica <= 0.25,
                            value: parseFloat(tasaMoraHistorica.toFixed(4)),
                            impacto: 'MEDIO',
                            accionSugerida: 'Aprobar con condiciones (garantía/menor monto)'
                        }
                    ]
                },
                scorecard: {
                    pesos: {
                        historialPago: '40 pts',
                        capacidadPago: '25 pts',
                        comportamientoUso: '15 pts',
                        garantia: '10 pts',
                        congruenciaMontoPlazo: '10 pts'
                    },
                    detalleBloques: [
                        {
                            bloque: 'HISTORIAL_PAGO',
                            puntos: scoreHistorial,
                            maxPuntos: 40,
                            subcalculos: {
                                puntualidadPct: parseFloat(puntualidadPct.toFixed(2)),
                                diasMoraPromedio: 0,
                                diasMoraMax: 0,
                                tasaMoraHistorica: parseFloat(tasaMoraHistorica.toFixed(4))
                            },
                            explicacion: 'Score calculado con puntualidad y tasa de mora histórica.'
                        },
                        {
                            bloque: 'CAPACIDAD_PAGO',
                            puntos: scoreCapacidad,
                            maxPuntos: 25,
                            subcalculos: {
                                promedioMontoSolicitado: parseFloat(promedioMonto.toFixed(2)),
                                promedioPagoSemanal: parseFloat(promedioPagoSemanal.toFixed(2)),
                                ratioPagoMonto: parseFloat(ratioPagoMonto.toFixed(4))
                            },
                            explicacion: 'Capacidad aproximada basada en pagos semanales vs monto promedio.'
                        },
                        {
                            bloque: 'COMPORTAMIENTO_USO',
                            puntos: scoreComportamiento,
                            maxPuntos: 15,
                            subcalculos: {
                                prestamosPrevios,
                                tiempoDesdeUltimoPrestamoMeses,
                                ultimoPrestamoStatus: (ultimoPrestamo?.status || 'DESCONOCIDO').toUpperCase()
                            },
                            explicacion: 'Mayor historial y recencia elevan el puntaje.'
                        },
                        {
                            bloque: 'GARANTIA',
                            puntos: scoreGarantia,
                            maxPuntos: 10,
                            subcalculos: {
                                ratioGarantia: null
                            },
                            explicacion: 'No se recibió información de garantía.'
                        },
                        
                    ],
                    normalizacion: undefined
                },
                consideraciones: {
                    factoresMasPositivos: [
                        { factor: 'PUNTUALIDAD', detalle: `${(puntualidadPct * 100).toFixed(1)}% de pagos puntuales` }
                    ],
                    factoresMasNegativos: [
                        { factor: 'ANTECEDENTE_MORA', detalle: `${prestamosEnMora} préstamos en mora`, severidad: 'MEDIA' }
                    ],
                    razonDeDecision: 'Decisión basada en historial y puntualidad disponible en prestamos.'
                },
                decisionPolicy: {
                    tipo: decision === 'APROBADO' ? 'APROBACION_DIRECTA' : decision === 'APROBADO_CONDICIONES' ? 'APROBACION_CONDICIONES' : 'RECHAZO',
                    aplicaCondiciones: decision === 'APROBADO_CONDICIONES',
                    condiciones: decision === 'APROBADO_CONDICIONES' ? ['Revisión adicional de ingresos', 'Considerar garantía'] : []
                },
                contraofertas: [
                    {
                        escenario: 'Monto reducido',
                        montoSugerido: Math.round(promedioMonto * 0.9),
                        plazoSemanas: null,
                        impactoEsperado: 'Alinear monto con historial promedio'
                    },
                    {
                        escenario: 'Monto histórico promedio',
                        montoSugerido: Math.round(promedioMonto),
                        plazoSemanas: null,
                        impactoEsperado: 'Reducir riesgo manteniendo conducta histórica'
                    },
                    {
                        escenario: 'Plazo recomendado por historial',
                        montoSugerido: montoSolicitadoActual ? Math.round(montoSolicitadoActual) : Math.round(promedioMonto),
                        plazoSemanas: promedioSemanas ? Math.round(promedioSemanas) : null,
                        impactoEsperado: 'Ajustar plazo a comportamiento histórico'
                    }
                ],
                auditoria: {
                    inputsFaltantes: [
                        'diasMoraMax',
                        'diasMoraPromedio',
                        'ingresosMensuales',
                        montoSolicitadoActual ? null : 'montoSolicitado',
                        'garantia'
                    ].filter(Boolean),
                    warnings: [
                        'Historial sin campos de mora en días; valores fijados en 0',
                        'No se recibieron ingresos/monto/garantía para cálculo completo'
                    ],
                    traceId: `trace-${requestId}`,
                    elapsedMs: 0
                }
            };
            
        } catch (error) {
            console.error('❌ Error en RatingService.getClientRating:', error);
            throw new Error(`Error calculando calificación: ${error.message}`);
        }
    }
    
    // Obtener préstamos del cliente
    async getClientLoans(nombre) {
        try {
            console.log(`📋 Buscando préstamos para: ${nombre}`);

            const queryText = `
                SELECT 
                    id,
                    solicitud_id,
                    fecha_inicio,
                    mes,
                    anio,
                    nombre_completo,
                    monto_solicitado,
                    interes,
                    modalidad,
                    num_semanas,
                    num_dias,
                    fecha_vencimiento,
                    total_pagar,
                    pagos_semanales,
                    pagos_hechos,
                    pagos_pendientes,
                    pagado,
                    status,
                    pendiente
                FROM prestamos
                WHERE nombre_completo ILIKE $1
                ORDER BY fecha_inicio DESC
            `;

            const prestamos = await sequelize.query(queryText, {
                bind: [`%${nombre}%`],
                type: sequelize.QueryTypes.SELECT
            });
            
            console.log(`✅ Encontrados ${prestamos.length} préstamos`);
            return prestamos;
            
        } catch (error) {
            console.error('❌ Error en getClientLoans:', error);
            throw error;
        }
    }
    
    // Calcular métricas CON DETALLES
    calculateMetricsDetailed(prestamos) {
        console.log(`📈 Calculando métricas DETALLADAS para ${prestamos.length} préstamos`);
        
        const calculosDetallados = {
            prestamosAnalizados: [],
            sumatorias: {},
            promedios: {}
        };
        
        let totalBorrowed = 0;
        let totalPaid = 0;
        let totalInterest = 0;
        let totalTerm = 0;
        let onTimePayments = 0;
        let totalPayments = 0;
        let defaultedLoans = 0;
        let activeLoans = 0;
        let completedLoans = 0;
        
        // Analizar cada préstamo individualmente
        prestamos.forEach((prestamo, index) => {
            const analisisPrestamo = {
                numero: index + 1,
                fecha: prestamo.fecha,
                monto: parseFloat(prestamo.monto_solicitado) || 0,
                interes: parseFloat(prestamo.interes) || 0,
                pagosHechos: parseInt(prestamo.pagos_hechos) || 0,
                pagosPendientes: parseInt(prestamo.pagos_pendientes) || 0,
                pagado: parseFloat(prestamo.pagado) || 0,
                estatus: prestamo.estatus || '',
                dias: prestamo.dias || 0,
                semanas: prestamo.semanas || 0,
                plazoCalculado: prestamo.dias > 0 ? prestamo.dias : (prestamo.semanas * 7),
                completado: prestamo.estatus?.includes('NO DEBE NADA') || (parseInt(prestamo.pagos_pendientes) || 0) === 0,
                enMora: (parseInt(prestamo.pagos_pendientes) || 0) > 0
            };
            
            // Acumular valores
            totalBorrowed += analisisPrestamo.monto;
            totalPaid += analisisPrestamo.pagado;
            totalInterest += analisisPrestamo.interes;
            totalTerm += analisisPrestamo.plazoCalculado;
            
            const totalCuotas = analisisPrestamo.pagosHechos + analisisPrestamo.pagosPendientes;
            totalPayments += totalCuotas;
            
            if (analisisPrestamo.completado) {
                onTimePayments += analisisPrestamo.pagosHechos;
                completedLoans++;
            }
            
            if (analisisPrestamo.enMora) {
                defaultedLoans++;
                activeLoans++;
            } else if (!analisisPrestamo.completado) {
                activeLoans++;
            }
            
            calculosDetallados.prestamosAnalizados.push(analisisPrestamo);
        });
        
        // Calcular métricas finales
        const metrics = {
            totalBorrowed: parseFloat(totalBorrowed.toFixed(2)),
            totalPaid: parseFloat(totalPaid.toFixed(2)),
            avgInterest: prestamos.length > 0 ? parseFloat((totalInterest / prestamos.length).toFixed(3)) : 0,
            avgTerm: prestamos.length > 0 ? Math.round(totalTerm / prestamos.length) : 0,
            paymentPunctuality: totalPayments > 0 ? parseFloat((onTimePayments / totalPayments).toFixed(3)) : 1,
            defaultRate: prestamos.length > 0 ? parseFloat((defaultedLoans / prestamos.length).toFixed(3)) : 0,
            loanCount: prestamos.length,
            avgLoanAmount: prestamos.length > 0 ? parseFloat((totalBorrowed / prestamos.length).toFixed(2)) : 0,
            completedLoans,
            activeLoans,
            completionRate: prestamos.length > 0 ? parseFloat((completedLoans / prestamos.length).toFixed(3)) : 0,
            totalPayments,
            onTimePayments
        };
        
        // Guardar sumatorias para mostrar
        calculosDetallados.sumatorias = {
            totalSolicitado: totalBorrowed,
            totalPagado: totalPaid,
            totalIntereses: totalInterest,
            totalPlazoDias: totalTerm,
            pagosPuntuales: onTimePayments,
            pagosTotales: totalPayments,
            prestamosCompletados: completedLoans,
            prestamosEnMora: defaultedLoans
        };
        
        calculosDetallados.promedios = {
            montoPromedio: metrics.avgLoanAmount,
            interesPromedio: metrics.avgInterest,
            plazoPromedioDias: metrics.avgTerm,
            puntualidad: metrics.paymentPunctuality
        };
        
        console.log('📊 Métricas calculadas con detalles');
        return { metrics, calculosDetallados };
    }
    
    // Calcular score CON DESGLOSE
    calculateScoreDetailed(metrics) {
        console.log('🧮 Calculando score con desglose detallado');
        
        // FACTOR 1: Puntualidad de pagos (35%)
        const puntualidadBase = metrics.paymentPunctuality * 100;
        const puntajePuntualidad = (puntualidadBase * 0.35);
        
        // FACTOR 2: Tasa de completitud (20%)
        const completitudBase = metrics.completionRate * 100;
        const puntajeCompletitud = (completitudBase * 0.20);
        
        // FACTOR 3: Historial de préstamos (15%)
        const historialBase = Math.min(100, metrics.loanCount * 10); // Máximo 10 préstamos = 100%
        const puntajeHistorial = (historialBase * 0.15);
        
        // FACTOR 4: Monto promedio (5%) - Menor monto = mejor
        const montoBase = Math.max(0, 100 - (metrics.avgLoanAmount / 100)); // $10,000 = 0%
        const puntajeMonto = (montoBase * 0.05);
        
        // FACTOR 5: Penalización por morosidad (25%)
        const morosidadBase = metrics.defaultRate * 100;
        const penalizacionMorosidad = (morosidadBase * 0.25);
        
        // Cálculo final
        const scoreBase = puntajePuntualidad + puntajeCompletitud + puntajeHistorial + puntajeMonto;
        const scoreFinal = Math.max(0, Math.min(100, scoreBase - penalizacionMorosidad));
        
        const desglosePuntajes = {
            factores: {
                puntualidad: {
                    valorBase: puntualidadBase,
                    peso: '35%',
                    puntaje: puntajePuntualidad,
                    interpretacion: this.getPunctualityInterpretation(metrics.paymentPunctuality)
                },
                completitud: {
                    valorBase: completitudBase,
                    peso: '20%',
                    puntaje: puntajeCompletitud,
                    interpretacion: this.getCompletionInterpretation(metrics.completionRate)
                },
                historial: {
                    valorBase: historialBase,
                    peso: '15%',
                    puntaje: puntajeHistorial,
                    interpretacion: this.getHistoryInterpretation(metrics.loanCount)
                },
                monto: {
                    valorBase: montoBase,
                    peso: '5%',
                    puntaje: puntajeMonto,
                    interpretacion: this.getAmountInterpretation(metrics.avgLoanAmount)
                },
                morosidad: {
                    valorBase: morosidadBase,
                    peso: '25%',
                    penalizacion: penalizacionMorosidad,
                    interpretacion: this.getDefaultInterpretation(metrics.defaultRate)
                }
            },
            calculo: {
                puntajeBase: scoreBase,
                penalizacionTotal: penalizacionMorosidad,
                puntajeFinal: scoreFinal,
                formula: `(Puntualidad × 0.35) + (Completitud × 0.20) + (Historial × 0.15) + (Monto × 0.05) - (Morosidad × 0.25)`
            }
        };
        
        console.log(`🧮 Score final: ${scoreFinal.toFixed(1)}`);
        return { score: scoreFinal, desglosePuntajes };
    }
    
    // Asignar calificación con justificación
    assignRatingWithJustification(score, desglosePuntajes) {
        let rating;
        let justificacion;
        
        if (score >= 90) {
            rating = 'AAA';
            justificacion = 'Excelente historial crediticio. Puntualidad superior al 95%, todos los préstamos completados y mínima morosidad.';
        } else if (score >= 80) {
            rating = 'AA';
            justificacion = 'Muy buen historial crediticio. Alta puntualidad (>85%), mayoría de préstamos completados y baja morosidad.';
        } else if (score >= 70) {
            rating = 'A';
            justificacion = 'Buen historial crediticio. Puntualidad aceptable (>75%), buena tasa de completitud y morosidad controlada.';
        } else if (score >= 60) {
            rating = 'BBB';
            justificacion = 'Historial crediticio adecuado. Puntualidad moderada (>65%), algunos préstamos pendientes, morosidad dentro de límites aceptables.';
        } else if (score >= 50) {
            rating = 'BB';
            justificacion = 'Historial crediticio especulativo. Puntualidad irregular (>55%), significativa morosidad o préstamos pendientes.';
        } else if (score >= 40) {
            rating = 'B';
            justificacion = 'Alto riesgo crediticio. Baja puntualidad (<55%), alta morosidad o múltiples préstamos en incumplimiento.';
        } else if (score >= 30) {
            rating = 'CCC';
            justificacion = 'Riesgo crediticio muy alto. Muy baja puntualidad (<45%), morosidad significativa y patrón de incumplimiento.';
        } else if (score >= 20) {
            rating = 'CC';
            justificacion = 'Riesgo crediticio extremadamente alto. Incumplimiento frecuente, muy baja puntualidad y alta morosidad.';
        } else if (score >= 10) {
            rating = 'C';
            justificacion = 'En incumplimiento o cerca del mismo. Historial crediticio muy pobre con múltiples problemas.';
        } else {
            rating = 'D';
            justificacion = 'En incumplimiento. Historial crediticio muy problemático que requiere intervención inmediata.';
        }
        
        return { 
            rating, 
            justificacion,
            rangoScore: this.getScoreRange(rating)
        };
    }
    
    // Calcular confianza con factores
    calculateConfidenceDetailed(prestamos, metrics) {
        let confidence = 1.0;
        const factores = [];
        
        // Factor 1: Cantidad de préstamos
        if (prestamos.length >= 10) {
            confidence *= 1.0;
            factores.push({ factor: 'Muestra amplia', impacto: 'Neutro', valor: '≥10 préstamos' });
        } else if (prestamos.length >= 5) {
            confidence *= 0.9;
            factores.push({ factor: 'Muestra moderada', impacto: '-10%', valor: '5-9 préstamos' });
        } else if (prestamos.length >= 3) {
            confidence *= 0.8;
            factores.push({ factor: 'Muestra limitada', impacto: '-20%', valor: '3-4 préstamos' });
        } else {
            confidence *= 0.6;
            factores.push({ factor: 'Muestra insuficiente', impacto: '-40%', valor: '<3 préstamos' });
        }
        
        // Factor 2: Completitud de datos
        const datosCompletos = prestamos.filter(p => 
            p.monto_solicitado && 
            p.interes && 
            (p.pagos_hechos !== null || p.pagos_pendientes !== null)
        ).length / prestamos.length;
        
        if (datosCompletos >= 0.9) {
            confidence *= 1.0;
            factores.push({ factor: 'Datos completos', impacto: 'Neutro', valor: '≥90% completos' });
        } else if (datosCompletos >= 0.7) {
            confidence *= 0.95;
            factores.push({ factor: 'Datos casi completos', impacto: '-5%', valor: '70-89% completos' });
        } else {
            confidence *= 0.85;
            factores.push({ factor: 'Datos incompletos', impacto: '-15%', valor: '<70% completos' });
        }
        
        // Factor 3: Antigüedad del historial
        const mesesHistorial = this.getHistoryMonths(prestamos);
        if (mesesHistorial >= 12) {
            confidence *= 1.0;
            factores.push({ factor: 'Historial largo', impacto: 'Neutro', valor: '≥12 meses' });
        } else if (mesesHistorial >= 6) {
            confidence *= 0.9;
            factores.push({ factor: 'Historial moderado', impacto: '-10%', valor: '6-11 meses' });
        } else {
            confidence *= 0.8;
            factores.push({ factor: 'Historial corto', impacto: '-20%', valor: '<6 meses' });
        }
        
        return { 
            confidence: parseFloat(Math.min(1, confidence).toFixed(2)),
            factoresConfianza: factores 
        };
    }
    
    // Preparar datos crudos para mostrar
    prepareRawData(prestamos) {
        return prestamos.slice(0, 10).map(p => ({
            fecha: p.fecha,
            monto: p.monto_solicitado,
            interes: p.interes,
            plazo: `${p.dias || p.semanas * 7} días`,
            pagosHechos: p.pagos_hechos,
            pagosPendientes: p.pagos_pendientes,
            pagado: p.pagado,
            estatus: p.estatus,
            modalidad: p.modalidad
        }));
    }
    
    // Generar recomendaciones detalladas
    generateDetailedRecommendations(rating, metrics, desglosePuntajes) {
        const acciones = [];
        const limites = [];
        const condiciones = [];
        
        switch(rating) {
            case 'AAA':
                acciones.push('Ofrecer tasas preferenciales (reducción del 20-30%)');
                acciones.push('Aumentar límite de crédito en 50%');
                acciones.push('Procesamiento exprés de solicitudes');
                limites.push('Límite máximo: 5x el monto promedio actual');
                limites.push('Plazo máximo: 90 días');
                condiciones.push('Sin garantías adicionales requeridas');
                condiciones.push('Renovación automática disponible');
                break;
                
            case 'AA':
                acciones.push('Ofrecer tasas competitivas (reducción del 10-20%)');
                acciones.push('Aumentar límite de crédito en 30%');
                limites.push('Límite máximo: 3x el monto promedio actual');
                limites.push('Plazo máximo: 60 días');
                condiciones.push('Garantía simple opcional');
                break;
                
            case 'A':
                acciones.push('Mantener tasas estándar');
                acciones.push('Incremento gradual de límites');
                limites.push('Límite máximo: 2x el monto promedio actual');
                limites.push('Plazo máximo: 45 días');
                condiciones.push('Revisión trimestral de historial');
                break;
                
            case 'BBB':
                acciones.push('Monitoreo mensual de pagos');
                acciones.push('Tasas estándar sin descuentos');
                limites.push('Límite máximo: 1.5x el monto promedio actual');
                limites.push('Plazo máximo: 30 días');
                condiciones.push('Verificación de ingresos requerida');
                break;
                
            case 'BB':
            case 'B':
                acciones.push('Seguimiento semanal de pagos');
                acciones.push('Tasas incrementadas (10-20% adicional)');
                limites.push('Límite máximo: igual al monto promedio actual');
                limites.push('Plazo máximo: 14-21 días');
                condiciones.push('Garantía colateral requerida');
                condiciones.push('Verificación estricta de ingresos');
                break;
                
            default: // CCC, CC, C, D
                acciones.push('Evaluación caso por caso obligatoria');
                acciones.push('Tasas altas (30-50% adicional)');
                limites.push('Límite máximo: 50% del monto promedio actual');
                limites.push('Plazo máximo: 7-14 días');
                condiciones.push('Garantías sólidas obligatorias');
                condiciones.push('Pago adelantado del 20-30%');
                condiciones.push('Supervisión diaria en casos extremos');
        }
        
        // Recomendaciones específicas basadas en métricas débiles
        if (metrics.paymentPunctuality < 0.7) {
            acciones.push('IMPLEMENTAR: Recordatorios automáticos de pago');
            condiciones.push('REQUERIDO: Autorización débito automático');
        }
        
        if (metrics.defaultRate > 0.3) {
            acciones.push('IMPLEMENTAR: Plan de pagos estricto');
            condiciones.push('REQUERIDO: Aval o codeudor');
        }
        
        if (metrics.avgLoanAmount > 10000) {
            acciones.push('RECOMENDADO: Análisis de capacidad de pago detallado');
        }
        
        return { acciones, limites, condiciones };
    }
    
    // ========== MÉTODOS AUXILIARES ==========
    
    getRatingInterpretation(rating) {
        const interpretations = {
            'AAA': 'Calificación máxima - Riesgo mínimo. Cliente excelente con historial crediticio impecable.',
            'AA': 'Calificación muy alta - Riesgo muy bajo. Cliente muy confiable con historial sólido.',
            'A': 'Calificación alta - Riesgo bajo. Cliente confiable con buen historial.',
            'BBB': 'Calificación media - Riesgo moderado. Cliente aceptable con algunos aspectos a mejorar.',
            'BB': 'Calificación especulativa - Riesgo considerable. Cliente con historial irregular.',
            'B': 'Calificación baja - Alto riesgo. Cliente con problemas de cumplimiento.',
            'CCC': 'Calificación muy baja - Riesgo muy alto. Cliente vulnerable con múltiples incumplimientos.',
            'CC': 'Calificación extremadamente baja - Riesgo extremo. Alto riesgo de incumplimiento.',
            'C': 'Cerca del incumplimiento - Riesgo crítico. Historial crediticio muy problemático.',
            'D': 'En incumplimiento - Máximo riesgo. Cliente actualmente en mora o incumplimiento.'
        };
        return interpretations[rating] || 'Calificación no determinada.';
    }
    
    getScoreRange(rating) {
        const ranges = {
            'AAA': '90-100',
            'AA': '80-89',
            'A': '70-79',
            'BBB': '60-69',
            'BB': '50-59',
            'B': '40-49',
            'CCC': '30-39',
            'CC': '20-29',
            'C': '10-19',
            'D': '0-9'
        };
        return ranges[rating] || 'N/A';
    }
    
    getPunctualityInterpretation(punctuality) {
        if (punctuality >= 0.95) return 'Excelente (≥95%)';
        if (punctuality >= 0.85) return 'Muy buena (85-94%)';
        if (punctuality >= 0.75) return 'Buena (75-84%)';
        if (punctuality >= 0.65) return 'Aceptable (65-74%)';
        if (punctuality >= 0.55) return 'Regular (55-64%)';
        return 'Deficiente (<55%)';
    }
    
    getCompletionInterpretation(completionRate) {
        if (completionRate >= 0.95) return 'Excelente (≥95% completados)';
        if (completionRate >= 0.85) return 'Muy buena (85-94% completados)';
        if (completionRate >= 0.70) return 'Buena (70-84% completados)';
        if (completionRate >= 0.60) return 'Aceptable (60-69% completados)';
        return 'Deficiente (<60% completados)';
    }
    
    getHistoryInterpretation(loanCount) {
        if (loanCount >= 10) return 'Amplia experiencia (≥10 préstamos)';
        if (loanCount >= 5) return 'Experiencia sólida (5-9 préstamos)';
        if (loanCount >= 3) return 'Experiencia moderada (3-4 préstamos)';
        if (loanCount >= 1) return 'Experiencia limitada (1-2 préstamos)';
        return 'Sin experiencia';
    }
    
    getAmountInterpretation(avgAmount) {
        if (avgAmount <= 1000) return 'Muy conservador (≤$1,000)';
        if (avgAmount <= 3000) return 'Conservador ($1,001-$3,000)';
        if (avgAmount <= 7000) return 'Moderado ($3,001-$7,000)';
        if (avgAmount <= 15000) return 'Agresivo ($7,001-$15,000)';
        return 'Muy agresivo (>$15,000)';
    }
    
    getDefaultInterpretation(defaultRate) {
        if (defaultRate === 0) return 'Sin morosidad (0%)';
        if (defaultRate <= 0.05) return 'Muy baja (≤5%)';
        if (defaultRate <= 0.15) return 'Baja (6-15%)';
        if (defaultRate <= 0.30) return 'Moderada (16-30%)';
        if (defaultRate <= 0.50) return 'Alta (31-50%)';
        return 'Muy alta (>50%)';
    }
    
    getRiskLevel(rating) {
        const levels = {
            'AAA': 'MÍNIMO',
            'AA': 'MUY BAJO',
            'A': 'BAJO',
            'BBB': 'MODERADO',
            'BB': 'CONSIDERABLE',
            'B': 'ALTO',
            'CCC': 'MUY ALTO',
            'CC': 'EXTREMO',
            'C': 'CRÍTICO',
            'D': 'MÁXIMO'
        };
        return levels[rating] || 'NO DETERMINADO';
    }
    
    getClientProfile(rating, metrics) {
        if (rating === 'AAA' || rating === 'AA') {
            return 'CLIENTE PREMIUM - Historial excelente, alto potencial crediticio';
        } else if (rating === 'A' || rating === 'BBB') {
            return 'CLIENTE ESTÁNDAR - Historial confiable, riesgo controlado';
        } else if (rating === 'BB' || rating === 'B') {
            return 'CLIENTE DE ALTO RIESGO - Requiere supervisión y condiciones especiales';
        } else {
            return 'CLIENTE DE RIESGO EXTREMO - Evaluación rigurosa requerida';
        }
    }
    
    calculateDebtCapacity(metrics) {
        const monthlyCapacity = metrics.avgLoanAmount * 3; // 3 veces el monto promedio
        return {
            mensual: parseFloat(monthlyCapacity.toFixed(2)),
            trimestral: parseFloat((monthlyCapacity * 3).toFixed(2)),
            anual: parseFloat((monthlyCapacity * 12).toFixed(2))
        };
    }
    
    getHistoryMonths(prestamos) {
        if (prestamos.length < 2) return 0;
        const dates = prestamos.map(p => new Date(p.fecha));
        const oldest = new Date(Math.min(...dates));
        const newest = new Date(Math.max(...dates));
        const diffMonths = (newest.getFullYear() - oldest.getFullYear()) * 12 + 
                          (newest.getMonth() - oldest.getMonth());
        return Math.max(1, diffMonths);
    }
    
    calculateAnalysisPeriod(prestamos) {
        if (prestamos.length < 2) return 'Período insuficiente';
        const dates = prestamos.map(p => new Date(p.fecha)).sort((a, b) => a - b);
        const first = dates[0];
        const last = dates[dates.length - 1];
        return `${first.toISOString().split('T')[0]} al ${last.toISOString().split('T')[0]}`;
    }
    
    getScoreFormula() {
        return 'SCORE = (Puntualidad × 0.35) + (Completitud × 0.20) + (Historial × 0.15) + (Monto × 0.05) - (Morosidad × 0.25)';
    }
    
    // Ranking simplificado
    async getAllClientsRanking(limit = 50) {
        try {
            console.log(`🏆 Generando ranking detallado (límite: ${limit})`);
            
            if (!sequelize) {
                throw new Error('Sequelize no disponible');
            }
            
            const queryText = `
                SELECT DISTINCT nombre 
                FROM prestamos_1 
                WHERE nombre IS NOT NULL AND nombre != ''
                ORDER BY nombre
                ${limit > 0 ? `LIMIT ${limit}` : ''}
            `;
            
            const clientes = await sequelize.query(queryText, {
                type: sequelize.QueryTypes.SELECT
            });
            
            console.log(`📋 Encontrados ${clientes.length} clientes únicos`);
            
            const rankings = [];
            for (const [index, cliente] of clientes.entries()) {
                try {
                    console.log(`⏳ Procesando ${index + 1}/${clientes.length}: ${cliente.nombre}`);
                    
                    const rating = await this.getClientRating(cliente.nombre);
                    
                    rankings.push({
                        posicion: index + 1,
                        nombre: cliente.nombre,
                        calificacion: rating.calificacionFinal.rating,
                        score: rating.calificacionFinal.score,
                        confianza: rating.calificacionFinal.confidence,
                        resumen: {
                            totalPrestamos: rating.informacionCliente.totalPrestamos,
                            montoTotal: rating.metricas.resumen.totalSolicitado,
                            puntualidad: rating.metricas.desempeno.puntualidadPagos,
                            completitud: rating.metricas.desempeno.tasaCompletitud
                        }
                    });
                    
                } catch (error) {
                    console.error(`❌ Error con ${cliente.nombre}:`, error.message);
                }
            }
            
            // Ordenar por score descendente
            rankings.sort((a, b) => b.score - a.score);
            rankings.forEach((item, index) => item.posicion = index + 1);
            
            console.log(`✅ Ranking generado con ${rankings.length} clientes`);
            return rankings;
            
        } catch (error) {
            console.error('❌ Error en RatingService.getAllClientsRanking:', error);
            throw error;
        }
    }
}

console.log('✅ RatingService (detallado) creado e instanciado');

// Exportar instancia
const ratingService = new RatingService();
module.exports = ratingService;
