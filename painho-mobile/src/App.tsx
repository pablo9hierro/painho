import { useMemo, useRef, useState } from 'react'
import Editor, { type EditorHandle } from './Editor'

type Phase = 'editing' | 'caption' | 'done'

// o backend que já fala com o Cloudinary + Graph API do Instagram é o painho.js (rodando na pasta raiz do
// Painho, `npm start`, porta 3001 por padrão) — é nele que a rota /api/publish-reel foi adicionada. Se abrir
// esse editor de um celular na mesma rede (não no mesmo PC), troca "localhost" pelo IP do PC na rede local.
const BACKEND_URL = 'http://localhost:3001'

type PublishResult = { fileName: string; ok: boolean; postId?: string; error?: string }

function App() {
  const [videoFiles, setVideoFiles] = useState<File[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [phase, setPhase] = useState<Phase>('editing')
  const [caption, setCaption] = useState('')
  const [collabDraft, setCollabDraft] = useState('')
  const [collabs, setCollabs] = useState<string[]>([])
  const [showDownloadPopup, setShowDownloadPopup] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState(0)
  const [exportError, setExportError] = useState('')
  const editorRef = useRef<EditorHandle>(null)
  // vídeo já exportado (moldura queimada) de CADA vídeo, guardado assim que passa pro próximo — o Editor de
  // um vídeo anterior desmonta ao avançar (key={currentIndex}), então precisa guardar o blob antes disso,
  // senão na hora de publicar todos não tem mais como re-exportar o que já ficou pra trás.
  const editedBlobsRef = useRef<Map<number, Blob>>(new Map())
  const [publishing, setPublishing] = useState(false)
  const [publishResults, setPublishResults] = useState<PublishResult[]>([])

  const videoSrc = useMemo(() => {
    const f = videoFiles[currentIndex]
    return f ? URL.createObjectURL(f) : ''
  }, [videoFiles, currentIndex])

  // Instagram permite no máximo 3 collabs convidados por post/reel (além do dono) — trava o input no teto real.
  const MAX_COLLABS = 3
  const addCollab = () => {
    if (collabs.length >= MAX_COLLABS) return
    const h = collabDraft.trim().replace(/^@*/, '@')
    if (h === '@' || collabs.includes(h)) return
    setCollabs((prev) => [...prev, h])
    setCollabDraft('')
  }

  const onPickFiles = (files: FileList | null) => {
    if (!files || !files.length) return
    setVideoFiles(Array.from(files))
    setCurrentIndex(0)
    setPhase('editing')
    setCaption('')
  }

  const removeVideo = (idx: number) => {
    setVideoFiles((prev) => prev.filter((_, i) => i !== idx))
    // se tirou um antes do vídeo que tava sendo editado (ou ele mesmo), o índice atual recua junto
    setCurrentIndex((i) => (idx <= i ? Math.max(0, i - 1) : i))
  }

  // exporta o vídeo atual (se ainda não tiver sido exportado) e guarda o blob pra publicar depois — reusado
  // tanto pelo botão de baixar quanto por avançar de vídeo, pra nunca ficar sem o resultado final de nenhum.
  const exportCurrent = async (): Promise<Blob | null> => {
    const cached = editedBlobsRef.current.get(currentIndex)
    if (cached) return cached
    if (!editorRef.current) return null
    setExporting(true)
    setExportProgress(0)
    setExportError('')
    try {
      const blob = await editorRef.current.exportVideo((pct) => setExportProgress(pct))
      editedBlobsRef.current.set(currentIndex, blob)
      return blob
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
      return null
    } finally {
      setExporting(false)
    }
  }

  const goNextVideo = async () => {
    await exportCurrent() // garante que o vídeo atual fica guardado antes de desmontar o Editor dele
    setShowDownloadPopup(false)
    if (currentIndex < videoFiles.length - 1) setCurrentIndex((i) => i + 1)
    else setPhase('caption')
  }

  const downloadEdited = async (): Promise<boolean> => {
    try {
      const blob = await exportCurrent()
      if (!blob) return false
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${videoFiles[currentIndex]?.name.replace(/\.[^.]+$/, '') || 'reel'}-editado.mp4`
      a.click()
      URL.revokeObjectURL(url)
      return true
    } catch (err) {
      setExportError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setExporting(false)
    }
  }

  const finish = async () => {
    await exportCurrent() // garante o último vídeo (ainda montado) também guardado antes de ir pra tela final
    setPhase('done')
  }

  // publica de verdade: manda cada vídeo editado pro backend do Painho (/api/publish-reel), que sobe pro
  // Cloudinary e posta no Instagram via Graph API — um Reel por vídeo, mesma legenda/collabs nos dois.
  const publishAll = async () => {
    setPublishing(true)
    setPublishResults([])
    const results: PublishResult[] = []
    for (let i = 0; i < videoFiles.length; i++) {
      const fileName = videoFiles[i].name
      const blob = editedBlobsRef.current.get(i)
      if (!blob) { results.push({ fileName, ok: false, error: 'vídeo não foi exportado (passa por ele de novo antes de publicar)' }); continue }
      try {
        const form = new FormData()
        form.append('video', blob, fileName.replace(/\.[^.]+$/, '') + '.mp4')
        form.append('caption', caption)
        form.append('collaborators', JSON.stringify(collabs))
        const resp = await fetch(`${BACKEND_URL}/api/publish-reel`, { method: 'POST', body: form })
        const data = await resp.json()
        if (!resp.ok) throw new Error(data.error || `HTTP ${resp.status}`)
        results.push({ fileName, ok: true, postId: data.postId })
      } catch (err) {
        results.push({ fileName, ok: false, error: err instanceof Error ? err.message : String(err) })
      }
      setPublishResults([...results])
    }
    setPublishing(false)
  }

  return (
    <div style={{ maxWidth: 480, minWidth: 0, width: '100%', boxSizing: 'border-box', margin: '0 auto', padding: 16, fontFamily: 'Arial, sans-serif', position: 'relative', overflowX: 'hidden' }}>
      <div style={{ position: 'sticky', top: 0, background: '#fff', zIndex: 10, paddingBottom: 8, borderBottom: '1px solid #ddd' }}>
        <h1 style={{ fontSize: 16, margin: '8px 0 4px' }}>Painho — editor de Reels</h1>
        <input type="file" accept="video/*" multiple onChange={(e) => onPickFiles(e.target.files)} />
        {videoFiles.length > 0 && (
          <span style={{ fontSize: 12, color: '#060', marginLeft: 8 }}>
            ✓ {videoFiles.length} vídeo{videoFiles.length > 1 ? 's' : ''} selecionado{videoFiles.length > 1 ? 's' : ''}
          </span>
        )}
        {videoFiles.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
            {videoFiles.map((f, i) => (
              <div key={`${f.name}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: i === currentIndex && phase === 'editing' ? '#1a7a3a' : '#555' }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {i === currentIndex && phase === 'editing' ? '▶ ' : ''}{f.name}
                </span>
                <button
                  onClick={() => removeVideo(i)}
                  title="Apagar este vídeo da lista pra editar"
                  style={{ background: '#c0392b', color: '#fff', border: 'none', borderRadius: 4, width: 20, height: 20, lineHeight: 1, cursor: 'pointer', fontSize: 12, flexShrink: 0 }}
                >✕</button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, margin: '10px 0' }}>
        <input
          value={collabDraft}
          onChange={(e) => setCollabDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addCollab()}
          placeholder="@collab"
          disabled={collabs.length >= MAX_COLLABS}
          style={{ padding: '4px 8px' }}
        />
        <button
          onClick={addCollab}
          disabled={collabs.length >= MAX_COLLABS}
          style={{ padding: '8px 14px', borderRadius: 8, border: '1px solid #2a3b55', background: collabs.length >= MAX_COLLABS ? '#8893a3' : '#1b263b', color: '#fff', fontSize: 13, cursor: collabs.length >= MAX_COLLABS ? 'not-allowed' : 'pointer' }}
        >+ Collab</button>
        <span style={{ fontSize: 11, color: '#999' }}>{collabs.length}/{MAX_COLLABS} (máximo do Instagram)</span>
        {collabs.map((c) => (
          <span key={c} style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#1a2636', color: '#fff', borderRadius: 4, padding: '3px 8px', fontSize: 13 }}>
            {c}
            <button onClick={() => setCollabs((prev) => prev.filter((x) => x !== c))} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', padding: 0, lineHeight: 1 }}>✕</button>
          </span>
        ))}
      </div>

      {videoFiles.length === 0 && (
        <div style={{ color: '#999', fontSize: 13, marginTop: 12 }}>Selecione um ou mais vídeos acima pra começar a editar.</div>
      )}

      {videoFiles.length > 0 && phase === 'editing' && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '4px 0 8px', flexWrap: 'wrap', gap: 6 }}>
            <strong style={{ fontSize: 13 }}>
              Vídeo {currentIndex + 1} de {videoFiles.length} — {videoFiles[currentIndex].name}
            </strong>
            <div style={{ display: 'flex', gap: 6 }}>
              {/* sempre disponível, sem depender do popup — baixa o que já tá editado AGORA, na hora que quiser */}
              <button
                onClick={downloadEdited}
                disabled={exporting}
                style={{ fontWeight: 700, background: exporting ? '#555' : '#2f6fed', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: exporting ? 'wait' : 'pointer' }}
              >
                {exporting ? `Baixando... ${Math.round(exportProgress * 100)}%` : '⬇️ Baixar agora'}
              </button>
              <button
                onClick={() => setShowDownloadPopup(true)}
                disabled={exporting}
                style={{ fontWeight: 700, background: '#1a7a3a', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px' }}
              >
                {currentIndex < videoFiles.length - 1 ? 'OK, próximo vídeo →' : 'OK, finalizar edição →'}
              </button>
            </div>
          </div>
          {exporting && (
            <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', margin: '0 0 8px' }}>
              <div style={{ height: '100%', width: `${Math.round(exportProgress * 100)}%`, background: '#2f6fed', transition: 'width 0.2s ease' }} />
            </div>
          )}
          {exportError && (
            <p style={{ fontSize: 12, color: '#ff6b5b', margin: '0 0 8px' }}>Não deu pra baixar: {exportError}</p>
          )}
          {/* key muda a cada vídeo: cada um começa com a moldura em branco, edição independente */}
          <Editor ref={editorRef} key={currentIndex} videoSrc={videoSrc} handle="@primeirasnoticias_" collabs={collabs} />
        </>
      )}

      {phase === 'caption' && (
        <div>
          <p style={{ fontSize: 13 }}>Todos os {videoFiles.length} vídeos editados. Legenda (opcional) pra usar em todas as postagens:</p>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Escreva a legenda/descrição da postagem (opcional)..."
            rows={5}
            style={{ width: '100%', boxSizing: 'border-box', padding: 8, fontFamily: 'Arial, sans-serif' }}
          />
          <button onClick={finish} style={{ marginTop: 8, fontWeight: 700, background: '#1a7a3a', color: '#fff', border: 'none', borderRadius: 4, padding: '8px 16px' }}>
            Concluir
          </button>
        </div>
      )}

      {phase === 'done' && (
        <div style={{ fontSize: 13 }}>
          <p>✓ {videoFiles.length} vídeo(s) editados{caption ? ' com legenda' : ''}.</p>
          <p style={{ color: '#666' }}>
            Publica de verdade no Instagram @primeirasnoticias_ (convidando {collabs.join(', ') || 'nenhum collab'})
            via o backend do Painho — precisa estar rodando em {BACKEND_URL} (<code>npm start</code> na pasta do Painho).
          </p>
          <button
            onClick={publishAll}
            disabled={publishing}
            style={{ fontWeight: 700, background: publishing ? '#555' : '#c13584', color: '#fff', border: 'none', borderRadius: 4, padding: '10px 18px', cursor: publishing ? 'wait' : 'pointer' }}
          >
            {publishing ? 'Publicando...' : '📸 Publicar no Instagram'}
          </button>
          {publishResults.length > 0 && (
            <ul style={{ marginTop: 10, paddingLeft: 18 }}>
              {publishResults.map((r) => (
                <li key={r.fileName} style={{ color: r.ok ? '#1a7a3a' : '#c0392b' }}>
                  {r.fileName}: {r.ok ? `publicado (post ${r.postId})` : `falhou — ${r.error}`}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* popup estilizado: baixar o vídeo editado (com a moldura já "queimada" nele) antes de ir pro próximo */}
      {showDownloadPopup && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div style={{ background: '#161b22', color: '#fff', borderRadius: 12, padding: 24, width: 300, textAlign: 'center', boxShadow: '0 10px 40px rgba(0,0,0,0.5)' }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🎬</div>
            <h2 style={{ fontSize: 16, margin: '0 0 6px' }}>Edição concluída!</h2>
            <p style={{ fontSize: 13, color: '#aaa', margin: '0 0 18px' }}>
              Quer baixar o vídeo editado (com a moldura) na melhor qualidade antes de continuar?
            </p>
            {exporting && (
              <div style={{ height: 6, background: '#333', borderRadius: 3, overflow: 'hidden', margin: '0 0 14px' }}>
                <div style={{ height: '100%', width: `${Math.round(exportProgress * 100)}%`, background: '#1a7a3a', transition: 'width 0.2s ease' }} />
              </div>
            )}
            {exportError && (
              <p style={{ fontSize: 12, color: '#ff6b5b', margin: '0 0 14px' }}>Não deu pra baixar: {exportError}. Tenta de novo ou usa o botão "⬇️ Baixar agora".</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              <button
                onClick={goNextVideo}
                disabled={exporting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 6, border: '1px solid #444', background: 'transparent', color: '#ccc' }}
              >
                Não, continuar
              </button>
              <button
                onClick={async () => { const ok = await downloadEdited(); if (ok) goNextVideo() }}
                disabled={exporting}
                style={{ flex: 1, padding: '10px 0', borderRadius: 6, border: 'none', background: exporting ? '#2d4a35' : '#1a7a3a', color: '#fff', fontWeight: 700 }}
              >
                {exporting ? `Baixando... ${Math.round(exportProgress * 100)}%` : 'Sim, baixar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default App
