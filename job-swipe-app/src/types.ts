export interface JobCard {
  id: string;
  title: string;
  company: string;
  location: string;
  source: 'linkedin' | 'naukri';
  description: string;
  excerpt: string;
  match_score: number | null;
  apply_url: string;
  industry?: string;
  company_size?: string;
  job_level?: string;
  job_type?: string;
}

export interface SwipeRecord {
  job_id: string;
  direction: 'right' | 'left';
  timestamp: string;
  status?: 'interested' | 'skipped' | 'applied' | 'auto-applied';
}

export interface CachedJobBatch {
  fetched_at: string;
  jobs: JobCard[];
}

export interface DraftApplication {
  id: string;
  job_id: string;
  job_title: string;
  company: string;
  apply_url: string;
  cover_letter: string;
  status: 'draft' | 'auto-applied';
  created_at: string;
  updated_at: string;
}

export interface AuthSession {
  access_token: string;
  refresh_token: string;
  user_id: string;
  email: string;
  avatar_url?: string;
  expires_at: number;
}

export interface ResumeSummary {
  name: string;
  email: string;
  phone: string;
  skills: string[];
  experience_summary: string;
  target_roles: string[];
  raw_text?: string;
  synced_at: string;
}

export interface UserPreferences {
  target_roles: string[];
  preferred_locations: string[];
  auto_apply_threshold: number;
  onboarding_complete: boolean;
}
