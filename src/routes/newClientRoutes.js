// routes/newClientRoutes.js - Con tiempoSemanas como plazo del préstamo
const express = require('express');
const router = express.Router();

/**
 * @route POST /api/ratings/new-client
 * @description Calcula el score de un nuevo cliente basado en múltiples variables
 * @body {
 *   edad: number,
 *   sexo: string ('M' | 'F'),
 *   tiempoSemanas: number, // PLAZO del préstamo en semanas
 *   objetivoPrestamo: string,
 *   esReferido: boolean,
 *   tieneGarantia: boolean,
 *   montoGarantia: number,
 *   montoSolicitado: number,
 *   ingresosMensuales: number
 * }
 */
router.post('/new-client', (req, res) => {
  try {
    const {
      edad,
      sexo,
      tiempoSemanas, // AHORA: Plazo del préstamo en semanas
      objetivoPrestamo,
      esReferido,
      tieneGarantia,
      montoGarantia,
      montoSolicitado,
      ingresosMensuales,
      egresosMensuales = 0,
      otrasDeudasMensuales = 0,
      antiguedadLaboralMeses = 0,
      documentosCompletos = false
    } = req.body;

    // Validaciones básicas
    if (!edad || !sexo || !tiempoSemanas || !montoSolicitado || !ingresosMensuales) {
      return res.status(400).json({
        success: false,
        message: 'Faltan campos requeridos: edad, sexo, tiempoSemanas (plazo), montoSolicitado, ingresosMensuales'
      });
    }

    // VALIDACIONES DETALLADAS
    const errores = [];
    
    if (edad < 18 || edad > 80) {
      errores.push('La edad debe estar entre 18 y 80 años');
    }

    if (!['M', 'F'].includes(sexo.toUpperCase())) {
      errores.push('El sexo debe ser "M" (masculino) o "F" (femenino)');
    }

    if (tiempoSemanas < 4 || tiempoSemanas > 208) {
      errores.push('El plazo del préstamo debe estar entre 4 semanas (1 mes) y 208 semanas (4 años)');
    }

    if (montoSolicitado <= 0) {
      errores.push('El monto solicitado debe ser mayor a 0');
    }

    if (ingresosMensuales <= 0) {
      errores.push('Los ingresos mensuales deben ser mayores a 0');
    }

    if (tieneGarantia && montoGarantia < 0) {
      errores.push('El monto de la garantía no puede ser negativo');
    }

    if (errores.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Errores de validación',
        errores
      });
    }

    // CALCULO DEL SCORE (0-100 puntos) CON DETALLES
    let score = 50; // Puntuación base
    const calculosDetallados = [];

    // 1. FACTOR EDAD (0-15 puntos)
    let edadScore = 0;
    let edadCategoria = '';
    let edadExplicacion = '';
    
    if (edad >= 25 && edad <= 50) {
      edadScore = 15;
      edadCategoria = 'ÓPTIMA';
      edadExplicacion = 'Edad con mayor estabilidad laboral y financiera';
    } else if ((edad >= 20 && edad < 25) || (edad > 50 && edad <= 60)) {
      edadScore = 10;
      edadCategoria = 'ACEPTABLE';
      edadExplicacion = edad < 25 ? 'Adulto joven con potencial crecimiento' : 'Adulto mayor con experiencia';
    } else if (edad >= 18 && edad < 20) {
      edadScore = 5;
      edadCategoria = 'JOVEN';
      edadExplicacion = 'Mayoría de edad reciente, experiencia limitada';
    } else if (edad > 60) {
      edadScore = 3;
      edadCategoria = 'ADULTO MAYOR';
      edadExplicacion = 'Mayor edad, posible proximidad a retiro';
    }
    
    score += edadScore;
    calculosDetallados.push({
      factor: 'EDAD',
      valor: edad,
      categoria: edadCategoria,
      puntos: edadScore,
      maxPuntos: 15,
      explicacion: edadExplicacion,
      porcentaje: `${((edadScore / 15) * 100).toFixed(1)}%`
    });

    // 2. FACTOR SEXO (0-5 puntos)
    let sexoScore = sexo.toUpperCase() === 'F' ? 5 : 3;
    let sexoExplicacion = sexo.toUpperCase() === 'F' 
      ? 'Estudios muestran mayor cumplimiento en pagos en género femenino' 
      : 'Género masculino - cumplimiento promedio';
    
    score += sexoScore;
    calculosDetallados.push({
      factor: 'GÉNERO',
      valor: sexo.toUpperCase() === 'M' ? 'Masculino' : 'Femenino',
      puntos: sexoScore,
      maxPuntos: 5,
      explicacion: sexoExplicacion,
      porcentaje: `${((sexoScore / 5) * 100).toFixed(1)}%`
    });

    // 3. FACTOR PLAZO DEL PRÉSTAMO (TIEMPOSEMANAS) - MODIFICADO (0-15 puntos)
    let plazoScore = 0;
    let plazoCategoria = '';
    let plazoExplicacion = '';
    
    const plazoMeses = tiempoSemanas / 4.33; // Convertir semanas a meses
    
    // Evaluación del plazo solicitado vs plazo recomendado
    const plazoRecomendadoMeses = (montoSolicitado / (ingresosMensuales * 0.3)); // 30% de ingresos
    
    if (plazoMeses <= plazoRecomendadoMeses) {
      // Plazo adecuado o menor al recomendado
      if (plazoMeses <= 6) {
        plazoScore = 15;
        plazoCategoria = 'PLAZO CORTÓ ÓPTIMO';
        plazoExplicacion = 'Plazo corto - menor riesgo de incumplimiento';
      } else if (plazoMeses <= 12) {
        plazoScore = 12;
        plazoCategoria = 'PLAZO ESTÁNDAR';
        plazoExplicacion = 'Plazo adecuado a capacidad de pago';
      } else if (plazoMeses <= 24) {
        plazoScore = 10;
        plazoCategoria = 'PLAZO MODERADO';
        plazoExplicacion = 'Plazo aceptable, monitoreo recomendado';
      } else {
        plazoScore = 8;
        plazoCategoria = 'PLAZO LARGO';
        plazoExplicacion = 'Plazo extendido, mayor riesgo temporal';
      }
    } else {
      // Plazo excede lo recomendado
      if (plazoMeses <= plazoRecomendadoMeses * 1.5) {
        plazoScore = 5;
        plazoCategoria = 'PLAZO EXCEDIDO MODERADO';
        plazoExplicacion = 'Plazo mayor al recomendado - riesgo incrementado';
      } else {
        plazoScore = 0;
        plazoCategoria = 'PLAZO EXCESIVO';
        plazoExplicacion = 'Plazo muy largo respecto a capacidad - alto riesgo';
      }
    }
    
    score += plazoScore;
    calculosDetallados.push({
      factor: 'PLAZO PRÉSTAMO',
      valor: `${tiempoSemanas} semanas (${plazoMeses.toFixed(1)} meses)`,
      categoria: plazoCategoria,
      puntos: plazoScore,
      maxPuntos: 15,
      plazoRecomendado: `${plazoRecomendadoMeses.toFixed(1)} meses`,
      diferencia: `${(plazoMeses - plazoRecomendadoMeses).toFixed(1)} meses`,
      explicacion: plazoExplicacion,
      porcentaje: `${((plazoScore / 15) * 100).toFixed(1)}%`
    });

    // 4. FACTOR OBJETIVO DEL PRÉSTAMO (0-10 puntos)
    let objetivoScore = 0;
    let objetivoExplicacion = '';
    const objetivosValidos = ['pago_deuda', 'inversion', 'consumo', 'emergencia', 'otros'];
    
    if (!objetivoPrestamo || !objetivosValidos.includes(objetivoPrestamo)) {
      return res.status(400).json({
        success: false,
        message: `Objetivo de préstamo inválido. Debe ser uno de: ${objetivosValidos.join(', ')}`
      });
    }

    switch (objetivoPrestamo) {
      case 'pago_deuda':
        objetivoScore = 8;
        objetivoExplicacion = 'Mejora situación financiera al consolidar deudas';
        break;
      case 'inversion':
        objetivoScore = 10;
        objetivoExplicacion = 'Genera retorno de inversión - mejora capacidad de pago futura';
        break;
      case 'emergencia':
        objetivoScore = 6;
        objetivoExplicacion = 'Necesidad imprevista - moderado riesgo';
        break;
      case 'consumo':
        objetivoScore = 4;
        objetivoExplicacion = 'Gasto no productivo - mayor riesgo de impago';
        break;
      case 'otros':
        objetivoScore = 3;
        objetivoExplicacion = 'Propósito no especificado - requiere mayor análisis';
        break;
    }
    
    score += objetivoScore;
    calculosDetallados.push({
      factor: 'OBJETIVO PRÉSTAMO',
      valor: objetivoPrestamo.toUpperCase().replace('_', ' '),
      puntos: objetivoScore,
      maxPuntos: 10,
      explicacion: objetivoExplicacion,
      riesgo: objetivoPrestamo === 'inversion' ? 'BAJO' : 
              objetivoPrestamo === 'pago_deuda' ? 'MODERADO-BAJO' :
              objetivoPrestamo === 'emergencia' ? 'MODERADO' :
              objetivoPrestamo === 'consumo' ? 'ALTO' : 'MODERADO-ALTO',
      porcentaje: `${((objetivoScore / 10) * 100).toFixed(1)}%`
    });

    // 5. FACTOR REFERIDO (0-5 puntos)
    let referidoScore = esReferido ? 5 : 0;
    let referidoExplicacion = esReferido 
      ? 'Cliente referido por cliente existente - mayor confianza' 
      : 'Cliente no referido - evaluación estándar';
    
    score += referidoScore;
    calculosDetallados.push({
      factor: 'REFERIDO',
      valor: esReferido ? 'SÍ' : 'NO',
      puntos: referidoScore,
      maxPuntos: 5,
      explicacion: referidoExplicacion,
      impacto: esReferido ? 'POSITIVO' : 'NEUTRO',
      porcentaje: `${((referidoScore / 5) * 100).toFixed(1)}%`
    });

    // 6. FACTOR GARANTÍA (0-20 puntos) - CÁLCULO DETALLADO
    let garantiaScore = 0;
    let garantiaCategoria = '';
    let garantiaExplicacion = '';
    let relacionGarantia = 0;
    
    if (tieneGarantia && montoGarantia > 0) {
      relacionGarantia = (montoGarantia / montoSolicitado) * 100;
      
      if (relacionGarantia >= 150) {
        garantiaScore = 20;
        garantiaCategoria = 'GARANTÍA SOBRECOLATERALIZADA';
        garantiaExplicacion = `Garantía excede en ${(relacionGarantia - 100).toFixed(1)}% el monto solicitado - riesgo mínimo`;
      } else if (relacionGarantia >= 100) {
        garantiaScore = 15;
        garantiaCategoria = 'GARANTÍA COMPLETA';
        garantiaExplicacion = 'Garantía cubre el 100% del préstamo - riesgo bajo';
      } else if (relacionGarantia >= 50) {
        garantiaScore = 10;
        garantiaCategoria = 'GARANTÍA PARCIAL';
        garantiaExplicacion = `Garantía cubre ${relacionGarantia.toFixed(1)}% del préstamo - riesgo moderado`;
      } else if (relacionGarantia > 0) {
        garantiaScore = 5;
        garantiaCategoria = 'GARANTÍA MÍNIMA';
        garantiaExplicacion = `Garantía cubre solo ${relacionGarantia.toFixed(1)}% del préstamo - riesgo alto`;
      }
    } else {
      relacionGarantia = 0;
      garantiaCategoria = 'SIN GARANTÍA';
      garantiaExplicacion = 'Préstamo sin colateral - riesgo máximo';
    }
    
    score += garantiaScore;
    calculosDetallados.push({
      factor: 'GARANTÍA',
      valor: tieneGarantia ? `$${montoGarantia.toLocaleString()}` : 'NO',
      categoria: garantiaCategoria,
      puntos: garantiaScore,
      maxPuntos: 20,
      relacion: `${relacionGarantia.toFixed(1)}%`,
      cobertura: relacionGarantia >= 100 ? 'COMPLETA' : 
                 relacionGarantia >= 50 ? 'PARCIAL' : 
                 relacionGarantia > 0 ? 'MÍNIMA' : 'NULA',
      explicacion: garantiaExplicacion,
      porcentaje: `${((garantiaScore / 20) * 100).toFixed(1)}%`
    });

    // 7. FACTOR CAPACIDAD DE PAGO (0-20 puntos) - ANÁLISIS DETALLADO CON PLAZO
    const pagoSemanalEstimado = tiempoSemanas > 0 ? (montoSolicitado / tiempoSemanas) : 0;
    const ingresosSemanales = ingresosMensuales / 4.333;
    const capacidadPago = pagoSemanalEstimado > 0 ? (ingresosSemanales / pagoSemanalEstimado) * 100 : 0;
    let capacidadScore = 0;
    let capacidadCategoria = '';
    let capacidadExplicacion = '';
    
    if (capacidadPago >= 200) {
      capacidadScore = 20;
      capacidadCategoria = 'CAPACIDAD EXCELENTE';
      capacidadExplicacion = 'Ingresos cubren más del 200% del pago mensual - riesgo muy bajo';
    } else if (capacidadPago >= 150) {
      capacidadScore = 15;
      capacidadCategoria = 'CAPACIDAD SOBRESALIENTE';
      capacidadExplicacion = 'Ingresos cubren 150-200% del pago mensual - riesgo bajo';
    } else if (capacidadPago >= 100) {
      capacidadScore = 10;
      capacidadCategoria = 'CAPACIDAD ADECUADA';
      capacidadExplicacion = 'Ingresos cubren 100-150% del pago mensual - riesgo moderado';
    } else if (capacidadPago >= 50) {
      capacidadScore = 5;
      capacidadCategoria = 'CAPACIDAD LIMITADA';
      capacidadExplicacion = 'Ingresos cubren 50-100% del pago mensual - riesgo alto';
    } else {
      capacidadScore = 0;
      capacidadCategoria = 'CAPACIDAD INSUFICIENTE';
      capacidadExplicacion = 'Ingresos cubren menos del 50% del pago mensual - riesgo muy alto';
    }
    
    score += capacidadScore;
    
    calculosDetallados.push({
      factor: 'CAPACIDAD DE PAGO',
      valor: `$${ingresosMensuales.toLocaleString()} mensuales`,
      categoria: capacidadCategoria,
      puntos: capacidadScore,
      maxPuntos: 20,
      ratio: `${capacidadPago.toFixed(1)}%`,
      analisis: {
        ingresosSemanales: `$${ingresosSemanales.toLocaleString()}`,
        pagoSemanalEstimado: `$${pagoSemanalEstimado.toLocaleString()}`,
        relacionPagoIngresos: `${(pagoSemanalEstimado > 0 ? (pagoSemanalEstimado / ingresosSemanales) * 100 : 0).toFixed(1)}%`,
        plazoSolicitado: `${tiempoSemanas} semanas`,
        cuotaRecomendada: `$${(ingresosSemanales * 0.3).toLocaleString()} (30% de ingresos semanales)`
      },
      explicacion: capacidadExplicacion,
      porcentaje: `${((capacidadScore / 20) * 100).toFixed(1)}%`
    });

    // 8. FACTOR ADICIONAL: CONGRUENCIA MONTO-PLAZO (0-10 puntos)
    let congruenciaScore = 0;
    let congruenciaCategoria = '';
    let congruenciaExplicacion = '';
    
    // Evaluar si el monto y plazo son congruentes
    const montoPorMes = montoSolicitado / plazoMeses;
    const ingresoPorMesRecomendado = montoPorMes * 3; // Debería ser máximo 1/3 de ingresos
    
    if (ingresoPorMesRecomendado <= ingresosMensuales) {
      congruenciaScore = 10;
      congruenciaCategoria = 'CONGRUENCIA ÓPTIMA';
      congruenciaExplicacion = 'Monto y plazo son proporcionales a ingresos';
    } else if (ingresoPorMesRecomendado <= ingresosMensuales * 1.5) {
      congruenciaScore = 7;
      congruenciaCategoria = 'CONGRUENCIA ACEPTABLE';
      congruenciaExplicacion = 'Monto y plazo son aceptables para ingresos';
    } else if (ingresoPorMesRecomendado <= ingresosMensuales * 2) {
      congruenciaScore = 3;
      congruenciaCategoria = 'CONGRUENCIA LIMITADA';
      congruenciaExplicacion = 'Monto o plazo podrían estar sobrestimados';
    } else {
      congruenciaScore = 0;
      congruenciaCategoria = 'INCONGRUENCIA';
      congruenciaExplicacion = 'Monto y plazo no son proporcionales a ingresos';
    }
    
    score += congruenciaScore;
    calculosDetallados.push({
      factor: 'CONGRUENCIA MONTO-PLAZO',
      valor: `$${montoSolicitado.toLocaleString()} / ${plazoMeses.toFixed(1)} meses`,
      categoria: congruenciaCategoria,
      puntos: congruenciaScore,
      maxPuntos: 10,
      montoPorMes: `$${montoPorMes.toLocaleString()}`,
      explicacion: congruenciaExplicacion,
      porcentaje: `${((congruenciaScore / 10) * 100).toFixed(1)}%`
    });

    // Asegurar que el score esté entre 0 y 100
    score = Math.max(0, Math.min(100, Math.round(score)));

    // CALCULO DEL RIESGO TOTAL
    let riesgoTotal = '';
    let colorRiesgo = '';
    
    if (score >= 80) {
      riesgoTotal = 'MUY BAJO';
      colorRiesgo = '#10B981'; // Verde
    } else if (score >= 65) {
      riesgoTotal = 'BAJO';
      colorRiesgo = '#34D399'; // Verde claro
    } else if (score >= 50) {
      riesgoTotal = 'MODERADO';
      colorRiesgo = '#FBBF24'; // Amarillo
    } else if (score >= 35) {
      riesgoTotal = 'ALTO';
      colorRiesgo = '#F97316'; // Naranja
    } else {
      riesgoTotal = 'MUY ALTO';
      colorRiesgo = '#EF4444'; // Rojo
    }

    // ANÁLISIS DE RATIOS FINANCIEROS
    const ratiosFinancieros = {
      deudaIngreso: ((montoSolicitado / ingresosMensuales) * 100).toFixed(1) + '%',
      garantiaDeuda: relacionGarantia.toFixed(1) + '%',
      capacidadEndeudamiento: capacidadPago.toFixed(1) + '%',
      relacionCuotaIngreso: ((pagoSemanalEstimado / ingresosSemanales) * 100).toFixed(1) + '%',
      plazoAdecuado: plazoMeses <= plazoRecomendadoMeses ? 'SÍ' : 'NO'
    };

    // DETERMINAR CALIFICACIÓN FINAL
    let calificacion = '';
    let aprobado = false;
    let montoAprobado = 0;
    let tasaInteres = 0;
    let plazoAprobado = tiempoSemanas;
    let condicionesAprobacion = [];

    if (score >= 80) {
      calificacion = 'EXCELENTE';
      aprobado = true;
      montoAprobado = montoSolicitado;
      tasaInteres = 8.5;
      condicionesAprobacion = [
        'Aprobación inmediata',
        'Plazo solicitado aprobado',
        'Sin garantías adicionales requeridas',
        'Tasa preferencial del 8.5% anual'
      ];
    } else if (score >= 65) {
      calificacion = 'BUENO';
      aprobado = true;
      montoAprobado = montoSolicitado * 0.85;
      // Reducir plazo si es muy largo
      if (plazoMeses > plazoRecomendadoMeses * 1.2) {
        plazoAprobado = Math.min(tiempoSemanas, Math.floor(plazoRecomendadoMeses * 1.2 * 4.33));
      }
      tasaInteres = 12.5;
      condicionesAprobacion = [
        `Aprobación del ${((montoAprobado / montoSolicitado) * 100).toFixed(0)}% del monto solicitado`,
        `Plazo ajustado a ${Math.floor(plazoAprobado / 4.33)} meses`,
        'Revisión de documentación adicional',
        'Tasa estándar del 12.5% anual'
      ];
    } else if (score >= 50) {
      calificacion = 'REGULAR';
      aprobado = true;
      montoAprobado = montoSolicitado * 0.70;
      // Reducir plazo significativamente
      plazoAprobado = Math.min(tiempoSemanas, Math.floor(plazoRecomendadoMeses * 4.33));
      tasaInteres = 16.0;
      condicionesAprobacion = [
        `Aprobación limitada al ${((montoAprobado / montoSolicitado) * 100).toFixed(0)}% del monto`,
        `Plazo reducido a ${Math.floor(plazoAprobado / 4.33)} meses`,
        'Garantía adicional requerida',
        'Tasa elevada del 16.0% anual'
      ];
    } else if (score >= 35) {
      calificacion = 'BAJO';
      aprobado = false;
      montoAprobado = montoSolicitado * 0.50;
      plazoAprobado = Math.floor(Math.min(plazoRecomendadoMeses, 6) * 4.33); // Máximo 6 meses
      tasaInteres = 20.0;
      condicionesAprobacion = [
        'NO APROBADO - Perfil de riesgo alto',
        `Oferta alternativa: ${((montoAprobado / montoSolicitado) * 100).toFixed(0)}% del monto en ${Math.floor(plazoAprobado / 4.33)} meses`,
        'Garantía real requerida (propiedad o vehículo)',
        'Tasa máxima del 20.0% anual'
      ];
    } else {
      calificacion = 'NO APROBADO';
      aprobado = false;
      montoAprobado = 0;
      tasaInteres = 0;
      plazoAprobado = 0;
      condicionesAprobacion = [
        'NO APROBADO - Riesgo crediticio muy alto',
        'Plazo solicitado incompatible con capacidad de pago',
        'Recomendación: Reducir monto o aumentar plazo considerablemente'
      ];
    }

    // CÁLCULO DE CUOTAS DETALLADO
    const plazoAprobadoMeses = plazoAprobado / 4.33;
    const tasaMensual = tasaInteres / 12 / 100;
    let cuotaMensual = 0;
    
    if (aprobado && montoAprobado > 0 && tasaInteres > 0) {
      if (tasaMensual > 0) {
        cuotaMensual = (montoAprobado * tasaMensual * Math.pow(1 + tasaMensual, plazoAprobadoMeses)) / 
                      (Math.pow(1 + tasaMensual, plazoAprobadoMeses) - 1);
      } else {
        cuotaMensual = montoAprobado / plazoAprobadoMeses; // Sin intereses (caso especial)
      }
    }

    // RESPUESTA FINTECH-GRADE
    const timestamp = new Date().toISOString();
    const requestId = `ANL-NEW-${Date.now()}`;
    const ingresoDisponible = ingresosMensuales - egresosMensuales - otrasDeudasMensuales;
    const ratioGarantia = montoSolicitado > 0 ? (montoGarantia || 0) / montoSolicitado : 0;
    const montoVsIngreso = ingresosMensuales > 0 ? montoSolicitado / ingresosMensuales : 0;
    const cuotaEstimadaSemanal = tiempoSemanas > 0 ? montoSolicitado / tiempoSemanas : 0;
    const ratioCuotaIngresoSemanal = ingresosMensuales > 0 ? cuotaEstimadaSemanal / ingresosSemanales : 0;

    const decision = score >= 75 ? 'APROBADO' : score >= 60 ? 'APROBADO_CONDICIONES' : 'RECHAZADO';
    const aprobadoFinal = score >= 60;
    const riesgoTotalFinal = score >= 75 ? 'BAJO' : score >= 60 ? 'MODERADO' : 'ALTO';

    res.json({
      timestamp,
      resumen: {
        scoreFinal: score,
        decision,
        aprobado: aprobadoFinal,
        riesgoTotal: riesgoTotalFinal,
        montoSolicitado
      },
      inputsNormalizados: {
        edad,
        sexo: sexo.toUpperCase(),
        plazoSemanas: tiempoSemanas,
        objetivoPrestamo: objetivoPrestamo.toUpperCase(),
        referido: !!esReferido,
        garantia: {
          tiene: !!tieneGarantia,
          valor: montoGarantia || 0
        },
        montoSolicitado,
        ingresosMensuales,
        egresosMensuales,
        otrasDeudasMensuales,
        antiguedadLaboralMeses,
        documentosCompletos: !!documentosCompletos
      },
      precalculos: {
        ingresoDisponible,
        montoVsIngreso: parseFloat(montoVsIngreso.toFixed(2)),
        ratioGarantia: parseFloat(ratioGarantia.toFixed(2)),
        cuotaEstimada: {
          metodo: 'AMORTIZACION_SIMPLE_ESTIMADA',
          semanal: parseFloat(cuotaEstimadaSemanal.toFixed(2)),
          nota: 'Estimación para ratio cuota/ingreso; el cronograma final puede variar por modalidad'
        },
        ratios: {
          ratioCuotaIngresoSemanal: parseFloat(ratioCuotaIngresoSemanal.toFixed(4)),
          limiteRecomendado: 0.3
        },
        flags: {
          excedeRatioCuotaIngreso: ratioCuotaIngresoSemanal > 0.3,
          ingresoDisponibleBajo: ingresoDisponible < 0,
          garantiaSuficiente: ratioGarantia >= 1,
          documentosOK: !!documentosCompletos
        }
      },
      scorecard: {
        pesos: {
          capacidadPago: '35 pts',
          congruenciaMontoPlazo: '20 pts',
          garantia: '20 pts',
          estabilidad: '15 pts',
          contexto: '10 pts'
        },
        normalizacion: undefined
      },
      consideraciones: {
        factoresMasPositivos: [
          { factor: 'GARANTIA', detalle: `Cobertura ${(ratioGarantia * 100).toFixed(0)}%` }
        ],
        factoresMasNegativos: [
          { factor: 'RATIO_CUOTA_INGRESO', detalle: `${(ratioCuotaIngresoSemanal * 100).toFixed(1)}%`, severidad: 'ALTA' }
        ]
      },
      contraofertas: [
        {
          escenario: 'Reducir monto',
          montoSugerido: Math.round(montoSolicitado * 0.7),
          plazoSemanas: tiempoSemanas,
          objetivo: 'Bajar ratio cuota/ingreso'
        },
        {
          escenario: 'Extender plazo',
          monto: montoSolicitado,
          plazoSemanas: tiempoSemanas * 2,
          objetivo: 'Bajar cuota mensual estimada'
        }
      ],
      
    });

  } catch (error) {
    console.error('❌ Error en cálculo de nuevo cliente:', error);
    res.status(500).json({
      success: false,
      message: 'Error interno del servidor al procesar el análisis crediticio',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// Middleware para medir tiempo de procesamiento
router.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

// Ruta adicional para obtener información de las variables
router.get('/new-client/variables', (req, res) => {
  res.json({
    success: true,
    variables: {
      edad: {
        descripcion: 'Edad del cliente en años',
        rango: '18-80',
        impacto: 'Alto',
        optimo: '25-50 años'
      },
      sexo: {
        descripcion: 'Género del cliente',
        valores: ['M', 'F'],
        impacto: 'Bajo',
        nota: 'Diferencias estadísticas en comportamiento de pago'
      },
      tiempoSemanas: {
        descripcion: 'Plazo del préstamo solicitado en semanas',
        rango: '4-208 semanas (1 mes - 4 años)',
        impacto: 'Moderado-Alto',
        calculo: 'Evalúa congruencia con monto e ingresos',
        recomendacion: 'Plazo debe permitir cuota ≤ 30% de ingresos mensuales'
      },
      objetivoPrestamo: {
        descripcion: 'Finalidad del préstamo',
        valores: ['pago_deuda', 'inversion', 'consumo', 'emergencia', 'otros'],
        impacto: 'Moderado',
        mejores: ['inversion', 'pago_deuda']
      },
      esReferido: {
        descripcion: 'Si el cliente fue referido por otro',
        tipo: 'boolean',
        impacto: 'Moderado',
        beneficio: '+5 puntos en score'
      },
      tieneGarantia: {
        descripcion: 'Si el cliente ofrece garantía',
        tipo: 'boolean',
        impacto: 'Alto',
        nota: 'Garantías reales (propiedades, vehículos) mejoran score'
      },
      montoGarantia: {
        descripcion: 'Valor de la garantía ofrecida',
        tipo: 'number',
        impacto: 'Alto',
        recomendacion: 'Mínimo 50% del monto solicitado'
      },
      montoSolicitado: {
        descripcion: 'Monto del préstamo solicitado',
        tipo: 'number',
        impacto: 'Crítico',
        relacion: 'No debe exceder 30% de ingresos anuales'
      },
      ingresosMensuales: {
        descripcion: 'Ingresos mensuales del cliente',
        tipo: 'number',
        impacto: 'Crítico',
        calculo: 'Base para capacidad de pago'
      }
    },
    metricas: {
      scoreMinimoAprobacion: 50,
      scoreOptimo: '80+',
      factoresPrioritarios: ['Capacidad de pago', 'Garantía', 'Congruencia Monto-Plazo'],
      plazoMaximoRecomendado: 'Cuota mensual ≤ 30% de ingresos',
      metodologia: 'Sistema de puntuación ponderada (0-100 puntos)'
    }
  });
});

module.exports = router;
