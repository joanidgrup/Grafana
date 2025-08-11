// scripts/fetch_monday.js  (Node 18+)
const fs = require("fs");
const path = require("path");

const MONDAY_API = "https://api.monday.com/v2";
const MONDAY_TOKEN = process.env.MONDAY_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU0NjI5NDMxNCwiYWFpIjoxMSwidWlkIjo2NDMwODA4MiwiaWFkIjoiMjAyNS0wOC0wNFQwOTo0OTowOC4yODJaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ3MzEwNDEsInJnbiI6ImV1YzEifQ.tIt1wUTy6cxjpXNd27WkInVwcB67fXyBx1HLl1vsMlA";
const BOARD_ID = parseInt(process.env.MONDAY_BOARD_ID || "1587958550", 10);
const OUTPUT_PATH = process.env.OUTPUT_PATH || "tickets.json";

// Opcional: fuerza la columna (id o título) para "elemento"
const ELEMENTO_COLUMN = (process.env.ELEMENTO_COLUMN || "").trim();
// Opcional: imprime columnas detectadas para diagnosticar
const DEBUG_COLUMNS   = (process.env.DEBUG_COLUMNS || "0") === "1";

if (!MONDAY_TOKEN) throw new Error("Falta MONDAY_TOKEN");
if (!BOARD_ID) throw new Error("Falta MONDAY_BOARD_ID");
if (!global.fetch) throw new Error("Requiere Node 18+ (fetch nativo)");

const authHeader = MONDAY_TOKEN.includes(".") ? `Bearer ${MONDAY_TOKEN}` : MONDAY_TOKEN;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const norm = (s) => (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

const pickExact = (cols, keys) => {
  for (const c of cols || []) {
    const t = norm(c.title), id = norm(c.id);
    for (const k of keys) {
      const n = norm(k);
      if (t === n || id === n) return c;
    }
  }
  return null;
};
const pickLoose = (cols, terms) => {
  for (const c of cols || []) {
    const t = norm(c.title), id = norm(c.id);
    for (const term of terms) {
      const n = norm(term);
      if (t.includes(n) || id.includes(n)) return c;
    }
  }
  return null;
};
const colText = (c) => (c?.text ?? "").toString();

const QUERY = `
  query BoardItems($boardId: [ID!], $limit: Int!, $cursor: String) {
    boards(ids: $boardId) {
      items_page(limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          created_at
          column_values { id title text value }
        }
      }
    }
  }
`;

async function gql(vars) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": authHeader },
    body: JSON.stringify({ query: QUERY, variables: vars }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchAllItems(boardId) {
  const limit = 250; let cursor = null; const items = [];
  while (true) {
    const data = await gql({ boardId, limit, cursor });
    const page = data?.boards?.[0]?.items_page;
    if (page?.items?.length) items.push(...page.items);
    if (!page?.cursor) break;
    cursor = page.cursor;
    await sleep(200);
  }
  return items;
}

function pickElementoColumn(cols) {
  // 1) Si el usuario fuerza una columna (id o título)
  if (ELEMENTO_COLUMN) {
    const forced = pickExact(cols, [ELEMENTO_COLUMN]);
    if (forced) return forced;
  }
  // 2) Intentos exactos habituales (título o id conocidos)
  const exact = pickExact(cols, [
    "Elemento", "elemento",                // títulos
    "element", "asset", "equipo", "dispositivo",
    "elemento_afectado",
    "elemento__1",
    "texto", "texto__1",                   // a veces lo ponen como "Texto"
    "element", "cmdb_elemento",
  ]);
  if (exact) return exact;

  // 3) Búsqueda flexible por subconjunto (cubre "Elemento afectado", "Asset", "Equipo", etc.)
  const loose = pickLoose(cols, ["elemento", "asset", "equipo", "disposit", "cmdb", "element"]);
  if (loose) return loose;

  return null;
}

function toPlain(it) {
  const cols = it.column_values || [];

  // Campos habituales por título/id
  const numeroTicket = pickExact(cols, ["Nº de ticket","No de ticket","N° de ticket","id_de_elemento_mkkcq0n3"]);
  const estado       = pickExact(cols, ["Estado","status"]);
  const urgencia     = pickExact(cols, ["Urgencia","status_1"]);
  const asignado     = pickExact(cols, ["Asignado","person"]);
  const categoria    = pickExact(cols, ["Categoría","categoria","estado_1__1"]);

  // Elemento con lógica robusta
  const elementoCol  = pickElementoColumn(cols);

  if (DEBUG_COLUMNS && elementoCol == null) {
    // imprime catálogo de columnas (id/title/text) una sola vez por proceso
    console.log("DEBUG: No se detectó 'Elemento'. Columnas disponibles:");
    for (const c of cols) {
      console.log(` - id=${c.id} | title=${c.title} | text=${(c.text || "").toString().slice(0,80)}`);
    }
  }

  return {
    "Nº de ticket": colText(numeroTicket) || String(it.id),
    titulo: it.name || "",
    estado: colText(estado),
    urgencia: colText(urgencia),
    asignado: colText(asignado),
    fecha_creacion: (it.created_at || "").slice(0,10),
    elemento: colText(elementoCol),           // << aquí
    categoria: colText(categoria)
  };
}

(async () => {
  const items = await fetchAllItems(BOARD_ID);
  const plain = items.map(toPlain);

  const dir = path.dirname(OUTPUT_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(plain, null, 2), "utf-8");
  console.log(`OK: ${plain.length} tickets → ${OUTPUT_PATH}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
