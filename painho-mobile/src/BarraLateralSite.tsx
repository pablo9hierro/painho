import { useId } from "react";

export function BarraLateralSite() {
  const uid = useId().replace(/:/g, "");
  const bgId = `rail-bg-${uid}`;
  const glowId = `rail-glow-${uid}`;
  const dotsId = `rail-dots-${uid}`;
  const shadowId = `rail-shadow-${uid}`;

  return (
    <g>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2="92" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#03142E" />
          <stop offset="50%" stopColor="#0759BC" />
          <stop offset="100%" stopColor="#00B7FF" />
        </linearGradient>
        <filter id={glowId} x="-100%" y="-10%" width="300%" height="120%">
          <feGaussianBlur stdDeviation="6" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        {/* sombra nas DUAS direções (pra cima e pra baixo, mesma proporção) — duas cópias desfocadas da forma,
            uma deslocada pra baixo e outra pra cima, escurecidas e misturadas atrás do conteúdo real. */}
        <filter id={shadowId} x="-60%" y="-20%" width="220%" height="140%">
          <feGaussianBlur in="SourceAlpha" stdDeviation="12" result="blur" />
          <feOffset in="blur" dx="0" dy="16" result="shadowDown" />
          <feOffset in="blur" dx="0" dy="-16" result="shadowUp" />
          <feMerge result="shadows">
            <feMergeNode in="shadowDown" />
            <feMergeNode in="shadowUp" />
          </feMerge>
          <feColorMatrix in="shadows" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.5 0" result="shadowColored" />
          <feMerge>
            <feMergeNode in="shadowColored" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <pattern id={dotsId} width="13" height="13" patternUnits="userSpaceOnUse">
          <circle cx="2.5" cy="2.5" r="1.4" fill="#7AEAFF" opacity="0.17" />
        </pattern>
      </defs>

      {/* cortado 15% de cada lado (132 -> 92): tira a margem vazia, fica só a faixa com a URL mesmo */}
      <path
        d="M 0 0 H 92 L 76 130 L 92 165 L 80 884 L 92 925 L 80 1752 L 0 1826 Z"
        fill={`url(#${bgId})`}
        opacity="0.93"
        filter={`url(#${shadowId})`}
      />

      <rect x="0" y="515" width="92" height="305" fill={`url(#${dotsId})`} opacity="0.82" />

      <path d="M 61 86 V 1832" stroke="#5BEAFF" strokeWidth="3.5" filter={`url(#${glowId})`} />
      <path d="M 76 90 V 160" stroke="#E9FBFF" strokeWidth="2.4" opacity="0.9" />
      <path d="M 76 1745 V 1814" stroke="#E9FBFF" strokeWidth="2.4" opacity="0.9" />

      <path d="M 0 60 L 92 154 V 0 H 0 Z" fill="#006FDD" opacity="0.48" />
      <path d="M 0 1690 L 92 1775 L 0 1826 Z" fill="#006FDD" opacity="0.5" />

      {/* texto esticado pra ocupar 40% da altura vertical do trilho (1826 * 0.4 ≈ 730px), via textLength,
          centralizado no trilho (y ajustado pra nova largura de 92). */}
      <text
        x="-1278"
        y="48"
        transform="rotate(-90)"
        fill="#FFFFFF"
        fontFamily="Arial, sans-serif"
        fontSize="24"
        fontWeight="500"
        letterSpacing="0.35"
        textLength="730"
        lengthAdjust="spacingAndGlyphs"
      >
        www.primeirasnoticias.com.br
      </text>
    </g>
  );
}
