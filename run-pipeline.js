require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const fs   = require('fs');
const path = require('path');

const { getContext, saveSession }              = require('./scraper/browser');
const { humanDelay, isLoginPage, performLogin } = require('./scraper/auth');
const { scrapeArticleParagraph, getSnapImage,
        loadState, saveState }                 = require('./scraper/pipeline');
const { uploadToCloudinary, deleteFromCloudinary, pingCloudinary } = require('./services/cloudinary');
const { postToInstagram, getMyAccount }        = require('./services/instagram');

const CMS_URL   = process.env.WEBSG_URL || 'https://primeirasnoticias.com.br/websg/';
const LIST_URL  = 'https://primeirasnoticias.com.br/websg/?p=noticias&frm=Listar';
const TABLE_SEL = '#main_content > div.row > div > form > div:nth-child(1) > table > tbody';

// ── Lê a listagem da página atual (sem navegar) ────────────────

async function readListFromCurrentPage(page) {
  // Espera só o elemento que realmente importa — esperar a rede inteira
  // ficar ociosa (networkidle) trava minutos porque o painel tem widgets
  // com polling em segundo plano que nunca somem de vez.
  await page.locator(TABLE_SEL).waitFor({ state: 'visible', timeout: 20000 });

  // Lê a tabela inteira num único round-trip (page.evaluate) em vez de vários
  // round-trips do Playwright por linha — com muitas notícias na tabela isso
  // sozinho já levava minutos.
  return page.evaluate((sel) => {
    const rows = Array.from(document.querySelectorAll(`${sel} > tr`));
    const items = [];
    for (const row of rows) {
      const idEl = row.querySelector('.label.label-primary2, .label-primary2');
      if (!idEl) continue;
      const id = parseInt(idEl.textContent.trim());
      if (Number.isNaN(id)) continue;
      const aEl = row.querySelector('td:nth-child(2) a');
      if (!aEl) continue;
      items.push({ id, title: aEl.textContent.trim(), articleUrl: aEl.getAttribute('href') });
    }
    return items;
  }, TABLE_SEL);
}

// ── Login automático + navegação até a listagem ────────────────

async function ensureOnListing(page) {
  // 1. Se a página de login apareceu, loga automaticamente com o .env
  if (await isLoginPage(page)) {
    console.log('[painho] Página de login detectada — logando automaticamente...');
    await performLogin(page);

    // Espera alguns segundos até a página logada estabilizar
    await humanDelay(2000, 3500);

    console.log('[painho] ✅ Login OK —', page.url());
    await saveSession().catch(() => {});
  }

  // 2. Se ainda não está na listagem, clica em Gerenciar Notícias no painel
  if (!page.url().includes('frm=Listar')) {
    try {
      const newsLink = page.locator('#widget_boxs > div > div.panel-heading > div > a').first();
      await newsLink.waitFor({ state: 'visible', timeout: 10000 });
      await humanDelay(600, 1200);
      await newsLink.click();
      await page.waitForLoadState('domcontentloaded', { timeout: 15000 }).catch(() => {});
      console.log('[painho] Navegou para listagem:', page.url());
    } catch (_) {
      console.log('[painho] Fallback: indo direto para a listagem');
      await page.goto(LIST_URL, { waitUntil: 'domcontentloaded' }).catch(() => {});
    }
  }
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

    const style = document.createElement('style');
    style.textContent = `
      #__pn {
        position:fixed;top:16px;right:16px;z-index:2147483647;
        width:360px;background:#0d1117;border:1px solid #30363d;
        border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.75);
        font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
        color:#e6edf3;font-size:12px;
      }
      #__pn-hdr {
        display:flex;align-items:center;justify-content:space-between;
        padding:10px 14px;cursor:grab;border-bottom:1px solid #21262d;
        background:#161b22;border-radius:12px 12px 0 0;
      }
      #__pn-hdr:active{cursor:grabbing}
      #__pn-ttl{font-weight:700;font-size:13px;color:#58a6ff}
      #__pn-tog{background:none;border:none;color:#8b949e;cursor:pointer;font-size:14px;padding:0}
      #__pn-body{padding:12px 14px}
      #__pn-twrap{max-height:200px;overflow-y:auto;border:1px solid #21262d;border-radius:6px;margin-bottom:10px}
      #__pn table{width:100%;border-collapse:collapse}
      #__pn thead th{position:sticky;top:0;background:#161b22;padding:5px 8px;
        color:#6e7681;font-size:10px;text-transform:uppercase;border-bottom:1px solid #21262d}
      #__pn .pn-row td{padding:5px 8px;border-bottom:1px solid #161b22}
      #__pn .pn-row:not(.done){cursor:pointer}
      #__pn .pn-row:not(.done):hover td{background:#1c2128}
      #__pn .pn-row.done{opacity:.45}
      #__pn .tid{font-weight:700;color:#58a6ff;white-space:nowrap}
      #__pn .ttitle{color:#c9d1d9}
      .pn-badge{font-size:10px;background:#161b22;color:#8b949e;padding:2px 5px;border-radius:4px}
      .pn-badge.ok{background:#1f6534;color:#3fb950}
      #__pn-irow{display:flex;gap:8px;margin-bottom:6px}
      #__pn-id{flex:1;padding:8px 10px;background:#161b22;border:1.5px solid #388bfd;
        border-radius:6px;color:#e6edf3;font-size:16px;font-weight:700;outline:none}
      #__pn-id:focus{border-color:#58a6ff}
      #__pn-btn{padding:8px 14px;background:#238636;border:none;border-radius:6px;
        color:#fff;font-weight:700;cursor:pointer;font-size:12px}
      #__pn-btn:hover{background:#2ea043}
      #__pn-btn:disabled{background:#21262d;color:#6e7681;cursor:not-allowed}
      #__pn-resume-btn{display:none;width:100%;margin-bottom:8px;padding:8px 10px;
        background:#1f6feb;border:none;border-radius:6px;color:#fff;
        font-weight:700;cursor:pointer;font-size:12px}
      #__pn-resume-btn:hover{background:#388bfd}
      #__pn-resume-btn:disabled{background:#21262d;color:#6e7681;cursor:not-allowed}
      #__pn-err{color:#f85149;font-size:11px;min-height:16px}
      @keyframes pn-spin{to{transform:rotate(360deg)}}
      #__pn-prog{display:none}
      #__pn-sp{display:inline-block;width:11px;height:11px;border:2px solid #388bfd;
        border-top-color:transparent;border-radius:50%;animation:pn-spin .7s linear infinite;vertical-align:middle;margin-right:5px}
      #__pn-st{font-size:11px;color:#8b949e;vertical-align:middle}
      #__pn-log{background:#010409;border:1px solid #21262d;border-radius:6px;
        padding:8px 10px;max-height:250px;overflow-y:auto;margin-top:8px;
        font-family:'SFMono-Regular',Consolas,monospace;font-size:11px;line-height:1.7}
    `;
    document.head.appendChild(style);

    const el = document.createElement('div');
    el.id = '__pn';
    el.innerHTML = `
      <div id="__pn-hdr">
        <span id="__pn-ttl">🤖 Painho Pipeline</span>
        <button id="__pn-tog">▼</button>
      </div>
      <div id="__pn-body">
        <div id="__pn-form">
          <div style="font-size:10px;color:#6e7681;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">
            Clique em uma linha para selecionar o ID inicial
          </div>
          <div id="__pn-twrap">
            <table>
              <thead><tr>
                <th style="width:54px">ID</th><th>Título</th><th style="width:68px">Status</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <button id="__pn-resume-btn">↺ Usar último ID</button>
          <div id="__pn-irow">
            <input id="__pn-id" type="number" placeholder="ID inicial" />
            <button id="__pn-btn">▶ Iniciar</button>
          </div>
          <div id="__pn-hint" style="font-size:11px;color:#8b949e;min-height:16px;margin-bottom:2px"></div>
          <div id="__pn-err"></div>
        </div>
        <div id="__pn-prog">
          <div><span id="__pn-sp"></span><span id="__pn-st">Processando...</span></div>
          <div id="__pn-log"></div>
        </div>
      </div>
    `;
    document.body.appendChild(el);

    /* Toggle */
    let collapsed = false;
    document.getElementById('__pn-tog').onclick = () => {
      collapsed = !collapsed;
      document.getElementById('__pn-body').style.display = collapsed ? 'none' : '';
      document.getElementById('__pn-tog').textContent = collapsed ? '▲' : '▼';
    };

    /* Drag */
    const hdr = document.getElementById('__pn-hdr');
    let dx=0, dy=0, drag=false;
    hdr.onmousedown = e => { drag=true; dx=e.clientX-el.offsetLeft; dy=e.clientY-el.offsetTop; el.style.right='auto'; };
    document.addEventListener('mousemove', e => { if(drag){ el.style.left=(e.clientX-dx)+'px'; el.style.top=(e.clientY-dy)+'px'; } });
    document.addEventListener('mouseup', () => { drag=false; });

    /* Row click → fill input */
    document.querySelectorAll('.pn-row:not(.done)').forEach(tr => {
      tr.onclick = () => {
        document.getElementById('__pn-id').value = tr.dataset.id;
        document.getElementById('__pn-err').textContent = '';
      };
    });

    /* Submit */
    const errEl     = document.getElementById('__pn-err');
    const btn       = document.getElementById('__pn-btn');
    const inp       = document.getElementById('__pn-id');
    const resumeBtn = document.getElementById('__pn-resume-btn');
    const hintEl    = document.getElementById('__pn-hint');

    const setBusy = (busy) => {
      btn.disabled = busy;
      resumeBtn.disabled = busy;
      btn.textContent = busy ? '⌛ Verificando...' : '▶ Iniciar';
    };

    const go = async (idOverride) => {
      if (btn.disabled) return;
      const id = String(idOverride != null ? idOverride : inp.value).trim();
      if (!id || isNaN(parseInt(id))) { errEl.textContent = 'Digite um ID válido.'; return; }
      inp.value = id;
      setBusy(true);
      errEl.textContent = '';
      try {
        const res = await window.__painhoStart(id);
        if (res && res.ok) {
          document.getElementById('__pn-form').style.display = 'none';
          document.getElementById('__pn-prog').style.display  = 'block';
        } else {
          errEl.textContent = (res && res.error) || 'Erro.';
          setBusy(false);
        }
      } catch(e) {
        errEl.textContent = e.message;
        setBusy(false);
      }
    };
    btn.onclick = () => go();
    inp.onkeydown = e => { if(e.key==='Enter') go(); };

    /* Botão "Usar último ID" — processa do ID seguinte ao último publicado
       (guardado no localStorage) até a notícia mais recente da listagem. */
    const lastId = parseInt(localStorage.getItem('painho_last_id'));
    if (!isNaN(lastId)) {
      const nextId = lastId + 1;
      resumeBtn.style.display = '';
      resumeBtn.textContent = `↺ Usar último ID (retomar do ${nextId})`;
      hintEl.textContent = `Última notícia publicada: ID ${lastId}`;
      resumeBtn.onclick = () => go(nextId);
    }

    setTimeout(() => inp.focus(), 120);
  }, { rows });
}

// ── Helpers UI ─────────────────────────────────────────────────

async function uiLog(page, msg, type = 'info') {
  const c = { info:'#8b949e', success:'#3fb950', error:'#f85149', warn:'#e3b341' };
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
    const el = document.getElementById('__pn-st');
    if (el) el.textContent = t;
  }, text).catch(() => {});
}

async function uiDone(page) {
  await page.evaluate(() => {
    const s = document.getElementById('__pn-sp');
    if (s) { s.style.animation='none'; s.style.borderColor='#3fb950'; }
  }).catch(() => {});
}

// ── Main ──────────────────────────────────────────────────────

async function main() {
  console.log('\n[painho] ▶ Verificando credenciais...');

  // Valida Cloudinary
  try {
    await pingCloudinary();
    console.log('[painho] ✅ Cloudinary OK');
  } catch (e) {
    console.error('[painho] ❌ Cloudinary FALHOU:', e.message);
    console.error('[painho] Verifique CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET no .env');
    process.exit(1);
  }

  // Valida Instagram
  try {
    const acc = await getMyAccount();
    console.log(`[painho] ✅ Instagram OK — @${acc.username} (${acc.followers_count} seguidores)`);
  } catch (e) {
    console.error('[painho] ❌ Instagram FALHOU:', e.message);
    console.error('[painho] Verifique INSTAGRAM_USER_ID / INSTAGRAM_ACCESS_TOKEN no .env');
    process.exit(1);
  }

  console.log('\n[painho] ▶ Abrindo browser...');
  console.log('[painho] Login automático com as credenciais do .env (se necessário).');
  console.log('[painho] O widget aparecerá automaticamente na listagem.\n');

  // Abre browser com session.json (se existir); sem sessão, loga sozinho.
  const ctx  = await getContext();
  const page = await ctx.newPage();

  // Expõe bridge JS→Node ANTES de qualquer navegação (persiste entre navegações)
  let resolveId;
  const idReady = new Promise(r => { resolveId = r; });
  let cachedItems     = null;
  let pipelineStarted = false;

  await page.exposeFunction('__painhoStart', async (idStr) => {
    const id = parseInt(idStr);
    if (!cachedItems)          return { ok: false, error: 'Listagem não carregada ainda.' };
    if (isNaN(id) || id <= 0)  return { ok: false, error: 'ID inválido.' };
    // ID funciona como limite inferior (não precisa existir exatamente) —
    // necessário para "Usar último ID", que passa lastId+1, que pode não ser
    // o ID exato de nenhuma notícia caso haja lacunas na numeração.
    const hasAny = cachedItems.some(i => i.id >= id);
    if (!hasAny)               return { ok: false, error: `Nenhuma notícia com ID ≥ ${id} na listagem.` };
    resolveId(id);
    return { ok: true };
  });

  // Detecta a página de listagem e injeta o widget
  let injecting = false;
  const tryInject = async () => {
    // pipelineStarted/injecting evitam trabalho duplicado quando o listener
    // de 'load' dispara em cima da chamada explícita feita logo após
    // ensureOnListing() (ambas podem disparar quase ao mesmo tempo)
    if (pipelineStarted || injecting) return;
    const url = page.url();
    if (!url.includes('p=noticias') || !url.includes('frm=Listar')) return;

    // Não reinjetar se widget já está no DOM
    const hasWidget = await page.evaluate(() => !!document.getElementById('__pn')).catch(() => false);
    if (hasWidget) return;

    injecting = true;
    console.log('[painho] Listagem detectada — lendo notícias...');
    try {
      // readListFromCurrentPage já espera o elemento certo ficar visível —
      // não precisa esperar a rede inteira ficar ociosa antes disso.
      cachedItems = await readListFromCurrentPage(page);
      if (cachedItems.length === 0) {
        console.warn('[painho] Tabela vazia ou acesso negado.');
        return;
      }
      await saveSession().catch(() => {});
      const state = loadState();
      await injectFloatingWidget(page, cachedItems, state.processed);
      console.log(`[painho] ${cachedItems.length} notícias encontradas. Widget ativo.`);
    } catch (e) {
      console.error('[painho] Erro ao ler listagem:', e.message);
    } finally {
      injecting = false;
    }
  };

  // Debounce: aguarda 1.2s após o load antes de tentar injetar
  // Evita chamar durante cadeia de redirecionamentos
  let injectTimer = null;
  page.on('load', () => {
    clearTimeout(injectTimer);
    injectTimer = setTimeout(() => tryInject().catch(() => {}), 1200);
  });

  // Abre CMS — usa session.json automaticamente se válida
  await page.goto(CMS_URL, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await humanDelay(500, 1000);

  // Login automático + clique em Gerenciar Notícias até chegar na listagem
  await ensureOnListing(page);

  // Verifica imediatamente (se sessão válida → pode já estar na listagem)
  await tryInject();

  // Aguarda o usuário submeter um ID válido (SEM timeout)
  const startId = await idReady;
  pipelineStarted = true;
  console.log(`\n[painho] ID inicial: ${startId}`);

  // ── Pipeline ────────────────────────────────────────────────

  const state = loadState();
  const toProcess = cachedItems
    .filter(i => i.id >= startId && !state.processed.includes(i.id))
    .sort((a, b) => a.id - b.id);

  await uiStatus(page, 'Iniciando...');
  await uiLog(page, `ID ${startId} → ${toProcess.length} notícia(s) para processar`);

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
    await uiLog(page, `── ID ${item.id}: ${item.title.slice(0, 52)}`);
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

      // Remove do Cloudinary após publicar (mantém plano gratuito)
      await deleteFromCloudinary(`primeirasnoticias/pn_${item.id}`)
        .then(r  => console.log(`[painho] Cloudinary deletado: ${r}`))
        .catch(e => console.warn('[painho] Falha ao deletar Cloudinary:', e.message));

      state.processed.push(item.id);
      saveState(state);

      // Guarda o último ID processado no localStorage (persiste via session.json)
      await page.evaluate(id => localStorage.setItem('painho_last_id', String(id)), item.id).catch(() => {});
      await saveSession().catch(() => {});
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

// NÃO fecha o browser em caso de erro — usuário pode ver o estado
main().catch(err => {
  console.error('\n[painho] Erro fatal:', err.message);
  console.error('[painho] Browser mantido aberto para diagnóstico.');
  process.exit(1);
});
