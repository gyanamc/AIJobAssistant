import { API_BASE, apiFetch } from './jobsApi';
import type { ResumeSummary } from '../types';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const VALID_TYPES = ['application/pdf', 'text/plain'];

export interface FileValidationResult {
  valid: boolean;
  error?: string;
}

export function validateResumeFile(file: { type: string; size: number }): FileValidationResult {
  if (!VALID_TYPES.includes(file.type)) {
    return { valid: false, error: 'Unsupported file type. Use PDF or .txt.' };
  }
  if (file.size > MAX_SIZE) {
    return { valid: false, error: 'File is too large. Maximum size is 5 MB.' };
  }
  return { valid: true };
}

export async function parseResume(file: {
  uri: string;
  name: string;
  type: string;
  size: number;
}): Promise<ResumeSummary> {
  const validation = validateResumeFile(file);
  if (!validation.valid) throw new Error(validation.error);

  const form = new FormData();
  form.append('file', { uri: file.uri, name: file.name, type: file.type } as any);

  return apiFetch<ResumeSummary>(`${API_BASE}/api/v1/resume/parse`, {
    method: 'POST',
    body: form,
  });
}
