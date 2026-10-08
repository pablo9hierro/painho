import { type SyntheticEvent, type VideoHTMLAttributes, useRef, useState } from "react";

type VideoStageProps = {
  src: string;
  onVideoRef?: (el: HTMLVideoElement | null) => void;
};

type VideoFitMode = "cover" | "contain-blur";

export function VideoStage({ src, onVideoRef }: VideoStageProps) {
  const [mode, setMode] = useState<VideoFitMode>("cover");
  const frontRef = useRef<HTMLVideoElement | null>(null);
  const backRef = useRef<HTMLVideoElement | null>(null);

  const onMetadata = (e: SyntheticEvent<HTMLVideoElement>) => {
    const v = e.currentTarget;
    const source = v.videoWidth / v.videoHeight;
    const target = 9 / 16;
    const proportionalDifference = Math.abs(source - target) / target;

    // Até ~18% de diferença: ainda é suficientemente próximo de 9:16 -> cover.
    // Acima disso: contain + fundo duplicado desfocado.
    setMode(proportionalDifference <= 0.18 ? "cover" : "contain-blur");
  };

  const syncBackground = () => {
    const front = frontRef.current;
    const back = backRef.current;
    if (!front || !back || mode !== "contain-blur") return;
    if (Math.abs(front.currentTime - back.currentTime) > 0.08) back.currentTime = front.currentTime;
  };

  const common: VideoHTMLAttributes<HTMLVideoElement> = {
    src,
    autoPlay: true,
    loop: true,
    playsInline: true,
    preload: "metadata",
  };

  return (
    <div style={{ position: "absolute", inset: 0, overflow: "hidden", background: "#020914" }}>
      {mode === "contain-blur" && (
        <video
          {...common}
          muted // fundo desfocado é só decoração — se tocasse som também, duplicaria o áudio
          ref={backRef}
          aria-hidden
          style={{
            position: "absolute",
            inset: -70,
            width: 1080 + 140,
            height: 1920 + 140,
            objectFit: "cover",
            filter: "blur(46px) brightness(.58) saturate(.90)",
            transform: "scale(1.10)",
          }}
        />
      )}

      <video
        {...common}
        ref={(el) => { frontRef.current = el; onVideoRef?.(el) }}
        onLoadedMetadata={onMetadata}
        onPlay={() => backRef.current?.play().catch(() => undefined)}
        onPause={() => backRef.current?.pause()}
        onTimeUpdate={syncBackground}
        style={{
          position: "absolute",
          inset: 0,
          width: 1080,
          height: 1920,
          objectFit: mode === "cover" ? "cover" : "contain",
        }}
      />
    </div>
  );
}
