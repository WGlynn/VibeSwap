// ============ Input Validation Middleware ============

const SYMBOL_PATTERN = /^[A-Za-z]{2,10}$/;

export function validateSymbol(param) {
  return (req, res, next) => {
    const value = req.params[param];
    if (!value || !SYMBOL_PATTERN.test(value)) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid symbol: must be 2-10 alpha characters`,
      });
    }
    next();
  };
}

export function validateChainId(param) {
  return (req, res, next) => {
    const raw = req.params[param];
    const parsed = parseInt(raw, 10);
    if (isNaN(parsed) || parsed <= 0 || String(parsed) !== raw) {
      return res.status(400).json({
        error: 'Bad Request',
        message: `Invalid chain ID: must be a positive integer`,
      });
    }
    next();
  };
}
