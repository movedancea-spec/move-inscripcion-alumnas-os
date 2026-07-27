// ==========================================
// MOVE PORTAL DE ALUMNAS - Cloudflare Worker
// MOVE Dance Academy
// ==========================================
// Este Worker es el único lugar donde vive la clave secreta de
// Airtable (AIRTABLE_TOKEN), configurada como "Secret" en
// Cloudflare, nunca en este código ni en la página pública.
//
// IMPORTANTE: lo que se muestra en el perfil de cada alumna (qué
// campos, con qué etiqueta, en qué orden) se controla 100% desde
// la tabla "CONFIGURACION PORTAL ALUMNAS" en Airtable. Para
// agregar, quitar, renombrar o reordenar un dato del perfil, edita
// esa tabla — no hace falta tocar este código.

const BASE_ID = "appPEfqYLEyfLcRJE";

const TABLES = {
  ALUMNAS: "tblenK3YMJxbxBXUM",
  CONFIGURACION: "tblewQNjHZApBa1Y6",
  PAGOS: "tblwuYhyCfgTjCaI1",
  PAGOS_ESPECIALES: "tbllo2fReK9emizXS",
  EVALUACIONES_MOVE: "tblq7WhJmXMgFUUrC",
  CHAT: "tbl2SMCaMFvqu3nDs",
  MAESTRAS: "tblfh3eL5l1DUkny0",
  GRUPOS: "tbl5AoLEq4bQHUirT",
  HORARIOS: "tblEef0P3BWP1oGXP",
  PRUEBAS: "tblXRQvBCTNKgTtHA",
};

// Las 17 calificaciones de EVALUACIONES MOVE, agrupadas en las mismas
// 3 categorías que usa la app de evaluaciones de las maestras (mismos
// títulos y mismo orden), para que el perfil de la alumna se vea
// exactamente igual de organizado.
const GRUPOS_EVALUACION = [
  {
    titulo: "💪 Técnica Corporal",
    items: [
      { label: "Técnica", campo: "TECNICA" },
      { label: "Postura", campo: "POSTURA" },
      { label: "Brazos", campo: "BRAZOS" },
      { label: "Piernas", campo: "PIERNAS" },
      { label: "Control y Limpieza", campo: "CONTROL Y LIMPIEZA" },
      { label: "Precisión de Ejercicios", campo: "PRECISION DE EJERCICIOS" },
      { label: "Anatomía del Cuerpo", campo: "ANATOMIA DEL CUERPO" },
    ],
  },
  {
    titulo: "🎭 Artístico",
    items: [
      { label: "Musicalidad", campo: "MUSICALIDAD" },
      { label: "Proyección Escénica", campo: "PROYECCIÓN ESCÉNICA" },
      { label: "Coordinación", campo: "COORDINACION" },
      { label: "Uso del Espacio", campo: "USO DEL ESPACIO / CONCIENCIA ESPACIAL" },
      { label: "Memoria Coreográfica", campo: "MEMORIA COREOGRAFICA / EJERCICIOS" },
    ],
  },
  {
    titulo: "⭐ Actitud y Disciplina",
    items: [
      { label: "Esfuerzo y Progreso", campo: "ESFUERZO Y PROGRESO" },
      { label: "Atención y Enfoque", campo: "ATENCIÓN Y ENFOQUE" },
      { label: "Actitud", campo: "ACTITUD" },
      { label: "Asistencia", campo: "ASISTENCIA" },
      { label: "Puntualidad", campo: "PUNTUALIDAD" },
    ],
  },
];

const CAMPOS_COMENTARIOS_EVALUACION = [
  { label: "Fortalezas", campo: "FORTALEZAS" },
  { label: "Aspectos a mejorar", campo: "ASPECTOS A MEJORAR" },
  { label: "Objetivo siguiente periodo", campo: "OBJETIVO SIGUIENTE PERIODO" },
  { label: "Observaciones", campo: "OBSERVACIONES" },
];

// ID del campo "SUBIR COMPROBANTE DE PAGO" en PAGOS (se usa por ID,
// no por nombre, porque la API de adjuntos de Airtable va en la URL).
const CAMPO_COMPROBANTE_ID = "fldAjorZNL6VyQ6OG";

// ID del campo "FOTO ALUMNA" en ALUMNAS (mismo motivo: se usa por ID
// para poder subir el archivo con la API de adjuntos de Airtable).
const CAMPO_FOTO_ALUMNA_ID = "fldoRv81hkFaiJRSz";

// Nombre del mes actual en español, para comparar contra el campo
// MES (multipleSelects) de PAGOS.
const MESES_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function qs(params) {
  return Object.entries(params)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

async function airtableFetch(env, path, options = {}) {
  const res = await fetch(`https://api.airtable.com/v0/${BASE_ID}/${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || `Airtable error (${res.status})`);
  }
  return data;
}

async function listAll(env, tableId, params = "") {
  let records = [];
  let offset;
  do {
    const sep = params ? "&" : "?";
    const url = `${tableId}${params}${offset ? `${sep}offset=${offset}` : ""}`;
    const data = await airtableFetch(env, url);
    records = records.concat(data.records || []);
    offset = data.offset;
  } while (offset);
  return records;
}

// Para el chat: solo mostramos/contamos mensajes del mes en curso
// (los meses anteriores no se borran de Airtable, solo se ocultan
// del chat para que no se vaya llenando de mensajes viejos).
function esDelMesActual(fechaIso) {
  const ahora = new Date();
  const f = new Date(fechaIso);
  return f.getUTCFullYear() === ahora.getUTCFullYear() && f.getUTCMonth() === ahora.getUTCMonth();
}

// -------------------------------------
// ACCIÓN: alumnas
// Lista de alumnas activas para la pantalla de "busca tu nombre".
// Solo devolvemos el nombre: nada sensible hasta que entren con
// su clave.
// -------------------------------------
async function getAlumnas(env) {
  const alumnas = await listAll(
    env,
    TABLES.ALUMNAS,
    `?${qs({ filterByFormula: '{ESTADO}="ACTIVA"' })}&fields%5B%5D=ALUMNA%2FO`
  );
  return {
    success: true,
    alumnas: alumnas.map((r) => ({
      id: r.id,
      nombre: r.fields["ALUMNA/O"] || "(Sin nombre)",
    })),
  };
}

// -------------------------------------
// Convierte el valor crudo de un campo de Airtable (texto, número,
// selección, adjunto, etc.) en algo listo para mostrar en la
// página: { tipo: "imagen"|"texto", valor }.
// -------------------------------------
function formatearCampo(valorCrudo) {
  if (valorCrudo === undefined || valorCrudo === null || valorCrudo === "") {
    return { tipo: "texto", valor: "" };
  }
  if (Array.isArray(valorCrudo)) {
    if (valorCrudo.length && valorCrudo[0] && typeof valorCrudo[0] === "object" && valorCrudo[0].url) {
      // multipleAttachments: usamos el primer archivo
      return { tipo: "imagen", valor: valorCrudo[0].url };
    }
    const textos = valorCrudo.map((v) => (v && typeof v === "object" && v.name ? v.name : v));
    return { tipo: "texto", valor: textos.join(", ") };
  }
  if (typeof valorCrudo === "object") {
    if (valorCrudo.url) return { tipo: "imagen", valor: valorCrudo.url };
    if (valorCrudo.name) return { tipo: "texto", valor: valorCrudo.name };
    return { tipo: "texto", valor: JSON.stringify(valorCrudo) };
  }
  return { tipo: "texto", valor: String(valorCrudo) };
}

// -------------------------------------
// Busca el registro de PAGOS del mes en curso para esta alumna
// (comparando por nombre, porque ARRAYJOIN() de un campo de
// registros enlazados da el nombre del registro, no su recordId —
// mismo detalle que en el Worker de reportes de prueba).
// -------------------------------------
async function obtenerPagoDelMes(env, alumnaNombre) {
  if (!alumnaNombre) return null;
  const nombreEscapado = alumnaNombre.replace(/"/g, '\\"');
  const mesActual = MESES_ES[new Date().getUTCMonth()];
  const anioActual = new Date().getUTCFullYear();

  const formula =
    `AND(` +
    `FIND("${nombreEscapado}", ARRAYJOIN({ALUMNA})), ` +
    `FIND("${mesActual}", ARRAYJOIN({MES})), ` +
    `{AÑO}="${anioActual}"` +
    `)`;

  const data = await airtableFetch(
    env,
    `${TABLES.PAGOS}?${qs({ filterByFormula: formula, maxRecords: 1 })}`
  );
  const rec = data.records && data.records[0];
  if (!rec) return null;
  return construirPago(rec);
}

function construirPago(rec) {
  const f = rec.fields || {};
  const estadoRaw = f["ESTADO"];
  const estado = estadoRaw && typeof estadoRaw === "object" ? estadoRaw.name : estadoRaw || "";
  let monto = f["MENSUALIDAD"];
  if (Array.isArray(monto)) monto = monto[0];
  const comprobantes = f["SUBIR COMPROBANTE DE PAGO"];
  return {
    pagoId: rec.id,
    estado,
    monto: monto ?? null,
    linkPago: f["LINK_PAGO"] || "",
    tieneComprobante: Array.isArray(comprobantes) && comprobantes.length > 0,
  };
}

// -------------------------------------
// Trae los "PAGOS ESPECIALES" (trajes, competencias, etc.) que están
// enlazados a la alumna, leyendo directamente TIPO / MONTO TOTAL /
// MONTO PAGADO / SALDO / ESTADO de cada registro — así evitamos
// mostrar el texto largo y feo del campo "primary" (que es una
// fórmula concatenada) y en vez de eso armamos una tarjeta ordenada
// por cada pago especial.
// -------------------------------------
function construirPagoEspecial(rec) {
  const f = rec.fields || {};
  const tipoRaw = f["TIPO"];
  const tipo = tipoRaw && typeof tipoRaw === "object" ? tipoRaw.name : tipoRaw || "";
  const estadoRaw = f["ESTADO"];
  const estado = estadoRaw && typeof estadoRaw === "object" ? estadoRaw.name : estadoRaw || "";
  return {
    id: rec.id,
    tipo,
    montoTotal: f["MONTO TOTAL"] ?? null,
    montoPagado: f["MONTO PAGADO"] ?? null,
    saldo: f["SALDO"] ?? null,
    estado,
    fechaLimite: f["FECHA LIMITE"] || "",
  };
}

async function obtenerPagosEspeciales(env, ids) {
  if (!ids || !ids.length) return [];
  const formula = "OR(" + ids.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const records = await listAll(
    env,
    TABLES.PAGOS_ESPECIALES,
    `?${qs({ filterByFormula: formula })}`
  );
  const porId = {};
  records.forEach((r) => {
    porId[r.id] = r;
  });
  // Conservamos el mismo orden en que están enlazados en ALUMNAS.
  return ids.filter((id) => porId[id]).map((id) => construirPagoEspecial(porId[id]));
}

// -------------------------------------
// Trae las evaluaciones (tabla EVALUACIONES MOVE) enlazadas a la
// alumna y las arma agrupadas en las mismas 3 categorías que usa la
// app de evaluaciones de las maestras, listas para mostrarse en
// tarjetas bonitas en el portal.
// -------------------------------------
function construirEvaluacion(rec, nombreAlumna) {
  const f = rec.fields || {};
  const idRaw = (f["ID"] || "").toString();

  // El ID se guarda como "ALUMNA - CLASE - PERIODO"; le quitamos el
  // nombre de la alumna (ya lo sabemos) para que el título quede
  // limpio, algo como "CONTEMPO - Periodo 2".
  let titulo = idRaw;
  if (nombreAlumna && idRaw.startsWith(nombreAlumna)) {
    titulo = idRaw.slice(nombreAlumna.length).replace(/^\s*-\s*/, "");
  }

  const tipoRaw = f["TIPO"];
  const tipo = tipoRaw && typeof tipoRaw === "object" ? tipoRaw.name : tipoRaw || "";

  const grupos = GRUPOS_EVALUACION.map((g) => ({
    titulo: g.titulo,
    items: g.items
      .map((it) => ({ label: it.label, valor: f[it.campo] }))
      .filter((it) => it.valor !== undefined && it.valor !== null && it.valor !== ""),
  })).filter((g) => g.items.length);

  const comentarios = CAMPOS_COMENTARIOS_EVALUACION.map((c) => ({
    label: c.label,
    valor: f[c.campo] || "",
  })).filter((c) => c.valor);

  return {
    id: rec.id,
    titulo: titulo || "Evaluación",
    anio: f["AÑO"] || "",
    tipo,
    // NOTA FINAL a propósito NO se envía al portal: los papás no deben
    // ver la nota en porcentaje, solo las estrellitas por área (grupos).
    grupos,
    comentarios,
  };
}

async function getEvaluaciones(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const nombreAlumna = f["ALUMNA/O"] || "";

  const idsEval = f["EVALUACIONES MOVE"] || [];
  if (!idsEval.length) {
    return json({ success: true, evaluaciones: [] });
  }

  const formula = "OR(" + idsEval.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const records = await listAll(
    env,
    TABLES.EVALUACIONES_MOVE,
    `?${qs({ filterByFormula: formula })}`
  );

  // Solo mostramos las evaluaciones del año en curso — el próximo año
  // arranca vacío otra vez (mismo criterio que ya usamos para el
  // historial de mensualidades).
  const anioActual = new Date().getUTCFullYear();
  const evaluaciones = records
    .filter((r) => Number(r.fields["AÑO"]) === anioActual)
    .map((r) => construirEvaluacion(r, nombreAlumna))
    .sort((a, b) => (b.anio || 0) - (a.anio || 0));

  return json({ success: true, evaluaciones });
}

// -------------------------------------
// ACCIÓN: generarLink
// Marca GENERAR_LINK en el registro de pago (esto dispara la
// automatización de Airtable que ya tienen conectada a Paggo) y
// espera unos segundos a que el link aparezca en LINK_PAGO. Si el
// pago ya está PAGADO, o ya existe un link generado, no vuelve a
// generar uno nuevo.
// -------------------------------------
async function generarLink(env, pagoId) {
  if (!pagoId) {
    return json({ success: false, error: "Falta el pago." }, 400);
  }

  let record = await airtableFetch(env, `${TABLES.PAGOS}/${pagoId}`);
  let pago = construirPago(record);

  if (pago.estado === "PAGADO") {
    return json({ success: true, pago });
  }
  if (pago.linkPago) {
    return json({ success: true, pago });
  }

  await airtableFetch(env, TABLES.PAGOS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: pagoId, fields: { GENERAR_LINK: true } }],
      typecast: true,
    }),
  });

  // La automatización de Airtable/Paggo corre en segundo plano;
  // esperamos un poco y revisamos varias veces si ya llegó el link.
  for (let intento = 0; intento < 6; intento++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    record = await airtableFetch(env, `${TABLES.PAGOS}/${pagoId}`);
    pago = construirPago(record);
    if (pago.linkPago) {
      return json({ success: true, pago });
    }
  }

  return json(
    {
      success: false,
      error: "El link de pago se está generando. Espera unos segundos y vuelve a intentar.",
    },
    202
  );
}

// -------------------------------------
// ACCIÓN: subirComprobante
// Sube un archivo (foto o PDF del comprobante) directamente al
// campo de adjuntos SUBIR COMPROBANTE DE PAGO del registro de pago,
// usando la API de adjuntos de Airtable (content.airtable.com).
// -------------------------------------
async function subirComprobante(env, pagoId, archivoBase64, nombreArchivo, tipoArchivo) {
  if (!pagoId || !archivoBase64) {
    return json({ success: false, error: "Falta el archivo." }, 400);
  }

  const res = await fetch(
    `https://content.airtable.com/v0/${BASE_ID}/${pagoId}/${CAMPO_COMPROBANTE_ID}/uploadAttachment`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        contentType: tipoArchivo || "application/octet-stream",
        filename: nombreArchivo || "comprobante",
        file: archivoBase64,
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data?.error?.message || data?.error || `Error subiendo el archivo (${res.status})`);
  }

  return json({ success: true });
}

// -------------------------------------
// Envía un mensaje de WhatsApp por Green API (mismas credenciales que
// usa el Worker de reportes de clase de prueba: GREEN_INSTANCE_ID y
// GREEN_API_TOKEN deben estar configuradas como Secret en este Worker
// también).
// -------------------------------------
async function enviarWhatsapp(env, telefonoLimpio, mensaje) {
  // Si a este Worker todavía no le has configurado los Secrets de
  // Green API, la URL queda mal formada (algo como
  // ".../waInstanceundefined/sendMessage/undefined") y el servidor
  // responde con una página de error en HTML en vez de JSON — sin
  // este chequeo, eso se veía como el críptico error "Unexpected
  // token '<' ... is not valid JSON". Con esto avisamos claro qué
  // falta configurar.
  if (!env.GREEN_INSTANCE_ID || !env.GREEN_API_TOKEN) {
    throw new Error(
      "Este Worker todavía no tiene configuradas las claves de WhatsApp (GREEN_INSTANCE_ID y GREEN_API_TOKEN) en Cloudflare. Agrégalas como Secret y vuelve a intentar."
    );
  }

  let numeroFinal = telefonoLimpio;
  if (!numeroFinal.startsWith("502")) numeroFinal = "502" + numeroFinal;

  const resp = await fetch(
    `https://api.green-api.com/waInstance${env.GREEN_INSTANCE_ID}/sendMessage/${env.GREEN_API_TOKEN}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatId: `${numeroFinal}@c.us`, message: mensaje }),
    }
  );

  const textoResp = await resp.text();
  let data;
  try {
    data = JSON.parse(textoResp);
  } catch (e) {
    throw new Error(
      `Green API no respondió con datos válidos (código ${resp.status}). Revisa que GREEN_INSTANCE_ID y GREEN_API_TOKEN estén bien puestos en este Worker.`
    );
  }

  if (!resp.ok || !data?.idMessage) {
    throw new Error(data?.reason || data?.message || `Green API error (${resp.status})`);
  }
}

// -------------------------------------
// Manda un correo con Resend (resend.com). RESEND_API_KEY debe estar
// configurada como Secret en este Worker (igual que GREEN_INSTANCE_ID
// y GREEN_API_TOKEN para WhatsApp). El remitente (EMAIL_REMITENTE)
// debe ser una dirección del dominio ya verificado en Resend.
// -------------------------------------
async function enviarCorreo(env, destinatario, asunto, html) {
  if (!env.RESEND_API_KEY) {
    throw new Error(
      "Este Worker todavía no tiene configurada la clave de correo (RESEND_API_KEY) en Cloudflare. Agrégala como Secret y vuelve a intentar."
    );
  }

  const remitente = env.EMAIL_REMITENTE || "MOVE Dance Academy <clave@academiamovedance.com>";

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: remitente,
      to: [destinatario],
      subject: asunto,
      html,
    }),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new Error(data?.message || `Resend no respondió correctamente (código ${resp.status}).`);
  }
  return data;
}

// -------------------------------------
// ACCIÓN: recuperarClave
// Le reenvía a la alumna/mamá su clave actual del portal por
// WhatsApp (no la cambia, solo se la recuerda). Usa WHATSAPP MAMA si
// existe, si no usa WHATSAPP.
// -------------------------------------
async function recuperarClave(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const clave = (f["CLAVE PORTAL"] || "").toString().trim();
  if (!clave) {
    return json(
      { success: false, error: "Todavía no tienes una clave asignada. Contacta a la academia." },
      400
    );
  }

  const telefonoRaw = f["WHATSAPP MAMA"] || f["WHATSAPP"] || "";
  const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
  if (!telefonoLimpio) {
    return json(
      {
        success: false,
        error: "No tenemos un WhatsApp registrado para enviarte tu clave. Contacta a la academia.",
      },
      400
    );
  }

  try {
    await enviarWhatsapp(
      env,
      telefonoLimpio,
      `Hola! 👋 Este es tu clave para entrar al Portal de Alumnas de MOVE Dance Academy: ${clave}`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el WhatsApp: " + e.message }, 500);
  }

  return json({ success: true, ultimosDigitos: telefonoLimpio.slice(-4) });
}

// -------------------------------------
// ACCIÓN: recuperarClavePorCorreo
// La familia escribe su correo; solo se manda la clave si ese correo
// coincide EXACTAMENTE (sin mayúsculas/espacios) con el que ya está
// guardado en Airtable para esta alumna — así nadie puede recibir la
// clave de otra alumna con solo escribir cualquier correo.
// -------------------------------------
async function recuperarClavePorCorreo(env, alumnaId, correoIngresado) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }
  const correoLimpio = (correoIngresado || "").toString().trim().toLowerCase();
  if (!correoLimpio) {
    return json({ success: false, error: "Escribe tu correo." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const clave = (f["CLAVE PORTAL"] || "").toString().trim();
  if (!clave) {
    return json(
      { success: false, error: "Todavía no tienes una clave asignada. Contacta a la academia." },
      400
    );
  }

  const correoGuardado = (f["CORREO"] || "").toString().trim().toLowerCase();
  if (!correoGuardado || correoGuardado !== correoLimpio) {
    return json(
      {
        success: false,
        error:
          "Ese correo no coincide con el que tenemos registrado. Verifica que esté bien escrito, o usa la opción de recuperar por WhatsApp.",
      },
      400
    );
  }

  try {
    await enviarCorreo(
      env,
      correoGuardado,
      "Tu clave del Portal de Alumnas — MOVE Dance Academy",
      `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:28px 24px;">
        <h2 style="color:#ef4b9b;margin-bottom:4px;">MOVE Dance Academy</h2>
        <p style="color:#555;font-size:15px;">¡Hola! Aquí está tu clave para entrar al Portal de Alumnas:</p>
        <p style="font-size:28px;font-weight:800;letter-spacing:3px;color:#ef4b9b;background:#fff0f6;padding:14px 22px;border-radius:14px;display:inline-block;margin:12px 0;">${clave}</p>
        <p style="color:#999;font-size:12.5px;margin-top:22px;">Si tú no solicitaste este correo, puedes ignorarlo con confianza — tu clave sigue siendo la misma.</p>
      </div>`
    );
  } catch (e) {
    return json({ success: false, error: "No se pudo enviar el correo: " + e.message }, 500);
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: cambiarClave
// La alumna/mamá ya está dentro del portal (ya validó su clave
// actual para entrar); aquí la vuelve a confirmar por seguridad
// antes de guardar la nueva.
// -------------------------------------
async function cambiarClave(env, alumnaId, claveActual, claveNueva) {
  if (!alumnaId || !claveActual || !claveNueva) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  const nuevaLimpia = claveNueva.toString().trim();
  if (nuevaLimpia.length < 6) {
    return json({ success: false, error: "Tu nueva clave debe tener al menos 6 caracteres." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const claveGuardada = (f["CLAVE PORTAL"] || "").toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveActual.toString().trim().toLowerCase()) {
    return json({ success: false, error: "Tu clave actual no es correcta." }, 401);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { "CLAVE PORTAL": nuevaLimpia } }],
      typecast: true,
    }),
  });

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: historialPagos
// Devuelve todas las mensualidades (tabla PAGOS) de esta alumna del
// AÑO EN CURSO únicamente — el próximo año arranca vacío otra vez,
// no se va acumulando. Cada una trae su estado, monto y link de pago
// (si ya existe) para poder pagar las pendientes desde aquí mismo.
// -------------------------------------
async function getHistorialPagos(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const nombreAlumna = f["ALUMNA/O"] || "";
  if (!nombreAlumna) {
    return json({ success: true, historial: [] });
  }

  const nombreEscapado = nombreAlumna.replace(/"/g, '\\"');
  const anioActual = new Date().getUTCFullYear();
  const formula =
    `AND(` +
    `FIND("${nombreEscapado}", ARRAYJOIN({ALUMNA})), ` +
    `{AÑO}="${anioActual}"` +
    `)`;

  const records = await listAll(env, TABLES.PAGOS, `?${qs({ filterByFormula: formula })}`);

  const historial = records.map((r) => {
    const pago = construirPago(r);
    const mesRaw = r.fields["MES"];
    const mes = Array.isArray(mesRaw) ? mesRaw[0] : mesRaw || "";
    return { ...pago, mes };
  });

  historial.sort((a, b) => MESES_ES.indexOf(a.mes) - MESES_ES.indexOf(b.mes));

  return json({ success: true, anio: anioActual, historial });
}

// -------------------------------------
// ACCIÓN: actualizarCumpleanos
// Permite que la familia corrija la fecha de cumpleaños directamente
// desde el perfil, por si quedó mal escrita. Solo toca ese único
// campo — no se expone edición libre de ningún otro dato.
// -------------------------------------
async function actualizarCumpleanos(env, alumnaId, nuevaFecha) {
  if (!alumnaId || !nuevaFecha) {
    return json({ success: false, error: "Falta la fecha de cumpleaños." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(nuevaFecha)) {
    return json({ success: false, error: "La fecha no tiene un formato válido." }, 400);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { "CUMPLEAÑOS": nuevaFecha } }],
      typecast: true,
    }),
  });

  return json({ success: true, cumpleanos: nuevaFecha });
}

// -------------------------------------
// ACCIÓN: actualizarCorreo
// Permite que la familia agregue o corrija su correo directamente
// desde el perfil — así las que todavía no lo tenían registrado
// pueden ponerlo ellas mismas y usar después la recuperación de
// clave por correo. Solo toca ese único campo.
// -------------------------------------
async function actualizarCorreo(env, alumnaId, nuevoCorreo) {
  if (!alumnaId || !nuevoCorreo) {
    return json({ success: false, error: "Falta el correo." }, 400);
  }
  const correoLimpio = nuevoCorreo.toString().trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correoLimpio)) {
    return json({ success: false, error: "Ese correo no tiene un formato válido." }, 400);
  }

  await airtableFetch(env, TABLES.ALUMNAS, {
    method: "PATCH",
    body: JSON.stringify({
      records: [{ id: alumnaId, fields: { CORREO: correoLimpio } }],
      typecast: true,
    }),
  });

  return json({ success: true, correo: correoLimpio });
}

// -------------------------------------
// ACCIÓN: entrar
// 1) Vuelve a leer el registro de la alumna EN VIVO
// 2) Compara la clave ingresada contra CLAVE PORTAL
// 3) Si coincide, arma el perfil según la tabla CONFIGURACION
//    PORTAL ALUMNAS (solo filas VISIBLE, en orden de ORDEN)
// -------------------------------------
async function entrar(env, alumnaId, clave) {
  if (!alumnaId || !clave) {
    return json({ success: false, error: "Falta el código de acceso." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};

  const claveGuardada = (f["CLAVE PORTAL"] || "").toString().trim();
  const claveIngresada = clave.toString().trim();

  if (!claveGuardada || claveGuardada.toLowerCase() !== claveIngresada.toLowerCase()) {
    return json({ success: false, error: "Ese código no es correcto." }, 401);
  }

  const filasConfig = await listAll(
    env,
    TABLES.CONFIGURACION,
    `?${qs({ filterByFormula: "{VISIBLE}=1" })}`
  );
  filasConfig.sort((a, b) => (a.fields["ORDEN"] || 0) - (b.fields["ORDEN"] || 0));

  const perfil = filasConfig.map((fila) => {
    const etiqueta = fila.fields["ETIQUETA"] || "";
    const nombreCampo = fila.fields["CAMPO EN ALUMNAS"] || "";
    const { tipo, valor } = formatearCampo(f[nombreCampo]);
    // Mandamos también el nombre real del campo de Airtable (no solo
    // la etiqueta) para que la página pueda reconocer de forma
    // confiable cuál fila es "CUMPLEAÑOS" y mostrarla editable, sin
    // depender del texto de la etiqueta (que la academia puede
    // cambiar libremente en CONFIGURACION PORTAL ALUMNAS).
    return { etiqueta, tipo, valor, campo: nombreCampo };
  });

  const pago = await obtenerPagoDelMes(env, f["ALUMNA/O"] || "");
  const pagosEspeciales = await obtenerPagosEspeciales(env, f["PAGOS ESPECIALES"] || []);

  return json({
    success: true,
    nombre: f["ALUMNA/O"] || "",
    perfil,
    pago,
    pagosEspeciales,
  });
}

// -------------------------------------
// CHAT: familia <-> maestras (un hilo privado por alumna)
// -------------------------------------
// No filtramos por fórmula de Airtable (ARRAYJOIN de un campo
// enlazado da el NOMBRE del registro, no su recordId — y como hay
// alumnas con el mismo nombre, filtrar por nombre podría mezclar
// mensajes de una familia con los de otra). En vez de eso, traemos
// todos los mensajes y filtramos aquí mismo por el recordId exacto
// de la alumna, que sí viene directo en fields.ALUMNA al leer.
// -------------------------------------

async function chatObtener(env, alumnaId, quien, maestraId) {
  if (!alumnaId || !maestraId) {
    return json({ success: false, error: "Falta indicar la alumna y la maestra." }, 400);
  }
  const quienNormalizado = quien === "maestra" ? "maestra" : "familia";

  const todos = await listAll(env, TABLES.CHAT);
  const propios = todos.filter(
    (r) =>
      (r.fields.ALUMNA || []).includes(alumnaId) &&
      (r.fields.MAESTRA || []).includes(maestraId) &&
      esDelMesActual(r.createdTime)
  );
  propios.sort((a, b) => new Date(a.createdTime) - new Date(b.createdTime));

  // Al abrir el chat, marcamos como leídos los mensajes que escribió
  // "el otro lado" (si soy familia, marco leídos los de la maestra, y
  // viceversa) — así el que no abrió el chat ve que sigue pendiente.
  const campoLeido = quienNormalizado === "familia" ? "LEIDO FAMILIA" : "LEIDO MAESTRA";
  const rolContrario = quienNormalizado === "familia" ? "MAESTRA" : "FAMILIA";
  const porMarcar = propios.filter((r) => r.fields.ROL === rolContrario && !r.fields[campoLeido]);

  for (let i = 0; i < porMarcar.length; i += 10) {
    const lote = porMarcar.slice(i, i + 10);
    await airtableFetch(env, TABLES.CHAT, {
      method: "PATCH",
      body: JSON.stringify({
        records: lote.map((r) => ({ id: r.id, fields: { [campoLeido]: true } })),
        typecast: true,
      }),
    });
  }

  const mensajes = propios.map((r) => ({
    id: r.id,
    texto: r.fields.MENSAJE || "",
    rol: r.fields.ROL || "FAMILIA",
    autor: r.fields.AUTOR || "",
    fecha: r.createdTime,
  }));

  return json({ success: true, mensajes });
}

async function chatEnviar(env, alumnaId, quien, autor, texto, maestraId) {
  if (!alumnaId || !maestraId || !texto || !texto.toString().trim()) {
    return json({ success: false, error: "Escribe un mensaje." }, 400);
  }
  const rol = quien === "maestra" ? "MAESTRA" : "FAMILIA";
  const autorFinal = (autor || "").toString().trim() || (rol === "MAESTRA" ? "Academia" : "Familia");

  await airtableFetch(env, TABLES.CHAT, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            MENSAJE: texto.toString().trim(),
            ALUMNA: [alumnaId],
            MAESTRA: [maestraId],
            ROL: rol,
            AUTOR: autorFinal,
            "LEIDO FAMILIA": rol === "FAMILIA",
            "LEIDO MAESTRA": rol === "MAESTRA",
          },
        },
      ],
      typecast: true,
    }),
  });

  // Avisamos por WhatsApp al lado que NO escribió que tiene un mensaje
  // nuevo (solo el aviso, no el contenido, para no duplicar el chat
  // completo por WhatsApp) — así ninguno de los dos se queda sin
  // enterarse, aunque no tenga abierta la página en ese momento.
  if (rol === "MAESTRA") {
    try {
      const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
      const f = record.fields || {};
      const telefonoRaw = f["WHATSAPP MAMA"] || f["WHATSAPP"] || "";
      const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
      if (telefonoLimpio) {
        await enviarWhatsapp(
          env,
          telefonoLimpio,
          `💬 Tienes un mensaje nuevo de ${autorFinal} en el Portal de Alumnas sobre ${
            f["ALUMNA/O"] || "tu alumna"
          }. Entra a academiamovedance.com para verlo.`
        );
      }
    } catch (e) {
      // No interrumpe el envío del mensaje aunque falle el aviso de WhatsApp.
      console.error("No se pudo avisar por WhatsApp:", e.message);
    }
  } else {
    try {
      const [alumnaRecord, maestraRecord] = await Promise.all([
        airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`),
        airtableFetch(env, `${TABLES.MAESTRAS}/${maestraId}`),
      ]);
      const nombreAlumna = (alumnaRecord.fields || {})["ALUMNA/O"] || "una alumna";
      const telefonoRaw = (maestraRecord.fields || {})["WHATSAPP"] || "";
      const telefonoLimpio = telefonoRaw.toString().replace(/\D/g, "");
      if (telefonoLimpio) {
        await enviarWhatsapp(
          env,
          telefonoLimpio,
          `💬 Tienes un mensaje nuevo en el Chat de Maestras sobre ${nombreAlumna}. Entra a academiamovedance.com/maestras.html para verlo.`
        );
      }
    } catch (e) {
      // No interrumpe el envío del mensaje aunque falle el aviso de WhatsApp.
      console.error("No se pudo avisar a la maestra por WhatsApp:", e.message);
    }
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: maestrasDeAlumna
// Para que el papá/mamá elija CON QUIÉN quiere hablar (y no le llegue
// a cualquier maestra), necesitamos saber las maestras reales de esa
// alumna. El campo directo "MAESTRA" en ALUMNAS casi no se usa, pero
// cada alumna SÍ tiene sus grupos en "GRUPOS MOVE", y cada grupo ya
// tiene su "MAESTRA PRINCIPAL" — así que derivamos la lista de
// maestras a través de los grupos de la alumna.
// -------------------------------------
async function maestrasDeAlumna(env, alumnaId) {
  if (!alumnaId) {
    return json({ success: false, error: "Falta indicar la alumna." }, 400);
  }

  const record = await airtableFetch(env, `${TABLES.ALUMNAS}/${alumnaId}`);
  const f = record.fields || {};
  const idsGrupos = f["GRUPOS MOVE"] || [];

  if (!idsGrupos.length) {
    return json({ success: true, maestras: [] });
  }

  const formula = "OR(" + idsGrupos.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const grupos = await listAll(env, TABLES.GRUPOS, `?${qs({ filterByFormula: formula })}`);

  const idsMaestras = [];
  grupos.forEach((g) => {
    (g.fields["MAESTRA PRINCIPAL"] || []).forEach((id) => {
      if (!idsMaestras.includes(id)) idsMaestras.push(id);
    });
  });

  if (!idsMaestras.length) {
    return json({ success: true, maestras: [] });
  }

  const todas = await listAll(env, TABLES.MAESTRAS);
  const porId = {};
  todas.forEach((r) => {
    porId[r.id] = r;
  });

  const maestras = idsMaestras
    .filter((id) => porId[id] && porId[id].fields["ACTIVA"] !== false)
    .map((id) => ({ id, nombre: porId[id].fields["MAESTRA"] || "Maestra" }));

  return json({ success: true, maestras });
}

// -------------------------------------
// MAESTRAS: cada maestra tiene su propia clave individual, guardada
// en el campo "CLAVE CHAT" de la tabla MAESTRAS (junto a su nombre).
// Así el mensaje siempre queda firmado con el nombre real de quien
// escribió, sin que la maestra tenga que escribirlo ella misma.
// -------------------------------------

async function maestraEntrar(env, clave) {
  if (!clave || !clave.toString().trim()) {
    return json({ success: false, error: "Escribe tu clave." }, 400);
  }
  const claveIngresada = clave.toString().trim();

  const maestras = await listAll(env, TABLES.MAESTRAS);
  const encontrada = maestras.find((r) => {
    const f = r.fields || {};
    const claveGuardada = (f["CLAVE CHAT"] || "").toString().trim();
    return claveGuardada && claveGuardada === claveIngresada && f["ACTIVA"] !== false;
  });

  if (!encontrada) {
    return json({ success: false, error: "Clave incorrecta." }, 401);
  }

  return json({
    success: true,
    maestraId: encontrada.id,
    nombre: encontrada.fields["MAESTRA"] || "Maestra",
  });
}

// -------------------------------------
// ACCIÓN: maestraListaAlumnas
// Lista SOLO de las alumnas de ESTA maestra — derivada de los grupos
// donde ella es "MAESTRA PRINCIPAL" (mismo dato real que usamos del
// lado de los papás), así una maestra nunca ve ni puede escribirle a
// una alumna que no es suya, por privacidad — con la cantidad de
// mensajes suyos sin leer, para que sepa a quién responder primero.
// -------------------------------------
async function maestraListaAlumnas(env, maestraId) {
  if (!maestraId) {
    return json({ success: false, error: "Falta indicar la maestra." }, 400);
  }

  const todosLosGrupos = await listAll(env, TABLES.GRUPOS);
  const gruposDeMaestra = todosLosGrupos.filter((g) =>
    (g.fields["MAESTRA PRINCIPAL"] || []).includes(maestraId)
  );

  const idsAlumnas = [];
  gruposDeMaestra.forEach((g) => {
    (g.fields["ALUMNAS 2"] || []).forEach((id) => {
      if (!idsAlumnas.includes(id)) idsAlumnas.push(id);
    });
  });

  if (!idsAlumnas.length) {
    return json({ success: true, alumnas: [] });
  }

  const formula = "OR(" + idsAlumnas.map((id) => `RECORD_ID()="${id}"`).join(",") + ")";
  const alumnas = await listAll(
    env,
    TABLES.ALUMNAS,
    `?${qs({ filterByFormula: `AND(${formula}, {ESTADO}="ACTIVA")` })}&fields%5B%5D=ALUMNA%2FO`
  );

  const mensajes = await listAll(env, TABLES.CHAT);

  const noLeidosPorAlumna = {};
  mensajes.forEach((m) => {
    const f = m.fields || {};
    if (
      f["ROL"] === "FAMILIA" &&
      !f["LEIDO MAESTRA"] &&
      (f["MAESTRA"] || []).includes(maestraId) &&
      esDelMesActual(m.createdTime)
    ) {
      (f["ALUMNA"] || []).forEach((id) => {
        noLeidosPorAlumna[id] = (noLeidosPorAlumna[id] || 0) + 1;
      });
    }
  });

  const lista = alumnas.map((r) => ({
    id: r.id,
    nombre: r.fields["ALUMNA/O"] || "(Sin nombre)",
    noLeidos: noLeidosPorAlumna[r.id] || 0,
  }));

  lista.sort((a, b) => b.noLeidos - a.noLeidos || a.nombre.localeCompare(b.nombre));

  return json({ success: true, alumnas: lista });
}

// -------------------------------------
// PÁGINA PÚBLICA "AGENDAR CLASE DE PRUEBA"
// -------------------------------------

// -------------------------------------
// ACCIÓN: horariosDisponibles
// Para que el selector de "clase" y "hora" de la página de clase de
// prueba SIEMPRE muestre las clases y horarios reales — leído en vivo
// de GRUPOS + HORARIOS, para no tener que editar código cada vez que
// cambie un horario en la academia.
// -------------------------------------
async function horariosDisponibles(env) {
  const grupos = await listAll(
    env,
    TABLES.GRUPOS,
    `?${qs({ filterByFormula: '{ESTADO}="ACTIVO"' })}`
  );
  const horarios = await listAll(env, TABLES.HORARIOS);

  // Algunos horarios ya traen el día metido dentro de INICIO/FIN
  // (ej. clases que se reúnen días distintos a horas distintas: "MARTES
  // 6:00 PM, VIERNES 5:30 PM") — en esos casos NO repetimos el campo
  // DIA para no duplicar el día en el texto final.
  const DIAS_REGEX = /(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)/i;
  const DIAS_REGEX_GLOBAL = /(LUNES|MARTES|MI[ÉE]RCOLES|JUEVES|VIERNES|S[ÁA]BADO|DOMINGO)/gi;
  // Números de día de JS: domingo=0 … sábado=6 — así el formulario
  // puede exigir que la fecha elegida caiga justo en un día en que
  // esa clase se imparte.
  const DIAS_NUMERO = { DOMINGO: 0, LUNES: 1, MARTES: 2, MIERCOLES: 3, JUEVES: 4, VIERNES: 5, SABADO: 6 };

  function extraerDiasSemana(...textos) {
    const encontrados = new Set();
    textos.forEach((t) => {
      const sinAcentos = (t || "")
        .toString()
        .toUpperCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      const coincidencias = sinAcentos.match(DIAS_REGEX_GLOBAL) || [];
      coincidencias.forEach((dia) => {
        if (DIAS_NUMERO[dia] !== undefined) encontrados.add(DIAS_NUMERO[dia]);
      });
    });
    return [...encontrados].sort((a, b) => a - b);
  }

  const horariosPorGrupo = {};
  horarios.forEach((h) => {
    const f = h.fields || {};
    (f["GRUPO"] || []).forEach((id) => {
      if (!horariosPorGrupo[id]) horariosPorGrupo[id] = [];
      const dia = (f["DIA"] || "").toString().trim();
      const inicio = (f["INICIO"] || "").toString().trim();
      const fin = (f["FIN"] || "").toString().trim();
      if (!inicio && !fin) return;

      const yaTraeDia = DIAS_REGEX.test(inicio) || DIAS_REGEX.test(fin);
      const texto = yaTraeDia
        ? [inicio, fin].filter(Boolean).join(" – ")
        : [dia, [inicio, fin].filter(Boolean).join(" – ")].filter(Boolean).join(", ");

      const dias = extraerDiasSemana(dia, inicio, fin);

      if (texto) horariosPorGrupo[id].push({ texto, dias });
    });
  });

  const clases = grupos
    .map((g) => {
      const f = g.fields || {};
      const estiloRaw = f["ESTILO"];
      const estilo = estiloRaw && typeof estiloRaw === "object" ? estiloRaw.name : estiloRaw || "";
      return {
        grupo: (f["NOMBRE DEL GRUPO"] || "").toString().trim(),
        estilo,
        horarios: horariosPorGrupo[g.id] || [],
      };
    })
    // El grupo ELEVE es privado (solo alumnas seleccionadas) — nunca debe
    // ofrecerse como opción de clase de prueba pública.
    .filter((c) => !/\beleve\b/i.test(c.grupo))
    .filter((c) => c.estilo && c.grupo && c.horarios.length);

  return json({ success: true, clases });
}

// -------------------------------------
// ACCIÓN: agendarPrueba
// Crea el registro en PRUEBAS (misma tabla y vista "INGRESOS DE
// PRUEBAS" que ya usa la academia) y le manda un WhatsApp bonito de
// confirmación a la familia — el aviso de que se agendó, no una
// confirmación final (el staff la confirma o reagenda a mano).
// -------------------------------------
async function agendarPrueba(env, datos) {
  const alumna = (datos.alumna || "").toString().trim();
  const edad = (datos.edad || "").toString().trim();
  const telefonoRaw = (datos.telefono || "").toString();
  const fecha = (datos.fecha || "").toString().trim();
  const clase = (datos.clase || "").toString().trim();
  const hora = (datos.hora || "").toString().trim();

  if (!alumna || !edad || !fecha || !clase || !hora) {
    return json({ success: false, error: "Completa todos los campos." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
    return json({ success: false, error: "La fecha no tiene un formato válido." }, 400);
  }
  const telefonoLimpio = telefonoRaw.replace(/\D/g, "");
  if (telefonoLimpio.length < 8) {
    return json({ success: false, error: "Escribe un número de WhatsApp válido." }, 400);
  }
  // "web" = viene de la página pública (todavía puede cambiar de fecha,
  // se manda un mensaje avisando que la academia confirmará o reagendará).
  // "recepcion" = se llenó en Recepción, donde ya se validó con la
  // alumna que esa fecha/hora sí funciona, así que el mensaje es de
  // confirmación directa, sin condicionales.
  const origen = datos.origen === "recepcion" ? "recepcion" : "web";

  await airtableFetch(env, TABLES.PRUEBAS, {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            ALUMNA: alumna,
            EDAD: edad,
            TELEFONO: telefonoLimpio,
            "FECHA CLASE PRUEBA": fecha,
            CLASE: clase,
            HORA: hora,
          },
        },
      ],
      typecast: true,
    }),
  });

  try {
    const [anio, mes, dia] = fecha.split("-").map(Number);
    const fechaTexto = `${dia} de ${MESES_ES[mes - 1]}`;

    const mensaje =
      origen === "recepcion"
        ? `¡Hola ${alumna}! 🎉✅ Tu Clase de Prueba en MOVE Dance Academy quedó CONFIRMADA.\n\n` +
          `📌 Clase: ${clase}\n🕐 Horario: ${hora}\n📅 Fecha: ${fechaTexto}\n\n` +
          `¡Te esperamos para que vivas la experiencia MOVE! 💃🕺`
        : `¡Hola ${alumna}! 🎉✨ Gracias por agendar tu Clase de Prueba en MOVE Dance Academy.\n\n` +
          `📌 Clase: ${clase}\n🕐 Horario: ${hora}\n📅 Fecha que elegiste: ${fechaTexto}\n\n` +
          `Nos vamos a comunicar contigo pronto para confirmarte la clase, o para reagendarte si ese día no nos es posible. ¡Te esperamos para que vivas la experiencia MOVE! 💃🕺`;

    await enviarWhatsapp(env, telefonoLimpio, mensaje);
  } catch (e) {
    // No interrumpe el registro aunque falle el WhatsApp de confirmación.
    console.error("No se pudo enviar el WhatsApp de confirmación de prueba:", e.message);
  }

  return json({ success: true });
}

// -------------------------------------
// ACCIÓN: crearInscripcion
// Crea una nueva alumna a partir de la Ficha de Inscripción pública
// (reemplaza el formulario de Fillout, escribe en la misma tabla
// ALUMNAS). Si viene una foto, se sube DESPUÉS de crear el registro,
// igual que subirComprobante — y si falla la subida de la foto, no
// se bloquea la inscripción (la alumna ya quedó registrada).
// -------------------------------------
async function crearInscripcion(env, datos) {
  const alumna = (datos.alumna || "").toString().trim();
  const edad = (datos.edad || "").toString().trim();
  const cumpleanos = (datos.cumpleanos || "").toString().trim();
  const whatsappRaw = (datos.whatsapp || "").toString();
  const correo = (datos.correo || "").toString().trim();
  const nit = (datos.nit || "").toString().trim();
  const nombrePadre = (datos.nombrePadre || "").toString().trim();
  const contactoEmergencia = (datos.contactoEmergencia || "").toString().trim();
  const numeroEmergencia = (datos.numeroEmergencia || "").toString().trim();
  const condicionMedica = (datos.condicionMedica || "").toString().trim();
  const aceptoPoliticas = (datos.aceptoPoliticas || "").toString().trim().toUpperCase();
  const aceptoShow = (datos.aceptoShow || "").toString().trim().toUpperCase();

  if (
    !alumna ||
    !edad ||
    !cumpleanos ||
    !whatsappRaw ||
    !contactoEmergencia ||
    !numeroEmergencia
  ) {
    return json({ success: false, error: "Completa todos los campos obligatorios." }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cumpleanos)) {
    return json({ success: false, error: "La fecha de cumpleaños no tiene un formato válido." }, 400);
  }
  const whatsappLimpio = whatsappRaw.replace(/\D/g, "");
  if (whatsappLimpio.length < 8) {
    return json({ success: false, error: "Escribe un número de WhatsApp válido." }, 400);
  }
  if (correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(correo)) {
    return json({ success: false, error: "Ese correo no tiene un formato válido." }, 400);
  }
  if (aceptoPoliticas !== "SI") {
    return json(
      { success: false, error: "Debes aceptar las Políticas de Ingreso a la Academia para continuar." },
      400
    );
  }

  const fechaInscripcion = new Date().toISOString().slice(0, 10);

  // OJO: este nombre de campo tiene espacios dobles en Airtable (después
  // de "ACEPTO", después de la coma tras "MISMO," y después de "TRAJES")
  // — debe coincidir EXACTAMENTE, letra por letra y espacio por espacio,
  // con el nombre real del campo en la tabla ALUMNAS.
  const CAMPO_AUTORIZO_SHOW =
    "AUTORIZO QUE MI HIJA/O PARTICIPE EN EL SHOW DE FIN DE AÑO Y ACEPTO  LOS REQUISITOS PARA PARTICIPAR EN EL MISMO,  ASIMISMO ACEPTO Y ME COMPROMETO A REALIZAR LOS PAGOS CORRESPONDIENTES DE CADA UNO DE SUS TRAJES  EN LAS FECHAS ESTABLECIDAS.";

  const fields = {
    "FECHA INSCRIPCION": fechaInscripcion,
    "ALUMNA/O": alumna,
    EDAD: edad,
    "CUMPLEAÑOS": cumpleanos,
    WHATSAPP: whatsappLimpio,
    "CONTACTO DE EMERGENCIA": contactoEmergencia,
    "NÚMERO CONTACTO DE EMERGENCIA": numeroEmergencia,
    ESTADO: "ACTIVA",
    "ACEPTO LAS POLITICAS DE INGRESO A LA ACADEMIA": "SI",
  };
  // "Nombre de un padre" solo aplica a la ficha de menores de edad —
  // en la ficha de adultos ese campo ni siquiera se pregunta.
  if (nombrePadre) fields["NOMBRE DE UN PADRE"] = nombrePadre;
  if (correo) fields.CORREO = correo;
  if (nit) fields.NIT = nit;
  if (condicionMedica) fields["CONDICION MEDICA O ALERGIAS"] = condicionMedica;
  if (aceptoShow === "SI" || aceptoShow === "NO") {
    fields[CAMPO_AUTORIZO_SHOW] = aceptoShow;
  }

  const resp = await airtableFetch(env, TABLES.ALUMNAS, {
    method: "POST",
    body: JSON.stringify({
      records: [{ fields }],
      typecast: true,
    }),
  });

  const nuevaAlumnaId = resp?.records?.[0]?.id;

  if (nuevaAlumnaId && datos.fotoBase64) {
    try {
      const res = await fetch(
        `https://content.airtable.com/v0/${BASE_ID}/${nuevaAlumnaId}/${CAMPO_FOTO_ALUMNA_ID}/uploadAttachment`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${env.AIRTABLE_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            contentType: datos.fotoTipo || "application/octet-stream",
            filename: datos.fotoNombre || "foto-alumna",
            file: datos.fotoBase64,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        console.error(
          "No se pudo subir la foto de la nueva alumna:",
          data?.error?.message || data?.error || res.status
        );
      }
    } catch (e) {
      // No interrumpe la inscripción aunque falle la subida de la foto.
      console.error("No se pudo subir la foto de la nueva alumna:", e.message);
    }
  }

  return json({ success: true, alumnaId: nuevaAlumnaId });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== "POST") {
      return json({ success: false, error: "Método no permitido" }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ success: false, error: "JSON inválido" }, 400);
    }

    try {
      if (body.accion === "alumnas") {
        return json(await getAlumnas(env));
      }
      if (body.accion === "entrar") {
        return await entrar(env, body.alumnaId, body.clave);
      }
      if (body.accion === "generarLink") {
        return await generarLink(env, body.pagoId);
      }
      if (body.accion === "subirComprobante") {
        return await subirComprobante(env, body.pagoId, body.archivoBase64, body.nombreArchivo, body.tipoArchivo);
      }
      if (body.accion === "evaluaciones") {
        return await getEvaluaciones(env, body.alumnaId);
      }
      if (body.accion === "recuperarClave") {
        return await recuperarClave(env, body.alumnaId);
      }
      if (body.accion === "recuperarClavePorCorreo") {
        return await recuperarClavePorCorreo(env, body.alumnaId, body.correo);
      }
      if (body.accion === "cambiarClave") {
        return await cambiarClave(env, body.alumnaId, body.claveActual, body.claveNueva);
      }
      if (body.accion === "historialPagos") {
        return await getHistorialPagos(env, body.alumnaId);
      }
      if (body.accion === "actualizarCumpleanos") {
        return await actualizarCumpleanos(env, body.alumnaId, body.nuevaFecha);
      }
      if (body.accion === "actualizarCorreo") {
        return await actualizarCorreo(env, body.alumnaId, body.nuevoCorreo);
      }
      if (body.accion === "maestrasDeAlumna") {
        return await maestrasDeAlumna(env, body.alumnaId);
      }
      if (body.accion === "chatObtener") {
        return await chatObtener(env, body.alumnaId, body.quien, body.maestraId);
      }
      if (body.accion === "chatEnviar") {
        return await chatEnviar(env, body.alumnaId, body.quien, body.autor, body.texto, body.maestraId);
      }
      if (body.accion === "maestraEntrar") {
        return await maestraEntrar(env, body.clave);
      }
      if (body.accion === "maestraListaAlumnas") {
        return await maestraListaAlumnas(env, body.maestraId);
      }
      if (body.accion === "horariosDisponibles") {
        return await horariosDisponibles(env);
      }
      if (body.accion === "agendarPrueba") {
        return await agendarPrueba(env, body);
      }
      if (body.accion === "crearInscripcion") {
        return await crearInscripcion(env, body);
      }
      return json({ success: false, error: "Acción desconocida" }, 400);
    } catch (e) {
      console.error(e);
      return json({ success: false, error: e.message || "Error interno" }, 500);
    }
  },
};
