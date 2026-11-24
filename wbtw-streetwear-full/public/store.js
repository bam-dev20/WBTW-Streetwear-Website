const $=s=>document.querySelector(s);
let products=[],cart=[],activeCategory="All",searchTerm="";
const money=n=>"₱"+Number(n).toLocaleString("en-PH", {
  maximumFractionDigits:0
}
);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function loadProducts(){try{const r=await fetch("/api/products");products=await r.json();renderProducts()}catch(e){$("#productGrid").innerHTML='<p class="no-products">STORE CONNECTION UNAVAILABLE. PLEASE REFRESH.</p>'}}
function filteredProducts(){let list=products.filter(p=>(activeCategory==="All"||p.category===activeCategory)&&(`${p.name} ${p.category} ${p.description}`).toLowerCase().includes(searchTerm));const sort=$("#sortSelect").value;if(sort==="low")list.sort((a,b)=>a.price-b.price);if(sort==="high")list.sort((a,b)=>b.price-a.price);if(sort==="newest")list.sort((a,b)=>b.id-a.id);return list}
function renderProducts(){const list=filteredProducts();$("#allCount").textContent=String(products.length).padStart(2,"0");$("#productGrid").innerHTML=list.length?list.map(p=>`<article class="product-card reveal visible" data-id="$ {
  p.id
}
"><div class="product-media" onclick="openProduct($ {
  p.id
}
)">${p.featured?'<span class="product-label">WBTW FEATURED</span>':""}<img src="$ {
  esc(p.image)
}
" alt="$ {
  esc(p.name)
}
" loading="lazy" onerror="this.src='https://placehold.co/800x1000/e3e1db/111?text=WBTW'"><button class="quick-add" onclick="event.stopPropagation();
openProduct($ {
  p.id
}
)">QUICK VIEW +</button></div><div class="product-details" onclick="openProduct($ {
  p.id
}
)"><div><div class="product-title">${esc(p.name)}</div><div class="product-category">${esc(p.category)}</div></div><div class="product-price">${money(p.price)}</div></div></article>`).join(""):'<p class="no-products">NO PIECES FOUND. CHECK BACK FOR THE NEXT DROP.</p>'}
function showCart(){ $("#cartDrawer").classList.add("open");$("#scrim").classList.add("show");document.body.classList.add("lock");}
function hideCart(){ $("#cartDrawer").classList.remove("open");$("#scrim").classList.remove("show");document.body.classList.remove("lock");}
function addCart(p,size){const found=cart.find(x=>x.id===p.id&&x.size===size);if(found)found.qty++;else cart.push({id:p.id,name:p.name,price:p.price,image:p.image,size,qty:1});renderCart();$("#productModal").classList.remove("open");showCart();}
function renderCart(){const qty=cart.reduce((s,x)=>s+x.qty,0),total=cart.reduce((s,x)=>s+x.price*x.qty,0);$("#bagCount").textContent=qty;$("#drawerCount").textContent=`(${qty})`;$("#subtotal").textContent=money(total);$("#cartLines").innerHTML=cart.length?cart.map((x,i)=>`<div class="cart-line"><img src="$ {
  esc(x.image)
}
" alt=""><div>${esc(x.name)}<div>${esc(x.size)}</div><strong>${money(x.price)}</strong><div class="qty-controls"><button onclick="changeQty($ {
  i
}
,-1)">−</button>${x.qty}<button onclick="changeQty($ {
  i
}
,1)">+</button></div></div><button onclick="removeCart($ {
  i
}
)">REMOVE</button></div>`).join(""):'<p class="empty-cart">YOUR BAG IS EMPTY.</p>'}
function changeQty(i,n){cart[i].qty+=n;if(cart[i].qty<1)cart.splice(i,1);renderCart()}function removeCart(i){cart.splice(i,1);renderCart()}
window.openProduct=id=>{const p=products.find(x=>x.id===id);if(!p)return;$("#productModalContent").innerHTML=`<img src="$ {
  esc(p.image)
}
" alt="$ {
  esc(p.name)
}
"><div class="product-modal-info"><p class="kicker">${esc(p.category)} / WBTW®</p><h3>${esc(p.name)}</h3><div class="modal-price">${money(p.price)}</div><p>${esc(p.description)}</p><label>SELECT SIZE<select id="modalSize">${(p.sizes||["S","M","L","XL"]).map(s=>`<option>${esc(s)}</option>`).join("")}</select></label><p>${p.stock>0?`${p.stock} PIECES AVAILABLE`:"SOLD OUT"}</p><button class="pill-button" ${p.stock<=0?"disabled":""} onclick="addCart(products.find(x=>x.id===$ {
  p.id
}
),$('#modalSize').value)">ADD TO BAG ↗</button></div>`;$("#productModal").classList.add("open")};
$("#bagToggle").onclick=showCart;$("#cartClose").onclick=hideCart;$("#scrim").onclick=hideCart;
document.querySelectorAll("[data-close]").forEach(b=>b.onclick=()=>$("#"+b.dataset.close).classList.remove("open"));
document.querySelectorAll(".modal").forEach(m=>m.addEventListener("click",e=>{if(e.target===m)m.classList.remove("open")}));
document.querySelectorAll("[data-filter]").forEach(b=>b.addEventListener("click",()=>{activeCategory=b.dataset.filter;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x===b));renderProducts()}));
const mobileMenu=$("#mobileMenu");
const siteHeader=$("#header");
const positionMobileMenu=()=>{if(mobileMenu&&siteHeader)mobileMenu.style.top=`${siteHeader.getBoundingClientRect().bottom}px`};
document.querySelectorAll("[data-cat]").forEach(a=>a.addEventListener("click",()=>{activeCategory=a.dataset.cat;document.querySelectorAll(".filter").forEach(x=>x.classList.toggle("active",x.dataset.filter===activeCategory));renderProducts();mobileMenu?.classList.remove("open")}));
$("#sortSelect").onchange=renderProducts;$("#searchToggle").onclick=()=>$("#searchBar").classList.toggle("show");$("#searchClose").onclick=()=>$("#searchBar").classList.remove("show");$("#searchInput").oninput=e=>{searchTerm=e.target.value.toLowerCase();renderProducts()};
$("#menuToggle").onclick=()=>{if(!mobileMenu)return;const willOpen=!mobileMenu.classList.contains("open");mobileMenu.classList.toggle("open");if(willOpen)positionMobileMenu()};
window.addEventListener("resize",()=>{if(mobileMenu?.classList.contains("open"))positionMobileMenu()});
$("#checkoutOpen").onclick=()=>{if(!cart.length){alert("Your bag is empty.");return}$("#checkoutModal").classList.add("open")};
$("#checkoutForm").onsubmit=async e=>{e.preventDefault();const form=new FormData(e.target);const payload={customer_name:form.get("customer_name"),phone:form.get("phone"),address:form.get("address"),items:cart.map(x=>({id:x.id,qty:x.qty,size:x.size}))};try{const r=await fetch("/api/orders",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const data=await r.json();if(!r.ok)throw new Error(data.error);alert(`Thank you! Your order request #${data.orderId} was received. Total: ${money(data.total)}. The store will contact you to confirm delivery.`);cart=[];renderCart();$("#checkoutModal").classList.remove("open");hideCart();e.target.reset();await loadProducts()}catch(err){alert(err.message)}};
$("#newsletterForm").onsubmit=e=>{e.preventDefault();$("#newsletterMsg").textContent="THANK YOU — YOU'RE ON THE LIST.";e.target.reset()};
$("#year").textContent=new Date().getFullYear();window.addEventListener("scroll",()=>{$("#header").classList.toggle("compact",window.scrollY>70);if(mobileMenu?.classList.contains("open"))positionMobileMenu()});
const observer=new IntersectionObserver(entries=>entries.forEach(e=>{if(e.isIntersecting){e.target.classList.add("visible");observer.unobserve(e.target)}}),{threshold:.12});document.querySelectorAll(".reveal").forEach(el=>observer.observe(el));
loadProducts();renderCart();