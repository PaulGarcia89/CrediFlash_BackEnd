const { Cliente } = require('../models');
const {
  assertClienteEdadMinima,
  formatDateOnly
} = require('../utils/clienteEdad');

exports.list = async (req, res) => {
  try {
    const items = await Cliente.findAll();
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.get = async (req, res) => {
  try {
    const item = await Cliente.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

exports.create = async (req, res) => {
  try {
    if (!String(req.body?.fecha_nacimiento || '').trim()) {
      throw new Error('Debes ingresar la fecha de nacimiento del cliente.');
    }

    assertClienteEdadMinima(
      { fecha_nacimiento: req.body.fecha_nacimiento },
      { requireFechaNacimiento: true }
    );

    const payload = { ...req.body };
    if (payload.fecha_nacimiento !== undefined) {
      payload.fecha_nacimiento = formatDateOnly(payload.fecha_nacimiento);
    }

    const created = await Cliente.create(payload);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.update = async (req, res) => {
  try {
    const item = await Cliente.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    await item.update(req.body);
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
};

exports.remove = async (req, res) => {
  try {
    const item = await Cliente.findByPk(req.params.id);
    if (!item) return res.status(404).json({ error: 'No encontrado' });
    await item.destroy();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
