const L = require('./_lib');

module.exports = async (req, res) => {
  L.noStore(res);
  L.clearSessionCookie(res);
  return res.status(200).json({ ok: true });
};
