require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs   = require('fs');
const path = require('path');

const { login, humanDelay }                            = require('./scraper/auth');
const { scrapeArticleParagraph, getSnapImage,
        loadState, saveState }                         = require('./scraper/pipeline');
const { uploadToCloudinary }                           = require('./services/cloudinary');
const { postToInstagram }                              = require('./services/instagram');
const { closeBrowser }                                 = require('./scraper/browser');

const LIST_URL  = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Listar';
const TABLE_SEL = '#main_content > div.row > div > form > div:nth-child(1) > table > tbody';

// ── Lê a listagem da página atual (sem navegar) ────────────────

async function readListFromCurrentPage(page) {
  await page.locator(TABLE_SEL).waitFor({ state: 'visible', timeout: 15000 });
  const rows = await page.locator(`${TABLE_SEL} > tr`).all();
  const items = [];

  for (const row of rows) {
    const idEl = row.locator('.label.label-primary2, .label-primary2');
    if ((await idEl.count()) === 0) continue;
    const id = parseInt((await idEl.first().innerText()).trim());
    if (isNaN(id)) continue;
    const aEl = row.locator('td:nth-child(2) a').first();
    if ((await aEl.count()) === 0) continue;
    items.push({
      id,
      title:      (await aEl.innerText()).trim(),
      articleUrl: await aEl.getAttribute('href'),
    });
  }
  return items;
}

// ── Widget flutuante não-bloqueante ────────────────────────────

async function injectFloatingWidget(page, items, processedIds) {
  const processed = new Set(processedIds);

  const rows = items.slice(0, 30).map(i => {
    const done  = processed.has(i.id);
    const title = i.title.length > 42 ? i.title.slice(0, 42) + '…' : i.title;
    const cls   = done ? 'pn-row done' : 'pn-row';
    const badge = done
      ? '<span class="badge ok">✓ postado</span>'
      : '<span class="badge">pendente</span>';
    return `<tr class="${cls}" data-id="${i.id}">
              <td class="tid">${i.id}</td>
              <td class="ttitle">${title}</td>
              <td>${badge}</td>
            </tr>`;
  }).join('');

  await page.evaluate(({ rows }) => {
    if (document.getElementById('__pn')) return;

    /* ── estilos ── */
    const style = document.createElement('style');
    style.textContent = `
      #__pn {
        position: fixed; top: 18px; right: 18px; z-index: 2147483647;
        width: 360px; background: #0d1117; border: 1px solid #30363d;
        border-radius: 12px; box-shadow: 0 16px 48px rgba(0,0,0,.7);
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        color: #e6edf3; font-size: 12px; user-select: none;
        /* Não bloqueia cliques fora do widget */
        pointer-events: auto;
      }
      #__pn-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 10px 14px; cursor: grab; border-bottom: 1px solid #21262d;
        background: #161b22; border-radius: 12px 12px 0 0;
      }
      #__pn-header:active { cursor: grabbing; }
      #__pn-title { font-weight: 700; font-size: 13px; color: #58a6ff; }
      #__pn-toggle { background: none; border: none; color: #8b949e;
        cursor: pointer; font-size: 16px; line-height: 1; padding: 0; }
      #__pn-body { padding: 12px 14px; }
      #__pn-table-wrap { max-height: 220px; overflow-y: auto;
        border: 1px solid #21262d; border-radius: 6px; margin-bottom: 10px; }
      #__pn table { width: 100%; border-collapse: collapse; }
      #__pn thead th { position: sticky; top: 0; background: #161b22;
        padding: 5px 8px; color: #6e7681; font-size: 10px; text-transform: uppercase;
        border-bottom: 1px solid #21262d; }
      #__pn .pn-row td { padding: 5px 8px; border-bottom: 1px solid #161b22; }
      #__pn .pn-row:not(.done) { cursor: pointer; }
      #__pn .pn-row:not(.done):hover td { background: #161b22; }
      #__pn .pn-row.done { opacity: .45; }
      #__pn .tid { font-weight: 700; color: #58a6ff; white-space: nowrap; }
      #__pn .ttitle { color: #c9d1d9; }
      #__pn .badge { font-size: 10px; background: #161b22; color: #8b949e;
        padding: 2px 5px; border-radius: 4px; }
      #__pn .badge.ok { background: #1f6534; color: #3fb950; }
      #__pn-input-row { display: flex; gap: 8px; }
      #__pn-id { flex: 1; padding: 8px 10px; background: #161b22;
        border: 1.5px solid #388bfd; border-radius: 6px; color: #e6edf3;
        font-size: 16px; font-weight: 700; outline: none; }
      #__pn-id:focus { border-color: #58a6ff; }
      #__pn-btn { padding: 8px 14px; background: #238636; border: none;
        border-radius: 6px; color: #fff; font-weight: 700; cursor: pointer; font-size: 12px; }
      #__pn-btn:hover { background: #2ea043; }
      #__pn-btn:disabled { background: #21262d; color: #6e7681; cursor: not-allowed; }
      #__pn-err { color: #f85149; font-size: 11px; margin-top: 6px; min-height: 16px; }
      @keyframes pn-spin { to { transform: rotate(360deg); } }
      #__pn-log-wrap { display: none; }
      #__pn-spinner { display: inline-block; width: 11px; height: 11px;
        border: 2px solid #388bfd; border-top-color: transparent;
        border-radius: 50%; animation: pn-spin .7s linear infinite;
        vertical-align: middle; margin-right: 6px; }
      #__pn-status { font-size: 11px; color: #8b949e; vertical-align: middle; }
      #__pn-log { background: #010409; border: 1px solid #21262d; border-radius: 6px;
        padding: 8px 10px; max-height: 240px; overflow-y: auto; margin-top: 8px;
        font-family: 'SFMono-Regular', Consolas, monospace; font-size: 11px; line-height: 1.7; }
    `;
    document.head.appendChild(style);

    /* ── HTML ── */
    const el = document.createElement('div');
    el.id = '__pn';
    el.innerHTML = `
      <div id="__pn-header">
        <span id="__pn-title">🤖 Painho Pipeline</span>
        <button id="__pn-toggle">▼</button>
      </div>
      <div id="__pn-body">
        <div id="__pn-form-wrap">
          <div style="font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;">
            Listagem — clique para selecionar ID
          </div>
          <div id="__pn-table-wrap">
            <table>
              <thead><tr>
                <th style="width:54px">ID</th><th>Título</th><th style="width:66px">Status</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <div id="__pn-input-row">
            <input id="__pn-id" type="number" placeholder="ID inicial" />
            <button id="__pn-btn">▶ Iniciar</button>
          </div>
          <div id="__pn-err"></div>
        </div>
        <div id="__pn-log-wrap">
          <div>
            <span id="__pn-spinner"></span>
            <span id="__pn-status">Processando...</span>
          </div>
          <div id="__pn-log"></div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    /* ── Toggle colapso ── */
    let collapsed = false;
    document.getElementById('__pn-toggle').onclick = () => {
      collapsed = !collapsed;
      document.getElementById('__pn-body').style.display = collapsed ? 'none' : '';
      document.getElementById('__pn-toggle').textContent = collapsed ? '▲' : '▼';
    };

    /* ── Drag ── */
    const header = document.getElementById('__pn-header');
    let ox = 0, oy = 0, dragging = false;
    header.onmousedown = e => {
      dragging = true; ox = e.clientX - el.offsetLeft; oy = e.clientY - el.offsetTop;
      el.style.right = 'auto';
    };
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      el.style.left = (e.clientX - ox) + 'px';
      el.style.top  = (e.clientY - oy) + 'px';
    });
    document.addEventListener('mouseup', () => { dragging = false; });

    /* ── Clique nas linhas ── */
    document.querySelectorAll('.pn-row:not(.done)').forEach(tr => {
      tr.onclick = () => {
        document.getElementById('__pn-id').value = tr.dataset.id;
        document.getElementById('__pn-err').textContent = '';
      };
    });

    /* ── Submeter ── */
    const errEl = document.getElementById('__pn-err');
    const btn   = document.getElementById('__pn-btn');
    const inp   = document.getElementById('__pn-id');

    const go = async () => {
      const id = inp.value.trim();
      if (!id || isNaN(parseInt(id))) {
        errEl.textContent = 'Digite um ID válido.';
        return;
      }
      btn.disabled = true;
      btn.textContent = '⌛ Verificando...';
      errEl.textContent = '';
      try {
        const res = await window.__painhoStart(id);
        if (res && res.ok) {
          document.getElementById('__pn-form-wrap').style.display = 'none';
          document.getElementById('__pn-log-wrap').style.display  = 'block';
        } else {
          errEl.textContent = (res && res.error) || 'Erro desconhecido.';
          btn.disabled = false;
          btn.textContent = '▶ Iniciar';
        }
      } catch (e) {
        errEl.textContent = e.message;
        btn.disabled = false;
        btn.textContent = '▶ Iniciar';
      }
    };

    btn.onclick = go;
    inp.onkeydown = e => { if (e.key === 'Enter') go(); };
    setTimeout(() => inp.focus(), 100);
  }, { rows });
}

// ── Helpers UI (escrevem no widget) ───────────────────────────

async function uiLog(page, msg, type = 'info') {
  const c = { info: '#8b949e', success: '#3fb950', error: '#f85149', warn: '#e3b341' };
  await page.evaluate(({ msg, color }) => {
    const el = document.getElementById('__pn-log');
    if (!el) return;
    const t = new Date().toLocaleTimeString('pt-BR');
    el.innerHTML += `<div style="color:${color}">[${t}] ${msg}</div>`;
    el.scrollTop = el.scrollHeight;
  }, { msg, color: c[type] || c.info }).catch(() => {});
}

async function uiStatus(page, text) {
  await page.evaluate(t => {
    const el = document.getElementById('__pn-status');
    if (el) el.textContent = t;
  }, text).catch(() => {});
}

async function uiDone(page) {
  await page.evaluate(() => {
    const s = document.getElementById('__pn-spinner');
    if (s) { s.style.animation = 'none'; s.style.borderColor = '#3fb950'; }
  }).catch(() => {});
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n[painho] ▶ Abrindo browser...\n');

  // Login (usa session.json se disponível; se expirou, usuário loga manualmente)
  const page = await login();
  const ctx  = page.context();

  // Expõe bridge JS→Node ANTES de qualquer navegação (persiste nas navegações)
  let resolveId;
  const idReady = new Promise(r => { resolveId = r; });
  let cachedItems = null;

  await page.exposeFunction('__painhoStart', async (idStr) => {
    const id = parseInt(idStr);
    if (!cachedItems) return { ok: false, error: 'Listagem ainda não carregada.' };
    if (isNaN(id) || id <= 0) return { ok: false, error: 'ID inválido.' };
    const found = cachedItems.find(i => i.id === id);
    if (!found) return { ok: false, error: `ID ${id} não encontrado na listagem atual.` };
    resolveId(id);
    return { ok: true };
  });

  // Detecta quando estamos na página de listagem e injeta o widget
  let pipelineStarted = false;

  const tryInject = async () => {
    if (pipelineStarted) return;
    const url = page.url();
    if (!url.includes('p=noticias') || !url.includes('frm=Listar')) return;

    // Verifica se widget já está no DOM (navegação limpa o DOM injetado)
    const hasWidget = await page.evaluate(() => !!document.getElementById('__pn')).catch(() => false);
    if (hasWidget) return;

    console.log('[painho] Listagem detectada — lendo notícias...');
    try {
      cachedItems = await readListFromCurrentPage(page);
      if (cachedItems.length === 0) {
        console.warn('[painho] Tabela vazia ou não autenticado.');
        return;
      }
      const state = loadState();
      await injectFloatingWidget(page, cachedItems, state.processed);
      console.log(`[painho] ${cachedItems.length} notícias. Widget ativo — aguardando ID.`);
    } catch (e) {
      console.error('[painho] Erro ao ler listagem:', e.message);
    }
  };

  // Reinjeta após navegações (ex: user navega pra outra página e volta)
  page.on('load', () => tryInject().catch(() => {}));

  // Verifica imediatamente (se login() já foi pra LIST_URL)
  await tryInject();

  if (!widgetInjected) {
    console.log('[painho] Faça login no CMS e navegue até a listagem de notícias.');
  }

  // Espera o usuário submeter um ID válido
  const startId = await idReady;
  pipelineStarted = true;
  console.log(`\n[painho] ID inicial: ${startId}`);

  // ── Pipeline ────────────────────────────────────────────────

  const state = loadState();
  const toProcess = cachedItems
    .filter(i => i.id >= startId && !state.processed.includes(i.id))
    .sort((a, b) => a.id - b.id);

  await uiStatus(page, 'Iniciando...');
  await uiLog(page, `ID inicial: ${startId} · ${toProcess.length} notícia(s) para processar`);

  if (toProcess.length === 0) {
    await uiLog(page, 'Nenhuma notícia nova nesse intervalo.', 'warn');
    await uiStatus(page, 'Nada para processar.');
    await uiDone(page);
    return;
  }

  let ok = 0, fail = 0;

  for (let i = 0; i < toProcess.length; i++) {
    const item = toProcess[i];
    const pos  = `${i + 1}/${toProcess.length}`;

    await uiStatus(page, `${pos} — ID ${item.id}`);
    await uiLog(page, `── ID ${item.id}: ${item.title.slice(0, 55)}`);
    console.log(`\n[painho] ── ID ${item.id} (${pos})`);

    try {
      await uiLog(page, '  Extraindo parágrafo...');
      const paragraph = await scrapeArticleParagraph(ctx, item.articleUrl);
      await uiLog(page, `  "${paragraph.slice(0, 60)}..."`);

      await uiLog(page, '  Baixando snap 1080×1080...');
      const imagePath = await getSnapImage(ctx, item.id);

      await uiLog(page, '  Subindo Cloudinary...');
      const imageUrl = await uploadToCloudinary(imagePath, `pn_${item.id}`);
      await uiLog(page, `  ${imageUrl.split('/').slice(-2).join('/')}`);
      if (fs.existsSync(imagePath)) fs.unlinkSync(imagePath);

      const caption = `${item.title}\n\n${paragraph}\n\nLink na bio.\n`;
      await uiLog(page, '  Postando no Instagram...');
      const igPost = await postToInstagram(imageUrl, caption);

      state.processed.push(item.id);
      saveState(state);
      ok++;

      await uiLog(page, `  ✅ Publicado! Post: ${igPost.id}`, 'success');
      console.log(`[painho] ✅ ID ${item.id} → ${igPost.id}`);

      if (i < toProcess.length - 1) {
        const wait = 10000 + Math.floor(Math.random() * 8000);
        await uiLog(page, `  Aguardando ${Math.round(wait / 1000)}s...`, 'warn');
        await humanDelay(wait, wait + 500);
      }

    } catch (err) {
      fail++;
      await uiLog(page, `  ❌ ${err.message}`, 'error');
      console.error(`[painho] ❌ ID ${item.id}:`, err.message);
    }
  }

  const summary = `Concluído: ${ok} publicado(s), ${fail} erro(s)`;
  await uiStatus(page, summary);
  await uiLog(page, `🎉 ${summary}`, ok > 0 ? 'success' : 'warn');
  await uiDone(page);
  console.log(`\n[painho] ${summary}\n`);
}

main().catch(async err => {
  console.error('\n[painho] Erro fatal:', err.message);
  await closeBrowser();
  process.exit(1);
});
