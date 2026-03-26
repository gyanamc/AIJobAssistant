from sqlalchemy import Column, Integer, String, Float, Text, JSON
from pydantic import BaseModel, HttpUrl, Field
from typing import List

from database import engine
from sqlalchemy.orm import declarative_base

Base = declarative_base()

# --------------------------
# DATABASE SCHEMA (SQLAlchemy)
# --------------------------
class VettedMatch(Base):
    __tablename__ = 'vetted_matches'
    
    id = Column(Integer, primary_key=True, index=True)
    candidate_id_hash = Column(String, index=True, nullable=False)
    job_title = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    job_url = Column(String, nullable=False)
    fit_score = Column(Float, nullable=False)
    reasoning = Column(Text, nullable=False)
    # Storing list of skills as JSON array for cross-DB compatibility
    top_skills = Column(JSON, nullable=False)

# Auto-create tables if they don't exist
Base.metadata.create_all(bind=engine)

# --------------------------
# REQUEST SCHEMA (Pydantic)
# --------------------------
class SubmitMatchRequest(BaseModel):
    candidate_id_hash: str
    job_title: str
    company_name: str
    job_url: HttpUrl
    fit_score: float = Field(..., description="A score representing the match quality")
    reasoning: str
    top_skills: List[str]
