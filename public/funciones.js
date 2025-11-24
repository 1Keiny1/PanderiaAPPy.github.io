// funciones.js - Lógica Frontend para la panadería

// Inventario

document.addEventListener('DOMContentLoaded', () => {
    cargarProductos();
  
  const btnTemporada = document.getElementById("btnActivarTemporada");
  if(btnTemporada) {
  btnTemporada.addEventListener("click", async () => {
  const select = document.getElementById("temporadaActiva");
  const id = select.value;

  if (!id || id === "0") {
    return alert("Selecciona una temporada");
  }

    try {
      const res = await fetch("/temporada/activar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_temporada: id }),
        credentials: "include"
      });

      if (!res.ok) throw new Error("Error en la respuesta del servidor");

      const data = await res.json();
      alert(data.mensaje || "Temporada activada correctamente");
    } catch(err) {
      console.error(err);
      alert("Error al activar la temporada");
    }
  });
  }

  const btnDesactivar = document.getElementById("btnDesactivarTemporada");
  if(btnDesactivar) {
  btnDesactivar.addEventListener("click", async () => {
    try {
      const res = await fetch("/temporada/desactivar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include"
      });
      const data = await res.json();
      alert(data.mensaje || "Temporada desactivada correctamente");
      cargarProductos();
    } catch(err) {
      console.error(err);
      alert("Error al desactivar la temporada");
    }
  });
  }

    const form = document.getElementById('formProducto');
    form.addEventListener('submit', guardarProducto);
  });
  
  function cargarProductos() {
    fetch('/obtenerProducto', { credentials: "include" })
      .then(res => res.json())
      .then(productos => {
        const tbody = document.querySelector('#tablaProductos tbody');
        tbody.innerHTML = '';
        productos.forEach((prod, idx) => {
          const imgSrc = prod.imagen ? `/imagen/${prod.id_pan}` : 'https://cdn-icons-png.flaticon.com/128/3014/3014502.png';
          tbody.innerHTML += `
            <tr>
              <td>${idx + 1}</td>
              <td><img src="${imgSrc}" alt="pan" class="img-thumbnail" style="width:120px;height:120px;object-fit:cover;"></td>
              <td>${prod.nombre}</td>
              <td>$${Number(prod.precio).toFixed(2)}</td>
              <td>${prod.cantidad}</td>
              <td>${prod.nom_temporada ? prod.nom_temporada : 'Todo el año'}</td>
              <td>${prod.descripcion || ''}</td>
              <td>
                <button class="btn btn-sm btn-warning me-1 btn-editar" data-prod='${JSON.stringify(prod).replace(/'/g, "&#39;")}' type="button">Editar</button>
                <button class="btn btn-sm btn-danger" onclick="borrarProducto(${prod.id_pan})">Borrar</button>
              </td>
            </tr>
          `;
        });
        // Asignar eventos a los botones editar
        document.querySelectorAll('.btn-editar').forEach(btn => {
          btn.addEventListener('click', function() {
            editarProducto(this.getAttribute('data-prod'));
          });
        });
      });
  }
  
function guardarProducto(e) {
  console.log("Ejecutando guardarProducto...", e);
  if (e && typeof e.preventDefault === 'function') e.preventDefault();

  const form = (e && e.target) ? e.target : document.getElementById('formProducto');

  const id = form.id_pan.value;
  const nombre = form.nombre.value.trim();
  const descripcion = form.descripcion.value.trim();
  const precio = form.precio.value;
  const cantidad = form.cantidad.value;
  const imagenInput = form.imagen;
  const temporada = form.temporada;
  const mensajeError = document.getElementById('mensajeError');
  mensajeError.classList.add('d-none');

  // Validación JS
  const etiquetaRegex = /<[^>]*>|<\?php.*?\?>/i;
  const numeroRegex = /\d/;
  if (!nombre || !precio || !cantidad || precio <= 0 || cantidad < 0) {
    mensajeError.textContent = 'Todos los campos obligatorios deben ser válidos.';
    mensajeError.classList.remove('d-none');
    return;
  }
  if (etiquetaRegex.test(nombre) || etiquetaRegex.test(descripcion)) {
    mensajeError.textContent = 'No se permiten etiquetas HTML, JS o PHP en el nombre o la descripción.';
    mensajeError.classList.remove('d-none');
    return;
  }
  if (numeroRegex.test(nombre) || numeroRegex.test(descripcion)) {
    mensajeError.textContent = 'No se permiten números en el nombre o la descripción.';
    mensajeError.classList.remove('d-none');
    return;
  }

  const formData = new FormData();
  formData.append('nombre', nombre);
  formData.append('descripcion', descripcion);
  formData.append('precio', precio);
  formData.append('cantidad', cantidad);
  formData.append("temporada", document.getElementById("temporada").value);
  if (imagenInput.files && imagenInput.files[0]) {
    formData.append('imagen', imagenInput.files[0]);
  }
  let url = '/agregarProducto';
  if (id) {
    formData.append('id_pan', id);
    url = '/actualizarProducto';
  }

  try {
    const entries = Array.from(formData.entries()).map(([k, v]) => [k, (v instanceof File) ? v.name : v]);
    console.log("FormData a enviar:", entries);
  } catch (err) {
    console.log("No se pudo listar FormData (ok):", err);
  }

  fetch(url, { method: 'POST', body: formData, credentials: "include" })
    .then(res => res.json().catch(() => { throw new Error("Respuesta inválida del servidor"); }))
    .then(resp => {
      if (resp.error) {
        mensajeError.textContent = resp.error;
        mensajeError.classList.remove('d-none');
      } else {
        bootstrap.Modal.getOrCreateInstance(document.getElementById('modalProducto')).hide();
        form.reset();
        cargarProductos();
      }
    })
    .catch(err => {
      mensajeError.textContent = err.message || 'Error de red o servidor.';
      mensajeError.classList.remove('d-none');
      console.error(err);
    });
}

  
function editarProducto(prodStr) {
  let prod;
  try {
    prod = JSON.parse(prodStr);
  } catch {
    prod = JSON.parse(decodeURIComponent(prodStr));
  }
  document.getElementById('id_pan').value = prod.id_pan;
  document.getElementById('nombre').value = prod.nombre;
  document.getElementById('descripcion').value = prod.descripcion || '';
  document.getElementById('precio').value = prod.precio;
  document.getElementById('cantidad').value = prod.cantidad;
  // Limpiar input file
  document.getElementById('imagen').value = '';
  document.getElementById('temporada').value = prod.temporada || 1;
  document.getElementById('mensajeError').classList.add('d-none');
  const modal = new bootstrap.Modal(document.getElementById('modalProducto'));
  modal.show();
}
  
  function borrarProducto(id) {
    if (!confirm('¿Seguro que deseas borrar este pan?')) return;
    fetch('/borrarProducto', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id_pan: id }),
      credentials: "include"
    })
      .then(res => res.json())
      .then(resp => {
        if (resp.error) {
          alert(resp.error);
        } else {
          cargarProductos();
        }
      });
  }

  // Limpiar modal al cerrar
const modalEl = document.getElementById('modalProducto');
if (modalEl) {
    modalEl.addEventListener('hidden.bs.modal', () => {
    const idField = document.getElementById('id_pan');
    document.getElementById('formProducto').reset();
    if (!idField.value) {
      idField.value = '';
    }
    document.getElementById('mensajeError').classList.add('d-none');
  });
}

async function obtenerHistorialAdminPorDia() {
    const fecha = document.getElementById("fechaUnica").value;

    if (!fecha) {
        return alert("Selecciona una fecha");
    }

    try {
        const res = await fetch(`/admin/historial-compras/dia?fecha=${fecha}`, {
            credentials: "include"
        });

        const data = await res.json();

        if (!res.ok) return alert(data.error);

        mostrarTablaHistorialAdmin(data.historial);
    } catch (err) {
        console.error(err);
        alert("Error en la solicitud");
    }
}

async function obtenerHistorialAdminPorRango() {
    const desde = document.getElementById("fechaDesde").value;
    const hasta = document.getElementById("fechaHasta").value;

    if (!desde || !hasta) {
        return alert("Selecciona ambas fechas");
    }

    try {
        const res = await fetch(`/admin/historial-compras/rango?desde=${desde}&hasta=${hasta}`, {
            credentials: "include"
        });

        const data = await res.json();

        if (!res.ok) return alert(data.error);

        mostrarTablaHistorialAdmin(data.historial);
    } catch (err) {
        console.error(err);
        alert("Error en la solicitud");
    }
}

function mostrarTablaHistorialAdmin(registros) {
    const tbody = document.querySelector("#tablaHistorialAdmin tbody");
    tbody.innerHTML = "";

    registros.forEach((r, i) => {
        tbody.innerHTML += `
            <tr>
                <td>${i + 1}</td>
                <td>${r.usuario}</td>
                <td>${r.producto}</td>
                <td>${r.cantidad}</td>
                <td>$${Number(r.precio).toFixed(2)}</td>
                <td>$${Number(r.subtotal).toFixed(2)}</td>
                <td>${r.fecha}</td>
            </tr>
        `;
    });
}
