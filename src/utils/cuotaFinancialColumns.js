const ensureCuotaFinancialColumns = async (sequelize) => {
  await sequelize.query(`
    ALTER TABLE public.cuotas
      ADD COLUMN IF NOT EXISTS numero_cuota INTEGER NULL,
      ADD COLUMN IF NOT EXISTS capital_programado DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS interes_programado DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS total_programado DECIMAL(15,2) NULL,
      ADD COLUMN IF NOT EXISTS capital_pagado DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS interes_pagado DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS mora_pagada DECIMAL(15,2) NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS saldo_restante DECIMAL(15,2) NOT NULL DEFAULT 0
  `);

  await sequelize.query(`
    UPDATE public.cuotas
    SET
      numero_cuota = COALESCE(numero_cuota, 1),
      capital_programado = COALESCE(capital_programado, monto_capital, 0),
      interes_programado = COALESCE(interes_programado, monto_interes, 0),
      total_programado = COALESCE(total_programado, monto_total, COALESCE(monto_capital, 0) + COALESCE(monto_interes, 0)),
      capital_pagado = COALESCE(capital_pagado, 0),
      interes_pagado = COALESCE(interes_pagado, 0),
      mora_pagada = COALESCE(mora_pagada, 0),
      saldo_restante = COALESCE(saldo_restante, monto_total - COALESCE(monto_pagado, 0), 0)
    WHERE
      numero_cuota IS NULL
      OR capital_programado IS NULL
      OR interes_programado IS NULL
      OR total_programado IS NULL
      OR capital_pagado IS NULL
      OR interes_pagado IS NULL
      OR mora_pagada IS NULL
      OR saldo_restante IS NULL
  `);
};

module.exports = {
  ensureCuotaFinancialColumns
};
