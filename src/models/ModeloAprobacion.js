const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const ModeloAprobacion = sequelize.define('ModeloAprobacion', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  reglas: {
    type: DataTypes.JSONB,
    allowNull: false,
    defaultValue: {}
  },
  puntaje_minimo: {
    type: DataTypes.DECIMAL(10, 2),
    allowNull: false,
    defaultValue: 0
  },
  activo: {
    type: DataTypes.BOOLEAN,
    defaultValue: true
  },
  creado_en: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'modelos_aprobacion',
  timestamps: false
});

module.exports = ModeloAprobacion;