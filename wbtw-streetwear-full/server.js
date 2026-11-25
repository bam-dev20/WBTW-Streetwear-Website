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
const db = new Database(path.join(ROOT, "data", "wbtw.sqlite"));
db.pragma("journal_mode = WAL");

db.exec(`
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK(category IN ('Shirts','Hoodies')),
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


const isProduction = process.env.NODE_ENV === "production";

app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" },

  // Only enforce HTTPS in production
  strictTransportSecurity: isProduction ? undefined : false,

  contentSecurityPolicy: {
    directives: {
      "upgrade-insecure-requests": isProduction ? [] : null
    }
  }
}));
app.use(express.json({limit:"2mb"}));
app.use(express.urlencoded({extended:true}));
app.use(session({
  store: new SQLiteStore({ db: "sessions.sqlite", dir: path.join(ROOT,"data") }),
  secret: process.env.SESSION_SECRET || "development-only-change-me",
  resave: false, saveUninitialized: false,
  cookie: { httpOnly:true, sameSite:"lax", secure: process.env.NODE_ENV === "production", maxAge: 8*60*60*1000 }
}));
app.use("/uploads", express.static(path.join(ROOT,"uploads")));
app.use(express.static(path.join(ROOT,"public")));

const loginLimiter = rateLimit({windowMs:15*60*1000,limit:8,standardHeaders:true,legacyHeaders:false});
const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,path.join(ROOT,"uploads")),
  filename: (req,file,cb)=>cb(null,Date.now()+"-"+Math.round(Math.random()*1e9)+path.extname(file.originalname).toLowerCase())
});
const upload = multer({
  storage,
  limits:{fileSize:5*1024*1024},
  fileFilter:(req,file,cb)=>{
    const ok=/^image\/(jpeg|png|webp|gif)$/.test(file.mimetype);
    cb(ok?null:new Error("Only JPG, PNG, WEBP or GIF images are allowed."),ok);
  }
});
function requireAdmin(req,res,next){ if(req.session.adminId) return next(); return res.status(401).json({error:"Please sign in again."}); }

app.get("/api/products",(req,res)=>{
  const rows=db.prepare("SELECT * FROM products WHERE active=1 ORDER BY featured DESC, created_at DESC").all();
  res.json(rows.map(p=>({...p,sizes:p.sizes.split(",").filter(Boolean),colors:p.colors.split(",").filter(Boolean),featured:!!p.featured})));
});
app.get("/api/products/:id",(req,res)=>{
  const p=db.prepare("SELECT * FROM products WHERE id=? AND active=1").get(req.params.id);
  if(!p) return res.status(404).json({error:"Product not found"});
  res.json({...p,sizes:p.sizes.split(",").filter(Boolean),colors:p.colors.split(",").filter(Boolean),featured:!!p.featured});
});
app.post("/api/orders",(req,res)=>{
  const {customer_name,phone,address="",items}=req.body||{};
  if(!customer_name||!phone||!Array.isArray(items)||!items.length) return res.status(400).json({error:"Please provide your name, phone number and cart items."});
  let total=0, clean=[];
  for(const item of items){
    const p=db.prepare("SELECT id,name,price,stock,active FROM products WHERE id=?").get(Number(item.id));
    const qty=Math.max(1,Math.min(20,Number(item.qty)||1));
    if(!p||!p.active||p.stock<qty) return res.status(400).json({error:`Not enough stock for ${p?.name||"one item"}.`});
    total+=p.price*qty; clean.push({id:p.id,name:p.name,price:p.price,qty,size:String(item.size||"")});
  }
  const result=db.prepare("INSERT INTO orders(customer_name,phone,address,items,total) VALUES(?,?,?,?,?)")
    .run(customer_name,phone,address,JSON.stringify(clean),total);
  for(const item of clean) db.prepare("UPDATE products SET stock=stock-? WHERE id=?").run(item.qty,item.id);
  res.json({ok:true,orderId:result.lastInsertRowid,total});
});

app.post("/api/admin/login",loginLimiter,(req,res)=>{
  const {username,password}=req.body||{};
  const user=db.prepare("SELECT * FROM admins WHERE username=?").get(username||"");
  if(!user||!bcrypt.compareSync(password||"",user.password_hash)) return res.status(401).json({error:"Incorrect username or password."});
  req.session.adminId=user.id;
  req.session.username=user.username;
  res.json({ok:true,username:user.username});
});
app.post("/api/admin/logout",requireAdmin,(req,res)=>req.session.destroy(()=>res.json({ok:true})));
app.get("/api/admin/me",(req,res)=>res.json({authenticated:!!req.session.adminId,username:req.session.username||""}));
app.get("/api/admin/products",requireAdmin,(req,res)=>{
  const rows=db.prepare("SELECT * FROM products ORDER BY created_at DESC").all();
  res.json(rows.map(p=>({...p,sizes:p.sizes.split(",").filter(Boolean),colors:p.colors.split(",").filter(Boolean),featured:!!p.featured,active:!!p.active})));
});
function productInput(body,file){
  const name=String(body.name||"").trim(), category=String(body.category||"");
  const price=Number(body.price), stock=Math.max(0,parseInt(body.stock||"0",10)||0);
  if(!name||!["Shirts","Hoodies"].includes(category)||!Number.isFinite(price)||price<0) throw new Error("Enter a product name, valid category and price.");
  return {name,category,price,compare_price:body.compare_price?Number(body.compare_price):null,
    description:String(body.description||""),image:file?"/uploads/"+file.filename:String(body.image||""),
    sizes:String(body.sizes||"S,M,L,XL").split(",").map(x=>x.trim()).filter(Boolean).join(","),
    colors:String(body.colors||"").split(",").map(x=>x.trim()).filter(Boolean).join(","),
    stock,featured:body.featured==="1"||body.featured==="true"?1:0,active:body.active==="0"?0:1};
}
app.post("/api/admin/products",requireAdmin,upload.single("imageFile"),(req,res)=>{
  try{
    const p=productInput(req.body,req.file);
    const r=db.prepare(`INSERT INTO products(name,category,price,compare_price,description,image,sizes,colors,stock,featured,active)
      VALUES(@name,@category,@price,@compare_price,@description,@image,@sizes,@colors,@stock,@featured,@active)`).run(p);
    res.json({ok:true,id:r.lastInsertRowid});
  }catch(e){res.status(400).json({error:e.message});}
});
app.put("/api/admin/products/:id",requireAdmin,upload.single("imageFile"),(req,res)=>{
  try{
    const old=db.prepare("SELECT * FROM products WHERE id=?").get(req.params.id);
    if(!old)return res.status(404).json({error:"Product not found."});
    const p=productInput(req.body,req.file);
    if(!req.file&&!req.body.image)p.image=old.image;
    db.prepare(`UPDATE products SET name=@name,category=@category,price=@price,compare_price=@compare_price,
      description=@description,image=@image,sizes=@sizes,colors=@colors,stock=@stock,featured=@featured,active=@active WHERE id=@id`)
      .run({...p,id:old.id});
    res.json({ok:true});
  }catch(e){res.status(400).json({error:e.message});}
});
app.delete("/api/admin/products/:id",requireAdmin,(req,res)=>{
  db.prepare("DELETE FROM products WHERE id=?").run(req.params.id);res.json({ok:true});
});
app.get("/api/admin/orders",requireAdmin,(req,res)=>{
  const rows=db.prepare("SELECT * FROM orders ORDER BY created_at DESC").all();
  res.json(rows.map(o=>({...o,items:JSON.parse(o.items)})));
});
app.patch("/api/admin/orders/:id",requireAdmin,(req,res)=>{
  const status=String(req.body.status||"");
  if(!["Pending","Confirmed","Processing","Shipped","Completed","Cancelled"].includes(status))return res.status(400).json({error:"Invalid status."});
  db.prepare("UPDATE orders SET status=? WHERE id=?").run(status,req.params.id);res.json({ok:true});
});
app.get("/admin",(req,res)=>res.sendFile(path.join(ROOT,"public","admin","index.html")));
app.get("/health",(req,res)=>res.json({ok:true}));
app.use((err,req,res,next)=>{console.error(err);res.status(400).json({error:err.message||"Something went wrong."});});
app.listen(PORT, "0.0.0.0", () => {
  console.log(`WBTW store running on port ${PORT}`);
});
