#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Monday.com → Prometheus exporter
Métricas:
- monday_tickets_created_total              (counter monotónicamente creciente)
- monday_tickets_open                       (gauge: tickets abiertos)
- monday_tickets_by_category{category}      (gauge: abiertos por categoría)
- monday_tickets_by_technician{technician}  (gauge: abiertos por técnico)
- monday_ticket_info{ticket_id,category,technician,status} 1  (series etiquetadas)

Requisitos: pip install flask requests
Variables de entorno:
  MONDAY_TOKEN   -> Token de API
  BOARD_ID       -> ID del tablero
  PORT           -> (opcional, por defecto 9110)

Columnas: ajusta los títulos/IDs si es necesario.
"""
import os
import time
import requests
from flask import Flask, Response

API_URL = "https://api.monday.com/v2"
TOKEN   = os.environ.get("MONDAY_TOKEN", "eyJhbGciOiJIUzI1NiJ9.eyJ0aWQiOjU0NjI5NDMxNCwiYWFpIjoxMSwidWlkIjo2NDMwODA4MiwiaWFkIjoiMjAyNS0wOC0wNFQwOTo0OTowOC4yODJaIiwicGVyIjoibWU6d3JpdGUiLCJhY3RpZCI6MjQ3MzEwNDEsInJnbiI6ImV1YzEifQ.tIt1wUTy6cxjpXNd27WkInVwcB67fXyBx1HLl1vsMlA")
BOARD_ID = int(os.environ.get("BOARD_ID", "1587958550"))
PORT    = int(os.environ.get("PORT", "9110"))

# ----- Mapeo de columnas (por título visible en Monday o por id interno) -----
COL_TITLE_STATUS     = os.environ.get("COL_TITLE_STATUS", "Estado")          # id típico: "status"
COL_TITLE_PERSON     = os.environ.get("COL_TITLE_PERSON", "Asignado")        # id típico: "person"
COL_TITLE_CATEGORY   = os.environ.get("COL_TITLE_CATEGORY", "Categoría")     # id típico: "estado_1__1"
COL_TITLE_CREATEDLOG = os.environ.get("COL_TITLE_CREATEDLOG", "Creado en")   # "creation_log" (texto fecha)

# Estados que consideramos “cerrado”
CLOSED_STATES = set(s.strip().lower() for s in os.environ.get(
    "CLOSED_STATES",
    "Cerrado, Resuelto, Completado, Hecho, Done"
).split(","))

HEADERS = {
    "Authorization": TOKEN,
    "Content-Type": "application/json"
}

# Para tableros con muchos items puedes paginar por cursor; para empezar probamos 500.
PAGE_SIZE = int(os.environ.get("PAGE_SIZE", "500"))

app = Flask(__name__)

def fetch_items():
    query = """
    query($board_id: [Int], $limit: Int) {
      boards (ids: $board_id) {
        items_page (limit: $limit) {
          items {
            id
            name
            column_values {
              id
              title
              text
            }
          }
        }
      }
    }
    """
    variables = {"board_id": BOARD_ID, "limit": PAGE_SIZE}
    r = requests.post(API_URL, json={"query": query, "variables": variables}, headers=HEADERS, timeout=30)
    r.raise_for_status()
    data = r.json()
    return data["data"]["boards"][0]["items_page"]["items"]

def col_text(cols, want_title):
    # Devuelve el .text de la columna cuyo title coincide (o vacío)
    for c in cols:
        if c.get("title", "").strip().lower() == want_title.strip().lower():
            return c.get("text") or ""
    return ""

def normalize_label(value):
    if not value:
        return "Sin_dato"
    return value.strip().replace(" ", "_").replace("/", "_")

@app.route("/metrics")
def metrics():
    if not TOKEN or not BOARD_ID:
        return Response("# Configura MONDAY_TOKEN y BOARD_ID\n", mimetype="text/plain", status=500)

    items = fetch_items()

    total_items = len(items)
    open_count = 0
    by_cat = {}
    by_tech = []
    series_lines = []

    # Contador total para “tickets que se abren” (usaremos increase() en Prometheus)
    lines = []
    lines.append('# HELP monday_tickets_created_total Total de tickets creados (contador acumulado)')
    lines.append('# TYPE monday_tickets_created_total counter')
    lines.append(f"monday_tickets_created_total {total_items}")

    # Gauge de abiertos y desglose por categoría/técnico
    lines.append('# HELP monday_tickets_open Tickets abiertos actualmente')
    lines.append('# TYPE monday_tickets_open gauge')

    lines.append('# HELP monday_tickets_by_category Tickets abiertos por categoría')
    lines.append('# TYPE monday_tickets_by_category gauge')

    lines.append('# HELP monday_tickets_by_technician Tickets abiertos por técnico asignado')
    lines.append('# TYPE monday_tickets_by_technician gauge')

    lines.append('# HELP monday_ticket_info Información por ticket como serie etiquetada')
    lines.append('# TYPE monday_ticket_info gauge')

    for it in items:
        cols = it.get("column_values", [])
        status = col_text(cols, COL_TITLE_STATUS)
        tech   = col_text(cols, COL_TITLE_PERSON)
        cat    = col_text(cols, COL_TITLE_CATEGORY)

        status_lower = (status or "").strip().lower()
        is_closed = status_lower in CLOSED_STATES

        # Serie por ticket (útil para filtros y counts en Grafana/Prometheus)
        lbl_id  = normalize_label(it["id"])
        lbl_cat = normalize_label(cat)
        lbl_tec = normalize_label(tech)
        lbl_st  = normalize_label(status if status else "Sin_estado")
        series_lines.append(f'monday_ticket_info{{ticket_id="{lbl_id}",category="{lbl_cat}",technician="{lbl_tec}",status="{lbl_st}"}} 1')

        if not is_closed:
            open_count += 1
            by_cat[cat or "Sin dato"] = by_cat.get(cat or "Sin dato", 0) + 1
            by_tech.append(tech or "Sin asignar")

    # abiertos
    lines.append(f"monday_tickets_open {open_count}")

    # categoría
    for k, v in by_cat.items():
        lines.append(f'monday_tickets_by_category{{category="{normalize_label(k)}"}} {v}')

    # técnico
    from collections import Counter
    tech_counter = Counter(by_tech)
    for k, v in tech_counter.items():
        lines.append(f'monday_tickets_by_technician{{technician="{normalize_label(k)}"}} {v}')

    # series por ticket
    lines.extend(series_lines)

    # timestamp scrape
    lines.append(f'# Scrape ts {int(time.time())}')

    body = "\n".join(lines) + "\n"
    return Response(body, mimetype="text/plain")

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=PORT)

