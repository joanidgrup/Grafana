# Monday → GitHub JSON Export

Exporta items de un tablero de Monday.com a un archivo JSON dentro del repositorio, mediante GitHub Actions.

## Requisitos
- Token de API de Monday (`MONDAY_API_TOKEN`).
- ID del tablero (`MONDAY_BOARD_ID`).

## Configuración
1. Crea los **Secrets** del repositorio:
   - `MONDAY_API_TOKEN`
   - `MONDAY_BOARD_ID`
2. (Opcional) Crea **Variables** del repositorio:
   - `OUTPUT_PATH` (ej. `data/monday_tickets.json`)
   - `MONDAY_MAX_ITEMS` (por defecto 5000)
   - `COLUMN_MAPPING_JSON` con un JSON de mapeo (ver `config/column_mapping.example.json`).
3. Revisa el workflow en `.github/workflows/monday-export.yml`.

## Ejecución
- Manual: pestaña **Actions** → *Export Monday tickets to JSON* → **Run workflow**.
- Automática: hay un **cron** diario (04:00 UTC) editable.

## Desarrollo local
```bash
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\\Scripts\\activate
pip install -r scripts/requirements.txt
export MONDAY_API_TOKEN=xxxxx
export MONDAY_BOARD_ID=1234567890
python scripts/export_monday_to_json.py
