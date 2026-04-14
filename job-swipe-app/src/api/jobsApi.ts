import type { JobCard } from '../types';

export const API_BASE = 'https://aijobassistant-production.up.railway.app';

const FRIENDLY: Record<number, string> = {
  400: 'Invalid request. Please try again.',
  401: 'Please sign in to continue.',
  403: "You don't have permission for this action.",
  404: 'The requested resource was not found.',
  413: 'File is too large. Maximum size is 5 MB.',
  500: 'Something went wrong on our end. Please try again.',
  503: 'Service temporarily unavailable. Please try again shortly.',
  504: 'Request timed out. Please check your connection.',
};

export async function apiFetch<T>(url: string, options?: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      throw new Error(FRIENDLY[res.status] ?? 'An unexpected error occurred.');
    }
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof TypeError && err.message === 'Network request failed') {
      throw new Error('No internet connection. Please check your network.');
    }
    throw err;
  }
}

export interface FeedResponse {
  jobs: JobCard[];
  total: number;
}

export async function fetchJobFeed(
  resumeSummary: string,
  excludeIds?: string,
  limit = 20,
): Promise<FeedResponse> {
  const params = new URLSearchParams({ resume_summary: resumeSummary, limit: String(limit) });
  if (excludeIds) params.set('exclude_ids', excludeIds);
  return apiFetch<FeedResponse>(`${API_BASE}/api/v1/jobs/feed?${params}`);
}

export interface CoverLetterRequest {
  job_id: string;
  job_title: string;
  company: string;
  job_description: string;
  resume_summary: string;
}

export async function generateCoverLetter(req: CoverLetterRequest): Promise<string> {
  const data = await apiFetch<{ cover_letter: string }>(`${API_BASE}/api/v1/jobs/cover-letter`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
  return data.cover_letter;
}
