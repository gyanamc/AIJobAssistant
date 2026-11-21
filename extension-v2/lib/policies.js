(function (root) {
  'use strict';

  const CONSENT_VERSION = 1;

  function hasExplicitSharingConsent(data) {
    return data?.shareAnonymized === true && data?.shareConsentVersion === CONSENT_VERSION;
  }

  function consentStorageUpdate(enabled) {
    return {
      shareAnonymized: enabled === true,
      shareConsentVersion: CONSENT_VERSION
    };
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ''));
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch (_) {
      return null;
    }
  }

  const REVIEW_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

  function shouldShowReviewPrompt(state = {}, now = Date.now()) {
    if (!state || state.hasReviewed === true || state.reviewOptOut === true) {
      return false;
    }
    if (state.lastPromptedAt && (now - state.lastPromptedAt < REVIEW_COOLDOWN_MS)) {
      return false;
    }

    const trackerMilestones = Number(state.trackerMilestonesCount || 0);
    const positiveScans     = Number(state.positiveScansCount || 0);
    const coverLetters      = Number(state.coverLettersCount || 0);

    // Trigger criteria: proven value experience
    // 1. Reached interview/offer milestone in application tracker
    // 2. Evaluated at least 5 strong matching jobs (>= 70%)
    // 3. Generated at least 2 cover letters or tailored resumes
    return trackerMilestones >= 1 || positiveScans >= 5 || coverLetters >= 2;
  }

  function getWebStoreReviewUrl(extensionId) {
    if (!extensionId) return 'https://chromewebstore.google.com/';
    return `https://chromewebstore.google.com/detail/${encodeURIComponent(extensionId)}/reviews`;
  }

  const COMMON_SKILLS_TAXONOMY = [
    'Python', 'JavaScript', 'TypeScript', 'Java', 'C++', 'C#', 'Go', 'Rust', 'Ruby', 'PHP', 'Swift', 'Kotlin', 'SQL',
    'React', 'Node.js', 'Next.js', 'Vue.js', 'Angular', 'HTML5', 'CSS3', 'Tailwind CSS', 'Redux', 'GraphQL', 'REST API',
    'FastAPI', 'Django', 'Flask', 'Express.js', 'Spring Boot', '.NET', 'Microservices',
    'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Elasticsearch', 'DynamoDB', 'SQLite',
    'Machine Learning', 'Deep Learning', 'PyTorch', 'TensorFlow', 'Scikit-Learn', 'Pandas', 'NumPy',
    'NLP', 'LLM', 'RAG', 'LangChain', 'LangGraph', 'OpenAI API', 'Hugging Face', 'Data Engineering', 'Spark',
    'AWS', 'Azure', 'GCP', 'Docker', 'Kubernetes', 'CI/CD', 'GitHub Actions', 'Terraform', 'Linux', 'Git',
    'Agile', 'Scrum', 'TDD', 'Unit Testing', 'System Design'
  ];

  const SKILL_CLUSTERS = {
    python_backend: {
      triggers: ['python', 'django', 'fastapi', 'flask'],
      suggestions: ['Docker', 'PostgreSQL', 'Redis', 'Celery', 'REST API', 'AWS', 'PyTest', 'Git']
    },
    frontend_web: {
      triggers: ['javascript', 'typescript', 'react', 'vue', 'angular', 'next.js', 'html', 'css'],
      suggestions: ['TypeScript', 'Tailwind CSS', 'Redux', 'GraphQL', 'Next.js', 'REST API', 'Jest', 'Git']
    },
    ai_ml: {
      triggers: ['machine learning', 'deep learning', 'pytorch', 'tensorflow', 'nlp', 'llm', 'rag', 'langchain', 'pandas'],
      suggestions: ['PyTorch', 'Hugging Face', 'RAG', 'LangChain', 'Docker', 'FastAPI', 'Pandas']
    },
    cloud_devops: {
      triggers: ['aws', 'azure', 'gcp', 'docker', 'kubernetes', 'terraform', 'ci/cd'],
      suggestions: ['Docker', 'Kubernetes', 'Terraform', 'GitHub Actions', 'Linux', 'CI/CD']
    },
    java_backend: {
      triggers: ['java', 'spring', 'spring boot', 'hibernate'],
      suggestions: ['Spring Boot', 'Microservices', 'PostgreSQL', 'Docker', 'Kafka', 'REST API', 'AWS']
    }
  };

  function escapeRegExp(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function extractSkillsFromText(text) {
    if (!text || typeof text !== 'string') return [];
    const textLower = ' ' + text.toLowerCase() + ' ';
    const found = [];
    for (const skill of COMMON_SKILLS_TAXONOMY) {
      const skillLower = skill.toLowerCase();
      const regex = new RegExp(`(?:^|[\\s,.:;()\\[\\]{}/<>-])${escapeRegExp(skillLower)}(?:$|[\\s,.:;()\\[\\]{}/<>-])`, 'i');
      if (regex.test(textLower)) {
        found.push(skill);
      }
    }
    return found;
  }

  function getSuggestedSkills(confirmedSkills = [], targetRoles = '') {
    const confirmedSet = new Set((confirmedSkills || []).map(s => String(s).toLowerCase().trim()));
    const contextText = `${(confirmedSkills || []).join(' ')} ${targetRoles || ''}`.toLowerCase();
    const suggestions = new Set();

    for (const cluster of Object.values(SKILL_CLUSTERS)) {
      const match = cluster.triggers.some(trig => contextText.includes(trig));
      if (match) {
        for (const sugg of cluster.suggestions) {
          if (!confirmedSet.has(sugg.toLowerCase()) && !suggestions.has(sugg)) {
            suggestions.add(sugg);
          }
        }
      }
    }

    if (suggestions.size === 0) {
      for (const fallback of ['Git', 'Docker', 'REST API', 'SQL', 'Agile']) {
        if (!confirmedSet.has(fallback.toLowerCase())) {
          suggestions.add(fallback);
        }
      }
    }

    return Array.from(suggestions).slice(0, 8);
  }

  function mergeUserSkills(existing = [], incoming = []) {
    const seen = new Set();
    const merged = [];
    for (const s of [...existing, ...incoming]) {
      const clean = String(s || '').trim();
      if (!clean) continue;
      const lower = clean.toLowerCase();
      if (!seen.has(lower)) {
        seen.add(lower);
        merged.push(clean);
      }
    }
    return merged;
  }

  function removeUserSkill(skills = [], skillToRemove = '') {
    const target = String(skillToRemove || '').toLowerCase().trim();
    return (skills || []).filter(s => String(s || '').toLowerCase().trim() !== target);
  }

  function generateFollowUpEmailTemplate(job = {}) {
    const recruiter = (job.contactName || '').trim() || 'Hiring Team';
    const title = (job.title || '').trim() || 'the open position';
    const company = (job.company || '').trim() || 'your team';
    let appliedDateStr = 'recently';
    if (job.appliedDate) {
      const d = new Date(job.appliedDate);
      if (!Number.isNaN(d.getTime())) {
        appliedDateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      }
    }

    const skillsStr = Array.isArray(job.matchedSkills) && job.matchedSkills.length
      ? `particularly in ${job.matchedSkills.slice(0, 3).join(', ')}`
      : 'in this domain';

    const subject = `Following up on ${title} application - ${company}`;
    const body = `Dear ${recruiter},

I hope this note finds you well.

I am writing to politely follow up on my application for the ${title} position at ${company}, submitted on ${appliedDateStr}.

I remain deeply enthusiastic about the opportunity to contribute ${skillsStr}. Please let me know if there are any additional details, portfolio links, or questions I can provide to support my candidacy.

Thank you very much for your time, consideration, and continued leadership.

Warm regards,`;

    return { subject, body };
  }

  function calculateSearchCardMatchHeuristic(title = '', snippet = '', userSkills = [], targetRoles = '') {
    const titleLower = String(title || '').toLowerCase();
    const snippetLower = String(snippet || '').toLowerCase();
    const combined = `${titleLower} ${snippetLower}`;

    if (!titleLower && !snippetLower) return 50;

    let score = 50;

    // Role match bonus
    const roles = String(targetRoles || '')
      .split(',')
      .map(r => r.trim().toLowerCase())
      .filter(Boolean);

    let roleMatched = false;
    for (const r of roles) {
      const words = r.split(/\s+/).filter(w => w.length > 2);
      if (words.some(w => titleLower.includes(w))) {
        score += 20;
        roleMatched = true;
        break;
      }
    }

    // Skills match bonus
    let matchedSkillsCount = 0;
    for (const skill of userSkills || []) {
      const s = String(skill || '').trim().toLowerCase();
      if (!s) continue;
      if (combined.includes(s)) {
        matchedSkillsCount++;
      }
    }

    score += Math.min(30, matchedSkillsCount * 6);

    // Negative seniority check if candidate is junior/mid and title is VP/Director
    if (/\b(director|vp|vice president|c-level|head of)\b/i.test(titleLower) && !roleMatched) {
      score -= 15;
    }

    return Math.min(98, Math.max(35, Math.round(score)));
  }

  const policies = {
    CONSENT_VERSION,
    REVIEW_COOLDOWN_MS,
    hasExplicitSharingConsent,
    consentStorageUpdate,
    safeExternalUrl,
    shouldShowReviewPrompt,
    getWebStoreReviewUrl,
    extractSkillsFromText,
    getSuggestedSkills,
    mergeUserSkills,
    removeUserSkill,
    generateFollowUpEmailTemplate,
    calculateSearchCardMatchHeuristic
  };

  root.ExtensionPolicies = policies;
  if (typeof module !== 'undefined' && module.exports) module.exports = policies;
})(typeof globalThis !== 'undefined' ? globalThis : this);
