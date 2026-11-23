# WBTW Streetwear Store — Full-stack starter

A custom streetwear storefront inspired by the *interaction direction* of the supplied reference: moving announcement ticker, sticky/compact header, responsive navigation, animated reveal-on-scroll sections, image hover zoom, quick-view product modal, slide-in shopping bag and a separate admin console. The layout, copy and identity are original to WBTW.

## Requirements
- Node.js 20+
- npm

## Run locally
1. Extract the ZIP.
2. Open a terminal in the project folder.
3. Install packages: `npm install`
4. Copy `.env.example` to `.env`.
5. Change `SESSION_SECRET` and `ADMIN_PASSWORD` in `.env`.
6. Start: `npm start`
7. Open `http://localhost:3000`
8. Admin page: `http://localhost:3000/admin`

If startup reports that a SQLite `.node` file is not a valid Win32 application, run `npm install` and then `npm rebuild better-sqlite3 sqlite3` from this project folder. Native modules must be built for the local operating system and Node.js version.

Default development login (only if you did not change `.env` before first start):
- Username: `admin`
- Password: `ChangeThisPassword123!`

**Change the default password and session secret before deployment.** The initial admin account is created once in the SQLite database. If you change credentials after the first run, the existing admin account is not automatically overwritten.

## Admin features
- Separate login at `/admin`
- Create, edit and delete products
- Shirt and Hoodie categories
- Upload product images (JPG, PNG, WEBP, GIF; max 5 MB) or use an image URL
- Price, compare-at price, size options, colors, stock, description
- Feature products on the storefront
- Publish/unpublish products
- View customer order requests and update order status

## Storefront features
- Responsive homepage and category collection sections
- Product listing and category filters
- Search and sort
- Product quick-view with size selection
- Cart drawer with quantity controls
- Checkout order request saved to SQLite
- Stock is checked and reduced when an order request is submitted

## Important production notes
This is a self-hostable full-stack starter, not a payment-provider integration. Checkout currently records an order request; it does **not** charge a card or automatically book a courier. Connect a payment gateway (for example, a locally supported provider) and shipping workflow before accepting prepaid orders.

For production deployment:
- Use HTTPS and a strong unique `SESSION_SECRET`.
- Set `NODE_ENV=production`.
- Use a persistent disk/volume for `data/` and `uploads/`; ephemeral serverless filesystems will lose SQLite and uploaded images.
- Back up the SQLite database and uploads.
- Add CSRF protection, account recovery and an admin password-change flow before exposing the admin publicly.
- Configure your own domain, business contact details, social links and shipping/return policies.
- Replace sample product photos with your own licensed product photography.
- The newsletter form is a visual placeholder; connect it to an email marketing provider to collect subscribers.
- Set your WhatsApp number in `.env` if you later add WhatsApp order confirmation.

## Project structure
```text
wbtw-streetwear-full/
├── server.js
├── package.json
├── .env.example
├── data/                 # SQLite database created at runtime
├── uploads/              # Uploaded product images
└── public/
    ├── index.html         # Public storefront
    ├── style.css
    ├── store.js
    └── admin/
        ├── index.html     # Separate admin page
        ├── admin.css
        └── admin.js
```
