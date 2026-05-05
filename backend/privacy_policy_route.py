"""Privacy policy route — imported and registered in main.py"""
from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter()

PRIVACY_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — AntiGravity Jobs</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0a; --surface: #111111; --border: #1e1e1e;
      --text: #e8e8e8; --muted: #888; --accent: #c8f135;
      --font: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }
    body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 16px; line-height: 1.7; -webkit-font-smoothing: antialiased; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; display: flex; align-items: center; justify-content: space-between; }
    .logo { font-size: 1rem; font-weight: 700; letter-spacing: -0.02em; color: var(--text); text-decoration: none; }
    .logo span { color: var(--accent); }
    nav a { color: var(--muted); text-decoration: none; font-size: 0.875rem; }
    nav a:hover { color: var(--text); }
    .hero { max-width: 760px; margin: 5rem auto 3rem; padding: 0 2rem; }
    .label { font-size: 0.75rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: var(--accent); margin-bottom: 1rem; }
    h1 { font-size: clamp(2rem, 5vw, 3rem); font-weight: 800; letter-spacing: -0.03em; line-height: 1.1; margin-bottom: 1rem; }
    .meta { color: var(--muted); font-size: 0.875rem; }
    .content { max-width: 760px; margin: 0 auto 6rem; padding: 0 2rem; }
    .divider { border: none; border-top: 1px solid var(--border); margin: 2.5rem 0; }
    h2 { font-size: 1.125rem; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 0.75rem; color: var(--text); }
    p { color: #b0b0b0; margin-bottom: 1rem; }
    ul { color: #b0b0b0; padding-left: 1.25rem; margin-bottom: 1rem; }
    ul li { margin-bottom: 0.4rem; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    .contact-card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 1.5rem; margin-top: 2rem; }
    .contact-card p { margin: 0; }
    footer { border-top: 1px solid var(--border); padding: 2rem; text-align: center; color: var(--muted); font-size: 0.8125rem; }
    footer a { color: var(--muted); }
    footer a:hover { color: var(--text); }
  </style>
</head>
<body>
  <header>
    <a href="https://antigravityjobs.com" class="logo">Anti<span>Gravity</span></a>
    <nav><a href="https://antigravityjobs.com">&larr; Back to home</a></nav>
  </header>
  <div class="hero">
    <div class="label">Legal</div>
    <h1>Privacy Policy</h1>
    <p class="meta">Last updated: May 5, 2026 &nbsp;&middot;&nbsp; Effective: May 5, 2026</p>
  </div>
  <div class="content">
    <p>AntiGravity ("we", "our", or "us") operates the AntiGravity mobile application and the antigravityjobs.com website (collectively, the "Service"). This Privacy Policy explains how we collect, use, disclose, and safeguard your information when you use our Service.</p>
    <hr class="divider" />
    <h2>1. Information We Collect</h2>
    <p>We collect information you provide directly to us, including:</p>
    <ul>
      <li><strong>Account information</strong> &mdash; name, email address, and profile data when you sign in via Google OAuth</li>
      <li><strong>Resume and profile data</strong> &mdash; work experience, skills, education, and preferences you upload or enter</li>
      <li><strong>Job interaction data</strong> &mdash; jobs you save, swipe on, or apply to</li>
      <li><strong>Cover letters and application drafts</strong> &mdash; content generated or edited within the app</li>
    </ul>
    <p>We also collect certain information automatically: device identifiers, operating system information, app usage data, and network connectivity information.</p>
    <hr class="divider" />
    <h2>2. How We Use Your Information</h2>
    <ul>
      <li>Provide, operate, and improve the Service</li>
      <li>Match your profile against job listings using AI scoring</li>
      <li>Generate personalised cover letter drafts</li>
      <li>Authenticate your identity and maintain your account</li>
      <li>Send you service-related communications</li>
      <li>Analyse usage patterns to improve app performance</li>
      <li>Comply with legal obligations</li>
    </ul>
    <hr class="divider" />
    <h2>3. Sharing of Information</h2>
    <p>We do not sell your personal information. We may share your information in the following limited circumstances:</p>
    <ul>
      <li><strong>With recruiters (opt-in only)</strong> &mdash; if you explicitly enable profile sharing, an anonymised version of your profile may be visible to recruiters. Your contact details remain masked by default and are only revealed upon your consent.</li>
      <li><strong>Service providers</strong> &mdash; we use Supabase (authentication and database), Railway (backend hosting), and Groq (AI inference). These providers process data on our behalf under appropriate data protection agreements.</li>
      <li><strong>Legal requirements</strong> &mdash; we may disclose information if required by law or to protect the rights and safety of our users.</li>
    </ul>
    <hr class="divider" />
    <h2>4. Data Retention</h2>
    <p>We retain your personal data for as long as your account is active or as needed to provide the Service. You may request deletion of your account and associated data at any time by contacting us. We will process deletion requests within 30 days.</p>
    <hr class="divider" />
    <h2>5. Security</h2>
    <p>We implement industry-standard security measures including encrypted data transmission (HTTPS/TLS), secure authentication via Supabase JWT tokens, and access controls on our backend infrastructure. However, no method of transmission over the internet is 100% secure.</p>
    <hr class="divider" />
    <h2>6. Children's Privacy</h2>
    <p>The Service is intended for users who are 18 years of age or older. We do not knowingly collect personal information from children under 13. If we become aware that we have collected personal information from a child under 13, we will take steps to delete that information promptly.</p>
    <hr class="divider" />
    <h2>7. Your Rights</h2>
    <p>Depending on your location, you may have the following rights regarding your personal data:</p>
    <ul>
      <li>Access &mdash; request a copy of the data we hold about you</li>
      <li>Correction &mdash; request correction of inaccurate data</li>
      <li>Deletion &mdash; request deletion of your data</li>
      <li>Portability &mdash; request your data in a machine-readable format</li>
      <li>Objection &mdash; object to certain types of processing</li>
    </ul>
    <p>To exercise any of these rights, contact us at <a href="mailto:privacy@antigravityjobs.com">privacy@antigravityjobs.com</a>.</p>
    <hr class="divider" />
    <h2>8. Third-Party Services</h2>
    <p>Our Service integrates with the following third-party services, each governed by their own privacy policies:</p>
    <ul>
      <li><a href="https://supabase.com/privacy" target="_blank" rel="noopener">Supabase</a> &mdash; authentication and database</li>
      <li><a href="https://groq.com/privacy-policy/" target="_blank" rel="noopener">Groq</a> &mdash; AI inference</li>
      <li>LinkedIn and Naukri &mdash; job listing data accessed via browser extension, subject to their respective terms</li>
    </ul>
    <hr class="divider" />
    <h2>9. Changes to This Policy</h2>
    <p>We may update this Privacy Policy from time to time. We will notify you of significant changes by updating the "Last updated" date at the top of this page. Continued use of the Service after changes constitutes acceptance of the updated policy.</p>
    <hr class="divider" />
    <h2>10. Contact Us</h2>
    <p>If you have questions or concerns about this Privacy Policy, please contact us:</p>
    <div class="contact-card">
      <p><strong>AntiGravity</strong><br />
      Email: <a href="mailto:privacy@antigravityjobs.com">privacy@antigravityjobs.com</a><br />
      Website: <a href="https://antigravityjobs.com">antigravityjobs.com</a></p>
    </div>
  </div>
  <footer>
    <p>&copy; 2026 AntiGravity &middot; <a href="https://antigravityjobs.com">Home</a> &middot; <a href="mailto:privacy@antigravityjobs.com">Contact</a></p>
  </footer>
</body>
</html>"""


@router.get("/privacy-policy", response_class=HTMLResponse)
async def privacy_policy():
    return PRIVACY_HTML
