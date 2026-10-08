import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

type TituloCardProps = {
  titulo: string;
  onChange?: (text: string) => void;
  width?: number;
  height?: number;
};

const TITLE_CARD_W = 922;
const TITLE_CARD_H = 342;
const TITLE_FONT = `Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", Arial, sans-serif`;

function useTrueAutoFit(text: string, textW: number, textH: number) {
  const [fontSize, setFontSize] = useState(76);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;

    const probe = document.createElement("div");
    probe.textContent = text.toUpperCase();

    Object.assign(probe.style, {
      position: "fixed",
      left: "-100000px",
      top: "-100000px",
      width: `${textW}px`,
      height: "auto",
      visibility: "hidden",
      pointerEvents: "none",
      boxSizing: "border-box",
      padding: "0",
      margin: "0",
      border: "0",
      fontFamily: TITLE_FONT,
      fontWeight: "900",
      fontStyle: "normal",
      lineHeight: "0.98",
      letterSpacing: "0.6px",
      textTransform: "uppercase",
      whiteSpace: "pre-wrap",
      overflowWrap: "break-word",
      wordBreak: "break-word",
    });

    document.body.appendChild(probe);

    let low = 30;
    let high = 82;
    let best = low;

    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      probe.style.fontSize = `${mid}px`;

      const fits =
        probe.scrollHeight <= textH + 0.5 &&
        probe.scrollWidth <= textW + 0.5;

      if (fits) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    document.body.removeChild(probe);
    setFontSize(best);
  }, [text, textW, textH]);

  return fontSize;
}

// width/height: deixa o card ser redimensionado (alargar/aumentar) SEM esticar as letras — o padding lateral e
// vertical do texto fica sempre o mesmo (as margens abaixo são as mesmas do tamanho original 922x342), e quem
// recalcula é o auto-fit real (mede no DOM), não um transform scale que deformaria a fonte.
export function TituloCard({ titulo, onChange, width = TITLE_CARD_W, height = TITLE_CARD_H }: TituloCardProps) {
  const uid = useId().replace(/:/g, "");
  const clipId = `title-reveal-${uid}`;
  const cardClip = `title-card-clip-${uid}`;
  const bgId = `title-bg-${uid}`;
  const edgeId = `title-edge-${uid}`;
  const shadowId = `title-shadow-${uid}`;
  const glowId = `title-glow-${uid}`;
  const dotsId = `title-dots-${uid}`;
  const editorRef = useRef<HTMLDivElement | null>(null);

  // mesmas margens do tamanho original (58px esquerda, 154px direita pra área da logo/decoração, 43px topo,
  // 47px embaixo) — redimensionar o card mantém esse "teto" de respiro constante nos 4 lados.
  const textW = Math.max(120, width - 58 - 154)
  const textH = Math.max(60, height - 43 - 47)
  const fontSize = useTrueAutoFit(titulo, textW, textH)

  useEffect(() => {
    // Bug original: comparava o DOM (texto cru digitado) com uma versão .toUpperCase() e, como nunca batiam,
    // reescrevia o textContent a CADA tecla — isso resetava o cursor pro início, fazendo as letras digitadas
    // se acumularem de trás pra frente e o backspace nunca "pegar". O CSS já deixa tudo visualmente maiúsculo
    // (textTransform: uppercase), então o DOM não precisa (nem deve) ser forçado em maiúsculas aqui — só
    // sincroniza quando o texto vem de FORA (ex: carregar um item salvo), nunca durante a digitação normal.
    const el = editorRef.current;
    if (!el) return;
    if ((el.textContent ?? "") !== titulo) el.textContent = titulo;
  }, [titulo]);

  // geometria recalculada proporcionalmente ao tamanho (as peças decorativas da direita acompanham a largura;
  // o corte diagonal do canto usa o mesmo ângulo do original, só reposicionado pro novo width/height)
  const notchW = 62, notchTopCut = 15
  const cardPath = `
    M 24 0
    H ${width - notchTopCut}
    L ${width - notchW} ${height}
    H 22
    Q 0 ${height} 0 ${height - 22}
    V 24
    Q 0 0 24 0
    Z
  `;
  const rightFacetX = width * (810 / TITLE_CARD_W)
  const dotsX = width * (690 / TITLE_CARD_W)
  const dotsW = width * (210 / TITLE_CARD_W)
  const dotsH = height * (126 / TITLE_CARD_H)
  const barH = height - 70

  return (
    <g>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2={width} y2={height} gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#04152F" />
          <stop offset="30%" stopColor="#082C67" />
          <stop offset="71%" stopColor="#073D92" />
          <stop offset="100%" stopColor="#0967D0" />
        </linearGradient>

        <linearGradient id={edgeId} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#69F0FF" />
          <stop offset="42%" stopColor="#00AAFF" />
          <stop offset="100%" stopColor="#28DCFF" />
        </linearGradient>

        <pattern id={dotsId} width="14" height="14" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.6" fill="#65E7FF" opacity="0.18" />
        </pattern>

        <filter id={shadowId} x="-15%" y="-30%" width="145%" height="185%">
          <feDropShadow dx="0" dy="24" stdDeviation="23" floodColor="#001123" floodOpacity="0.75" />
        </filter>

        <filter id={glowId} x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="7" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        <clipPath id={cardClip}>
          <path d={cardPath} />
        </clipPath>

        <clipPath id={clipId}>
          <motion.rect
            x="0"
            y="0"
            height={height}
            initial={{ width: 0 }}
            animate={{ width }}
            transition={{ duration: 0.86, ease: [0.22, 1, 0.36, 1] }}
          />
        </clipPath>
      </defs>

      <g clipPath={`url(#${clipId})`}>
        <path d={cardPath} fill={`url(#${bgId})`} filter={`url(#${shadowId})`} />
        <path d={cardPath} fill="none" stroke={`url(#${edgeId})`} strokeWidth="3.5" />

        <path
          d={`M 0 0 H 110 L 77 ${height} H 0 Z`}
          fill="#007BE5"
          opacity="0.17"
          clipPath={`url(#${cardClip})`}
        />

        <rect
          x="14"
          y="34"
          width="12"
          height={barH}
          rx="6"
          fill="#61E8FF"
          filter={`url(#${glowId})`}
        />

        <path
          d={`M ${rightFacetX} 0 H ${width - notchTopCut} L ${width - notchW} ${height} H ${rightFacetX - 20} C ${rightFacetX + 15} ${height * 0.69} ${rightFacetX + 34} ${height * 0.38} ${rightFacetX} 0 Z`}
          fill="#032756"
          opacity="0.52"
          clipPath={`url(#${cardClip})`}
        />

        <rect
          x={dotsX}
          y="0"
          width={dotsW}
          height={dotsH}
          fill={`url(#${dotsId})`}
          opacity="0.9"
          clipPath={`url(#${cardClip})`}
        />

        <motion.line
          x1={width * (388 / TITLE_CARD_W)}
          y1="3"
          x2={width * (722 / TITLE_CARD_W)}
          y2="3"
          stroke="#60ECFF"
          strokeWidth="4"
          strokeLinecap="round"
          filter={`url(#${glowId})`}
          animate={{ opacity: [0.28, 1, 0.28] }}
          transition={{ duration: 2.8, repeat: Infinity, ease: "easeInOut" }}
        />

        <motion.line
          x1={width * (376 / TITLE_CARD_W)}
          y1={height - 4}
          x2={width * (664 / TITLE_CARD_W)}
          y2={height - 4}
          stroke="#1CCBFF"
          strokeWidth="3"
          strokeLinecap="round"
          animate={{ opacity: [0.18, 0.95, 0.18] }}
          transition={{ duration: 2.1, repeat: Infinity, ease: "easeInOut" }}
        />

        <foreignObject x="58" y={(height - textH) / 2} width={textW} height={textH}>
          <div
            ref={editorRef}
            contentEditable={Boolean(onChange)}
            suppressContentEditableWarning
            onInput={(e) => onChange?.(e.currentTarget.textContent ?? "")}
            spellCheck={false}
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              alignItems: "center",
              boxSizing: "border-box",
              padding: 0,
              margin: 0,
              outline: "none",
              border: 0,
              overflow: "hidden",
              color: "#FFFFFF",
              textShadow: "0 3px 3px rgba(0,0,0,.28)",
              fontFamily: TITLE_FONT,
              fontWeight: 900,
              fontSize: `${fontSize}px`,
              lineHeight: 0.98,
              letterSpacing: "0.6px",
              textTransform: "uppercase",
              whiteSpace: "pre-wrap",
              overflowWrap: "break-word",
              wordBreak: "break-word",
              cursor: onChange ? "text" : "default",
              userSelect: onChange ? "text" : "none",
            }}
          />
        </foreignObject>
      </g>
    </g>
  );
}
