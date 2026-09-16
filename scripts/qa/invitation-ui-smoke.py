"""Headless UI-only smoke with synthetic API responses; does not validate PostgreSQL."""
import argparse
import json
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", default="http://127.0.0.1:5179/LabRat/")
parser.add_argument("--chromium", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--discover", action="store_true")
args = parser.parse_args()
output = Path(args.output)

def mock_api(context, initial_user=None):
    state = {"user": initial_user, "grant": None}
    owner = {"id": "owner", "username": "owner", "displayName": "Lab Owner", "isActive": True, "isSuperAdmin": False}
    member = {"id": "member", "username": "employee", "displayName": "Employee", "isActive": True, "isSuperAdmin": False}
    lab = {"id": "lab_qa", "name": "Synthetic QA Lab", "slug": "qa", "status": "active"}
    def auth():
        user = state["user"]
        return {"user": user, "memberships": [] if user["isSuperAdmin"] else [
            {"labId": lab["id"], "role": "lab_owner" if user["id"] == "owner" else "lab_member", "status": "active"}]}
    def handle(route):
        request = route.request
        path = urlparse(request.url).path
        body = request.post_data_json if request.post_data else {}
        status = 200
        result = {"items": [], "nextCursor": None}
        if path == "/api/v1/auth/me":
            if not state["user"]:
                status, result = 401, {"error": {"code": "unauthorized", "message": "Sign in", "requestId": "qa"}}
            else:
                result = auth()
        elif path == "/api/v1/auth/login":
            state["user"] = owner if body["username"] == "owner" else member
            result = auth()
        elif path == "/api/v1/auth/logout":
            state["user"] = None
            result = {"ok": True}
        elif path == "/api/v1/auth/invitations/preview":
            kind = "lab_owner" if body["invitationCode"].startswith("o") else "lab_member"
            result = {"kind": kind, "lab": None if kind == "lab_owner" else lab, "expiresAt": "2030-01-01T00:00:00Z"}
        elif path in ["/api/v1/auth/register", "/api/v1/auth/invitations/redeem"]:
            state["user"] = owner if body.get("labName") else member
            result = {"auth": auth(), "lab": {**lab, "role": auth()["memberships"][0]["role"]}}
            status = 201 if path.endswith("register") else 200
        elif path == "/api/v1/labs":
            result = {"items": [] if state["user"]["isSuperAdmin"] else [{**lab, "role": auth()["memberships"][0]["role"]}], "nextCursor": None}
        elif path.endswith("/invitations"):
            if request.method == "POST":
                status, result = 201, {"invitationCode": "m" * 43, "invitation": {"id": "invitation_qa"}}
        elif path.endswith("/members"):
            result = {"items": [{"user": owner, "role": "lab_owner", "status": "active"}, {"user": member, "role": "lab_member", "status": "active"}], "nextCursor": None}
        elif path == "/api/v1/projects":
            project = {"id": "project_qa", "labId": lab["id"], "name": "QA Project", "status": "active",
                       "capabilities": ["read", "export"] if state["user"]["id"] == "member" else ["read", "propose", "approve", "export", "manage_access"]}
            result = {"items": [project] if state["user"]["id"] == "owner" or state["grant"] else [], "nextCursor": None}
        elif path == "/api/v1/projects/project_qa":
            result = {"project": {"id": "project_qa", "labId": lab["id"], "name": "QA Project", "status": "active",
                                 "capabilities": ["read", "export"], "shellOnly": False, "projectProfile": {}}}
        elif "/member-access" in path:
            if request.method == "PUT":
                state["grant"] = None if body["preset"] == "none" else {
                    "id": "grant_qa", "scope": "all_experiments", "preset": body["preset"],
                    "capabilities": ["read", "export"] + (["propose"] if body["preset"] in ["edit", "approve"] else []) + (["approve"] if body["preset"] == "approve" else [])}
            row = {"user": member, "role": "lab_member", "editable": True, "directGrant": state["grant"],
                   "effectiveAccess": {"capabilities": state["grant"]["capabilities"], "allExperiments": True} if state["grant"] else None, "sources": []}
            result = {"memberAccess": row} if request.method == "PUT" else {"items": [row], "nextCursor": None}
        elif path.endswith("/manuscripts"):
            result = {"items": [{"id": "manuscript_qa", "blocks": [], "pages": [{"id": "page_1", "x": 0, "y": 0, "width": 960, "height": 540, "orientation": "landscape"}],
                                 "canvasState": {"canvasHeight": 540}, "references": []}], "nextCursor": None}
        elif path.endswith("/experiment-browser"):
            result = {"items": [], "rows": [], "columns": [], "totalCount": 0, "nextCursor": None}
        route.fulfill(status=status, content_type="application/json", body=json.dumps(result))
    context.route("**/api/v1/**", handle)
    return state

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True, executable_path=args.chromium)
    try:
        context = browser.new_context(viewport={"width": 1440, "height": 1000})
        state = mock_api(context)
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.base_url)
        page.wait_for_load_state("networkidle")
        print("BUTTONS", page.get_by_role("button").all_text_contents())
        print("LABELS", page.locator("label").all_text_contents())
        page.screenshot(path=str(output / "login.png"), full_page=True)
        assert not errors, errors
        page.get_by_role("button", name="Register with invitation", exact=True).click()
        print("REGISTER LABELS", page.locator("label").all_text_contents())
        print("REGISTER BUTTONS", page.get_by_role("button").all_text_contents())
        if not args.discover:
            page.get_by_label("Invitation code", exact=True).fill("o" * 43)
            page.get_by_role("button", name="Check invitation", exact=True).click()
            expect(page.get_by_label("Username", exact=True)).to_be_visible()
            print("OWNER FORM", page.locator("label").all_text_contents())
            page.get_by_label("Username", exact=True).fill("owner")
            page.get_by_label("Display name", exact=True).fill("Lab Owner")
            page.get_by_label("Password · at least 12 characters", exact=True).fill("UITestPassword123!")
            page.get_by_label("Confirm password", exact=True).fill("UITestPassword123!")
            page.get_by_label("Lab name", exact=True).fill("Synthetic QA Lab")
            page.screenshot(path=str(output / "owner-registration.png"), full_page=True)
            page.get_by_role("button", name="Create account", exact=True).click()
            expect(page.get_by_role("button", name="Lab management", exact=True)).to_be_visible()
            page.get_by_role("button", name="Lab management", exact=True).click()
            expect(page.get_by_role("heading", name="Lab members", exact=True)).to_be_visible()
            page.get_by_role("button", name="Invitations", exact=True).click()
            page.get_by_role("button", name="Create invitation", exact=True).click()
            expect(page.get_by_label("New invitation code")).to_have_value("m" * 43)
            page.get_by_role("button", name="Hide code", exact=True).click()
            page.get_by_role("button", name="Project permissions", exact=True).click()
            access = page.get_by_label("Direct access for employee", exact=True)
            expect(access).to_be_visible()
            access.select_option("view")
            page.get_by_role("button", name="Save access", exact=True).click()
            expect(page.get_by_role("cell", name="read, export All experiments", exact=True)).to_be_visible()
            page.screenshot(path=str(output / "project-access.png"), full_page=True)
            # A separate browser context models a different employee session.
            employee_context = browser.new_context(viewport={"width": 1440, "height": 1000})
            employee_state = mock_api(employee_context, {"id": "member", "username": "employee", "displayName": "Employee", "isActive": True, "isSuperAdmin": False})
            employee = employee_context.new_page()
            employee.on("pageerror", lambda error: errors.append(str(error)))
            employee.goto(args.base_url)
            employee.wait_for_load_state("networkidle")
            expect(employee.get_by_text("Waiting for your lab owner to assign project access.", exact=True)).to_be_visible()
            assert all(button.is_disabled() for button in employee.get_by_role("button", name="New project", exact=True).all())
            employee.screenshot(path=str(output / "employee-waiting.png"), full_page=True)
            employee_state["grant"] = state["grant"]
            employee.reload()
            employee.wait_for_load_state("networkidle")
            employee.get_by_role("button", name="Open", exact=True).click()
            expect(employee.get_by_text("Read-only access · Draft editing and analysis proposals are disabled.", exact=True)).to_be_visible()
            employee.get_by_role("button", name="Manuscript", exact=True).click()
            expect(employee.get_by_role("button", name="Add page", exact=True)).to_be_disabled()
            expect(employee.locator(".canvas")).to_have_attribute("inert", "")
            employee.keyboard.press("Control+z")
            employee.screenshot(path=str(output / "employee-readonly.png"), full_page=True)
            assert not errors, errors
            # Verify no registration secrets were persisted by the frontend.
            for active_page in [page, employee]:
                persisted = active_page.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
                assert "UITestPassword123!" not in persisted and "o" * 43 not in persisted and "m" * 43 not in persisted
            print("UI MOCK SMOKE PASSED: owner registration, management, code disclosure, project preset, employee waiting and readonly manuscript.")
            employee_context.close()
    finally:
        browser.close()
