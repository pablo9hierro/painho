// Painho: servidor local + janelinha de app (sem CMD, sem aba de navegador comum).
// Dois fluxos, cada um com seu botão no painel:
//   1) Pautas → Site:    busca notícias, a IA reescreve, o robô cadastra no WEBSG (Revisão ou Publicado)
//   2) Site → Instagram: pega o que já está no WEBSG e posta no Instagram
// Todo estado fica em ARQUIVOS ao lado do programa (não no navegador): publicadas.json e dados/*.json.
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const websg = require('./websg');
const moldura = require('./moldura');
const { uploadToCloudinary, uploadVideoToCloudinary, deleteFromCloudinary } = require('./services/cloudinary');
const { postToInstagram, postReelToInstagram } = require('./services/instagram');
const pauta = require('./pauta');
const redator = require('./redator');
const ranking = require('./ranking');
const { cadastrar } = require('./websg_postar');
const desempenho = require('./desempenho');
const painhoHierro = require('./painho_hierro');

const PORT = process.env.PORT || 3001;
const DADOS = path.join(__dirname, 'dados');
fs.mkdirSync(DADOS, { recursive: true });
const STATE_FILE = path.join(__dirname, 'publicadas.json');        // Instagram: IDs já postados
const PAUTAS_FILE = path.join(DADOS, 'pautas.json');               // pautas coletadas (+ reescrita da IA)
const ENVIADAS_FILE = path.join(DADOS, 'enviadas_websg.json');     // pautas já cadastradas no WEBSG (por URL da fonte)

const lerJson = (f, padrao) => { try { return JSON.parse(fs.readFileSync(f, 'utf-8')); } catch { return padrao; } };
const gravar = (f, v) => fs.writeFileSync(f, JSON.stringify(v, null, 2));
const loadPosted = () => new Set(lerJson(STATE_FILE, []));
const markPosted = (id) => { const s = loadPosted(); s.add(id); fs.writeFileSync(STATE_FILE, JSON.stringify([...s])); };
const loadPautas = () => lerJson(PAUTAS_FILE, []);
const loadEnviadas = () => lerJson(ENVIADAS_FILE, {});
// Acha a pauta local (com o que a IA escreveu: minititulo, palavras_chave...) a partir do ID real do WEBSG.
// Matérias que não passaram pela nossa esteira (cadastradas por fora) não têm registro — devolve null.
function pautaReal(websgId) {
  const enviadas = loadEnviadas();
  const url = Object.keys(enviadas).find((u) => enviadas[u].websgId === websgId);
  return url ? loadPautas().find((p) => p.url === url) || null : null;
}

const job = { running: false, tipo: '', log: [], summary: '' };
const log = (msg, type = 'info') => job.log.push({ t: new Date().toLocaleTimeString('pt-BR'), msg, type });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Passo de navegador que falha porque o navegador interno fechou: reinicia e tenta UMA vez de novo (só para passos que não publicam nada).
async function comRetry(fn) {
  try { return await fn(); }
  catch (e) { if (!/has been closed|Target (page|closed)|browser has been closed/i.test(e.message)) throw e; log('  🔄 o navegador interno fechou — reiniciando e tentando de novo...', 'warn'); await websg.stop(); return await fn(); }
}
// Trava ANTES de qualquer await: dois cliques rápidos não podem disparar duas rodadas ao mesmo tempo (duplicaria posts).
function tentarIniciar(tipo, res) {
  if (job.running) { res.status(409).json({ error: 'Já existe uma tarefa em andamento. Aguarde terminar.' }); return false; }
  job.running = true; Object.assign(job, { tipo, log: [], summary: '' });
  return true;
}
const terminar = (resumo, ok) => { job.summary = resumo; log(`🎉 ${resumo}`, ok ? 'success' : 'warn'); job.running = false; };

// ══ FLUXO 2: Site → Instagram ═══════════════════════════════════════
// Legenda do Instagram tem limite de 2200 caracteres (erro 36004 se passar).
// Sem título aqui — o título já está na moldura (imagem). A legenda começa direto no 1º parágrafo.
function buildCaption(title, paragraph, pauta) {
  // Hashtags reais da matéria (a IA já gerou olhando título/corpo/links, ver redator.js) + peso histórico de
  // desempenho (desempenho.js) pra ordenar. Sem pauta local (matéria fora da nossa esteira), cai no extrator
  // genérico de palavra-chave do próprio desempenho.js.
  const tags = desempenho.gerarHashtags(pauta || { titulo: title, portal: '-', cidade: '-', categoria: '-' });
  const suffix = `\n\nLink na bio.\n${tags.join(' ')}`;
  const max = 2200 - suffix.length;
  return `${paragraph.length > max ? paragraph.slice(0, max) + '...' : paragraph}${suffix}`;
}

async function runInstagram(items, ids) {
  let ok = 0, fail = 0;
  const todo = items.filter((i) => ids.includes(i.id)).sort((a, b) => a.id - b.id);
  websg.setLog((m) => log('  ' + m, 'warn'));
  log(`${todo.length} notícia(s) selecionada(s)`);
  for (const [n, it] of todo.entries()) {
    log(`── ${n + 1}/${todo.length} · ID ${it.id}: ${it.title.slice(0, 55)}`);
    let foto, img;
    try {
      // 1º a imagem: sem imagem não há postagem, então nem gasta tempo buscando o texto
      log('  buscando a foto e os dados da matéria...');
      const meta = await comRetry(() => websg.articleMeta(it.articleUrl));
      if (!meta.imagem) throw new Error('a matéria não tem imagem principal (og:image)');
      foto = path.join(os.tmpdir(), `foto_${it.id}_${Date.now()}.jpg`);
      fs.writeFileSync(foto, await comRetry(() => websg.baixarBinario(meta.imagem, it.articleUrl)));
      log('  buscando o texto da notícia...');
      const paragraph = await comRetry(() => websg.articleParagraph(it.articleUrl));
      // Título/subtítulo/mini título EXATAMENTE como estão cadastrados no WEBSG — mesma fonte usada no site
      // e no Instagram, pra nunca divergir entre os dois (nem um acento diferente).
      log('  lendo título/subtítulo/mini título do cadastro...');
      const campos = await comRetry(() => websg.camposCadastro(it.id));
      const titulo = campos.titulo || it.title;
      const pautaCache = pautaReal(it.id);
      const minititulo = campos.minititulo || pautaCache?.ia?.minititulo || null;
      const subtitulo = campos.subtitulo || pautaCache?.ia?.subtitulo || null;
      log('  gerando a moldura 1080×1080...');
      img = path.join(os.tmpdir(), `painho_${it.id}_${Date.now()}.jpg`);
      await moldura.compor({ fotoPath: foto, titulo, minititulo, subtitulo, saida: img });
      log('  enviando ao Cloudinary...');
      const url = await uploadToCloudinary(img, `pn_${it.id}`);
      log('  postando no Instagram...');
      const post = await postToInstagram(url, buildCaption(titulo, paragraph, pautaCache), (msg) => log(`  ⏳ ${msg}`, 'warn'));
      await deleteFromCloudinary(`primeirasnoticias/pn_${it.id}`).catch(() => {});
      markPosted(it.id); ok++; // grava na hora — sobrevive a fechar o app, crash, o que for
      log(`  ✅ publicado (post ${post.id})`, 'success');
      if (n < todo.length - 1) await sleep(10000 + Math.random() * 8000); // rate limit do Instagram
    } catch (e) {
      fail++; log(`  ❌ ${e.message}`, 'error');
    } finally { if (foto) fs.rmSync(foto, { force: true }); if (img) fs.rmSync(img, { force: true }); }
  }
  await websg.stop();
  terminar(`Concluído: ${ok} publicado(s), ${fail} erro(s)`, ok > 0);
}

// ══ FLUXO 1: Pautas → Site ══════════════════════════════════════════
// Interesse editorial (IA) das pautas que ainda não têm nota: 1 chamada para a lista toda (~R$ 0,002).
async function avaliarPautas(todas) {
  try {
    const c0 = redator.custoTotal().usd;
    const r = await ranking.avaliarInteresse(todas, loadEnviadas());
    if (r.avaliadas) { gravar(PAUTAS_FILE, todas); log(`⭐ IA avaliou o interesse de ${r.avaliadas} pautas (R$ ${((redator.custoTotal().usd - c0) * 5.19).toFixed(4)})`); }
  } catch (e) { log(`⚠ não consegui a avaliação de interesse da IA (${e.message}) — a escolha usa só os critérios objetivos`, 'warn'); }
}

async function runColeta(opts = {}) {
  pauta.setLog((...a) => log('  ' + a.join(' ')));
  if (opts.palavrasChave?.length) log(`🔎 Buscando pautas pelas palavras-chave: ${opts.palavrasChave.join(', ')}...`);
  else log(`🔎 Buscando pautas: Google News (${opts.cidades?.length ? opts.cidades.join(', ') : 'todas as cidades'}), WSCOM e Currents...`);
  const novas = await pauta.coletar(opts);
  const antigas = new Map(loadPautas().map((p) => [p.url, p]));
  novas.forEach((p) => { const o = antigas.get(p.url); if (o) { if (o.ia) p.ia = o.ia; if (o.interesse) p.interesse = o.interesse; } }); // não paga de novo pela IA
  gravar(PAUTAS_FILE, novas);
  await avaliarPautas(novas);
  const enviadas = loadEnviadas();
  const esc = ranking.escolher(novas, enviadas, { max: 30 }).escolhidas.size;
  terminar(`${novas.length} pautas encontradas · escolhi as ${esc} melhores (marcadas abaixo)`, true);
}

async function runAvaliar() {
  log('⭐ Escolhendo as melhores pautas...');
  await avaliarPautas(loadPautas());
  const esc = ranking.escolher(loadPautas(), loadEnviadas(), { max: 30 }).escolhidas.size;
  terminar(`${esc} pautas escolhidas`, true);
}

async function runSite(ids, publicar) {
  const todas = loadPautas(), enviadas = loadEnviadas();
  const limite = todas.filter((p) => p.paragrafos.length >= 4).length >= 10 ? redator.limiteDe(todas) : 30;
  const modo = publicar ? 'PUBLICADO (vai pro ar)' : 'REVISÃO (não vai pro ar)';
  log(`${ids.length} pauta(s) → WEBSG como ${modo}`);
  websg.setLog((m) => log('  ' + m, 'warn'));
  log('🔐 conferindo o acesso ao WEBSG antes de gastar com a IA...');
  try { const pg = await websg.abrirAutenticada(websg.BASE + '?p=noticias&frm=Formulario', '#titulo'); await pg.close(); }
  catch (e) { await websg.stop(); return terminar('Parei antes de começar (nada foi gasto com a IA): ' + e.message, false); }
  let ok = 0, fail = 0, seguidas = 0; // seguidas = falhas de WEBSG em sequência
  for (const [n, id] of ids.entries()) {
    const p = todas.find((x) => x.id === id);
    if (!p) { log(`── pauta ${id} não encontrada`, 'error'); fail++; continue; }
    log(`── ${n + 1}/${ids.length} · ${p.cidade} · ${p.portal}: ${p.titulo.slice(0, 55)}`);
    if (enviadas[p.url]) { log(`  ↷ já enviada antes (#${enviadas[p.url].websgId}) — pulei para não duplicar`, 'warn'); continue; }
    try {
      if (!p.ia) {
        if (p.paragrafos.length < 3) throw new Error('a fonte não trouxe texto suficiente para escrever a matéria');
        log('  ✍️ IA escrevendo a matéria (e avaliando a "cara de IA")...');
        p.ia = await redator.escreverPauta(p, todas, { limite });
        gravar(PAUTAS_FILE, todas);
        const a = p.ia;
        log(`  ✍️ "${a.titulo}" · nota IA ${a.deteccao.final}/100 · ${a.deteccao.rodadas} rodada(s) · R$ ${(a.custo_usd * 5.19).toFixed(4)}${a.links_usados.length ? ' · ' + a.links_usados.length + ' link(s) da fonte mantido(s)' : ''}`);
      }
      const a = p.ia;
      if (a.avisos && a.avisos.length) log(`  ⚠ na reescrita há números/nomes que não aparecem na fonte: ${a.avisos.slice(0, 4).join(', ')}`, 'warn');
      if (a.deteccao.final > limite) log(`  ⚠ o texto ainda tem "cara de IA" (nota ${a.deteccao.final}, ideal até ${limite}) — vale revisar`, 'warn');
      log('  📤 cadastrando no WEBSG...');
      const r = await cadastrar(p, { publicar });
      // cidade/portal/categoria/palavras_chave gravados aqui pra sempre — pautas.json é sobrescrito a cada busca
      // nova, então na hora de sincronizar desempenho (36h depois) a pauta original quase sempre já sumiu de lá.
      enviadas[p.url] = {
        websgId: r.websgId, status: r.status, titulo: a.titulo, url: r.url, quando: new Date().toISOString(),
        ultimoViewsVisto: 0, registradoDesempenho: true,
        cidade: p.cidade, portal: p.portal, categoria: a.categoria, palavrasChave: a.palavras_chave,
      };
      gravar(ENVIADAS_FILE, enviadas); // grava na hora
      desempenho.registrar(p);
      ok++; seguidas = 0; log(`  ✅ cadastrada: #${r.websgId} (${r.status})${r.url ? ' ' + r.url : ''}`, 'success');
      if (n < ids.length - 1) await sleep(3000); // respiro entre matérias
    } catch (e) {
      fail++; log(`  ❌ ${e.message}`, 'error');
      seguidas = /^WEBSG:/.test(e.message) ? seguidas + 1 : 0;
      if (seguidas >= 3) { log('⛔ O WEBSG falhou 3 vezes seguidas: parei para não gastar IA à toa. As matérias já escritas ficaram salvas; é só clicar em publicar de novo.', 'error'); break; }
    }
  }
  await websg.stop();
  const t = redator.custoTotal();
  terminar(`Concluído: ${ok} cadastrada(s), ${fail} erro(s) · custo da IA nesta sessão: R$ ${(t.usd * 5.19).toFixed(3)}`, ok > 0);
}

// ══ API ═════════════════════════════════════════════════════════════
const app = express();
app.use(cors()); // o editor mobile (painho-mobile, roda em outra porta/origem no navegador) precisa chamar essa API
app.use(express.json());
app.get('/', (_, res) => res.sendFile(path.join(__dirname, 'panel.html')));

// Publica um Reel vindo do editor mobile (painho-mobile): recebe o vídeo já com a moldura queimada (exportado
// no próprio navegador) + legenda + collabs, sobe pro Cloudinary e publica no Instagram de verdade.
const uploadReel = multer({ dest: path.join(os.tmpdir(), 'painho-reels'), limits: { fileSize: 200 * 1024 * 1024 } });
app.post('/api/publish-reel', uploadReel.single('video'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'nenhum vídeo enviado (campo "video")' });
  const caption = req.body.caption || '';
  let collaborators = [];
  try { collaborators = req.body.collaborators ? JSON.parse(req.body.collaborators) : []; } catch { /* ignora, segue sem collab */ }
  try {
    const videoUrl = await uploadVideoToCloudinary(req.file.path, `reel_${Date.now()}`);
    const result = await postReelToInstagram(videoUrl, caption, collaborators);
    res.json({ ok: true, postId: result.id, videoUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  } finally {
    fs.unlink(req.file.path, () => {}); // limpa o arquivo temporário do upload, deu certo ou não
  }
});

const mediana = (nums) => { const s = [...nums].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0; };

// Instagram
// Fila de pendentes: só elegível pra Instagram quem tem 3h+ de publicada E engajamento (views/hora) na metade
// de cima da mediana do próprio grupo (categoria) entre as que também já têm 3h+ — comparação ao vivo com o
// que está listado agora, sem precisar de histórico guardado. Sem dado de data (matéria fora da esteira),
// elegivelInstagram fica null — nunca penaliza o que não dá pra medir (mesmo princípio do desempenho.js).
app.get('/api/list', async (_, res) => {
  try {
    const posted = loadPosted();
    const items = await websg.listNews();
    const comIdade = items.map((i) => {
      const idadeHoras = i.publicadoEm ? (Date.now() - new Date(i.publicadoEm)) / 36e5 : null;
      return { ...i, idadeHoras };
    });
    const porCategoria = {};
    comIdade.forEach((i) => {
      if (i.idadeHoras != null && i.idadeHoras >= 3 && i.views != null) {
        (porCategoria[i.categoria] ||= []).push(i.views / i.idadeHoras);
      }
    });
    const medianaPorCategoria = {};
    for (const [cat, taxas] of Object.entries(porCategoria)) medianaPorCategoria[cat] = mediana(taxas);

    res.json(comIdade.map((i) => {
      let elegivelInstagram = null;
      if (i.idadeHoras != null && i.views != null) {
        const med = medianaPorCategoria[i.categoria] || 0;
        elegivelInstagram = i.idadeHoras >= 3 && (med === 0 || (i.views / i.idadeHoras) >= med * 0.6);
      }
      return { ...i, posted: posted.has(i.id), elegivelInstagram };
    }));
  } catch (e) { res.status(500).json({ error: e.message }); }
});
app.post('/api/start', async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nenhum ID pra publicar.' });
  if (!tentarIniciar('instagram', res)) return;
  try {
    const items = await websg.listNews();
    runInstagram(items, ids).catch((e) => { log(`Erro fatal: ${e.message}`, 'error'); job.running = false; });
    res.json({ ok: true });
  } catch (e) { job.running = false; res.status(500).json({ error: e.message }); }
});

// Pautas → Site
app.get('/api/pautas', (_, res) => {
  const enviadas = loadEnviadas(), todas = loadPautas();
  const { escolhidas, notas, dupDe } = ranking.escolher(todas, enviadas, { max: 30 });
  const lista = todas.map((p) => ({
    dup_de: dupDe.get(p.id) || null, escolhida: escolhidas.has(p.id), nota_pauta: notas.get(p.id).nota, motivos: notas.get(p.id).motivos, avaliada: notas.get(p.id).avaliada,
    id: p.id, cidade: p.cidade, portal: p.portal, titulo: p.titulo, imagem: p.imagem, publicado: p.publicado, categoria: p.categoria,
    texto_completo: p.texto_completo, links: (p.links || []).length,
    ia: p.ia ? { titulo: p.ia.titulo, nota: p.ia.deteccao.final, avisos: (p.ia.avisos || []).length, links: p.ia.links_usados.length } : null,
    enviada: enviadas[p.url] || null,
  }));
  lista.sort((a, b) => b.nota_pauta - a.nota_pauta); // as melhores primeiro
  // Se alguma pauta bateu nota 100 (máxima), só essas aparecem — descarta todo o resto. Sem nenhuma 100, mostra a lista normal.
  const cemEstrelas = lista.filter((p) => p.nota_pauta >= 100);
  res.json(cemEstrelas.length ? cemEstrelas : lista);
});
// Preview de uma pauta: tudo que foi capturado + por que foi escolhida + mesma notícia em outros portais + análise prévia (se já feita)
app.get('/api/pautas/:id', (req, res) => {
  const todas = loadPautas(), enviadas = loadEnviadas(), id = +req.params.id;
  redator.ajustarCorpus(todas);
  const p = todas.find((x) => x.id === id);
  if (!p) return res.status(404).json({ error: 'Pauta não encontrada. Busque as pautas de novo.' });
  const { escolhidas, notas, dupDe } = ranking.escolher(todas, enviadas, { max: 30 });
  const iguais = todas.filter((o) => o.id !== p.id && redator.mesmoFato(p, o)).map((o) => ({ id: o.id, portal: o.portal, titulo: o.titulo, url: o.url }));
  res.json({ ...p, nota_pauta: notas.get(id).nota, motivos: notas.get(id).motivos, escolhida: escolhidas.has(id), dup_de: dupDe.get(id) || null, iguais, enviada: enviadas[p.url] || null });
});
// Exclui pautas capturadas (nunca as já enviadas ao WEBSG — essas ficam de memória mesmo se pedirem).
app.post('/api/pautas/excluir', (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  const enviadas = loadEnviadas();
  const todas = loadPautas();
  const restantes = todas.filter((p) => !ids.includes(p.id) || enviadas[p.url]);
  gravar(PAUTAS_FILE, restantes);
  res.json({ ok: true, removidas: todas.length - restantes.length });
});
app.post('/api/pautas/avaliar', (req, res) => {
  if (!tentarIniciar('ranking', res)) return;
  res.json({ ok: true });
  runAvaliar().catch((e) => { log(`❌ ${e.message}`, 'error'); job.running = false; });
});
app.post('/api/pautas/coletar', (req, res) => {
  if (!tentarIniciar('coleta', res)) return;
  res.json({ ok: true });
  const opts = {
    cidades: Array.isArray(req.body?.cidades) ? req.body.cidades.filter((c) => typeof c === 'string') : undefined,
    palavrasChave: Array.isArray(req.body?.palavrasChave) ? req.body.palavrasChave.filter((c) => typeof c === 'string') : undefined,
    apenasLongas: !!req.body?.apenasLongas,
  };
  runColeta(opts).catch((e) => { log(`❌ ${e.message}`, 'error'); job.running = false; });
});
app.post('/api/pautas/enviar', (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ error: 'Nenhuma pauta selecionada.' });
  if (!tentarIniciar('site', res)) return;
  res.json({ ok: true });
  runSite(ids, req.body.publicar === true).catch((e) => { log(`❌ ${e.message}`, 'error'); job.running = false; });
});
app.get('/api/status', (_, res) => res.json(job));

// ── Desempenho: sincroniza views reais do WEBSG e devolve o ranking (sem IA, sob demanda) ──
// Só faz sentido medir desempenho depois que a matéria teve tempo de circular: antes de 36h o número de
// views ainda não diz nada sobre o desempenho real dela (a maior parte do tráfego de uma notícia é nas
// primeiras horas, e medir cedo demais distorceria o peso aprendido pra sempre).
const HORAS_MIN_ANTES_DE_MEDIR = 36;
async function runSincronizarDesempenho() {
  const todas = loadPautas(), enviadas = loadEnviadas();
  const maduras = Object.entries(enviadas).filter(([, info]) => (Date.now() - new Date(info.quando).getTime()) / 36e5 >= HORAS_MIN_ANTES_DE_MEDIR);
  const aindaCedo = Object.keys(enviadas).length - maduras.length;
  log(`🔄 sincronizando desempenho de ${maduras.length} matéria(s) com ${HORAS_MIN_ANTES_DE_MEDIR}h+ desde a publicação${aindaCedo ? ` (${aindaCedo} ainda cedo demais, puladas)` : ''}...`);
  let atualizadas = 0;
  for (const [url, info] of maduras) {
    // Fonte primária: o que foi gravado no cadastro (sempre existe). O cache de pautas.json (sobrescrito a cada
    // busca nova) só serve de reserva pra matérias cadastradas antes dessa correção, que ainda não têm os
    // campos salvos em `info` — sem isso, a sincronização de views nunca grava nada (bug real, achado 2026-10-06).
    const cache = todas.find((x) => x.url === url);
    const p = info.cidade
      ? { url, cidade: info.cidade, portal: info.portal, ia: { categoria: info.categoria, palavras_chave: info.palavrasChave } }
      : cache;
    if (!p) { log(`  — #${info.websgId}: sem dados suficientes pra sincronizar (matéria antiga, sem registro completo)`, 'warn'); continue; }
    if (!info.registradoDesempenho) { desempenho.registrar(p); info.registradoDesempenho = true; } // matéria de antes dessa função existir
    try {
      const views = await websg.buscarViews(info.websgId);
      if (views == null) { log(`  — #${info.websgId}: não encontrada no WEBSG (pode ter sido apagada)`, 'warn'); continue; }
      const anterior = info.ultimoViewsVisto || 0;
      if (views > anterior) {
        desempenho.atualizarComAcessos(p, views, anterior);
        info.ultimoViewsVisto = views; atualizadas++;
        log(`  #${info.websgId}: ${anterior} → ${views} views (+${views - anterior})`);
      }
    } catch (e) { log(`  #${info.websgId}: ${e.message}`, 'error'); }
  }
  gravar(ENVIADAS_FILE, enviadas);
  await websg.stop();
  terminar(`${atualizadas} matéria(s) com views novas · ${maduras.length} conferida(s)${aindaCedo ? ` · ${aindaCedo} aguardando completar ${HORAS_MIN_ANTES_DE_MEDIR}h` : ''}`, true);
}
app.post('/api/desempenho/sincronizar', (req, res) => {
  if (!tentarIniciar('desempenho', res)) return;
  res.json({ ok: true });
  runSincronizarDesempenho().catch((e) => { log(`❌ ${e.message}`, 'error'); job.running = false; });
});
app.get('/api/desempenho', (_, res) => {
  const comIa = loadPautas().filter((p) => p.ia);
  res.json(desempenho.relatorio(comIa));
});

// ── Painho Hierro: avaliação periódica (SWOT, metas, sugestões de A/B e estilo) a cada ~5 dias ──
app.get('/api/painho-hierro', (_, res) => res.json({ historico: painhoHierro.historico(), precisaRodar: painhoHierro.precisaRodar() }));
app.post('/api/painho-hierro/gerar', async (req, res) => {
  try { res.json(await painhoHierro.gerarRelatorio({ forcar: true })); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

// ══ Janelinha do app ═════════════════════════════════════════════════
function openMiniWindow(url) {
  // Janelinha de app: sem barra de endereço, sem abas — não é uma aba de navegador comum.
  const candidates = process.platform === 'win32'
    ? [
        `${process.env['ProgramFiles']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
        `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
        `${process.env['ProgramFiles']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]
    : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
    : ['google-chrome', 'chromium-browser', 'microsoft-edge'];
  const bin = candidates.find((p) => { try { return fs.existsSync(p); } catch { return false; } }) || candidates[candidates.length - 1];
  // --user-data-dir PRÓPRIO (isolado do Chrome pessoal). Continua um processo de navegador próprio, então dá
  // pra saber quando ESSA janela fechou e desligar o servidor junto (sem deixar processo zumbi).
  const profile = path.join(os.tmpdir(), 'painho-app-profile');
  const child = spawn(bin, [`--app=${url}`, '--window-size=680,900', `--user-data-dir=${profile}`], { stdio: 'ignore' });
  child.on('exit', async () => { await websg.stop().catch(() => {}); process.exit(0); });
}

const server = app.listen(PORT, () => {
  painhoHierro.iniciarVigilancia((m) => log(m, 'success')); // "cron" local: só roda enquanto o app está aberto
  if (!process.env.PAINHO_SEM_JANELA) openMiniWindow(`http://localhost:${PORT}`);
});
server.on('error', (e) => { console.error(e); process.exit(1); });
process.on('SIGINT', async () => { await websg.stop(); process.exit(0); });
