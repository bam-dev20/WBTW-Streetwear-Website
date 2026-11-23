const $ = s => document.querySelector(s);
let currentProducts = [];

// 1. FIXED: Added default credentials so session cookies are saved and sent
async function api(url, options = {}) {
  const defaultOptions = { credentials: "same-origin" }; // Change to "include" if API is on a different domain
  const finalOptions = { ...defaultOptions, ...options };
  
  const r = await fetch(url, finalOptions);
  let d = {};
  
  try {
    d = await r.json();
  } catch {}
  
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

async function boot() {
  try {
    const me = await api("/api/admin/me");
    if (me.authenticated) {
      $("#loginView").hidden = true;
      $("#appView").hidden = false;
      // 2. FIXED: Safely check if username exists before calling toUpperCase()
      $("#adminUser").textContent = (me.username || "Admin").toUpperCase();
      await loadProducts();
    } else {
      $("#loginView").hidden = false;
      $("#appView").hidden = true;
    }
  } catch {
    $("#loginView").hidden = false;
  }
}

$("#loginForm").onsubmit = async e => {
  e.preventDefault();
  $("#loginError").textContent = "";
  
  const f = new FormData(e.target);
  
  try {
    const d = await api("/api/admin/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: f.get("username"),
        password: f.get("password")
      })
    });
    
    // 3. FIXED: Safe property check prevents TypeError crashes on login success
    $("#adminUser").textContent = (d.username || f.get("username") || "Admin").toUpperCase();
    $("#loginView").hidden = true;
    $("#appView").hidden = false;
    
    await loadProducts();
  } catch (err) {
    $("#loginError").textContent = err.message;
  }
};

$("#logoutBtn").onclick = async () => {
  await api("/api/admin/logout", { method: "POST" });
  location.reload();
};

async function loadProducts() {
  currentProducts = await api("/api/admin/products");
  
  $("#stats").innerHTML = `
    <div class="stat"><span>TOTAL PRODUCTS</span><strong>${currentProducts.length}</strong></div>
    <div class="stat"><span>PUBLISHED</span><strong>${currentProducts.filter(p => p.active).length}</strong></div>
    <div class="stat"><span>LOW STOCK (≤5)</span><strong>${currentProducts.filter(p => p.stock <= 5).length}</strong></div>
  `;
  
  $("#productRows").innerHTML = currentProducts.map(p => `
    <tr>
      <td>
        <div class="item">
          <img src="${p.image}" alt="">
          <div><strong>${esc(p.name)}</strong><small>ID #${p.id}</small></div>
        </div>
      </td>
      <td>${esc(p.category)}</td>
      <td>₱${Number(p.price).toLocaleString("en-PH")}</td>
      <td>${p.stock}</td>
      <td><span class="status">${p.active ? "PUBLISHED" : "DRAFT"}</span></td>
      <td>
        <div class="row-actions">
          <button onclick="editProduct(${p.id})">Edit</button>
          <button onclick="deleteProduct(${p.id})">Delete</button>
        </div>
      </td>
    </tr>
  `).join("") || '<tr><td colspan="6">No products. Add your first product.</td></tr>';
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function openEditor() {
  $("#productForm").reset();
  $("#productForm").elements.id.value = "";
  $("#editorTitle").textContent = "ADD PRODUCT";
  $("#editorError").textContent = "";
  $("#productEditor").classList.add("open");
}

window.editProduct = id => {
  const p = currentProducts.find(x => x.id === id);
  if (!p) return;
  
  openEditor();
  $("#editorTitle").textContent = "EDIT PRODUCT";
  
  const f = $("#productForm");
  for (const k of ["name", "category", "price", "compare_price", "stock", "description", "image"]) {
    f.elements[k].value = p[k] ?? "";
  }
  
  f.elements.id.value = p.id;
  f.elements.sizes.value = (p.sizes || []).join(",");
  f.elements.colors.value = (p.colors || []).join(",");
  f.elements.featured.checked = !!p.featured;
  f.elements.active.checked = !!p.active;
};

window.deleteProduct = async id => {
  if (!confirm("Permanently delete this product?")) return;
  try {
    await api("/api/admin/products/" + id, { method: "DELETE" });
    await loadProducts();
  } catch (e) {
    alert(e.message);
  }
};

$("#addProductBtn").onclick = openEditor;

document.querySelectorAll("[data-dismiss]").forEach(b => {
  b.onclick = () => $("#productEditor").classList.remove("open");
});

$("#productForm").onsubmit = async e => {
  e.preventDefault();
  $("#editorError").textContent = "";
  
  const f = e.target;
  const fd = new FormData(f);
  fd.set("featured", f.elements.featured.checked ? "1" : "0");
  fd.set("active", f.elements.active.checked ? "1" : "0");
  
  const id = f.elements.id.value;
  try {
    await api(id ? "/api/admin/products/" + id : "/api/admin/products", {
      method: id ? "PUT" : "POST",
      body: fd // Note: do not set Content-Type manually when sending FormData
    });
    $("#productEditor").classList.remove("open");
    await loadProducts();
  } catch (err) {
    $("#editorError").textContent = err.message;
  }
};

document.querySelectorAll("[data-view]").forEach(b => {
  b.onclick = () => {
    document.querySelectorAll("[data-view]").forEach(x => x.classList.toggle("active", x === b));
    $("#productsView").hidden = b.dataset.view !== "products";
    $("#ordersView").hidden = b.dataset.view !== "orders";
    $("#pageTitle").textContent = b.dataset.view === "products" ? "Products" : "Orders";
    if (b.dataset.view === "orders") loadOrders();
  };
});

async function loadOrders() {
  try {
    const orders = await api("/api/admin/orders");
    $("#orderRows").innerHTML = orders.map(o => `
      <tr>
        <td>#${o.id}<br><small>${esc(o.created_at)}</small></td>
        <td>${esc(o.customer_name)}<br>${esc(o.phone)}<br><small>${esc(o.address)}</small></td>
        <td>${(o.items || []).map(i => `${esc(i.name)} × ${i.qty} (${esc(i.size)})`).join("<br>")}</td>
        <td>₱${Number(o.total).toLocaleString("en-PH")}</td>
        <td><span class="status">${esc(o.status)}</span></td>
        <td>
          <select onchange="updateOrder(${o.id}, this.value)">
            ${["Pending", "Confirmed", "Processing", "Shipped", "Completed", "Cancelled"].map(s => 
              `<option ${s === o.status ? "selected" : ""}>${s}</option>`
            ).join("")}
          </select>
        </td>
      </tr>
    `).join("") || '<tr><td colspan="6">No orders yet.</td></tr>';
  } catch (e) {
    $("#orderRows").innerHTML = `<tr><td colspan="6">${esc(e.message)}</td></tr>`;
  }
}

window.updateOrder = async (id, status) => {
  try {
    await api("/api/admin/orders/" + id, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    });
  } catch (e) {
    alert(e.message);
  }
};

$("#refreshOrders").onclick = loadOrders;

boot();