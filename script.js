// ==========================================
// MOVE — FICHA DE INSCRIPCIÓN
// MOVE Dance Academy
// ==========================================

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";
const TAMANO_MAX_ARCHIVO = 8 * 1024 * 1024; // 8 MB

function el(id) {
  return document.getElementById(id);
}

function mostrarErrorInscripcion(msg) {
  el("mensajeErrorInscripcion").textContent = msg || "";
}

// ---------- fecha de cumpleaños (día / mes / año por separado) ----------
// Antes era un solo <input type="date">, pero en el teclado del celular
// ese picker obliga a deslizar año por año hasta encontrar el correcto,
// lo cual es muy lento. Con tres <select> (día, mes, año) se puede tocar
// el año directamente y elegirlo de la lista, sin deslizar.

(function poblarSelectAnio() {
  const select = el("selectAnioCumple");
  if (!select) return;
  const anioActual = new Date().getFullYear();
  for (let anio = anioActual; anio >= anioActual - 100; anio--) {
    const opcion = document.createElement("option");
    opcion.value = String(anio);
    opcion.textContent = String(anio);
    select.appendChild(opcion);
  }
})();

// Junta día + mes + año en "AAAA-MM-DD" (el formato que espera el Worker).
// Devuelve "" si falta elegir algo, o null si la combinación no es una
// fecha real (ej. 30 de febrero).
function leerCumpleanos() {
  const dia = el("selectDiaCumple").value;
  const mes = el("selectMesCumple").value;
  const anio = el("selectAnioCumple").value;
  if (!dia || !mes || !anio) return "";

  const fecha = new Date(Number(anio), Number(mes) - 1, Number(dia));
  const esValida =
    fecha.getFullYear() === Number(anio) &&
    fecha.getMonth() === Number(mes) - 1 &&
    fecha.getDate() === Number(dia);
  if (!esValida) return null;

  return `${anio}-${mes}-${dia}`;
}

function leerArchivoBase64(archivo) {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => {
      const resultado = lector.result || "";
      const partes = resultado.split(",");
      resolve(partes[1] || "");
    };
    lector.onerror = () => reject(new Error("No se pudo leer el archivo."));
    lector.readAsDataURL(archivo);
  });
}

// ---------- resaltar la opción elegida en los radios Sí/No ----------

function activarResaltadoRadios(grupoId) {
  const grupo = el(grupoId);
  const opciones = grupo.querySelectorAll(".radio-opcion");
  opciones.forEach((op) => {
    const input = op.querySelector("input");
    input.addEventListener("change", () => {
      opciones.forEach((o) => o.classList.remove("seleccionada"));
      if (input.checked) op.classList.add("seleccionada");
    });
  });
}

activarResaltadoRadios("grupoPoliticas");
activarResaltadoRadios("grupoShow");

// ---------- foto de la alumna ----------

let fotoSeleccionada = null;

el("inputFoto").addEventListener("change", (e) => {
  const archivo = e.target.files[0];
  mostrarErrorInscripcion("");

  if (!archivo) {
    fotoSeleccionada = null;
    el("nombreArchivoFoto").textContent = "";
    el("labelSubirFoto").classList.remove("tiene-foto");
    el("textoSubirFoto").textContent = "📷 Elegir foto";
    return;
  }

  if (archivo.size > TAMANO_MAX_ARCHIVO) {
    mostrarErrorInscripcion("La foto es muy grande (máximo 8 MB). Intenta con una foto más liviana.");
    e.target.value = "";
    return;
  }

  fotoSeleccionada = archivo;
  el("nombreArchivoFoto").textContent = archivo.name;
  el("labelSubirFoto").classList.add("tiene-foto");
  el("textoSubirFoto").textContent = "✅ Foto elegida";
});

// ---------- envío del formulario ----------

el("formInscripcion").addEventListener("submit", async (e) => {
  e.preventDefault();
  mostrarErrorInscripcion("");

  const alumna = el("inputAlumna").value.trim();
  const edad = el("inputEdad").value.trim();
  const cumpleanos = leerCumpleanos();
  const whatsapp = el("inputWhatsapp").value.trim();
  const correo = el("inputCorreo").value.trim();
  const nit = el("inputNit").value.trim();
  const nombrePadre = el("inputNombrePadre").value.trim();
  const contactoEmergencia = el("inputContactoEmergencia").value.trim();
  const numeroEmergencia = el("inputNumeroEmergencia").value.trim();
  const condicionMedica = el("inputCondicionMedica").value.trim();

  const politicas = document.querySelector('input[name="politicas"]:checked');
  const show = document.querySelector('input[name="show"]:checked');

  if (
    !alumna ||
    !edad ||
    !cumpleanos ||
    !whatsapp ||
    !nombrePadre ||
    !contactoEmergencia ||
    !numeroEmergencia
  ) {
    mostrarErrorInscripcion(
      cumpleanos === null
        ? "Esa fecha de cumpleaños no existe — revisa el día y el mes."
        : "Completa todos los campos obligatorios."
    );
    return;
  }

  if (!politicas) {
    mostrarErrorInscripcion("Debes indicar si aceptas las Políticas de Ingreso a la Academia.");
    return;
  }
  if (politicas.value !== "SI") {
    mostrarErrorInscripcion("Para inscribirte es necesario aceptar las Políticas de Ingreso a la Academia.");
    return;
  }
  if (!show) {
    mostrarErrorInscripcion("Debes indicar si autorizas la participación en el Show de Fin de Año.");
    return;
  }

  const btn = el("btnInscribir");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    const cuerpo = {
      accion: "crearInscripcion",
      alumna,
      edad,
      cumpleanos,
      whatsapp,
      correo,
      nit,
      nombrePadre,
      contactoEmergencia,
      numeroEmergencia,
      condicionMedica,
      aceptoPoliticas: politicas.value,
      aceptoShow: show.value,
    };

    if (fotoSeleccionada) {
      cuerpo.fotoBase64 = await leerArchivoBase64(fotoSeleccionada);
      cuerpo.fotoNombre = fotoSeleccionada.name;
      cuerpo.fotoTipo = fotoSeleccionada.type;
    }

    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(cuerpo),
    });
    const datos = await res.json();
    if (!datos.success) throw new Error(datos.error || "No se pudo enviar la inscripción.");

    el("formInscripcion").hidden = true;
    el("tarjetaExito").hidden = false;
  } catch (err) {
    mostrarErrorInscripcion(err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = textoOriginal;
  }
});

el("btnNuevaInscripcion").addEventListener("click", () => {
  el("formInscripcion").reset();
  el("formInscripcion").hidden = false;
  el("tarjetaExito").hidden = true;
  fotoSeleccionada = null;
  el("nombreArchivoFoto").textContent = "";
  el("labelSubirFoto").classList.remove("tiene-foto");
  el("textoSubirFoto").textContent = "📷 Elegir foto";
  document.querySelectorAll(".radio-opcion").forEach((o) => o.classList.remove("seleccionada"));
  mostrarErrorInscripcion("");
});
