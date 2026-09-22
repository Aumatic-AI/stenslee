// ============================================================
// CLEOPATRA INK STUDIO — All AI Prompts
// Edit this file to tune what gets sent to the image model.
// ============================================================

import { resolveColors } from "@/features/ai-design/tattoo-colors";

// ── Types ────────────────────────────────────────────────────

export interface RefinementImage {
  name: string;   // e.g. "Variation 2"
  index: number;  // 1-based position in the input_urls array
}

export interface RefinementInfo {
  text: string;
  selectedImages: RefinementImage[];
  faithfulMode?: boolean;
}

// ── Style Descriptors ────────────────────────────────────────
// Translated directly from studio style definitions.
// Each entry becomes the STYLE block injected into the prompt.

interface StyleDescriptor {
  linework: string;
  shading: string;
  color: string;
  composition: string;
  feel: string;
  subjects: string;
}

// ── Surface classification for placement prompts ────────────
export type SurfaceType = "flat" | "face" | "hand";

export function classifySurface(targetBodyArea: string): SurfaceType {
  const a = (targetBodyArea || "").toLowerCase();
  if (/face|nose|cheek|forehead|chin|jaw|temple|eyelid|ear/.test(a)) return "face";
  if (/hand|finger|knuckle|palm|thumb/.test(a)) return "hand";
  return "flat";
}

const STYLE_PROMPT_DESCRIPTORS: Record<string, StyleDescriptor> = {

  // ── BLACK & GREY ──────────────────────────────────────────

  "Black & Grey": {
    linework: "confident black ink outlines with refined interior detail lines",
    shading: "smooth grey wash shading built through layering and detailed contrast — stippling and hatching for depth",
    color: "black ink and grey tones only — absolutely no color fills",
    composition: "balanced realistic composition with strong tonal contrast and dimensional depth",
    feel: "highly realistic, photographic depth — resembles a black-and-white photograph rendered in ink",
    subjects: "portraits, animals, statues — rendered with realism and precise tonal gradation",
  },

  "Smooth Black & Grey": {
    linework: "clean black outlines with fluid, unbroken interior linework",
    shading: "seamless gradual shading with subtle gradients — no harsh transitions, smooth blending throughout",
    color: "black ink and grey tones only — soft and even, no color fills",
    composition: "soft, harmonious composition with gentle tonal shifts and peaceful visual flow",
    feel: "softer and more delicate than standard black and grey — transitions should feel silky and seamless",
    subjects: "portraits, religious imagery, roses — rendered with gentle tonal transitions",
  },

  "Religious Black & Grey": {
    linework: "strong black outlines with detailed interior linework capturing texture and form",
    shading: "high contrast shading with realistic textures — dark shadows and bright highlights",
    color: "black ink and grey tones only — rich contrast, no color fills",
    composition: "reverent, dramatic composition — figures centered with heavenly or spiritual atmosphere",
    feel: "sacred and powerful — high contrast creates a sense of divine weight and spiritual gravity",
    subjects: "Jesus, Virgin Mary, angels, crosses, praying hands — rendered with devotional realism",
  },

  "Chicano": {
    linework: "fine, precise black ink linework with detailed script lettering elements",
    shading: "fine grey shading with subtle gradients — delicate and controlled",
    color: "black ink and grey tones only — no color fills",
    composition: "elegant and decorative — figures balanced with ornamental details and lettering",
    feel: "Mexican-American cultural aesthetic — sophisticated, detailed, and emotionally expressive",
    subjects: "beautiful women, religious icons, roses, script lettering, lowrider imagery",
  },

  "Portrait": {
    linework: "precision linework capturing accurate facial proportions and fine anatomical detail",
    shading: "photorealistic shading with accurate light and shadow — precise tonal gradation for skin texture",
    color: "black ink and grey tones for realism — color only if explicitly requested",
    composition: "tight portrait-oriented composition — face and expression as the primary focal point",
    feel: "photographic realism — a viewer should feel as if they are looking at a real person",
    subjects: "human faces — family members, celebrities, historical figures — with emotional accuracy",
  },

  "Micro Realism": {
    linework: "extremely fine, hair-thin detail lines — single-needle precision throughout",
    shading: "meticulous micro-shading with tiny stippled dots and fine hatching",
    color: "black and grey or delicate color washes — all rendered at miniature scale",
    composition: "small and compact — every element is tiny yet crisply detailed",
    feel: "astoundingly detailed for its tiny size — like a miniature masterpiece under a magnifying glass",
    subjects: "animals, portraits, objects — rendered in small size with extraordinary fine detail",
  },

  // ── COLOR ─────────────────────────────────────────────────

  "Color Tattoo": {
    linework: "confident black outlines supporting rich color fills",
    shading: "advanced color blending and layering — smooth color gradients with depth",
    color: "full realistic color palette — vibrant, saturated pigments blended naturally",
    composition: "balanced realistic composition showcasing the full color range",
    feel: "vivid and lifelike — colors appear freshly tattooed and luminous",
    subjects: "portraits, wildlife, nature — rendered with photorealistic color accuracy",
  },

  "New School": {
    linework: "thick, bold black outlines — chunky and exaggerated, like a cartoon or comic book",
    shading: "flat or slightly graduated bright color fills within bold outlines — dynamic and punchy",
    color: "bright, vivid, saturated colors — neon-adjacent, bold contrasts, no muted or natural tones",
    composition: "dynamic and playful — exaggerated proportions, oversized features, energetic poses",
    feel: "cartoon-inspired and fun — exaggerated, animated, irreverent — should look like a living cartoon character",
    subjects: "characters, monsters, cartoons, pop culture icons — with exaggerated cartoonish features",
  },

  "Illustrative Color": {
    linework: "strong expressive linework — confident strokes that feel hand-drawn and illustrative",
    shading: "creative coloring with painterly blending — illustration-quality color work",
    color: "rich illustrative color palette — bold yet artistic, balanced between realism and illustration",
    composition: "narrative and imaginative composition — feels like a page from an illustrated book",
    feel: "a blend of fine illustration art and tattoo design — artistic and storytelling",
    subjects: "fantasy, mythology, nature — rendered with the quality of a professional book illustrator",
  },

  "Cartoon / Comic Style": {
    linework: "clean, uniform black outlines — consistent line weight, no variation, comic-book precise",
    shading: "flat saturated color fills with minimal shading — cel-shading style",
    color: "fully saturated, bold comic-book colors — primary and secondary hues, high contrast",
    composition: "panel-ready composition — clear silhouette, action-oriented, instantly readable",
    feel: "straight out of a comic book or animated series — flat, bold, clean, and energetic",
    subjects: "comic characters, anime heroes, cartoons, animated icons",
  },

  // ── TRADITIONAL ───────────────────────────────────────────

  "Old School": {
    linework: "very bold, heavy black outlines — thick and unwavering, classic American traditional",
    shading: "minimal shading using a limited palette — flat color fills within bold outlines",
    color: "classic limited palette: red, yellow, green, black — no subtle gradients",
    composition: "bold, iconic, and immediately readable — symmetrical and timeless",
    feel: "classic American sailor tattoo — tough, iconic, nostalgic, instantly recognizable as Old School",
    subjects: "anchors, eagles, roses, daggers, swallows, hearts, banners with text",
  },

  "Neo Traditional": {
    linework: "bold black outlines — thicker than fine line but with more variation than Old School",
    shading: "rich detailed shading with vibrant color fills — more depth than traditional",
    color: "expanded rich color palette — jewel tones, complex hues, more variety than Old School",
    composition: "decorative and detailed — elaborate compositions with natural and animal motifs",
    feel: "evolved American traditional — richer, more detailed, and more colorful than Old School",
    subjects: "animals, flowers, women, nature — rendered with elaborate neo-traditional decoration",
  },

  "Japanese": {
    linework: "flowing, dynamic black outlines — curves and movement suggesting wind and water",
    shading: "bold color fills with gradated shading — strong shadows using traditional Japanese color language",
    color: "classic Japanese palette — bold reds, blacks, with selective use of blue, green, yellow",
    composition: "large-scale flowing composition — elements interact with wind, waves, and clouds",
    feel: "traditional Irezumi body art — symbolic, powerful, deeply rooted in Japanese iconography",
    subjects: "dragons, koi fish, samurai, geisha, tigers, chrysanthemum, cherry blossom, waves",
  },

  "Oriental": {
    linework: "detailed, flowing linework with storytelling detail — elegant curves and precise strokes",
    shading: "layered shading with atmospheric depth — ink wash quality",
    color: "Asian-inspired palette — deep reds, blacks, golds, and greens",
    composition: "narrative, flowing compositions — elements tell a story across the design",
    feel: "Asian artistic tradition — refined, detailed, and deeply symbolic",
    subjects: "dragons, tigers, geishas, pagodas, koi, lotus flowers",
  },

  "Tribal": {
    linework: "heavy, bold black linework — thick fills and patterns with no variation in ink color",
    shading: "no shading — pure solid black only, maximum saturation",
    color: "black ink only — no grey, no color",
    composition: "bold abstract pattern — symmetrical or flowing, designed to wrap the body",
    feel: "indigenous cultural power — raw, graphic, and boldly geometric",
    subjects: "abstract tribal patterns inspired by indigenous cultures",
  },

  "Polynesian": {
    linework: "bold black geometric lines — precise and deliberate, forming symbolic patterns",
    shading: "no shading — solid black geometric fills only",
    color: "black ink only",
    composition: "geometric symbolic patterns that tell a story — designed to follow body contours",
    feel: "Polynesian cultural identity — each pattern element carries symbolic meaning",
    subjects: "family, strength, heritage, ocean, turtles, sharks — expressed through geometric symbols",
  },

  "Maori": {
    linework: "curved, flowing black lines — the signature koru spiral forms and flowing curves of Ta Moko",
    shading: "solid black fills within curved pattern work — no grey shading",
    color: "black ink only",
    composition: "flowing curved patterns that flow across the face or body — deeply personal and identity-based",
    feel: "New Zealand Maori traditional art — identity, ancestry, and spiritual connection",
    subjects: "ancestry, identity, personal history — expressed through Ta Moko curved patterns",
  },

  "Samoan": {
    linework: "dense, precise geometric black lines — pe'a style with repeated geometric motifs",
    shading: "dense solid black fills — heavy geometric saturation",
    color: "black ink only",
    composition: "dense geometric coverage — large areas of solid black with negative space pattern work",
    feel: "ancient Polynesian tradition — status, courage, and family expressed through dense geometric forms",
    subjects: "status, courage, family, cultural identity — expressed through dense Samoan geometric patterns",
  },

  "Marquesan": {
    linework: "symmetrical, precise black linework — repeating geometric and zoomorphic patterns",
    shading: "solid black fills and pattern work — symmetrical across an axis",
    color: "black ink only",
    composition: "highly symmetrical composition — mirrored patterns forming a cohesive design",
    feel: "Marquesas Islands tribal tradition — bold, symmetrical, and richly symbolic",
    subjects: "cultural symbols, tiki faces, geckos, ocean elements — all rendered in Marquesan geometric style",
  },

  "Borneo Tribal": {
    linework: "bold black motifs with organic flowing shapes — nature-inspired forms",
    shading: "solid black fills — no shading or color",
    color: "black ink only",
    composition: "organic, nature-connected patterns — flowing shapes representing natural and spiritual elements",
    feel: "indigenous Borneo spiritual connection to nature — bold and organically shaped",
    subjects: "nature and spiritual symbols from Borneo indigenous cultures — plants, animals, spiritual motifs",
  },

  // ── REALISM ───────────────────────────────────────────────

  "Hyper-realistic": {
    linework: "ultra-fine, precise linework exceeding photographic detail",
    shading: "advanced shading and texture work surpassing photographic appearance — extreme tonal precision",
    color: "full color or black and grey — rendered with hyper-detailed accuracy",
    composition: "ultra-detailed composition — every surface texture, pore, and reflection rendered",
    feel: "beyond photographic — so detailed it appears more real than a photograph",
    subjects: "portraits, animals — rendered with obsessive hyper-realistic detail",
  },

  "Animal Realism": {
    linework: "precise linework capturing animal anatomy — fur direction, feather structure, scale texture",
    shading: "detailed texture shading — individual fur strands, feathers, or scales rendered realistically",
    color: "realistic animal coloring — natural tones or striking monochrome",
    composition: "powerful animal-focused composition — subject commands the frame",
    feel: "the animal should feel alive and present — realistic texture and dimensional depth",
    subjects: "lions, wolves, eagles, tigers, bears — rendered with realistic fur and texture detail",
  },

  "Biomechanical": {
    linework: "complex mechanical and organic linework — gears, pistons, and anatomy intertwined",
    shading: "3D shading creating depth and realistic mechanical surfaces — metal reflections and organic tissue",
    color: "black and grey with metallic tones — or full color with mechanical chrome and rust",
    composition: "appears to reveal the inside of a body as part-machine — layers of skin peeling back",
    feel: "fusion of living anatomy and machinery — should look like the body is mechanical underneath",
    subjects: "gears, pistons, robotic structures fused with muscle, bone, and tendons",
  },

  // ── LINEWORK ──────────────────────────────────────────────

  "Fine Line": {
    linework: "thin, elegant single-pass precision lines — delicate and refined, minimal line weight variation",
    shading: "minimal or no shading — the linework itself carries the design",
    color: "black ink only, or very delicate color washes — never heavy fills",
    composition: "elegant and minimal — the beauty is in the precision of the lines themselves",
    feel: "refined, delicate, feminine — jewelry-quality precision in ink",
    subjects: "flowers, botanical elements, script, symbols, minimal portraits",
  },

  "Single Needle": {
    linework: "extremely fine lines created with a single needle — the finest possible linework",
    shading: "ultra-fine micro-shading using one needle — barely-there gradients",
    color: "black ink only — subtle and understated",
    composition: "small and intricate — designed for small body placements with extraordinary detail",
    feel: "whisper-thin and incredibly precise — maximum delicacy in ink",
    subjects: "small realistic designs, delicate portraits, fine botanical illustrations",
  },

  "Linework": {
    linework: "clean, confident lines as the primary design element — minimal decoration",
    shading: "minimal or no shading — lines alone define the design",
    color: "black ink only",
    composition: "abstract or symbolic — composed primarily of lines, shapes, and outlines",
    feel: "pure and graphic — the lines are the art",
    subjects: "abstract art, symbols, geometric shapes, minimalist illustrations",
  },

  "Geometric": {
    linework: "mathematically precise linework — perfectly straight lines, exact angles, clean curves",
    shading: "minimal geometric shading — dot fills or line fills within geometric shapes",
    color: "black ink primarily — or selective single-color accent",
    composition: "symmetrical, precise geometric composition — every angle and proportion is exact",
    feel: "mathematical perfection — crisp, clean, and precisely ordered",
    subjects: "geometric shapes — triangles, hexagons, sacred geometry — sometimes incorporating animals",
  },

  "Sacred Geometry": {
    linework: "perfectly symmetrical precision linework — spiritual geometric forms",
    shading: "minimal dotwork or hatching within geometric forms",
    color: "black ink only — the geometry speaks through form, not color",
    composition: "perfectly centred symmetrical designs — radiating outward from a central point",
    feel: "spiritual and transcendent — mathematical patterns that carry sacred meaning",
    subjects: "Metatron's Cube, Flower of Life, Sri Yantra, Fibonacci spiral, Platonic solids",
  },

  "Ornamental": {
    linework: "fine symmetrical linework — decorative, jewelry-inspired patterns",
    shading: "delicate dot fills and fine line fills within ornamental patterns",
    color: "black ink — or gold tones if color requested",
    composition: "decorative and symmetrical — designed to ornament the body like jewelry",
    feel: "worn like jewelry — intricate, precious, and decorative",
    subjects: "jewelry-inspired designs, mandalas, lacework, filigree, decorative ornamental patterns",
  },

  "Engraving": {
    linework: "fine hatching and cross-hatching lines mimicking antique metal or wood engravings",
    shading: "hatch-line shading only — no smooth gradients, all tone built from line density",
    color: "black ink only — resembles antique printed engraving",
    composition: "vintage illustrative composition — feels like a plate from an old encyclopedia",
    feel: "antique engraving quality — as if etched into copper plate and printed",
    subjects: "historical artwork, portraits, natural history illustrations, vintage botanical art",
  },

  "Etching": {
    linework: "thin, scratchy lines resembling vintage printmaking — organic and hand-pressed feeling",
    shading: "fine line texture shading — rough, organic, printmaking quality",
    color: "black ink only — vintage printmaking aesthetic",
    composition: "textured, atmospheric composition — the roughness of the line is part of the beauty",
    feel: "vintage printmaking — like a lithograph or acid-etched artwork",
    subjects: "nature, portraits, vintage illustrations — rendered with printmaking line texture",
  },

  // ── DOTWORK ───────────────────────────────────────────────

  "Dotwork": {
    linework: "no traditional linework — all forms are built entirely from individual dots",
    shading: "thousands of individually placed dots — dot density controls all tone and shadow",
    color: "black ink dots only — no lines, no fills",
    composition: "patient, meditative composition — the dot pattern is the texture and the form",
    feel: "hypnotic and textural — every detail is made of tiny dots",
    subjects: "mandalas, geometric designs, spiritual symbols, portraits rendered in dots",
  },

  "Stippling": {
    linework: "fine dot-based rendering — stippling dots replace all shading",
    shading: "stippled dot density controls contrast — dense dots for dark areas, sparse for light",
    color: "black ink dots only",
    composition: "illustration-quality composition built entirely from stippled dots",
    feel: "fine art stippling technique — patient and precise",
    subjects: "portraits and illustrations rendered entirely through stippled dot density",
  },

  "Pointillism": {
    linework: "all forms created through layered colored or black dots",
    shading: "layered dots of varying density create the full tonal range",
    color: "black ink or multiple colored dots layered to create optical color mixing",
    composition: "artistic dot-based image — viewed at distance the dots merge into forms",
    feel: "artistic and textural — inspired by pointillist painting technique",
    subjects: "abstract and realistic subjects rendered through artistic dot layering",
  },

  "Geometric Dotwork": {
    linework: "geometric forms constructed from precisely placed dots",
    shading: "dot fills within geometric shapes — precision dot placement",
    color: "black ink only",
    composition: "precise geometric composition filled with meticulous dotwork",
    feel: "mathematical and meditative — geometric precision meets dotwork patience",
    subjects: "sacred geometry, mandalas, geometric animals — all rendered in dotwork",
  },

  "Mandala": {
    linework: "precisely symmetrical fine linework radiating from a centre point",
    shading: "fine dotwork or line fills within mandala segments — or clean open linework",
    color: "black ink — or a single accent color for highlights",
    composition: "perfectly symmetrical radial composition — every segment mirrors the others",
    feel: "meditative and spiritual — radial symmetry creating a sense of sacred order",
    subjects: "spiritual mandala designs — concentric layers of geometric and floral patterns",
  },

  // ── JAPANESE ──────────────────────────────────────────────

  "Neo Japanese": {
    linework: "dynamic modern linework with Japanese flowing quality — bolder and more expressive",
    shading: "brighter, more dynamic shading than traditional Japanese — vibrant and contemporary",
    color: "brighter and more varied color palette than traditional — vivid and modern",
    composition: "dynamic modern composition with Japanese mythological energy",
    feel: "modern interpretation of Japanese tattooing — familiar iconography in a fresh, vibrant style",
    subjects: "mythological creatures, koi, dragons — reimagined with a contemporary aesthetic",
  },

  "Tebori": {
    linework: "organic, slightly uneven lines with a hand-poked quality — not machine-perfect",
    shading: "soft, organic shading with a characteristic Tebori diffusion — slightly softer than machine",
    color: "traditional Japanese color palette — rich and saturated",
    composition: "traditional Japanese body art compositions — flowing and symbolic",
    feel: "hand-crafted quality — slightly organic softness that comes from hand-applied ink",
    subjects: "traditional Japanese full-body compositions — dragons, koi, samurai, nature",
  },

  // ── MODERN ────────────────────────────────────────────────

  "Watercolor": {
    linework: "minimal or no outlines — color bleeds beyond form edges like a watercolor painting",
    shading: "soft, flowing color transitions — paint bleeds, splashes, and washes",
    color: "soft pastel or vibrant watercolor palette — wet-looking color flows and bleeds",
    composition: "loose, painterly composition — organic and flowing, not constrained by outlines",
    feel: "like a watercolor painting on skin — soft, dreamy, and painterly",
    subjects: "flowers, animals, portraits — rendered with watercolor paint bleeds and washes",
  },

  "Sketch Style": {
    linework: "loose, hand-drawn sketch lines — multiple overlapping strokes, pencil-sketch quality",
    shading: "rough hatching and loose cross-hatching — sketch book shading quality",
    color: "black and grey or light color washes — all applied with a sketchy, unfinished quality",
    composition: "artistic and spontaneous — feels like a live sketch in an artist's notebook",
    feel: "as if the artist sketched it freehand — deliberately loose and expressive",
    subjects: "portraits, concepts, figures — rendered with deliberate sketch-quality linework",
  },

  "Abstract": {
    linework: "free, expressive, non-representational linework — no rules, pure artistic expression",
    shading: "creative, unconventional shading — whatever serves the abstract composition",
    color: "creative color choices — bold, atmospheric, or monochrome as the design demands",
    composition: "non-traditional abstract composition — shapes, textures, and forms without a recognizable subject",
    feel: "pure artistic expression — does not represent any specific object, person, or place",
    subjects: "abstract shapes, textures, color fields, free-form compositions",
  },

  "Trash Polka": {
    linework: "bold black graphic elements combined with realistic imagery — collage-style clash",
    shading: "high contrast black realism mixed with graphic design elements",
    color: "black and red ONLY — no other colors, ever",
    composition: "chaotic and dynamic collage — realism smashed against typography, splashes, and geometric elements",
    feel: "deliberately confrontational and chaotic — the tension between realism and graphic design IS the style",
    subjects: "portraits combined with typography, geometric shapes, splatter effects — black and red only",
  },

  "Ignorant Style": {
    linework: "deliberately crude, childlike, naive linework — intentionally imperfect and simple",
    shading: "minimal or no shading — flat and unrefined",
    color: "black ink or simple primary colors — deliberately unsophisticated",
    composition: "simple and unskilled-looking by design — the simplicity is intentional and ironic",
    feel: "deliberately naive and unpretentious — looks like a doodle, intentionally anti-fine-art",
    subjects: "funny characters, doodles, simple faces, random objects — all deliberately crude",
  },

  "Sticker Style": {
    linework: "bold, uniform black outlines — thick border creating a sticker effect with drop shadow",
    shading: "flat color fills with a subtle drop shadow to create the illusion of a peeling sticker",
    color: "bright, bold sticker-like colors — saturated and clean",
    composition: "isolated subject on white — clear sticker silhouette with thick border and shadow",
    feel: "looks exactly like a vinyl sticker applied to skin — clean, bold, and graphic",
    subjects: "cartoons, icons, logos, characters — designed to look like a sticker",
  },

  "Cybersigilism": {
    linework: "sharp, flowing futuristic black lines — angular and organic simultaneously, tribal-tech hybrid",
    shading: "no shading — pure black linework only",
    color: "black ink only",
    composition: "sharp, angular flowing composition — resembles a tribal pattern but with a digital/cyber edge",
    feel: "futuristic tribal — like ancient symbols reimagined by a cyberpunk culture",
    subjects: "abstract cyber motifs — futuristic sigils, digital-tribal hybrid patterns",
  },

  "Vaporwave": {
    linework: "clean outlines with retro digital aesthetic — 80s/90s computer graphic sensibility",
    shading: "gradient fills and glowing effects — neon glow quality",
    color: "neon pink, purple, cyan, and blue — retro digital color palette with gradient transitions",
    composition: "nostalgic digital aesthetic — grid lines, sunset gradients, retro statuary",
    feel: "1980s digital nostalgia — like an old computer aesthetic meets tattoo art",
    subjects: "classical statues, retro technology, geometric grids, sunsets — in neon vaporwave colors",
  },

  // ── BLACKWORK ─────────────────────────────────────────────

  "Blackwork": {
    linework: "bold black linework — strong outlines and fills",
    shading: "heavy solid black fills with high saturation contrast",
    color: "black ink only — maximum saturation, no grey, no color",
    composition: "strong graphic composition — bold black shapes creating powerful visual impact",
    feel: "graphic and bold — pure black ink maximally saturated",
    subjects: "tribal patterns, abstract designs, bold graphic shapes",
  },

  "Heavy Blackwork": {
    linework: "extremely heavy black outlines — very thick strokes",
    shading: "large areas of completely saturated solid black — dense ink packing",
    color: "black ink only — densely packed, no gaps",
    composition: "large-scale bold composition — significant portions of the design are solid black",
    feel: "bold and aggressive — large black masses dominating the design",
    subjects: "sleeves, body suit elements, large abstract or tribal designs with heavy black coverage",
  },

  "Ornamental Blackwork": {
    linework: "fine symmetrical black linework — decorative ornamental patterns",
    shading: "symmetrical black fills within ornamental pattern work",
    color: "black ink only",
    composition: "decorative and symmetrical — mandala-like or lacework quality",
    feel: "decorative black jewelry — ornate and symmetrical",
    subjects: "mandalas, lacework, filigree patterns — in solid blackwork style",
  },

  "Dark Art": {
    linework: "atmospheric heavy linework — detailed dark imagery with dramatic contrast",
    shading: "heavy contrast shading creating dark atmosphere — deep blacks and moody midtones",
    color: "black and grey primarily — dark, moody, and atmospheric",
    composition: "dramatic, atmospheric composition — darkness and shadow as design elements",
    feel: "dark fantasy horror aesthetic — unsettling, moody, and visually dramatic",
    subjects: "demons, skulls, horror themes, dark fantasy creatures, sinister imagery",
  },

  "Brutal Blackwork": {
    linework: "extremely aggressive, heavy black linework — avant-garde and confrontational",
    shading: "massive black saturation — overwhelming black fills",
    color: "black ink only — the most saturated, densest blackwork possible",
    composition: "aggressive, avant-garde composition — maximum visual impact through black mass",
    feel: "extreme and aggressive — the most intense blackwork aesthetic",
    subjects: "abstract and avant-garde designs — purely bold graphic statements in black",
  },

  "Realistic": {
    linework: "precise linework capturing accurate form, dimension, and anatomical detail",
    shading: "photorealistic shadow mapping and layered ink application — precise highlight control creating three-dimensional depth",
    color: "black and grey or full color — always rendered with photographic accuracy and tonal realism",
    composition: "life-like, three-dimensional composition — appears as if the subject could step off the skin",
    feel: "indistinguishable from a photograph — photographic accuracy in every detail",
    subjects: "portraits, animals, landscapes, everyday objects — rendered with photographic realism",
  },

  "Anime": {
    linework: "bold clean anime-style outlines — precise linework for facial details and dynamic expressive shapes",
    shading: "vibrant expressive shading with anime-style shadow blocks and highlight pops — dynamic and energetic",
    color: "vibrant saturated anime color palette — bright, punchy, high-contrast colors characteristic of animated series",
    composition: "dynamic anime composition — expressive character poses, iconic ability symbols, energy and motion",
    feel: "straight from a Japanese animated series — vibrant, expressive, and unmistakably anime",
    subjects: "characters from popular series (Naruto, Dragon Ball Z, One Piece, Jujutsu Kaisen), iconic scenes, ability symbols, crew emblems",
  },

  "Manga": {
    linework: "loose flowing black ink linework — high-contrast, expressive, panel-inspired framing",
    shading: "cross-hatching for texture and depth — black-and-white manga tonal range with screen-tone quality",
    color: "black and white only — the graphic language of manga, no color fills",
    composition: "manga panel-inspired framing — dramatic story scene or character portrait as if lifted from a page",
    feel: "black and white manga aesthetic — graphic, bold, and cinematic like a page from a manga volume",
    subjects: "manga panels, character portraits, dramatic scenes, action sequences from series like JoJo's Bizarre Adventure or Berserk",
  },

  "Minimal": {
    linework: "single-weight fine lines only — hair-thin, stripped to the absolute essential form",
    shading: "minimal to no shading — negative space does the work",
    color: "black ink only or single-color fine line — never heavy fills or complex color",
    composition: "extremely sparse and considered — strategic negative space is as important as the design itself",
    feel: "less is more — elegant restraint where every line earns its place",
    subjects: "geometric shapes, botanical outlines, small animals, symbols, single-word lettering, abstract line compositions",
  },

  "Gothic": {
    linework: "bold blackwork or fine black-and-grey linework — intricate detail for lace, architectural elements, and ornamental decoration",
    shading: "strong contrast with heavy use of negative space — dark romantic atmosphere",
    color: "black and grey — dark, atmospheric, with deep shadows and sharp highlights",
    composition: "ornate gothic composition — dark romanticism with macabre symbolism and architectural grandeur",
    feel: "Gothic art, architecture, and subculture — dark romantic, ornate, and melancholic",
    subjects: "skulls, bats, roses, gargoyles, cathedrals, stained glass windows, crosses, religious iconography, Victorian-era motifs",
  },

  "Horror": {
    linework: "atmospheric dark linework — detailed and expressive, often applied with organic freehand quality",
    shading: "dark atmospheric shading with high-contrast black-and-grey — deep shadows, menacing highlights",
    color: "black and grey primarily — dark and atmospheric, occasionally with blood red accents",
    composition: "unsettling, macabre composition — follows the body's organic contours for maximum impact",
    feel: "genuinely frightening and macabre — evokes dread, fascination, and the supernatural",
    subjects: "monsters, demons, zombies, iconic horror movie characters (Freddy Krueger, Michael Myers, Jason Voorhees), skulls, witches, alchemical symbols",
  },

  "Lettering": {
    linework: "custom-designed letterforms with precise line weight control — careful spacing and stroke continuity suited to body curvature",
    shading: "dimensional shading within letterforms where appropriate — drop shadows or 3D letter effects",
    color: "black ink primarily — clean and legible above all else",
    composition: "typographic composition — the letterforms themselves are the primary art",
    feel: "custom hand-lettered typography — each letterform is a precision craft object",
    subjects: "quotes, names, meaningful phrases, Old English and Gothic scripts, ornamental calligraphy, Chicano-style lettering",
  },

  "Script": {
    linework: "long tapered smooth strokes — continuous flowing cursive linework with flourishes and decorative filigree",
    shading: "minimal shading — the elegance is entirely in the flowing line quality",
    color: "black ink — clean, legible, and elegant",
    composition: "flowing cursive composition — words and letters arranged in elegant natural curves",
    feel: "handwritten calligraphy quality — personal, flowing, and deeply elegant",
    subjects: "personal names, meaningful dates, inspirational quotes, single words, song lyrics, memorial inscriptions",
  },

  "Cover-up Design": {
    linework: "bold, large-scale linework — elements 2–3x the size of the original tattoo being covered, with strategic flowing shapes",
    shading: "dense, dark, heavily saturated shading — strategic color mapping to optically absorb old linework",
    color: "dark, saturated colors or heavy black — dense enough texture and tone to mask what lies beneath",
    composition: "large flowing composition designed to envelop and conceal the existing tattoo area — flowing shapes absorb old linework",
    feel: "powerful and covering — a fresh statement design that completely transforms what was before",
    subjects: "floral compositions, animals with detailed fur or feathers (wolves, lions, crows), neo-traditional designs, geometric patterns, Japanese-inspired art — any subject with sufficient texture and dark ink density",
  },

  "Sleeve Design": {
    linework: "cohesive flowing linework designed to wrap 360 degrees around the arm — elements connect across zones",
    shading: "unified shading style throughout — consistent tonal language from shoulder to wrist",
    color: "consistent palette unified across the full sleeve — background elements (clouds, water, smoke, geometric connectors) tie focal pieces together",
    composition: "full arm composition divided into zones (shoulder, bicep, elbow, forearm, wrist) — individual focal pieces unified by background elements",
    feel: "unified full arm artwork — a single cohesive narrative that reads as one piece across the entire arm",
    subjects: "Japanese traditional themes, realism portraits, mythological narratives, nature and wildlife, biomechanical, dark art — any consistent theme carried across the full arm",
  },

  "Patchwork Design": {
    linework: "each patch has its own distinct linework style — no unified linework",
    shading: "each patch has its own shading — intentionally mismatched",
    color: "varied colors per patch — no single consistent palette",
    composition: "collection of separate independent small tattoos displayed together — no forced connection",
    feel: "deliberately eclectic — a curated collection, not a unified design",
    subjects: "mixed themes — any combination of symbols, images, characters as separate standalone pieces",
  },
};

// ── Helpers ──────────────────────────────────────────────────

function buildPaletteBlock(colorHexes: string[] = []): { directive: string; constraint: string } {
  const palette = resolveColors(colorHexes);

  if (palette.length === 0) {
    return {
      directive: "",
      constraint: "- Black & grey only — no colour fills. Pure black ink with grey wash shading.",
    };
  }

  const lines = palette.map((c) => `  - ${c.name} (${c.hex}) — ${c.usage}`).join("\n");

  return {
    directive: `
COLOUR PALETTE — use ONLY these inks, no other hues:
${lines}

- Balance the colours naturally within the composition.
- If one colour is listed, the design must be monochromatic in that ink.
- Render pigments as saturated and freshly tattooed, not faded.
`.trim(),
    constraint: "- Use ONLY the colours in the COLOUR PALETTE above. Any other hue is wrong.",
  };
}

function buildBodyAreaBlock(targetBodyArea: string): { directive: string; constraint: string } {
  const trimmed = targetBodyArea.trim();
  if (!trimmed) return { directive: "", constraint: "- No body parts, skin, hands, limbs, or tattoo machines" };

  const isComplexAnatomy = trimmed.toLowerCase().includes("hand") || trimmed.toLowerCase().includes("face") || trimmed.toLowerCase().includes("head") || trimmed.toLowerCase().includes("finger");
  const anatomyConstraint = isComplexAnatomy 
    ? `\n- CRITICAL ANATOMY CONSTRAINT: The target area is complex (${trimmed}). DO NOT draw deformed hands, broken faces, or mangled fingers in the background. Draw ONLY the tattoo artwork flat on the white background.` 
    : "";

  return {
    directive: `
TARGET BODY AREA: This tattoo will be placed on the ${trimmed}. Design it with that area in mind:
- Choose proportions, flow direction, and silhouette that suit the ${trimmed}
- Adjust detail density so the design reads well at the typical size for the ${trimmed}
- Compose so the design feels at home on that body part
`.trim(),
    constraint: `- ABSOLUTELY NO body parts in the image. Despite the target area being the ${trimmed}, the output MUST be the tattoo DESIGN ONLY — drawn flat on pure white background, exactly as it would appear on stencil paper before being applied to skin.
- Do NOT draw the ${trimmed}, any skin, any anatomy, any limb, any silhouette of a body. Only the standalone artwork.${anatomyConstraint}`,
  };
}

function buildStyleBlock(style: string, hasColors: boolean): string {
  const desc = STYLE_PROMPT_DESCRIPTORS[style];

  if (!desc) {
    const shadingLine = hasColors
      ? "solid colour fills with smooth gradients and confident black outlines"
      : "smooth black-and-grey gradients using stippling or hatching";
    return `STYLE: ${style} tattoo, hand-drawn quality
- Linework: confident black ink strokes — bold outlines with fine interior detail
- Shading: ${shadingLine}
- Composition: balanced and centred, designed to read clearly at small sizes on skin
- Finish: crisp, sharp edges — no smearing or blurriness`;
  }

  return `STYLE: ${style} tattoo — every visual characteristic below is MANDATORY:
- Linework: ${desc.linework}
- Shading: ${desc.shading}
- Color: ${desc.color}
- Composition: ${desc.composition}
- Feel: ${desc.feel}
- Reference subjects for style accuracy: ${desc.subjects}
- Finish: crisp, sharp edges — no smearing or blurriness
- CRITICAL: The output must be unmistakably and immediately recognisable as ${style} style to a knowledgeable tattoo artist`;
}


// ── 1. TATTOO DESIGN — Initial Generation ───────────────────

export function buildInitialDesignPrompt(
  description: string,
  style: string,
  hasReferenceImages: boolean,
  colorHexes: string[] = [],
  targetBodyArea: string = "",
  referenceCount = 0
): string {
  const styleLabel = style || "fine-line black-and-grey";
  const palette = buildPaletteBlock(colorHexes);
  const bodyArea = buildBodyAreaBlock(targetBodyArea);
  const hasColors = colorHexes.length > 0;

  // With more than one reference, call out that THIS variation's Image 1 is
  // the lead — the caller rotates which reference lands in that slot across
  // the batch (see rotateReferences in the generate route), so this same
  // wording, paired with a different Image 1 each time, is what actually
  // makes a 5-image batch reflect all the references instead of only the
  // one that happened to be uploaded first every single time.
  const referenceDirective = hasReferenceImages
    ? referenceCount > 1
      ? `Extract the core motifs, composition, and linework character from the reference images and translate them into this tattoo design.\n- Multiple reference images were provided. Image 1 is THIS variation's primary inspiration — base the main motif and composition on it, then weave in complementary smaller details from the other reference(s) so the result still feels like part of the same moodboard.\n- CRITICAL OVERRIDE: DO NOT blindly copy the exact colors or shading style of the reference images! You MUST completely reimagine the reference images in the EXACT colors, palette, and style requested below.`
      : `Extract the core motifs, composition, and linework character from the reference images and translate them into this tattoo design.\n- CRITICAL OVERRIDE: DO NOT blindly copy the exact colors or shading style of the reference images! You MUST completely reimagine the reference images in the EXACT colors, palette, and style requested below.`
    : "";

  return `
Create a single, complete ${styleLabel} tattoo design.

DESCRIPTION: ${description.trim()}

${referenceDirective}

${bodyArea.directive}

${palette.directive}

${buildStyleBlock(styleLabel, hasColors)}

OUTPUT:
- Pure white background
${palette.constraint}
${bodyArea.constraint}
- No typography, watermarks, or borders
- Single design, square (1:1) aspect ratio
- Professional tattoo studio quality
`.trim();
}

// ── 2. TATTOO DESIGN — Refinement ───────────────────────────

export function buildRefinementPrompt(
  description: string,
  style: string,
  refinement: RefinementInfo,
  colorHexes: string[] = [],
  targetBodyArea: string = ""
): string {
  const styleLabel = style || "fine-line black-and-grey";
  const palette = buildPaletteBlock(colorHexes);
  const bodyArea = buildBodyAreaBlock(targetBodyArea);
  const hasColors = colorHexes.length > 0;

  const imageLabels = refinement.selectedImages
    .map((img) => `  - Image ${img.index}: "${img.name}"`)
    .join("\n");

  return `
Refine this tattoo design based on the selected variations and customer feedback.

ORIGINAL DESCRIPTION: ${description.trim()}

REFERENCE IMAGES (variations the customer liked):
${imageLabels}

CUSTOMER FEEDBACK:
"${refinement.text.trim()}"

${bodyArea.directive}

${palette.directive}

INSTRUCTIONS:
- Blend the best elements from the reference images according to the customer's feedback
- If one image is selected, use it as the primary basis and apply the feedback on top
- Deliver a complete, standalone tattoo design — not a collage or side-by-side comparison

${buildStyleBlock(styleLabel, hasColors)}

OUTPUT:
- Pure white background
${bodyArea.constraint}
- No typography, watermarks, or borders
- Single centred design, square (1:1) aspect ratio
- Crisp, sharp linework
${palette.constraint}
`.trim();
}

// ── 2b. TATTOO DESIGN — Faithful Refinement (minor changes only) ──

export function buildFaithfulRefinementPrompt(
  description: string,
  style: string,
  refinement: RefinementInfo,
  colorHexes: string[] = [],
  targetBodyArea: string = ""
): string {
  const styleLabel = style || "fine-line black-and-grey";
  const palette = buildPaletteBlock(colorHexes);
  const bodyArea = buildBodyAreaBlock(targetBodyArea);

  const imageLabels = refinement.selectedImages
    .map((img) => `  - Image ${img.index}: "${img.name}"`)
    .join("\n");

  return `
Apply ONLY the following minor changes to this tattoo design. Preserve everything else exactly.

ORIGINAL DESIGN:
${imageLabels}

REQUESTED CHANGES (apply ONLY these — nothing else):
"${refinement.text.trim()}"

PRESERVATION RULES — these are MANDATORY:
- Keep the exact same composition, layout, and proportions
- Keep the exact same linework weight and style
- Keep the exact same shading technique and tonal values
- Keep all existing motifs, elements, and symbols unless directly mentioned in the changes
- Keep the same overall size and spatial balance of the design
- Do NOT add new elements unless explicitly requested
- Do NOT "improve" or "enhance" anything not mentioned in the changes
- The result must look like the original with only the specific changes applied

ORIGINAL DESIGN CONTEXT:
${description.trim()} — ${styleLabel} style

${bodyArea.directive}

${palette.directive}


OUTPUT:
- Pure white background
${bodyArea.constraint}
- No typography, watermarks, or borders
- Single centred design, square (1:1) aspect ratio
- Crisp, sharp linework
${palette.constraint}
`.trim();
}

// ── 2c. TATTOO DESIGN — Text Tattoo (initial) ───────────────

export function buildTextTattooPrompt(
  description: string,
  style: string,
  hasReferenceImages: boolean,
  colorHexes: string[] = [],
  targetBodyArea: string = "",
  textTattooDetails?: { font: string }
): string {
  const styleLabel = style || "fine-line black-and-grey";
  const palette = buildPaletteBlock(colorHexes);
  const bodyArea = buildBodyAreaBlock(targetBodyArea);
  const hasColors = colorHexes.length > 0;

  const referenceDirective = hasReferenceImages
    ? "Use the reference images to match the requested font style, lettering character, and any accompanying design elements."
    : "";

  const fontDirective = textTattooDetails?.font
    ? `\nFONT REQUIREMENT: The user has explicitly selected the font "${textTattooDetails.font}". You MUST render the text in this exact font style.`
    : "";

  return `
You are a professional tattoo lettering artist. Create a single complete tattoo design where TEXT is the primary element.

DESCRIPTION: ${description.trim()}
${fontDirective}

${referenceDirective}

${bodyArea.directive}

${palette.directive}

TEXT ACCURACY — these are the highest priority requirements:
- Render every letter, word, and character EXACTLY as described — spelling must be perfect
- The font style requested must be faithfully reproduced — if a specific font or style is named (e.g. Old English, cursive, serif, handwritten), match it precisely
- Letter spacing, kerning, and baseline must be consistent and intentional — no uneven gaps or misaligned characters
- If the description mentions a font by name, reproduce that font's distinctive letterforms accurately

LETTERING STYLE:
${buildStyleBlock(styleLabel, hasColors)}

ACCOMPANYING ELEMENTS (if any described):
- Symbols, flourishes, hearts, butterflies, flowers, or other motifs mentioned in the description must be rendered at the correct size relative to the text
- Placement of decorative elements must match the description exactly — e.g. "heart between words", "roses below the text", "wings above"
- Decorative elements and text must feel like a unified composition, not disconnected pieces

COMPOSITION:
- Text must be the visual anchor of the design — all other elements support it
- The layout must be intentional — single line, stacked, arched, or curved as described
- Balanced negative space around and between elements


OUTPUT:
- Pure white background
${palette.constraint}
${bodyArea.constraint}
- No unintended text, watermarks, or decorative borders
- Single centred design, square (1:1) aspect ratio
- Professional tattoo studio quality — ready to transfer to a stencil
`.trim();
}

// ── 2d. TATTOO DESIGN — Text Tattoo (refinement) ────────────

export function buildTextTattooRefinementPrompt(
  description: string,
  style: string,
  refinement: RefinementInfo,
  colorHexes: string[] = [],
  targetBodyArea: string = "",
  textTattooDetails?: { font: string }
): string {
  const styleLabel = style || "fine-line black-and-grey";
  const palette = buildPaletteBlock(colorHexes);
  const bodyArea = buildBodyAreaBlock(targetBodyArea);
  const hasColors = colorHexes.length > 0;

  const imageLabels = refinement.selectedImages
    .map((img) => `  - Image ${img.index}: "${img.name}"`)
    .join("\n");

  const baseInstruction = refinement.faithfulMode
    ? `Apply ONLY the following minor changes to the selected text tattoo design. Preserve all lettering, font style, spacing, and element placement exactly — change only what is explicitly described.`
    : `Refine this text tattoo design based on the selected variations and customer feedback. The text and font accuracy must remain the highest priority.`;

  const fontDirective = textTattooDetails?.font
    ? `\nFONT REQUIREMENT: The user has explicitly selected the font "${textTattooDetails.font}". You MUST render the text in this exact font style.`
    : "";

  return `
You are a professional tattoo lettering artist. ${baseInstruction}

ORIGINAL DESCRIPTION: ${description.trim()}
${fontDirective}

REFERENCE DESIGNS:
${imageLabels}

CUSTOMER FEEDBACK:
"${refinement.text.trim()}"

${bodyArea.directive}

${palette.directive}

TEXT ACCURACY — maintain throughout:
- Every letter and word must be spelled and rendered exactly correctly
- Font style and letterform character from the selected reference(s) must be preserved or improved
- Letter spacing, kerning, and baseline alignment must be clean and consistent

ACCOMPANYING ELEMENTS:
- Preserve the position, scale, and style of all decorative elements unless the feedback specifically requests changes
- Text and design elements must remain a unified composition

${buildStyleBlock(styleLabel, hasColors)}

OUTPUT:
- Pure white background
${bodyArea.constraint}
- No unintended text, watermarks, or borders
- Single centred design, square (1:1) aspect ratio
- Crisp, sharp linework
${palette.constraint}
`.trim();
}

// ── 3. Unified entry point used by /api/generate ─────────────

export function buildTattooPrompt(
  description: string,
  style: string,
  hasReferenceImages: boolean,
  refinement?: RefinementInfo,
  colorHexes: string[] = [],
  targetBodyArea: string = "",
  isTextTattoo = false,
  textTattooDetails?: { font: string },
  referenceCount = 0
): string {
  if (refinement && refinement.selectedImages.length > 0) {
    if (isTextTattoo) {
      return buildTextTattooRefinementPrompt(description, style, refinement, colorHexes, targetBodyArea, textTattooDetails);
    }
    if (refinement.faithfulMode) {
      return buildFaithfulRefinementPrompt(description, style, refinement, colorHexes, targetBodyArea);
    }
    return buildRefinementPrompt(description, style, refinement, colorHexes, targetBodyArea);
  }
  if (isTextTattoo) {
    return buildTextTattooPrompt(description, style, hasReferenceImages, colorHexes, targetBodyArea, textTattooDetails);
  }
  return buildInitialDesignPrompt(description, style, hasReferenceImages, colorHexes, targetBodyArea, referenceCount);
}

// ── 4. PLACEMENT — Standard mode ────────────────────────────

function inferCameraFrame(placement: string): string {
  const p = placement.toLowerCase();

  if (/wrist|forearm|inner arm|hand|finger|knuckle/.test(p))
    return "Frame the shot as if the person is casually extending their arm toward the camera — hand and forearm naturally visible, relaxed pose. The tattoo fills a comfortable portion of the frame.";

  if (/neck|throat|collarbone|clavicle|behind.?ear|nape/.test(p))
    return "Frame as a natural portrait shot — head and upper chest visible. The tattoo on the neck is the clear focal point without being uncomfortably close.";

  if (/shoulder|upper arm|deltoid|bicep|tricep/.test(p))
    return "Frame as a three-quarter portrait from the side — shoulder and upper arm clearly visible. Natural standing pose, the tattoo sits as the main subject.";

  if (/chest|sternum|pec|breast/.test(p))
    return "Frame as an upper-body torso shot — chest and collarbone area in view. Natural lighting, relaxed posture.";

  if (/rib|side|flank/.test(p))
    return "Frame from the side, upper body — the rib or side area is the clear subject. Natural pose, arm slightly raised if needed to expose the placement.";

  if (/back|spine|shoulder.?blade|upper back|lower back/.test(p))
    return "Shot from behind — upper or mid back framed naturally, the way a tattoo artist would photograph a back piece. Portrait orientation.";

  if (/ankle|foot|heel|toe/.test(p))
    return "Shot from a natural low angle — foot and ankle resting comfortably, like someone sitting with legs extended. The ankle area is clearly visible and well-lit.";

  if (/calf|shin|lower leg/.test(p))
    return "Frame showing the lower leg — knee to foot visible, natural seated or standing pose. The calf or shin tattoo is the main subject.";

  if (/thigh|upper leg|hip|outer thigh/.test(p))
    return "Frame showing the thigh area naturally — seated or standing pose, the placement clearly in focus without being overly cropped.";

  return "Frame the shot the way a tattoo photographer would to best showcase the tattoo at this placement — close enough that the tattoo is the clear subject, far enough to feel natural and in context.";
}

export function buildPlacementPrompt(placementDescription: string, hasBodyPhoto: boolean): string {
  const placementClause = placementDescription.trim()
    ? `Place the tattoo on the ${placementDescription.trim()}.`
    : "Place the tattoo in the most aesthetically fitting location visible in the image.";

  const bodyContext = hasBodyPhoto
    ? "Image 1 is the tattoo design (on a white background). Image 2 is the customer's body photo. Composite the tattoo ink onto the body — the white background of Image 1 is NOT part of the tattoo, treat it as fully transparent."
    : `Image 1 is the tattoo design (on a white background — treat white as transparent, not a color). Generate a realistic human body for the placement area and composite only the ink artwork onto the skin.\n\nCAMERA FRAMING: ${inferCameraFrame(placementDescription)}`;

  return `
You are a professional tattoo retouching artist. Your task is to make a photorealistic tattoo placement preview that looks like a real photograph of a freshly tattooed person.

${placementClause}
${bodyContext}

CRITICAL — THE TATTOO DESIGN HAS A WHITE BACKGROUND:
- The white in the design image is the background — it must NOT appear on skin
- Only the actual ink lines, shading, and artwork should transfer onto the skin
- The skin should show through everywhere the original design had white space

REALISM REQUIREMENTS — every one of these must be true in the output:
- The ink sits BENEATH the epidermis — skin texture, pores, and fine hair are visible ON TOP of the tattoo ink
- The tattoo follows the natural curves, contours, and muscle definition of the body — it wraps the skin, it does not float above it
- Skin tone subtly influences the ink color, especially at the edges — pure blacks shift slightly warmer on darker skin
- The lighting and shadows from the body fall OVER the tattoo — highlights and shadows cross the tattoo as if it is part of the skin
- Tattoo edges are slightly soft and natural — not sharp digital cut-out edges
- Scale the tattoo proportionally for the body part — a forearm tattoo reads as forearm-sized, not oversized or miniature

WHAT TO AVOID:
- No white or light halo around the tattoo edges
- No sticker effect — the tattoo must not look like an image glued onto skin
- No floating or shadow beneath the tattoo
- Do not change the tattoo design — preserve every line, shape, and detail exactly

OUTPUT: A single photorealistic photograph — the kind a professional tattoo studio would post to Instagram to showcase fresh work. Natural studio or daylight lighting.
`.trim();
}

// ── 5. PLACEMENT — Composite mode ───────────────────────────

export function buildCompositePrompt(): string {
  return `
You are a professional tattoo retouching artist. You have three reference images:

IMAGE 1 — The composite: the customer's body photo with the tattoo design overlaid roughly at the intended position and size. This is your STARTING REFERENCE for placement — it is a flat mock-up, NOT a rigid mask to copy exactly.
IMAGE 2 — The clean tattoo design: the isolated artwork on a white background. The white is background only — treat it as transparent. Use this image to recover sharp linework and fine detail.
IMAGE 3 — The original body photo: clean skin with natural lighting, skin texture, and underlying anatomy. Use this to understand the true 3D shape of the body underneath the tattoo.

YOUR TASK: Produce a single photorealistic photograph that looks like a real person with this tattoo — the kind of studio photo posted to showcase fresh professional ink.

🚨 ━━━ STRICT STRUCTURAL PRESERVATION (HIGHEST PRIORITY) ━━━ 🚨
- The background, lighting, framing, crop, and anatomical structure of the body in Image 3 MUST be preserved EXACTLY as they are.
- DO NOT ZOOM IN. DO NOT CROP THE IMAGE.
- If the body part is small in Image 3, it MUST be small in the output. If there is empty space around the body in Image 3, that EXACT empty space MUST be in the output. Do not fill the frame with the body part if it was not like that in Image 3.
- You are ONLY allowed to modify the pixels where the tattoo ink is being applied.
- Any change to the original photo's background, crop, or the person's original anatomy is an absolute failure.

━━━ POSITION, SIZE AND REALISM ━━━
- Image 1 shows the intended placement. The overall position and scale of the tattoo MUST match Image 1.
- You CANNOT move the tattoo to a different body part (e.g., if it is on the face, it must stay on the face; if on the hand, it must stay on the hand). Moving the tattoo is an absolute failure.
- If any part of the tattoo design extends PAST the skin and floats in the empty background in Image 1, you MUST erase or clip those floating parts. Tattoo ink can ONLY exist on skin. Do not render floating ink in the background.
- However, Image 1 is just a flat mock-up. You MUST warp, bend, and adjust the perspective of the tattoo's edges and internal shapes so it naturally follows the 3D curves, muscles, and contours of the body shown in Image 3. Do not leave it looking like a flat sticker.

━━━ BLENDING AND PHOTOREALISM — ALL MUST BE TRUE ━━━
- The white background of the tattoo design is INVISIBLE — only ink lines and shading appear on the skin. No white patches, no light halo.
- The ink sits BENEATH the epidermis — skin texture, pores, and fine surface hair from Image 3 are visible overlaid on top of the ink.
- Match the lighting direction, shadows, and skin tone from Image 3.
- Skin tone subtly tints the ink, especially at edges — the ink does not look cleaner or more saturated than real tattoo ink.
- Tattoo edges are slightly soft — real ink diffuses slightly into the dermis, it does not have a sharp digital cut-out edge.

━━━ WHAT NOT TO DO ━━━
- Do NOT produce a sticker-on-skin effect — no hard edges, no shadow beneath the design.
- Do NOT show a white or light patch where the design background was.
- Do NOT change the tattoo's core design or add new elements — only adjust its projection onto the surface.
- Do NOT alter the framing, crop, or background from Image 3.

OUTPUT: Same framing and background as Image 3. Photorealistic — indistinguishable from a real photograph of a freshly tattooed person.
`.trim();
}

// ── 6. PLACEMENT — Composite mode, complex anatomy (face/hand) ──

export function buildCompositePromptForComplexAnatomy(surface: "face" | "hand"): string {
  const anatomyNote = surface === "face"
    ? "Faces have both flat areas (cheeks, forehead, temple) and areas with real curvature or ridges (nose bridge and tip, eye socket edges, jawline)."
    : "Hands have both flat areas (back of hand between the knuckles and wrist, the flat top before fingers begin) and areas with real curvature (finger cylinders, knuckle valleys, thumb side).";

  return `
You are a professional tattoo retouching artist. You have three reference images:

IMAGE 1 — The composite: the customer's body photo with the tattoo design overlaid roughly at the intended position and size. This is a STARTING REFERENCE for placement and scale only — it is a flat mock-up, NOT a rigid mask to copy exactly.
IMAGE 2 — The clean tattoo design: the isolated artwork on a white background. The white is background only — treat it as transparent. Use this ONLY to recover sharp linework and fine detail.
IMAGE 3 — The original body photo: clean skin with natural lighting, skin texture, and underlying anatomy. Use this to understand the true 3D shape of the body underneath the tattoo.

YOUR TASK: Produce a single photorealistic photograph of this person with the tattoo naturally applied — the way a real tattoo artist would stencil and apply it, not the way a flat sticker would sit on top of skin.

🚨 ━━━ STRICT STRUCTURAL PRESERVATION (HIGHEST PRIORITY) ━━━ 🚨
- The background, lighting, framing, crop, and anatomical structure of the body in Image 3 MUST be preserved EXACTLY as they are.
- DO NOT ZOOM IN. DO NOT CROP THE IMAGE.
- If the body part is small in the frame in Image 3, it MUST remain small in the output. If there is empty space around the body in Image 3, that EXACT empty space MUST be in the output. Do not fill the frame with the body part if it was not like that in Image 3.
- You are ONLY allowed to modify the pixels where the tattoo ink is being applied.
- Any change to the original photo's background, crop, or the person's original anatomy is an absolute failure.

━━━ SURFACE-AWARE PLACEMENT — READ CAREFULLY ━━━
${anatomyNote}

Image 1 shows the intended position and size of the design. Before rendering, look carefully at the actual skin surface under the design in Image 3:

- The overall position and scale of the tattoo MUST match Image 1 exactly. You CANNOT move the tattoo to a different body part (e.g., if it is on the face, it must stay on the face; if on the hand, it must stay on the hand). Moving the tattoo is an absolute failure.
- If any part of the tattoo design extends PAST the skin and floats in the empty background in Image 1, you MUST erase or clip those floating parts. Tattoo ink can ONLY exist on skin. Do not render floating ink in the background.
- You MUST warp, bend, and adjust the perspective of the tattoo so it naturally follows the 3D curves, muscles, and contours of the anatomy shown in Image 3.
- Do NOT leave it looking like a flat sticker. Even seemingly flat areas like cheeks or the back of a hand have subtle curvature that the tattoo must respect.
- Where the design crosses a real ridge, fold, or edge (e.g., nose bridge, knuckle lines, jawline, fingers), you must bend and foreshorten the linework at that exact point so it wraps the curve perfectly.
- Keep the design's overall content, style, and proportions recognisable throughout — you are adjusting how it sits on the surface, not redrawing it.

━━━ REALISM — ALL OF THESE MUST BE TRUE ━━━
- The white background of the tattoo design is INVISIBLE — only ink lines and shading appear on the skin. No white patches, no light halo.
- The ink sits BENEATH the epidermis — skin texture, pores, and fine surface hair from Image 3 are visible overlaid on top of the ink.
- The tattoo follows the skin's natural curves and muscle definition — it wraps the body, it does not float above it.
- Lighting and shadows from Image 3 cross over the tattoo surface — the same light that falls on the surrounding skin also falls on the tattoo.
- Skin tone subtly tints the ink, especially at edges — the ink does not look cleaner or more saturated than real tattoo ink.
- Tattoo edges are slightly soft — real ink diffuses slightly into the dermis, it does not have a sharp digital cut-out edge.

━━━ WHAT NOT TO DO ━━━
- Do NOT generate a flat tattoo. It must wrap the 3D geometry of the body.
- Do NOT paste a design flat if it spans a genuine ridge or curve — that looks fake.
- Do NOT show a white or light patch where the design background was.
- Do NOT change the design's actual content — only its projection onto the surface.
- Do NOT alter the framing, crop, or background from Image 3.

OUTPUT: Same framing and background as Image 3. Photorealistic — indistinguishable from a real photograph of a freshly tattooed person.
`.trim();
}
