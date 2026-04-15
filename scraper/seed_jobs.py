"""
Seed dummy job listings into Railway PostgreSQL.
Run once: python3 scraper/seed_jobs.py
"""

import os
import sys
import hashlib
import asyncio
import httpx
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "")
OLLAMA_HOST  = os.getenv("OLLAMA_HOST", "http://localhost:11434")

if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

if not DATABASE_URL:
    print("ERROR: DATABASE_URL not set in .env")
    sys.exit(1)

engine = create_engine(DATABASE_URL)

DUMMY_JOBS = [
    {
        "id": hashlib.sha256(b"job001").hexdigest()[:32],
        "title": "Senior Software Engineer",
        "company": "Google",
        "location": "Bangalore, India",
        "source": "linkedin",
        "description": """We are looking for a Senior Software Engineer to join our team in Bangalore.

Responsibilities:
- Design and build scalable backend services using Python and Go
- Lead technical design discussions and code reviews
- Collaborate with product managers and designers to ship features
- Mentor junior engineers and contribute to engineering culture

Requirements:
- 4+ years of software engineering experience
- Strong proficiency in Python, Java, or Go
- Experience with distributed systems and microservices
- Familiarity with cloud platforms (GCP, AWS, or Azure)
- Strong problem-solving skills and attention to detail

Nice to have:
- Experience with Kubernetes and Docker
- Open source contributions
- Experience with machine learning pipelines

We offer competitive salary, health benefits, and flexible work arrangements.""",
        "apply_url": "https://careers.google.com/jobs/results/",
    },
    {
        "id": hashlib.sha256(b"job002").hexdigest()[:32],
        "title": "Machine Learning Engineer",
        "company": "Microsoft",
        "location": "Hyderabad, India",
        "source": "linkedin",
        "description": """Microsoft is hiring a Machine Learning Engineer for our AI Platform team.

About the role:
You will work on building and deploying ML models at scale, working closely with research scientists and product teams.

Key Responsibilities:
- Build and maintain ML training and inference pipelines
- Optimize model performance for production deployment
- Implement MLOps best practices including monitoring and retraining
- Collaborate with data scientists to productionize research models

Required Skills:
- 3+ years experience in ML engineering
- Proficiency in Python, TensorFlow or PyTorch
- Experience with MLflow, Kubeflow, or similar MLOps tools
- Strong understanding of statistics and machine learning fundamentals
- Experience with SQL and big data technologies

Benefits:
- Competitive compensation package
- Stock options (RSUs)
- Health and wellness benefits
- Learning and development budget""",
        "apply_url": "https://careers.microsoft.com/",
    },
    {
        "id": hashlib.sha256(b"job003").hexdigest()[:32],
        "title": "Data Analyst",
        "company": "Flipkart",
        "location": "Bangalore, India",
        "source": "naukri",
        "description": """Flipkart is looking for a Data Analyst to join our Growth Analytics team.

Role Overview:
As a Data Analyst, you will turn complex data into actionable insights that drive business decisions across our e-commerce platform.

What you'll do:
- Analyze large datasets to identify trends and business opportunities
- Build dashboards and reports using Tableau and Power BI
- Work with SQL to extract and manipulate data from multiple sources
- Present findings to senior stakeholders in a clear, concise manner
- Collaborate with product and engineering teams on A/B tests

What we're looking for:
- 2+ years of experience in data analysis
- Strong SQL skills (complex queries, window functions)
- Experience with Python for data manipulation (pandas, numpy)
- Familiarity with visualization tools (Tableau, Power BI, or Looker)
- Excellent communication and storytelling skills

Good to have:
- Experience with statistical analysis and hypothesis testing
- Knowledge of e-commerce metrics and KPIs""",
        "apply_url": "https://www.flipkartcareers.com/",
    },
    {
        "id": hashlib.sha256(b"job004").hexdigest()[:32],
        "title": "Frontend Developer",
        "company": "Razorpay",
        "location": "Bangalore, India",
        "source": "naukri",
        "description": """Razorpay is hiring a Frontend Developer to build world-class payment experiences.

About Razorpay:
We are India's leading payment gateway, processing billions of transactions for hundreds of thousands of businesses.

Your responsibilities:
- Build responsive, performant web applications using React and TypeScript
- Implement pixel-perfect UI from design mockups
- Optimize application performance and loading times
- Write unit and integration tests
- Collaborate with backend engineers on API integration

Must have:
- 2+ years of frontend development experience
- Strong proficiency in React.js and TypeScript
- Good understanding of HTML5, CSS3, and modern JavaScript (ES6+)
- Experience with state management (Redux, Zustand, or Context API)
- Knowledge of web performance optimization techniques

Bonus points:
- Experience with Next.js or Remix
- Knowledge of WebSockets and real-time applications
- Contributions to open source projects""",
        "apply_url": "https://razorpay.com/jobs/",
    },
    {
        "id": hashlib.sha256(b"job005").hexdigest()[:32],
        "title": "Product Manager",
        "company": "Swiggy",
        "location": "Bangalore, India",
        "source": "linkedin",
        "description": """Swiggy is looking for a Product Manager to drive our consumer experience.

About the role:
You will own the product roadmap for a key area of our consumer app, working with engineering, design, and data teams to ship impactful features.

Responsibilities:
- Define product vision and strategy for your area
- Write detailed product requirements and user stories
- Prioritize features based on user research and data analysis
- Work closely with engineering and design teams through the product lifecycle
- Define and track key metrics to measure product success
- Conduct user interviews and usability testing

Requirements:
- 3+ years of product management experience
- Strong analytical skills with experience in data-driven decision making
- Excellent written and verbal communication skills
- Experience working in agile development environments
- Ability to influence without authority

Preferred:
- Experience in consumer internet or food-tech
- Technical background (engineering or CS degree)
- MBA from a top institution""",
        "apply_url": "https://careers.swiggy.com/",
    },
    {
        "id": hashlib.sha256(b"job006").hexdigest()[:32],
        "title": "DevOps Engineer",
        "company": "Infosys",
        "location": "Pune, India",
        "source": "naukri",
        "description": """Infosys is hiring a DevOps Engineer to strengthen our cloud infrastructure team.

Job Description:
We are looking for an experienced DevOps Engineer to help us build and maintain our CI/CD pipelines and cloud infrastructure.

Key Responsibilities:
- Design and implement CI/CD pipelines using Jenkins, GitLab CI, or GitHub Actions
- Manage Kubernetes clusters and containerized applications
- Implement infrastructure as code using Terraform or Ansible
- Monitor system performance and respond to incidents
- Collaborate with development teams to improve deployment processes

Technical Requirements:
- 3+ years of DevOps or SRE experience
- Strong knowledge of Linux/Unix systems
- Experience with Docker and Kubernetes
- Proficiency in at least one scripting language (Python, Bash, or Go)
- Experience with cloud platforms (AWS, GCP, or Azure)
- Knowledge of monitoring tools (Prometheus, Grafana, ELK stack)

Certifications preferred:
- AWS Certified DevOps Engineer
- Certified Kubernetes Administrator (CKA)""",
        "apply_url": "https://www.infosys.com/careers/",
    },
    {
        "id": hashlib.sha256(b"job007").hexdigest()[:32],
        "title": "Software Engineer - Backend",
        "company": "Uber",
        "location": "San Francisco, USA",
        "source": "linkedin",
        "description": """Uber is looking for a Backend Software Engineer to join our Marketplace team.

About the team:
The Marketplace team builds the core systems that match riders with drivers in real-time across 70+ countries.

What you'll do:
- Design and build highly scalable backend services handling millions of requests per second
- Work on distributed systems problems including consistency, availability, and partition tolerance
- Optimize database queries and system performance
- Participate in on-call rotations and incident response
- Mentor junior engineers

What we're looking for:
- BS/MS in Computer Science or equivalent
- 3+ years of backend engineering experience
- Strong proficiency in Go, Java, or Python
- Experience with distributed systems and microservices architecture
- Knowledge of SQL and NoSQL databases
- Experience with message queues (Kafka, RabbitMQ)

Compensation:
- Base salary: $150,000 - $200,000
- Stock options
- Comprehensive benefits package""",
        "apply_url": "https://www.uber.com/us/en/careers/",
    },
    {
        "id": hashlib.sha256(b"job008").hexdigest()[:32],
        "title": "Data Scientist",
        "company": "Amazon",
        "location": "Seattle, USA",
        "source": "linkedin",
        "description": """Amazon is hiring a Data Scientist for our Personalization team.

Role Summary:
You will develop machine learning models that power product recommendations for hundreds of millions of Amazon customers worldwide.

Responsibilities:
- Develop and deploy ML models for recommendation systems
- Conduct statistical analysis and A/B testing
- Work with petabyte-scale datasets using Spark and AWS tools
- Collaborate with software engineers to productionize models
- Communicate findings and model performance to stakeholders

Basic Qualifications:
- Master's or PhD in Statistics, Computer Science, or related field
- 2+ years of experience in data science or ML
- Proficiency in Python and R
- Experience with machine learning frameworks (scikit-learn, XGBoost, TensorFlow)
- Strong SQL skills

Preferred Qualifications:
- Experience with recommendation systems or NLP
- Knowledge of AWS services (SageMaker, EMR, Redshift)
- Publications in top ML conferences

Compensation: $130,000 - $180,000 + RSUs + benefits""",
        "apply_url": "https://www.amazon.jobs/",
    },
    {
        "id": hashlib.sha256(b"job009").hexdigest()[:32],
        "title": "Marketing Manager",
        "company": "Zomato",
        "location": "Delhi, India",
        "source": "naukri",
        "description": """Zomato is looking for a Marketing Manager to lead our brand campaigns.

About the role:
You will be responsible for planning and executing integrated marketing campaigns that drive brand awareness and user acquisition for Zomato.

What you'll own:
- Develop and execute 360-degree marketing campaigns across digital and offline channels
- Manage a team of 3-4 marketing executives
- Oversee social media strategy and content calendar
- Analyze campaign performance and optimize for ROI
- Manage agency relationships and vendor partnerships
- Collaborate with product teams on in-app marketing initiatives

What we need:
- 4+ years of marketing experience, preferably in consumer internet
- Strong understanding of digital marketing channels (SEO, SEM, social media, email)
- Experience managing marketing budgets of ₹1 Cr+
- Excellent analytical skills with proficiency in Google Analytics
- Creative thinking with strong attention to detail

Perks:
- Free Zomato Pro subscription
- Flexible work hours
- Health insurance for family""",
        "apply_url": "https://www.zomato.com/careers",
    },
    {
        "id": hashlib.sha256(b"job010").hexdigest()[:32],
        "title": "React Native Developer",
        "company": "PhonePe",
        "location": "Bangalore, India",
        "source": "linkedin",
        "description": """PhonePe is hiring a React Native Developer to build our mobile payment app.

About PhonePe:
PhonePe is India's leading digital payments platform with 400M+ registered users.

Role Description:
You will work on our React Native mobile app that processes millions of transactions daily.

Responsibilities:
- Develop new features for our iOS and Android apps using React Native
- Optimize app performance and reduce load times
- Implement smooth animations and transitions
- Integrate with payment APIs and third-party SDKs
- Write clean, maintainable code with proper test coverage
- Participate in code reviews and technical discussions

Required Skills:
- 2+ years of React Native development experience
- Strong JavaScript/TypeScript skills
- Experience with Redux or Zustand for state management
- Knowledge of native iOS/Android development concepts
- Experience with REST APIs and JSON
- Familiarity with CI/CD pipelines for mobile apps

Nice to have:
- Experience with fintech or payment applications
- Knowledge of security best practices for mobile apps
- Experience with React Navigation""",
        "apply_url": "https://www.phonepe.com/careers/",
    },
]


async def get_embedding(text: str) -> list | None:
    """Try to get embedding from Ollama."""
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            res = await client.post(f"{OLLAMA_HOST}/api/embeddings", json={
                "model": "nomic-embed-text",
                "prompt": text[:1500]
            })
            if res.status_code == 200:
                return res.json()["embedding"]
    except Exception:
        pass
    return None


async def seed():
    print(f"Seeding {len(DUMMY_JOBS)} dummy jobs into database...\n")

    # Create table if it doesn't exist
    print("Ensuring job_listings table exists...")
    with engine.connect() as conn:
        try:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        except Exception:
            pass  # May already exist or need superuser
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS job_listings (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                company TEXT NOT NULL,
                location TEXT,
                source TEXT NOT NULL,
                description TEXT NOT NULL,
                apply_url TEXT NOT NULL,
                embedding vector(768),
                scraped_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        """))
        conn.commit()
    print("Table ready.\n")

    for job in DUMMY_JOBS:
        # Check if already exists
        with engine.connect() as conn:
            exists = conn.execute(
                text("SELECT 1 FROM job_listings WHERE id = :id"), {"id": job["id"]}
            ).fetchone()

        if exists:
            print(f"  ⏭  Already exists: {job['title']} @ {job['company']}")
            continue

        # Try to get embedding
        embed_text = f"{job['title']} {job['description'][:800]}"
        embedding = await get_embedding(embed_text)

        with engine.connect() as conn:
            if embedding:
                emb_str = "[" + ",".join(str(x) for x in embedding) + "]"
                conn.execute(text("""
                    INSERT INTO job_listings
                        (id, title, company, location, source, description, apply_url, embedding, scraped_at, updated_at)
                    VALUES
                        (:id, :title, :company, :location, :source, :description, :apply_url,
                         :emb::vector, NOW(), NOW())
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": job["id"], "title": job["title"], "company": job["company"],
                    "location": job["location"], "source": job["source"],
                    "description": job["description"], "apply_url": job["apply_url"],
                    "emb": emb_str,
                })
            else:
                conn.execute(text("""
                    INSERT INTO job_listings
                        (id, title, company, location, source, description, apply_url, scraped_at, updated_at)
                    VALUES
                        (:id, :title, :company, :location, :source, :description, :apply_url, NOW(), NOW())
                    ON CONFLICT (id) DO NOTHING
                """), {
                    "id": job["id"], "title": job["title"], "company": job["company"],
                    "location": job["location"], "source": job["source"],
                    "description": job["description"], "apply_url": job["apply_url"],
                })
            conn.commit()

        embed_status = "✅ with embedding" if embedding else "✅ no embedding (Ollama unavailable)"
        print(f"  {embed_status}: {job['title']} @ {job['company']}")

    print(f"\n✅ Done! {len(DUMMY_JOBS)} jobs seeded.")
    print("\nVerifying count in DB...")
    with engine.connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM job_listings")).scalar()
    print(f"Total jobs in job_listings table: {count}")


if __name__ == "__main__":
    asyncio.run(seed())
