
const $ = (selector) => document.querySelector(selector);

let products = [];
let cart = [];
let activeCategory = "All";
let searchTerm = "";

const money = (n) =>
    "₱" + Number(n).toLocaleString("en-PH", {
        maximumFractionDigits: 0
    });

const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[char]);

const fallbackImage =
    "https://placehold.co/800x1000/e3e1db/111?text=WBTW";

// Only allow safe image URL schemes.
function safeImage(url) {
    const value = String(url || "").trim();

    if (
        value.startsWith("/") &&
        !value.startsWith("//")
    ) {
        return esc(value);
    }

    try {
        const parsed = new URL(value, window.location.origin);

        if (["http:", "https:"].includes(parsed.protocol)) {
            return esc(value);
        }
    } catch (error) {
        // Use fallback below.
    }

    return fallbackImage;
}

// --------------------------------------------------
// PRODUCT LOADING
// --------------------------------------------------

async function loadProducts() {
    try {
        const response = await fetch("/api/products");

        if (!response.ok) {
            throw new Error("Unable to load products.");
        }

        products = await response.json();

        renderProducts();

    } catch (error) {
        console.error("Product loading error:", error);

        $("#productGrid").innerHTML =
            '<p class="no-products">STORE CONNECTION UNAVAILABLE. PLEASE REFRESH.</p>';
    }
}

// --------------------------------------------------
// PRODUCT FILTERING AND SORTING
// --------------------------------------------------

function filteredProducts() {
    let list = products.filter((product) => {
        const matchesCategory =
            activeCategory === "All" ||
            product.category === activeCategory;

        const searchableText =
            `${product.name} ${product.category} ${product.description}`
                .toLowerCase();

        return matchesCategory &&
            searchableText.includes(searchTerm);
    });

    const sort = $("#sortSelect").value;

    if (sort === "low") {
        list.sort((a, b) => a.price - b.price);
    }

    if (sort === "high") {
        list.sort((a, b) => b.price - a.price);
    }

    if (sort === "newest") {
        list.sort((a, b) => b.id - a.id);
    }

    return list;
}

// --------------------------------------------------
// PRODUCT RENDERING
// --------------------------------------------------

function renderProducts() {
    const list = filteredProducts();

    $("#allCount").textContent =
        String(products.length).padStart(2, "0");

    $("#productGrid").innerHTML = list.length
        ? list.map((product) => `
            <article
                class="product-card reveal visible"
                data-id="${esc(product.id)}"
            >
                <div
                    class="product-media"
                    data-action="open-product"
                    data-id="${esc(product.id)}"
                    role="button"
                    tabindex="0"
                >
                    ${
                        product.featured
                            ? '<span class="product-label">WBTW FEATURED</span>'
                            : ""
                    }

                    <img
                        class="product-image"
                        src="${safeImage(product.image)}"
                        alt="${esc(product.name)}"
                        loading="lazy"
                    >

                    <button
                        type="button"
                        class="quick-add"
                        data-action="open-product"
                        data-id="${esc(product.id)}"
                    >
                        QUICK VIEW +
                    </button>
                </div>

                <div
                    class="product-details"
                    data-action="open-product"
                    data-id="${esc(product.id)}"
                    role="button"
                    tabindex="0"
                >
                    <div>
                        <div class="product-title">
                            ${esc(product.name)}
                        </div>

                        <div class="product-category">
                            ${esc(product.category)}
                        </div>
                    </div>

                    <div class="product-price">
                        ${money(product.price)}
                    </div>
                </div>
            </article>
        `).join("")
        : '<p class="no-products">NO PIECES FOUND. CHECK BACK FOR THE NEXT DROP.</p>';
}

// --------------------------------------------------
// CART DRAWER
// --------------------------------------------------

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

    const found = cart.find(
        (item) => item.id === product.id && item.size === size
    );

    if (found) {
        found.qty++;
    } else {
        cart.push({
            id: product.id,
            name: product.name,
            price: product.price,
            image: product.image,
            size,
            qty: 1
        });
    }

    renderCart();

    $("#productModal").classList.remove("open");

    showCart();
}

function renderCart() {
    const qty = cart.reduce(
        (sum, item) => sum + item.qty,
        0
    );

    const total = cart.reduce(
        (sum, item) => sum + item.price * item.qty,
        0
    );

    $("#bagCount").textContent = qty;
    $("#drawerCount").textContent = `(${qty})`;
    $("#subtotal").textContent = money(total);

    $("#cartLines").innerHTML = cart.length
        ? cart.map((item, index) => `
            <div class="cart-line">
                <img
                    class="cart-product-image"
                    src="${safeImage(item.image)}"
                    alt="${esc(item.name)}"
                >

                <div>
                    ${esc(item.name)}

                    <div>${esc(item.size)}</div>

                    <strong>${money(item.price)}</strong>

                    <div class="qty-controls">
                        <button
                            type="button"
                            data-action="change-qty"
                            data-index="${index}"
                            data-change="-1"
                            aria-label="Decrease quantity"
                        >
                            −
                        </button>

                        ${item.qty}

                        <button
                            type="button"
                            data-action="change-qty"
                            data-index="${index}"
                            data-change="1"
                            aria-label="Increase quantity"
                        >
                            +
                        </button>
                    </div>
                </div>

                <button
                    type="button"
                    data-action="remove-cart"
                    data-index="${index}"
                >
                    REMOVE
                </button>
            </div>
        `).join("")
        : '<p class="empty-cart">YOUR BAG IS EMPTY.</p>';
}

function changeQty(index, amount) {
    const item = cart[index];

    if (!item) return;

    item.qty += amount;

    if (item.qty < 1) {
        cart.splice(index, 1);
    }

    renderCart();
}

function removeCart(index) {
    if (!cart[index]) return;

    cart.splice(index, 1);

    renderCart();
}

// --------------------------------------------------
// PRODUCT MODAL
// --------------------------------------------------

function openProduct(id) {
    const product = products.find(
        (item) => String(item.id) === String(id)
    );

    if (!product) return;

    const modalContent = $("#productModalContent");

    modalContent.dataset.productId = product.id;

    modalContent.innerHTML = `
        <img
            class="modal-product-image"
            src="${safeImage(product.image)}"
            alt="${esc(product.name)}"
        >

        <div class="product-modal-info">

            <p class="kicker">
                ${esc(product.category)} / WBTW®
            </p>

            <h3>${esc(product.name)}</h3>

            <div class="modal-price">
                ${money(product.price)}
            </div>

            <p>${esc(product.description)}</p>

            <label>
                SELECT SIZE

                <select id="modalSize">
                    ${(product.sizes || ["S", "M", "L", "XL"])
                        .map((size) => `
                            <option value="${esc(size)}">
                                ${esc(size)}
                            </option>
                        `).join("")}
                </select>
            </label>

            <p>
                ${
                    product.stock > 0
                        ? `${product.stock} PIECES AVAILABLE`
                        : "SOLD OUT"
                }
            </p>

            <button
                type="button"
                class="pill-button"
                data-action="add-to-cart"
                ${product.stock <= 0 ? "disabled" : ""}
            >
                ADD TO BAG ↗
            </button>

        </div>
    `;

    $("#productModal").classList.add("open");
}

// --------------------------------------------------
// MOBILE MENU
// --------------------------------------------------

const mobileMenu = $("#mobileMenu");
const siteHeader = $("#header");

function positionMobileMenu() {
    if (mobileMenu && siteHeader) {
        mobileMenu.style.top =
            `${siteHeader.getBoundingClientRect().bottom}px`;
    }
}

// --------------------------------------------------
// PRODUCT IMAGE FALLBACK
// --------------------------------------------------

// Error events do not bubble normally, so use capture.
function handleImageError(event) {
    const image = event.target;

    if (
        image instanceof HTMLImageElement &&
        !image.dataset.fallbackApplied
    ) {
        image.dataset.fallbackApplied = "true";
        image.src = fallbackImage;
    }
}

$("#productGrid").addEventListener(
    "error",
    handleImageError,
    true
);

$("#cartLines").addEventListener(
    "error",
    handleImageError,
    true
);

$("#productModalContent").addEventListener(
    "error",
    handleImageError,
    true
);

// --------------------------------------------------
// EVENT LISTENERS: PRODUCT GRID
// --------------------------------------------------

$("#productGrid").addEventListener("click", (event) => {
    const target = event.target.closest('[data-action="open-product"]');

    if (!target) return;

    openProduct(target.dataset.id);
});

$("#productGrid").addEventListener("keydown", (event) => {
    if (
        event.key !== "Enter" &&
        event.key !== " "
    ) return;

    const target = event.target.closest(
        '[data-action="open-product"]'
    );

    if (!target || target.tagName === "BUTTON") return;

    event.preventDefault();

    openProduct(target.dataset.id);
});

// --------------------------------------------------
// EVENT LISTENERS: CART
// --------------------------------------------------

$("#cartLines").addEventListener("click", (event) => {
    const button = event.target.closest("[data-action]");

    if (!button) return;

    const index = Number(button.dataset.index);

    if (button.dataset.action === "change-qty") {
        changeQty(index, Number(button.dataset.change));
    }

    if (button.dataset.action === "remove-cart") {
        removeCart(index);
    }
});

// --------------------------------------------------
// EVENT LISTENERS: PRODUCT MODAL
// --------------------------------------------------

$("#productModalContent").addEventListener("click", (event) => {
    const button = event.target.closest(
        '[data-action="add-to-cart"]'
    );

    if (!button || button.disabled) return;

    const productId = $("#productModalContent").dataset.productId;

    const product = products.find(
        (item) => String(item.id) === String(productId)
    );

    const size = $("#modalSize").value;

    addCart(product, size);
});

// --------------------------------------------------
// HEADER AND NAVIGATION
// --------------------------------------------------

$("#bagToggle").addEventListener("click", showCart);
$("#cartClose").addEventListener("click", hideCart);
$("#scrim").addEventListener("click", hideCart);

document.querySelectorAll("[data-close]").forEach((button) => {
    button.addEventListener("click", () => {
        const modal = $("#" + button.dataset.close);

        if (modal) modal.classList.remove("open");
    });
});

document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (event) => {
        if (event.target === modal) {
            modal.classList.remove("open");
        }
    });
});

// --------------------------------------------------
// CATEGORY FILTERS
// --------------------------------------------------

document.querySelectorAll("[data-filter]").forEach((button) => {
    button.addEventListener("click", () => {
        activeCategory = button.dataset.filter;

        document.querySelectorAll(".filter").forEach((item) => {
            item.classList.toggle(
                "active",
                item === button
            );
        });

        renderProducts();
    });
});

document.querySelectorAll("[data-cat]").forEach((link) => {
    link.addEventListener("click", () => {
        activeCategory = link.dataset.cat;

        document.querySelectorAll(".filter").forEach((button) => {
            button.classList.toggle(
                "active",
                button.dataset.filter === activeCategory
            );
        });

        renderProducts();

        mobileMenu?.classList.remove("open");
    });
});

// --------------------------------------------------
// SORTING AND SEARCH
// --------------------------------------------------

$("#sortSelect").addEventListener("change", renderProducts);

$("#searchToggle").addEventListener("click", () => {
    $("#searchBar").classList.toggle("show");
});

$("#searchClose").addEventListener("click", () => {
    $("#searchBar").classList.remove("show");
});

$("#searchInput").addEventListener("input", (event) => {
    searchTerm = event.target.value.toLowerCase();

    renderProducts();
});

// --------------------------------------------------
// MOBILE MENU TOGGLE
// --------------------------------------------------

$("#menuToggle").addEventListener("click", () => {
    if (!mobileMenu) return;

    const willOpen = !mobileMenu.classList.contains("open");

    mobileMenu.classList.toggle("open");

    if (willOpen) {
        positionMobileMenu();
    }
});

window.addEventListener("resize", () => {
    if (mobileMenu?.classList.contains("open")) {
        positionMobileMenu();
    }
});

// --------------------------------------------------
// CHECKOUT
// --------------------------------------------------

$("#checkoutOpen").addEventListener("click", () => {
    if (!cart.length) {
        alert("Your bag is empty.");
        return;
    }

    $("#checkoutModal").classList.add("open");
});

$("#checkoutForm").addEventListener("submit", async (event) => {
    event.preventDefault();

    const form = new FormData(event.target);

    const payload = {
        customer_name: form.get("customer_name"),
        phone: form.get("phone"),
        address: form.get("address"),

        items: cart.map((item) => ({
            id: item.id,
            qty: item.qty,
            size: item.size
        }))
    };

    try {
        const response = await fetch("/api/orders", {
            method: "POST",

            headers: {
                "Content-Type": "application/json"
            },

            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || "Order submission failed.");
        }

        alert(
            `Thank you! Your order request #${data.orderId} was received. Total: ${money(data.total)}. The store will contact you to confirm delivery.`
        );

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

// --------------------------------------------------
// NEWSLETTER
// --------------------------------------------------

$("#newsletterForm").addEventListener("submit", (event) => {
    event.preventDefault();

    $("#newsletterMsg").textContent =
        "THANK YOU — YOU'RE ON THE LIST.";

    event.target.reset();
});

// --------------------------------------------------
// HEADER SCROLL EFFECT
// --------------------------------------------------

$("#year").textContent = new Date().getFullYear();

window.addEventListener("scroll", () => {
    $("#header").classList.toggle(
        "compact",
        window.scrollY > 70
    );

    if (mobileMenu?.classList.contains("open")) {
        positionMobileMenu();
    }
});

// --------------------------------------------------
// SCROLL REVEAL
// --------------------------------------------------

const observer = new IntersectionObserver(
    (entries) => {
        entries.forEach((entry) => {
            if (entry.isIntersecting) {
                entry.target.classList.add("visible");

                observer.unobserve(entry.target);
            }
        });
    },
    {
        threshold: 0.12
    }
);

document.querySelectorAll(".reveal").forEach((element) => {
    observer.observe(element);
});

// --------------------------------------------------
// INITIALIZATION
// --------------------------------------------------

loadProducts();

renderCart();
