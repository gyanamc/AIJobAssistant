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
    set(state => {
      const drafts = [draft, ...state.drafts];
      setItem(KEYS.DRAFT_APPLICATIONS, drafts);
      return { drafts };
    });
  },

  updateDraft: async (id: string, updates: Partial<DraftApplication>) => {
    set(state => {
      const drafts = state.drafts.map(d =>
        d.id === id ? { ...d, ...updates, updated_at: new Date().toISOString() } : d
      );
      setItem(KEYS.DRAFT_APPLICATIONS, drafts);
      return { drafts };
    });
  },

  deleteDraft: async (id: string) => {
    set(state => {
      const drafts = state.drafts.filter(d => d.id !== id);
      setItem(KEYS.DRAFT_APPLICATIONS, drafts);
      return { drafts };
    });
  },
}));
