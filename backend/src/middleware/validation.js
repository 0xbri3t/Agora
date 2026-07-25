const Joi = require('joi');

const validateProposal = (req, res, next) => {
  const schema = Joi.object({
    // Authentication fields (required by verifyWalletSignature middleware)
    address: Joi.string().optional(),
    signature: Joi.string().optional(),
    message: Joi.string().optional(),
    timestamp: Joi.number().optional(),
    // Proposal fields
    admin: Joi.string().required(),
    title: Joi.string().required(),
    description: Joi.string().required(),
    startTime: Joi.number().optional(),
    endTime: Joi.number().optional(),
    duration: Joi.number().optional().default(86400),
    // subjectToken is the model field; collateralToken kept as legacy alias
    subjectToken: Joi.string(),
    collateralToken: Joi.string(),
    maxSupply: Joi.string().required(),
    target: Joi.string().required(),
    data: Joi.string().optional(),
    marketAddress: Joi.string().optional(),
    proposalExecuted: Joi.boolean().optional(),
    proposalEnded: Joi.boolean().optional().default(false),
    isActive: Joi.boolean().optional()
  }).or('subjectToken', 'collateralToken');

  const { error } = schema.validate(req.body);
  if (error) {
    return res.status(400).json({ error: error.details[0].message });
  }
  next();
};

module.exports = {
  validateProposal
};
