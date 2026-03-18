const crypto = require('crypto');

const requestContext = (req, res, next) => {
  const incomingRequestId = req.headers['x-request-id'];
  const requestId = incomingRequestId || crypto.randomUUID();
  req.request_id = requestId;
  res.setHeader('x-request-id', requestId);
  next();
};

module.exports = {
  requestContext
};
