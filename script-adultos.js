// ==========================================
// MOVE — FICHA DE INSCRIPCIÓN (ADULTOS)
// MOVE Dance Academy
// ==========================================

const WORKER_URL = "https://portalalumnas.movedancea.workers.dev";

function el(id) {
  return document.getElementById(id);
}

function mostrarErrorInscripcion(msg) {
  el("mensajeErrorInscripcion").textContent = msg || "";
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
  const contactoEmergencia = el("inputContactoEmergencia").value.trim();
  const numeroEmergencia = el("inputNumeroEmergencia").value.trim();
  const condicionMedica = el("inputCondicionMedica").value.trim();

  const politicas = document.querySelector('input[name="politicas"]:checked');

  if (
    !alumna ||
    !edad ||
    !cumpleanos ||
    !whatsapp ||
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

  const btn = el("btnInscribir");
  btn.disabled = true;
  const textoOriginal = btn.textContent;
  btn.textContent = "Enviando...";

  try {
    const res = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        accion: "crearInscripcion",
        alumna,
        edad,
        cumpleanos,
        whatsapp,
        correo,
        nit,
        contactoEmergencia,
        numeroEmergencia,
        condicionMedica,
        aceptoPoliticas: politicas.value,
      }),
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
  document.querySelectorAll(".radio-opcion").forEach((o) => o.classList.remove("seleccionada"));
  mostrarErrorInscripcion("");
});
