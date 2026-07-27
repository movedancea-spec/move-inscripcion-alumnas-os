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
  const cumpleanos = el("inputCumpleanos").value;
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
    mostrarErrorInscripcion("Completa todos los campos obligatorios.");
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
