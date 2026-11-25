
/* =========================================
   WBTW ADMIN DASHBOARD
   admin.js
========================================= */

const $ = selector => document.querySelector(selector);

let currentProducts = [];
let currentOrders = [];

/* =========================================
   API HELPER
========================================= */

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    ...options
  });

  let data = {};

  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(
      data.error || `Request failed (${response.status})`
    );
  }

  return data;
}

/* =========================================
   HELPERS
========================================= */

// Escape HTML
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

// Convert database values to boolean safely
function isTrue(value) {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true"
  );
}

// Convert comma-separated values or arrays to arrays
function toArray(value) {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return value.split(",").map(item => item.trim()).filter(Boolean);
  }

  return [];
}

// Format Philippine peso
function money(value) {
  return Number(value || 0).toLocaleString("en-PH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  });
}

// Show login screen
function showLogin() {
  $("#loginView").hidden = false;
  $("#appView").hidden = true;
}

// Show dashboard
function showDashboard(username = "Admin") {
  $("#adminUser").textContent = String(username).toUpperCase();

  $("#loginView").hidden = true;
  $("#appView").hidden = false;
}

/* =========================================
   AUTHENTICATION
========================================= */

// Check session when admin page loads
async function boot() {
  showLogin();

  try {
    const me = await api("/api/admin/me");

    if (!me.authenticated) {
      showLogin();
      return;
    }

    showDashboard(me.username || "Admin");

    await loadProducts();

  } catch (error) {
    console.error("Admin session error:", error);
    showLogin();
  }
}

// Admin login
$("#loginForm").onsubmit = async event => {
  event.preventDefault();

  const form = event.target;
  const errorBox = $("#loginError");
  const submitButton = form.querySelector('[type="submit"]');

  errorBox.textContent = "";

  const formData = new FormData(form);

  const username = formData.get("username");
  const password = formData.get("password");

  if (!username || !password) {
    errorBox.textContent = "Please enter your username and password.";
    return;
  }

  submitButton.disabled = true;

  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        username,
        password
      })
    });

    showDashboard(data.username || username);

    await loadProducts();

  } catch (error) {
    showLogin();
    errorBox.textContent = error.message;

  } finally {
    submitButton.disabled = false;
  }
};

// Admin logout
$("#logoutBtn").onclick = async () => {
  const button = $("#logoutBtn");

  button.disabled = true;

  try {
    await api("/api/admin/logout", {
      method: "POST"
    });

  } catch (error) {
    console.error("Logout error:", error);

  } finally {
    showLogin();
    location.reload();
  }
};

/* =========================================
   PRODUCT STATISTICS
========================================= */

function renderStats() {
  const total = currentProducts.length;

  const published = currentProducts.filter(product =>
    isTrue(product.active)
  ).length;

  const lowStock = currentProducts.filter(product =>
    Number(product.stock || 0) <= 5
  ).length;

  $("#stats").innerHTML = `
    <div class="stat">
      <span>TOTAL PRODUCTS</span>
      <strong>${total}</strong>
    </div>

    <div class="stat">
      <span>PUBLISHED</span>
      <strong>${published}</strong>
    </div>

    <div class="stat">
      <span>LOW STOCK (≤5)</span>
      <strong>${lowStock}</strong>
    </div>
  `;
}

/* =========================================
   LOAD PRODUCTS
========================================= */

async function loadProducts() {
  try {
    const products = await api("/api/admin/products");

    currentProducts = Array.isArray(products)
      ? products
      : [];

    renderStats();
    renderProducts();

  } catch (error) {
    console.error("Load products error:", error);

    $("#productRows").innerHTML = `
      <tr>
        <td colspan="6">
          ${esc(error.message)}
        </td>
      </tr>
    `;
  }
}

/* =========================================
   RENDER PRODUCTS
========================================= */

function renderProducts() {
  $("#productRows").innerHTML = currentProducts.map(product => {
    const active = isTrue(product.active);

    return `
      <tr>
        <td>
          <div class="item">

            <img
              src="${esc(product.image || "")}"
              alt="${esc(product.name)}"
              onerror="this.style.display='none'"
            >

            <div>
              <strong>${esc(product.name)}</strong>
              <small>ID #${esc(product.id)}</small>
            </div>

          </div>
        </td>

        <td>${esc(product.category)}</td>

        <td>₱${money(product.price)}</td>

        <td>${Number(product.stock || 0)}</td>

        <td>
          <span class="status">
            ${active ? "PUBLISHED" : "DRAFT"}
          </span>
        </td>

        <td>
          <div class="row-actions">

            <button
              type="button"
              data-edit-product="${esc(product.id)}"
            >
              Edit
            </button>

            <button
              type="button"
              data-delete-product="${esc(product.id)}"
            >
              Delete
            </button>

          </div>
        </td>
      </tr>
    `;
  }).join("") || `
    <tr>
      <td colspan="6">
        No products yet. Add your first product.
      </td>
    </tr>
  `;
}

/* =========================================
   PRODUCT EDITOR
========================================= */

function openEditor() {
  const form = $("#productForm");

  form.reset();

  form.elements.id.value = "";

  $("#editorTitle").textContent = "ADD PRODUCT";
  $("#editorError").textContent = "";

  $("#productEditor").classList.add("open");
}

// Add product
$("#addProductBtn").onclick = openEditor;

// Edit product
window.editProduct = id => {
  const product = currentProducts.find(item =>
    String(item.id) === String(id)
  );

  if (!product) {
    alert("Product not found.");
    return;
  }

  openEditor();

  $("#editorTitle").textContent = "EDIT PRODUCT";

  const form = $("#productForm");

  const fields = [
    "name",
    "category",
    "price",
    "compare_price",
    "stock",
    "description",
    "image"
  ];

  fields.forEach(key => {
    if (form.elements[key]) {
      form.elements[key].value = product[key] ?? "";
    }
  });

  form.elements.id.value = product.id;

  form.elements.sizes.value = toArray(product.sizes).join(",");
  form.elements.colors.value = toArray(product.colors).join(",");

  form.elements.featured.checked = isTrue(product.featured);
  form.elements.active.checked = isTrue(product.active);
};

// Close editor
document.querySelectorAll("[data-dismiss]").forEach(button => {
  button.onclick = () => {
    $("#productEditor").classList.remove("open");
  };
});

/* =========================================
   PRODUCT TABLE ACTIONS
========================================= */

// Handle Edit and Delete buttons safely
$("#productRows").addEventListener("click", event => {
  const editButton = event.target.closest("[data-edit-product]");
  const deleteButton = event.target.closest("[data-delete-product]");

  if (editButton) {
    editProduct(editButton.dataset.editProduct);
  }

  if (deleteButton) {
    deleteProduct(deleteButton.dataset.deleteProduct);
  }
});

/* =========================================
   DELETE PRODUCT
========================================= */

window.deleteProduct = async id => {
  const confirmed = confirm(
    "Permanently delete this product?"
  );

  if (!confirmed) return;

  try {
    await api(
      "/api/admin/products/" + encodeURIComponent(id),
      {
        method: "DELETE"
      }
    );

    await loadProducts();

  } catch (error) {
    alert(error.message);
  }
};

/* =========================================
   SAVE PRODUCT
========================================= */

$("#productForm").onsubmit = async event => {
  event.preventDefault();

  const form = event.target;
  const errorBox = $("#editorError");
  const submitButton = form.querySelector('[type="submit"]');

  errorBox.textContent = "";

  const formData = new FormData(form);

  // Explicit checkbox values
  formData.set(
    "featured",
    form.elements.featured.checked ? "1" : "0"
  );

  formData.set(
    "active",
    form.elements.active.checked ? "1" : "0"
  );

  const id = form.elements.id.value;

  const url = id
    ? "/api/admin/products/" + encodeURIComponent(id)
    : "/api/admin/products";

  submitButton.disabled = true;

  try {
    await api(url, {
      method: id ? "PUT" : "POST",
      body: formData
    });

    $("#productEditor").classList.remove("open");

    await loadProducts();

  } catch (error) {
    errorBox.textContent = error.message;

  } finally {
    submitButton.disabled = false;
  }
};

/* =========================================
   NAVIGATION
========================================= */

document.querySelectorAll("[data-view]").forEach(button => {
  button.onclick = () => {
    const view = button.dataset.view;

    document.querySelectorAll("[data-view]").forEach(item => {
      item.classList.toggle("active", item === button);
    });

    $("#productsView").hidden = view !== "products";
    $("#ordersView").hidden = view !== "orders";

    $("#pageTitle").textContent =
      view === "products" ? "Products" : "Orders";

    if (view === "orders") {
      loadOrders();
    }
  };
});

/* =========================================
   LOAD ORDERS
========================================= */

async function loadOrders() {
  try {
    const orders = await api("/api/admin/orders");

    currentOrders = Array.isArray(orders)
      ? orders
      : [];

    renderOrders();

  } catch (error) {
    console.error("Load orders error:", error);

    $("#orderRows").innerHTML = `
      <tr>
        <td colspan="6">
          ${esc(error.message)}
        </td>
      </tr>
    `;
  }
}

/* =========================================
   RENDER ORDERS
========================================= */

function renderOrders() {
  const statuses = [
    "Pending",
    "Confirmed",
    "Processing",
    "Shipped",
    "Completed",
    "Cancelled"
  ];

  $("#orderRows").innerHTML = currentOrders.map(order => {
    const currentStatus = order.status || "Pending";

    const options = [...new Set([
      ...statuses,
      currentStatus
    ])];

    return `
      <tr>
        <td>
          #${esc(order.id)}
          <br>
          <small>${esc(order.created_at)}</small>
        </td>

        <td>
          ${esc(order.customer_name)}
          <br>
          ${esc(order.phone)}
          <br>
          <small>${esc(order.address)}</small>
        </td>

        <td>
          ${(order.items || []).map(item => `
            ${esc(item.name)}
            × ${esc(item.qty)}
            (${esc(item.size)})
          `).join("<br>")}
        </td>

        <td>
          ₱${money(order.total)}
        </td>

        <td>
          <span class="status">
            ${esc(currentStatus)}
          </span>
        </td>

        <td>
          <select
            data-order-id="${esc(order.id)}"
            aria-label="Update order status"
          >
            ${options.map(status => `
              <option
                value="${esc(status)}"
                ${status === currentStatus ? "selected" : ""}
              >
                ${esc(status)}
              </option>
            `).join("")}
          </select>
        </td>
      </tr>
    `;
  }).join("") || `
    <tr>
      <td colspan="6">
        No orders yet.
      </td>
    </tr>
  `;
}

/* =========================================
   UPDATE ORDER STATUS
========================================= */

$("#orderRows").addEventListener("change", async event => {
  const select = event.target.closest("[data-order-id]");

  if (!select) return;

  const id = select.dataset.orderId;
  const status = select.value;

  const previousOrder = currentOrders.find(order =>
    String(order.id) === String(id)
  );

  const previousStatus = previousOrder
    ? previousOrder.status
    : "Pending";

  select.disabled = true;

  try {
    await api(
      "/api/admin/orders/" + encodeURIComponent(id),
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ status })
      }
    );

    await loadOrders();

  } catch (error) {
    alert(error.message);

    select.value = previousStatus;

  } finally {
    select.disabled = false;
  }
});

/* =========================================
   REFRESH ORDERS
========================================= */

$("#refreshOrders").onclick = loadOrders;

/* =========================================
   START ADMIN
========================================= */

boot();
