const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const adminPassword = process.env.RIVALHIVE_ADMIN_PASSWORD || '';
const tokenTtlMs = 1000 * 60 * 60 * 6;
const sessions = new Map();
const reviewsFile = path.join(root, 'data', 'reviews.json');
const quotesFile = path.join(root, 'data', 'quotes.json');

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  if (Buffer.isBuffer(body)) return res.end(body);
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error('Request body too large'));
      }
    });
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); }
      catch { reject(new Error('Invalid JSON')); }
    });
  });
}

function readReviews() {
  try { return JSON.parse(fs.readFileSync(reviewsFile, 'utf8')); }
  catch { return []; }
}

function writeReviews(reviews) {
  fs.mkdirSync(path.dirname(reviewsFile), { recursive: true });
  fs.writeFileSync(reviewsFile, JSON.stringify(reviews, null, 2));
}

function readQuotes() {
  try { return JSON.parse(fs.readFileSync(quotesFile, 'utf8')); }
  catch { return []; }
}

function writeQuotes(quotes) {
  fs.mkdirSync(path.dirname(quotesFile), { recursive: true });
  fs.writeFileSync(quotesFile, JSON.stringify(quotes, null, 2));
}

function cleanReview(input) {
  const name = String(input.name || '').trim().slice(0, 40);
  const text = String(input.text || '').trim().slice(0, 400);
  const stars = Number(input.stars);
  if (!name) throw new Error('Name is required');
  if (!text || text.length < 10) throw new Error('Review must be at least 10 characters');
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) throw new Error('Star rating must be between 1 and 5');
  return {
    id: crypto.randomUUID(),
    name,
    text,
    stars,
    loc: String(input.loc || '').trim().slice(0, 50),
    service: String(input.service || '').trim().slice(0, 60),
    date: new Date().toISOString()
  };
}

function cleanQuote(input) {
  const name = String(input.name || '').trim().slice(0, 60);
  const contact = String(input.contact || '').trim().slice(0, 100);
  const service = String(input.service || '').trim().slice(0, 80);
  const message = String(input.message || '').trim().slice(0, 1000);
  if (!name) throw new Error('Name is required');
  if (!contact) throw new Error('Email or Instagram handle is required');
  if (!service) throw new Error('Please select a service');
  return {
    id: crypto.randomUUID(),
    name,
    contact,
    service,
    message,
    status: 'new',
    date: new Date().toISOString()
  };
}

function createToken() {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, Date.now() + tokenTtlMs);
  return token;
}

function hasAdmin(req) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const expires = sessions.get(token);
  if (!expires || expires < Date.now()) {
    sessions.delete(token);
    return false;
  }
  return true;
}

function serveStatic(req, res) {
  const raw = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(raw === '/' ? '/index.html' : raw).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(root, safePath);
  if (!filePath.startsWith(root)) return send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
  fs.readFile(filePath, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    send(res, 200, data, mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/api/reviews' && req.method === 'GET') {
      return send(res, 200, { reviews: readReviews() });
    }

    if (req.url === '/api/reviews' && req.method === 'POST') {
      const review = cleanReview(await readBody(req));
      const reviews = [...readReviews(), review];
      writeReviews(reviews);
      return send(res, 201, { review, reviews });
    }

    if (req.url === '/api/quotes' && req.method === 'POST') {
      const quote = cleanQuote(await readBody(req));
      const quotes = [...readQuotes(), quote];
      writeQuotes(quotes);
      return send(res, 201, { quote });
    }

    if (req.url === '/api/quotes' && req.method === 'GET') {
      if (!hasAdmin(req)) return send(res, 401, { error: 'Admin login required' });
      return send(res, 200, { quotes: readQuotes() });
    }

    if (req.url === '/api/admin/login' && req.method === 'POST') {
      const body = await readBody(req);
      if (!adminPassword) return send(res, 503, { error: 'Set RIVALHIVE_ADMIN_PASSWORD on the server first' });
      if (body.password !== adminPassword) return send(res, 401, { error: 'Invalid password' });
      return send(res, 200, { token: createToken() });
    }

    const deleteMatch = req.url.match(/^\/api\/reviews\/([^/?]+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      if (!hasAdmin(req)) return send(res, 401, { error: 'Admin login required' });
      const id = decodeURIComponent(deleteMatch[1]);
      const reviews = readReviews().filter(review => review.id !== id);
      writeReviews(reviews);
      return send(res, 200, { reviews });
    }

    const deleteQuoteMatch = req.url.match(/^\/api\/quotes\/([^/?]+)$/);
    if (deleteQuoteMatch && req.method === 'DELETE') {
      if (!hasAdmin(req)) return send(res, 401, { error: 'Admin login required' });
      const id = decodeURIComponent(deleteQuoteMatch[1]);
      const quotes = readQuotes().filter(quote => quote.id !== id);
      writeQuotes(quotes);
      return send(res, 200, { quotes });
    }

    return serveStatic(req, res);
  } catch (error) {
    return send(res, 400, { error: error.message || 'Request failed' });
  }
});

server.listen(port, () => {
  console.log(`RivalHive running at http://localhost:${port}`);
  if (!adminPassword) console.log('Set RIVALHIVE_ADMIN_PASSWORD to enable the admin panel.');
});
