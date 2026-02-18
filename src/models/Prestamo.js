const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Prestamo = sequelize.define('Prestamo', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  solicitud_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  fecha_inicio: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  mes: DataTypes.STRING(20),
  anio: DataTypes.STRING(4),
  nombre_completo: DataTypes.STRING(200),
  monto_solicitado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  interes: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  modalidad: {
    type: DataTypes.STRING(50),
    defaultValue: 'SEMANAL'
  },
  num_semanas: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  num_dias: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  fecha_vencimiento: DataTypes.DATE,
  fecha_aprobacion: {
    type: DataTypes.DATE,
    allowNull: true
  },
  total_pagar: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  ganancias: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  pagos_semanales: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  pagos_hechos: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  pagos_pendientes: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  pagado: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  pendiente: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  status: {
    type: DataTypes.STRING(20),
    defaultValue: 'ACTIVO'
  },
  ganancia_diaria: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  reserva: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  refinanciado: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  perdida: {
    type: DataTypes.DECIMAL(15, 2),
    defaultValue: 0
  },
  caso_especial: DataTypes.STRING(255),
  oferta: DataTypes.INTEGER,
  proyeccion_mes: DataTypes.STRING(255),
  anio_vencimiento: DataTypes.DATE
}, {
  tableName: 'prestamos',
  timestamps: false
});

// ========== GETTERS VIRTUALES PARA COMPATIBILIDAD ==========

Object.defineProperty(Prestamo.prototype, 'codigo_prestamo', {
  get() {
    return `PR-${this.id ? this.id.slice(0, 8).toUpperCase() : Date.now().toString().slice(-8)}`;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'monto_principal', {
  get() {
    return this.monto_solicitado;
  },
  set(value) {
    this.monto_solicitado = value;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'estado', {
  get() {
    return this.status;
  },
  set(value) {
    this.status = value;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'plazo_meses', {
  get() {
    // Calcular a partir de num_semanas si es semanal, o usar valor por defecto
    if (this.modalidad === 'SEMANAL' && this.num_semanas > 0) {
      return Math.ceil(this.num_semanas / 4.33); // Aproximación de semanas a meses
    }
    return 12; // Valor por defecto
  },
  set(value) {
    // Si se establece plazo_meses, ajustar num_semanas
    if (this.modalidad === 'SEMANAL') {
      this.num_semanas = value * 4.33; // Aproximación de meses a semanas
    }
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'tasa_interes_anual', {
  get() {
    return this.interes; // interes ya está en porcentaje
  },
  set(value) {
    this.interes = value;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'tasa_interes_mensual', {
  get() {
    return this.interes / 12; // Calcular mensual a partir de anual
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'monto_total', {
  get() {
    return this.total_pagar || 0;
  },
  set(value) {
    this.total_pagar = value;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'saldo_pendiente', {
  get() {
    return this.pendiente || 0;
  },
  set(value) {
    this.pendiente = value;
  },
  enumerable: true,
  configurable: true
});

Object.defineProperty(Prestamo.prototype, 'monto_pagado', {
  get() {
    return this.pagado || 0;
  },
  set(value) {
    this.pagado = value;
  },
  enumerable: true,
  configurable: true
});

// ========== MÉTODOS DE INSTANCIA ==========

Prestamo.prototype.calcularCuotaMensual = function() {
  if (!this.monto_principal || !this.tasa_interes_mensual || !this.plazo_meses) {
    return 0;
  }
  
  const tasaMensual = this.tasa_interes_mensual / 100;
  if (tasaMensual === 0) {
    return this.monto_principal / this.plazo_meses;
  }
  
  const factor = Math.pow(1 + tasaMensual, this.plazo_meses);
  const cuota = (this.monto_principal * tasaMensual * factor) / (factor - 1);
  
  return parseFloat(cuota.toFixed(2));
};

Prestamo.prototype.registrarPago = async function(monto, fechaPago = new Date()) {
  this.monto_pagado += parseFloat(monto);
  this.saldo_pendiente = this.monto_total - this.monto_pagado;
  
  // Actualizar campos reales
  this.pagado = this.monto_pagado;
  this.pendiente = this.saldo_pendiente;
  
  // Actualizar estado si está pagado
  if (this.saldo_pendiente <= 0) {
    this.estado = 'PAGADO';
  }
  
  await this.save();
  
  return {
    nuevoSaldo: this.saldo_pendiente,
    estado: this.estado
  };
};

module.exports = Prestamo;
