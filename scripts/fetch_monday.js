// scripts/fetch_monday.js
// Node 18+

const fs = require("fs");
const path = require("path");

const MONDAY_API = "https://api.monday.com/v2";
const MONDAY_TOKEN = process.env.MONDAY_TOKEN || "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU0NjI5NDMxNCwiYWFpIjoxMSwidWlkIjo2NDMwODA4MiwiaWFkIjoiMjAyNS0wOC0wNFQwOTo0OTowOC4yODJaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ3MzEwNDEsInJnbiI6ImV1YzEifQ.tIt1wUTy6cxjpXNd27WkInVwcB67fXyBx1HLl1vsMlA";

const BOARD_ID = parseInt(process.env.MONDAY_BOARD_ID || "1587958550", 10);
const OUTPUT_PATH = process.env.OUTPUT_PATH || "tickets.json";

if (!MONDAY_TOKEN) throw new Error("Falta MONDAY_TOKEN");
if (!BOARD_ID) throw new Error("Falta MONDAY_BOARD_ID");
if (!global.fetch) throw new Error("Requiere Node 18+ (fetch nativo)");

// Personal token => va "a pelo". OAuth/JWT => "Bearer <token>"
const authHeader = MONDAY_TOKEN.includes(".") ? `Bearer ${MONDAY_TOKEN}` : MONDAY_TOKEN;

// Utils
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const safeParse = (v) => { try { return v ? JSON.parse(v) : null; } catch { return null; } };
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

// GraphQL
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

async function fetchAllItems(boardId) {
  const limit = 250;
  let cursor = null, items = [];
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

// Mapeo a los 8 campos pedidos
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
    fecha_creacion: (it.created_at || "").slice(0,10), // YYYY-MM-DD
    elemento,
    categoria
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
