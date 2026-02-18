// src/services/simpleNewClientService.js
console.log('🔄 Cargando SimpleNewClientService (transparente)...');

class SimpleNewClientService {
    
    // Calificar cliente nuevo con transparencia total
    async rateNewClientSimple(clientData) {
        try {
            console.log('📊 Calificando cliente nuevo (modelo transparente):', clientData.nombre);
            
            // 1. Validar y preparar datos
            const datosPreparados = this.prepararDatos(clientData);
            
            // 2. Calcular cada factor con transparencia
            const calculosDetallados = this.calcularFactoresTransparente(datosPreparados);
            
            // 3. Calcular score total
            const scoreTotal = this.calcularScoreTotal(calculosDetallados);
            
            // 4. Determinar calificación
            const calificacion = this.determinarCalificacion(scoreTotal);
            
            // 5. Calcular recomendaciones
            const recomendaciones = this.calcularRecomendaciones(datosPreparados, scoreTotal, calificacion);
            
            return {
                // ENCABEZADO
                evaluacion: 'Calificación para Cliente Nuevo',
                fecha: new Date().toISOString(),
                cliente: clientData.nombre,
                tipo: 'PRIMER CRÉDITO',
                
                // DATOS DE ENTRADA (lo que recibimos)
                datosEntrada: {
                    ingresosMensuales: `$${clientData.ingresoMensual}`,
                    gastosMensuales: clientData.gastosMensuales ? `$${clientData.gastosMensuales}` : 'No especificado',
                    antiguedadLaboral: `${clientData.antiguedadLaboralMeses} meses`,
                    montoSolicitado: clientData.montoSolicitado ? `$${clientData.montoSolicitado}` : 'No especificado'
                },
                
                // CÁLCULOS PASO A PASO
                calculosPasoAPaso: calculosDetallados,
                
                // RESUMEN DE FACTORES
                factoresCalculados: {
                    factorIngresos: calculosDetallados.factorIngresos,
                    factorEstabilidad: calculosDetallados.factorEstabilidad,
                    factorCapacidadPago: calculosDetallados.factorCapacidadPago,
                    factorMonto: calculosDetallados.factorMonto,
                    puntajeBase: calculosDetallados.puntajeBase,
                    ajustes: calculosDetallados.ajustes
                },
                
                // RESULTADO FINAL
                resultadoFinal: {
                    scoreTotal: Math.round(scoreTotal),
                    calificacion: calificacion.rating,
                    nivelRiesgo: calificacion.nivelRiesgo,
                    interpretacion: calificacion.interpretacion,
                    formula: "Score = (Ingresos × 0.4) + (Estabilidad × 0.3) + (CapacidadPago × 0.3)"
                },
                
                // RECOMENDACIONES PRÁCTICAS
                recomendaciones: {
                    montoAprobable: recomendaciones.montoAprobable,
                    plazoRecomendado: recomendaciones.plazoRecomendado,
                    tasaSugerida: recomendaciones.tasaSugerida,
                    condiciones: recomendaciones.condiciones,
                    primerPaso: recomendaciones.primerPaso
                },
                
                // TABLA DE CALIFICACIONES (para referencia)
                escalaCalificaciones: {
                    'A+': '90-100 puntos (Excelente)',
                    'A': '80-89 puntos (Muy Bueno)',
                    'B+': '70-79 puntos (Bueno)',
                    'B': '60-69 puntos (Regular)',
                    'C': '50-59 puntos (Limitado)',
                    'D': '40-49 puntos (Riesgo Alto)',
                    'E': '0-39 puntos (No Recomendado)'
                }
            };
            
        } catch (error) {
            console.error('❌ Error en rateNewClientSimple:', error);
            throw new Error(`Error: ${error.message}`);
        }
    }
    
    // Preparar datos para cálculo
    prepararDatos(clientData) {
        return {
            ingresos: clientData.ingresoMensual || 0,
            gastos: clientData.gastosMensuales || 0,
            antiguedad: clientData.antiguedadLaboralMeses || 0,
            montoSolicitado: clientData.montoSolicitado || 0
        };
    }
    
    // Calcular cada factor con transparencia
    calcularFactoresTransparente(datos) {
        console.log('🧮 Calculando factores con transparencia...');
        
        // FACTOR 1: INGRESOS (40% del score)
        const factorIngresos = this.calcularFactorIngresos(datos.ingresos);
        
        // FACTOR 2: ESTABILIDAD LABORAL (30% del score)
        const factorEstabilidad = this.calcularFactorEstabilidad(datos.antiguedad);
        
        // FACTOR 3: CAPACIDAD DE PAGO (30% del score)
        const factorCapacidadPago = this.calcularFactorCapacidadPago(datos.ingresos, datos.gastos);
        
        // FACTOR 4: MONTO SOLICITADO (ajuste)
        const factorMonto = this.calcularFactorMonto(datos.ingresos, datos.montoSolicitado);
        
        // Calcular puntaje base
        const puntajeBase = (factorIngresos.puntaje * 0.4) + 
                           (factorEstabilidad.puntaje * 0.3) + 
                           (factorCapacidadPago.puntaje * 0.3);
        
        // Aplicar ajustes
        const ajustes = this.calcularAjustes(puntajeBase, factorMonto.ajuste);
        const scoreFinal = Math.max(0, Math.min(100, puntajeBase + ajustes.total));
        
        return {
            factorIngresos: {
                ...factorIngresos,
                peso: '40%',
                contribucion: (factorIngresos.puntaje * 0.4).toFixed(1)
            },
            factorEstabilidad: {
                ...factorEstabilidad,
                peso: '30%',
                contribucion: (factorEstabilidad.puntaje * 0.3).toFixed(1)
            },
            factorCapacidadPago: {
                ...factorCapacidadPago,
                peso: '30%',
                contribucion: (factorCapacidadPago.puntaje * 0.3).toFixed(1)
            },
            factorMonto: factorMonto,
            puntajeBase: puntajeBase.toFixed(1),
            ajustes: ajustes,
            scoreFinal: scoreFinal.toFixed(1)
        };
    }
    
    // Factor 1: Ingresos
    calcularFactorIngresos(ingresos) {
        let puntaje;
        let categoria;
        let explicacion;
        
        if (ingresos >= 30000) {
            puntaje = 100;
            categoria = 'ALTO';
            explicacion = `Ingresos de $${ingresos} muestran buena capacidad económica`;
        } else if (ingresos >= 20000) {
            puntaje = 80;
            categoria = 'BUENO';
            explicacion = `Ingresos de $${ingresos} son adecuados para créditos moderados`;
        } else if (ingresos >= 15000) {
            puntaje = 65;
            categoria = 'MODERADO';
            explicacion = `Ingresos de $${ingresos} permiten créditos pequeños`;
        } else if (ingresos >= 10000) {
            puntaje = 50;
            categoria = 'LIMITADO';
            explicacion = `Ingresos de $${ingresos} limitan el monto del crédito`;
        } else if (ingresos >= 5000) {
            puntaje = 30;
            categoria = 'BAJO';
            explicacion = `Ingresos de $${ingresos} son insuficientes para créditos significativos`;
        } else {
            puntaje = 10;
            categoria = 'MUY BAJO';
            explicacion = `Ingresos de $${ingresos} no recomiendan otorgar crédito`;
        }
        
        return {
            nombre: 'Nivel de Ingresos',
            valor: ingresos,
            puntaje: puntaje,
            categoria: categoria,
            explicacion: explicacion
        };
    }
    
    // Factor 2: Estabilidad Laboral
    calcularFactorEstabilidad(antiguedad) {
        let puntaje;
        let categoria;
        let explicacion;
        
        if (antiguedad >= 24) {
            puntaje = 100;
            categoria = 'MUY ESTABLE';
            explicacion = `${antiguedad} meses de antigüedad indican estabilidad laboral sólida`;
        } else if (antiguedad >= 12) {
            puntaje = 80;
            categoria = 'ESTABLE';
            explicacion = `${antiguedad} meses de antigüedad muestran estabilidad adecuada`;
        } else if (antiguedad >= 6) {
            puntaje = 60;
            categoria = 'REGULAR';
            explicacion = `${antiguedad} meses de antigüedad, aún en período de prueba`;
        } else if (antiguedad >= 3) {
            puntaje = 40;
            categoria = 'INESTABLE';
            explicacion = `${antiguedad} meses de antigüedad, empleo muy reciente`;
        } else {
            puntaje = 20;
            categoria = 'MUY INESTABLE';
            explicacion = `${antiguedad} meses de antigüedad, alto riesgo laboral`;
        }
        
        return {
            nombre: 'Estabilidad Laboral',
            valor: `${antiguedad} meses`,
            puntaje: puntaje,
            categoria: categoria,
            explicacion: explicacion
        };
    }
    
    // Factor 3: Capacidad de Pago
    calcularFactorCapacidadPago(ingresos, gastos) {
        const capacidad = ingresos - gastos;
        const porcentaje = ingresos > 0 ? (capacidad / ingresos) * 100 : 0;
        
        let puntaje;
        let categoria;
        let explicacion;
        
        if (porcentaje >= 50) {
            puntaje = 100;
            categoria = 'EXCELENTE';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else if (porcentaje >= 40) {
            puntaje = 85;
            categoria = 'MUY BUENA';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else if (porcentaje >= 30) {
            puntaje = 70;
            categoria = 'BUENA';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else if (porcentaje >= 20) {
            puntaje = 55;
            categoria = 'REGULAR';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else if (porcentaje >= 10) {
            puntaje = 40;
            categoria = 'LIMITADA';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else if (porcentaje > 0) {
            puntaje = 25;
            categoria = 'MUY LIMITADA';
            explicacion = `Capacidad de pago del ${porcentaje.toFixed(1)}% ($${capacidad}/mes)`;
        } else {
            puntaje = 10;
            categoria = 'SIN CAPACIDAD';
            explicacion = `Sin capacidad de pago (gastos igualan o superan ingresos)`;
        }
        
        return {
            nombre: 'Capacidad de Pago',
            valor: `$${capacidad}/mes (${porcentaje.toFixed(1)}%)`,
            puntaje: puntaje,
            categoria: categoria,
            explicacion: explicacion
        };
    }
    
    // Factor 4: Monto Solicitado (ajuste)
    calcularFactorMonto(ingresos, montoSolicitado) {
        if (montoSolicitado <= 0) {
            return {
                nombre: 'Monto Solicitado',
                valor: 'No especificado',
                ajuste: 0,
                explicacion: 'No se evaluó ajuste por monto'
            };
        }
        
        // Cuántas veces el ingreso mensual representa el monto solicitado
        const vecesIngreso = montoSolicitado / ingresos;
        
        let ajuste;
        let explicacion;
        
        if (vecesIngreso <= 3) {
            ajuste = 10;
            explicacion = `Monto solicitado ($${montoSolicitado}) es ${vecesIngreso.toFixed(1)} veces el ingreso mensual - ADECUADO`;
        } else if (vecesIngreso <= 5) {
            ajuste = 0;
            explicacion = `Monto solicitado ($${montoSolicitado}) es ${vecesIngreso.toFixed(1)} veces el ingreso mensual - LÍMITE RAZONABLE`;
        } else if (vecesIngreso <= 8) {
            ajuste = -10;
            explicacion = `Monto solicitado ($${montoSolicitado}) es ${vecesIngreso.toFixed(1)} veces el ingreso mensual - ALTO`;
        } else {
            ajuste = -20;
            explicacion = `Monto solicitado ($${montoSolicitado}) es ${vecesIngreso.toFixed(1)} veces el ingreso mensual - MUY ALTO`;
        }
        
        return {
            nombre: 'Monto Solicitado',
            valor: `$${montoSolicitado}`,
            ajuste: ajuste,
            explicacion: explicacion
        };
    }
    
    // Calcular ajustes
    calcularAjustes(puntajeBase, ajusteMonto) {
        const ajustes = [];
        let total = 0;
        
        // Ajuste por monto solicitado
        if (ajusteMonto !== 0) {
            ajustes.push({
                descripcion: 'Ajuste por monto solicitado',
                valor: ajusteMonto,
                razon: 'El monto solicitado afecta la viabilidad del crédito'
            });
            total += ajusteMonto;
        }
        
        // Ajuste por puntaje base
        if (puntajeBase < 30) {
            ajustes.push({
                descripcion: 'Ajuste por perfil de riesgo',
                valor: -10,
                razon: 'Perfil de riesgo muy alto'
            });
            total -= 10;
        }
        
        return {
            items: ajustes,
            total: total,
            explicacion: `Ajuste total aplicado: ${total > 0 ? '+' : ''}${total} puntos`
        };
    }
    
    // Calcular score total
    calcularScoreTotal(calculos) {
        return parseFloat(calculos.scoreFinal);
    }
    
    // Determinar calificación final
    determinarCalificacion(score) {
        let rating;
        let nivelRiesgo;
        let interpretacion;
        
        if (score >= 90) {
            rating = 'A+';
            nivelRiesgo = 'MUY BAJO';
            interpretacion = 'Excelente candidato para crédito. Ingresos estables y alta capacidad de pago.';
        } else if (score >= 80) {
            rating = 'A';
            nivelRiesgo = 'BAJO';
            interpretacion = 'Buen candidato para crédito. Perfil sólido y riesgo mínimo.';
        } else if (score >= 70) {
            rating = 'B+';
            nivelRiesgo = 'MODERADO-BAJO';
            interpretacion = 'Candidato aceptable. Considerar créditos moderados con supervisión básica.';
        } else if (score >= 60) {
            rating = 'B';
            nivelRiesgo = 'MODERADO';
            interpretacion = 'Candidato regular. Requiere evaluación cuidadosa y condiciones específicas.';
        } else if (score >= 50) {
            rating = 'C';
            nivelRiesgo = 'MODERADO-ALTO';
            interpretacion = 'Candidato limitado. Solo considerar créditos pequeños con garantías.';
        } else if (score >= 40) {
            rating = 'D';
            nivelRiesgo = 'ALTO';
            interpretacion = 'Alto riesgo. Solo considerar en casos excepcionales con garantías sólidas.';
        } else {
            rating = 'E';
            nivelRiesgo = 'MUY ALTO';
            interpretacion = 'No recomendado para crédito en este momento.';
        }
        
        return {
            rating,
            nivelRiesgo,
            interpretacion,
            rango: this.obtenerRangoScore(rating)
        };
    }
    
    // Calcular recomendaciones prácticas
    calcularRecomendaciones(datos, score, calificacion) {
        // Calcular monto aprobable basado en ingresos y score
        const montoBase = datos.ingresos * 3; // 3 meses de ingresos
        const factorScore = score / 100;
        let montoAprobable = Math.round(montoBase * factorScore);
        
        // Ajustar según calificación
        switch(calificacion.rating) {
            case 'A+':
            case 'A':
                montoAprobable = Math.min(montoAprobable, datos.ingresos * 6);
                break;
            case 'B+':
            case 'B':
                montoAprobable = Math.min(montoAprobable, datos.ingresos * 4);
                break;
            case 'C':
                montoAprobable = Math.min(montoAprobable, datos.ingresos * 2);
                break;
            default:
                montoAprobable = Math.min(montoAprobable, datos.ingresos);
        }
        
        // Determinar plazo
        let plazo;
        if (score >= 80) plazo = '8-12 semanas';
        else if (score >= 60) plazo = '4-8 semanas';
        else plazo = '2-4 semanas';
        
        // Determinar tasa
        let tasa;
        if (score >= 80) tasa = '14-16%';
        else if (score >= 60) tasa = '16-20%';
        else if (score >= 40) tasa = '20-25%';
        else tasa = '25-30%';
        
        // Condiciones
        const condiciones = [];
        if (score < 60) condiciones.push('Requiere garantía o aval');
        if (score < 50) condiciones.push('Pago inicial del 20%');
        if (score < 40) condiciones.push('Supervisión semanal de pagos');
        if (score >= 70) condiciones.push('Elegible para renovación después de 3 pagos puntuales');
        
        return {
            montoAprobable: `$${montoAprobable}`,
            plazoRecomendado: plazo,
            tasaSugerida: tasa,
            condiciones: condiciones.length > 0 ? condiciones : ['Sin condiciones especiales'],
            primerPaso: score >= 60 ? 'Proceder con solicitud completa' : 'Solicitar documentos adicionales'
        };
    }
    
    // Métodos auxiliares
    obtenerRangoScore(rating) {
        const rangos = {
            'A+': '90-100',
            'A': '80-89',
            'B+': '70-79',
            'B': '60-69',
            'C': '50-59',
            'D': '40-49',
            'E': '0-39'
        };
        return rangos[rating] || 'N/A';
    }
}

console.log('✅ SimpleNewClientService creado');

// Exportar instancia
const simpleNewClientService = new SimpleNewClientService();
module.exports = simpleNewClientService;