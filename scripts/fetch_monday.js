// scripts/fetch_monday.js
// Requisitos: Node 18+ (incluye fetch) o node-fetch para Node <18
// Lee: process.env.MONDAY_TOKEN, process.env.MONDAY_BOARD_ID, process.env.OUTPUT_PATH

const fs = require("fs");
const path = require("path");

const MONDAY_API = "https://api.monday.com/v2";
const MONDAY_TOKEN = process.env.MONDAY_TOKEN;
const BOARD_ID = parseInt(process.env.MONDAY_BOARD_ID, 10);
const OUTPUT_PATH = process.env.OUTPUT_PATH || "data/monday_tickets.json";

// GraphQL para paginar items del tablero
const query = `
  query BoardItems($boardId: [ID!], $limit: Int!, $cursor: String) {
    boards (ids: $boardId) {
      id
      name
      items_page (limit: $limit, cursor: $cursor) {
        cursor
        items {
          id
          name
          created_at
          updated_at
          column_values {
            id
            title
            text
            value
          }
        }
      }
    }
  }
`;

async function gql(variables) {
  const res = await fetch(MONDAY_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": MONDAY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status} - ${body}`);
  }
  const json = await res.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

async function fetchAllItems(boardId) {
  const limit = 250; // máximo recomendado por llamada
  let cursor = null;
  const items = [];
  while (true) {
    const data = await gql({ boardId: boardId, limit, cursor });
    const board = data.boards?.[0];
    if (!board) break;

    const page = board.items_page;
    if (page?.items?.length) {
      items.push(...page.items);
    }
    if (!page?.cursor) break;
    cursor = page.cursor;

    // Pequeña pausa para ser amable con la API (ajusta si necesitas)
    await new Promise(r => setTimeout(r, 250));
  }
  return items;
}

function mapItem(item) {
  // Transforma columnas a objeto { columnId: {title, text, value} }
  const columns = {};
  for (const c of item.column_values || []) {
    columns[c.id] = {
      title: c.title,
      text: c.text,
      // value es un JSON string con datos estructurados según tipo de columna
      // si quieres parsearlo:
      value: safeParse(c.value),
    };
  }
  return {
    id: item.id,
    name: item.name,
    created_at: item.created_at,
    updated_at: item.updated_at,
    columns,
  };
}

function safeParse(v) {
  if (!v) return null;
  try { return JSON.parse(v); } catch { return v; }
}

async function main() {
  if (!MONDAY_TOKEN) throw new Error("Falta MONDAY_TOKEN");
  if (!BOARD_ID) throw new Error("Falta MONDAY_BOARD_ID");

  const items = await fetchAllItems(BOARD_ID);
  const mapped = items.map(mapItem);

  const outDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const payload = {
    board_id: BOARD_ID,
    fetched_at_utc: new Date().toISOString(),
    count: mapped.length,
    items: mapped,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2), "utf-8");
  console.log(`Wrote ${mapped.length} items to ${OUTPUT_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

