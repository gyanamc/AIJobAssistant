from sqlalchemy import Column, Integer, String, Float, Text, JSON, LargeBinary, DateTime, func
from pydantic import BaseModel, HttpUrl, Field
from typing import List, Optional, Dict, Any

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


class Resume(Base):
    __tablename__ = 'resumes'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False)
    filename = Column(String(255), nullable=False)
    mime_type = Column(String(100), nullable=False)
    file_size = Column(Integer, nullable=False)
    file_hash = Column(String(64), index=True, nullable=False)
    file_data = Column(LargeBinary, nullable=False)  # Retained in PostgreSQL as BYTEA
    extracted_text = Column(Text, nullable=False)
    parsed_info = Column(JSON, nullable=False, default=dict)
    version = Column(Integer, nullable=False, default=1)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


# Auto-create tables if they don't exist
Base.metadata.create_all(bind=engine)

# --------------------------
# REQUEST & RESPONSE SCHEMAS (Pydantic)
# --------------------------
class SubmitMatchRequest(BaseModel):
    candidate_id_hash: str
    job_title: str
    company_name: str
    job_url: HttpUrl
    fit_score: float = Field(..., description="A score representing the match quality")
    reasoning: str
    top_skills: List[str]


class ResumeMetadataResponse(BaseModel):
    id: int
    user_id: str
    filename: str
    mime_type: str
    file_size: int
    file_hash: str
    version: int
    parsed_info: Dict[str, Any]
    created_at: str
    is_duplicate: bool = False


class ResumeDetailResponse(ResumeMetadataResponse):
    extracted_text: str
