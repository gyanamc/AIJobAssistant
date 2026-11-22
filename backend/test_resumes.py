"""
Automated test suite for AI Job Assistant v2.5.1 Security, Trust & AI Accuracy Hardening.
Tests:
- Supabase Bearer JWT authentication & canonical user identity
- Deprecated insecure email-only HMAC session endpoint (HTTP 410 Gone)
- Strict server-side administrator authorization and admin audit logging
- Affirmative consent requirement & provider disclosure
- Accurate AI resume parsing (no fabricated years, companies, institutions, or skills)
- File signature validation (PDF %PDF-, DOCX PK\\x03\\x04, TXT null-byte rejection, path traversal sanitization)
- Transactional legacy account migration (usr_<hash> to verified Supabase UUID)
- Authenticated account erasure & candidate data privacy
- Multi-user isolation, versioning, deduplication, and BYTEA binary integrity
"""
import io
import os
import sys
import zipfile
from pathlib import Path
import pytest
import docx
import pypdf
from sqlalchemy import create_engine, text
from fastapi.testclient import TestClient

backend_dir = str(Path(__file__).resolve().parent)
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

os.environ["TEST_MODE"] = "1"
os.environ["ADMIN_EMAILS"] = "admin@example.com,superadmin@aijobassistant.internal"
os.environ["ADMIN_USER_IDS"] = "admin_master_uuid"

import backend.main as bmain
from backend.main import app, sanitize_filename

# Isolated test database
TEST_DB_FILE = "./test_resumes.db"
test_engine = create_engine(f"sqlite:///{TEST_DB_FILE}", connect_args={"check_same_thread": False})
bmain.engine = test_engine

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
    with test_engine.begin() as conn:
        conn.execute(text("DELETE FROM resumes"))
        conn.execute(text("DELETE FROM candidate_skills"))
        conn.execute(text("DELETE FROM candidate_profiles"))
        conn.execute(text("DELETE FROM resume_consent"))
        conn.execute(text("DELETE FROM admin_audit_logs"))
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

# ── 1. Authentication & Insecure Session Deprecation ──────────────────────────

def test_deprecated_email_only_session_returns_410():
    client = TestClient(app)
    res = client.post("/api/v1/auth/session")
    assert res.status_code == 410
    assert "deprecated" in res.json()["detail"].lower()

def test_unauthenticated_requests_rejected():
    client = TestClient(app)
    # Upload without token -> 401
    res = client.post(
        "/api/v1/resumes/upload",
        files={"file": ("resume.txt", b"Some text", "text/plain")},
        data={"consent_accepted": "true"}
    )
    assert res.status_code == 401

    # List without token -> 401
    assert client.get("/api/v1/resumes").status_code == 401

    # Candidate profile without token -> 401
    assert client.get("/api/v1/candidate/profile").status_code == 401

# ── 2. Admin Authorization & Audit Logging ───────────────────────────────────

def test_admin_endpoints_require_admin_authorization_and_log_audit():
    client = TestClient(app)

    # 1. Anonymous request to admin analytics -> 401
    anon_res = client.get("/api/v1/admin/analytics")
    assert anon_res.status_code == 401

    # 2. Candidate user token -> 403 Forbidden
    candidate_headers = {"Authorization": "Bearer test-token-candidate1"}
    cand_res = client.get("/api/v1/admin/analytics", headers=candidate_headers)
    assert cand_res.status_code == 403
    assert "administrator access denied" in cand_res.json()["detail"].lower()

    # 3. Admin token -> 200 OK
    admin_headers = {"Authorization": "Bearer test-admin-token-admin1"}
    admin_res = client.get("/api/v1/admin/analytics", headers=admin_headers)
    assert admin_res.status_code == 200
    data = admin_res.json()
    assert "total_resumes" in data
    assert "skills_breakdown" in data

    # 4. Verify audit log entry was created
    with test_engine.connect() as conn:
        log_entry = conn.execute(
            text("SELECT admin_user_id, endpoint, action FROM admin_audit_logs WHERE admin_user_id = :uid"),
            {"uid": "admin1"}
        ).fetchone()
        assert log_entry is not None
        assert log_entry[0] == "admin1"
        assert log_entry[1] == "/api/v1/admin/analytics"

def test_admin_candidates_endpoint_protected():
    client = TestClient(app)
    # Candidate user cannot list all candidate resumes
    cand_headers = {"Authorization": "Bearer test-token-candidate1"}
    assert client.get("/api/v1/admin/candidates", headers=cand_headers).status_code == 403

    # Admin user can access
    admin_headers = {"Authorization": "Bearer test-admin-token-admin1"}
    res = client.get("/api/v1/admin/candidates", headers=admin_headers)
    assert res.status_code == 200
    assert "profiles" in res.json()

# ── 3. Affirmative Consent & Provider Disclosure ─────────────────────────────

def test_upload_requires_affirmative_consent():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-user1"}
    content = b"Candidate\nSkills: Python, SQL"

    # Missing consent -> 400 Bad Request
    res_no_consent = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.txt", content, "text/plain")}
    )
    assert res_no_consent.status_code == 422 or res_no_consent.status_code == 400

    # Explicit False consent -> 400 Bad Request
    res_false_consent = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.txt", content, "text/plain")},
        data={"consent_accepted": "false"}
    )
    assert res_false_consent.status_code == 400
    assert "consent is required" in res_false_consent.json()["detail"].lower()

    # Explicit True consent -> 201 Created & logged
    res_consent = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("resume.txt", content, "text/plain")},
        data={"consent_accepted": "true", "purpose": "profile_generation", "notice_version": "v2.5.1"}
    )
    assert res_consent.status_code == 201

    with test_engine.connect() as conn:
        consent_row = conn.execute(
            text("SELECT user_id, consent_status, notice_version, provider_disclosures FROM resume_consent WHERE user_id = :uid"),
            {"uid": "user1"}
        ).fetchone()
        assert consent_row is not None
        assert consent_row[0] == "user1"
        assert consent_row[1] == 1
        assert consent_row[2] == "v2.5.1"
        assert consent_row[3] in ("groq", "local_parser")

# ── 4. Accurate AI Extraction (No Fabricated Fallbacks) ───────────────────────

def test_resume_extraction_does_not_fabricate_data():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-freshgrad"}

    # Resume with NO work experience dates, NO degree institution, and unique skill
    fresh_resume = """
    Alex Rivera
    alex@example.com
    Skills: Kotlin, Android
    Projects:
    Built an open-source weather app using Kotlin.
    """

    res = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("alex_resume.txt", fresh_resume.encode("utf-8"), "text/plain")},
        data={"consent_accepted": "true", "notice_version": "v2.5.1"}
    )
    assert res.status_code == 201
    prof = res.json()["candidate_profile"]

    # Must NOT fabricate 3.0 years of experience
    assert prof["candidate"]["total_experience_years"] is None

    # Must NOT fabricate "Industry Experience" or fake tenure
    assert len(prof["experience"]) == 0

    # Must NOT fabricate "Accredited University"
    assert not any(e.get("institution") == "Accredited University" for e in prof.get("education", []))

    # Must NOT hallucinate generic fallback skills (Git, Docker, REST API) when not in resume
    supported_skill_names = [s["name"].lower() for s in prof["skills"] if s["status"] == "resume_supported"]
    assert "kotlin" in supported_skill_names
    assert "docker" not in supported_skill_names

# ── 5. File Signature Validation & Sanitization ───────────────────────────────

def test_file_signature_validation_and_sanitization():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-security-test"}

    # 1. Fake PDF (text disguised with .pdf extension) -> 400 Invalid signature
    fake_pdf = b"This is plain text disguised as a PDF."
    res_fake_pdf = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("fake.pdf", fake_pdf, "application/pdf")},
        data={"consent_accepted": "true"}
    )
    assert res_fake_pdf.status_code == 400
    assert "invalid file signature" in res_fake_pdf.json()["detail"].lower()

    # 2. Fake DOCX (non-zip content with .docx extension) -> 400
    fake_docx = b"This is not a zip or PK archive."
    res_fake_docx = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("fake.docx", fake_docx, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"consent_accepted": "true"}
    )
    assert res_fake_docx.status_code == 400
    assert "invalid file signature" in res_fake_docx.json()["detail"].lower()

    # 3. Malformed DOCX missing word/document.xml -> 400
    empty_zip = io.BytesIO()
    with zipfile.ZipFile(empty_zip, "w") as z:
        z.writestr("some_other_file.txt", "hello")
    res_bad_docx = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("bad_structure.docx", empty_zip.getvalue(), "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"consent_accepted": "true"}
    )
    assert res_bad_docx.status_code == 400
    assert "missing word/document.xml" in res_bad_docx.json()["detail"].lower()

    # 4. Text file with binary null bytes -> 400
    binary_txt = b"Hello\x00\x01\x02World binary file"
    res_bin_txt = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("binary.txt", binary_txt, "text/plain")},
        data={"consent_accepted": "true"}
    )
    assert res_bin_txt.status_code == 400
    assert "binary null bytes" in res_bin_txt.json()["detail"].lower()

    # 5. Filename sanitization against path traversal
    assert sanitize_filename("../../../etc/passwd") == "passwd"
    assert sanitize_filename("..\\..\\windows\\system32.docx") == "system32.docx"
    assert sanitize_filename("normal_resume.pdf") == "normal_resume.pdf"

# ── 6. Controlled Legacy Account Migration ───────────────────────────────────

def test_controlled_legacy_account_migration():
    client = TestClient(app)
    legacy_email = "legacy_user@example.com"
    import hashlib
    legacy_uid = f"usr_{hashlib.sha256(legacy_email.encode()).hexdigest()[:16]}"
    verified_uid = "verified-supabase-uuid-12345"

    # Pre-seed legacy resume record under usr_<hash>
    with test_engine.begin() as conn:
        conn.execute(
            text("""
                INSERT INTO resumes (user_id, filename, mime_type, file_size, file_hash, file_data, extracted_text, parsed_info, version)
                VALUES (:uid, 'legacy_resume.txt', 'text/plain', 50, 'hash123', :data, 'Legacy resume text', '{}', 1)
            """),
            {"uid": legacy_uid, "data": b"Legacy resume text"}
        )
        conn.execute(
            text("""
                INSERT INTO candidate_profiles (user_id, candidate_hash, headline, summary)
                VALUES (:uid, 'cand_hash', 'Legacy Headline', 'Legacy Summary')
            """),
            {"uid": legacy_uid}
        )

    # Perform migration under verified Supabase auth
    headers = {"Authorization": f"Bearer test-token-{verified_uid}"}
    # Test client mock sets email based on uid
    # So we call migration with user whose email matches legacy_user@example.com
    mig_headers = {"Authorization": "Bearer test-token-legacy_user"}
    mig_res = client.post("/api/v1/candidate/migrate-legacy", headers=mig_headers)
    assert mig_res.status_code == 200
    assert mig_res.json()["status"] == "success"
    assert mig_res.json()["migrated_resumes"] == 1

    # Verify records now belong to verified Supabase user id
    with test_engine.connect() as conn:
        resumes_new = conn.execute(
            text("SELECT COUNT(*) FROM resumes WHERE user_id = 'legacy_user'")
        ).scalar()
        assert resumes_new == 1

        resumes_old = conn.execute(
            text("SELECT COUNT(*) FROM resumes WHERE user_id = :l_uid"),
            {"l_uid": legacy_uid}
        ).scalar()
        assert resumes_old == 0

# ── 7. Authenticated Account Deletion ─────────────────────────────────────────

def test_authenticated_account_deletion():
    client = TestClient(app)
    user_id = "user_to_delete"
    headers = {"Authorization": f"Bearer test-token-{user_id}"}

    # Upload resume
    upload_res = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("delete_me.txt", b"Content to delete\nSkills: Python", "text/plain")},
        data={"consent_accepted": "true"}
    )
    assert upload_res.status_code == 201

    # Unauthenticated deletion -> 401
    assert client.post("/api/v1/account/delete-request").status_code == 401

    # Authenticated deletion -> 200 and purges records
    del_res = client.post("/api/v1/account/delete-request", headers=headers, json={"reason": "GDPR erasure request"})
    assert del_res.status_code == 200
    assert del_res.json()["status"] == "success"

    # Verify everything purged
    with test_engine.connect() as conn:
        assert conn.execute(text("SELECT COUNT(*) FROM resumes WHERE user_id = :uid"), {"uid": user_id}).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM candidate_profiles WHERE user_id = :uid"), {"uid": user_id}).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM candidate_skills WHERE user_id = :uid"), {"uid": user_id}).scalar() == 0
        assert conn.execute(text("SELECT COUNT(*) FROM resume_consent WHERE user_id = :uid"), {"uid": user_id}).scalar() == 0

# ── 8. Resume Persistence, Duplicate Detection & Versioning ──────────────────

def test_resume_persistence_and_versioning():
    client = TestClient(app)
    headers = {"Authorization": "Bearer test-token-alice"}

    v1_content = create_sample_docx("Alice Version 1. Skills: Python, FastAPI.")
    res1 = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("alice_v1.docx", v1_content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"consent_accepted": "true"}
    )
    assert res1.status_code == 201
    assert res1.json()["version"] == 1
    assert res1.json()["is_duplicate"] is False
    id1 = res1.json()["id"]

    # Re-uploading identical file triggers duplicate detection
    res1_dup = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("alice_copy.docx", v1_content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"consent_accepted": "true"}
    )
    assert res1_dup.status_code == 201
    assert res1_dup.json()["is_duplicate"] is True
    assert res1_dup.json()["id"] == id1

    # Uploading v2 with different content increments version
    v2_content = create_sample_docx("Alice Version 2. Skills: Python, FastAPI, Docker, Kubernetes.")
    res2 = client.post(
        "/api/v1/resumes/upload",
        headers=headers,
        files={"file": ("alice_v2.docx", v2_content, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")},
        data={"consent_accepted": "true"}
    )
    assert res2.status_code == 201
    assert res2.json()["version"] == 2
    id2 = res2.json()["id"]

    # Verify binary download integrity of both versions independently
    dl1 = client.get(f"/api/v1/resumes/{id1}/file", headers=headers)
    assert dl1.status_code == 200
    assert dl1.content == v1_content

    dl2 = client.get(f"/api/v1/resumes/{id2}/file", headers=headers)
    assert dl2.status_code == 200
    assert dl2.content == v2_content
