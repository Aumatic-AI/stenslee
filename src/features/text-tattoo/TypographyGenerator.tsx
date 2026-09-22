"use client";

import { useState, useRef, useEffect } from "react";

// Expanded curated Google Fonts that fit tattoo styles
export const CURATED_FONTS = [
  { name: "UnifrakturMaguntia", label: "Old English" },
  { name: "Creepster", label: "Gothic/Horror" },
  { name: "Cinzel Decorative", label: "Classic Roman" },
  { name: "Special Elite", label: "Typewriter" },
  { name: "Rye", label: "Western" },
  { name: "Pirata One", label: "Pirate/Gothic" },
  { name: "Great Vibes", label: "Elegant Cursive" },
  { name: "Dancing Script", label: "Flowing Script" },
  { name: "Tangerine", label: "Thin Cursive" },
  { name: "Shadows Into Light", label: "Handwritten" },
  { name: "Permanent Marker", label: "Bold Marker" },
  { name: "Pacifico", label: "Casual Script" },
  { name: "Caveat", label: "Marker Handwriting" },
  { name: "Sacramento", label: "Delicate Script" },
  { name: "Satisfy", label: "Brush Script" },
  { name: "Rock Salt", label: "Rough Handwriting" },
  { name: "Yellowtail", label: "Retro Script" },
  { name: "Alex Brush", label: "Classic Calligraphy" },
  { name: "Cinzel", label: "Roman Serif" },
  { name: "Oswald", label: "Bold Sans" },
  { name: "Playfair Display", label: "Elegant Serif" },
  { name: "Lobster", label: "Retro Bold" },
  { name: "Anton", label: "Heavy Sans" },
  { name: "Bebas Neue", label: "Tall Sans" },
  { name: "Abril Fatface", label: "Heavy Serif" },
];

export const TATTOO_COLORS = [
  { name: "Black", hex: "#0A0A0A" },
  { name: "Dark Red", hex: "#8B0000" },
  { name: "Crimson", hex: "#DC143C" },
  { name: "Navy Blue", hex: "#00008B" },
  { name: "Royal Blue", hex: "#4169E1" },
  { name: "Dark Green", hex: "#006400" },
  { name: "Emerald", hex: "#50C878" },
  { name: "Gold", hex: "#C9A84C" },
  { name: "Purple", hex: "#4A0080" },
  { name: "Magenta", hex: "#8B008B" },
  { name: "Teal", hex: "#008080" },
];

interface FontItem {
  name: string;
  label: string;
  isSystem?: boolean;
}

const SYSTEM_FONTS: FontItem[] = [
  { name: "Arial", label: "System Sans-Serif", isSystem: true },
  { name: "Times New Roman", label: "System Serif", isSystem: true },
  { name: "Courier New", label: "System Monospace", isSystem: true },
  { name: "Georgia", label: "System Serif", isSystem: true },
  { name: "Verdana", label: "System Sans-Serif", isSystem: true },
  { name: "Impact", label: "System Display", isSystem: true },
  { name: "Comic Sans MS", label: "System Handwriting", isSystem: true }
];

interface Props {
  onDesignGenerated: (dataUrl: string, font: string) => void;
  onCancel?: () => void;
}

export function TypographyGenerator({ onDesignGenerated, onCancel }: Props) {
  const [text, setText] = useState("");
  const [font, setFont] = useState(CURATED_FONTS[0].name);
  const fontSize = 400;
  const [isFontDropdownOpen, setIsFontDropdownOpen] = useState(false);
  const [fontSearch, setFontSearch] = useState("");
  
  const [allFonts, setAllFonts] = useState<FontItem[]>(CURATED_FONTS);
  const [visibleCount, setVisibleCount] = useState(20);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch all Google Fonts on mount
  useEffect(() => {
    fetch("https://api.fontsource.org/v1/fonts")
      .then(res => res.json())
      .then((data: any[]) => {
        // Map API response to our format
        const apiFonts = data.map(f => ({ name: f.family, label: f.category }));
        
        // Remove duplicates that are already in CURATED_FONTS or SYSTEM_FONTS
        const curatedNames = new Set(CURATED_FONTS.map(c => c.name));
        const systemNames = new Set(SYSTEM_FONTS.map(s => s.name));
        const newFonts = apiFonts.filter(f => !curatedNames.has(f.name) && !systemNames.has(f.name));
        
        setAllFonts([...CURATED_FONTS, ...SYSTEM_FONTS, ...newFonts]);
      })
      .catch(err => console.error("Failed to fetch fonts", err));
  }, []);

  // Load ONLY the curated fonts globally to start
  useEffect(() => {
    const linkId = "typography-curated-fonts";
    if (!document.getElementById(linkId)) {
      const familyString = CURATED_FONTS.map(f => `family=${f.name.replace(/\s+/g, "+")}`).join("&");
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?${familyString}&display=swap`;
      document.head.appendChild(link);
    }
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsFontDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Render text to canvas with dynamic sizing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Wait specifically for this font to be fully loaded
    document.fonts.load(`${fontSize}px "${font}"`).then(() => {
      // First pass: measure text to size the canvas perfectly
      ctx.font = `${fontSize}px "${font}"`;
      const displayString = text || "Tattoo";
      const metrics = ctx.measureText(displayString);
      
      const textWidth = Math.ceil(metrics.width);
      // approximate height based on font size (ascent + descent varies widely by font)
      const textHeight = fontSize * 1.5; 
      
      // Tight bounding box padding
      const paddingX = Math.max(40, fontSize * 0.2);
      const paddingY = Math.max(40, fontSize * 0.2);

      const targetWidth = textWidth + paddingX * 2;
      const targetHeight = textHeight + paddingY * 2;

      // Set internal resolution perfectly around the text so it NEVER cuts off
      canvas.width = targetWidth;
      canvas.height = targetHeight;

      // Reset context after resize
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.font = `${fontSize}px "${font}"`;
      ctx.fillStyle = "#0A0A0A";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      
      // Draw text centered
      ctx.fillText(displayString, canvas.width / 2, canvas.height / 2);
      
      // If empty, draw placeholder with opacity
      if (!text) {
        ctx.fillStyle = "#0A0A0A40"; // 25% opacity hex
        ctx.fillText("Tattoo", canvas.width / 2, canvas.height / 2);
      }
    });
  }, [text, font, fontSize]);

  const handleGenerate = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    const exportCanvas = document.createElement("canvas");
    exportCanvas.width = canvas.width;
    exportCanvas.height = canvas.height;
    const ctx = exportCanvas.getContext("2d")!;
    ctx.fillStyle = "white";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(canvas, 0, 0);
    
    const dataUrl = exportCanvas.toDataURL("image/png");
    
    onDesignGenerated(dataUrl, font);
  };

  const filteredFonts = allFonts.filter(f => 
    f.name.toLowerCase().includes(fontSearch.toLowerCase()) || 
    f.label.toLowerCase().includes(fontSearch.toLowerCase())
  );
  
  const displayedFonts = filteredFonts.slice(0, visibleCount);
  const activeFontLabel = allFonts.find(f => f.name === font)?.label;

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const { scrollTop, clientHeight, scrollHeight } = e.currentTarget;
    if (scrollHeight - scrollTop <= clientHeight + 50) {
      if (visibleCount < filteredFonts.length) {
        setVisibleCount(prev => prev + 20);
      }
    }
  };

  // When search changes, reset visible count to top
  useEffect(() => {
    setVisibleCount(20);
  }, [fontSearch]);

  // Scroll to selected font when dropdown opens
  useEffect(() => {
    if (isFontDropdownOpen) {
      const idx = filteredFonts.findIndex(f => f.name === font);
      if (idx !== -1 && idx >= visibleCount) {
        // Expand visible count so the selected font is actually rendered
        setVisibleCount(idx + 20);
      }
      
      setTimeout(() => {
        const selectedBtn = document.getElementById(`font-btn-${font.replace(/\s+/g, "-")}`);
        if (selectedBtn && selectedBtn.parentElement) {
          const container = selectedBtn.parentElement;
          container.scrollTop = selectedBtn.offsetTop - container.offsetTop - container.clientHeight / 2 + selectedBtn.clientHeight / 2;
        }
      }, 50);
    }
  }, [isFontDropdownOpen, font, filteredFonts, visibleCount]);
  
  const isSelectedSystemFont = allFonts.find(f => f.name === font)?.isSystem;

  return (
    <div className="bg-surface rounded-2xl border border-cleo-border p-4 sm:p-5 flex flex-col gap-4 w-full mx-auto">
      {/* Always ensure the selected font is loaded, even when dropdown is closed */}
      {!isSelectedSystemFont && (
        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${font.replace(/\s+/g, "+")}&display=swap`} />
      )}
      
      {/* ── Top Bar: Font Selector & Size ── */}
      <div>
        <h2 className="font-cinzel text-xl font-bold text-ink">Typography Generator</h2>
        <p className="text-muted text-sm mt-1">Type text to generate a crisp, perfect lettering design.</p>
      </div>

      <div className="flex flex-col gap-4">
        {/* Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-20">
          <div>
            <label className="text-xs font-mono tracking-widest uppercase text-muted mb-2 block">Text</label>
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="e.g. Hello"
              className="w-full bg-bg border border-cleo-border rounded-xl px-4 text-ink focus:border-gold outline-none transition-colors h-[54px]"
            />
          </div>
          
          <div ref={dropdownRef} className="relative">
            <label className="text-xs font-mono tracking-widest uppercase text-muted mb-2 block">Font Style</label>
            <button
              type="button"
              onClick={() => setIsFontDropdownOpen(!isFontDropdownOpen)}
              className="w-full bg-bg border border-cleo-border hover:border-gold/50 rounded-xl px-4 text-ink transition-colors flex items-center justify-between cursor-pointer h-[54px]"
            >
              <div className="flex flex-col items-start truncate max-w-[85%]">
                <span className="text-sm truncate w-full text-left leading-tight">{activeFontLabel}</span>
                <span className="text-[10px] text-muted font-mono truncate w-full text-left leading-tight mt-0.5">{font}</span>
              </div>
              <svg className={`w-4 h-4 text-muted transition-transform flex-shrink-0 ${isFontDropdownOpen ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isFontDropdownOpen && (
              <div className="absolute top-full mt-2 left-0 w-full bg-surface-2 border border-cleo-border rounded-xl shadow-2xl overflow-hidden z-50 flex flex-col max-h-[400px]">
                <div className="p-2 border-b border-cleo-border">
                  <input
                    type="text"
                    autoFocus
                    placeholder="Search fonts..."
                    value={fontSearch}
                    onChange={(e) => setFontSearch(e.target.value)}
                    className="w-full bg-bg border border-cleo-border rounded-lg px-3 py-2 text-sm text-ink focus:border-gold outline-none"
                  />
                </div>
                <div 
                  className="overflow-y-auto scrollbar-thin p-2 flex flex-col gap-1"
                  onScroll={handleScroll}
                >
                  {displayedFonts.length > 0 ? displayedFonts.map(f => (
                    <button
                      key={f.name}
                      id={`font-btn-${f.name.replace(/\s+/g, "-")}`}
                      onClick={() => {
                        setFont(f.name);
                        setIsFontDropdownOpen(false);
                      }}
                      className={`w-full text-left p-3 rounded-lg flex flex-col gap-1 transition-colors hover:bg-gold/10 cursor-pointer ${font === f.name ? "bg-gold/20 border border-gold/30" : "border border-transparent"}`}
                    >
                      {/* Inject font style just for this font when rendered (if not a system font) */}
                      {!f.isSystem && (
                        <link rel="stylesheet" href={`https://fonts.googleapis.com/css2?family=${f.name.replace(/\s+/g, "+")}&display=swap`} />
                      )}
                      <span className="text-muted text-[10px] font-mono tracking-wider uppercase">{f.label}</span>
                      <span className="text-2xl text-ink leading-tight truncate w-full" style={{ fontFamily: f.name }}>
                        {f.name}
                      </span>
                    </button>
                  )) : (
                    <p className="text-center text-sm text-muted py-4">No fonts found</p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>


        {/* Preview */}
        <div className="relative z-0 w-full aspect-[2/1] max-h-[200px] mx-auto rounded-xl border border-gold/30 bg-white overflow-hidden flex items-center justify-center p-4">
          <canvas
            ref={canvasRef}
            style={{ 
              height: `${fontSize * 1.5}px`, // Visually scales the canvas based on font size slider!
              maxHeight: '100%', 
              maxWidth: '100%', 
              objectFit: 'contain' 
            }}
            className="pointer-events-none"
          />
        </div>

        </div>      <div className="flex gap-3 pt-2">
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex-1 py-3.5 bg-surface-2 text-ink font-cinzel font-bold text-xs sm:text-sm tracking-wider uppercase rounded-xl border border-cleo-border hover:bg-surface-3 transition-colors cursor-pointer"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleGenerate}
          disabled={!text.trim()}
          className="flex-[2] py-3.5 bg-gold text-bg font-cinzel font-bold text-xs sm:text-sm tracking-wider uppercase rounded-xl border border-gold hover:bg-gold-light transition-colors disabled:opacity-50 cursor-pointer shadow-[0_0_15px_rgba(201,168,76,0.2)]"
        >
          ✦ Add to References
        </button>
      </div>
    </div>
  );
}
