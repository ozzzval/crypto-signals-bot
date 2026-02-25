const { handleUpdate } = require('../index');

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.status(200).json({ status: 'Bot de Senales Crypto - OK' });
    return;
  }
  
  try {
    const update = req.body;
    await handleUpdate(update);
    res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ ok: false, error: error.message });
  }
};
