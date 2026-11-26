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

const app = express();

// Railway reverse proxy configuration
app.set("trust proxy", 1);

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const isProduction = process.env.NODE_ENV === "production";

const MAX_IMAGES = 8;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB per image

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

// Migration: support multiple images per product (stored as a JSON array)
const hasImagesColumn = db.prepare("PRAGMA table_info(products)").all().some(c => c.name === "images");
if (!hasImagesColumn) {
  db.exec("ALTER TABLE products ADD COLUMN images TEXT DEFAULT ''");
  // Existing single images become the first gallery image
  db.exec("UPDATE products SET images = json_array(image) WHERE image != ''");
  console.log("Added images column to products.");
}

const adminUser = process.env.ADMIN_USERNAME || "admin";
const adminPass = process.env.ADMIN_PASSWORD || "ChangeThisPassword123!";
if (!db.prepare("SELECT id FROM admins WHERE username=?").get(adminUser)) {
  db.prepare("INSERT INTO admins(username,password_hash) VALUES(?,?)")
    .run(adminUser, bcrypt.hashSync(adminPass, 12));
}

const count = db.prepare("SELECT COUNT(*) AS n FROM products").get().n;
if (!count) {
  const seed = db.prepare(`INSERT INTO products(name,category,price,description,image,images,sizes,colors,stock,featured)
    VALUES(?,?,?,?,?,?,?,?,?,?)`);
  const seedProduct = (name, category, price, description, image, sizes, colors, stock, featured) =>
    seed.run(name, category, price, description, image, JSON.stringify([image]), sizes, colors, stock, featured);

  seedProduct("WBTW Signature Oversized Tee","Shirts",699,"Premium everyday oversized fit. Designed with purpose.","https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=1000&q=85","S,M,L,XL,XXL","Black,White",30,1);
  seedProduct("The Wise Graphic Tee","Shirts",699,"A graphic staple for everyday confidence.","https://images.unsplash.com/photo-1503341504253-dff4815485f1?auto=format&fit=crop&w=1000&q=85","S,M,L,XL","Black,White",25,1);
  seedProduct("WBTW Heavyweight Hoodie","Hoodies",1299,"A heavyweight layer with a relaxed silhouette.","https://images.unsplash.com/photo-1556821840-3a63f95609a7?auto=format&fit=crop&w=1000&q=85","S,M,L,XL,XXL","Black,Charcoal",18,1);
  seedProduct("Core Pullover Hoodie","Hoodies",1199,"Minimal design. Everyday comfort.","https://images.unsplash.com/photo-1578681994506-b8f463449011?auto=format&fit=crop&w=1000&q=85","S,M,L,XL","Black,Grey",12,0);
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
  limits: { fileSize: MAX_IMAGE_SIZE, files: MAX_IMAGES },
  fileFilter: (req, file, cb) => {
    const ok = /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok ? null : new Error("Only JPG, PNG, WEBP or GIF images are allowed."), ok);
  }
});

// Delete a stored upload file (only files inside /uploads/)
function removeUpload(imagePath) {
  if (typeof imagePath !== "string" || !imagePath.startsWith("/uploads/")) return;
  const file = path.join(UPLOAD_DIR, path.basename(imagePath));
  fs.unlink(file, () => {});
}

// Delete all files uploaded during a failed request
function cleanupFiles(files) {
  (files || []).forEach(f => removeUpload("/uploads/" + f.filename));
}

function requireAdmin(req, res, next) {
  if (req.session.adminId) return next();
  return res.status(401).json({ error: "Please sign in again." });
}

/* =========================================
   PRODUCT HELPERS
========================================= */
// Returns the product's images as an array (falls back to the legacy single `image`)
function parseImages(p) {
  try {
    const arr = JSON.parse(p.images || "[]");
    if (Array.isArray(arr) && arr.length) return arr;
  } catch {}
  return p.image ? [p.image] : [];
}

const shapeProduct = p => {
  const images = parseImages(p);
  return {
    ...p,
    images,
    image: images[0] || "", // first image stays the "main" image for the storefront
    sizes: p.sizes.split(",").filter(Boolean),
    colors: p.colors.split(",").filter(Boolean),
    featured: !!p.featured
  };
};

/* =========================================
   PUBLIC API
========================================= */
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
  const result = db.prepare("INSERT INTO orders(customer_name,phone,address,items,total) VALUES(?,?,?,?,?)")
    .run(customer_name, phone, address, JSON.stringify(clean), total);
  for (const item of clean)
    db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.qty, item.id);
  res.json({ ok: true, orderId: result.lastInsertRowid, total });
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

// Accepts a JSON array string of image paths/URLs and keeps only safe values
function parseImageList(value) {
  try {
    const arr = JSON.parse(value || "[]");
    return Array.isArray(arr)
      ? arr.filter(x => typeof x === "string" && (x.startsWith("/uploads/") || x.startsWith("https://")))
      : [];
  } catch {
    return [];
  }
}

function productInput(body, files = []) {
  const name = String(body.name || "").trim();
  const category = String(body.category || "").trim();
  const price = Number(body.price);
  const stock = Math.max(0, parseInt(body.stock || "0", 10) || 0);

  const validCategories = ["Shirts", "T-Shirts", "Hoodies"];

  if (!name || !validCategories.includes(category) || !Number.isFinite(price) || price < 0) {
    throw new Error("Enter a product name, valid category and price.");
  }

  // 1) images kept from before, 2) optional pasted URL, 3) newly uploaded files
  const images = parseImageList(body.existingImages);
  const url = String(body.image || "").trim();
  if (url && (url.startsWith("/uploads/") || url.startsWith("https://")) && !images.includes(url)) {
    images.push(url);
  }
  for (const f of files) images.push("/uploads/" + f.filename);

  if (images.length > MAX_IMAGES) {
    throw new Error(`You can only have up to ${MAX_IMAGES} images per product.`);
  }

  return {
    name,
    category,
    price,
    compare_price: body.compare_price ? Number(body.compare_price) : null,
    description: String(body.description || ""),
    image: images[0] || "",
    images: JSON.stringify(images),
    sizes: String(body.sizes || "S,M,L,XL").split(",").map(x => x.trim()).filter(Boolean).join(","),
    colors: String(body.colors || "").split(",").map(x => x.trim()).filter(Boolean).join(","),
    stock,
    featured: body.featured === "1" || body.featured === "true" ? 1 : 0,
    active: body.active === "0" ? 0 : 1
  };
}

app.post("/api/admin/products", requireAdmin, upload.array("imageFiles", MAX_IMAGES), (req, res) => {
  try {
    const p = productInput(req.body, req.files);
    const r = db.prepare(`INSERT INTO products(name,category,price,compare_price,description,image,images,sizes,colors,stock,featured,active)
      VALUES(@name,@category,@price,@compare_price,@description,@image,@images,@sizes,@colors,@stock,@featured,@active)`).run(p);
    res.json({ ok: true, id: r.lastInsertRowid, images: JSON.parse(p.images) });
  } catch (e) {
    cleanupFiles(req.files); // don't leave orphan files
    res.status(400).json({ error: e.message });
  }
});

app.put("/api/admin/products/:id", requireAdmin, upload.array("imageFiles", MAX_IMAGES), (req, res) => {
  try {
    const old = db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
    if (!old) {
      cleanupFiles(req.files);
      return res.status(404).json({ error: "Product not found." });
    }
    const p = productInput(req.body, req.files);

    db.prepare(`UPDATE products SET name=@name,category=@category,price=@price,compare_price=@compare_price,
      description=@description,image=@image,images=@images,sizes=@sizes,colors=@colors,stock=@stock,
      featured=@featured,active=@active WHERE id=@id`)
      .run({ ...p, id: old.id });

    // Delete uploaded files that were removed from the gallery
    const kept = new Set(JSON.parse(p.images));
    parseImages(old).filter(img => !kept.has(img)).forEach(removeUpload);

    res.json({ ok: true, images: JSON.parse(p.images) });
  } catch (e) {
    cleanupFiles(req.files);
    res.status(400).json({ error: e.message });
  }
});

app.delete("/api/admin/products/:id", requireAdmin, (req, res) => {
  const old = db.prepare("SELECT image, images FROM products WHERE id=?").get(req.params.id);
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);
  if (old) parseImages(old).forEach(removeUpload);
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