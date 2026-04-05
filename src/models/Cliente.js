const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

const Cliente = sequelize.define('Cliente', {
  id: {
    type: DataTypes.UUID,
    defaultValue: DataTypes.UUIDV4,
    primaryKey: true
  },
  fecha_registro: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  },
  nombre: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  apellido: {
    type: DataTypes.STRING(100),
    allowNull: false
  },
  telefono: DataTypes.STRING(20),
  email: DataTypes.STRING(100),
  direccion: DataTypes.STRING(255),
  nombre_contacto: DataTypes.STRING(100),
  apellido_contacto: DataTypes.STRING(100),
  telefono_contacto: DataTypes.STRING(20),
  email_contacto: DataTypes.STRING(100),
  direccion_contacto: DataTypes.STRING(255),
  es_referido: {
    type: DataTypes.BOOLEAN,
    allowNull: false,
    defaultValue: false
  },
  referido_por: {
    type: DataTypes.STRING(150),
    allowNull: true
  },
  monto_referido: {
    type: DataTypes.DECIMAL(15, 2),
    allowNull: true,
    defaultValue: 0
  },
  descuentos_referido_disponibles: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  descuentos_referido_aplicados: {
    type: DataTypes.INTEGER,
    allowNull: false,
    defaultValue: 0
  },
  estado: {
    type: DataTypes.ENUM('ACTIVO', 'INACTIVO', 'SUSPENDIDO', 'BLOQUEADO'),
    defaultValue: 'ACTIVO'
  },
  motivo_estado: {
    type: DataTypes.TEXT,
    allowNull: true
  },
  observaciones: DataTypes.TEXT
}, {
  tableName: 'clientes',
  timestamps: false
});

// Método de instancia para obtener nombre completo
Cliente.prototype.getNombreCompleto = function() {
  return `${this.nombre} ${this.apellido}`;
};

// Método estático para buscar por nombre
Cliente.buscarPorNombre = async function(nombre) {
  return await this.findAll({
    where: {
      nombre: {
        [Op.iLike]: `%${nombre}%`
      }
    }
  });
};

module.exports = Cliente;
