// validacion.js

class Validar {

    // ---- NOMBRE ----
    static nombre(nombre) {
        if (!nombre || typeof nombre !== "string")
            throw new Error("El nombre es obligatorio.");

        if (nombre.trim().length === 0)
            throw new Error("El nombre no puede estar vacío.");

        if (nombre.length < 3 || nombre.length > 100)
            throw new Error("El nombre debe tener entre 3 y 100 caracteres.");
    }

    // ---- DESCRIPCIÓN ----
    static descripcion(descripcion) {
        if (!descripcion || descripcion.trim() === "")
            throw new Error("La descripción no puede estar vacía.");

        if (descripcion.length < 5)
            throw new Error("La descripción es demasiado corta.");

        if (descripcion.length > 500)
            throw new Error("La descripción es demasiado larga.");
    }

    // ---- PRECIO ----
    static precio(precio) {
        if (precio === undefined || precio === null)
            throw new Error("El precio es obligatorio.");

        if (isNaN(precio))
            throw new Error("El precio debe ser numérico.");

        precio = Number(precio);

        if (precio <= 0)
            throw new Error("El precio debe ser mayor a 0.");

        if (precio > 999999)
            throw new Error("Precio demasiado alto.");
    }

    // ---- CANTIDAD ----
    static cantidad(cantidad) {
        if (cantidad === undefined || cantidad === null)
            throw new Error("La cantidad es obligatoria.");

        if (isNaN(cantidad))
            throw new Error("La cantidad debe ser numérica.");

        cantidad = Number(cantidad);

        if (cantidad < 0)
            throw new Error("La cantidad no puede ser negativa.");

        if (cantidad > 100000)
            throw new Error("Cantidad demasiado grande.");
    }

    // ---- ID ----
    static id(valor) {
        if (!valor || isNaN(valor)) 
            throw new Error("ID inválido");
    }

    // ---- FONDOS ---- (NUEVO PARA CARTERA)
    static fondos(fondos) {
        if (fondos === undefined || fondos === null)
            throw new Error("Los fondos son obligatorios.");

        if (isNaN(fondos))
            throw new Error("Los fondos deben ser numéricos.");

        fondos = Number(fondos);

        if (fondos < 0)
            throw new Error("Los fondos no pueden ser negativos.");

        if (fondos > 999999999999)
            throw new Error("No puedes agregar más de 999999999999 pesos.");
    }
}

module.exports = Validar;