// src/models/Cuota.js - Modelo ajustado a tu estructura PostgreSQL
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const {
  buildInstallmentDates,
  round2
} = require('../services/financial/scheduleService');
const {
  calculateFlatLoanPricing,
  resolveNumeroCuotas
} = require('../services/financial/loanPricingService');

const Cuota = sequelize.define('Cuota', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  prestamo_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  numero_cuota: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  fecha_vencimiento: {
    type: DataTypes.DATEONLY, // DATE para PostgreSQL
    allowNull: false
  },
  capital_programado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  interes_programado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  total_programado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  monto_capital: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  monto_interes: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  monto_total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  estado: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'PENDIENTE'
  },
  fecha_pago: {
    type: DataTypes.DATE,
    allowNull: true
  },
  monto_pagado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: 0
  },
  capital_pagado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  interes_pagado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  mora_pagada: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  saldo_restante: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  monto_fee_acumulado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  monto_penalizacion_acumulada: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false,
    defaultValue: 0
  },
  motivo_fee: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  ultimo_recordatorio_email_enviado_en: {
    type: DataTypes.DATE,
    allowNull: true
  },
  observaciones: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  created_at: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'cuotas',
  timestamps: false, // No usar timestamps automáticos ya que tienes created_at
  underscored: true, // Para mapear snake_case
  hooks: {
    beforeCreate: (cuota) => {
      const capitalProgramado = round2(cuota.capital_programado ?? cuota.monto_capital);
      const interesProgramado = round2(cuota.interes_programado ?? cuota.monto_interes);
      const totalProgramado = round2(cuota.total_programado ?? cuota.monto_total ?? capitalProgramado + interesProgramado);

      cuota.capital_programado = capitalProgramado;
      cuota.interes_programado = interesProgramado;
      cuota.total_programado = totalProgramado;
      cuota.monto_capital = capitalProgramado;
      cuota.monto_interes = interesProgramado;
      cuota.monto_total = totalProgramado;
      cuota.capital_pagado = round2(cuota.capital_pagado);
      cuota.interes_pagado = round2(cuota.interes_pagado);
      cuota.mora_pagada = round2(cuota.mora_pagada);
      cuota.saldo_restante = round2(Math.max(totalProgramado - round2(cuota.monto_pagado), 0));
    },
    beforeUpdate: (cuota) => {
      // Actualizar estado basado en pagos
      if (cuota.monto_pagado >= cuota.monto_total) {
        cuota.estado = 'PAGADO';
        if (!cuota.fecha_pago) {
          cuota.fecha_pago = new Date();
        }
      } else if (cuota.monto_pagado > 0) {
        // Mantener compatibilidad con constraints de BD que no aceptan PARCIAL
        cuota.estado = 'PENDIENTE';
      }

      cuota.saldo_restante = round2(Math.max(round2(cuota.monto_total) - round2(cuota.monto_pagado), 0));
    }
  }
});

// ========== MÉTODOS DE INSTANCIA ==========

// Método para marcar cuota como pagada
Cuota.prototype.marcarComoPagada = async function(montoPagado, observaciones = null) {
  try {
    const pagoAcumulado = parseFloat(this.monto_pagado || 0) + parseFloat(montoPagado);
    this.monto_pagado = parseFloat(pagoAcumulado.toFixed(2));
    this.capital_pagado = parseFloat(Math.min(parseFloat(this.capital_pagado || 0) + parseFloat(montoPagado), parseFloat(this.capital_programado || this.monto_capital || 0)).toFixed(2));
    this.interes_pagado = parseFloat(Math.min(parseFloat(this.interes_pagado || 0), parseFloat(this.interes_programado || this.monto_interes || 0)).toFixed(2));
    this.saldo_restante = parseFloat(Math.max(parseFloat(this.monto_total || 0) - this.monto_pagado, 0).toFixed(2));
    this.fecha_pago = new Date();
    
    // Actualizar observaciones
    if (observaciones) {
      this.observaciones = this.observaciones 
        ? `${this.observaciones}\n${observaciones}`
        : observaciones;
    }
    
    // Actualizar estado automáticamente
    if (this.monto_pagado >= this.monto_total) {
      this.estado = 'PAGADO';
    } else if (this.monto_pagado > 0) {
      this.estado = 'PENDIENTE';
    }
    
    await this.save();
    
    return {
      success: true,
      mensaje: 'Pago registrado exitosamente',
      datos: {
        nuevo_estado: this.estado,
        saldo_pendiente: parseFloat((this.monto_total - this.monto_pagado).toFixed(2)),
        saldo_restante: this.saldo_restante,
        fecha_pago: this.fecha_pago
      }
    };
  } catch (error) {
    console.error('Error al marcar cuota como pagada:', error);
    throw error;
  }
};

Object.defineProperty(Cuota.prototype, 'saldo_pendiente', {
  get() {
    const total = parseFloat(this.monto_total || 0);
    const pagado = parseFloat(this.monto_pagado || 0);
    return parseFloat(Math.max(total - pagado, 0).toFixed(2));
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Cuota.prototype, 'monto_pendiente', {
  get() {
    return this.saldo_pendiente;
  },
  enumerable: true,
  configurable: true
});

// Método para verificar si la cuota está vencida
Cuota.prototype.estaVencida = function() {
  if (!this.fecha_vencimiento || this.estado === 'PAGADO') {
    return false;
  }
  
  const hoy = new Date();
  const fechaVencimiento = new Date(this.fecha_vencimiento);
  return hoy > fechaVencimiento;
};

// Método para calcular días de mora
Cuota.prototype.calcularDiasMora = function() {
  if (!this.estaVencida() || this.estado === 'PAGADO') {
    return 0;
  }
  
  const hoy = new Date();
  const fechaVencimiento = new Date(this.fecha_vencimiento);
  const diffTime = Math.abs(hoy - fechaVencimiento);
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

// ========== MÉTODOS ESTÁTICOS ==========

// Generar cuotas para un préstamo
Cuota.generarCuotasParaPrestamo = async function(prestamoId, datosPrestamo) {
  try {
    const {
      monto_total,
      monto_original,
      monto_solicitado,
      plazo_meses,
      numero_cuotas,
      fecha_inicio,
      fecha_aprobacion,
      tasa_interes,
      interes_porcentaje,
      modalidad = 'MENSUAL'
    } = datosPrestamo;

    const cuotas = [];
    const principal = Number(monto_original ?? monto_solicitado ?? monto_total);
    const tasa = Number(interes_porcentaje ?? tasa_interes);
    const totalCuotas = resolveNumeroCuotas({
      numeroCuotas: numero_cuotas,
      plazoSemanas: plazo_meses,
      modalidad
    });

    if (Number.isFinite(principal) && principal > 0 && Number.isFinite(tasa) && totalCuotas > 0) {
      const financial = calculateFlatLoanPricing({
        montoOriginal: principal,
        interesPorcentaje: tasa,
        modalidad,
        numeroCuotas: totalCuotas,
        fechaInicio: fecha_inicio,
        fechaAprobacion
      });

      financial.cronograma.forEach((cuota) => {
        cuotas.push({
          prestamo_id: prestamoId,
          ...cuota
        });
      });
    } else {
      const scheduleDates = buildInstallmentDates({
        modalidad,
        numeroCuotas: totalCuotas,
        fechaInicio: fecha_inicio,
        fechaAprobacion
      });
      const montoBase = totalCuotas > 0 ? round2(Number(monto_total || 0) / totalCuotas) : round2(monto_total || 0);
      const capitalBase = totalCuotas > 0 ? round2(montoBase * 0.85) : round2(monto_total || 0);
      const interesBase = totalCuotas > 0 ? round2(montoBase - capitalBase) : 0;

      for (let i = 1; i <= totalCuotas; i += 1) {
        const esUltima = i === totalCuotas;
        const montoCuota = esUltima
          ? round2(Number(monto_total || 0) - round2(montoBase * (totalCuotas - 1)))
          : montoBase;
        const montoCapitalCuota = esUltima
          ? round2(Number(monto_total || 0) * 0.85 - round2(capitalBase * (totalCuotas - 1)))
          : capitalBase;
        const montoInteresCuota = esUltima
          ? round2(montoCuota - montoCapitalCuota)
          : interesBase;

        cuotas.push({
          prestamo_id: prestamoId,
          numero_cuota: i,
          fecha_vencimiento: scheduleDates[i - 1],
          capital_programado: montoCapitalCuota,
          interes_programado: montoInteresCuota,
          total_programado: montoCuota,
          monto_capital: montoCapitalCuota,
          monto_interes: montoInteresCuota,
          monto_total: montoCuota,
          monto_pagado: 0,
          capital_pagado: 0,
          interes_pagado: 0,
          mora_pagada: 0,
          saldo_restante: montoCuota,
          estado: 'PENDIENTE',
          observaciones: `Cuota ${i} de ${totalCuotas}`
        });
      }
    }

    const cuotasCreadas = await Cuota.bulkCreate(cuotas);
    
    console.log(`✅ Generadas ${cuotasCreadas.length} cuotas para préstamo ${prestamoId}`);
    
    return cuotasCreadas;
  } catch (error) {
    console.error('Error generando cuotas para préstamo:', error);
    throw error;
  }
};

// Generar cuotas SEMANALES para un préstamo
Cuota.generarCuotasSemanalesParaPrestamo = async function(prestamoId, datosPrestamo) {
  try {
    const {
      monto_total,
      monto_original,
      monto_solicitado,
      num_semanas,
      numero_cuotas,
      fecha_inicio,
      fecha_aprobacion,
      fecha_primer_pago,
      fecha_primer_vencimiento,
      modalidad = 'SEMANAL',
      interes_porcentaje,
      tasa_interes
    } = datosPrestamo;
    const principal = Number(monto_original ?? monto_solicitado ?? monto_total);
    const tasa = Number(interes_porcentaje ?? tasa_interes);
    const semanas = resolveNumeroCuotas({
      numeroCuotas: numero_cuotas,
      plazoSemanas: num_semanas,
      modalidad
    });

    if (!semanas || semanas <= 0) {
      throw new Error('num_semanas inválido para generar cuotas semanales');
    }

    const cuotas = [];
    const financial = Number.isFinite(principal) && principal > 0 && Number.isFinite(tasa)
      ? calculateFlatLoanPricing({
          montoOriginal: principal,
          interesPorcentaje: tasa,
          modalidad,
          numeroCuotas: semanas,
          fechaInicio: fecha_inicio,
          fechaAprobacion: fecha_aprobacion,
          fechaPrimerPago: fecha_primer_pago,
          fechaPrimerVencimiento: fecha_primer_vencimiento
        })
      : null;

    if (financial) {
      financial.cronograma.forEach((cuota) => {
        cuotas.push({
          prestamo_id: prestamoId,
          ...cuota
        });
      });
    } else {
      const montoCuota = round2(monto_total / semanas);
      const montoCapitalCuota = round2(montoCuota * 0.85);
      const montoInteresCuota = round2(montoCuota - montoCapitalCuota);

      const fechasVencimiento = buildInstallmentDates({
        modalidad,
        numeroCuotas: semanas,
        fechaInicio: fecha_inicio,
        fechaAprobacion: fecha_aprobacion,
        fechaPrimerPago: fecha_primer_pago,
        fechaPrimerVencimiento: fecha_primer_vencimiento
      });

      for (let i = 1; i <= semanas; i++) {
        const fechaVencimiento = fechasVencimiento[i - 1];

        cuotas.push({
          prestamo_id: prestamoId,
          numero_cuota: i,
          fecha_vencimiento: fechaVencimiento,
          capital_programado: montoCapitalCuota,
          interes_programado: montoInteresCuota,
          total_programado: montoCuota,
          monto_capital: montoCapitalCuota,
          monto_interes: montoInteresCuota,
          monto_total: montoCuota,
          monto_pagado: 0,
          capital_pagado: 0,
          interes_pagado: 0,
          mora_pagada: 0,
          saldo_restante: montoCuota,
          estado: 'PENDIENTE',
          observaciones: `Cuota ${i} de ${semanas}`
        });
      }
    }

    const cuotasCreadas = await Cuota.bulkCreate(cuotas);
    console.log(`✅ Generadas ${cuotasCreadas.length} cuotas semanales para préstamo ${prestamoId}`);
    return cuotasCreadas;
  } catch (error) {
    console.error('Error generando cuotas semanales para préstamo:', error);
    throw error;
  }
};

// Obtener cuotas por préstamo
Cuota.obtenerCuotasPorPrestamo = async function(prestamoId) {
  try {
    const cuotas = await Cuota.findAll({
      where: { prestamo_id: prestamoId },
      order: [['fecha_vencimiento', 'ASC']]
    });
    
    return cuotas;
  } catch (error) {
    console.error('Error obteniendo cuotas por préstamo:', error);
    throw error;
  }
};

// Obtener cuotas vencidas
Cuota.obtenerCuotasVencidas = async function() {
  const { Op } = require('sequelize');
  const hoy = new Date();
  
  try {
    const cuotasVencidas = await Cuota.findAll({
      where: {
        estado: { [Op.ne]: 'PAGADO' }, // No pagadas
        fecha_vencimiento: { [Op.lt]: hoy }
      },
      order: [['fecha_vencimiento', 'ASC']]
    });
    
    return cuotasVencidas;
  } catch (error) {
    console.error('Error obteniendo cuotas vencidas:', error);
    throw error;
  }
};

// Calcular resumen de cuotas
Cuota.obtenerResumenCuotas = async function(prestamoId) {
  try {
    const cuotas = await Cuota.findAll({
      where: { prestamo_id: prestamoId }
    });
    
    const resumen = {
      total_cuotas: cuotas.length,
      pagadas: cuotas.filter(c => c.estado === 'PAGADO').length,
      pendientes: cuotas.filter(c => c.estado === 'PENDIENTE').length,
      parciales: cuotas.filter(c => c.estado === 'PARCIAL').length,
      vencidas: cuotas.filter(c => {
        if (!c.fecha_vencimiento || c.estado === 'PAGADO') return false;
        const hoy = new Date();
        const fechaVencimiento = new Date(c.fecha_vencimiento);
        return hoy > fechaVencimiento;
      }).length,
      monto_total: parseFloat(cuotas.reduce((sum, c) => sum + parseFloat(c.monto_total || 0), 0).toFixed(2)),
      monto_pagado: parseFloat(cuotas.reduce((sum, c) => sum + parseFloat(c.monto_pagado || 0), 0).toFixed(2)),
      capital_programado: parseFloat(cuotas.reduce((sum, c) => sum + parseFloat((c.capital_programado ?? c.monto_capital ?? 0)), 0).toFixed(2)),
      interes_programado: parseFloat(cuotas.reduce((sum, c) => sum + parseFloat((c.interes_programado ?? c.monto_interes ?? 0)), 0).toFixed(2)),
      monto_pendiente: parseFloat(cuotas.reduce((sum, c) => 
        sum + (parseFloat(c.monto_total || 0) - parseFloat(c.monto_pagado || 0)), 0).toFixed(2))
    };
    
    return resumen;
  } catch (error) {
    console.error('Error calculando resumen de cuotas:', error);
    throw error;
  }
};

module.exports = Cuota;
