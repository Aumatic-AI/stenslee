import type { DesignVariant } from "@/store/app-store";

const PATTERNS: Record<DesignVariant["patternType"], React.ReactNode> = {
  mandala: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-30" fill="none">
      <circle cx="50" cy="50" r="42" stroke="#c9a84c" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="34" stroke="#c9a84c" strokeWidth="0.5" />
      <circle cx="50" cy="50" r="24" stroke="#c9a84c" strokeWidth="0.7" />
      <circle cx="50" cy="50" r="14" stroke="#c9a84c" strokeWidth="0.8" />
      <circle cx="50" cy="50" r="5" stroke="#c9a84c" strokeWidth="1" />
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg) => (
        <line key={deg} x1="50" y1="8" x2="50" y2="20" stroke="#c9a84c" strokeWidth="0.6"
          transform={`rotate(${deg} 50 50)`} />
      ))}
      {[0,45,90,135,180,225,270,315].map((deg) => (
        <polygon key={deg} points="50,26 53,33 50,38 47,33"
          stroke="#c9a84c" strokeWidth="0.4" fill="none"
          transform={`rotate(${deg} 50 50)`} />
      ))}
    </svg>
  ),
  geometric: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-25" fill="none">
      <polygon points="50,8 92,75 8,75" stroke="#c9a84c" strokeWidth="0.7" />
      <polygon points="50,18 82,72 18,72" stroke="#c9a84c" strokeWidth="0.5" />
      <polygon points="50,28 72,69 28,69" stroke="#c9a84c" strokeWidth="0.4" />
      <polygon points="8,25 92,25 92,75 8,75" stroke="#c9a84c" strokeWidth="0.4" />
      <circle cx="50" cy="50" r="20" stroke="#c9a84c" strokeWidth="0.5" />
      <line x1="8" y1="8" x2="92" y2="92" stroke="#c9a84c" strokeWidth="0.3" />
      <line x1="92" y1="8" x2="8" y2="92" stroke="#c9a84c" strokeWidth="0.3" />
    </svg>
  ),
  tribal: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-25" fill="none">
      {[20,30,40,50,60,70,80].map((y) => (
        <line key={y} x1="15" y1={y} x2="85" y2={y} stroke="#c9a84c" strokeWidth="0.4" />
      ))}
      <path d="M20 20 L50 5 L80 20 L95 50 L80 80 L50 95 L20 80 L5 50 Z" stroke="#c9a84c" strokeWidth="0.7" />
      <path d="M30 30 L50 18 L70 30 L82 50 L70 70 L50 82 L30 70 L18 50 Z" stroke="#c9a84c" strokeWidth="0.5" />
      <path d="M40 40 L50 34 L60 40 L66 50 L60 60 L50 66 L40 60 L34 50 Z" stroke="#c9a84c" strokeWidth="0.4" />
    </svg>
  ),
  floral: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-28" fill="none">
      {[0,60,120,180,240,300].map((deg) => (
        <ellipse key={deg} cx="50" cy="30" rx="8" ry="20" stroke="#c9a84c" strokeWidth="0.6"
          transform={`rotate(${deg} 50 50)`} />
      ))}
      <circle cx="50" cy="50" r="8" stroke="#c9a84c" strokeWidth="0.8" />
      <circle cx="50" cy="50" r="3" fill="#c9a84c" opacity="0.4" />
      {[0,45,90,135,180,225,270,315].map((deg) => (
        <line key={deg} x1="50" y1="42" x2="50" y2="38" stroke="#c9a84c" strokeWidth="0.4"
          transform={`rotate(${deg} 50 50)`} />
      ))}
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-20" fill="none">
      <path d="M50 10 L90 85 H10 Z" stroke="#c9a84c" strokeWidth="0.8" />
      <path d="M50 22 L78 82 H22 Z" stroke="#c9a84c" strokeWidth="0.5" />
      <path d="M50 34 L66 79 H34 Z" stroke="#c9a84c" strokeWidth="0.4" />
      <circle cx="50" cy="65" r="12" stroke="#c9a84c" strokeWidth="0.5" />
      {[0,72,144,216,288].map((deg) => (
        <line key={deg} x1="50" y1="5" x2="50" y2="18" stroke="#c9a84c" strokeWidth="0.4"
          transform={`rotate(${deg} 50 50)`} />
      ))}
    </svg>
  ),
  minimal: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-22" fill="none">
      <line x1="50" y1="15" x2="50" y2="85" stroke="#c9a84c" strokeWidth="0.6" />
      <line x1="15" y1="50" x2="85" y2="50" stroke="#c9a84c" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="28" stroke="#c9a84c" strokeWidth="0.5" />
      <circle cx="50" cy="50" r="4" stroke="#c9a84c" strokeWidth="0.8" />
      <circle cx="50" cy="22" r="2" fill="#c9a84c" opacity="0.4" />
      <circle cx="50" cy="78" r="2" fill="#c9a84c" opacity="0.4" />
      <circle cx="22" cy="50" r="2" fill="#c9a84c" opacity="0.4" />
      <circle cx="78" cy="50" r="2" fill="#c9a84c" opacity="0.4" />
    </svg>
  ),
  japanese: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-25" fill="none">
      <path d="M10 60 Q25 40 40 55 Q55 70 70 50 Q85 30 95 45" stroke="#c9a84c" strokeWidth="0.8" />
      <path d="M10 70 Q25 50 40 65 Q55 80 70 60 Q85 40 95 55" stroke="#c9a84c" strokeWidth="0.6" />
      <path d="M10 80 Q25 60 40 75 Q55 90 70 70 Q85 50 95 65" stroke="#c9a84c" strokeWidth="0.4" />
      <circle cx="30" cy="25" r="12" stroke="#c9a84c" strokeWidth="0.6" />
      <circle cx="30" cy="25" r="6" stroke="#c9a84c" strokeWidth="0.4" />
      {[0,45,90,135,180,225,270,315].map((deg) => (
        <line key={deg} x1="30" y1="13" x2="30" y2="9" stroke="#c9a84c" strokeWidth="0.4"
          transform={`rotate(${deg} 30 25)`} />
      ))}
    </svg>
  ),
  biomech: (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full opacity-22" fill="none">
      <circle cx="50" cy="50" r="22" stroke="#c9a84c" strokeWidth="0.6" />
      <circle cx="50" cy="50" r="14" stroke="#c9a84c" strokeWidth="0.4" />
      {[0,30,60,90,120,150,180,210,240,270,300,330].map((deg) => (
        <rect key={deg} x="47" y="28" width="6" height="4" rx="1"
          stroke="#c9a84c" strokeWidth="0.4" fill="none"
          transform={`rotate(${deg} 50 50)`} />
      ))}
      <rect x="25" y="45" width="20" height="10" rx="2" stroke="#c9a84c" strokeWidth="0.5" />
      <rect x="55" y="45" width="20" height="10" rx="2" stroke="#c9a84c" strokeWidth="0.5" />
      <line x1="25" y1="50" x2="20" y2="50" stroke="#c9a84c" strokeWidth="0.6" />
      <line x1="75" y1="50" x2="80" y2="50" stroke="#c9a84c" strokeWidth="0.6" />
      <rect x="22" y="38" width="10" height="24" rx="2" stroke="#c9a84c" strokeWidth="0.4" />
      <rect x="68" y="38" width="10" height="24" rx="2" stroke="#c9a84c" strokeWidth="0.4" />
    </svg>
  ),
};

export default function DesignPatternSVG({ type }: { type: DesignVariant["patternType"] }) {
  return <>{PATTERNS[type]}</>;
}
