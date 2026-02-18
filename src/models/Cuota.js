// src/models/Cuota.js - Modelo ajustado a tu estructura PostgreSQL
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

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
  fecha_vencimiento: {
    type: DataTypes.DATEONLY, // DATE para PostgreSQL
    allowNull: false
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
      // Calcular monto_total si no se proporciona
      if (!cuota.monto_total) {
        cuota.monto_total = parseFloat(
          (parseFloat(cuota.monto_capital) + parseFloat(cuota.monto_interes)).toFixed(2)
        );
      }
    },
    beforeUpdate: (cuota) => {
      // Actualizar estado basado en pagos
      if (cuota.monto_pagado >= cuota.monto_total) {
        cuota.estado = 'PAGADO';
        if (!cuota.fecha_pago) {
          cuota.fecha_pago = new Date();
        }
      } else if (cuota.monto_pagado > 0) {
        cuota.estado = 'PARCIAL';
      }
    }
  }
});

// ========== MÉTODOS DE INSTANCIA ==========

// Método para marcar cuota como pagada
Cuota.prototype.marcarComoPagada = async function(montoPagado, observaciones = null) {
  try {
    this.monto_pagado = parseFloat(montoPagado);
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
      this.estado = 'PARCIAL';
    }
    
    await this.save();
    
    return {
      success: true,
      mensaje: 'Pago registrado exitosamente',
      datos: {
        nuevo_estado: this.estado,
        saldo_pendiente: parseFloat((this.monto_total - this.monto_pagado).toFixed(2)),
        fecha_pago: this.fecha_pago
      }
    };
  } catch (error) {
    console.error('Error al marcar cuota como pagada:', error);
    throw error;
  }
};

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
    const { monto_total, plazo_meses, fecha_inicio, tasa_interes } = datosPrestamo;
    
    const cuotas = [];
    const montoCuota = parseFloat((monto_total / plazo_meses).toFixed(2));
    const montoCapitalCuota = parseFloat((montoCuota * 0.85).toFixed(2)); // 85% capital
    const montoInteresCuota = parseFloat((montoCuota * 0.15).toFixed(2)); // 15% interés
    
    let fechaVencimiento = new Date(fecha_inicio);
    
    for (let i = 1; i <= plazo_meses; i++) {
      fechaVencimiento.setMonth(fechaVencimiento.getMonth() + 1);
      
      cuotas.push({
        prestamo_id: prestamoId,
        fecha_vencimiento: new Date(fechaVencimiento),
        monto_capital: montoCapitalCuota,
        monto_interes: montoInteresCuota,
        monto_total: montoCuota,
        monto_pagado: 0,
        estado: 'PENDIENTE',
        observaciones: `Cuota ${i} de ${plazo_meses}`
      });
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
    const { monto_total, num_semanas, fecha_inicio } = datosPrestamo;
    const semanas = parseInt(num_semanas) || 0;

    if (!semanas || semanas <= 0) {
      throw new Error('num_semanas inválido para generar cuotas semanales');
    }

    const cuotas = [];
    const montoCuota = parseFloat((monto_total / semanas).toFixed(2));
    const montoCapitalCuota = parseFloat((montoCuota * 0.85).toFixed(2));
    const montoInteresCuota = parseFloat((montoCuota * 0.15).toFixed(2));

    let fechaVencimiento = new Date(fecha_inicio);

    for (let i = 1; i <= semanas; i++) {
      fechaVencimiento.setDate(fechaVencimiento.getDate() + 7);

      cuotas.push({
        prestamo_id: prestamoId,
        fecha_vencimiento: new Date(fechaVencimiento),
        monto_capital: montoCapitalCuota,
        monto_interes: montoInteresCuota,
        monto_total: montoCuota,
        monto_pagado: 0,
        estado: 'PENDIENTE',
        observaciones: `Cuota ${i} de ${semanas}`
      });
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
