import { Component, type ErrorInfo, type ReactNode } from 'react'

// sem isso, qualquer erro em qualquer lugar do app derruba a tela INTEIRA pra branco, sem nenhuma pista do que
// quebrou (foi exatamente o que aconteceu no celular: arrastou o vídeo, tela ficou branca, nada explicado) —
// com isso, mostra o erro de verdade na tela em vez de sumir tudo sem avisar.
interface State { error: Error | null }

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 20, fontFamily: 'Arial, sans-serif', color: '#fff', background: '#1a0000' }}>
          <h2 style={{ color: '#ff6b5b' }}>Deu erro e travou aqui</h2>
          <p style={{ fontSize: 13 }}>Isso não devia acontecer — copia esse texto e manda pra eu corrigir:</p>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#000', padding: 10, borderRadius: 6, overflow: 'auto' }}>
            {this.state.error.message}
            {'\n\n'}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 12, padding: '8px 16px', background: '#2f6fed', color: '#fff', border: 'none', borderRadius: 6 }}
          >
            Tentar continuar (pode não funcionar direito)
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
