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
  monto_solicitado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  plazo_semanas: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  tasa_variable: {
    type: DataTypes.DECIMAL(5, 4),
    defaultValue: 0.12
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
