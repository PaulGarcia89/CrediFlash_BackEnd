const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Solicitud = sequelize.define('Solicitud', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  cliente_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  analista_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  modelo_aprobacion_id: {
    type: DataTypes.UUID,
    allowNull: true
  },
  modelo_calificacion: {
    type: DataTypes.STRING(20),
    allowNull: true
  },
  origen: {
    type: DataTypes.STRING(30),
    allowNull: true,
    defaultValue: 'INTERNO'
  },
  origen_solicitud: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'INTERNO'
  },
  es_publica: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  es_externa: {
    type: DataTypes.BOOLEAN,
    allowNull: true,
    defaultValue: false
  },
  canal_registro: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'INTERNO'
  },
  source: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'INTERNAL'
  },
  solicitud_enviada_en: {
    type: DataTypes.DATE,
    allowNull: true
  },
  fecha_envio_solicitud: {
    type: DataTypes.DATE,
    allowNull: true
  },
  modalidad: {
    type: DataTypes.STRING(20),
    allowNull: true,
    defaultValue: 'SEMANAL'
  },
  interes_porcentaje: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    defaultValue: null
  },
  tasa_base: {
    type: DataTypes.DECIMAL(10, 4),
    allowNull: true,
    defaultValue: null
  },
  monto_solicitado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  plazo_semanas: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  tasa_variable: {
    type: DataTypes.DECIMAL(10, 4),
    defaultValue: null
  },
  interes_total: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  numero_cuotas: {
    type: DataTypes.INTEGER,
    allowNull: true,
    defaultValue: null
  },
  valor_cuota: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  fecha_fin: {
    type: DataTypes.DATE,
    allowNull: true,
    defaultValue: null
  },
  estado: {
    type: DataTypes.ENUM('PENDIENTE', 'APROBADO', 'RECHAZADO'),
    defaultValue: 'PENDIENTE'
  },
  creado_en: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  fecha_aprobacion: {
    type: DataTypes.DATE,
    allowNull: true
  },
  destino: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  }
}, {
  tableName: 'solicitudes',
  timestamps: false
});

module.exports = Solicitud;
