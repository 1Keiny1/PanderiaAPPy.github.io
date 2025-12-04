require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const multer = require("multer");
const upload = multer();
const numeroRegex = /\d/;
const app = express();
const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");
const Validar = require("./validacion");

app.use(express.static("public"));

const bodyParser = require("body-parser");
app.use(bodyParser.json({ limit: "10mb" }));
app.use(bodyParser.urlencoded({ extended: true, limit: "10mb" }));

// Conexión MySQL
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 4,
  queueLimit: 0
});

const con = pool.promise();

async function connectWithRetry(retries = 5, delay = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await con.query('SELECT 1');
      console.log("Conectado a MySQL");
      return;
    } catch (err) {
      console.log(`Intento ${i+1} fallido, reintentando en ${delay}ms...`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
  console.error("No se pudo conectar a MySQL después de varios intentos.");
  process.exit(1);
}

connectWithRetry();

// --- Sesiones ---
const session = require("express-session");
const MySQLStore = require("express-mysql-session")(session);

const sessionStore = new MySQLStore({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  clearExpired: true,
  checkExpirationInterval: 900000,
  expiration: 86400000,
}, pool);

app.set("trust proxy", 1);

app.use(session({
  key: "sid",
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "none" : "lax",
    secure: process.env.NODE_ENV === "production"
  }
}));


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
    req.nombreLimpio = nombre;
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

// Revisar si la sesión sigue activa
app.get("/checkSession", async (req, res) => {
    // No hay sesión en cookie
    if (!req.session.userId) {
        return res.json({ loggedIn: false });
    }

    try {
        // Verificar en DB por si el usuario cerró sesión desde otra parte
        const [rows] = await con.query(
            "SELECT id, nombre, id_rol, sesion_activa FROM usuarios WHERE id = ?",
            [req.session.userId]
        );

        if (rows.length === 0 || !rows[0].sesion_activa) {
            return res.json({ loggedIn: false });
        }

        // Sesión válida
        res.json({
            loggedIn: true,
            id: rows[0].id,
            nombre: rows[0].nombre,
            rol: rows[0].id_rol
        });

    } catch (err) {
        console.error("Error en checkSession:", err);
        res.status(500).json({ loggedIn: false });
    }
});


// Sesiones Iniciar Sesion
app.post("/login", async (req, res) => {
    const { correo, contrasena } = req.body;

        try {
        if (!correo || typeof correo !== "string")
            throw new Error("Correo inválido.");

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo))
            throw new Error("Formato de correo incorrecto.");

        if (!contrasena || typeof contrasena !== "string")
            throw new Error("Contraseña inválida.");
        
        if (contrasena.length < 3)
            throw new Error("Contraseña demasiado corta.");
    } catch (err) {
        return res.status(400).json({ error: err.message });
    }

    if (!correo || !contrasena) {
        return res.status(400).json({ error: "Correo y contraseña son obligatorios." });
    }

    try {
        // Intentar reconectar
        try {
            await con.query("SELECT 1");
        } catch (err) {
            console.log("DB caída o lenta, reintentando conexión...");
            await connectWithRetry(3, 2000);
        }

        // Buscar usuario
        const [usuarios] = await con.query({
            sql: "SELECT * FROM usuarios WHERE correo = ? AND contraseña = ?",
            timeout: 5000,
            values: [correo, contrasena]
        });

        if (usuarios.length === 0) {
            return res.status(401).json({ error: "Correo o contraseña incorrectos." });
        }

        const usuario = usuarios[0];

        if (usuario.sesion_activa && req.session.userId !== usuario.id) {
            return res.status(403).json({ error: "Ya tienes una sesión iniciada en otro dispositivo." });
        }

        // Guardar sesión
        req.session.userId = usuario.id;
        req.session.username = usuario.nombre;
        req.session.rol = usuario.id_rol;

        // Marcar en DB como sesión activa (solo si antes no lo estaba)
        await con.query({
            sql: "UPDATE usuarios SET sesion_activa = TRUE WHERE id = ?",
            timeout: 5000,
            values: [usuario.id]
        });

        res.json({
            mensaje: "Has iniciado sesión correctamente.",
            rol: usuario.id_rol
        });

    } catch (err) {
        console.error("Error en login:", err);
        res.status(500).json({ error: "Error en el servidor o retraso en la base de datos." });
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

    try {
        Validar.nombre(nombre);
    } catch (err) {
        return res.status(400).json({ error: err.message });
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

    // Crear cartera para usuarios que no tengan
    await con.query(`
        INSERT INTO cartera (id_usuario, dinero)
        SELECT u.id, 0
        FROM usuarios u
        LEFT JOIN cartera c ON c.id_usuario = u.id
        WHERE c.id_usuario IS NULL
    `);

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

    try {
        if (nombre) {
            nombre = removeTags(nombre).trim();
            Validar.nombre(nombre);
        } else {
            return res.status(400).json({ error: "El nombre es obligatorio." });
        }

        if (contrasena) {
            contrasena = contrasena.trim();
            const passRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*[\W_]).{8,}$/;
            if (!passRegex.test(contrasena)) {
                throw new Error("Contraseña inválida: mínimo 8 caracteres, 1 mayúscula, 1 minúscula y 1 carácter especial");
            }
        }
    } catch (error) {
        return res.status(400).json({ error: error.message });
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

// Inventario

// Crear producto
app.post("/agregarProducto", requireAuth, requireRole(1), upload.single("imagen"), async (req, res) => {
    try {
        let { nombre, descripcion, precio, cantidad, temporada } = req.body;
        const imagenBuffer = req.file ? req.file.buffer : null;

    try {
        nombre = removeTags(nombre).trim();
        descripcion = removeTags(descripcion).trim();

        Validar.nombre(nombre);
        Validar.descripcion(descripcion);
        Validar.precio(precio);
        Validar.cantidad(cantidad);
        Validar.maxNumber(precio, 999999999);
        Validar.maxNumber(cantidad, 999999);
        Validar.id(temporada);

    } catch (error) {
        return res.status(400).json({ error: error.message });
    }


        // Sanitizar entradas
        nombre = removeTags(nombre).trim();
        descripcion = removeTags(descripcion).trim();

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
        Validar.id(id_pan);
        Validar.id(temporada);
        const imagenBuffer = req.file ? req.file.buffer : null;

        nombre = removeTags(nombre);
        descripcion = removeTags(descripcion);

        if (!id_pan) {
            return res.status(400).json({ error: "El ID del producto es obligatorio." });
        }

        try {
            Validar.nombre(nombre);
            Validar.precio(precio);
            Validar.cantidad(cantidad);
            Validar.descripcion(descripcion);
        } catch (err) {
            return res.status(400).json({ error: err.message });
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
        Validar.id(id);
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
        Validar.id(id_pan);

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
        Validar.id(id_temporada);
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
              AND p.cantidad > 0
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
              AND p.cantidad > 0
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
app.post("/comprar",
  (req, res, next) => {
    console.log("=== DEBUG COMPRA ===");
    console.log("Session:", req.session);
    console.log("userId:", req.session?.userId);
    console.log("rol:", req.session?.rol);
    console.log("Carrito recibido:", req.body.carrito);
    console.log("==================");
    next();
  },
  requireAuth,
  requireRole(3),
  async (req, res) => {

    const { carrito } = req.body;

    if (!carrito || carrito.length === 0) {
      return res.status(400).json({ mensaje: "Carrito vacío" });
    }

    for (const p of carrito) {
        Validar.id(p.id_pan);
        Validar.cantidad(p.cantidad);
    }

    const connection = await con.getConnection();

    try {
      await connection.beginTransaction();

      // Calcular total de compra
      const total = carrito.reduce((acc, p) => acc + p.precio * p.cantidad, 0);

      // Obtener saldo de cartera
      const [carteraRows] = await connection.query(
        "SELECT dinero FROM cartera WHERE id_usuario = ? FOR UPDATE",
        [req.session.userId]
      );

      if (!carteraRows.length) {
        throw new Error("No se encontró la cartera del usuario.");
      }

      const saldoActual = parseFloat(carteraRows[0].dinero);

      // 3. Validar si alcanza
      if (saldoActual < total) {
        throw new Error(
          `Saldo insuficiente. Te faltan $${(total - saldoActual).toFixed(2)}`
        );
      }

      // 4. Verificar stock
      for (const p of carrito) {
        const [rows] = await connection.query(
          "SELECT cantidad, nombre FROM producto WHERE id_pan = ?",
          [p.id_pan]
        );

        if (!rows.length)
          throw new Error(`Producto ${p.nombre} no encontrado.`);

        if (rows[0].cantidad < p.cantidad)
          throw new Error(
            `Stock insuficiente de ${rows[0].nombre}. Disponible: ${rows[0].cantidad}`
          );
      }

      // Registrar venta
      const [ventaResult] = await connection.query(
        "INSERT INTO ventas (id_usuario, fecha, total) VALUES (?, NOW(), ?)",
        [req.session.userId, total]
      );

      const idVenta = ventaResult.insertId;
      Validar.id(idVenta);

      // Registrar cada detalle
      for (const p of carrito) {
        const subtotal = p.precio * p.cantidad;

        await connection.query(
          "INSERT INTO detalle_ventas (id_venta, id_pan, cantidad, subtotal, precio) VALUES (?, ?, ?, ?, ?)",
          [idVenta, p.id_pan, p.cantidad, subtotal, p.precio]
        );

        await connection.query(
          "UPDATE producto SET cantidad = cantidad - ? WHERE id_pan = ?",
          [p.cantidad, p.id_pan]
        );
      }

      // Descontar dinero de la cartera
      await connection.query(
        "UPDATE cartera SET dinero = dinero - ? WHERE id_usuario = ?",
        [total, req.session.userId]
      );

      await connection.commit();

      res.json({ mensaje: "Compra realizada con éxito", idVenta });

    } catch (error) {
      await connection.rollback();
      console.error("Error durante compra:", error.message);
      res.status(400).json({ mensaje: error.message });
    } finally {
      connection.release();
    }
  }
);


function formatearFecha(fechaISO) {
  const fecha = new Date(fechaISO);

  const año = fecha.getFullYear();
  const mes = String(fecha.getMonth() + 1).padStart(2, '0');
  const dia = String(fecha.getDate()).padStart(2, '0');

  const hora = String(fecha.getHours()).padStart(2, '0');
  const minutos = String(fecha.getMinutes()).padStart(2, '0');
  const segundos = String(fecha.getSeconds()).padStart(2, '0');

  return `${año}-${mes}-${dia} ${hora}:${minutos}:${segundos}`;
}

// Obtener historial de compras
app.get("/historial-compras", requireAuth, (req, res) => {
    console.log("Petición recibida: GET /historial-compras");

    const userId = req.session.userId; // <- CORRECTO

    const query = `
        SELECT 
            ventas.id_venta,
            DATE_FORMAT(ventas.fecha, '%Y-%m-%d %H:%i:%s') AS fecha,
            ventas.total AS total_venta,
            
            detalle_ventas.id_detalle,
            detalle_ventas.cantidad,
            detalle_ventas.precio,
            detalle_ventas.subtotal,
            
            producto.nombre AS nombre_pan

        FROM ventas
        INNER JOIN detalle_ventas ON ventas.id_venta = detalle_ventas.id_venta
        INNER JOIN producto ON detalle_ventas.id_pan = producto.id_pan
        WHERE ventas.id_usuario = ?
        ORDER BY ventas.fecha DESC
    `;

    pool.query(query, [userId], (err, results) => {
        if (err) {
            console.error("Error al obtener historial:", err);
            return res.status(500).json({ error: "Error al obtener historial" });
        }

        const historial = [];

        results.forEach(row => {
            let venta = historial.find(v => v.id_venta === row.id_venta);

            if (!venta) {
                venta = {
                    id_venta: row.id_venta,
                    fecha: formatearFecha(row.fecha),
                    total: row.total_venta,
                    detalles: []
                };
                historial.push(venta);
            }

            venta.detalles.push({
                id_detalle: row.id_detalle,
                nombre_pan: row.nombre_pan,
                cantidad: row.cantidad,
                precio: row.precio,
                subtotal: row.subtotal
            });
        });

        res.json(historial);
    });
});


// HISTORIAL PARA ADMINISTRADORES (FILTRADO POR FECHAS)
app.get("/admin/historial-compras/dia", (req, res) => {
    if (!req.session.rol || req.session.rol !== 1) {
        return res.status(403).json({ error: "Acceso denegado" });
    }

    const { fecha } = req.query;

    if (!fecha) {
        return res.status(400).json({ error: "Falta la fecha" });
    }

    const sql = `
        SELECT 
            v.id_venta,
            v.fecha,
            u.nombre AS usuario,
            p.nombre AS producto,
            dv.cantidad,
            dv.precio,
            dv.subtotal
        FROM ventas v
        INNER JOIN usuarios u ON v.id_usuario = u.id
        INNER JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
        INNER JOIN producto p ON dv.id_pan = p.id_pan
        WHERE DATE(v.fecha) = ?
        ORDER BY v.fecha DESC
    `;

    pool.query(sql, [fecha], (err, rows) => {
        if (err) {
            console.error("Error historial por día:", err);
            return res.status(500).json({ error: "Error interno" });
        }
        res.json({ historial: rows });
    });
});

app.get("/admin/historial-compras/rango", (req, res) => {
    if (!req.session.rol || req.session.rol !== 1) {
        return res.status(403).json({ error: "Acceso denegado" });
    }

    const { desde, hasta } = req.query;

    if (!desde || !hasta) {
        return res.status(400).json({ error: "Fechas incompletas" });
    }

    const sql = `
        SELECT 
            v.id_venta,
            v.fecha,
            u.nombre AS usuario,
            p.nombre AS producto,
            dv.cantidad,
            dv.precio,
            dv.subtotal
        FROM ventas v
        INNER JOIN usuarios u ON v.id_usuario = u.id
        INNER JOIN detalle_ventas dv ON v.id_venta = dv.id_venta
        INNER JOIN producto p ON dv.id_pan = p.id_pan
        WHERE DATE(v.fecha) BETWEEN ? AND ?
        ORDER BY v.fecha DESC
    `;

    pool.query(sql, [desde, hasta], (err, rows) => {
        if (err) {
            console.error("Error historial rango:", err);
            return res.status(500).json({ error: "Error interno" });
        }
        res.json({ historial: rows });
    });
});

// Obtener saldo
app.get("/api/cartera", async (req, res) => {
  const userId = req.session.userId; // O como almacenes sesión
  const [cartera] = await con.query("SELECT dinero FROM cartera WHERE id_usuario = ?", [userId]);
  res.json(cartera[0]);
});

// Agregar fondos
app.post("/api/cartera/agregar", async (req, res) => {
  try {
    const userId = req.session.userId;
    const { cantidad } = req.body;

    // Validaciones
    Validar.cantidad(cantidad);
    Validar.maxNumber(cantidad, 999999999999);

    const monto = Number(cantidad);

    if (monto <= 0)
      return res.json({ error: "La cantidad debe ser mayor a 0" });

    // Actualizar sin pasarse del máximo
    await con.query(`
      UPDATE cartera
      SET dinero = LEAST(dinero + ?, 999999999999)
      WHERE id_usuario = ?
    `, [monto, userId]);

    // Obtener valor actualizado
    const [cartera] = await con.query(
      "SELECT dinero FROM cartera WHERE id_usuario = ?",
      [userId]
    );

    return res.json(cartera[0]);

  } catch (err) {
    console.error(err);
    return res.json({ error: err.message });
  }
});


// Generar Ticket
app.get("/ticket/:idVenta", requireAuth, async (req, res) => {
    const idVenta = req.params.idVenta;
    Validar.id(idVenta);
    const userId = req.session.userId;

    try {
        // Obtener información de la venta
        const [ventaRows] = await con.query(`
            SELECT id_venta, fecha, total 
            FROM ventas
            WHERE id_venta = ? AND id_usuario = ?
        `, [idVenta, userId]);

        if (ventaRows.length === 0) {
            return res.status(404).json({ error: "Venta no encontrada" });
        }

        const venta = ventaRows[0];

        // Obtener detalles
        const [detalles] = await con.query(`
            SELECT dv.cantidad, dv.precio, dv.subtotal, p.nombre 
            FROM detalle_ventas dv
            JOIN producto p ON dv.id_pan = p.id_pan
            WHERE dv.id_venta = ?
        `, [idVenta]);

        // Crear PDF
        const doc = new PDFDocument();
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `attachment; filename=ticket_${idVenta}.pdf`);

        doc.pipe(res);

        // Encabezado
        doc.fontSize(20).text("PANADERÍA LA DESESPERANZA", { align: "center" });
        doc.moveDown();
        
        doc.fontSize(12).text(`Ticket de Compra #${idVenta}`);
        doc.text(`Fecha: ${venta.fecha}`);
        doc.text(`Cliente ID: ${userId}`);
        doc.moveDown();

        doc.text("Productos comprados:");
        doc.moveDown();

        // Productos
        detalles.forEach(item => {
            doc.text(
                `${item.nombre}  x${item.cantidad}  -  $${item.precio}  =  $${item.subtotal}`
            );
        });

        doc.moveDown();
        doc.fontSize(14).text(`TOTAL PAGADO: $${venta.total}`, { align: "right" });

        doc.end();

    } catch (err) {
        console.error("Error generando ticket:", err);
        res.status(500).json({ error: "Error generando ticket" });
    }
});

const port = process.env.PORT || 10000;
app.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});