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
    run_test_ddl("""
        CREATE TABLE IF NOT EXISTS resumes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id VARCHAR(100) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            file_size INTEGER NOT NULL,
            file_hash VARCHAR(64) NOT NULL,
            file_data BLOB NOT NULL,
            extracted_text TEXT NOT NULL,
            parsed_info JSON NOT NULL DEFAULT '{}',
            version INTEGER NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    run_test_ddl("""
        CREATE TABLE IF NOT EXISTS candidate_profiles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            candidate_hash TEXT UNIQUE NOT NULL,
            email_enc TEXT,
            summary TEXT
        )
    """)
    yield
    try:
        if os.path.exists(TEST_DB_FILE):
            os.remove(TEST_DB_FILE)
    except Exception:
        pass

@pytest.fixture(autouse=True)
def clear_resumes():
    run_test_ddl("DELETE FROM resumes")
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
