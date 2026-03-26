from fastapi import FastAPI, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import ValidationError

# Import our custom database scripts
from database import get_db, engine
from models import SubmitMatchRequest, VettedMatch

app = FastAPI(
    title="AI Recruiter API",
    description="Backend for receiving high-signal job matches directly from candidate extensions.",
    version="1.0.0"
)

@app.get("/")
def health_check():
    return {"status": "ok", "message": "Backend is live. Ready to receive matches."}

@app.post("/api/v1/submit-match")
def submit_match(match: SubmitMatchRequest, db: Session = Depends(get_db)):
    """
    Submits a new job match.
    Privacy Filter: If the fit_score is below 90, the match is ignored and not saved.
    """
    # Privacy Filter / Quality Gateway
    if match.fit_score < 90.0:
        return {
            "status": "ignored", 
            "message": f"Candidate rejected match (Score: {match.fit_score}). Not saved to feed."
        }

    # If it passes the filter (Score >= 90), save it!
    try:
        new_match = VettedMatch(
            candidate_id_hash=match.candidate_id_hash,
            job_title=match.job_title,
            company_name=match.company_name,
            job_url=str(match.job_url), # Convert HttpUrl to string for DB
            fit_score=match.fit_score,
            reasoning=match.reasoning,
            top_skills=match.top_skills
        )
        
        db.add(new_match)
        db.commit()
        db.refresh(new_match)
        
        return {
            "status": "success",
            "message": "High-signal match successfully routed to recruiter feed.",
            "match_id": new_match.id
        }
    except Exception as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save to database: {str(e)}"
        )
