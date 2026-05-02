const dns = require('dns').promises;
const net = require('net');

// Returns true if the dotted-decimal IPv4 address falls within the given CIDR block.
function ipv4InCidr(ip, cidrBase, prefixLen) {
  const ipInt = ip.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
  const baseInt = cidrBase.split('.').reduce((acc, oct) => (acc << 8) | parseInt(oct, 10), 0) >>> 0;
  const mask = prefixLen === 0 ? 0 : (~0 << (32 - prefixLen)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const BLOCKED_IPV4 = [
  // Loopback — requests would hit the server process itself
  { base: '127.0.0.0', prefix: 8 },
  // RFC 1918 private networks — unreachable from the public internet
  { base: '10.0.0.0',  prefix: 8 },
  { base: '172.16.0.0', prefix: 12 },
  { base: '192.168.0.0', prefix: 16 },
  // Link-local / AWS EC2 instance metadata endpoint (169.254.169.254)
  { base: '169.254.0.0', prefix: 16 },
];

async function validateUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error('Invalid or disallowed URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Invalid or disallowed URL');
  }

  const hostname = parsed.hostname;

  // Reject bare IPv6 loopback before DNS lookup
  if (hostname === '::1' || hostname === '[::1]') {
    throw new Error('Invalid or disallowed URL');
  }

  let address;
  try {
    const result = await dns.lookup(hostname);
    address = result.address;
  } catch {
    throw new Error('Invalid or disallowed URL');
  }

  // IPv6 loopback resolved address
  if (address === '::1') {
    throw new Error('Invalid or disallowed URL');
  }

  if (net.isIPv4(address)) {
    for (const { base, prefix } of BLOCKED_IPV4) {
      if (ipv4InCidr(address, base, prefix)) {
        throw new Error('Invalid or disallowed URL');
      }
    }
  }
}

module.exports = { validateUrl };
