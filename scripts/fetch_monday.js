// scripts/fetch_monday.js
// Node 18+

const fs = require("fs");
const path = require("path");

const MONDAY_API = "https://api.monday.com/v2";

// ⚠️ NO hardcodes: usa variables de entorno
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;               // requerido
const MONDAY_AUTH  = (process.env.MONDAY_AUTH || "").toLowerCase(); // "bearer" si OAuth
const BOARD_ID     = parseInt(process.env.MONDAY_BOARD_ID || "1587958550", 10);
const OUTPUT_PATH  = process.env.OUTPUT_PATH || "Grafana/tickets.json";

if (!MONDAY_TOKEN) throw new Error("Falta MONDAY_TOKEN");
if (!BOARD_ID) throw new Error("Falta MONDAY_BOARD_ID");
if (!global.fetch) throw new Error("Requiere Node 18+ (fetch nativo)");

// Personal Token => "Authorization: <token>"
// OAuth Token    => "Authorization: Bearer <token>"
const authHeader = MONDAY_AUTH === "bearer" ? `Bearer ${MONDAY_TOKEN}` : MONDAY_TOKEN;

// Utilidades
const norm = (s) => (s ?? "").toString().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();
const findCol = (cols, matchers) => {
  for (const c of cols || []) {
    const t = norm(c.title);
    const id = norm(c.id);
    for (const m of matchers) {
      const n = norm(m);
      if (t === n || id === n) return c;
    }
  }
  return null;
};
const colText = (cols, matchers) => findCol(cols, matchers)?.text ?? "";

// ✅ Ordena en el servidor por creación DESC y trae justo 50
const QUERY = `
  query BoardItems($boardId: [ID!], $limit: Int!, $order: [ItemsQueryOrderBy!]) {
    boards(ids: $boardId) {
      items_page(
        limit: $limit,
        query_params: { order_by: $order }
      ) {
        items {
          id
          name
          created_at
          updated_at
          column_values { id title text value }
        }
      }
    }
  }
`;

async function gql(variables) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": authHeader },
    body: JSON.stringify({ query: QUERY, variables })
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} - ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data;
}

async function fetchLatest50(boardId) {
  const data = await gql({
    boardId,
    limit: 50,
    order: [{ column_id: "__creation_log__", direction: "desc" }]
  });
  return data?.boards?.[0]?.items_page?.items ?? [];
}

// Mapeo
function toPlain(it) {
  const cols = it.column_values || [];
  const numeroTicket = colText(cols, ["Nº de ticket","No de ticket","N° de ticket","id_de_elemento_mkkcq0n3"]);
  const estado       = colText(cols, ["Estado","status"]);
  const urgencia     = colText(cols, ["Urgencia","status_1"]);
  const asignado     = colText(cols, ["Asignado","person"]);
  const elemento     = colText(cols, ["Elemento","elemento"]);
  const categoria    = colText(cols, ["Categoría","categoria","estado_1__1"]);
  return {
    "Nº de ticket": numeroTicket || String(it.id),
    titulo: it.name || "",
    estado,
    urgencia,
    asignado,
    fecha_creacion: (it.created_at || "").slice(0,10),
    elemento,
    categoria
  };
}

(async () => {
  const items = await fetchLatest50(BOARD_ID);
  const plain = items.map(toPlain);

  const dir = path.dirname(OUTPUT_PATH);
  if (dir && dir !== "." && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(plain, null, 2), "utf-8");
  console.log(`OK: ${plain.length} tickets → ${OUTPUT_PATH}`);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
