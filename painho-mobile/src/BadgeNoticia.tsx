import { useEffect, useId, useRef } from "react";
import { motion } from "framer-motion";

const TITLE_FONT = `Impact, Haettenschweiler, "Arial Narrow Bold", "Arial Narrow", Arial, sans-serif`;

type BadgeVariant = "normal" | "urgente" | "exclusivo";

type BadgeNoticiaProps = {
  variant?: BadgeVariant;
  /** só pro variant "normal": texto livre digitado pelo usuário, no lugar do "NOTÍCIA" fixo */
  label?: string;
  onLabelChange?: (text: string) => void;
};

const BADGES = {
  normal: {
    label: "NOTÍCIA",
    w: 270,
    bg0: "#05245D",
    bg1: "#0879E8",
    edge: "#3CDFFF",
    dot: "#FFFFFF",
  },
  urgente: {
    label: "URGENTE",
    w: 294,
    bg0: "#57030A",
    bg1: "#F0192D",
    edge: "#FF5163",
    dot: "#FFFFFF",
  },
  exclusivo: {
    label: "EXCLUSIVO",
    w: 316,
    bg0: "#173251",
    bg1: "#456A95",
    edge: "#E2F4FF",
    dot: "#FFFFFF",
  },
} as const;

export function BadgeNoticia({ variant = "normal", label, onLabelChange }: BadgeNoticiaProps) {
  const cfg = BADGES[variant];
  const uid = useId().replace(/:/g, "");
  const bgId = `badge-bg-${uid}`;
  const clipId = `badge-clip-${uid}`;
  const glowId = `badge-glow-${uid}`;
  const h = 76;
  const editorRef = useRef<HTMLDivElement | null>(null);

  // "normal" é texto livre do usuário — a largura do badge acompanha o tamanho do texto digitado
  const displayLabel = variant === "normal" ? (label ?? cfg.label) : cfg.label;
  const w = variant === "normal" ? Math.max(220, 70 + displayLabel.length * 17) : cfg.w;

  useEffect(() => {
    // Mesmo bug do título: se o React reescreve o textContent a cada render enquanto o usuário digita, o
    // cursor reseta pro início a cada tecla. Só sincroniza quando o texto vier de FORA do próprio campo.
    const el = editorRef.current;
    if (!el) return;
    if ((el.textContent ?? "") !== displayLabel) el.textContent = displayLabel;
  }, [displayLabel]);

  const path = `M 20 0 H ${w} L ${w - 28} ${h} H 0 V 20 Q 0 0 20 0 Z`;

  return (
    <motion.g
      animate={variant === "urgente" ? { scale: [1, 1.018, 1] } : { scale: 1 }}
      transition={variant === "urgente" ? { duration: 0.92, repeat: Infinity, ease: "easeInOut" } : undefined}
      style={{ transformOrigin: `${w / 2}px ${h / 2}px` }}
    >
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2={w} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={cfg.bg0} />
          <stop offset="100%" stopColor={cfg.bg1} />
        </linearGradient>
        <clipPath id={clipId}>
          <path d={path} />
        </clipPath>
        <filter id={glowId} x="-45%" y="-120%" width="200%" height="340%">
          <feGaussianBlur stdDeviation={variant === "urgente" ? 8 : 5} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={path} fill={`url(#${bgId})`} stroke={cfg.edge} strokeWidth="2.5" />

      <motion.rect
        x="-110"
        y="-20"
        width="68"
        height="118"
        fill="rgba(255,255,255,.34)"
        transform="skewX(-22)"
        clipPath={`url(#${clipId})`}
        animate={{ x: [-110, w + 120] }}
        transition={{
          duration: variant === "urgente" ? 1.05 : 1.9,
          repeat: Infinity,
          repeatDelay: variant === "urgente" ? 0.3 : 1.0,
          ease: "easeInOut",
        }}
      />

      <motion.circle
        cx="39"
        cy="38"
        r="10"
        fill={cfg.dot}
        filter={`url(#${glowId})`}
        animate={{ opacity: [0.66, 1, 0.66], scale: [0.86, 1.08, 0.86] }}
        transition={{ duration: variant === "urgente" ? 0.62 : 1.5, repeat: Infinity }}
        style={{ transformOrigin: "39px 38px" }}
      />

      {variant === "normal" && onLabelChange ? (
        <foreignObject x="60" y="16" width={w - 90} height="44">
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            onInput={(e) => onLabelChange(e.currentTarget.textContent ?? "")}
            onPointerDown={(e) => e.stopPropagation()}
            style={{
              width: "100%", height: "100%", outline: "none", display: "flex", alignItems: "center",
              color: "#FFFFFF", fontFamily: TITLE_FONT, fontSize: 34, fontWeight: 900, fontStyle: "italic",
              letterSpacing: 0.5, whiteSpace: "nowrap", overflow: "hidden",
            }}
          />
        </foreignObject>
      ) : (
        <text
          x="70"
          y="50"
          fill="#FFFFFF"
          fontFamily={TITLE_FONT}
          fontSize="34"
          fontWeight="900"
          fontStyle="italic"
          letterSpacing="0.5"
        >
          {displayLabel}
        </text>
      )}

      {[0, 1, 2].map((i) => (
        <path
          key={i}
          d={`M ${w - 4 + i * 13} 13 L ${w + 15 + i * 13} 13 L ${w - 15 + i * 13} 63 L ${w - 34 + i * 13} 63 Z`}
          fill={variant === "urgente" ? "#FF2438" : variant === "exclusivo" ? "#6C8FB8" : "#0877DF"}
          opacity={0.9 - i * 0.19}
        />
      ))}

      <motion.line
        x1="65"
        y1="1"
        x2={w - 54}
        y2="1"
        stroke={cfg.edge}
        strokeWidth="3"
        strokeLinecap="round"
        filter={`url(#${glowId})`}
        animate={{ opacity: [0.25, 1, 0.25] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      />
    </motion.g>
  );
}
