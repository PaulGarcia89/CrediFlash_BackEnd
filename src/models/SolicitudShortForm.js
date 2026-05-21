const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const SolicitudShortForm = sequelize.define('SolicitudShortForm', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  nombre: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  apellido: {
    type: DataTypes.STRING(120),
    allowNull: false
  },
  telefono: {
    type: DataTypes.STRING(40),
    allowNull: false
  },
  email: {
    type: DataTypes.STRING(150),
    allowNull: false
  },
  monto_solicitado: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: false
  },
  modalidad: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'SEMANAL'
  },
  idioma: {
    type: DataTypes.STRING(20),
    allowNull: false,
    defaultValue: 'es'
  },
  origen: {
    type: DataTypes.STRING(50),
    allowNull: false,
    defaultValue: 'SHORT_FORM'
  },
  origin: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: null
  },
  source: {
    type: DataTypes.STRING(50),
    allowNull: true,
    defaultValue: null
  },
  estado: {
    type: DataTypes.STRING(30),
    allowNull: false,
    defaultValue: 'PENDIENTE'
  },
  manual: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  entry_source: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  requested_amount_source: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  ad_id: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  campaign_id: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  campaign_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  adset_id: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  adset_name: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  aid: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  utm_medium: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  utm_source: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  utm_id: {
    type: DataTypes.STRING(120),
    allowNull: true,
    defaultValue: null
  },
  utm_content: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  utm_term: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  utm_campaign: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  fbclid: {
    type: DataTypes.STRING(255),
    allowNull: true,
    defaultValue: null
  },
  requested_amount: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: null
  },
  ip_address: {
    type: DataTypes.STRING(80),
    allowNull: true,
    defaultValue: null
  },
  user_agent: {
    type: DataTypes.STRING(500),
    allowNull: true,
    defaultValue: null
  },
  tracking_payload: {
    type: DataTypes.JSONB,
    allowNull: true,
    defaultValue: null
  },
  created_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  },
  updated_at: {
    type: DataTypes.DATE,
    allowNull: false,
    defaultValue: DataTypes.NOW
  }
}, {
  tableName: 'solicitudes_short_form',
  timestamps: false
});

module.exports = SolicitudShortForm;
