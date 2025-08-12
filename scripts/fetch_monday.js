#!/usr/bin/env node
'use strict';
const BOARD_ID = process.env.MONDAY_BOARD_ID || '1587958550';
const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPO = process.env.GITHUB_REPO; // ej: "usuario/mi-repo"
const GITHUB_PATH = process.env.GITHUB_PATH || 'tickets.json';

function requireEnv(name, value) {
  if (!value || String(value).trim() === '') {
    throw new Error(`Falta variable de entorno ${name}`);
  }
}

function toIsoNow() {
  return new Date().toISOString();
}

async function mondayFetchItems(boardId, limit = 500) {
  const query = `
    query {
      boards(ids: [${boardId}]) {
        id
        name
        items(limit: ${limit}) {
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
  `;

  const res = await fetch('https://api.monday.com/v2', {
    method: 'POST',
    headers: {
      'Authorization': MONDAY_API_KEY,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Error HTTP Monday ${res.status}: ${txt}`);
  }

  const data = await res.json();
  if (data.errors) {
    throw new Error(`Errores GraphQL Monday: ${JSON.stringify(data.errors)}`);
  }

  const boards = data?.data?.boards ?? [];
  if (!boards.length) return [];
  return boards[0]?.items ?? [];
}

function normalizeItems(items, topN = 50) {
  const parseDate = (s) => {
    try { return new Date(s).getTime() || 0; } catch { return 0; }
  };

  const itemsSorted = [...items].sort((a, b) => parseDate(b.created_at) - parseDate(a.created_at));
  const picked = itemsSorted.slice(0, topN);

  return picked.map((it) => {
    const cvs = Array.isArray(it.column_values) ? it.column_values : [];
    const byId = {};
    const byTitle = {};
    for (const c of cvs) {
      const id = (c?.id ?? '').toString();
      const title = (c?.title ?? '').toString().trim();
      const text = (c?.text ?? '') || '';
      if (id) byId[id] = text;
      if (title) byTitle[title] = text;
    }
    return {
      id: it.id,
      name: it.name,
      created_at: it.created_at,
      updated_at: it.updated_at,
      columns_by_id: byId,
      columns_by_title: byTitle
    };
  });
}

async function githubGetFileSha(repo, path, token) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const res = await fetch(url, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'fetch_monday-script'
    }
  });

  if (res.status === 404) return null; // no existe
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Error consultando GitHub (${res.status}): ${txt}`);
  }

  const json = await res.json();
  return json.sha || null;
}

async function githubPutFile(repo, path, token, contentBytes, message, sha = null) {
  const url = `https://api.github.com/repos/${repo}/contents/${encodeURIComponent(path)}`;
  const body = {
    message,
    content: Buffer.from(contentBytes).toString('base64')
  };
  if (sha) body.sha = sha;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'fetch_monday-script',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Error subiendo a GitHub (${res.status}): ${txt}`);
  }
  return res.json();
}

async function main() {
  try {
    requireEnv('MONDAY_API_KEY', MONDAY_API_KEY);
    requireEnv('GITHUB_TOKEN', GITHUB_TOKEN);
    requireEnv('GITHUB_REPO', GITHUB_REPO);

    console.log(`→ Obteniendo items de Monday (board ${BOARD_ID})...`);
    const items = await mondayFetchItems(BOARD_ID, 500);

    const normalized = normalizeItems(items, 50);
    const payload = {
      exported_at: toIsoNow(),
      board_id: Number(BOARD_ID),
      count_total_fetched: items.length,
      count_exported: normalized.length,
      items: normalized
    };

    const jsonPretty = JSON.stringify(payload, null, 2);

    console.log('→ Consultando existencia de archivo en GitHub...');
    const sha = await githubGetFileSha(GITHUB_REPO, GITHUB_PATH, GITHUB_TOKEN);

    console.log(`→ Subiendo a GitHub: ${GITHUB_REPO}/${GITHUB_PATH} ...`);
    const message = `Export Monday last 50 tickets (${toIsoNow()})`;
    const res = await githubPutFile(GITHUB_REPO, GITHUB_PATH, GITHUB_TOKEN, Buffer.from(jsonPretty, 'utf-8'), message, sha);

    const url = res?.content?.html_url || '(sin URL)';
    console.log(`✅ Exportación completa. Archivo en GitHub: ${url}`);
  } catch (err) {
    console.error('❌ Error:', err?.message || err);
    process.exit(1);
  }
}

main();
