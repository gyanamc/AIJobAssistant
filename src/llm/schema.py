from pydantic import BaseModel, Field
from typing import List, Optional

class JobEvaluation(BaseModel):
    is_match: bool = Field(description="Whether the job is a good fit based on user preferences and experience.")
    reasoning: str = Field(description="Reasoning explaining why this job is or isn't a good match.")
    cover_letter: str = Field(description="Generated cover letter if requested, otherwise empty string.")

class FormAnswers(BaseModel):
    answers: dict[str, str] = Field(description="A dictionary mapping the exact form question to the generated answer based on the user's profile.")

# --- User Profile Models ---
class PersonalInfo(BaseModel):
    first_name: str
    last_name: str
    email: str
    phone: str
    location: str
    linkedin_url: Optional[str] = None
    github_url: Optional[str] = None
    portfolio_url: Optional[str] = None

class Preferences(BaseModel):
    roles: List[str]
    locations: List[str]
    job_types: Optional[List[str]] = []
    salary_expectation: Optional[str] = None

class ExperienceItem(BaseModel):
    company: str
    title: str
    start_date: str
    end_date: str
    description: Optional[str] = None
    achievements: Optional[List[str]] = []

class EducationItem(BaseModel):
    institution: str
    degree: str
    field_of_study: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

class UserProfile(BaseModel):
    personal_info: PersonalInfo
    preferences: Preferences
    experience: Optional[List[ExperienceItem]] = []
    education: Optional[List[EducationItem]] = []
    skills: Optional[List[str]] = []
    custom_answers: Optional[dict] = {}
    role_title: Optional[str] = None
    summary: Optional[str] = None
