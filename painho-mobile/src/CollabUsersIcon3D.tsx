import { motion } from "framer-motion";

type CollabUsersIcon3DProps = {
  x?: number;
  y?: number;
  size?: number;
};

export function CollabUsersIcon3D({
  x = 0,
  y = 0,
  size = 28,
}: CollabUsersIcon3DProps) {
  const s = size / 28;

  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <defs>
        <linearGradient id="collab-main-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#97F4FF" />
          <stop offset="45%" stopColor="#4EDBFF" />
          <stop offset="100%" stopColor="#1B92FF" />
        </linearGradient>

        <linearGradient id="collab-inner-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#CFFBFF" />
          <stop offset="100%" stopColor="#66D9FF" />
        </linearGradient>

        <filter id="collab-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feDropShadow dx="0" dy="0" stdDeviation="2.5" floodColor="#53DFFF" floodOpacity="0.95" />
          <feDropShadow dx="0" dy="0" stdDeviation="5" floodColor="#119DFF" floodOpacity="0.5" />
        </filter>

        <filter id="collab-shadow" x="-100%" y="-100%" width="300%" height="300%">
          <feDropShadow dx="0" dy="4" stdDeviation="3" floodColor="#00172E" floodOpacity="0.55" />
        </filter>
      </defs>

      <g filter="url(#collab-shadow)">
        <motion.circle
          cx="9"
          cy="9"
          r="4.2"
          fill="url(#collab-inner-grad)"
          stroke="url(#collab-main-grad)"
          strokeWidth="1.2"
          filter="url(#collab-glow)"
          animate={{ opacity: [0.88, 1, 0.88] }}
          transition={{ duration: 2.1, repeat: Infinity }}
        />

        <motion.circle
          cx="19"
          cy="9"
          r="4.2"
          fill="url(#collab-inner-grad)"
          stroke="url(#collab-main-grad)"
          strokeWidth="1.2"
          filter="url(#collab-glow)"
          animate={{ opacity: [1, 0.82, 1] }}
          transition={{ duration: 2.1, repeat: Infinity, delay: 0.2 }}
        />

        <path
          d="M3.5 22
             C4.2 17.8 6.8 15.7 10.2 15.7
             C13.7 15.7 16 17.9 16.3 22"
          fill="none"
          stroke="url(#collab-main-grad)"
          strokeWidth="2.1"
          strokeLinecap="round"
          filter="url(#collab-glow)"
        />

        <path
          d="M11.8 22
             C12.6 17.8 15.2 15.7 18.7 15.7
             C22.2 15.7 24.4 17.9 24.8 22"
          fill="none"
          stroke="url(#collab-main-grad)"
          strokeWidth="2.1"
          strokeLinecap="round"
          filter="url(#collab-glow)"
        />

        <motion.path
          d="M5 4 L8 4"
          stroke="#FFFFFF"
          strokeWidth="1.5"
          strokeLinecap="round"
          animate={{ x: [0, 10, 0], opacity: [0.15, 0.9, 0.15] }}
          transition={{ duration: 2.2, repeat: Infinity }}
        />
      </g>
    </g>
  );
}
