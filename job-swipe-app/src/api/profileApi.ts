import { API_BASE, apiFetch } from './jobsApi';
import type { ResumeSummary, UserPreferences } from '../types';

export async function syncProfile(
  resumeSummary: ResumeSummary,
  prefs: UserPreferences,
): Promise<void> {
  await apiFetch(`${API_BASE}/api/v1/profile/sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      shareAnonymized: true,
      resumeSummary: resumeSummary.experience_summary,
      targetRoles: prefs.target_roles.join(', '),
      targetLocations: prefs.preferred_locations.join(', '),
      skills: resumeSummary.skills.join(', '),
      name: resumeSummary.name,
      email: resumeSummary.email,
      phone: resumeSummary.phone,
    }),
  });
}
