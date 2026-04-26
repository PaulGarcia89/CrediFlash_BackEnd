const buildClienteNombreCompleto = (cliente = {}) => {
  const nombre = String(cliente?.nombre || '').trim();
  const apellido = String(cliente?.apellido || '').trim();
  const completo = [nombre, apellido].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  return completo || null;
};

module.exports = {
  buildClienteNombreCompleto
};
