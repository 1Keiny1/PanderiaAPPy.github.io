// clientes.js - Lógica Frontend mejorada para clientes

// --- VARIABLES GLOBALES ---
let carrito = JSON.parse(localStorage.getItem("carrito")) || [];

// --- FUNCIONES DEL CARRITO ---
function actualizarContador() {
  const contador = document.getElementById("contadorCarrito");
  if (contador) {
    contador.textContent = carrito.reduce((acc, p) => acc + p.cantidad, 0);
  }
}

function guardarCarrito() {
  localStorage.setItem("carrito", JSON.stringify(carrito));
  actualizarContador();
}

function renderCarrito() {
  const lista = document.getElementById("listaCarrito");
  if (!lista) return;

  lista.innerHTML = "";

  if (!carrito.length) {
    lista.innerHTML = "<p class='text-center text-muted'>Tu carrito está vacío.</p>";
    actualizarContador();
    return;
  }

  carrito.forEach((p, index) => {
    const item = document.createElement("div");
    item.className = "list-group-item d-flex justify-content-between align-items-center";
    item.innerHTML = `
      <div class="d-flex align-items-center">
        <img src="${p.imagen}" alt="${p.nombre}" width="50" height="50" class="me-3 rounded">
        <div>
          <h6 class="mb-0">${p.nombre}</h6>
          <small class="text-muted">$${p.precio.toFixed(2)} c/u</small>
        </div>
      </div>
      <div>
        <button class="btn btn-sm btn-outline-secondary me-2 restar" data-index="${index}">−</button>
        <span>${p.cantidad}</span>
        <button class="btn btn-sm btn-outline-secondary ms-2 sumar" data-index="${index}">+</button>
        <button class="btn btn-sm btn-outline-danger ms-3 eliminar" data-index="${index}">
          <i class="bi bi-trash"></i>
        </button>
      </div>
    `;
    lista.appendChild(item);
  });

  // Delegación de eventos segura
  lista.querySelectorAll(".sumar").forEach(btn => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      const prod = carrito[index];
      if (!prod) return;

      if ((prod.stock ?? 0) > prod.cantidad) prod.cantidad++;
      else alert(`No hay más unidades disponibles de ${prod.nombre} (Stock máximo: ${prod.stock})`);

      guardarCarrito();
      renderCarrito();
    };
  });

  lista.querySelectorAll(".restar").forEach(btn => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      const prod = carrito[index];
      if (!prod) return;

      if (prod.cantidad > 1) prod.cantidad--;
      else carrito.splice(index, 1);

      guardarCarrito();
      renderCarrito();
    };
  });

  lista.querySelectorAll(".eliminar").forEach(btn => {
    btn.onclick = () => {
      const index = Number(btn.dataset.index);
      carrito.splice(index, 1);
      guardarCarrito();
      renderCarrito();
    };
  });

  actualizarContador();
}

// --- INICIO ---
document.addEventListener("DOMContentLoaded", () => {
  cargarProductosCliente();
  renderCarrito();
  configurarBusqueda();
  configurarCarritoVacio();
  configurarCompra();
  configurarLogout();
});

// --- FUNCIONES DE INICIO ---
function configurarBusqueda() {
  const searchBtn = document.getElementById("searchBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", e => {
      e.preventDefault();
      filtrarProductos(document.getElementById("searchInput").value);
    });
  }
}

function configurarCarritoVacio() {
  const borrarCarritoBtn = document.getElementById("borrarCarrito");
  if (borrarCarritoBtn) {
    borrarCarritoBtn.addEventListener("click", () => {
      if (confirm("¿Seguro que deseas vaciar el carrito?")) {
        carrito = [];
        guardarCarrito();
        renderCarrito();
      }
    });
  }
}

function configurarCompra() {
  const procederCompraBtn = document.getElementById("procederCompra");
  if (procederCompraBtn) {
    procederCompraBtn.addEventListener("click", async () => {
      if (!carrito.length) return alert("Tu carrito está vacío.");

      console.log("=== INICIANDO COMPRA ===");
      console.log("Carrito a enviar:", carrito);

      try {
        const res = await fetch("/comprar", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ carrito }),
          credentials: "include"
        });

        console.log("Status de respuesta:", res.status, res.statusText);

        // Intentar leer la respuesta como JSON
        let data;
        try {
          data = await res.json();
          console.log("Datos recibidos del servidor:", data);
        } catch (jsonErr) {
          console.error("Error al parsear JSON:", jsonErr);
          return alert("Error: El servidor no devolvió una respuesta válida.");
        }

        if (!res.ok) {
          console.error("Error del servidor:", data);
          // Mostrar mensaje más detallado
          const errorMsg = data.mensaje || data.error || `Error ${res.status}: ${res.statusText}`;
          return alert(errorMsg);
        }

        alert(data.mensaje || "Compra realizada con éxito 🎉");

        carrito = [];
        guardarCarrito();
        renderCarrito();
      } catch (err) {
        console.error("Error completo:", err);
        alert(`Error al procesar la compra: ${err.message}`);
      }
    });
  }
}

function configurarLogout() {
  const logoutBtn = document.getElementById("logout");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", async () => {
      try {
        const res = await fetch("/logout", { method: "POST", credentials: "include" });
        const data = await res.json();
        alert(data.mensaje);
        window.location.href = "index.html";
      } catch (err) {
        console.error(err);
        alert("Error al cerrar sesión");
      }
    });
  }
}

// --- CARGA DE PRODUCTOS ---
async function cargarProductosCliente() {
  try {
    const contTemp = document.getElementById("productos-temporada");
    const contAnio = document.getElementById("productos-anuales");
    if (contTemp) contTemp.innerHTML = "";
    if (contAnio) contAnio.innerHTML = "";

    // Productos temporada activa
    const resTemp = await fetch("/productos-temporada-activa", { credentials: "include" });
    const productosTemp = await resTemp.json();
    mostrarProductos(productosTemp, contTemp);

    // Productos todo el año
    const resAnio = await fetch("/productos-todo-el-anio", { credentials: "include" });
    const productosAnio = await resAnio.json();
    mostrarProductos(productosAnio, contAnio);
  } catch (err) {
    console.error("Error al cargar productos:", err);
  }
}

// --- RENDER DE PRODUCTOS ---
function mostrarProductos(lista, contenedor) {
  if (!contenedor) return;
  contenedor.innerHTML = "";

  if (!lista.length) {
    contenedor.innerHTML = "<p class='text-center text-muted'>No hay productos disponibles.</p>";
    return;
  }

  lista.forEach(p => {
    const card = document.createElement("div");
    card.className = "col-12 col-sm-6 col-md-4 col-lg-3 mb-4";
    card.dataset.cantidad = p.cantidad ?? 0;
    card.innerHTML = `
      <div class="card h-100 shadow-sm">
        <img src="data:image/jpeg;base64,${p.imagen}" class="card-img-top" alt="${p.nombre}" style="object-fit:cover;height:180px;">
        <div class="card-body d-flex flex-column text-center">
          <h5 class="card-title">${p.nombre}</h5>
          <p class="card-text text-muted">${p.descripcion || ""}</p>
          <p class="fw-bold">$${Number(p.precio).toFixed(2)}</p>
          ${p.nom_temporada ? `<span class="badge bg-success mb-2">Temporada: ${p.nom_temporada}</span>` : ""}
          <span class="badge bg-primary mb-2">Stock: ${p.cantidad ?? 0}</span>
          <button class="btn btn-dark btn-sm agregar-carrito mt-auto" data-id="${p.id_pan}">
            <i class="bi bi-cart-plus"></i> Agregar
          </button>
        </div>
      </div>
    `;
    contenedor.appendChild(card);
  });

  // Eventos agregar al carrito
  contenedor.querySelectorAll(".agregar-carrito").forEach(btn => {
    btn.onclick = () => {
      const id = Number(btn.dataset.id);
      const card = btn.closest(".card");
      if (!card) return;

      const nombre = card.querySelector(".card-title").textContent;
      const precio = parseFloat(card.querySelector(".fw-bold").textContent.replace("$", ""));
      const imagen = card.querySelector("img").src;
      const stock = Number(card.querySelector(".badge.bg-primary").textContent.replace("Stock: ", "")) || 0;

      const prodExistente = carrito.find(p => p.id_pan === id);
      if (prodExistente) {
        if (prodExistente.cantidad < stock) prodExistente.cantidad++;
        else return alert(`No hay más unidades de ${nombre} (Stock máximo: ${stock})`);
      } else {
        if (stock > 0) carrito.push({ id_pan: id, nombre, precio, cantidad: 1, imagen, stock });
        else return alert(`Producto ${nombre} agotado.`);
      }

      guardarCarrito();
      renderCarrito();
    };
  });
}

// --- FILTRADO ---
function filtrarProductos(termino) {
  termino = termino.toLowerCase();
  const contenedores = ["productos-temporada", "productos-anuales"];

  contenedores.forEach(id => {
    document.querySelectorAll(`#${id} .col-12`).forEach(col => {
      const card = col.querySelector(".card");
      const nombre = card.querySelector(".card-title").textContent.toLowerCase();
      const descripcion = card.querySelector(".card-text").textContent.toLowerCase();
      col.style.display = nombre.includes(termino) || descripcion.includes(termino) ? "" : "none";
    });
  });
}

// Cuando se abre el modal del historial
document.getElementById("modalHistorial").addEventListener("show.bs.modal", async () => {
    const contenedor = document.getElementById("contenedorHistorial");
    contenedor.innerHTML = `<p class="text-center text-muted">Cargando historial...</p>`;

    try {
        const res = await fetch("/historial-compras");
        const historial = await res.json();

        if (!Array.isArray(historial) || historial.length === 0) {
            contenedor.innerHTML = `<p class="text-center text-muted">No tienes compras realizadas.</p>`;
            return;
        }

        contenedor.innerHTML = "";

        historial.forEach(venta => {
            // Card por venta
            const item = document.createElement("div");
            item.classList.add("list-group-item");

            let productosHTML = "";
            venta.productos.forEach(p => {
                productosHTML += `
                    <div class="d-flex justify-content-between">
                        <span>${p.nombre_pan} (x${p.cantidad})</span>
                        <span>$${p.subtotal}</span>
                    </div>
                `;
            });

            item.innerHTML = `
                <div class="fw-bold">Venta #${venta.id_venta}</div>
                <div class="text-muted">${venta.fecha}</div>
                <hr>
                ${productosHTML}
                <hr>
                <div class="d-flex justify-content-between fw-bold">
                    <span>Total:</span>
                    <span>$${venta.total}</span>
                </div>
            `;

            contenedor.appendChild(item);
        });

    } catch (error) {
        contenedor.innerHTML = `<p class="text-danger text-center">Error al obtener el historial.</p>`;
        console.error(error);
    }
});