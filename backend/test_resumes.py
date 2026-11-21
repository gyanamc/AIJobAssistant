"""
Automated test suite for backend resume persistence in PostgreSQL / SQLite.
Tests file upload (PDF/DOCX/TXT), BYTEA binary persistence, text extraction,
version management, user isolation, duplicate detection, deletion, and auth.
"""
import io
import os
import sys
from pathlib import Path
import pytest
import docx
import pypdf
from sqlalchemy import create_engine, text
from fastapi.testclient import TestClient

# Add backend directory to sys.path
backend_dir = str(Path(__file__).resolve().parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ["TEST_MODE"] = "1"

import backend.main as bmain
from backend.main import app, get_current_user

# Isolated test database
TEST_DB_FILE = "./test_resumes.db"
test_engine = create_engine(f"sqlite:///{TEST_DB_FILE}", connect_args={"check_same_thread": False})
bmain.engine = test_engine

def run_test_ddl(sql: str):
    with test_engine.connect() as conn:
        conn.execute(text(sql))
        conn.commit()

@pytest.fixture(scope="session", autouse=True)
def setup_test_db():
    bmain.init_db()
    yield
    try:
        if os.path.exists(TEST_DB_FILE):
            os.remove(TEST_DB_FILE)
    except Exception:
        pass

@pytest.fixture(autouse=True)
def clear_resumes():
    with test_engine.connect() as conn:
        conn.execute(text("DELETE FROM resumes"))
        conn.execute(text("DELETE FROM candidate_skills"))
        conn.execute(text("DELETE FROM candidate_profiles"))
        conn.execute(text("DELETE FROM resume_consent"))
        conn.commit()
    yield

def create_sample_docx(text="Jane Smith, Senior AI Engineer. Skills: Python, PyTorch, LangChain."):
    doc = docx.Document()
    doc.add_paragraph(text)
    buf = io.BytesIO()
    doc.save(buf)
    return buf.getvalue()

def create_sample_pdf(text="Alice Johnson, Cloud Architect. Skills: AWS, Kubernetes, Terraform."):
    from reportlab.pdfgen import canvas
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(100, 750, text)
    c.save()
    return buf.getvalue()

def test_unauthenticated_request_rejected():
    client = TestClient(app)
    # Upload without token -> 401
    res = client.post("/api/v1/resumes/upload", files={"file": ("resume.txt", b"Some text", "text/plain")})
    assert res.status_code == 401

    # List without token -> 401
    res = client.get("/api/v1/resumes")
    assert res.status_code == 401

    # Detail without token -> 401
    res = client.get("/api/v1/resumes/1")
    assert res.status_code == 401

    # Download without token -> 401
    res = client.get("/api/v1/resumes/1/file")
    assert res.status_code == 401

    # Delete without token -> 401
    res = client.delete("/api/v1/resumes/1")
    assert res.status_code == 401

def test_upload_and_retrieve_txt_resume():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}
    content = b"John Doe\nEmail: john@example.com\nSkills: Python, FastAPI\nExperience: 5 years software engineer."

    res = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("my_resume.txt", content, "text/plain")}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["filename"] == "my_resume.txt"
    assert data["version"] == 1
    assert data["user_id"] == "user1"
    assert data["file_size"] == len(content)
    assert data["is_duplicate"] is False
    resume_id = data["id"]
    assert resume_id is not None

    # Verify retrieval of details
    detail_res = client.get(f"/api/v1/resumes/{resume_id}", headers=headers)
    assert detail_res.status_code == 200
    detail = detail_res.json()
    assert detail["id"] == resume_id
    assert "John Doe" in detail["extracted_text"]
    assert detail["user_id"] == "user1"

    # Verify byte-for-byte binary download from database
    dl_res = client.get(f"/api/v1/resumes/{resume_id}/file", headers=headers)
    assert dl_res.status_code == 200
    assert dl_res.content == content
    assert "attachment" in dl_res.headers.get("Content-Disposition", "")

def test_upload_and_retrieve_docx_resume():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}
    content = create_sample_docx("Jane Doe, Lead Data Scientist. Skills: Python, Scikit-learn, SQL.")

    res = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("Jane_Resume.docx", content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
    )
    assert res.status_code == 201
    data = res.json()
    assert data["filename"] == "Jane_Resume.docx"
    assert data["version"] == 1
    resume_id = data["id"]
    assert resume_id is not None

    # Download and verify exact binary integrity
    dl_res = client.get(f"/api/v1/resumes/{resume_id}/file", headers=headers)
    assert dl_res.status_code == 200
    assert dl_res.content == content

    # Verify extracted text contains the docx paragraph
    detail_res = client.get(f"/api/v1/resumes/{resume_id}", headers=headers)
    assert detail_res.status_code == 200
    assert "Jane Doe" in detail_res.json()["extracted_text"]

def test_multiple_resumes_and_version_increment():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}

    # Upload v1
    v1_content = b"Resume Version 1 text for Bob."
    res1 = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("v1.txt", v1_content, "text/plain")})
    assert res1.status_code == 201
    assert res1.json()["version"] == 1
    id1 = res1.json()["id"]

    # Upload v2 (different content)
    v2_content = b"Resume Version 2 updated text for Bob."
    res2 = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("v2.txt", v2_content, "text/plain")})
    assert res2.status_code == 201
    assert res2.json()["version"] == 2
    id2 = res2.json()["id"]

    # Both must exist and be retained separately
    list_res = client.get("/api/v1/resumes", headers=headers)
    assert list_res.status_code == 200
    items = list_res.json()["resumes"]
    assert len(items) == 2
    assert items[0]["version"] == 2
    assert items[1]["version"] == 1

    # Verify both files can be downloaded independently
    assert client.get(f"/api/v1/resumes/{id1}/file", headers=headers).content == v1_content
    assert client.get(f"/api/v1/resumes/{id2}/file", headers=headers).content == v2_content

def test_duplicate_file_detection():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}
    content = b"Identical resume content for deduplication test."

    res1 = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("resume.txt", content, "text/plain")})
    assert res1.status_code == 201
    assert res1.json()["is_duplicate"] is False
    orig_id = res1.json()["id"]

    # Upload identical content again
    res2 = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("resume_copy.txt", content, "text/plain")})
    assert res2.status_code == 201
    assert res2.json()["is_duplicate"] is True
    assert res2.json()["id"] == orig_id

    # Count must still be 1 (no redundant DB row created)
    list_res = client.get("/api/v1/resumes", headers=headers)
    assert len(list_res.json()["resumes"]) == 1

def test_cross_user_isolation():
    client = TestClient(app)
    headers_user1 = {"Authorization": "Bearer test-token-user1"}
    headers_user2 = {"Authorization": "Bearer test-token-user2"}

    # User 1 uploads resume
    res1 = client.post("/api/v1/resumes/upload", headers=headers_user1, files={"file": ("user1.txt", b"User 1 confidential resume", "text/plain")})
    id1 = res1.json()["id"]

    # User 2 lists resumes -> should see 0
    list2 = client.get("/api/v1/resumes", headers=headers_user2)
    assert list2.status_code == 200
    assert len(list2.json()["resumes"]) == 0

    # User 2 tries to get User 1's resume detail -> 404
    detail2 = client.get(f"/api/v1/resumes/{id1}", headers=headers_user2)
    assert detail2.status_code == 404

    # User 2 tries to download User 1's binary file -> 404
    dl2 = client.get(f"/api/v1/resumes/{id1}/file", headers=headers_user2)
    assert dl2.status_code == 404

    # User 2 tries to delete User 1's resume -> 404
    del2 = client.delete(f"/api/v1/resumes/{id1}", headers=headers_user2)
    assert del2.status_code == 404

    # Verify User 1's resume is still intact
    assert client.get(f"/api/v1/resumes/{id1}", headers=headers_user1).status_code == 200

def test_delete_resume_removes_record_and_file():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}

    res = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("temp.txt", b"Temporary resume text", "text/plain")})
    resume_id = res.json()["id"]

    del_res = client.delete(f"/api/v1/resumes/{resume_id}", headers=headers)
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "deleted"

    # Subsequent detail and file retrieval must 404
    assert client.get(f"/api/v1/resumes/{resume_id}", headers=headers).status_code == 404
    assert client.get(f"/api/v1/resumes/{resume_id}/file", headers=headers).status_code == 404

def test_unsupported_file_format_rejected():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}

    # Upload an exe / bin / image
    res = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("malicious.exe", b"\x4d\x5a\x90", "application/x-msdownload")})
    assert res.status_code == 400
    assert "Unsupported file format" in res.json()["detail"]

def test_oversized_file_rejected():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}

    # 11 MB dummy content (exceeds 10 MB limit)
    oversized = b"A" * (11 * 1024 * 1024)
    res = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("big.txt", oversized, "text/plain")})
    assert res.status_code == 413
    assert "exceeds maximum allowed size" in res.json()["detail"]

def test_account_deletion_cleans_up_resumes():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-deleteduser@example.com"}

    # Upload resume for deleteduser@example.com
    res = client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("del.txt", b"To be deleted", "text/plain")})
    assert res.status_code == 201

    # Request account deletion
    del_req = client.post("/api/v1/account/delete-request", json={"email": "deleteduser@example.com", "reason": "Moving away"})
    assert del_req.status_code == 200

    # Resumes for deleted user must now be empty
    list_res = client.get("/api/v1/resumes", headers=headers)
    assert len(list_res.json()["resumes"]) == 0

def test_auth_session_creation_and_bearer_verification():
    client = TestClient(app)
    # Invalid email rejected
    res_bad = client.post("/api/v1/auth/session", json={"email": "invalid-email"})
    assert res_bad.status_code == 400

    # Valid session issuance
    res = client.post("/api/v1/auth/session", json={"email": "alice@example.com", "name": "Alice Doe"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"
    assert data["user"]["email"] == "alice@example.com"
    token = data["access_token"]

    # Use this token to access protected endpoint
    headers = {"Authorization": f"Bearer {token}"}
    list_res = client.get("/api/v1/resumes", headers=headers)
    assert list_res.status_code == 200
    assert list_res.json()["resumes"] == []

def test_comprehensive_candidate_profile_and_skill_classification():
    client = TestClient(app)
    # Create authenticated session
    s_res = client.post("/api/v1/auth/session", json={"email": "bob@example.com", "name": "Bob Builder"})
    token = s_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    sample_resume = """
    Bob Builder
    bob@example.com | +1 555-0199
    Senior AI/ML Engineer
    
    Professional Experience:
    Senior Software Engineer | Acme AI Corp (2020 - Present)
    - Architected scalable machine learning microservices with Python, PyTorch, and FastAPI.
    - Built RAG pipelines and LLM systems with LangChain and Docker.
    
    Software Developer | Beta FinTech Inc (2017 - 2020)
    - Developed payment processing pipelines in Python and PostgreSQL.
    - Integrated AWS cloud infrastructure with Docker and CI/CD.
    
    Education:
    Bachelor of Science in Computer Science from State University
    """

    res = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("bob_resume.txt", sample_resume.encode("utf-8"), "text/plain")},
        data={"purpose": "profile_generation", "notice_version": "v2.5.0"}
    )
    assert res.status_code == 201
    res_json = res.json()
    assert "candidate_profile" in res_json
    prof = res_json["candidate_profile"]

    # Verify candidate metadata
    assert prof["candidate"]["name"] != ""
    assert prof["candidate"]["total_experience_years"] >= 5.0
    assert prof["candidate"]["seniority"] in ("Senior", "Lead", "Staff / Principal")
    assert "Fintech & Banking" in prof["domains"] or "AI & Machine Learning" in prof["domains"]

    # Verify skill classification
    skills = prof["skills"]
    assert len(skills) > 0
    supported_skills = [s for s in skills if s["status"] == "resume_supported"]
    inferred_skills = [s for s in skills if s["status"] == "ai_inferred"]
    assert len(supported_skills) >= 3
    assert any(s["name"].lower() == "python" for s in supported_skills)
    assert any(s["evidence_type"] == "explicit" for s in supported_skills)

    # Fetch candidate profile directly via GET
    get_prof = client.get("/api/v1/candidate/profile", headers=headers)
    assert get_prof.status_code == 200
    p_data = get_prof.json()
    assert p_data["user_id"] == s_res.json()["user"]["id"]
    assert len(p_data["skills_summary"]["resume_supported"]) >= 3

def test_candidate_skill_confirmation_and_update():
    client = TestClient(app)
    s_res = client.post("/api/v1/auth/session", json={"email": "charlie@example.com"})
    token = s_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Upload resume
    text_content = "Charlie\nSkills: Python, React\nExperience: 2021 - Present"
    client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("charlie.txt", text_content.encode(), "text/plain")})

    # Confirm an inferred or new skill (e.g. Next.js via Add & Re-score)
    conf_res = client.post(
        "/api/v1/candidate/skills/confirm",
        headers=headers,
        json={"skill_name": "Next.js", "category": "frameworks_and_libraries"}
    )
    assert conf_res.status_code == 200
    assert conf_res.json()["classification"] == "user_confirmed"

    # Verify it now appears in user_confirmed summary
    get_prof = client.get("/api/v1/candidate/profile", headers=headers)
    assert "Next.js" in get_prof.json()["skills_summary"]["user_confirmed"]

    # Update candidate profile fields
    up_res = client.put(
        "/api/v1/candidate/profile",
        headers=headers,
        json={"headline": "Principal Architect | Next.js & Python"}
    )
    assert up_res.status_code == 200
    assert client.get("/api/v1/candidate/profile", headers=headers).json()["headline"] == "Principal Architect | Next.js & Python"

def test_candidate_profile_full_lifecycle_and_deletion():
    client = TestClient(app)
    s_res = client.post("/api/v1/auth/session", json={"email": "dan@example.com"})
    token = s_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}

    # Upload resume
    client.post("/api/v1/resumes/upload", headers=headers, files={"file": ("dan.txt", b"Dan\nSkills: AWS, Go\nExperience: 2018 - 2023", "text/plain")})
    assert client.get("/api/v1/candidate/profile", headers=headers).status_code == 200

    # Delete candidate profile completely
    del_res = client.delete("/api/v1/candidate/profile", headers=headers)
    assert del_res.status_code == 200

    # Next profile request must 404
    assert client.get("/api/v1/candidate/profile", headers=headers).status_code == 404
    # Resumes must be empty
    assert len(client.get("/api/v1/resumes", headers=headers).json()["resumes"]) == 0

def test_admin_analytics_aggregation():
    client = TestClient(app)
    res = client.get("/api/v1/admin/analytics")
    assert res.status_code == 200
    data = res.json()
    assert "total_resumes" in data
    assert "total_candidate_profiles" in data
    assert "skills_breakdown" in data
    assert "top_skills" in data
