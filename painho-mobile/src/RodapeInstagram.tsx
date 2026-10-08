import { useId, useMemo } from "react";
import { PrimeirasLogoFull } from "./PrimeirasLogo";
import { CollabUsersIcon3D } from "./CollabUsersIcon3D";

function InstagramIcon({ x, y, size = 42 }: { x: number; y: number; size?: number }) {
  const uid = useId().replace(/:/g, "");
  const gradId = `ig-${uid}`;

  return (
    <g transform={`translate(${x} ${y})`}>
      <defs>
        <radialGradient id={gradId} cx="31%" cy="106%" r="128%">
          <stop offset="0%" stopColor="#FFD600" />
          <stop offset="28%" stopColor="#FF7A00" />
          <stop offset="49%" stopColor="#FF0169" />
          <stop offset="72%" stopColor="#D300C5" />
          <stop offset="100%" stopColor="#7638FA" />
        </radialGradient>
      </defs>
      <rect width={size} height={size} rx={size * 0.24} fill={`url(#${gradId})`} />
      <rect
        x={size * 0.205}
        y={size * 0.205}
        width={size * 0.59}
        height={size * 0.59}
        rx={size * 0.19}
        fill="none"
        stroke="#FFF"
        strokeWidth={size * 0.064}
      />
      <circle
        cx={size * 0.5}
        cy={size * 0.5}
        r={size * 0.145}
        fill="none"
        stroke="#FFF"
        strokeWidth={size * 0.064}
      />
      <circle cx={size * 0.68} cy={size * 0.32} r={size * 0.047} fill="#FFF" />
    </g>
  );
}

function textWidth(text: string, font: string) {
  if (typeof document === "undefined") return text.length * 13;
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return text.length * 13;
  ctx.font = font;
  return ctx.measureText(text).width;
}

const FOOTER_FONT_PX = 24
const FOOTER_FONT = `700 ${FOOTER_FONT_PX}px Arial`
const LOGO_W = 252, LEFT_PAD = 20, LOGO_GAP = 21, DIVIDER_GAP = 21, CHIP_GAP = 22, RIGHT_PAD = 58, ICON_SIZE = 38
const MAX_W = 946, MIN_W = 570
// centro visual real do desenho do ícone de collab (o path tem folga desigual nas bordas, não é uma caixa
// quadrada perfeita) — usado pra centralizar de verdade dentro do próprio slot.
const COLLAB_ICON_CX_FRAC = 14.15 / 28
const COLLAB_ICON_CY_FRAC = 13 / 28

// Regra: sem nenhum collab, a conta principal aparece com ícone do Instagram + @handle normalmente. Com 1+
// collabs, a conta principal vira só o ícone de "colaboração" (sem texto, centralizado no próprio slot) e as
// collabs entram do lado, cada uma com seu ícone do Instagram + @handle — exatamente como antes, só mudando
// esse primeiro item.
export function rodapeNaturalWidth(handle: string, collabs: string[]) {
  const main = handle?.trim() || "@primeirasnoticias_"
  const clean = collabs.filter(Boolean)
  const hasCollabs = clean.length > 0
  const firstW = hasCollabs ? ICON_SIZE : ICON_SIZE + 11 + textWidth(main, FOOTER_FONT)
  const restW = clean.reduce((sum, c) => sum + ICON_SIZE + 11 + textWidth(c, FOOTER_FONT), 0)
  const count = hasCollabs ? 1 + clean.length : 1
  const rawWidth = LEFT_PAD + LOGO_W + LOGO_GAP + 2 + DIVIDER_GAP + firstW + restW + CHIP_GAP * Math.max(0, count - 1) + RIGHT_PAD
  return Math.min(MAX_W, Math.max(MIN_W, rawWidth))
}

type RodapeInstagramProps = {
  handle?: string;
  collabs: string[];
};

export function RodapeInstagram({
  handle = "@primeirasnoticias_",
  collabs,
}: RodapeInstagramProps) {
  const uid = useId().replace(/:/g, "");
  const bgId = `footer-bg-${uid}`;
  const edgeId = `footer-edge-${uid}`;
  const shadowId = `footer-shadow-${uid}`;

  const main = handle?.trim() || "@primeirasnoticias_";
  const cleanCollabs = useMemo(() => collabs.filter(Boolean), [collabs]);
  const hasCollabs = cleanCollabs.length > 0;
  // "owner" = item especial sem texto (vira só o ícone de collab) quando existem collabs
  const accounts = useMemo(() => (hasCollabs ? ["__owner__", ...cleanCollabs] : [main]), [hasCollabs, cleanCollabs, main]);

  const logoW = LOGO_W;
  const leftPad = LEFT_PAD;
  const logoGap = LOGO_GAP;
  const dividerGap = DIVIDER_GAP;
  const chipGap = CHIP_GAP;
  const rightPad = RIGHT_PAD;
  const iconSize = ICON_SIZE;
  const fontPx = FOOTER_FONT_PX;
  const font = FOOTER_FONT;
  const itemWidths = accounts.map((a) => (a === "__owner__" ? iconSize : iconSize + 11 + textWidth(a, font)));

  const rawWidth =
    leftPad +
    logoW +
    logoGap +
    2 +
    dividerGap +
    itemWidths.reduce((sum, w) => sum + w, 0) +
    chipGap * Math.max(0, accounts.length - 1) +
    rightPad;

  const maxW = MAX_W;
  const width = Math.min(maxW, Math.max(MIN_W, rawWidth));
  const squeeze = rawWidth > maxW ? maxW / rawWidth : 1;
  const h = 104;

  let cursor = leftPad + logoW + logoGap + 2 + dividerGap;

  return (
    <g>
      <defs>
        <linearGradient id={bgId} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#031328" />
          <stop offset="54%" stopColor="#052C5E" />
          <stop offset="100%" stopColor="#0752A7" />
        </linearGradient>
        <linearGradient id={edgeId} x1="0" y1="0" x2={width} y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#54E7FF" />
          <stop offset="52%" stopColor="#0EAFFF" />
          <stop offset="100%" stopColor="#30DBFF" />
        </linearGradient>
        <filter id={shadowId} x="-12%" y="-70%" width="140%" height="250%">
          <feDropShadow dx="0" dy="14" stdDeviation="15" floodColor="#001124" floodOpacity="0.72" />
        </filter>
      </defs>

      <path
        d={`M 18 0 H ${width - 54} L ${width} 0 L ${width - 48} ${h} H 18 Q 0 ${h} 0 ${h - 18} V 18 Q 0 0 18 0 Z`}
        fill={`url(#${bgId})`}
        filter={`url(#${shadowId})`}
      />
      <path
        d={`M 18 0 H ${width - 54} M ${width - 54} 0 L ${width} 0 L ${width - 48} ${h}`}
        stroke={`url(#${edgeId})`}
        strokeWidth="3.5"
        fill="none"
      />

      <PrimeirasLogoFull x={leftPad} y={14} width={logoW - 18} />

      <line
        x1={leftPad + logoW}
        y1="23"
        x2={leftPad + logoW}
        y2={h - 23}
        stroke="#66E6FF"
        strokeWidth="2"
        opacity="0.52"
      />

      <g transform={`scale(${squeeze} 1)`}>
        {accounts.map((account, index) => {
          const itemW = itemWidths[index];
          const currentX = cursor;
          cursor += itemW + chipGap;
          const isOwner = account === "__owner__";

          return (
            <g key={`${account}-${index}`}>
              {isOwner ? (() => {
                // Centraliza no espaço VISUAL de verdade: entre a divisória depois da logo e a divisória
                // antes do próximo item — não só dentro da fatia estreita (itemW) que o ícone ocupa no
                // layout, senão ele fica cravado lá no fim dessa fatia (bem à direita, perto da próxima
                // divisória), com um vão enorme vazio à esquerda.
                const s = iconSize * 0.76
                const leftDividerX = leftPad + logoW
                const rightDividerX = currentX + itemW + chipGap / 2
                const slotCenterX = (leftDividerX + rightDividerX) / 2
                const slotCenterY = h / 2
                return (
                  <CollabUsersIcon3D
                    x={slotCenterX - s * COLLAB_ICON_CX_FRAC}
                    y={slotCenterY - s * COLLAB_ICON_CY_FRAC}
                    size={s}
                  />
                )
              })() : (
                <>
                  <InstagramIcon x={currentX} y={(h - iconSize) / 2} size={iconSize} />
                  <text
                    x={currentX + iconSize + 11}
                    y="62"
                    fill="#FFFFFF"
                    fontFamily="Arial, sans-serif"
                    fontSize={fontPx}
                    fontWeight="700"
                    letterSpacing="-0.25"
                  >
                    {account}
                  </text>
                </>
              )}

              {index < accounts.length - 1 && (
                <line
                  x1={currentX + itemW + chipGap / 2}
                  y1="28"
                  x2={currentX + itemW + chipGap / 2}
                  y2={h - 28}
                  stroke="#68E5FF"
                  strokeWidth="2"
                  opacity="0.45"
                />
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}
