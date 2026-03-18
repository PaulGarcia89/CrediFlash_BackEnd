const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const PagoBancarioCargado = sequelize.define(
  'PagoBancarioCargado',
  {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true
    },
    lote_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    nombre_completo: {
      type: DataTypes.STRING(200),
      allowNull: false
    },
    monto: {
      type: DataTypes.DECIMAL(14, 2),
      allowNull: false
    },
    fecha_pago: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    archivo_nombre: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    fila_origen: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    estado: {
      type: DataTypes.ENUM('VALIDO', 'INVALIDO', 'PROCESADO', 'DUPLICADO'),
      allowNull: false,
      defaultValue: 'VALIDO'
    },
    observacion: {
      type: DataTypes.TEXT,
      allowNull: true
    },
    creado_por_analista_id: {
      type: DataTypes.UUID,
      allowNull: false
    },
    creado_en: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    },
    actualizado_en: {
      type: DataTypes.DATE,
      allowNull: false,
      defaultValue: DataTypes.NOW
    }
  },
  {
    tableName: 'pagos_bancarios_cargados',
    timestamps: false,
    indexes: [
      {
        name: 'idx_pagos_bancarios_lote_id',
        fields: ['lote_id']
      },
      {
        name: 'idx_pagos_bancarios_fecha_pago',
        fields: ['fecha_pago']
      },
      {
        name: 'idx_pagos_bancarios_creado_por',
        fields: ['creado_por_analista_id']
      },
      {
        name: 'uq_pagos_bancarios_archivo_fila',
        unique: true,
        fields: ['nombre_completo', 'monto', 'fecha_pago', 'archivo_nombre', 'fila_origen']
      }
    ]
  }
);

module.exports = PagoBancarioCargado;
