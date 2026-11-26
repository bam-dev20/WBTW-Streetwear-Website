const $ = (s) => document.querySelector(s);

// ---------- BAG STORAGE (saved in the visitor's browser) ----------

const CART_KEY = "wbtw_cart_v1";

function loadCart() {
    try {
        const saved = JSON.parse(localStorage.getItem(CART_KEY) || "[]");
        if (!Array.isArray(saved)) return [];
        return saved
            .filter((i) => i && i.id != null && Number(i.qty) > 0)
            .map((i) => ({
                id: i.id,
                name: String(i.name || ""),
                price: Number(i.price) || 0,
                image: String(i.image || ""),
                size: String(i.size || ""),
                qty: Math.min(20, Math.max(1, parseInt(i.qty, 10) || 1))
            }));
    } catch (e) {
        return [];
    }
}

function saveCart() {
    try {
        localStorage.setItem(CART_KEY, JSON.stringify(cart));
    } catch (e) { /* storage unavailable (e.g. private mode): bag still works until refresh */ }
}

let products = [];
let cart = loadCart();
let activeCategory = "All";
let searchTerm = "";
let galleryImages = [];
let galleryIndex = 0;

const money = (n) =>
    "₱" + Number(n).toLocaleString("en-PH", { maximumFractionDigits: 0 });

const esc = (v) =>
    String(v ?? "").replace(/[&<>"']/g, (c) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);

const fallbackImage = "https://placehold.co/800x1000/e3e1db/111?text=WBTW";

function safeImage(url) {
    const value = String(url || "").trim();
    if (value.startsWith("/") && !value.startsWith("//")) return esc(value);
    try {
        const parsed = new URL(value, window.location.origin);
        if (["http:", "https:"].includes(parsed.protocol)) return esc(value);
    } catch (e) { /* fallback below */ }
    return fallbackImage;
}

// Turns whatever the API sends (array, JSON string, comma list) into a clean array.
function toList(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === "string" && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) { /* not JSON */ }
        return value.split(",");
    }
    return [];
}

// All images for a product: main image first, no duplicates, max 8.
function productImages(product) {
    const extra = [
        ...toList(product.images),
        ...toList(product.gallery),
        ...toList(product.image_urls),
        ...toList(product.photos)
    ];
    const all = [product.image, ...extra]
        .map((s) => (s && typeof s === "object" ? s.url || s.src : s))
        .map((s) => String(s || "").trim())
        .filter(Boolean);
    return [...new Set(all)].slice(0, 8);
}

// ---------- PRODUCT LOADING ----------

async function loadProducts() {
    try {
        const response = await fetch("/api/products", { cache: "no-store" });
        if (!response.ok) throw new Error("Unable to load products.");
        products = await response.json();
        syncCartWithProducts();
        renderCart();
        renderProducts();
    } catch (error) {
        console.error("Product loading error:", error);
        $("#productGrid").innerHTML =
            '<p class="no-products">STORE CONNECTION UNAVAILABLE. PLEASE REFRESH.</p>';
    }
}

// Keeps a saved bag correct: removes unavailable items, refreshes price/name, caps quantity at stock.
function syncCartWithProducts() {
    cart = cart.filter((item) => {
        const p = products.find((x) => String(x.id) === String(item.id));
        if (!p || Number(p.stock) <= 0) return false;
        if (Array.isArray(p.sizes) && p.sizes.length && !p.sizes.includes(item.size)) return false;
        item.name = p.name;
        item.price = p.price;
        item.image = productImages(p)[0] || item.image;
        item.qty = Math.min(item.qty, Number(p.stock), 20);
        return item.qty > 0;
    });
}

function stockFor(id) {
    const p = products.find((x) => String(x.id) === String(id));
    return p ? Number(p.stock) || 0 : Infinity;
}

function filteredProducts() {
    const list = products.filter((p) => {
        const okCat = activeCategory === "All" || p.category === activeCategory;
        const text = `${p.name} ${p.category} ${p.description}`.toLowerCase();
        return okCat && text.includes(searchTerm);
    });
    const sort = $("#sortSelect").value;
    if (sort === "low") list.sort((a, b) => a.price - b.price);
    if (sort === "high") list.sort((a, b) => b.price - a.price);
    if (sort === "newest") list.sort((a, b) => b.id - a.id);
    return list;
}

function renderProducts() {
    const list = filteredProducts();
    $("#allCount").textContent = String(products.length).padStart(2, "0");

    $("#productGrid").innerHTML = list.length
        ? list.map((p) => {
            const imgs = productImages(p);
            const count = imgs.length > 1
                ? `<span class="photo-count">${imgs.length} PHOTOS</span>` : "";
            return `
            <article class="product-card reveal visible" data-id="${esc(p.id)}">
                <div class="product-media" data-action="open-product"
                     data-id="${esc(p.id)}" role="button" tabindex="0">
                    ${p.featured ? '<span class="product-label">WBTW FEATURED</span>' : ""}
                    ${count}
                    <img class="product-image" src="${safeImage(imgs[0])}"
                         alt="${esc(p.name)}" loading="lazy">
                    <button type="button" class="quick-add" data-action="open-product"
                            data-id="${esc(p.id)}">QUICK VIEW +</button>
                </div>
                <div class="product-details" data-action="open-product"
                     data-id="${esc(p.id)}" role="button" tabindex="0">
                    <div>
                        <div class="product-title">${esc(p.name)}</div>
                        <div class="product-category">${esc(p.category)}</div>
                    </div>
                    <div class="product-price">${money(p.price)}</div>
                </div>
            </article>`;
        }).join("")
        : '<p class="no-products">NO PIECES FOUND. CHECK BACK FOR THE NEXT DROP.</p>';
}

// ---------- CART ----------

function showCart() {
    $("#cartDrawer").classList.add("open");
    $("#scrim").classList.add("show");
    document.body.classList.add("lock");
}

function hideCart() {
    $("#cartDrawer").classList.remove("open");
    $("#scrim").classList.remove("show");
    document.body.classList.remove("lock");
}

function addCart(product, size) {
    if (!product) return;
    const max = Math.min(20, Number(product.stock) || 0);
    const found = cart.find((i) => i.id === product.id && i.size === size);

    if (found) {
        if (found.qty >= max) {
            alert(`Only ${max} available for this item.`);
        } else {
            found.qty++;
        }
    } else {
        cart.push({
            id: product.id, name: product.name, price: product.price,
            image: productImages(product)[0], size, qty: 1
        });
    }
    renderCart();
    $("#productModal").classList.remove("open");
    showCart();
}

function renderCart() {
    const qty = cart.reduce((s, i) => s + i.qty, 0);
    const total = cart.reduce((s, i) => s + i.price * i.qty, 0);

    $("#bagCount").textContent = qty;
    $("#drawerCount").textContent = `(${qty})`;
    $("#subtotal").textContent = money(total);

    $("#cartLines").innerHTML = cart.length
        ? cart.map((item, index) => `
            <div class="cart-line" data-product-id="${esc(item.id)}">
                <img class="cart-product-image" src="${safeImage(item.image)}"
                     alt="${esc(item.name)}">
                <div>
                    ${esc(item.name)}
                    <div>${esc(item.size)}</div>
                    <strong>${money(item.price)}</strong>
                    <div class="qty-controls">
                        <button type="button" data-action="change-qty"
                                data-index="${index}" data-change="-1"
                                aria-label="Decrease quantity">−</button>
                        ${item.qty}
                        <button type="button" data-action="change-qty"
                                data-index="${index}" data-change="1"
                                aria-label="Increase quantity">+</button>
                    </div>
                </div>
                <button type="button" data-action="remove-cart"
                        data-index="${index}">REMOVE</button>
            </div>`).join("")
        : '<p class="empty-cart">YOUR BAG IS EMPTY.</p>';

    saveCart();
}

function changeQty(index, amount) {
    const item = cart[index];
    if (!item) return;
    const max = Math.min(20, stockFor(item.id));
    item.qty = Math.min(max, item.qty + amount);
    if (item.qty < 1) cart.splice(index, 1);
    renderCart();
}

function removeCart(index) {
    if (!cart[index]) return;
    cart.splice(index, 1);
    renderCart();
}

// ---------- PRODUCT MODAL + GALLERY ----------

function setGalleryImage(index) {
    if (!galleryImages.length) return;
    galleryIndex = (index + galleryImages.length) % galleryImages.length;

    const main = $("#modalMainImage");
    if (main) {
        delete main.dataset.fallbackApplied;
        main.src = safeImage(galleryImages[galleryIndex]);
    }

    const counter = $("#galleryCounter");
    if (counter) counter.textContent = `${galleryIndex + 1} / ${galleryImages.length}`;

    document.querySelectorAll("#productModalContent .modal-thumb").forEach((btn, i) => {
        btn.classList.toggle("active", i === galleryIndex);
    });
}

function openProduct(id) {
    const product = products.find((p) => String(p.id) === String(id));
    if (!product) return;

    const content = $("#productModalContent");
    content.dataset.productId = product.id;

    galleryImages = productImages(product);
    galleryIndex = 0;
    const multi = galleryImages.length > 1;

    const arrows = multi ? `
        <button type="button" class="gallery-arrow prev" data-action="gallery-prev"
                aria-label="Previous image">‹</button>
        <button type="button" class="gallery-arrow next" data-action="gallery-next"
                aria-label="Next image">›</button>
        <span class="gallery-counter" id="galleryCounter">1 / ${galleryImages.length}</span>` : "";

    const thumbs = multi ? `
        <div class="modal-thumbs">
            ${galleryImages.map((img, i) => `
                <button type="button" class="modal-thumb${i === 0 ? " active" : ""}"
                        data-action="show-image" data-index="${i}"
                        aria-label="Show image ${i + 1}">
                    <img src="${safeImage(img)}" alt="${esc(product.name)} view ${i + 1}"
                         loading="lazy">
                </button>`).join("")}
        </div>` : "";

    content.innerHTML = `
        <div class="modal-gallery">
            <div class="modal-main">
                <img id="modalMainImage" class="modal-product-image"
                     src="${safeImage(galleryImages[0])}" alt="${esc(product.name)}">
                ${arrows}
            </div>
            ${thumbs}
        </div>

        <div class="product-modal-info">
            <p class="kicker">${esc(product.category)} / WBTW®</p>
            <h3>${esc(product.name)}</h3>
            <div class="modal-price">${money(product.price)}</div>
            <p>${esc(product.description)}</p>
            <label>
                SELECT SIZE
                <select id="modalSize">
                    ${(product.sizes || ["S", "M", "L", "XL"])
                        .map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join("")}
                </select>
            </label>
            <p>${product.stock > 0 ? `${product.stock} PIECES AVAILABLE` : "SOLD OUT"}</p>
            <button type="button" class="pill-button" data-action="add-to-cart"
                    ${product.stock <= 0 ? "disabled" : ""}>ADD TO BAG ↗</button>
        </div>`;

    $("#productModal").classList.add("open");
}

// ---------- MOBILE MENU ----------

const mobileMenu = $("#mobileMenu");
const siteHeader = $("#header");

function positionMobileMenu() {
    if (mobileMenu && siteHeader) {
        mobileMenu.style.top = `${siteHeader.getBoundingClientRect().bottom}px`;
    }
}

// ---------- IMAGE FALLBACK ----------

function handleImageError(event) {
    const img = event.target;
    if (img instanceof HTMLImageElement && !img.dataset.fallbackApplied) {
        img.dataset.fallbackApplied = "true";
        img.src = fallbackImage;
    }
}

["#productGrid", "#cartLines", "#productModalContent"].forEach((sel) =>
    $(sel).addEventListener("error", handleImageError, true));

// ---------- EVENTS: GRID ----------

$("#productGrid").addEventListener("click", (e) => {
    const t = e.target.closest('[data-action="open-product"]');
    if (t) openProduct(t.dataset.id);
});

$("#productGrid").addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const t = e.target.closest('[data-action="open-product"]');
    if (!t || t.tagName === "BUTTON") return;
    e.preventDefault();
    openProduct(t.dataset.id);
});

// ---------- EVENTS: CART ----------

$("#cartLines").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn) return;
    const index = Number(btn.dataset.index);
    if (btn.dataset.action === "change-qty") changeQty(index, Number(btn.dataset.change));
    if (btn.dataset.action === "remove-cart") removeCart(index);
});

// ---------- EVENTS: MODAL ----------

$("#productModalContent").addEventListener("click", (e) => {
    const thumb = e.target.closest('[data-action="show-image"]');
    if (thumb) return setGalleryImage(Number(thumb.dataset.index));

    if (e.target.closest('[data-action="gallery-prev"]')) return setGalleryImage(galleryIndex - 1);
    if (e.target.closest('[data-action="gallery-next"]')) return setGalleryImage(galleryIndex + 1);

    const btn = e.target.closest('[data-action="add-to-cart"]');
    if (!btn || btn.disabled) return;

    const id = $("#productModalContent").dataset.productId;
    const product = products.find((p) => String(p.id) === String(id));
    addCart(product, $("#modalSize").value);
});

// Arrow keys + Escape while the product modal is open
document.addEventListener("keydown", (e) => {
    if (!$("#productModal").classList.contains("open")) return;
    if (e.key === "ArrowLeft") setGalleryImage(galleryIndex - 1);
    if (e.key === "ArrowRight") setGalleryImage(galleryIndex + 1);
    if (e.key === "Escape") $("#productModal").classList.remove("open");
});

// Swipe on the main image (mobile)
let touchX = null;
$("#productModalContent").addEventListener("touchstart", (e) => {
    touchX = e.target.closest(".modal-main") ? e.touches[0].clientX : null;
}, { passive: true });
$("#productModalContent").addEventListener("touchend", (e) => {
    if (touchX === null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    if (Math.abs(dx) > 40) setGalleryImage(galleryIndex + (dx < 0 ? 1 : -1));
    touchX = null;
}, { passive: true });

// ---------- HEADER / NAV ----------

$("#bagToggle").addEventListener("click", showCart);
$("#cartClose").addEventListener("click", hideCart);
$("#scrim").addEventListener("click", hideCart);

document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => $("#" + b.dataset.close)?.classList.remove("open")));

document.querySelectorAll(".modal").forEach((m) =>
    m.addEventListener("click", (e) => {
        if (e.target === m) m.classList.remove("open");
    }));

document.querySelectorAll("[data-filter]").forEach((b) =>
    b.addEventListener("click", () => {
        activeCategory = b.dataset.filter;
        document.querySelectorAll(".filter").forEach((f) => f.classList.toggle("active", f === b));
        renderProducts();
    }));

document.querySelectorAll("[data-cat]").forEach((link) =>
    link.addEventListener("click", () => {
        activeCategory = link.dataset.cat;
        document.querySelectorAll(".filter").forEach((b) =>
            b.classList.toggle("active", b.dataset.filter === activeCategory));
        renderProducts();
        mobileMenu?.classList.remove("open");
    }));

$("#sortSelect").addEventListener("change", renderProducts);
$("#searchToggle").addEventListener("click", () => $("#searchBar").classList.toggle("show"));
$("#searchClose").addEventListener("click", () => $("#searchBar").classList.remove("show"));
$("#searchInput").addEventListener("input", (e) => {
    searchTerm = e.target.value.toLowerCase();
    renderProducts();
});

$("#menuToggle").addEventListener("click", () => {
    if (!mobileMenu) return;
    const willOpen = !mobileMenu.classList.contains("open");
    mobileMenu.classList.toggle("open");
    if (willOpen) positionMobileMenu();
});

window.addEventListener("resize", () => {
    if (mobileMenu?.classList.contains("open")) positionMobileMenu();
});

// ---------- CHECKOUT ----------

$("#checkoutOpen").addEventListener("click", () => {
    if (!cart.length) return alert("Your bag is empty.");
    $("#checkoutModal").classList.add("open");
});

$("#checkoutForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = {
        customer_name: form.get("customer_name"),
        phone: form.get("phone"),
        address: form.get("address"),
        items: cart.map((i) => ({ id: i.id, qty: i.qty, size: i.size }))
    };

    try {
        const response = await fetch("/api/orders", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Order submission failed.");

        alert(`Thank you! Your order request #${data.orderId} was received. Total: ${money(data.total)}. The store will contact you to confirm delivery.`);

        cart = [];
        renderCart();
        $("#checkoutModal").classList.remove("open");
        hideCart();
        event.target.reset();
        await loadProducts();
    } catch (error) {
        alert(error.message);
    }
});

$("#newsletterForm").addEventListener("submit", (e) => {
    e.preventDefault();
    $("#newsletterMsg").textContent = "THANK YOU — YOU'RE ON THE LIST.";
    e.target.reset();
});

// ---------- SCROLL EFFECTS ----------

$("#year").textContent = new Date().getFullYear();

window.addEventListener("scroll", () => {
    $("#header").classList.toggle("compact", window.scrollY > 70);
    if (mobileMenu?.classList.contains("open")) positionMobileMenu();
});

const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
        if (entry.isIntersecting) {
            entry.target.classList.add("visible");
            observer.unobserve(entry.target);
        }
    });
}, { threshold: 0.12 });

document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));

// ---------- CUSTOMER ACCOUNT (email one-time code) ----------

let customer = null;
let pendingEmail = "";

async function authApi(url, options = {}) {
    const response = await fetch(url, {
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        ...options
    });
    let data = {};
    try { data = await response.json(); } catch (e) { /* no body */ }
    if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
    return data;
}

// Sign-in window (built here, so no HTML changes are needed)
const authModal = document.createElement("div");
authModal.className = "modal";
authModal.id = "authModal";
authModal.innerHTML = `
    <div class="modal-card checkout-card">
        <button type="button" class="modal-x" data-auth-close aria-label="Close">×</button>
        <div id="authBody"></div>
    </div>`;
document.body.appendChild(authModal);

// LOGIN / ACCOUNT button next to the bag
const accountBtn = document.createElement("button");
accountBtn.type = "button";
accountBtn.id = "accountToggle";
accountBtn.className = "icon-btn";
accountBtn.style.cssText = "font-size:10px;font-weight:700;letter-spacing:.12em";
$("#bagToggle").before(accountBtn);

function updateAccountButton() {
    accountBtn.textContent = customer ? "ACCOUNT" : "LOGIN";
}

function setAuthMsg(text, isError = true) {
    const el = $("#authMsg");
    if (!el) return;
    el.textContent = text;
    el.style.color = isError ? "#b00020" : "#2e7d32";
}

async function loadMyOrders() {
    const box = $("#authOrders");
    if (!box) return;
    try {
        const orders = await authApi("/api/account/orders");
        box.innerHTML = orders.length
            ? orders.map((o) => `
                <div class="cart-line" style="grid-template-columns:1fr auto">
                    <div>
                        #${esc(o.id)} · ${esc(o.status)}
                        <div>${o.items.map((i) => `${esc(i.name)} × ${esc(i.qty)}`).join(", ")}</div>
                    </div>
                    <strong>${money(o.total)}</strong>
                </div>`).join("")
            : '<p class="form-note">NO ORDERS YET.</p>';
    } catch (e) {
        box.innerHTML = "";
    }
}

function authView(view) {
    const body = $("#authBody");

    if (view === "email") {
        body.innerHTML = `
            <p class="kicker">WBTW / ACCOUNT</p>
            <h3>SIGN IN OR REGISTER</h3>
            <p class="form-note">Enter your email and we'll send you a 6-digit code. No password needed. New here? Your account is created automatically.</p>
            <form id="authEmailForm">
                <label>EMAIL
                    <input type="email" name="email" autocomplete="email" required value="${esc(pendingEmail)}">
                </label>
                <p class="form-note" id="authMsg" role="alert"></p>
                <button type="submit" class="pill-button">CONTINUE WITH EMAIL ↗</button>
            </form>
            <p class="form-note">You can also keep shopping and check out as a guest.</p>`;
    } else if (view === "code") {
        body.innerHTML = `
            <p class="kicker">WBTW / ACCOUNT</p>
            <h3>CHECK YOUR EMAIL</h3>
            <form id="authCodeForm">
                <label>6-DIGIT CODE
                    <input type="text" name="code" inputmode="numeric" autocomplete="one-time-code"
                           maxlength="6" pattern="[0-9]{6}" required>
                </label>
                <p class="form-note" id="authMsg" role="alert"></p>
                <button type="submit" class="pill-button">VERIFY &amp; CONTINUE ↗</button>
            </form>
            <p class="form-note">
                <button type="button" data-auth-action="resend" style="border:0;background:none;text-decoration:underline;cursor:pointer;padding:0">Resend code</button>
                &nbsp;·&nbsp;
                <button type="button" data-auth-action="change-email" style="border:0;background:none;text-decoration:underline;cursor:pointer;padding:0">Use a different email</button>
            </p>`;
    } else {
        body.innerHTML = `
            <p class="kicker">WBTW / ACCOUNT</p>
            <h3>MY ACCOUNT</h3>
            <p class="form-note">${esc(customer.email)}</p>
            <form id="authProfileForm">
                <label>FULL NAME <input type="text" name="name" autocomplete="name" value="${esc(customer.name)}"></label>
                <label>PHONE <input type="tel" name="phone" autocomplete="tel" value="${esc(customer.phone)}"></label>
                <label>DELIVERY ADDRESS <textarea name="address" rows="3" autocomplete="street-address">${esc(customer.address)}</textarea></label>
                <p class="form-note" id="authMsg" role="alert"></p>
                <button type="submit" class="pill-button">SAVE DETAILS ↗</button>
            </form>
            <h3 style="font-size:28px;margin-top:24px">MY ORDERS</h3>
            <div id="authOrders"></div>
            <p class="form-note">
                <button type="button" data-auth-action="logout" style="border:0;background:none;text-decoration:underline;cursor:pointer;padding:0">Log out</button>
            </p>`;
        loadMyOrders();
    }
}

accountBtn.addEventListener("click", () => {
    authView(customer ? "account" : "email");
    authModal.classList.add("open");
});

authModal.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.target;
    const button = form.querySelector('[type="submit"]');
    button.disabled = true;
    setAuthMsg("");

    try {
        if (form.id === "authEmailForm") {
            pendingEmail = form.elements.email.value.trim();
            await authApi("/api/auth/request-code", {
                method: "POST",
                body: JSON.stringify({ email: pendingEmail })
            });
            authView("code");
            setAuthMsg(`We sent a 6-digit code to ${pendingEmail}.`, false);
        } else if (form.id === "authCodeForm") {
            const data = await authApi("/api/auth/verify-code", {
                method: "POST",
                body: JSON.stringify({ email: pendingEmail, code: form.elements.code.value })
            });
            customer = data.customer;
            updateAccountButton();
            authView("account");
            setAuthMsg(data.isNew ? "Welcome to WBTW! Your account is ready." : "You're signed in.", false);
        } else if (form.id === "authProfileForm") {
            const data = await authApi("/api/auth/profile", {
                method: "PUT",
                body: JSON.stringify({
                    name: form.elements.name.value,
                    phone: form.elements.phone.value,
                    address: form.elements.address.value
                })
            });
            customer = data.customer;
            setAuthMsg("Saved.", false);
        }
    } catch (error) {
        setAuthMsg(error.message);
    } finally {
        button.disabled = false;
    }
});

authModal.addEventListener("click", async (event) => {
    if (event.target === authModal || event.target.closest("[data-auth-close]")) {
        authModal.classList.remove("open");
        return;
    }

    const btn = event.target.closest("[data-auth-action]");
    if (!btn) return;

    try {
        if (btn.dataset.authAction === "resend") {
            await authApi("/api/auth/request-code", {
                method: "POST",
                body: JSON.stringify({ email: pendingEmail })
            });
            setAuthMsg("A new code has been sent.", false);
        }
        if (btn.dataset.authAction === "change-email") authView("email");
        if (btn.dataset.authAction === "logout") {
            await authApi("/api/auth/logout", { method: "POST" });
            customer = null;
            updateAccountButton();
            authModal.classList.remove("open");
        }
    } catch (error) {
        setAuthMsg(error.message);
    }
});

document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") authModal.classList.remove("open");
});

// Fill the checkout form from the saved account details
$("#checkoutOpen").addEventListener("click", () => {
    const form = $("#checkoutForm");
    if (!customer || !form) return;
    [["customer_name", customer.name], ["phone", customer.phone], ["address", customer.address]]
        .forEach(([field, value]) => {
            if (form.elements[field] && !form.elements[field].value && value) {
                form.elements[field].value = value;
            }
        });
});

// Restore the session on page load
updateAccountButton();
authApi("/api/auth/me")
    .then((data) => {
        customer = data.authenticated ? data.customer : null;
        updateAccountButton();
    })
    .catch(() => updateAccountButton());

// ---------- INIT ----------

loadProducts();
renderCart();