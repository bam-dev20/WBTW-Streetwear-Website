require("dotenv").config();
const express = require("express");
const session = require("express-session");
const SQLiteStore = require("connect-sqlite3")(session);
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const app = express();

// Railway reverse proxy configuration
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const isProduction = process.env.NODE_ENV === "production";

/* =========================================
   PERSISTENT STORAGE (Railway Volume at /data)
========================================= */
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || path.join(ROOT, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// One-time copy of old local files into the volume (only if the volume is empty)
const LEGACY_DB = path.join(ROOT, "data", "wbtw.sqlite");
const NEW_DB = path.join(DATA_DIR, "wbtw.sqlite");
if (DATA_DIR !== path.join(ROOT, "data") && !fs.existsSync(NEW_DB) && fs.existsSync(LEGACY_DB)) {
  fs.copyFileSync(LEGACY_DB, NEW_DB);
  console.log("Copied existing database into persistent volume.");
}
const LEGACY_UPLOADS = path.join(ROOT, "uploads");
if (fs.existsSync(LEGACY_UPLOADS) && LEGACY_UPLOADS !== UPLOAD_DIR) {
  for (const f of fs.readdirSync(LEGACY_UPLOADS)) {
    const dest = path.join(UPLOAD_DIR, f);
    if (!fs.existsSync(dest)) fs.copyFileSync(path.join(LEGACY_UPLOADS, f), dest);
  }
}

/* =========================================
   DATABASE
========================================= */
const db = new Database(NEW_DB);
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('Shirts','T-Shirts','Hoodies')),
  price REAL NOT NULL,
  compare_price REAL DEFAULT NULL,
  description TEXT DEFAULT '',
  image TEXT DEFAULT '',
  sizes TEXT DEFAULT 'S,M,L,XL',
  colors TEXT DEFAULT '',
  stock INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS admins (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  customer_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT DEFAULT '',
  items TEXT NOT NULL,
  total REAL NOT NULL,
  status TEXT DEFAULT 'Pending',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);

// Migration: older databases only allowed 'Shirts' and 'Hoodies'
const productsSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='products'").get();
if (productsSql && !productsSql.sql.includes("T-Shirts")) {
  const cols = "id,name,category,price,compare_price,description,image,sizes,colors,stock,featured,active,created_at";
  db.transaction(() => {
    db.exec(`
      ALTER TABLE products RENAME TO products_old;
      CREATE TABLE products (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('Shirts','T-Shirts','Hoodies')),
        price REAL NOT NULL,
        compare_price REAL DEFAULT NULL,
        description TEXT DEFAULT '',
        image TEXT DEFAULT '',
        sizes TEXT DEFAULT 'S,M,L,XL',
        colors TEXT DEFAULT '',
        stock INTEGER DEFAULT 0,
        featured INTEGER DEFAULT 0,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO products(${cols}) SELECT ${cols} FROM products_old;
      DROP TABLE products_old;
    `);
  })();
  console.log("Migrated products table to allow T-Shirts.");
}

// Migration: gallery support (JSON array of image paths; "image" stays as the cover)
if (!db.prepare("PRAGMA table_info(products)").all().some(c => c.name === "images")) {
  db.exec("ALTER TABLE products ADD COLUMN images TEXT DEFAULT '[]'");
  console.log("Added images column to products.");
}

// Customer accounts (email one-time code sign-in)
db.exec(`
CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  address TEXT DEFAULT '',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  last_login_at TEXT
);
CREATE TABLE IF NOT EXISTS login_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER DEFAULT 0,
  used INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_email ON login_codes(email);
`);
if (!db.prepare("PRAGMA table_info(orders)").all().some(c => c.name === "customer_id")) {
  db.exec("ALTER TABLE orders ADD COLUMN customer_id INTEGER DEFAULT NULL");
  console.log("Added customer_id column to orders.");
}

const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";
if (!db.prepare("SELECT id FROM admins WHERE username=?").get(adminUser)) {
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)")
    .run(adminUser, bcrypt.hashSync(adminPass, 12));
}

const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (!count) {
  const seed = db.prepare(`INSERT INTO products(name,category,price,description,image,sizes,colors,stock,featured)
    VALUES(?,?,?,?,?,?,?,?,?)`);
  seed.run("WBTW Signature Oversized Tee","Shirts",699,"Premium everyday oversized fit. Designed with purpose.","https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1000&q=85","S,M,L,XL,XXL","Black,White",30,1);
  seed.run("The Wise Graphic Tee","Shirts",699,"A graphic staple for everyday confidence.","https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1000&q=85","S,M,L,XL","Black,White",25,1);
  seed.run("WBTW Heavyweight Hoodie","Hoodies",1299,"A heavyweight layer with a relaxed silhouette.","https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1000&q=85","S,M,L,XL,XXL","Black,Charcoal",18,1);
  seed.run("Core Pullover Hoodie","Hoodies",1199,"Minimal design. Everyday comfort.","https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1000&q=85","S,M,L,XL","Black,Grey",12,0);
}

/* =========================================
   MIDDLEWARE
========================================= */
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },

  // Only enforce HTTPS in production
  strictTransportSecurity: isProduction ? undefined : false,

  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      // allow own images, uploads, previews (blob:) and external https images
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "upgrade-insecure-requests": isProduction ? [] : null
    }
  }
}));
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: DATA_DIR }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    maxAge: 8 * 60 * 60 * 1000
  }
}));

app.use("/uploads", express.static(UPLOAD_DIR, { dotfiles: "deny", index: false }));
app.use(express.static(path.join(ROOT, "public")));

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false
});

/* =========================================
   IMAGE UPLOAD (saved to the persistent volume)
========================================= */
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) =>
    cb(null, Date.now() + "-" + Math.round(Math.random() * 1e9) + path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, WEBP or GIF images are allowed."), ok);
  }
});

const MAX_IMAGES = 8;

// Accepts the new multi-image field and the old single-image field
const uploadImages = upload.fields([
  { name: "imageFiles", maxCount: MAX_IMAGES },
  { name: "imageFile", maxCount: 1 }
]);
const uploadedFiles = req => {
  const f = req.files || {};
  return [...(f.imageFiles || []), ...(f.imageFile || [])];
};

// Delete a stored upload file (only files inside /uploads/)
function removeUpload(imagePath) {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/")) return;
  const file = path.join(UPLOAD_DIR, path.basename(imagePath));
  fs.unlink(file, () => {});
}

function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  return res.status(401).json({ error: "Please sign in again." });
}

/* =========================================
   PUBLIC API
========================================= */
function parseList(value) {
  try {
    const a = JSON.parse(value);
    return Array.isArray(a) ? a.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

// All images of a product (cover first). Falls back to the old single "image" column.
function imagesOf(row) {
  const list = parseList(row.images);
  return list.length ? list : (row.image ? [row.image] : []);
}

const shapeProduct = p => ({
  ...p,
  images: imagesOf(p),
  sizes: p.sizes.split(",").filter(Boolean),
  colors: p.colors.split(",").filter(Boolean),
  featured: !!p.featured
});

app.get("/api/products", (req, res) => {
  const rows = db.prepare("SELECT * FROM products WHERE active=1 ORDER BY featured DESC, created_at DESC").all();
  res.json(rows.map(shapeProduct));
});

app.get("/api/products/:id", (req, res) => {
  const p = db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
  if (!p) return res.status(404).json({ error: "Product not found" });
  res.json(shapeProduct(p));
});

app.post("/api/orders", (req, res) => {
  const { customer_name, phone, address = "", items } = req.body || {};
  if (!customer_name || !phone || !Array.isArray(items) || !items.length)
    return res.status(400).json({ error: "Please provide your name, phone number and cart items." });

  let total = 0;
  const clean = [];
  for (const item of items) {
    const p = db.prepare("SELECT id,name,price,stock,active FROM products WHERE id=?").get(Number(item.id));
    const qty = Math.max(1, Math.min(20, Number(item.qty) || 1));
    if (!p || !p.active || p.stock < qty)
      return res.status(400).json({ error: `Not enough stock for ${p?.name || "one item"}.` });
    total += p.price * qty;
    clean.push({ id: p.id, name: p.name, price: p.price, qty, size: String(item.size || "") });
  }
  const result = db.prepare("INSERT INTO orders(customer_name,phone,address,items,total,customer_id) VALUES(?,?,?,?,?,?)")
    .run(customer_name, phone, address, JSON.stringify(clean), total, req.session.customerId || null);
  for (const item of clean)
    db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.qty, item.id);
  res.json({ ok: true, orderId: result.lastInsertRowid, total });
});

/* =========================================
   CUSTOMER ACCOUNTS (email one-time code)
   Customers enter their email, receive a 6-digit code, and are signed in.
   New emails are registered automatically on first sign-in.
========================================= */
const CODE_TTL_MS = 10 * 60 * 1000;          // code valid for 10 minutes
const CODE_RESEND_MS = 60 * 1000;            // 1 minute between codes per email
const CUSTOMER_SESSION_MS = 30 * 24 * 60 * 60 * 1000; // stay signed in 30 days

const codeRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please try again later." }
});
const codeVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please try again later." }
});

const normalizeEmail = v => String(v || "").trim().toLowerCase();
const isEmail = v => v.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const hashCode = (email, code) =>
  crypto.createHash("sha256")
    .update(`${email}:${code}:${process.env.SESSION_SECRET || "development-only-change-me"}`)
    .digest("hex");

const publicCustomer = c => ({ id: c.id, email: c.email, name: c.name, phone: c.phone, address: c.address });

// Sends the code with Resend's HTTP API (Railway blocks SMTP on most plans)
async function sendLoginCode(email, code) {
  const key = process.env.RESEND_API_KEY;

  if (!key) {
    if (isProduction) throw new Error("Email sign-in is not set up yet. Please try again later.");
    console.log(`[DEV] Sign-in code for ${email}: ${code}`);
    return;
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.MAIL_FROM || "WBTW <onboarding@resend.dev>",
      to: [email],
      subject: `Your WBTW sign-in code: ${code}`,
      text: `Your WBTW sign-in code is ${code}.\n\nIt expires in 10 minutes. If you didn't request it, you can ignore this email.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:420px;margin:auto;padding:24px">
        <h2 style="margin:0 0 12px">WBTW</h2>
        <p>Your sign-in code is:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:6px;margin:12px 0">${code}</p>
        <p style="color:#666;font-size:13px">It expires in 10 minutes. If you didn't request it, you can ignore this email.</p>
      </div>`
    })
  });

  if (!response.ok) {
    console.error("Email send failed:", response.status, await response.text());
    throw new Error("We couldn't send the email. Please try again.");
  }
}

function requireCustomer(req, res, next) {
  if (req.session.customerId) return next();
  return res.status(401).json({ error: "Please sign in." });
}

app.post("/api/auth/request-code", codeRequestLimiter, async (req, res) => {
  const email = normalizeEmail(req.body?.email);
  if (!isEmail(email)) return res.status(400).json({ error: "Please enter a valid email address." });

  const now = Date.now();
  db.prepare("DELETE FROM login_codes WHERE created_at < ?").run(now - 24 * 60 * 60 * 1000);

  const last = db.prepare("SELECT created_at FROM login_codes WHERE email=? ORDER BY id DESC LIMIT 1").get(email);
  if (last && now - last.created_at < CODE_RESEND_MS) {
    return res.status(429).json({ error: "Please wait a minute before requesting another code." });
  }

  const code = String(crypto.randomInt(100000, 1000000));
  db.prepare("UPDATE login_codes SET used=1 WHERE email=? AND used=0").run(email);
  db.prepare("INSERT INTO login_codes(email,code_hash,expires_at,created_at) VALUES(?,?,?,?)")
    .run(email, hashCode(email, code), now + CODE_TTL_MS, now);

  try {
    await sendLoginCode(email, code);
    res.json({ ok: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/auth/verify-code", codeVerifyLimiter, (req, res) => {
  const email = normalizeEmail(req.body?.email);
  const code = String(req.body?.code || "").replace(/\D/g, "");
  if (!isEmail(email) || code.length !== 6) {
    return res.status(400).json({ error: "Enter the 6-digit code from your email." });
  }

  const row = db.prepare("SELECT * FROM login_codes WHERE email=? AND used=0 ORDER BY id DESC LIMIT 1").get(email);
  if (!row || row.expires_at < Date.now()) {
    return res.status(400).json({ error: "That code has expired. Please request a new one." });
  }
  if (row.attempts >= 5) {
    db.prepare("UPDATE login_codes SET used=1 WHERE id=?").run(row.id);
    return res.status(400).json({ error: "Too many incorrect attempts. Please request a new code." });
  }

  const ok = crypto.timingSafeEqual(Buffer.from(hashCode(email, code)), Buffer.from(row.code_hash));
  if (!ok) {
    db.prepare("UPDATE login_codes SET attempts=attempts+1 WHERE id=?").run(row.id);
    return res.status(400).json({ error: "Incorrect code. Please try again." });
  }

  db.prepare("UPDATE login_codes SET used=1 WHERE id=?").run(row.id);

  let customer = db.prepare("SELECT * FROM customers WHERE email=?").get(email);
  let isNew = false;
  if (!customer) {
    const r = db.prepare("INSERT INTO customers(email,last_login_at) VALUES(?,CURRENT_TIMESTAMP)").run(email);
    customer = db.prepare("SELECT * FROM customers WHERE id=?").get(r.lastInsertRowid);
    isNew = true;
  } else {
    db.prepare("UPDATE customers SET last_login_at=CURRENT_TIMESTAMP WHERE id=?").run(customer.id);
  }

  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: "Could not sign you in. Please try again." });
    req.session.customerId = customer.id;
    req.session.cookie.maxAge = CUSTOMER_SESSION_MS;
    res.json({ ok: true, isNew, customer: publicCustomer(customer) });
  });
});

app.get("/api/auth/me", (req, res) => {
  const customer = req.session.customerId
    ? db.prepare("SELECT * FROM customers WHERE id=?").get(req.session.customerId)
    : null;
  res.json(customer ? { authenticated: true, customer: publicCustomer(customer) } : { authenticated: false });
});

app.put("/api/auth/profile", requireCustomer, (req, res) => {
  const name = String(req.body?.name || "").trim().slice(0, 100);
  const phone = String(req.body?.phone || "").trim().slice(0, 30);
  const address = String(req.body?.address || "").trim().slice(0, 300);
  db.prepare("UPDATE customers SET name=?, phone=?, address=? WHERE id=?").run(name, phone, address, req.session.customerId);
  const customer = db.prepare("SELECT * FROM customers WHERE id=?").get(req.session.customerId);
  res.json({ ok: true, customer: publicCustomer(customer) });
});

// Only signs the customer out (an admin session in the same browser is left alone)
app.post("/api/auth/logout", (req, res) => {
  delete req.session.customerId;
  res.json({ ok: true });
});

app.get("/api/account/orders", requireCustomer, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders WHERE customer_id=? ORDER BY created_at DESC").all(req.session.customerId);
  res.json(rows.map(o => ({ id: o.id, status: o.status, total: o.total, created_at: o.created_at, items: JSON.parse(o.items) })));
});

/* =========================================
   ADMIN AUTH
========================================= */
app.post("/api/admin/login", loginLimiter, (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare("SELECT * FROM admins WHERE username=?").get(username || "");
  if (!user || !bcrypt.compareSync(password || "", user.password_hash))
    return res.status(401).json({ error: "Incorrect username or password." });
  req.session.adminId = user.id;
  req.session.username = user.username;
  res.json({ ok: true, username: user.username });
});
app.post("/api/admin/logout", requireAdmin, (req, res) => req.session.destroy(() => res.json({ ok: true })));
app.get("/api/admin/me", (req, res) =>
  res.json({ authenticated: !!req.session.adminId, username: req.session.username || "" }));

/* =========================================
   ADMIN PRODUCTS
========================================= */
app.get("/api/admin/products", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
  res.json(rows.map(p => ({ ...shapeProduct(p), active: !!p.active })));
});

function productInput(body) {
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const price = Number(body.price);
  const stock = Math.max(0, parseInt(body.stock || "0", 10) || 0);

  const validCategories = ["Shirts", "T-Shirts", "Hoodies"];

  if (!name || !validCategories.includes(category) || !Number.isFinite(price) || price < 0) {
    throw new Error("Enter a product name, valid category and price.");
  }

  return {
    name,
    category,
    price,
    compare_price: body.compare_price ? Number(body.compare_price) : null,
    description: String(body.description || ""),
    sizes: String(body.sizes || "S,M,L,XL").split(",").map(x => x.trim()).filter(Boolean).join(","),
    colors: String(body.colors || "").split(",").map(x => x.trim()).filter(Boolean).join(","),
    stock,
    featured: body.featured === "1" || body.featured === "true" ? 1 : 0,
    active: body.active === "0" ? 0 : 1
  };
}

// Works out the final ordered image list.
// Admin sends imageOrder = JSON array of existing paths and "new:0", "new:1"... (index of uploaded file)
function resolveImages(body, files, old) {
  const oldList = old ? imagesOf(old) : [];
  const newPaths = files.map(f => "/uploads/" + f.filename);
  let final;

  if (body.imageOrder !== undefined) {
    final = [];
    for (const token of parseList(body.imageOrder)) {
      if (token.startsWith("new:")) {
        const p = newPaths[Number(token.slice(4))];
        if (p) final.push(p);
      } else if (oldList.includes(token) || /^https?:\/\//i.test(token)) {
        final.push(token);
      }
    }
  } else if (body.existingImages !== undefined) {
    // admin page that sends the kept images (JSON array) + new files (added last)
    final = parseList(body.existingImages).filter(x =>
      oldList.includes(x) || /^https?:\/\//i.test(x));
    const url = String(body.image || "").trim();
    if (/^https?:\/\//i.test(url) && !final.includes(url)) final.push(url);
    final.push(...newPaths);
  } else {
    // oldest admin page: keep current images and add any new uploads
    final = old ? [...oldList] : (body.image ? [String(body.image)] : []);
    final.push(...newPaths);
  }

  final = [...new Set(final)];
  if (final.length > MAX_IMAGES) {
    throw new Error(`You can only have up to ${MAX_IMAGES} images per product.`);
  }
  return { final, newPaths, oldList };
}

app.post("/api/admin/products", requireAdmin, uploadImages, (req, res) => {
  const files = uploadedFiles(req);
  try {
    const p = productInput(req.body);
    const { final, newPaths } = resolveImages(req.body, files, null);
    p.image = final[0] || "";
    p.images = JSON.stringify(final);

    const r = db.prepare(`INSERT INTO products(name,category,price,compare_price,description,image,images,sizes,colors,stock,featured,active)
      VALUES(@name,@category,@price,@compare_price,@description,@image,@images,@sizes,@colors,@stock,@featured,@active)`).run(p);

    newPaths.filter(x => !final.includes(x)).forEach(removeUpload); // unused uploads
    res.json({ ok: true, id: r.lastInsertRowid, images: final });
  } catch (e) {
    files.forEach(f => removeUpload("/uploads/" + f.filename)); // don't leave orphan files
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/products/:id", requireAdmin, uploadImages, (req, res) => {
  const files = uploadedFiles(req);
  try {
    const old = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
    if (!old) {
      files.forEach(f => removeUpload("/uploads/" + f.filename));
      return res.status(404).json({ error: "Product not found." });
    }
    const p = productInput(req.body);
    const { final, newPaths, oldList } = resolveImages(req.body, files, old);
    p.image = final[0] || "";
    p.images = JSON.stringify(final);

    db.prepare(`UPDATE products SET name=@name,category=@category,price=@price,compare_price=@compare_price,
      description=@description,image=@image,images=@images,sizes=@sizes,colors=@colors,stock=@stock,featured=@featured,active=@active WHERE id=@id`)
      .run({ ...p, id: old.id });

    // Remove images that were removed in the editor, and any unused uploads
    oldList.filter(x => !final.includes(x)).forEach(removeUpload);
    newPaths.filter(x => !final.includes(x)).forEach(removeUpload);

    res.json({ ok: true, images: final });
  } catch (e) {
    files.forEach(f => removeUpload("/uploads/" + f.filename));
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const old = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  if (old) imagesOf(old).forEach(removeUpload);
  res.json({ ok: true });
});

/* =========================================
   ADMIN ORDERS
========================================= */
app.get("/api/admin/orders", requireAdmin, (req, res) => {
  const rows = db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json(rows.map(o => ({ ...o, items: JSON.parse(o.items) })));
});

app.patch("/api/admin/orders/:id", requireAdmin, (req, res) => {
  const status = String(req.body.status || "");
  if (!["Pending", "Confirmed", "Processing", "Shipped", "Completed", "Cancelled"].includes(status))
    return res.status(400).json({ error: "Invalid status." });
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status, req.params.id);
  res.json({ ok: true });
});

/* =========================================
   PAGES & ERRORS
========================================= */
app.get("/admin", (req, res) => res.sendFile(path.join(ROOT, "public", "admin", "index.html")));
app.get("/health", (req, res) => res.json({ ok: true }));

app.use((err, req, res, next) => {
  console.error(err);
  const message =
    err.code === "LIMIT_FILE_SIZE" ? "Each image must be 5 MB or smaller."
    : err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE" ? `You can only upload up to ${MAX_IMAGES} images.`
    : err.message || "Something went wrong.";
  res.status(400).json({ error: message });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`WBTW store running on port ${PORT}`);
  console.log(`Data directory: ${DATA_DIR}`);
});