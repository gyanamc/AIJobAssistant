# AI Job Application Agent

This agent automates searching for jobs on LinkedIn, downloading their descriptions, evaluating them using OpenAI based on your custom profile, and saving suitable matches. 

## 1. Setup

1. Copy the `.env.example` file to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Open `.env` and fill in your actual `OPENAI_API_KEY`.
3. Open `data/user_profile.json` and customize the information to match your real resume, skills, and preferences.

## 2. First Run (Login)

On the very first run, Playwright will open a visible Chromium browser window and take you to the LinkedIn login screen.
1. Log in manually using your credentials.
2. Complete any 2FA/Captchas.
3. Once you arrive at the LinkedIn feed page, go back to your terminal and press **Enter**.
4. Your session cookies will be saved in `data/linkedin_cookies.json`, so you won't have to log in manually next time.

## 3. Running the Agent

To run the agent:
```bash
source .venv/bin/activate
python src/agent.py
```

### What it does:
- It uses the roles and locations defined in your profile.
- Searches LinkedIn for jobs with the "Easy Apply" filter active.
- Iterates over results.
- Uses GPT-4o to read the description and determine if it's a match.
- Logs the result to the local SQLite database (`db/jobs.db`) to avoid processing the same job twice.

## Next Steps
This version handles the complex logic of scraping job descriptions and making AI-based decisions. The final step—actually filling the application form fields and clicking "Submit"—requires deep knowledge of the specific questions each job asks. For now, the agent identifies the matches and stores them securely.
