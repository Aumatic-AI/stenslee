import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { StateStorage } from "zustand/middleware";
import { createSupabaseBrowserClient } from "@/lib/supabase-client";
import { usePermissionStore } from "@/store/permission-store";

// Throttled localStorage — batches rapid writes (e.g. during streaming generation)
// into one write per 400ms instead of one per state update. Reads are always instant.
function makeThrottledStorage(delay = 400): StateStorage {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const base = typeof window !== "undefined" ? localStorage : null;
  return {
    getItem: (key) => base?.getItem(key) ?? null,
    removeItem: (key) => base?.removeItem(key),
    setItem: (key, value) => {
      if (!base) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { base.setItem(key, value); timer = null; }, delay);
    },
  };
}

// SSR browser client — picks up staff session from cookies so RLS works correctly
const supabase = createSupabaseBrowserClient();

export interface DesignVariant {
  id: string;
  gradient: string;
  patternType: "mandala" | "geometric" | "tribal" | "floral" | "dark" | "minimal" | "japanese" | "biomech";
  styleName: string;
  imageUrl?: string; // real generated image from KEI API
}

interface AppState {
  // Staff context
  designerId: string | null;  // staff.id of the logged-in designer

  // Customer info
  sessionId: string;
  customerId: string | null;  // users.id from Supabase
  customerName: string;
  customerPhone: string;

  // Design step
  tattooStyle: string;
  tattooDescription: string;
  targetBodyArea: string;             // optional body-part hint for design generation
  referenceImages: string[];
  selectedColors: string[];           // hex codes from TATTOO_COLORS — empty = black & grey
  generatedDesigns: DesignVariant[];
  selectedDesigns: DesignVariant[];   // multi-select for refinement
  selectedDesign: DesignVariant | null; // final approved single design
  refinementText: string;
  isGenerating: boolean;
  iterationCount: number;
  
  // Text Tattoo Modal state (persisted across reloads if active)
  textTattooFont: string | null;
  isTextTattoo: boolean;

  // Rework (cover-up/extend) — a session is either "ai_design" or "rework"
  flowType: "ai_design" | "rework";
  reworkMode: "cover" | "extend";
  reworkPhoto: string | null; // the existing-tattoo photo to cover/extend (blob: until generation uploads it)
  // Set right before navigating Design -> Chat; the chat screen consumes it
  // to know it should kick off the first generation itself, then clears it.
  pendingGeneration: boolean;

  // Placement step
  placementText: string;
  bodyPhoto: string | null;
  finalComposite: string | null;
  isGeneratingPlacement: boolean;

  // The session row's actual status (from the DB, via hydrateFromSession) —
  // lets a reloaded page tell "already finalized" from "still in progress"
  // without relying on any local-only flag that resets on reload.
  sessionStatus: "active" | "completed" | "abandoned";

  // Hydration status — set true after first hydrate attempt for current session
  hydratedSessionId: string | null;
  // Whether this session already has chat history (generation happened) —
  // there's no more per-design table to check, so this is read from
  // chat_messages directly. Used to skip straight to Chat instead of
  // re-showing the Design form for a session already in progress.
  hasChatHistory: boolean;

  // Actions
  setDesignerId: (id: string | null) => void;
  startSession: (name: string, phone: string) => Promise<{ sessionId: string; userId: string | null; isNew: boolean }>;
  startSessionForUser: (userId: string, name: string, phone: string) => Promise<string>;
  setTattooStyle: (style: string) => void;
  setTattooDescription: (text: string) => void;
  setTargetBodyArea: (text: string) => void;
  setFlowType: (type: "ai_design" | "rework") => void;
  setReworkMode: (mode: "cover" | "extend") => void;
  setReworkPhoto: (url: string | null) => void;
  setPendingGeneration: (pending: boolean) => void;
  setIsTextTattoo: (value: boolean) => void;
  addReferenceImage: (url: string) => void;
  removeReferenceImage: (index: number) => void;
  replaceReferenceImage: (oldUrl: string, newUrl: string) => void;
  toggleColor: (hex: string) => void;
  clearColors: () => void;
  generateDesigns: () => void;
  addGeneratedDesign: (design: DesignVariant) => void;
  finishGenerating: (designs?: DesignVariant[]) => void;
  toggleDesignSelection: (design: DesignVariant) => void;
  clearDesignSelection: () => void;
  selectDesign: (design: DesignVariant) => void;
  setRefinementText: (text: string) => void;
  setTextTattooDetails: (font: string | null) => void;
  setPlacementText: (text: string) => void;
  setBodyPhoto: (url: string | null) => void;
  generatePlacement: () => void;
  finishPlacement: (composite: string) => void;
  // Supabase persistence
  syncSessionDetails: () => Promise<void>;
  persistSelectedDesign: (design: DesignVariant) => Promise<void>;
  persistPlacement: (data: { placementText?: string; bodyPhotoUrl?: string; compositeUrl?: string }) => Promise<void>;
  finalizeSession: () => Promise<void>;
  // Restore state from Supabase for the given session (used after reload)
  hydrateFromSession: (sessionId: string) => Promise<void>;
  reset: () => void;
}

function generateId(): string {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

const defaultState = {
  designerId: null as string | null,
  sessionId: "",
  customerId: null as string | null,
  customerName: "",
  customerPhone: "",
  tattooStyle: "",
  tattooDescription: "",
  targetBodyArea: "",
  textTattooFont: null,
  isTextTattoo: false,
  flowType: "ai_design" as "ai_design" | "rework",
  reworkMode: "cover" as "cover" | "extend",
  reworkPhoto: null as string | null,
  pendingGeneration: false,
  referenceImages: [],
  selectedColors: [] as string[],
  generatedDesigns: [],
  selectedDesigns: [],
  selectedDesign: null,
  refinementText: "",
  isGenerating: false,
  iterationCount: 0,
  placementText: "",
  bodyPhoto: null,
  finalComposite: null,
  isGeneratingPlacement: false,
  sessionStatus: "active" as "active" | "completed" | "abandoned",
  hydratedSessionId: null as string | null,
  hasChatHistory: false,
};

// Resets all design/placement state when starting a fresh session.
// Applied in startSession + startSessionForUser to prevent old session data
// from bleeding into a new session via localStorage persistence.
const freshSessionDesignState = {
  tattooStyle: "",
  tattooDescription: "",
  targetBodyArea: "",
  textTattooFont: null,
  isTextTattoo: false,
  flowType: "ai_design" as "ai_design" | "rework",
  reworkMode: "cover" as "cover" | "extend",
  reworkPhoto: null as string | null,
  pendingGeneration: false,
  referenceImages: [] as string[],
  selectedColors: [] as string[],
  generatedDesigns: [],
  selectedDesigns: [],
  selectedDesign: null,
  refinementText: "",
  isGenerating: false,
  iterationCount: 0,
  placementText: "",
  bodyPhoto: null,
  finalComposite: null,
  isGeneratingPlacement: false,
  sessionStatus: "active" as "active" | "completed" | "abandoned",
  hasChatHistory: false,
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      ...defaultState,

  setDesignerId: (id) => set({ designerId: id }),

  startSession: async (name, phone) => {
    // Check if customer already exists
    const { data: existing } = await supabase
      .from("customers")
      .select("id, name")
      .eq("phone", phone)
      .maybeSingle();

    if (existing) {
      // Existing customer — do not create a session, let the caller redirect to dashboard
      set({ customerId: existing.id, customerName: existing.name, customerPhone: phone });
      return { sessionId: "", userId: existing.id, isNew: false };
    }

    // customers/sessions.organization_id is NOT NULL with no default or
    // populating trigger -- it must be supplied explicitly on every insert,
    // or the insert fails outright. usePermissionStore is bootstrapped in
    // the root layout, so this is populated by the time a staff member can
    // reach this action.
    const organizationId = usePermissionStore.getState().staff?.organizationId;
    if (!organizationId) {
      throw new Error("Could not determine your organization — try reloading the page.");
    }

    // New customer — insert and start a session
    const id = generateId();
    const { data: customer, error: customerError } = await supabase
      .from("customers")
      .insert({ name, phone, organization_id: organizationId })
      .select("id")
      .single();
    if (customerError) throw new Error(`Couldn't create the customer: ${customerError.message}`);

    const { designerId } = get();
    const { error: sessionError } = await supabase.from("sessions").insert({
      id, customer_id: customer?.id ?? null, status: "active",
      staff_id: designerId ?? null, organization_id: organizationId,
    });
    if (sessionError) throw new Error(`Couldn't start the session: ${sessionError.message}`);
    set({
      ...freshSessionDesignState,
      sessionId: id, customerId: customer?.id ?? null,
      customerName: name, customerPhone: phone, hydratedSessionId: id,
    });
    return { sessionId: id, userId: customer?.id ?? null, isNew: true };
  },

  startSessionForUser: async (userId, name, phone) => {
    const organizationId = usePermissionStore.getState().staff?.organizationId;
    if (!organizationId) {
      throw new Error("Could not determine your organization — try reloading the page.");
    }

    const id = generateId();
    const { designerId } = get();
    const { error: sessionError } = await supabase.from("sessions").insert({
      id, customer_id: userId, status: "active",
      staff_id: designerId ?? null, organization_id: organizationId,
    });
    if (sessionError) throw new Error(`Couldn't start the session: ${sessionError.message}`);
    set({
      ...freshSessionDesignState,
      sessionId: id, customerId: userId,
      customerName: name, customerPhone: phone, hydratedSessionId: id,
    });
    return id;
  },

  setTattooDescription: (text) => set({ tattooDescription: text }),

  setTargetBodyArea: (text) => set({ targetBodyArea: text }),

  addReferenceImage: (url) =>
    set((s) => ({
      referenceImages: s.referenceImages.length < 5 ? [...s.referenceImages, url] : s.referenceImages,
    })),

  removeReferenceImage: (index) =>
    set((s) => ({ referenceImages: s.referenceImages.filter((_, i) => i !== index) })),

  replaceReferenceImage: (oldUrl, newUrl) =>
    set((s) => ({ referenceImages: s.referenceImages.map((u) => (u === oldUrl ? newUrl : u)) })),

  toggleColor: (hex) =>
    set((s) => {
      const HEX = hex.toUpperCase();
      const current = s.selectedColors.map((c) => c.toUpperCase());
      return current.includes(HEX)
        ? { selectedColors: s.selectedColors.filter((c) => c.toUpperCase() !== HEX) }
        : { selectedColors: [...s.selectedColors, HEX] };
    }),

  clearColors: () => set({ selectedColors: [] }),

  setTattooStyle: (style) => set({ tattooStyle: style }),

  setFlowType: (type) => set({ flowType: type }),

  setReworkMode: (mode) => set({ reworkMode: mode }),

  setReworkPhoto: (url) => set({ reworkPhoto: url }),

  setPendingGeneration: (pending) => set({ pendingGeneration: pending }),

  setIsTextTattoo: (value) => set({ isTextTattoo: value }),

  generateDesigns: () =>
    set((s) => ({
      isGenerating: true,
      iterationCount: s.iterationCount + 1,
      generatedDesigns: [],
      selectedDesigns: [],
    })),

  addGeneratedDesign: (design) =>
    set((s) => ({ generatedDesigns: [...s.generatedDesigns, design] })),

  finishGenerating: (designs?) =>
    set((s) => ({
      isGenerating: false,
      generatedDesigns: designs && designs.length > 0 ? designs : s.generatedDesigns,
      selectedDesigns: [],
      refinementText: "",
    })),

  toggleDesignSelection: (design) =>
    set((s) => {
      const alreadySelected = s.selectedDesigns.some((d) => d.id === design.id);
      if (alreadySelected) {
        return { selectedDesigns: s.selectedDesigns.filter((d) => d.id !== design.id) };
      }
      if (s.selectedDesigns.length >= 4) return {};
      return { selectedDesigns: [...s.selectedDesigns, design] };
    }),

  clearDesignSelection: () => set({ selectedDesigns: [] }),

  selectDesign: (design) => set({ selectedDesign: design }),

  setRefinementText: (text) => set({ refinementText: text }),

  setTextTattooDetails: (font) => set({ textTattooFont: font }),

  setPlacementText: (text) => set({ placementText: text }),

  setBodyPhoto: (url) => set({ bodyPhoto: url }),

  generatePlacement: () => set({ isGeneratingPlacement: true }),

  finishPlacement: (composite) =>
    set({ isGeneratingPlacement: false, finalComposite: composite }),

  // Keep the session row in sync with the latest style/description/body-area
  // hint. Rework sessions don't use body_area (the source photo already
  // shows the placement), so leave it untouched for that flow.
  syncSessionDetails: async () => {
    const { sessionId, tattooStyle, tattooDescription, targetBodyArea, flowType } = get();
    if (!sessionId) return;
    await supabase
      .from("sessions")
      .update({
        style: tattooStyle,
        description: tattooDescription,
        ...(flowType === "ai_design" ? { body_area: targetBodyArea || null } : {}),
      })
      .eq("id", sessionId);
  },

  // Writes the chosen design onto the session the moment it's picked, per
  // the v4 schema: a session only ever has one selected design, tracked as
  // columns on `sessions` directly rather than a separate table of rows.
  persistSelectedDesign: async (design) => {
    const { sessionId } = get();
    if (!sessionId || !design.imageUrl) return;
    await supabase
      .from("sessions")
      .update({ selected_design_key: design.imageUrl, selected_design_style: design.styleName })
      .eq("id", sessionId);
  },

  persistPlacement: async ({ placementText, bodyPhotoUrl, compositeUrl }) => {
    const { sessionId } = get();
    if (!sessionId) return;
    await supabase
      .from("sessions")
      .update({
        placement_text: placementText ?? null,
        placement_body_photo_key: bodyPhotoUrl ?? null,
        placement_composite_key: compositeUrl ?? null,
      })
      .eq("id", sessionId);
  },

  // The design/placement are already written onto `sessions` the moment
  // they're chosen (persistSelectedDesign / persistPlacement) — this just
  // marks the session done.
  finalizeSession: async () => {
    const { sessionId } = get();
    if (!sessionId) return;

    const { error: rpcError } = await supabase.rpc("finalize_session", { p_session_id: sessionId });
    if (!rpcError) { set({ sessionStatus: "completed" }); return; }

    console.warn("finalize_session RPC failed — falling back to a plain update:", rpcError);
    const { error: sessionError } = await supabase
      .from("sessions")
      .update({ status: "completed", completed_at: new Date().toISOString() })
      .eq("id", sessionId);
    if (sessionError) throw new Error(`Finalize fallback: session update failed — ${sessionError.message}`);
    set({ sessionStatus: "completed" });
  },

  hydrateFromSession: async (sessionId) => {
    if (!sessionId) return;
    const { hydratedSessionId, sessionId: currentSessionId, generatedDesigns } = get();

    // Already hydrated this session and we still have its designs in memory — skip.
    if (hydratedSessionId === sessionId && currentSessionId === sessionId && generatedDesigns.length > 0) {
      return;
    }

    // Pull session + customer in one round-trip. Every generated candidate
    // already lives in chat_messages.image_keys[] (loaded separately by the
    // chat screen) — this only needs to restore the one design/placement
    // the session has actually settled on, per the v4 schema's 1-to-1 model.
    const { data: session, error } = await supabase
      .from("sessions")
      .select(`
        id,
        customer_id,
        style,
        description,
        body_area,
        flow_type,
        rework_mode,
        status,
        selected_design_key,
        selected_design_style,
        placement_text,
        placement_composite_key,
        customers ( name, phone )
      `)
      .eq("id", sessionId)
      .maybeSingle();

    if (error || !session) {
      console.warn("hydrateFromSession: no session found", { sessionId, error });
      set({ hydratedSessionId: sessionId });
      return;
    }

    const { count: chatMessageCount } = await supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", sessionId);

    const customer = Array.isArray(session.customers) ? session.customers[0] : session.customers;
    const selectedDesign: DesignVariant | null = session.selected_design_key
      ? {
          id: `db-${sessionId}`,
          gradient: defaultGradients[0],
          patternType: "mandala",
          styleName: session.selected_design_style ?? "Design",
          imageUrl: session.selected_design_key,
        }
      : null;

    set({
      sessionId,
      customerId: session.customer_id ?? null,
      customerName: customer?.name ?? get().customerName,
      customerPhone: customer?.phone ?? get().customerPhone,
      tattooStyle: session.style ?? "",
      tattooDescription: session.description ?? "",
      targetBodyArea: session.body_area ?? "",
      flowType: (session.flow_type as "ai_design" | "rework" | null) ?? "ai_design",
      reworkMode: (session.rework_mode as "cover" | "extend" | null) ?? "cover",
      selectedDesign: selectedDesign ?? get().selectedDesign,
      placementText: session.placement_text ?? "",
      finalComposite: session.placement_composite_key ?? null,
      sessionStatus: (session.status as "active" | "completed" | "abandoned") ?? "active",
      hydratedSessionId: sessionId,
      hasChatHistory: (chatMessageCount ?? 0) > 0,
    });
  },

      reset: () => set(defaultState),
    }),
    {
      name: "cleopatra-app-store",
      storage: createJSONStorage(() => makeThrottledStorage(400)),
      // Persist only what's safe to restore. Blob URLs (referenceImages, bodyPhoto)
      // become invalid after reload; transient flags shouldn't survive.
      partialize: (state) => ({
        designerId: state.designerId,
        sessionId: state.sessionId,
        customerId: state.customerId,
        customerName: state.customerName,
        customerPhone: state.customerPhone,
        tattooStyle: state.tattooStyle,
        tattooDescription: state.tattooDescription,
        targetBodyArea: state.targetBodyArea,
        flowType: state.flowType,
        reworkMode: state.reworkMode,
        selectedColors: state.selectedColors,
        generatedDesigns: state.generatedDesigns,
        selectedDesigns: state.selectedDesigns,
        selectedDesign: state.selectedDesign,
        refinementText: state.refinementText,
        iterationCount: state.iterationCount,
        placementText: state.placementText,
        finalComposite: state.finalComposite,
        sessionStatus: state.sessionStatus,
        hydratedSessionId: state.hydratedSessionId,
        hasChatHistory: state.hasChatHistory,
      }),
      version: 1,
    }
  )
);

const defaultGradients = [
  "radial-gradient(ellipse at 50% 40%, #4a0080 0%, #1a0030 40%, #0d0010 100%)",
  "radial-gradient(ellipse at 40% 35%, #8b0000 0%, #3a0000 40%, #0a0000 100%)",
  "radial-gradient(ellipse at 45% 45%, #1a2a4a 0%, #0a1a2a 50%, #000a0d 100%)",
  "radial-gradient(ellipse at 45% 45%, #c9a84c 0%, #6b4800 50%, #1a1000 100%)",
  "radial-gradient(ellipse at 55% 40%, #1a3a1a 0%, #0a1a08 50%, #000500 100%)",
];

