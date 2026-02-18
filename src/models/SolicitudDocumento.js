const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SolicitudDocumento = sequelize.define('SolicitudDocumento', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  solicitud_id: {
    type: DataTypes.UUID,
    allowNull: false
  },
  nombre_original: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  nombre_archivo: {
    type: DataTypes.STRING(255),
    allowNull: false
  },
  mime_type: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  size_bytes: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  ruta: {
    type: DataTypes.STRING(500),
    allowNull: false
  },
  creado_en: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'solicitud_documentos',
  timestamps: false
});

module.exports = SolicitudDocumento;
