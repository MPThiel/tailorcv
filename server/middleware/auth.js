function requireAdminAuth(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    res.set('WWW-Authenticate', 'Basic realm="TailorCV Admin"');
    return res.status(401).send('Authentication required.');
  }

  const base64 = authHeader.slice(6);
  const decoded = Buffer.from(base64, 'base64').toString('utf8');
  // Split on the first colon only — passwords may contain colons (RFC 7617)
  const colonIndex = decoded.indexOf(':');
  const user = decoded.slice(0, colonIndex);
  const pass = decoded.slice(colonIndex + 1);

  const validUser = process.env.ADMIN_USER || 'admin';
  const validPass = process.env.ADMIN_PASSWORD;

  if (!validPass) {
    console.error('ADMIN_PASSWORD env var not set — /admin is locked');
    return res.status(503).send('Admin not configured.');
  }

  if (user === validUser && pass === validPass) {
    return next();
  }

  res.set('WWW-Authenticate', 'Basic realm="TailorCV Admin"');
  return res.status(401).send('Invalid credentials.');
}

module.exports = { requireAdminAuth };
