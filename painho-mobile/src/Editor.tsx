import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type CSSProperties } from 'react'
import { BarraLateralSite } from './BarraLateralSite'
import { BadgeNoticia } from './BadgeNoticia'
import { TituloCard } from './TituloCard'
import { RodapeInstagram, rodapeNaturalWidth } from './RodapeInstagram'
import { PrimeirasLogoMark } from './PrimeirasLogo'
import { VideoStage } from './VideoStage'
import type { FFmpeg } from '@ffmpeg/ffmpeg'

// singleton de módulo (não por componente) — carregar o core do ffmpeg.wasm é pesado, só queremos fazer isso
// uma vez pra sessão inteira, mesmo trocando de vídeo (o que remonta o Editor por causa do `key={currentIndex}`)
let ffmpegSingletonPromise: Promise<FFmpeg> | null = null

const CANVAS_W = 1080
const CANVAS_H = 1920
const DISPLAY_W = 360
const SCALE = DISPLAY_W / CANVAS_W

// Visual consistente pros botões (antes cada um era o botão cru do navegador, quadrado, desalinhado).
const BTN: CSSProperties = {
  padding: '8px 14px', borderRadius: 8, border: '1px solid #2a3b55', background: '#1b263b', color: '#fff',
  fontSize: 13, fontFamily: 'Arial, sans-serif', cursor: 'pointer', lineHeight: 1.2,
}
const BTN_ACTIVE: CSSProperties = { ...BTN, background: '#2f6fed', border: '1px solid #2f6fed' }
const BTN_GHOST: CSSProperties = { ...BTN, background: 'transparent' }
const BTN_DISABLED: CSSProperties = { ...BTN, opacity: 0.4, cursor: 'not-allowed' }

type BadgeVariant = 'normal' | 'urgente' | 'exclusivo'
type ItemType = 'badge' | 'titulo' | 'rodape' | 'marca-dagua' | 'barra' | 'titulo-rodape'
// Esses nunca podem ficar tortos — só a marca d'água pode inclinar livremente.
const NO_ROTATE: ItemType[] = ['badge', 'titulo', 'rodape', 'titulo-rodape']
// a barra lateral pode girar, mas só em quartos de volta (0/90/180/270) — nunca torta, sempre reta na
// horizontal ou vertical, pra poder virar de lado sem ficar desnivelada.
const SNAP90_ROTATE: ItemType[] = ['barra']
const snapRotation = (type: ItemType, deg: number) => (SNAP90_ROTATE.includes(type) ? Math.round(deg / 90) * 90 : deg)

// Caixa aproximada de cada componente (origem no canto superior-esquerdo, não no centro — é assim que os
// componentes colados foram desenhados). Usada só pra posicionar a alça de escala/rotação no canto certo.
const BBOX: Record<ItemType, [number, number]> = {
  badge: [320, 76],
  titulo: [922, 342],
  rodape: [570, 104], // base mínima — o rodapé real cresce sozinho conforme @conta/collabs (RodapeInstagram)
  'marca-dagua': [420, 420],
  barra: [92, 1826],
  'titulo-rodape': [922, 342 + 24 + 104], // título em cima + espaço + rodapé embaixo, colados
}

interface CanvasItem {
  id: string
  type: ItemType
  x: number
  y: number
  scale: number
  rotation: number
  badgeVariant?: BadgeVariant
  text?: string
  opacity?: number
  w?: number // override de largura (só 'titulo' usa — redimensiona sem distorcer letras)
  h?: number // override de altura (só 'titulo' usa)
  tituloHidden?: boolean // só 'titulo-rodape' usa — título removido via X, fica só o rodapé (sempre fica)
}

// NÃO usar um contador simples (tipo `let nextId=1`) aqui: esse módulo é recarregado a cada hot-reload durante
// o desenvolvimento, o que reseta um contador pra 1 — mas os itens já criados continuam vivos na tela, e o
// próximo item criado nascia com o MESMO id de um item antigo, fazendo o React confundir os dois (foi o que
// causava digitar num badge e o texto "vazar" pra outro). Isso sempre pode voltar a acontecer com qualquer
// módulo reiniciado (recarregar a página, trocar de vídeo); por segurança, usa algo que nunca repete de verdade.
const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`

const DEFAULT_POS: Record<ItemType, { x: number; y: number }> = {
  badge: { x: 112, y: 103 },
  titulo: { x: 78, y: 1262 },
  rodape: { x: 78, y: 1637 },
  'marca-dagua': { x: 330, y: 760 },
  barra: { x: 0, y: 0 },
  'titulo-rodape': { x: 78, y: 1262 },
}

export interface EditorHandle {
  exportVideo: (onProgress?: (pct: number) => void) => Promise<Blob>
}

const Editor = forwardRef<EditorHandle, { videoSrc: string; handle: string; collabs: string[] }>(function Editor(
  { videoSrc, handle, collabs }, ref
) {
  // a barra lateral nasce como item normal (móvel/escalável/girável em quartos de volta) — antes era fixa
  const [items, setItems] = useState<CanvasItem[]>(() => [
    { id: newId(), type: 'barra', ...DEFAULT_POS.barra, scale: 1, rotation: 0 },
  ])
  const [dragId, setDragId] = useState<string | null>(null)
  const [gestureId, setGestureId] = useState<string | null>(null)
  const [overTrash, setOverTrash] = useState(false)
  // clicar num componente seleciona ele (sem arrastar); clicar na lixeira depois remove o selecionado —
  // forma mais fácil de apagar do que só arrastar até a lixeira.
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const movedRef = useRef(false)

  const [resizeId, setResizeId] = useState<string | null>(null)
  const dragStart = useRef<{ x: number; y: number; ix: number; iy: number } | null>(null)
  const gestureStart = useRef<{ scale: number; rotation: number; dist0: number; ang0: number } | null>(null)
  const resizeInfo = useRef<{ edge: 'left' | 'right' | 'top' | 'bottom'; startX: number; startY: number; w0: number; h0: number; x0: number; y0: number } | null>(null)
  // pinça de verdade com dois dedos: cada item rastreia seus próprios ponteiros ativos (tela multitouch)
  const itemPointers = useRef<Map<string, Map<number, { x: number; y: number }>>>(new Map())
  const pinchStart = useRef<{ scale: number; rotation: number; dist0: number; ang0: number } | null>(null)
  const trashRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<SVGSVGElement>(null)
  const trackRef = useRef<HTMLDivElement>(null) // a trilha de verdade da timeline (mede posição sem contar scroll na mão)
  const timelineScrollRef = useRef<HTMLDivElement>(null) // o container com scroll — usado pra rolar sozinho quando arrasta perto da borda
  // arrasta (agulha, scrub ou reordenar) perto da beira da timeline visível: rola sozinho na direção do arrasto
  const autoScrollTimelineEdge = (clientX: number) => {
    const el = timelineScrollRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const EDGE = 36, SPEED = 16
    if (clientX < rect.left + EDGE) el.scrollLeft = Math.max(0, el.scrollLeft - SPEED)
    else if (clientX > rect.right - EDGE) el.scrollLeft = el.scrollLeft + SPEED
  }

  // --- Timeline (corte, seleção, exclusão em ripple, zoom — igual CapCut) ---
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const [duration, setDuration] = useState(0)
  const [isPlaying, setIsPlaying] = useState(true)
  const [videoTime, setVideoTime] = useState(0)
  // keptRanges = pedaços do vídeo original (em segundos) que sobraram depois dos cortes/exclusões, em ordem.
  // Ripple: ao excluir um pedaço, ele some de vez da timeline (os de depois "puxam" pra trás), não só silencia.
  const [keptRangesState, setKeptRangesState] = useState<[number, number][]>([[0, 0]])
  const [selectedRange, setSelectedRange] = useState<number | null>(null)
  const [pxPerSec, setPxPerSec] = useState(40)
  const [clipboardRange, setClipboardRange] = useState<[number, number] | null>(null)
  // desfazer/refazer: cada corte/exclusão/colar/reordenar empilha o estado ANTERIOR aqui antes de mudar
  const [historyPast, setHistoryPast] = useState<[number, number][][]>([])
  const [historyFuture, setHistoryFuture] = useState<[number, number][][]>([])
  const keptRanges = keptRangesState
  // troca o array de pedaços empilhando o estado atual no histórico (pra dar pra desfazer depois)
  const setKeptRanges = (updater: [number, number][] | ((prev: [number, number][]) => [number, number][])) => {
    setHistoryPast((h) => [...h, keptRangesState])
    setHistoryFuture([])
    setKeptRangesState(updater)
  }
  const undo = () => {
    setHistoryPast((h) => {
      if (!h.length) return h
      const prev = h[h.length - 1]
      setHistoryFuture((f) => [keptRangesState, ...f])
      setKeptRangesState(prev)
      return h.slice(0, -1)
    })
  }
  const redo = () => {
    setHistoryFuture((f) => {
      if (!f.length) return f
      const next = f[0]
      setHistoryPast((h) => [...h, keptRangesState])
      setKeptRangesState(next)
      return f.slice(1)
    })
  }
  // posição (em px da trilha) do ponteiro durante o arrasto de reordenar — usada pra desenhar o "fantasma"
  // seguindo o dedo/mouse de verdade, igual CapCut, em vez de ficar parado no lugar original.
  const [dragGhostX, setDragGhostX] = useState<number | null>(null)
  // qual ÍNDICE do array está "dono" da agulha agora — não dá pra descobrir isso só pelo tempo do vídeo quando
  // existem DUAS entradas com o mesmo intervalo (cópia/cola de um pedaço), porque aí o tempo bate nas duas ao
  // mesmo tempo e a busca por tempo sempre acha a primeira (o original), nunca a cópia. Por isso agora a
  // posição "oficial" da agulha é por índice na lista, não por valor de tempo.
  const [activeIdx, setActiveIdx] = useState(0)
  // clicar e arrastar um pedaço solta ele pra reordenar (mover pro fim/começo/entre outros pedaços), igual CapCut
  const [reorderingIdx, setReorderingIdx] = useState<number | null>(null)
  const [reorderOverIdx, setReorderOverIdx] = useState<number | null>(null)
  const timelineScrub = useRef(false)

  // trava de segurança: se excluir/reordenar deixar o índice ativo fora da faixa, puxa ele de volta pro válido
  useEffect(() => {
    if (activeIdx >= keptRanges.length) setActiveIdx(Math.max(0, keptRanges.length - 1))
  }, [keptRanges, activeIdx])

  const totalKeptDuration = keptRanges.reduce((s, [a, b]) => s + (b - a), 0)
  // tempo "de timeline" (0..totalKeptDuration) do índice ativo — soma a duração de tudo ANTES dele + o quanto
  // já passou dentro dele. Não busca por valor de tempo em lugar nenhum, então cópias não confundem mais nada.
  const activeTimelineTime = () => {
    let acc = 0
    for (let i = 0; i < activeIdx && i < keptRanges.length; i++) acc += keptRanges[i][1] - keptRanges[i][0]
    const cur = keptRanges[activeIdx]
    return cur ? acc + Math.max(0, videoTime - cur[0]) : acc
  }
  // tempo de timeline -> {tempo real do vídeo, ÍNDICE do pedaço} — caminha a lista em ORDEM, isso já resolve
  // cópias sozinho (a posição na timeline é sempre inequívoca, mesmo quando dois pedaços apontam pro mesmo
  // trecho de vídeo original).
  const timelineToVideoTimeIdx = (tt: number): { vt: number; idx: number } => {
    let acc = 0
    for (let i = 0; i < keptRanges.length; i++) {
      const [s, e] = keptRanges[i]
      const len = e - s
      if (tt <= acc + len || i === keptRanges.length - 1) return { vt: s + Math.min(len, Math.max(0, tt - acc)), idx: i }
      acc += len
    }
    return { vt: 0, idx: 0 }
  }

  const exportingRef = useRef(false)
  const onVideoRef = (el: HTMLVideoElement | null) => {
    videoElRef.current = el
    if (!el) return
    const applyDuration = (d: number) => {
      setDuration(d)
      setKeptRanges((prev) => (prev.length === 1 && prev[0][1] === 0 ? [[0, d]] : prev))
    }
    el.onloadedmetadata = () => {
      // vídeo do WhatsApp (e vários outros) costuma reportar duração = Infinity no loadedmetadata — bug
      // conhecido do Chrome com certos MP4s sem um cabeçalho de duração correto. Isso explodia a timeline
      // inteira (largura "Infinity" no CSS) e travava a exportação em 0% pra sempre (o alvo nunca era alcançado
      // porque era infinito). O jeito de forçar o navegador a calcular a duração real: pedir pra buscar um
      // tempo bem além do fim — isso obriga a sondar o arquivo todo — e esperar o evento 'durationchange'.
      if (!Number.isFinite(el.duration)) {
        let settled = false
        const onDurationChange = () => {
          if (settled || !Number.isFinite(el.duration)) return
          settled = true
          el.removeEventListener('durationchange', onDurationChange)
          el.currentTime = 0
          applyDuration(el.duration)
        }
        el.addEventListener('durationchange', onDurationChange)
        el.currentTime = 1e101
        // fallback de segurança: se depois de 5s o navegador ainda não disse a duração real, usa o que der
        // pra buscar no próprio vídeo (o fim do trecho já "bufferizado") em vez de travar a timeline pra sempre
        setTimeout(() => {
          if (settled) return
          settled = true
          el.removeEventListener('durationchange', onDurationChange)
          const fallback = el.buffered.length > 0 ? el.buffered.end(el.buffered.length - 1) : (Number.isFinite(el.duration) ? el.duration : 60)
          el.currentTime = 0
          applyDuration(fallback)
        }, 5000)
      } else {
        applyDuration(el.duration)
      }
    }
    el.ontimeupdate = () => {
      // durante a exportação, NENHUM estado do React pode mudar aqui: um setState a cada evento (ontimeupdate
      // dispara várias vezes por segundo) força o componente a re-renderizar sem parar, o que recria a
      // referência pro <video> (onVideoRef muda de identidade a cada render) e faz o React desconectar/
      // reconectar o elemento repetidamente BEM NO MEIO da gravação — brigando com a própria decodificação e
      // travando o avanço do tempo. Era essa a causa real do travamento, não o seek nem o play().
      if (exportingRef.current) return
      setVideoTime(el.currentTime)
      // enquanto a duração real ainda não foi detectada (keptRanges ainda é o placeholder [[0,0]]), não avança
      // nada — isso brigava com o seek gigante que força o navegador a calcular a duração de vídeos tipo
      // WhatsApp (currentTime=1e101), puxando o tempo de volta pra 0 no meio do processo e quebrando a detecção.
      if (keptRanges.length === 1 && keptRanges[0][1] === 0) return
      // continua dentro do pedaço ATIVO (por índice, não por valor de tempo)? só avança quando sai de
      // verdade dele — assim nunca "escorrega" pra outra entrada que, por acaso, tem o mesmo intervalo.
      const cur = keptRanges[activeIdx]
      if (cur && el.currentTime >= cur[0] - 0.05 && el.currentTime <= cur[1] + 0.05) return
      const nextIdx = (activeIdx + 1) % Math.max(1, keptRanges.length)
      const next = keptRanges[nextIdx]
      if (next) { el.currentTime = next[0]; setActiveIdx(nextIdx) }
    }
    el.onplay = () => setIsPlaying(true)
    el.onpause = () => setIsPlaying(false)
  }

  // corta o pedaço ATIVO (por índice) em dois, exatamente no ponto onde a agulha está
  const cutAtPlayhead = () => {
    const [s, e] = keptRanges[activeIdx] ?? []
    if (s === undefined) return
    if (videoTime - s < 0.08 || e - videoTime < 0.08) return // corte rente demais da borda, ignora
    setKeptRanges((prev) => {
      const next = [...prev]
      next.splice(activeIdx, 1, [s, videoTime], [videoTime, e])
      return next
    })
  }
  // exclui o pedaço selecionado — ripple: desaparece da timeline, o resto "cola" direto
  const deleteSelected = () => {
    if (selectedRange === null) return
    setKeptRanges((prev) => prev.length > 1 ? prev.filter((_, i) => i !== selectedRange) : prev)
    setSelectedRange(null)
  }
  // arrastar em qualquer ponto do bloco do vídeo (fora da agulha) navega pra aquele ponto — e já marca qual
  // ÍNDICE vira o ativo, pra não se perder entre pedaços duplicados (cópia/cola) que têm o mesmo intervalo.
  const scrubToClientX = (clientX: number, containerLeft: number, scrollLeft: number) => {
    const tt = Math.max(0, Math.min(totalKeptDuration, (clientX - containerLeft + scrollLeft) / pxPerSec))
    const { vt, idx } = timelineToVideoTimeIdx(tt)
    const el = videoElRef.current
    if (el) el.currentTime = vt
    setVideoTime(vt)
    setActiveIdx(idx)
  }

  // posição FIXA de cada pedaço (ordem original) — usada pra navegar/cortar/colar (nada de arrasto envolvido).
  const staticLefts = () => {
    let acc = 0
    return keptRanges.map(([s, e]) => { const left = acc; acc += (e - s) * pxPerSec; return left })
  }
  // pros pedaços QUE NÃO o arrastado, empacotados em sequência (sem o espaço do arrastado) — é essa lista,
  // igual nos dois lados (deteção de onde soltar E desenho do preview), que resolve o bug de "solta mas não
  // move pro lugar desejado": antes a deteção usava a posição ESTÁTICA (com o espaço do arrastado) enquanto
  // o desenho mostrava os pedaços já REFLUÍDOS (sem esse espaço) — o dedo ficava sobre uma posição visual que
  // não batia com nenhum índice real, e geralmente resolvia de volta pro próprio pedaço arrastado (sem efeito).
  const otherIndices = (draggedIdx: number) => keptRanges.map((_, i) => i).filter((i) => i !== draggedIdx)
  // acha em qual posição (0..otherIndices.length) soltar, usando o MEIO de cada pedaço vizinho como corte —
  // devolve o índice dentro de `otherIndices` onde o pedaço arrastado deve ser inserido.
  const insertPositionAt = (xPos: number, draggedIdx: number) => {
    const others = otherIndices(draggedIdx)
    let acc = 0
    for (let k = 0; k < others.length; k++) {
      const w = (keptRanges[others[k]][1] - keptRanges[others[k]][0]) * pxPerSec
      if (xPos < acc + w / 2) return k
      acc += w
    }
    return others.length
  }

  // copia o pedaço selecionado; colar insere uma cópia dele exatamente onde a agulha está agora
  const copySelected = () => { if (selectedRange !== null) setClipboardRange(keptRanges[selectedRange]) }
  const pasteAtPlayhead = () => {
    if (!clipboardRange) return
    const idx = activeIdx
    const [s, e] = keptRanges[idx] ?? []
    if (s === undefined) return
    if (videoTime - s < 0.08) {
      setKeptRanges((prev) => { const next = [...prev]; next.splice(idx, 0, clipboardRange); return next })
      setActiveIdx(idx + 1) // o pedaço que tava ativo agora foi empurrado uma posição pra frente
    } else if (e - videoTime < 0.08) {
      setKeptRanges((prev) => { const next = [...prev]; next.splice(idx + 1, 0, clipboardRange); return next })
      // ativo continua no mesmo índice, só ganhou uma cópia logo depois
    } else {
      setKeptRanges((prev) => { const next = [...prev]; next.splice(idx, 1, [s, videoTime], clipboardRange, [videoTime, e]); return next })
      // mantém a agulha na primeira metade (que termina exatamente onde ela estava)
    }
  }

  // clica e arrasta um pedaço pra QUALQUER outro lugar da timeline (reordenar, igual CapCut). Promove pra
  // "arrastando" assim que o ponteiro se move alguns pixels com o botão/dedo ainda pressionado — é bem mais
  // confiável que exigir segurar parado um tempo fixo (isso fazia o gesto "não completar" na prática, porque
  // qualquer movimento antes do cronômetro cancelava o arrasto sem avisar). Ouve tudo na JANELA inteira, não
  // no elemento, pra funcionar não importa pra onde o dedo vá.
  const pressIdxRef = useRef<number | null>(null)
  const pressStartRef = useRef<{ x: number; y: number } | null>(null)
  const DRAG_THRESHOLD = 6

  const onSegmentPointerDown = (idx: number) => (e: React.PointerEvent) => {
    e.stopPropagation()
    pressIdxRef.current = idx
    pressStartRef.current = { x: e.clientX, y: e.clientY }
  }
  const onSegmentPointerUp = (idx: number) => () => {
    // a finalização do arrasto acontece no listener global de pointerup (efeito abaixo); aqui só trata
    // o caso de clique normal (sem ter virado um arrasto de reordenar)
    if (reorderingIdx === null) {
      setSelectedRange(idx === selectedRange ? null : idx)
      setSelectedItemId(null) // seleciona só uma coisa por vez — a lixeira não fica em dúvida do que apagar
    }
  }
  const onSegmentPointerLeave = () => {}

  // ouve mover/soltar na JANELA inteira o tempo todo — detecta a promoção pra "arrastando" pelo movimento,
  // e depois guia o arrasto até soltar, funcionando em qualquer ponto da timeline.
  const reorderOverIdxRef = useRef<number | null>(null)
  useEffect(() => { reorderOverIdxRef.current = reorderOverIdx }, [reorderOverIdx])
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (reorderingIdx === null) {
        if (pressIdxRef.current === null || !pressStartRef.current) return
        const dx = e.clientX - pressStartRef.current.x
        const dy = e.clientY - pressStartRef.current.y
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        setReorderingIdx(pressIdxRef.current)
        setReorderOverIdx(pressIdxRef.current)
        return
      }
      if (!trackRef.current) return
      autoScrollTimelineEdge(e.clientX) // arrastar pra reordenar perto da beira também rola a timeline sozinha
      const rect = trackRef.current.getBoundingClientRect()
      const xPos = e.clientX - rect.left
      setDragGhostX(xPos) // fantasma segue o dedo/mouse de verdade
      setReorderOverIdx(insertPositionAt(xPos, reorderingIdx)) // mesma conta usada no desenho — ver otherIndices acima
    }
    const onUp = () => {
      pressIdxRef.current = null
      pressStartRef.current = null
      if (reorderingIdx === null) return
      const insertAt = reorderOverIdxRef.current
      if (insertAt !== null) {
        setKeptRanges((prev) => {
          const next = [...prev]
          const [moved] = next.splice(reorderingIdx, 1)
          next.splice(insertAt, 0, moved)
          return next
        })
      }
      setReorderingIdx(null)
      setReorderOverIdx(null)
      setDragGhostX(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [reorderingIdx])

  useImperativeHandle(ref, () => ({
    exportVideo: (onProgress) => exportComposedVideo(onProgress),
  }))

  // Grava o vídeo + moldura num único arquivo, respeitando os cortes/reordenação da timeline.
  // TODAS as abordagens via <video> tocando ao vivo + canvas + MediaRecorder falharam nessa máquina de formas
  // diferentes (frame congelado, estouro de memória, decodificador travando) porque dependem do navegador
  // conseguir decodificar o vídeo EM TEMPO REAL enquanto desenha e grava ao mesmo tempo. Abordagem 100%
  // diferente: ffmpeg.wasm — processa o arquivo como DADO (sem tocar nada, sem "tempo real"), corta/junta os
  // pedaços e queima a moldura (como uma imagem PNG estática por cima) num passo só, determinístico, com
  // progresso de verdade reportado pelo próprio ffmpeg.
  const getFFmpeg = async (): Promise<FFmpeg> => {
    if (ffmpegSingletonPromise) return ffmpegSingletonPromise
    ffmpegSingletonPromise = (async () => {
      const { FFmpeg: FFmpegCtor } = await import('@ffmpeg/ffmpeg')
      const { toBlobURL } = await import('@ffmpeg/util')
      // `?url` faz o Vite devolver a URL final do arquivo (servida de verdade), em vez de tentar executar o
      // módulo — é assim que se referencia o worker interno do ffmpeg.wasm num bundler como o Vite. Tentativas
      // anteriores (caminho direto pro dist/esm, pacote sem subpath) falharam porque não batiam com o mapa de
      // "exports" do pacote nem com como o Vite resolve workers.
      const workerUrlModule = (await import('@ffmpeg/ffmpeg/worker?url')) as { default: string }
      const ffmpeg = new FFmpegCtor()
      // o worker interno do ffmpeg.wasm (classWorkerURL acima) é um módulo ESM — o core precisa ser a build
      // esm também (a build umd é pra script clássico, formato incompatível com o worker tipo "module").
      // versão mais nova do core (0.12.6 tava decodificando esse vídeo do WhatsApp com a ÁREA DE VÍDEO toda
      // preta — confirmado extraindo frames reais do arquivo baixado; a moldura ficava perfeita por cima de
      // nada) — tentando a build mais recente, que pode ter corrigido esse bug de decodificação.
      const base = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'
      await ffmpeg.load({
        coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, 'text/javascript'),
        wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, 'application/wasm'),
        classWorkerURL: workerUrlModule.default,
      })
      return ffmpeg
    })().catch((err) => { ffmpegSingletonPromise = null; throw err })
    return ffmpegSingletonPromise
  }

  const exportComposedVideo = (onProgress?: (pct: number) => void): Promise<Blob> => {
    return (async () => {
      const videoEl = videoElRef.current
      const svgEl = stageRef.current
      if (!videoEl || !svgEl) throw new Error('Vídeo ou moldura não carregados ainda')
      exportingRef.current = true
      try {
        const EXPORT_W = 720
        const EXPORT_H = 1280

        // mesma regra do preview ao vivo (VideoStage.tsx): se o vídeo fonte já é perto de 9:16, corta pra
        // preencher; se for bem diferente (ex. vídeo paisagem), encaixa inteiro (sem cortar nada) com um fundo
        // desfocado atrás, igual aparece na tela — senão a exportação corta pedaço que o preview mostra inteiro.
        // Usa as dimensões DEPOIS do corte e da rotação 90°/270° (que troca largura por altura), não o
        // tamanho bruto do arquivo — senão a decisão cover/contain-blur fica errada.
        const effW = videoEl.videoWidth * (1 - (videoCrop.left + videoCrop.right) / 100)
        const effH = videoEl.videoHeight * (1 - (videoCrop.top + videoCrop.bottom) / 100)
        const srcAspect = (videoRotation === 90 || videoRotation === 270) ? effH / effW : effW / effH
        const targetAspect = 9 / 16
        const proportionalDiff = Math.abs(srcAspect - targetAspect) / targetAspect
        const fitMode: 'cover' | 'contain-blur' = proportionalDiff <= 0.18 ? 'cover' : 'contain-blur'

        // rasteriza a moldura como uma ÚNICA imagem PNG estática (os badges/título não animam quadro a
        // quadro) — sem o chrome de edição (alça de redimensionar/girar, contorno tracejado).
        const overlaySvg = svgEl.cloneNode(true) as SVGSVGElement
        overlaySvg.querySelector('foreignObject')?.remove()
        overlaySvg.querySelectorAll('[data-ui-handle]').forEach((el) => el.remove())
        // ACHADO REAL (era isso o tempo todo): o <svg> do editor tem `style={{ background: '#090414' }}` pra
        // ficar bonito na tela — cloneNode copia esse estilo junto, e ele acaba rasterizado no PNG da moldura
        // como um fundo OPACO cobrindo o frame inteiro, em vez de transparente. É esse fundo escuro que
        // aparecia como "vídeo preto" em toda exportação, mascarando o vídeo de verdade por trás.
        overlaySvg.style.background = 'transparent'
        overlaySvg.setAttribute('width', String(EXPORT_W))
        overlaySvg.setAttribute('height', String(EXPORT_H))
        const svgData = new XMLSerializer().serializeToString(overlaySvg)
        const overlayImg = new Image()
        overlayImg.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgData)}`
        await new Promise<void>((r) => { if (overlayImg.complete) r(); else overlayImg.onload = () => r() })
        const pngCanvas = document.createElement('canvas')
        pngCanvas.width = EXPORT_W
        pngCanvas.height = EXPORT_H
        pngCanvas.getContext('2d')!.drawImage(overlayImg, 0, 0, EXPORT_W, EXPORT_H)
        const overlayPngBlob: Blob = await new Promise((r) => pngCanvas.toBlob((b) => r(b!), 'image/png'))

        onProgress?.(0.02)
        const { fetchFile } = await import('@ffmpeg/util')
        // o ffmpeg precisa de uma EXTENSÃO de verdade no nome do arquivo de entrada pra detectar o formato
        // certo — gravar sem extensão ("input.src") fazia ele decodificar errado (saía vídeo preto, sem
        // áudio, mas sem erro nenhum pra avisar). Descobre a extensão pelo tipo MIME real do arquivo.
        const videoBlobForMime = await (await fetch(videoSrc)).blob()
        const mimeToExt: Record<string, string> = { 'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-matroska': 'mkv', 'video/3gpp': '3gp' }
        const inputExt = mimeToExt[videoBlobForMime.type] || 'mp4'
        const inputName = `input.${inputExt}`
        const [videoData, overlayData] = await Promise.all([fetchFile(videoSrc), fetchFile(overlayPngBlob)])
        onProgress?.(0.05)

        const ffmpeg = await getFFmpeg()
        onProgress?.(0.1)
        ffmpeg.on('progress', ({ progress }) => { if (Number.isFinite(progress)) onProgress?.(0.1 + Math.max(0, Math.min(1, progress)) * 0.88) })
        // guarda as últimas linhas de log do ffmpeg — se algo falhar, o erro genérico (ex. "FS error") não diz
        // NADA sobre a causa real; o log sim (filtro inválido, codec não suportado, etc.)
        const recentLogs: string[] = []
        // também manda pro console SEMPRE (não só quando dá erro) — dessa vez "funcionou" (chegou a 100%) mas
        // saiu vídeo preto/sem áudio: não existe exceção pra eu enxergar, só o log bruto do que foi decodificado
        ffmpeg.on('log', ({ message }) => {
          console.log('[ffmpeg]', message)
          recentLogs.push(message)
          if (recentLogs.length > 60) recentLogs.shift()
        })

        await ffmpeg.writeFile(inputName, videoData)
        await ffmpeg.writeFile('overlay.png', overlayData)

        // monta os filtros de corte (trim+concat) só pros pedaços mantidos, na ordem da timeline.
        // IMPORTANTE: vídeo e áudio são processados em EXECs SEPARADOS, nunca no mesmo filter_complex — o core
        // do ffmpeg.wasm (ffmpeg 5.1.4, mais velho) tem um bug real de parser quando os dois são misturados
        // num grafo só ("Cannot create the link setpts:0 -> concat:1", confirmado no log: conecta a saída de
        // vídeo na entrada de ÁUDIO do concat). No PC com ffmpeg 8 isso funciona liso — só esse core antigo
        // quebra. Separar em 3 passos (vídeo mudo → áudio → juntar com stream copy, sem reencode) evita o bug
        // por completo: cada grafo de filtro só lida com um tipo de mídia de cada vez.
        const segs = keptRanges
        // corte das bordas (slider "Cortar vídeo") — convertido de % pra pixel na resolução real do vídeo
        // fonte, aplicado ANTES do trim/concat (opera sempre no mesmo lugar, corte não muda por segmento).
        const srcW = videoEl.videoWidth, srcH = videoEl.videoHeight
        const cropW = Math.max(2, Math.round(srcW * (1 - (videoCrop.left + videoCrop.right) / 100)))
        const cropH = Math.max(2, Math.round(srcH * (1 - (videoCrop.top + videoCrop.bottom) / 100)))
        const cropX = Math.round(srcW * (videoCrop.left / 100))
        const cropY = Math.round(srcH * (videoCrop.top / 100))
        const hasCrop = videoCrop.top + videoCrop.right + videoCrop.bottom + videoCrop.left > 0
        const cropStep = hasCrop ? `,crop=${cropW}:${cropH}:${cropX}:${cropY}` : ''
        // gira em 90° (transpose: 1=90°horário, 2=90°anti-horário, 180°=dois transpose seguidos) e espelha
        // horizontalmente — mesma coisa que o botão "↻ Girar 90°"/"⇋ Espelhar" faz no preview.
        const rotateStep = videoRotation === 90 ? ',transpose=1' : videoRotation === 180 ? ',transpose=1,transpose=1' : videoRotation === 270 ? ',transpose=2' : ''
        const flipStep = videoFlipH ? ',hflip' : ''
        const trims = segs.map(([s, e], i) => `[0:v]trim=start=${s}:end=${e},setpts=PTS-STARTPTS${cropStep}${rotateStep}${flipStep}[v${i}]`).join(';')
        const vConcatInputs = segs.map((_, i) => `[v${i}]`).join('')
        // "scale" puro ESPREME vídeo paisagem (ex. 1280x576) pra caber no quadro retrato 9:16, distorcendo os
        // rostos — por isso segue a MESMA regra do preview (VideoStage.tsx): perto de 9:16 corta pra encher a
        // tela; bem diferente (caso comum de vídeo do WhatsApp em paisagem) encaixa o vídeo INTEIRO, sem
        // cortar nada, com uma cópia desfocada dele mesmo preenchendo o resto — senão o export corta gente/
        // texto que aparecia inteiro no preview.
        const fitFilter = fitMode === 'cover'
          ? `scale=${EXPORT_W}:${EXPORT_H}:force_original_aspect_ratio=increase,crop=${EXPORT_W}:${EXPORT_H}`
          : `split=2[vcbg][vcfg];[vcbg]scale=${EXPORT_W}:${EXPORT_H}:force_original_aspect_ratio=increase,crop=${EXPORT_W}:${EXPORT_H},gblur=sigma=24,eq=brightness=-0.2:saturation=0.9[bg];[vcfg]scale=${EXPORT_W}:${EXPORT_H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`
        const videoFilter = `${trims};${vConcatInputs}concat=n=${segs.length}:v=1:a=0[vcat];[vcat]${fitFilter}[vscaled];[vscaled][1:v]overlay=0:0[vout]`
        const atrims = segs.map(([s, e], i) => `[0:a]atrim=start=${s}:end=${e},asetpts=PTS-STARTPTS[a${i}]`).join(';')
        const aConcatInputs = segs.map((_, i) => `[a${i}]`).join('')
        const audioFilter = `${atrims};${aConcatInputs}concat=n=${segs.length}:v=0:a=1[aout]`

        const silentName = 'silent.mp4'
        const audioName = 'audio.m4a'
        const outName = 'output.mp4'

        // vídeo mudo: corta/reordena, escala e queima a moldura — tudo num filtro só (o que quebrava NÃO era
        // isso: era o <svg> da moldura ter um `style={{background:'#090414'}}` que ia junto no PNG rasterizado
        // e cobria o frame inteiro com um fundo opaco, mascarando o vídeo por trás. Removido lá em cima, onde
        // o PNG é gerado — com isso, voltar a usar um filtro só é seguro e mais simples.
        let code = await ffmpeg.exec([
          '-i', inputName, '-i', 'overlay.png',
          '-filter_complex', videoFilter,
          '-map', '[vout]',
          '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28',
          silentName,
        ])
        if (code !== 0) throw new Error(`ffmpeg falhou no vídeo (código ${code}). Últimas linhas: ${recentLogs.slice(-10).join(' | ') || '(sem log)'}`)

        // passo 2: só o áudio, cortado/reordenado igual — se o vídeo não tiver faixa de áudio, esse passo
        // falha (código ≠0) e a gente segue só com o vídeo mudo, sem travar nada.
        recentLogs.length = 0
        const audioCode = await ffmpeg.exec([
          '-i', inputName,
          '-filter_complex', audioFilter,
          '-map', '[aout]',
          '-c:a', 'aac',
          audioName,
        ])

        if (audioCode === 0) {
          // passo 3: junta vídeo mudo + áudio — stream copy puro, sem reencode (rápido e leve)
          recentLogs.length = 0
          const muxCode = await ffmpeg.exec(['-i', silentName, '-i', audioName, '-c', 'copy', '-map', '0:v', '-map', '1:a', outName])
          if (muxCode !== 0) throw new Error(`ffmpeg falhou juntando áudio e vídeo (código ${muxCode}). Últimas linhas: ${recentLogs.slice(-10).join(' | ') || '(sem log)'}`)
        }

        const finalName = audioCode === 0 ? outName : silentName
        const data = await ffmpeg.readFile(finalName)
        onProgress?.(1)
        for (const f of [inputName, 'overlay.png', silentName, audioName, outName]) { try { await ffmpeg.deleteFile(f) } catch { /* segue */ } }
        // readFile() devolve string | Uint8Array — nosso output é sempre binário (nunca texto), então é sempre
        // Uint8Array na prática; o Blob aceita isso direto, sem precisar sacar o .buffer (que só existe nesse branch).
        return new Blob([new Uint8Array(data as Uint8Array)], { type: 'video/mp4' })
      } finally {
        exportingRef.current = false
      }
    })()
  }

  const addItem = (type: ItemType, badgeVariant?: BadgeVariant) => {
    // se já existe um "título + rodapé" com o título removido (X), clicar aqui de novo RESTAURA o título
    // nesse mesmo container em vez de criar outro do zero — o rodapé "que já tá lá" continua exatamente onde tava.
    if (type === 'titulo-rodape') {
      const hidden = items.find((i) => i.type === 'titulo-rodape' && i.tituloHidden)
      if (hidden) { updateItem(hidden.id, { tituloHidden: false }); return }
    }
    const pos = DEFAULT_POS[type]
    // Cada novo item do MESMO TIPO soma um deslocamento em cascata grande o bastante pra realmente sair de
    // cima do anterior (o deslocamento antigo, de 26px em canvas de 1080px, era pequeno demais pertro do
    // tamanho real de um badge — na prática ficava tudo empilhado/sobreposto mesmo "deslocado"). Conta só os
    // itens do mesmo tipo (um badge novo não se importa com onde o rodapé está) e sempre soma x e y na mesma
    // direção (nunca x+ com y-), senão o cascade pode jogar o item pra fora do topo do canvas.
    const sameTypeCount = items.filter((i) => i.type === type).length
    const offset = (sameTypeCount % 6) * 90
    const item: CanvasItem = { id: newId(), type, x: pos.x + offset, y: pos.y + offset, scale: 1, rotation: 0 }
    if (type === 'badge') { item.badgeVariant = badgeVariant ?? 'normal'; if (item.badgeVariant === 'normal') item.text = 'NOTÍCIA' }
    if (type === 'titulo' || type === 'titulo-rodape') item.text = ''
    if (type === 'marca-dagua') item.opacity = 0.18
    setItems((prev) => [...prev, item])
  }
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id))
    setSelectedItemId((prev) => (prev === id ? null : prev))
  }
  const updateItem = (id: string, patch: Partial<CanvasItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))

  const pointInRect = (x: number, y: number, el: HTMLElement | null) => {
    if (!el) return false
    const r = el.getBoundingClientRect()
    return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom
  }
  const toCanvas = (clientX: number, clientY: number) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left) / SCALE, y: (clientY - r.top) / SCALE }
  }
  // Largura/altura "base" de um item — pro rodapé isso é a largura REAL calculada pelo próprio componente
  // (cresce sozinho com @conta/collabs), não um valor fixo chutado; os outros tipos usam a caixa fixa BBOX.
  const naturalBBox = (item: CanvasItem): [number, number] => {
    const [bw, bh] = BBOX[item.type]
    if (item.type === 'rodape' || item.type === 'titulo-rodape') return [Math.max(bw, rodapeNaturalWidth(handle, collabs)), bh]
    if (item.type === 'badge' && item.badgeVariant === 'normal') {
      const label = item.text ?? 'NOTÍCIA'
      return [Math.max(bw, 70 + label.length * 17), bh]
    }
    return [bw, bh]
  }
  // Centro visual do item em coordenadas de canvas: como o transform é translate(x,y) -> translate(w/2,h/2) ->
  // rotate -> scale -> translate(-w/2,-h/2), o ponto de pivô é SEMPRE x+w/2, y+h/2, não muda com escala/rotação.
  const centerOf = (item: CanvasItem) => {
    const [bw, bh] = naturalBBox(item)
    const w = item.w ?? bw, h = item.h ?? bh
    return { cx: item.x + w / 2, cy: item.y + h / 2, w, h }
  }

  // Mover: clique/arrasto no próprio componente (limiar de 4px pra não brigar com cliques de edição de texto).
  const onMoveDown = (item: CanvasItem) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setDragId(item.id)
    movedRef.current = false
    dragStart.current = { x: e.clientX, y: e.clientY, ix: item.x, iy: item.y }

    // registra o ponteiro pro sistema de pinça de dois dedos
    let map = itemPointers.current.get(item.id)
    if (!map) { map = new Map(); itemPointers.current.set(item.id, map) }
    map.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (map.size === 2) {
      const [a, b] = Array.from(map.values())
      const { cx, cy } = centerOf(item)
      const pa = toCanvas(a.x, a.y), pb = toCanvas(b.x, b.y)
      void cx; void cy
      pinchStart.current = {
        scale: item.scale, rotation: item.rotation,
        dist0: Math.hypot(pb.x - pa.x, pb.y - pa.y),
        ang0: (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI,
      }
    }
  }
  // Alça de canto: escala/rotação com um dedo só (alternativa de desktop à pinça).
  const onGestureDown = (item: CanvasItem) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setGestureId(item.id)
    // BUG que embaralhava girar/escalar depois da PRIMEIRA rotação: isso usava o canto LOCAL (sem rotação)
    // como ângulo de referência (w/2,h/2), que só bate com a posição real do dedo quando rotation=0. Depois
    // de girar uma vez, o cálculo ficava errado e girar/encolher pareciam trocados. Mede a posição REAL do
    // ponteiro (mundo/canvas) em relação ao centro — sempre certo, não importa a rotação atual do item.
    const { cx, cy } = centerOf(item)
    const p = toCanvas(e.clientX, e.clientY)
    gestureStart.current = {
      scale: item.scale, rotation: item.rotation,
      dist0: Math.hypot(p.x - cx, p.y - cy), ang0: (Math.atan2(p.y - cy, p.x - cx) * 180) / Math.PI,
    }
  }

  // Alças de borda — título usa esquerda/topo/base (texto reflow a partir da direita fixa); rodapé usa
  // direita/topo/base (conteúdo nasce colado à esquerda na logo, então estica pela direita). Em ambos os
  // casos é redimensionamento de verdade (não scale transform, que distorceria fonte/ícones).
  const onResizeDown = (item: CanvasItem, edge: 'left' | 'right' | 'top' | 'bottom') => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture(e.pointerId)
    setResizeId(item.id)
    const [bw, bh] = naturalBBox(item)
    resizeInfo.current = { edge, startX: e.clientX, startY: e.clientY, w0: item.w ?? bw, h0: item.h ?? bh, x0: item.x, y0: item.y }
  }

  const onStagePointerMove = (e: React.PointerEvent) => {
    if (resizeId && resizeInfo.current) {
      const { edge, startX, startY, w0, h0, x0, y0 } = resizeInfo.current
      const item = items.find((i) => i.id === resizeId)
      const dx = (e.clientX - startX) / SCALE
      const dy = (e.clientY - startY) / SCALE
      const minW = item ? naturalBBox(item)[0] : 300 // nunca encolhe abaixo do que o conteúdo precisa (ícones/@contas)
      if (edge === 'left') {
        const neww = Math.max(minW, w0 - dx)
        updateItem(resizeId, { w: neww, x: x0 + (w0 - neww) })
      } else if (edge === 'right') {
        const neww = Math.max(minW, w0 + dx)
        updateItem(resizeId, { w: neww })
      } else if (edge === 'top') {
        const newh = Math.max(150, h0 - dy)
        updateItem(resizeId, { h: newh, y: y0 + (h0 - newh) })
      } else {
        const newh = Math.max(150, h0 + dy)
        updateItem(resizeId, { h: newh })
      }
      return
    }
    // pinça de dois dedos tem prioridade quando ativa pro item sendo arrastado
    if (dragId) {
      const map = itemPointers.current.get(dragId)
      if (map?.has(e.pointerId)) map.set(e.pointerId, { x: e.clientX, y: e.clientY })
      if (map && map.size === 2 && pinchStart.current) {
        const item = items.find((i) => i.id === dragId)
        if (item) {
          const [a, b] = Array.from(map.values())
          const pa = toCanvas(a.x, a.y), pb = toCanvas(b.x, b.y)
          const dist = Math.hypot(pb.x - pa.x, pb.y - pa.y)
          const ang = (Math.atan2(pb.y - pa.y, pb.x - pa.x) * 180) / Math.PI
          const newScale = Math.max(0.3, Math.min(4, (dist / pinchStart.current.dist0) * pinchStart.current.scale))
          // badge nunca inclina — só dá zoom in/out, fica sempre reto/horizontal (igual aos outros badges)
          const newRotation = NO_ROTATE.includes(item.type) ? 0 : snapRotation(item.type, pinchStart.current.rotation + (ang - pinchStart.current.ang0))
          const { cx, cy, w, h } = centerOf(item)
          // recentraliza o item pra o ponto médio dos dois dedos continuar sob o gesto
          const midCanvas = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 }
          void midCanvas; void cx; void cy
          updateItem(dragId, { scale: newScale, rotation: newRotation, x: cx - w / 2, y: cy - h / 2 })
        }
        return
      }
    }
    if (dragId && dragStart.current) {
      const dx = (e.clientX - dragStart.current.x) / SCALE
      const dy = (e.clientY - dragStart.current.y) / SCALE
      if (Math.hypot(dx, dy) < 4) return
      movedRef.current = true
      updateItem(dragId, { x: dragStart.current.ix + dx, y: dragStart.current.iy + dy })
      setOverTrash(pointInRect(e.clientX, e.clientY, trashRef.current))
      return
    }
    if (gestureId && gestureStart.current) {
      const item = items.find((i) => i.id === gestureId)
      if (!item) return
      const { cx, cy } = centerOf(item)
      const p = toCanvas(e.clientX, e.clientY)
      const dx = p.x - cx, dy = p.y - cy
      const dist = Math.hypot(dx, dy)
      const ang = (Math.atan2(dy, dx) * 180) / Math.PI
      const newScale = Math.max(0.3, Math.min(4, dist / gestureStart.current.dist0))
      const newRotation = NO_ROTATE.includes(item.type) ? 0 : snapRotation(item.type, ang - gestureStart.current.ang0 + gestureStart.current.rotation)
      updateItem(gestureId, { scale: newScale, rotation: newRotation })
    }
  }
  const onStagePointerUp = (e: React.PointerEvent) => {
    if (dragId) {
      const map = itemPointers.current.get(dragId)
      map?.delete(e.pointerId)
      if (map && map.size < 2) pinchStart.current = null
      if (pointInRect(e.clientX, e.clientY, trashRef.current)) removeItem(dragId)
      else if (!movedRef.current) { setSelectedItemId(dragId); setSelectedRange(null) } // clique sem arrastar = seleciona
    }
    setDragId(null); setGestureId(null); setResizeId(null); setOverTrash(false)
    dragStart.current = null; gestureStart.current = null; resizeInfo.current = null
  }
  const onItemWheel = (item: CanvasItem) => (e: React.WheelEvent) => {
    e.preventDefault(); e.stopPropagation()
    if (e.shiftKey && !NO_ROTATE.includes(item.type)) updateItem(item.id, { rotation: snapRotation(item.type, item.rotation - e.deltaY * 0.2) })
    else updateItem(item.id, { scale: Math.max(0.3, Math.min(4, item.scale - e.deltaY * 0.0015)) })
  }

  // --- vídeo: pinça/zoom 100% livre (pode passar da borda da tela, útil pra esconder algo fora do enquadro)
  // e corte das bordas — totalmente separado do sistema de CanvasItem (não é um componente da moldura).
  const [videoTransform, setVideoTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [videoCrop, setVideoCrop] = useState({ top: 0, right: 0, bottom: 0, left: 0 }) // % de cada borda
  const videoDragStart = useRef<{ x: number; y: number; ix: number; iy: number } | null>(null)
  const videoPointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const videoPinchStart = useRef<{ scale: number; dist0: number; x: number; y: number } | null>(null)
  const videoDragging = useRef(false)

  const onVideoPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    videoPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (videoPointers.current.size === 2) {
      const [a, b] = Array.from(videoPointers.current.values())
      videoPinchStart.current = { scale: videoTransform.scale, dist0: Math.hypot(b.x - a.x, b.y - a.y), x: videoTransform.x, y: videoTransform.y }
    } else {
      videoDragging.current = true
      videoDragStart.current = { x: e.clientX, y: e.clientY, ix: videoTransform.x, iy: videoTransform.y }
    }
  }
  const onVideoPointerMove = (e: React.PointerEvent) => {
    if (videoPointers.current.has(e.pointerId)) videoPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (videoPointers.current.size === 2 && videoPinchStart.current) {
      const [a, b] = Array.from(videoPointers.current.values())
      const dist = Math.hypot(b.x - a.x, b.y - a.y)
      const newScale = Math.max(0.3, Math.min(8, (dist / videoPinchStart.current.dist0) * videoPinchStart.current.scale))
      setVideoTransform((t) => ({ ...t, scale: newScale }))
      return
    }
    if (videoDragging.current && videoDragStart.current) {
      // CRASH REAL (confirmado via sourcemap num celular de verdade): a função de atualização do estado lia
      // `videoDragStart.current` só na hora que o React processa a fila — que pode ser DEPOIS do dedo já ter
      // soltado (onVideoPointerUp zera essa referência pra null nesse meio tempo), travando com "Cannot read
      // properties of null". Tira os números ANTES de chamar setVideoTransform, não lê a referência depois.
      const { x: ix, y: iy } = videoDragStart.current
      const nx = ix + (e.clientX - videoDragStart.current.x) / SCALE
      const ny = iy + (e.clientY - videoDragStart.current.y) / SCALE
      setVideoTransform((t) => ({ ...t, x: nx, y: ny }))
    }
  }
  const onVideoPointerUp = (e: React.PointerEvent) => {
    videoPointers.current.delete(e.pointerId)
    if (videoPointers.current.size < 2) videoPinchStart.current = null
    if (videoPointers.current.size === 0) { videoDragging.current = false; videoDragStart.current = null }
  }
  const onVideoWheel = (e: React.WheelEvent) => {
    e.preventDefault(); e.stopPropagation()
    setVideoTransform((t) => ({ ...t, scale: Math.max(0.3, Math.min(8, t.scale - e.deltaY * 0.0015)) }))
  }

  // gira em passos de 90° (nunca torto) e espelha horizontalmente — dois efeitos independentes e combináveis
  const [videoRotation, setVideoRotation] = useState<0 | 90 | 180 | 270>(0)
  const [videoFlipH, setVideoFlipH] = useState(false)
  const rotateVideo90 = () => setVideoRotation((r) => (((r + 90) % 360) as 0 | 90 | 180 | 270))

  // corte do vídeo arrastando alças direto em cima dele (igual a Ferramenta de Captura do Windows), em vez de
  // sliders numéricos — bem mais direto pra ver exatamente o que vai ficar de fora.
  const [cropEditing, setCropEditing] = useState(false)
  const cropDragRef = useRef<{ edges: Array<'top' | 'right' | 'bottom' | 'left'>; start: { x: number; y: number }; startCrop: typeof videoCrop } | null>(null)
  const onCropHandleDown = (edges: Array<'top' | 'right' | 'bottom' | 'left'>) => (e: React.PointerEvent) => {
    e.stopPropagation()
    ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
    cropDragRef.current = { edges, start: toCanvas(e.clientX, e.clientY), startCrop: videoCrop }
  }
  const onCropHandleMove = (e: React.PointerEvent) => {
    if (!cropDragRef.current) return
    const { edges, start, startCrop } = cropDragRef.current
    const p = toCanvas(e.clientX, e.clientY)
    const dxPct = ((p.x - start.x) / CANVAS_W) * 100
    const dyPct = ((p.y - start.y) / CANVAS_H) * 100
    setVideoCrop(() => {
      const next = { ...startCrop }
      if (edges.includes('left')) next.left = Math.max(0, Math.min(90 - startCrop.right, startCrop.left + dxPct))
      if (edges.includes('right')) next.right = Math.max(0, Math.min(90 - startCrop.left, startCrop.right - dxPct))
      if (edges.includes('top')) next.top = Math.max(0, Math.min(90 - startCrop.bottom, startCrop.top + dyPct))
      if (edges.includes('bottom')) next.bottom = Math.max(0, Math.min(90 - startCrop.top, startCrop.bottom - dyPct))
      return next
    })
  }
  const onCropHandleUp = () => { cropDragRef.current = null }

  const Handles = ({ item }: { item: CanvasItem }) => {
    const [bw, bh] = naturalBBox(item)
    const w = item.w ?? bw, h = item.h ?? bh
    // marcado com data-ui-handle: é só chrome de EDIÇÃO (alça de redimensionar, contorno de seleção), nunca
    // deve aparecer no vídeo exportado — o export remove tudo com esse atributo antes de rasterizar a moldura
    // (era isso que vinha "queimando" as setinhas/bolinha de arrastar dentro do vídeo baixado).
    return (
      <g data-ui-handle="1">
        {item.id === selectedItemId && (
          <rect x={-6} y={-6} width={w + 12} height={h + 12} fill="none" stroke="#2f6fed" strokeWidth="3" strokeDasharray="10 6" rx="6" />
        )}
        {/* a alça de escala/rotação fica RENTE ao canto real do componente (w/h já são o tamanho de verdade,
            não mais um valor fixo chutado — isso que fazia ela ficar longe demais do rodapé) */}
        <g transform={`translate(${w + 10},${h + 10})`} onPointerDown={onGestureDown(item)} style={{ cursor: 'nesw-resize' }}>
          <circle r="18" fill="#00000099" />
          <text x="0" y="6" fontSize="18" textAnchor="middle" fill="#fff">⤢</text>
        </g>
        {SNAP90_ROTATE.includes(item.type) && (
          // botão explícito de girar 90° — além de dar pra girar arrastando a alça ⤢ (que já trava em quartos
          // de volta), clicar aqui gira exatamente 90° de uma vez, sem precisar mirar o arrasto certinho.
          <g
            transform={`translate(${w + 10},-10)`}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => { e.stopPropagation(); updateItem(item.id, { rotation: ((item.rotation + 90) % 360) }) }}
            style={{ cursor: 'pointer' }}
          >
            <circle r="18" fill="#00000099" />
            <text x="0" y="5" fontSize="11" textAnchor="middle" fill="#fff">↻90°</text>
          </g>
        )}
        {(item.type === 'titulo' || (item.type === 'titulo-rodape' && !item.tituloHidden)) && (
          <>
            {/* alça esquerda: alarga/estreita horizontalmente, mantendo a borda direita fixa — no combinado,
                "esticar" aqui estica os dois (título fica mais alto/largo, rodapé desce junto) */}
            <g transform={`translate(-14,${h / 2})`} onPointerDown={onResizeDown(item, 'left')} style={{ cursor: 'ew-resize' }}>
              <rect x="-11" y="-20" width="22" height="40" rx="6" fill="#00000099" />
              <text x="0" y="6" fontSize="14" textAnchor="middle" fill="#fff">↔</text>
            </g>
            <g transform={`translate(${w / 2},-14)`} onPointerDown={onResizeDown(item, 'top')} style={{ cursor: 'ns-resize' }}>
              <rect x="-20" y="-11" width="40" height="22" rx="6" fill="#00000099" />
              <text x="0" y="5" fontSize="14" textAnchor="middle" fill="#fff">↕</text>
            </g>
            <g transform={`translate(${w / 2},${h + 14})`} onPointerDown={onResizeDown(item, 'bottom')} style={{ cursor: 'ns-resize' }}>
              <rect x="-20" y="-11" width="40" height="22" rx="6" fill="#00000099" />
              <text x="0" y="5" fontSize="14" textAnchor="middle" fill="#fff">↕</text>
            </g>
          </>
        )}
      </g>
    )
  }

  const renderItem = (item: CanvasItem) => {
    const [bw, bh] = naturalBBox(item)
    const w = item.w ?? bw, h = item.h ?? bh
    const transform = `translate(${item.x},${item.y}) translate(${w / 2},${h / 2}) rotate(${item.rotation}) scale(${item.scale}) translate(${-w / 2},${-h / 2})`
    const common = {
      key: item.id,
      transform,
      onPointerDown: onMoveDown(item),
      onWheel: onItemWheel(item),
      opacity: dragId === item.id ? 0.7 : 1,
      style: { cursor: 'grab', touchAction: 'none' as const },
    }

    if (item.type === 'badge') {
      return (
        <g {...common}>
          <BadgeNoticia
            variant={item.badgeVariant}
            label={item.text}
            onLabelChange={item.badgeVariant === 'normal' ? (t) => updateItem(item.id, { text: t }) : undefined}
          />
          <Handles item={item} />
        </g>
      )
    }
    if (item.type === 'titulo') {
      return (
        <g {...common}>
          <TituloCard titulo={item.text ?? ''} onChange={(t) => updateItem(item.id, { text: t })} width={w} height={h} />
          <Handles item={item} />
        </g>
      )
    }
    if (item.type === 'rodape') {
      return (
        <g {...common}>
          <RodapeInstagram handle={handle} collabs={collabs} />
          <Handles item={item} />
        </g>
      )
    }
    if (item.type === 'titulo-rodape') {
      // título em cima + rodapé colado embaixo, os dois dentro do MESMO grupo transformado — por isso esticar
      // (escala do ⤢) sempre estica os dois juntos, na mesma proporção, sem precisar de lógica especial.
      // Alinhados à esquerda (x=0 dos dois, sem centralizar) dentro do container. O título pode ser removido
      // (botão X) ficando só o rodapé — o rodapé em si NUNCA some sozinho, só junto com o item inteiro.
      const GAP = 24
      const rodapeH = BBOX.rodape[1]
      const showTitulo = !item.tituloHidden
      const tituloH = showTitulo ? Math.max(150, h - GAP - rodapeH) : 0
      return (
        <g {...common}>
          {showTitulo && (
            <>
              <TituloCard titulo={item.text ?? ''} onChange={(t) => updateItem(item.id, { text: t })} width={w} height={tituloH} />
              {/* X bem grande (fácil de acertar o dedo) — some só o título, rodapé continua no lugar */}
              <g
                data-ui-handle="1"
                transform={`translate(${w + 10},${tituloH / 2})`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => { e.stopPropagation(); updateItem(item.id, { tituloHidden: true }) }}
                style={{ cursor: 'pointer' }}
              >
                <circle r="26" fill="#c0392bcc" stroke="#fff" strokeWidth="2" />
                <text x="0" y="9" fontSize="26" textAnchor="middle" fill="#fff">✕</text>
              </g>
            </>
          )}
          <g transform={`translate(0,${showTitulo ? tituloH + GAP : 0})`}>
            <RodapeInstagram handle={handle} collabs={collabs} />
          </g>
          <Handles item={item} />
        </g>
      )
    }
    if (item.type === 'marca-dagua') {
      return (
        <g {...common}>
          <g opacity={item.opacity ?? 0.18}>
            <PrimeirasLogoMark width={w} />
          </g>
          <Handles item={item} />
        </g>
      )
    }
    if (item.type === 'barra') {
      return (
        <g {...common}>
          <BarraLateralSite />
          <Handles item={item} />
        </g>
      )
    }
    return null
  }

  const watermarks = items.filter((i) => i.type === 'marca-dagua')

  return (
    <div style={{ minWidth: 0, maxWidth: '100%', overflowX: 'hidden' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
        <button style={BTN} onClick={() => addItem('badge', 'normal')}>+ Badge Notícia</button>
        <button style={BTN} onClick={() => addItem('badge', 'urgente')}>+ Badge Urgente</button>
        <button style={BTN} onClick={() => addItem('badge', 'exclusivo')}>+ Badge Exclusivo</button>
        <button style={BTN} onClick={() => addItem('titulo-rodape')}>+ Título + Rodapé</button>
        <button style={BTN} onClick={() => addItem('marca-dagua')}>+ Marca d'água</button>
        <button style={BTN} onClick={() => addItem('barra')}>+ Barra URL</button>
      </div>

      {watermarks.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          {watermarks.map((wm, i) => (
            <div key={wm.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, marginBottom: 4 }}>
              <span>Marca d'água {watermarks.length > 1 ? `#${i + 1}` : ''} — opacidade</span>
              <input
                type="range" min={0} max={1} step={0.01} value={wm.opacity ?? 0.18}
                onChange={(e) => updateItem(wm.id, { opacity: parseFloat(e.target.value) })}
              />
              <span>{Math.round((wm.opacity ?? 0.18) * 100)}%</span>
            </div>
          ))}
        </div>
      )}

      <p style={{ fontSize: 12, color: '#666', marginTop: 0 }}>
        Todo componente pode ser arrastado livremente e escalado com a alça <b>⤢</b> ou pinça de dois dedos;
        roda do mouse = escala, Shift+roda = rotação (a barra lateral só vira em quartos de volta — fica sempre
        reta horizontal ou vertical). O vídeo em si: arraste ou pinça pra mover/zoom (pode passar da borda),
        roda do mouse também dá zoom nele.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 10 }}>
        <button style={cropEditing ? BTN_ACTIVE : BTN} onClick={() => setCropEditing((v) => !v)}>
          {cropEditing ? '✅ Concluir corte' : '✂️ Cortar vídeo'}
        </button>
        <button style={BTN_GHOST} onClick={rotateVideo90}>↻ Girar 90°</button>
        <button style={videoFlipH ? BTN_ACTIVE : BTN_GHOST} onClick={() => setVideoFlipH((v) => !v)}>⇋ Espelhar</button>
        <button style={BTN_GHOST} onClick={() => { setVideoCrop({ top: 0, right: 0, bottom: 0, left: 0 }); setVideoTransform({ x: 0, y: 0, scale: 1 }); setVideoRotation(0); setVideoFlipH(false) }}>
          Resetar vídeo
        </button>
      </div>
      {cropEditing && (
        <p style={{ fontSize: 11, color: '#2f6fed', margin: '0 0 8px' }}>
          Arraste as alças nos cantos/bordas da área clara pra cortar — igual a Ferramenta de Captura.
        </p>
      )}

      <svg
        ref={stageRef}
        width={DISPLAY_W}
        height={DISPLAY_W * (CANVAS_H / CANVAS_W)}
        viewBox={`0 0 ${CANVAS_W} ${CANVAS_H}`}
        style={{ background: '#090414', borderRadius: 8, touchAction: 'none' }}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
      >
        <foreignObject x="0" y="0" width={CANVAS_W} height={CANVAS_H}>
          {/* corte das bordas fica no container de FORA (fixo, nunca mexe) — pinça/zoom/arrasto ficam no de
              DENTRO, assim o corte sempre recorta em relação ao quadro, não em relação ao vídeo zoomado. */}
          <div
            style={{
              position: 'absolute', inset: 0, overflow: 'hidden', touchAction: 'none',
              clipPath: `inset(${videoCrop.top}% ${videoCrop.right}% ${videoCrop.bottom}% ${videoCrop.left}%)`,
            }}
            onPointerDown={onVideoPointerDown}
            onPointerMove={onVideoPointerMove}
            onPointerUp={onVideoPointerUp}
            onPointerCancel={onVideoPointerUp}
            onWheel={onVideoWheel}
          >
            <div style={{
              position: 'absolute', inset: 0,
              transform: `translate(${videoTransform.x}px,${videoTransform.y}px) rotate(${videoRotation}deg) scale(${videoTransform.scale}) scaleX(${videoFlipH ? -1 : 1})`,
            }}>
              <VideoStage src={videoSrc} onVideoRef={onVideoRef} />
            </div>
          </div>
        </foreignObject>

        {items.map(renderItem)}

        {/* corte estilo Ferramenta de Captura: área escurecida fora da seleção + alças arrastáveis nos cantos
            e bordas, direto em cima do vídeo — bem mais direto que digitar número em slider. */}
        {cropEditing && (() => {
          const left = CANVAS_W * (videoCrop.left / 100)
          const right = CANVAS_W * (1 - videoCrop.right / 100)
          const top = CANVAS_H * (videoCrop.top / 100)
          const bottom = CANVAS_H * (1 - videoCrop.bottom / 100)
          const cw = right - left, ch = bottom - top
          const handle = (cx: number, cy: number, cursor: string, edges: Array<'top' | 'right' | 'bottom' | 'left'>) => (
            <circle
              cx={cx} cy={cy} r={16} fill="#2f6fed" stroke="#fff" strokeWidth={3}
              onPointerDown={onCropHandleDown(edges)}
              onPointerMove={onCropHandleMove}
              onPointerUp={onCropHandleUp}
              onPointerCancel={onCropHandleUp}
              style={{ cursor, touchAction: 'none' }}
            />
          )
          return (
            <g data-ui-handle="1">
              <path
                d={`M0 0 H${CANVAS_W} V${CANVAS_H} H0 Z M${left} ${top} H${right} V${bottom} H${left} Z`}
                fill="#000" fillOpacity={0.6} fillRule="evenodd"
              />
              <rect x={left} y={top} width={cw} height={ch} fill="none" stroke="#2f6fed" strokeWidth={3} strokeDasharray="14 8" />
              {handle(left, top, 'nwse-resize', ['top', 'left'])}
              {handle(right, top, 'nesw-resize', ['top', 'right'])}
              {handle(left, bottom, 'nesw-resize', ['bottom', 'left'])}
              {handle(right, bottom, 'nwse-resize', ['bottom', 'right'])}
              {handle((left + right) / 2, top, 'ns-resize', ['top'])}
              {handle((left + right) / 2, bottom, 'ns-resize', ['bottom'])}
              {handle(left, (top + bottom) / 2, 'ew-resize', ['left'])}
              {handle(right, (top + bottom) / 2, 'ew-resize', ['right'])}
            </g>
          )
        })()}
      </svg>

      {/* MESMA lixeira pra tudo: clica num componente do canvas OU num pedaço da timeline pra selecionar, clica
          aqui pra apagar — sem botão duplicado, sem ícone diferente, exatamente a mesma dinâmica pros dois. */}
      <div
        ref={trashRef}
        onClick={() => { if (selectedItemId) removeItem(selectedItemId); else if (selectedRange !== null) deleteSelected() }}
        style={{
          marginTop: 12, width: 64, height: 64, borderRadius: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: overTrash ? '#c0392b' : (selectedItemId || selectedRange !== null) ? '#8a3a3a' : '#333', color: '#fff', fontSize: 26,
          transition: 'background .1s', cursor: (selectedItemId || selectedRange !== null) ? 'pointer' : 'default',
          boxShadow: (selectedItemId || selectedRange !== null) ? '0 0 0 3px #c0392b55' : 'none',
        }}
        title="Clique num componente ou num pedaço da timeline pra selecionar, depois clique aqui pra apagar"
      >🗑️</div>

      {/* --- Timeline de corte (igual CapCut): agulha marca o frame atual, arrasta o bloco pra navegar, tesoura
          corta no ponto da agulha, lixeira exclui o pedaço selecionado (some de vez, ripple), e os botões de
          zoom esticam/encolhem a timeline pra ganhar precisão nos frames. --- */}
      {duration > 0 && (
        <div style={{ marginTop: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: '#888', marginRight: 4 }}>Timeline</span>
            <button
              style={isPlaying ? BTN_ACTIVE : BTN}
              onClick={() => { const v = videoElRef.current; if (!v) return; if (v.paused) v.play().catch(() => undefined); else v.pause() }}
            >
              {isPlaying ? '⏸ Pausar' : '▶️ Reproduzir'}
            </button>
            <button style={BTN_GHOST} onClick={() => setPxPerSec((z) => Math.max(10, z - 20))} title="Encolher (menos preciso)">− zoom</button>
            <button style={BTN_GHOST} onClick={() => setPxPerSec((z) => Math.min(600, z + 20))} title="Esticar (mais preciso, por frame)">+ zoom</button>
            <button style={BTN} onClick={cutAtPlayhead} title="Cortar no ponto da agulha">✂️ Cortar</button>
            <button style={selectedRange === null ? BTN_DISABLED : BTN} onClick={copySelected} disabled={selectedRange === null} title="Copiar pedaço selecionado">📋 Copiar</button>
            <button style={!clipboardRange ? BTN_DISABLED : BTN_ACTIVE} onClick={pasteAtPlayhead} disabled={!clipboardRange} title="Colar cópia no ponto da agulha">📥 Colar</button>
            <button style={historyPast.length === 0 ? BTN_DISABLED : BTN} onClick={undo} disabled={historyPast.length === 0} title="Desfazer última ação na timeline">↩️ Desfazer</button>
            <button style={historyFuture.length === 0 ? BTN_DISABLED : BTN} onClick={redo} disabled={historyFuture.length === 0} title="Refazer">↪️ Refazer</button>
          </div>
          {reorderingIdx !== null && (
            <p style={{ fontSize: 11, color: '#2f6fed', margin: '0 0 6px' }}>
              Arraste sobre outro pedaço e solte pra reordenar — soltando aqui.
            </p>
          )}

          {/* barra de rolagem horizontal bem grossa e sempre visível (não é a overlay padrão que some sozinha) */}
          <style>{`
            .painho-timeline-scroll { scrollbar-width: auto; }
            .painho-timeline-scroll::-webkit-scrollbar { height: 22px; }
            .painho-timeline-scroll::-webkit-scrollbar-track { background: #050505; border-radius: 11px; }
            .painho-timeline-scroll::-webkit-scrollbar-thumb { background: #2f6fed; border-radius: 11px; border: 4px solid #050505; min-width: 40px; }
            .painho-timeline-scroll::-webkit-scrollbar-thumb:hover { background: #4d8bff; }
          `}</style>
          <div
            ref={timelineScrollRef}
            className="painho-timeline-scroll"
            style={{ position: 'relative', width: '100%', overflowX: 'auto', background: '#111', borderRadius: 6, padding: '28px 0 10px', marginTop: 14, touchAction: 'pan-x' }}
            onPointerDown={(e) => {
              // clicar/arrastar no FUNDO do bloco (não na agulha) navega pra aquele ponto
              timelineScrub.current = true
              const rect = e.currentTarget.getBoundingClientRect()
              scrubToClientX(e.clientX, rect.left, e.currentTarget.scrollLeft)
            }}
            onPointerMove={(e) => {
              if (reorderingIdx !== null || !timelineScrub.current) return
              autoScrollTimelineEdge(e.clientX) // arrastar pra perto da beira rola a timeline sozinha
              const rect = e.currentTarget.getBoundingClientRect()
              scrubToClientX(e.clientX, rect.left, e.currentTarget.scrollLeft)
            }}
            onPointerUp={() => { timelineScrub.current = false }}
            onPointerLeave={() => { timelineScrub.current = false }}
          >
            <div ref={trackRef} style={{ position: 'relative', height: 56, width: Math.max(1, totalKeptDuration * pxPerSec) }}>
              {/* blocos = pedaços mantidos do vídeo; clicar num bloco seleciona (pra poder excluir). Durante o
                  arrasto pra reordenar: o pedaço arrastado some daqui (vira só o fantasma abaixo) e os OUTROS
                  pedaços se empacotam em sequência (otherIndices/insertPositionAt — a MESMA conta usada pra
                  decidir onde soltar), com uma LINHA de inserção marcando exatamente onde ele vai entrar. Usar
                  a mesma conta nos dois lugares é o que garante o pedaço realmente ir pro lugar onde a linha
                  tá — antes a detecção usava uma posição diferente da desenhada, então soltar geralmente não
                  tinha efeito (resolvia de volta pro próprio pedaço arrastado). */}
              {(() => {
                if (reorderingIdx === null) {
                  const lefts = staticLefts()
                  return keptRanges.map(([s, e], i) => {
                    const left = lefts[i]
                    const width = (e - s) * pxPerSec
                    return (
                      <div
                        key={`${s}-${e}-${i}`}
                        onPointerDown={onSegmentPointerDown(i)}
                        onPointerUp={onSegmentPointerUp(i)}
                        onPointerLeave={onSegmentPointerLeave}
                        style={{
                          position: 'absolute', left, width: Math.max(2, width - 2), top: 0, height: 56,
                          background: i === selectedRange
                            ? 'repeating-linear-gradient(45deg, #c0392b, #c0392b 8px, #992d22 8px, #992d22 16px)'
                            : 'repeating-linear-gradient(90deg, #2a3f5f, #2a3f5f 18px, #233a56 18px, #233a56 36px)',
                          border: i === selectedRange ? '2px solid #ff6b5b' : '1px solid #3a5278',
                          borderRadius: 4, cursor: 'pointer', boxSizing: 'border-box', zIndex: 1,
                          touchAction: 'none',
                        }}
                        title={`${s.toFixed(1)}s – ${e.toFixed(1)}s (clique seleciona, clique e arraste pra reordenar)`}
                      />
                    )
                  })
                }
                const others = otherIndices(reorderingIdx)
                const insertAt = reorderOverIdx ?? others.length
                let acc = 0
                let insertLineX = 0
                const blocks = others.map((idx, k) => {
                  if (k === insertAt) insertLineX = acc
                  const [s, e] = keptRanges[idx]
                  const width = (e - s) * pxPerSec
                  const left = acc
                  acc += width
                  return (
                    <div
                      key={`${s}-${e}-${idx}`}
                      onPointerDown={onSegmentPointerDown(idx)}
                      onPointerLeave={onSegmentPointerLeave}
                      style={{
                        position: 'absolute', left, width: Math.max(2, width - 2), top: 0, height: 56,
                        background: 'repeating-linear-gradient(90deg, #2a3f5f, #2a3f5f 18px, #233a56 18px, #233a56 36px)',
                        border: '1px solid #3a5278', borderRadius: 4, boxSizing: 'border-box', zIndex: 1,
                        transition: 'left 0.15s ease',
                      }}
                    />
                  )
                })
                if (insertAt === others.length) insertLineX = acc
                return (
                  <>
                    {blocks}
                    <div style={{ position: 'absolute', left: insertLineX - 1, top: -2, width: 3, height: 60, background: '#ffd43b', boxShadow: '0 0 10px 2px #ffd43b99', zIndex: 15, borderRadius: 2 }} />
                  </>
                )
              })()}

              {/* fantasma: segue o dedo/mouse de verdade durante o arrasto, piscando — o pedaço real some do
                  lugar original e aparece aqui, grudado no ponteiro. */}
              {reorderingIdx !== null && dragGhostX !== null && (
                <div
                  style={{
                    position: 'absolute', top: 0, height: 56, zIndex: 20, pointerEvents: 'none',
                    left: dragGhostX - ((keptRanges[reorderingIdx][1] - keptRanges[reorderingIdx][0]) * pxPerSec) / 2,
                    width: Math.max(2, (keptRanges[reorderingIdx][1] - keptRanges[reorderingIdx][0]) * pxPerSec - 2),
                    background: '#2f6fed', border: '2px solid #9ec3ff', borderRadius: 4,
                    animation: 'capcutBlink 0.7s ease-in-out infinite', boxShadow: '0 4px 16px #000a',
                  }}
                />
              )}
              <style>{'@keyframes capcutBlink { 0%,100% { opacity: 0.35 } 50% { opacity: 0.8 } }'}</style>

              {/* agulha: posição do frame atual — arrasta livre em qualquer frame. Área de toque bem mais larga
                  que o traço visual (fácil de pegar), captura o ponteiro no próprio elemento que tem o handler
                  (não num filho), e touchAction:none pra não brigar com o gesto de rolar a timeline no touch. */}
              <div
                onPointerDown={(e) => {
                  e.stopPropagation()
                  timelineScrub.current = true
                  ;(e.currentTarget as Element).setPointerCapture(e.pointerId)
                }}
                onPointerMove={(e) => {
                  if (!timelineScrub.current) return
                  autoScrollTimelineEdge(e.clientX) // arrastar a agulha pra perto da beira rola a timeline sozinha
                  const container = (e.currentTarget.parentElement as HTMLElement)
                  const rect = container.getBoundingClientRect()
                  scrubToClientX(e.clientX, rect.left, 0)
                }}
                onPointerUp={(e) => { timelineScrub.current = false; (e.currentTarget as Element).releasePointerCapture(e.pointerId) }}
                style={{
                  position: 'absolute', left: activeTimelineTime() * pxPerSec - 14, top: -6, width: 28, height: 68,
                  cursor: 'ew-resize', zIndex: 5, touchAction: 'none', display: 'flex', justifyContent: 'center',
                }}
              >
                <div style={{ width: 2, height: 68, background: '#ffd43b', pointerEvents: 'none' }} />
                <div style={{ position: 'absolute', top: -6, width: 16, height: 16, borderRadius: '50%', background: '#ffd43b', border: '2px solid #fff', pointerEvents: 'none' }} />
              </div>
            </div>
          </div>
          <p style={{ fontSize: 11, color: '#888', marginTop: 4 }}>
            {activeTimelineTime().toFixed(1)}s / {totalKeptDuration.toFixed(1)}s — arraste o bloco ou a
            agulha pra navegar, clique num pedaço pra selecionar antes de excluir.
          </p>
        </div>
      )}
    </div>
  )
})

export default Editor
