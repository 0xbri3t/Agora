const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100000000,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests from this IP',
  skip: (req) => req.method === 'OPTIONS' || req.method === 'HEAD'
});

module.exports = limiter;
