import os
import json
from openai import OpenAI
from pydantic import ValidationError
from dotenv import load_dotenv
import openai
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_exception_type

from .schema import JobEvaluation, FormAnswers

load_dotenv()

class LLMClient:
    def __init__(self):
        # Requires OPENAI_API_KEY in environment
        self.client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))
        
        # Load user profile
        profile_path = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'user_profile.json')
        with open(profile_path, 'r') as f:
            self.user_profile = json.load(f)

    @retry(
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(5),
        retry=retry_if_exception_type((openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError))
    )
    def evaluate_job(self, job_title: str, job_description: str) -> JobEvaluation:
        """
        Uses the LLM to evaluate if the job is a match based on the user's profile.
        """
        system_prompt = (
            "You are an expert AI job recruiter acting on behalf of the user. "
            "Your task is to read a Job Title and Job Description, and decide if it is a good match "
            "for the user's profile. If it is a good match, generate a short, professional cover letter "
            "tailored to the job description (if applicable). If not, explain why.\n\n"
            f"USER PROFILE:\n{json.dumps(self.user_profile, indent=2)}"
        )
        
        user_prompt = f"Job Title: {job_title}\n\nJob Description:\n{job_description}"
        
        response = self.client.beta.chat.completions.parse(
            model="gpt-4o",  # or gpt-4o-mini
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format=JobEvaluation
        )
        
        return response.choices[0].message.parsed

    @retry(
        wait=wait_exponential(multiplier=1, min=4, max=60),
        stop=stop_after_attempt(5),
        retry=retry_if_exception_type((openai.RateLimitError, openai.APIConnectionError, openai.InternalServerError))
    )
    def answer_form_questions(self, form_questions: list[str]) -> FormAnswers:
        """
        Given a list of form questions from a job application, return answers based on the profile.
        """
        system_prompt = (
            "You are an AI assistant helping the user fill out job applications. "
            "Given a list of questions from an application form, provide the best answer "
            "for each question strictly based on the user's profile and custom answers. "
            "Keep answers concise. If a question is a yes/no question, answer 'Yes' or 'No'. "
            "If a question asks for salary expectations, provide the exact number.\n\n"
            f"USER PROFILE:\n{json.dumps(self.user_profile, indent=2)}"
        )
        
        user_prompt = "Questions:\n" + "\n".join([f"- {q}" for q in form_questions])
        
        response = self.client.beta.chat.completions.parse(
            model="gpt-4o",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            response_format=FormAnswers
        )
        
        return response.choices[0].message.parsed
