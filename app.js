require("dotenv").config(); // Al inicio del archivo
const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const upload = multer();
const numeroRegex = /\d/;
const app = express();

app.use(express.static("public"));

const bodyParser = require("body-parser");
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// --- Conexión MySQL usando .env ---
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

const con = pool.promise();

con.query('SELECT 1')
  .then(() => console.log("Conectado a MySQL"))
  .catch(err => {
    console.error("Error conectando a MySQL:", err);
    process.exit(1);
  });


// Remover Tags
function removeTags(html) {
    if (!html) return '';
    return html.replace(/<[^>]*>?/gm, '').replace(/<\?php.*?\?>/gs, '');
    }

function Sinnumeros(req, res, next) {
    const nombre = removeTags(req.body.nombre || req.body.nombre_b || req.body.nombre_ant || req.body.nombre_nuevo);
    if (!nombre || numeroRegex.test(nombre)) {
        return res.send(`
            <!DOCTYPE html>
            <html lang="es">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/css/bootstrap.min.css" rel="stylesheet">
                <title>Lista de Usuarios</title>
            </head>
            <body class="bg-light">
                <div class="container py-5">
                    <div class="row justify-content-center">
                        <div class="col-md-8">
                            <div class="card shadow-lg border-0 rounded-4">
                                <div class="card-body">
                                        <h1>Error</h1>
                                        <p>No se permiten números</p>
                                    <div class="text-center mt-3">
                                        <a class="btn btn-outline-secondary" href="/">Volver</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
                <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.2/dist/js/bootstrap.bundle.min.js"></script>
            </body>
            </html>
        `);
    }
    req.nombreLimpio = nombre; // lo guardamos para usarlo en la query
    next();
}

app.use((req, res, next) => {
  console.log(`Petición recibida: ${req.method} ${req.url}`);
  next();
});

function requireRole(rolPermitido) {
  return (req, res, next) => {
    if (!req.session.userId) return res.status(401).json({ error: "No autorizado" });
    if (req.session.rol !== rolPermitido) return res.status(403).json({ error: "Acceso denegado" });
    next();
  };
}

function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  res.status(401).json({ error: "No autorizado" });
}

// --- Sesiones ---
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const sessionStore = new MySQLStore({}, pool);

app.use(session({
  key: "sid",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 1000*60*60*24, httpOnly: true, sameSite: "lax" }
}));

// Sesiones Iniciar Sesion

app.post("/login", async (req, res) => {
    const { correo, contrasena } = req.body;

    try {
        // Validar usuario
        const [usuarios] = await con.query(
            "SELECT * FROM usuarios WHERE correo = ? AND contraseña = ?",
            [correo, contrasena]
        );

        if (usuarios.length === 0) {
            return res.status(401).json({ error: "Correo o contraseña incorrectos." });
        }

        const usuario = usuarios[0];

        if (usuario.sesion_activa) {
            return res.status(403).json({ error: "Ya tienes una sesión iniciada en otro dispositivo." });
        }

        // Marcar sesión activa
        await con.query("UPDATE usuarios SET sesion_activa = TRUE WHERE id = ?", [usuario.id]);

        // Guardar sesión
        req.session.userId = usuario.id;
        req.session.username = usuario.nombre;
        req.session.rol = usuario.id_rol;

        res.json({ mensaje: "Has iniciado sesión correctamente.", rol: usuario.id_rol });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error en el servidor." });
    }
});

// Sesiones Registrarse

app.post("/registrar", async (req, res) => {
    let { nombre, correo, contrasena, rol } = req.body;

    // Sanitizar entradas
    const removeTagsRegex = /<[^>]*>?/gm;
    nombre = nombre ? nombre.replace(removeTagsRegex, "").trim() : "";
    correo = correo ? correo.replace(removeTagsRegex, "").trim() : "";
    contrasena = contrasena ? contrasena.trim() : "";

    if (!nombre || !/^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/.test(nombre)) {
        return res.status(400).json({ error: "Nombre inválido: Solo letras y espacios" });
    }

    if (!correo || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
        return res.status(400).json({ error: "Correo inválido" });
    }

    const passRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,}$/;
    if (!contrasena || !passRegex.test(contrasena)) {
        return res.status(400).json({ error: "Contraseña inválida: Mínimo 8 caracteres, 1 mayúscula, 1 minúscula y 1 carácter especial" });
    }

    if (!rol || (rol != 1 && rol != 3)) {
        return res.status(400).json({ error: "Rol inválido" });
    }

    try {
        await con.query(
            "INSERT INTO usuarios (nombre, correo, contraseña, id_rol) VALUES (?, ?, ?, ?)",
            [nombre, correo, contrasena, rol]
        );
        res.json({ mensaje: "Usuario registrado correctamente" });
    } catch (err) {
        console.error(err);
        if (err.code === "ER_DUP_ENTRY") {
            return res.status(400).json({ error: "El correo ya está registrado" });
        }
        res.status(500).json({ error: "Error al registrar usuario" });
    }
});

// Sesiones Cerrar Sesion

app.post("/logout", async (req, res) => {
    if (req.session.userId) {
        try {
            // Marcar sesión inactiva
            await con.query("UPDATE usuarios SET sesion_activa = FALSE WHERE id = ?", [req.session.userId]);
        } catch (err) {
            console.error(err);
        }
    }
    req.session.destroy(err => {
        if (err) return res.status(500).json({ error: "Error al cerrar sesión" });
        res.clearCookie("sid");
        res.json({ mensaje: "Has cerrado sesión" });
    });
});

// Perfil de usuario

// Mostrar perfil

app.get("/perfil", requireAuth, async (req, res) => {
    try {
        const [result] = await con.query(
            "SELECT nombre, correo, id_rol, foto_perfil FROM usuarios WHERE id = ?",
            [req.session.userId]
        );

        if (result.length === 0) {
            return res.status(404).json({ error: "Usuario no encontrado." });
        }

        res.json(result[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al obtener perfil." });
    }
});

// Foto de perfil

app.get("/perfil/foto", requireAuth, async (req, res) => {
    try {
        const [result] = await con.query(
            "SELECT foto_perfil FROM usuarios WHERE id = ?",
            [req.session.userId]
        );

        if (result.length === 0 || !result[0].foto_perfil) {
            return res.sendFile(__dirname + "/public/img/Foto-perfil-defecto.jpg");
        }

        const foto = result[0].foto_perfil;
        res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Content-Length": foto.length
        });
        res.end(foto);
    } catch (err) {
        console.error(err);
        res.status(500).send("Error interno");
    }
});

// Editar perfil

app.post("/editar-perfil", requireAuth, upload.single("foto"), async (req, res) => {
    try {
        let { nombre, contrasena } = req.body;

        if (!nombre) return res.status(400).json({ error: "Nombre es obligatorio" });

        // Sanitizar nombre
        nombre = removeTags(nombre).trim();
        if (!/^[A-Za-zÁÉÍÓÚáéíóúÑñ\s]+$/.test(nombre)) {
            return res.status(400).json({ error: "Nombre inválido: solo letras y espacios" });
        }

        let query = "UPDATE usuarios SET nombre = ?";
        const params = [nombre];

        if (contrasena) {
            contrasena = contrasena.trim();
            const passRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,}$/;
            if (!passRegex.test(contrasena)) {
                return res.status(400).json({ error: "Contraseña inválida: mínimo 8 caracteres, 1 mayúscula, 1 minúscula y 1 carácter especial" });
            }
            query += ", contraseña = ?";
            params.push(contrasena);
        }

        if (req.file) {
            query += ", foto_perfil = ?";
            params.push(req.file.buffer);
        }

        query += " WHERE id = ?";
        params.push(req.session.userId);

        const [result] = await con.query(query, params);
        res.json({ mensaje: "Perfil actualizado correctamente" });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Error al actualizar perfil" });
    }
});

// Inventario -Administrador-

// Crear producto
app.post("/agregarProducto", requireAuth, requireRole(1), upload.single("imagen"), async (req, res) => {
    try {
        let { nombre, descripcion, precio, cantidad, temporada } = req.body;
        const imagenBuffer = req.file ? req.file.buffer : null;

        // Sanitizar entradas
        nombre = removeTags(nombre).trim();
        descripcion = removeTags(descripcion).trim();

        if (!nombre || !precio || !cantidad) {
            return res.status(400).json({ error: "Nombre, precio y cantidad son obligatorios." });
        }
        if (isNaN(precio) || precio <= 0 || isNaN(cantidad) || cantidad < 0) {
            return res.status(400).json({ error: "Precio y cantidad deben ser valores válidos." });
        }
        if (!temporada || isNaN(temporada)) {
            return res.status(400).json({ error: "Temporada inválida o no seleccionada." });
        }

        // Insertar producto
        const sql = `
            INSERT INTO producto (imagen, nombre, precio, cantidad, descripcion, id_temporada)
            VALUES (?, ?, ?, ?, ?, ?)
        `;
        const params = [imagenBuffer, nombre, precio, cantidad, descripcion, temporada];

        const [result] = await con.query(sql, params);

        res.json({ mensaje: "Producto agregado correctamente.", id: result.insertId });
    } catch (err) {
        console.error("Error al agregar producto:", err);
        res.status(500).json({ error: "Error al agregar producto." });
    }
});

//fun consultar


// Leer productos
app.get("/obtenerProducto", async (req, res) => {
    const sql = `
      SELECT p.*, t.nom_temporada
      FROM producto p
      LEFT JOIN temporada t ON p.id_temporada = t.id_temporada
    `;
    try {
        const [rows] = await con.query(sql);
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener productos:", err);
        res.status(500).json({ error: "Error al obtener productos." });
    }
});

// Actualizar producto
app.post("/actualizarProducto", requireAuth, requireRole(1), upload.single("imagen"), async (req, res) => {
    try {
        let { id_pan, nombre, descripcion, precio, cantidad, temporada } = req.body;
        const imagenBuffer = req.file ? req.file.buffer : null;

        nombre = removeTags(nombre);
        descripcion = removeTags(descripcion);

        if (!id_pan || !nombre || !precio || !cantidad) {
            return res.status(400).json({ error: "ID, nombre, precio y cantidad son obligatorios." });
        }
        if (isNaN(precio) || precio <= 0 || isNaN(cantidad) || cantidad < 0) {
            return res.status(400).json({ error: "Precio y cantidad deben ser valores válidos." });
        }

        let sql, params;
        if (imagenBuffer) {
            sql = "UPDATE producto SET nombre=?, descripcion=?, precio=?, cantidad=?, imagen=?, id_temporada=? WHERE id_pan=?";
            params = [nombre, descripcion, precio, cantidad, imagenBuffer, temporada, id_pan];
        } else {
            sql = "UPDATE producto SET nombre=?, descripcion=?, precio=?, cantidad=?, id_temporada=? WHERE id_pan=?";
            params = [nombre, descripcion, precio, cantidad, temporada, id_pan];
        }

        const [result] = await con.query(sql, params);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        res.json({ mensaje: "Producto actualizado correctamente." });
    } catch (err) {
        console.error("Error al actualizar producto:", err);
        res.status(500).json({ error: "Error al actualizar producto." });
    }
});

// Endpoint para servir la imagen desde la base de datos
app.get("/imagen/:id", async (req, res) => {
    try {
        const id = req.params.id;
        const [resultado] = await con.query("SELECT imagen FROM producto WHERE id_pan = ?", [id]);

        if (resultado.length === 0 || !resultado[0].imagen) {
            return res.status(404).send("No encontrada");
        }

        res.writeHead(200, {
            "Content-Type": "image/jpeg",
            "Content-Length": resultado[0].imagen.length
        });
        res.end(resultado[0].imagen);
    } catch (err) {
        console.error("Error al obtener imagen:", err);
        res.status(500).send("Error interno");
    }
});

// Eliminar producto
app.post("/borrarProducto", requireAuth, requireRole(1), async (req, res) => {
    try {
        const { id_pan } = req.body;

        if (!id_pan) {
            return res.status(400).json({ error: "ID de producto es obligatorio." });
        }

        const [result] = await con.query("DELETE FROM producto WHERE id_pan=?", [id_pan]);

        if (result.affectedRows === 0) {
            return res.status(404).json({ error: "Producto no encontrado." });
        }

        res.json({ mensaje: "Producto borrado correctamente." });
    } catch (err) {
        console.error("Error al borrar producto:", err);
        res.status(500).json({ error: "Error al borrar producto." });
    }
});

// Cambiar temporada activa
app.post("/temporada/activar", requireRole(1), async (req, res) => {
    try {
        const { id_temporada } = req.body;
        if (!id_temporada) return res.status(400).json({ error: "ID de temporada requerido" });

        // Desactivar todas
        await con.query("UPDATE temporada SET activo = FALSE");

        // Activar la seleccionada
        await con.query("UPDATE temporada SET activo = TRUE WHERE id_temporada = ?", [id_temporada]);

        res.json({ mensaje: "Temporada activada correctamente" });
    } catch (err) {
        console.error("Error al activar temporada:", err);
        res.status(500).json({ error: "Error al activar temporada" });
    }
});
// Desactivar todas las temporadas
app.post("/temporada/desactivar", requireRole(1), async (req, res) => {
    try {
        await con.query("UPDATE temporada SET activo = FALSE");
        res.json({ mensaje: "Todas las temporadas desactivadas correctamente" });
    } catch (err) {
        console.error("Error al desactivar temporadas:", err);
        res.status(500).json({ error: "Error al desactivar temporadas" });
    }
});

// Acciones -Cliente-

// Mostrar productos por temporada
// Productos de temporada activa
app.get("/productos-temporada-activa", async (req, res) => {
    try {
        const sql = `
            SELECT p.id_pan, p.nombre, p.descripcion, p.precio,
                   TO_BASE64(p.imagen) AS imagen,
                   p.cantidad,
                   t.nom_temporada
            FROM producto p
            LEFT JOIN temporada t ON p.id_temporada = t.id_temporada
            WHERE t.activo = TRUE
        `;
        const [result] = await con.query(sql);
        res.json(result);
    } catch (err) {
        console.error("Error al obtener productos de temporada activa:", err);
        res.status(500).json({ error: "Error al obtener productos de temporada" });
    }
});

// Productos todo el año
app.get("/productos-todo-el-anio", async (req, res) => {
    try {
        const sql = `
            SELECT p.id_pan, p.nombre, p.descripcion, p.precio,
                   TO_BASE64(p.imagen) AS imagen,
                   p.cantidad
            FROM producto p
            WHERE p.id_temporada = 1
        `;
        const [result] = await con.query(sql);
        res.json(result);
    } catch (err) {
        console.error("Error al obtener productos todo el año:", err);
        res.status(500).json({ error: "Error al obtener productos todo el año" });
    }
});

// Obtener la temporada activa
app.get("/temporada/activa", async (req, res) => {
    try {
        const [result] = await con.query("SELECT * FROM temporada WHERE activo = TRUE LIMIT 1");
        if (result.length === 0) return res.status(404).json({ error: "No hay temporada activa" });
        res.json(result[0]);
    } catch (err) {
        console.error("Error al obtener temporada activa:", err);
        res.status(500).json({ error: "Error al obtener temporada activa" });
    }
});

// Obtener todas las temporadas

app.get("/obtenerTemporadas", async (req, res) => {
    try {
        const [rows] = await con.query("SELECT * FROM temporada");
        res.json(rows);
    } catch (err) {
        console.error("Error al obtener temporadas:", err);
        res.status(500).json({ error: "Error al obtener temporadas" });
    }
});

  // Procesar compra del carrito

// Procesar compra del carrito
app.post("/comprar", requireAuth, requireRole(3), async (req, res) => {
  const { carrito } = req.body;

  if (!carrito || carrito.length === 0) {
    return res.status(400).json({ mensaje: "Carrito vacío" });
  }

  try {
    // Iniciar transacción
    await con.beginTransaction();

    // Verificar stock
    for (const p of carrito) {
      const [rows] = await con.query(
        "SELECT cantidad, nombre FROM producto WHERE id_pan = ?",
        [p.id_pan]
      );

      if (rows.length === 0) throw new Error(`Producto ${p.nombre} no encontrado.`);
      if (rows[0].cantidad < p.cantidad)
        throw new Error(`No hay suficiente inventario de ${rows[0].nombre}. Disponible: ${rows[0].cantidad}`);
    }

    // Insertar venta
    const total = carrito.reduce((acc, p) => acc + p.precio * p.cantidad, 0);
    const [ventaResult] = await con.query(
      "INSERT INTO ventas (id_usuario, fecha, total) VALUES (?, NOW(), ?)",
      [req.session.userId, total]
    );
    const idVenta = ventaResult.insertId;

    // Insertar detalle y actualizar inventario
    for (const p of carrito) {
      const subtotal = p.precio * p.cantidad;

      await con.query(
        "INSERT INTO detalle_ventas (id_venta, id_pan, cantidad, subtotal, precio) VALUES (?, ?, ?, ?, ?)",
        [idVenta, p.id_pan, p.cantidad, subtotal, p.precio]
      );

      await con.query(
        "UPDATE producto SET cantidad = cantidad - ? WHERE id_pan = ?",
        [p.cantidad, p.id_pan]
      );
    }

    await con.commit();
    res.json({ mensaje: "Compra realizada con éxito", idVenta });

  } catch (error) {
    await con.rollback();
    console.error("Error durante compra:", error.message);
    res.status(400).json({ mensaje: error.message });
  }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});