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


class CandidateProfile(Base):
    __tablename__ = 'candidate_profiles'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=True)
    resume_id = Column(Integer, index=True, nullable=True)
    candidate_hash = Column(String(64), unique=True, index=True, nullable=False)
    role_title = Column(String(255), nullable=True)
    headline = Column(String(255), nullable=True)
    summary = Column(Text, nullable=True)
    total_experience_years = Column(Float, nullable=True)
    seniority = Column(String(50), nullable=True)
    current_company = Column(String(255), nullable=True)
    current_designation = Column(String(255), nullable=True)
    skills = Column(Text, nullable=True)
    location = Column(String(255), nullable=True)
    structured_profile = Column(JSON, nullable=False, default=dict)
    domains = Column(JSON, nullable=False, default=list)
    education = Column(JSON, nullable=False, default=list)
    certifications = Column(JSON, nullable=False, default=list)
    suggested_job_titles = Column(JSON, nullable=False, default=list)
    complementary_skills = Column(JSON, nullable=False, default=list)
    name_enc = Column(Text, nullable=True)
    email_enc = Column(Text, nullable=True)
    phone_enc = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class CandidateSkill(Base):
    __tablename__ = 'candidate_skills'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False)
    resume_id = Column(Integer, index=True, nullable=True)
    name = Column(String(150), index=True, nullable=False)
    category = Column(String(100), nullable=False, default='technical')
    evidence_type = Column(String(50), nullable=False, default='explicit')
    confidence = Column(Float, nullable=False, default=1.0)
    evidence = Column(Text, nullable=False, default='')
    source_section = Column(String(100), nullable=False, default='skills')
    status = Column(String(50), nullable=False, default='resume_supported')  # resume_supported | ai_inferred | user_confirmed
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class ResumeConsent(Base):
    __tablename__ = 'resume_consent'

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String(100), index=True, nullable=False)
    purpose = Column(String(100), nullable=False)
    consent_status = Column(Integer, nullable=False, default=1)  # 1=granted, 0=revoked
    notice_version = Column(String(50), nullable=False)
    provider_disclosures = Column(String(255), nullable=False, default='groq,ollama,openai,gemini,anthropic')
    consented_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    ip_hash = Column(String(64), nullable=True, default='')


class ResumeProcessingJob(Base):
    __tablename__ = 'resume_processing_jobs'

    id = Column(Integer, primary_key=True, index=True)
    job_id = Column(String(64), unique=True, index=True, nullable=False)
    user_id = Column(String(100), index=True, nullable=False)
    file_hash = Column(String(64), nullable=False)
    filename = Column(String(255), nullable=False)
    status = Column(String(50), nullable=False, default='UPLOADED')
    error_message = Column(Text, nullable=True, default='')
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)


class AdminAuditLog(Base):
    __tablename__ = 'admin_audit_logs'

    id = Column(Integer, primary_key=True, index=True)
    admin_user_id = Column(String(100), index=True, nullable=False)
    endpoint = Column(String(255), nullable=False)
    action = Column(String(255), nullable=False)
    ip_address = Column(String(64), nullable=True, default='')
    details = Column(JSON, nullable=False, default=dict)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)


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


class SkillItemSchema(BaseModel):
    name: str
    category: str = "technical"
    evidence_type: str = "explicit"  # explicit | inferred
    confidence: float = 1.0
    evidence: str = ""
    source_section: str = "skills"
    status: str = "resume_supported"  # resume_supported | ai_inferred | user_confirmed


class ExperienceItemSchema(BaseModel):
    company: str
    designation: str
    start_date: str = ""
    end_date: str = ""
    duration_months: Optional[int] = None
    responsibilities: List[str] = Field(default_factory=list)
    achievements: List[str] = Field(default_factory=list)


class CandidateMetaSchema(BaseModel):
    name: str = ""
    headline: str = ""
    summary: str = ""
    total_experience_years: Optional[float] = None
    seniority: str = ""
    current_company: str = ""
    current_designation: str = ""


class StructuredProfileSchema(BaseModel):
    candidate: CandidateMetaSchema = Field(default_factory=CandidateMetaSchema)
    skills: List[SkillItemSchema] = Field(default_factory=list)
    experience: List[ExperienceItemSchema] = Field(default_factory=list)
    domains: List[str] = Field(default_factory=list)
    education: List[Dict[str, Any]] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    suggested_job_titles: List[str] = Field(default_factory=list)
    complementary_skills: List[str] = Field(default_factory=list)


class CandidateProfileResponse(BaseModel):
    id: Optional[int] = None
    user_id: str
    resume_id: Optional[int] = None
    headline: str = ""
    total_experience_years: Optional[float] = None
    seniority: str = ""
    current_company: str = ""
    current_designation: str = ""
    role_title: str = ""
    location: str = ""
    structured_profile: Dict[str, Any] = Field(default_factory=dict)
    domains: List[str] = Field(default_factory=list)
    education: List[Dict[str, Any]] = Field(default_factory=list)
    certifications: List[str] = Field(default_factory=list)
    suggested_job_titles: List[str] = Field(default_factory=list)
    complementary_skills: List[str] = Field(default_factory=list)
    skills_summary: Dict[str, List[str]] = Field(default_factory=dict)
    created_at: str = ""
    updated_at: str = ""


class SkillConfirmationRequest(BaseModel):
    skill_name: str
    status: str = "user_confirmed"
    category: Optional[str] = "technical"
