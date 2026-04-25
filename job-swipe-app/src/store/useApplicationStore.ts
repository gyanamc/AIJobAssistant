import { create } from 'zustand';
import { getItem, setItem, KEYS } from '../utils/storage';
import type { DraftApplication } from '../types';

interface ApplicationStore {
  drafts: DraftApplication[];
  saveDraft: (draft: DraftApplication) => Promise<void>;
  updateDraft: (id: string, updates: Partial<DraftApplication>) => Promise<void>;
  deleteDraft: (id: string) => Promise<void>;
  loadDrafts: () => Promise<void>;
}

export const useApplicationStore = create<ApplicationStore>((set, get) => ({
  drafts: [],

  loadDrafts: async () => {
    const stored = await getItem<DraftApplication[]>(KEYS.DRAFT_APPLICATIONS);
    set({ drafts: stored ?? [] });
  },

  saveDraft: async (draft: DraftApplication) => {
    const drafts = [draft, ...get().drafts];
    set({ drafts });
    await setItem(KEYS.DRAFT_APPLICATIONS, drafts);
  },

  updateDraft: async (id: string, updates: Partial<DraftApplication>) => {
    const drafts = get().drafts.map(d =>
      d.id === id ? { ...d, ...updates, updated_at: new Date().toISOString() } : d
    );
    set({ drafts });
    await setItem(KEYS.DRAFT_APPLICATIONS, drafts);
  },

  deleteDraft: async (id: string) => {
    const drafts = get().drafts.filter(d => d.id !== id);
    set({ drafts });
    await setItem(KEYS.DRAFT_APPLICATIONS, drafts);
  },
}));
