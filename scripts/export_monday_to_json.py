#!/usr/bin/env python3
import json
import os
import sys
import time
from typing import Dict, Any, List, Optional

import requests

MONDAY_API_URL = "https://api.monday.com/v2"

# -------- Utilidades --------

def env(name: str, default: Optional[str] = None) -> Optional[str]:
    val = os.getenv(name)
    return val if val not in (None, "") else default


def load_column_mapping() -> Dict[str, str]:
    mapping_env = os.getenv("COLUMN_MAPPING_JSON")
    if mapping_env is not None and mapping_env.strip() != "":
        try:
            return json.loads(mapping_env)
        except json.JSONDecodeError as e:
            print(f"[warn] COLUMN_MAPPING_JSON inválido: {e}", file=sys.stderr)
    # fallback a archivo example si existe
    example_path = os.path.join("config", "column_mapping.example.json")
    if os.path.isfile(example_path):
        with open(example_path, "r", encoding="utf-8") as f:
            return json.load(f)
    return {}


def graphql_query(session: requests.Session, query: str, variables: Dict[str, Any] = None) -> Dict[str, Any]:
    payload = {"query": query}
    if variables:
        payload["variables"] = variables
    r = session.post(MONDAY_API_URL, json=payload, timeout=60)
    r.raise_for_status()
    data = r.json()
    if "errors" in data:
        raise RuntimeError(f"Monday GraphQL errors: {data['errors']}")
    return data["data"]


# -------- Exportador --------

def fetch_board_items(session: requests.Session, board_id: str, max_items: int) -> Dict[str, Any]:
    """Descarga items paginados usando items_page (cursor)."""
    items: List[Dict[str, Any]] = []
    cursor = None

    # Campos que queremos del item
    query = """
    query($board: ID!, $cursor: String) {
      boards(ids: [$board]) {
        id
        name
        items_page(limit: 200, cursor: $cursor) {
          cursor
          items {
            id
            name
            created_at
            updated_at
            creator_id
            group { id title }
            column_values { id text value type }
          }
        }
      }
    }
    """

    while True:
        data = graphql_query(session, query, {"board": board_id, "cursor": cursor})
        boards = data.get("boards", [])
        if not boards:
            raise RuntimeError(f"No se encontró el board {board_id}")
        board = boards[0]
        page = board["items_page"]
        batch = page["items"]
        items.extend(batch)
        cursor = page["cursor"]
        if cursor is None or len(items) >= max_items:
            break
        # Respetar rate limits básicos
        time.sleep(0.3)

    return {"board": {"id": board["id"], "name": board["name"]}, "items": items[:max_items]}


def map_columns(item: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, Any]:
    # Convierte column_values a dict {column_id: texto}
    col_dict = {cv["id"]: (cv.get("text") or "") for cv in item.get("column_values", [])}
    mapped: Dict[str, Any] = {}
    if mapping:
        for monday_col, target_key in mapping.items():
            mapped[target_key] = col_dict.get(monday_col)
    else:
        # Sin mapping → exportar todas las columnas tal cual
        mapped = col_dict
    return mapped


def transform_payload(raw: Dict[str, Any], mapping: Dict[str, str]) -> Dict[str, Any]:
    board = raw["board"]
    out_items: List[Dict[str, Any]] = []
    for it in raw["items"]:
        # id de item como int si es numérico; si no, dejar string
        it_id = it.get("id")
        try:
            it_id = int(it_id)
        except (TypeError, ValueError):
            pass
        out_items.append({
            "id": it_id,
            "name": it.get("name"),
            "group": it.get("group", {}).get("title"),
            "created_at": it.get("created_at"),
            "updated_at": it.get("updated_at"),
            "creator_id": it.get("creator_id"),
            "columns": map_columns(it, mapping),
        })
    return {"board": board, "count": len(out_items), "items": out_items}


def main():
    token = env("MONDAY_API_TOKEN")
    board_id = env("MONDAY_BOARD_ID")
    if not token or not board_id:
        print("[error] Faltan MONDAY_API_TOKEN o MONDAY_BOARD_ID", file=sys.stderr)
        sys.exit(1)

    max_items = int(env("MONDAY_MAX_ITEMS", "5000"))
    output_path = env("OUTPUT_PATH", os.path.join("data", "monday_tickets.json"))
    mapping = load_column_mapping()

    session = requests.Session()
    session.headers.update({
        "Authorization": token,
        "Content-Type": "application/json",
    })

    # Monday GraphQL espera ID! (string). No convertir a int.
    raw = fetch_board_items(session, board_id, max_items)
    payload = transform_payload(raw, mapping)

    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    print(f"[ok] Exportados {payload['count']} items del board {payload['board']['name']} → {output_path}")


if __name__ == "__main__":
    main()
