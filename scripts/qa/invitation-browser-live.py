"""Real HTTP + PostgreSQL acceptance; run via backend/scripts/invitation-browser-check.mjs.

All identities and projects are synthetic. No traces or invitation/password values are logged.
"""
import argparse
import re
from pathlib import Path
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", required=True)
parser.add_argument("--chromium", required=True)
parser.add_argument("--output", required=True)
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
origin = "{uri.scheme}://{uri.netloc}".format(uri=urlparse(args.base_url))
password = "BrowserTestPassword123!"
codes = []
errors = []

def button(page, name):
    return page.get_by_role("button", name=name, exact=True)

def api(page, path):
    response = page.request.get(origin + "/api/v1" + path)
    assert response.status == 200, (path, response.status)
    return response.json()

def visit(page):
    page.goto(args.base_url)
    page.wait_for_load_state("networkidle")

def issue(page):
    button(page, "Create invitation").click()
    code_input = page.get_by_label("New invitation code", exact=True)
    expect(code_input).to_be_visible()
    code = code_input.input_value()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", code)
    codes.append(code)
    button(page, "Hide code").click()
    return code

def preview(page, code):
    page.get_by_label("Invitation code", exact=True).fill(code)
    button(page, "Check invitation").click()

def register(page, code, username, lab_name=None):
    visit(page)
    button(page, "Register with invitation").click()
    preview(page, code)
    page.get_by_label("Username", exact=True).fill(username)
    page.get_by_label("Display name", exact=True).fill(username.replace("_", " ").title())
    page.get_by_label("Password · at least 12 characters", exact=True).fill(password)
    page.get_by_label("Confirm password", exact=True).fill(password)
    if lab_name:
        page.get_by_label("Lab name", exact=True).fill(lab_name)
    else:
        expect(page.get_by_label("Lab name", exact=True)).to_have_count(0)
    with page.expect_response(lambda r: r.url.endswith("/auth/register")) as submitted:
        button(page, "Create account").click()
    assert submitted.value.status == 201
    expect(button(page, "Logout")).to_be_visible()

def open_project(page, editable=False):
    button(page, "Open").click()
    expect(button(page, "Skip onboarding").or_(button(page, "Manuscript")).first).to_be_visible()
    if editable and button(page, "Skip onboarding").is_visible():
        button(page, "Skip onboarding").click()
    expect(button(page, "Manuscript")).to_be_visible()

def save_preset(owner, preset):
    button(owner, "Project permissions").click()
    select = owner.get_by_label("Direct access for employee_qa", exact=True)
    expect(select).to_be_visible()
    select.select_option(preset)
    row = owner.get_by_role("row").filter(has=select)
    with owner.expect_response(lambda r: "/member-access/" in r.url and r.request.method == "PUT") as submitted:
        row.get_by_role("button", name="Save access", exact=True).click()
    assert submitted.value.status == 200
    expect(select).to_have_value(preset)
    expect(row.get_by_role("button", name="Save access", exact=True)).to_be_disabled()
    return submitted.value.json()["memberAccess"]

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=args.chromium)
    try:
        def new_page():
            context = browser.new_context(viewport={"width": 1440, "height": 1000})
            page = context.new_page()
            page.on("pageerror", lambda error: errors.append(str(error)))
            return page

        platform, owner, employee = new_page(), new_page(), new_page()
        visit(platform)
        # Reconnaissance before acting: labels and controls, never field values.
        assert "Username" in platform.locator("label").all_text_contents()
        platform.get_by_label("Username", exact=True).fill("platform_qa")
        platform.get_by_label("Password", exact=True).fill(password)
        button(platform, "Sign in").click()
        expect(button(platform, "Platform management")).to_be_visible()
        assert api(platform, "/labs")["items"] == []
        button(platform, "Platform management").click()
        owner_code = issue(platform)
        register(owner, owner_code, "owner_qa", "Synthetic Browser QA Lab")
        visit(owner)
        expect(button(owner, "Lab management")).to_be_visible()
        lab_id = api(owner, "/labs")["items"][0]["id"]
        assert api(owner, "/auth/me")["memberships"][0]["role"] == "lab_owner"
        button(owner, "New project").first.click()
        dialog = owner.get_by_role("dialog", name="New project", exact=True)
        dialog.get_by_label("Project name", exact=True).fill("Synthetic QA Project")
        button(dialog, "Create project").click()
        expect(button(owner, "Skip onboarding")).to_be_visible()
        button(owner, "Skip onboarding").click()
        button(owner, "File menu").click()
        button(owner, "Lab management").click()
        project_id = api(owner, "/projects?labId=" + lab_id)["items"][0]["id"]
        assert platform.request.get(origin + "/api/v1/projects/" + project_id).status == 404
        button(owner, "Invitations").click()
        employee_code = issue(owner)
        register(employee, employee_code, "employee_qa")
        visit(employee)
        expect(employee.get_by_text("Waiting for your lab owner to assign project access.", exact=True)).to_be_visible()
        assert all(item.is_disabled() for item in button(employee, "New project").all())
        assert api(employee, "/projects?labId=" + lab_id)["items"] == []
        assert api(employee, "/auth/me")["memberships"][0]["role"] == "lab_member"
        employee.screenshot(path=str(output / "employee-waiting.png"), full_page=True)
        print("PASS: platform without a lab, owner registration and project creation, employee registration and session refresh.", flush=True)

        access = save_preset(owner, "view")
        assert access["effectiveAccess"]["capabilities"] == ["read", "export"]
        owner.screenshot(path=str(output / "owner-project-permissions.png"), full_page=True)
        visit(employee)
        open_project(employee)
        expect(employee.get_by_text("Read-only access · Draft editing and analysis proposals are disabled.", exact=True)).to_be_visible()
        button(employee, "Manuscript").click()
        expect(button(employee, "Add page")).to_be_disabled()
        expect(button(employee, "Save")).to_be_disabled()
        expect(employee.locator(".canvas")).to_have_attribute("inert", "")
        employee.keyboard.press("Control+z")
        assert employee.request.post(origin + f"/api/v1/projects/{project_id}/manuscripts", data={"title": "Denied draft"}).status == 403
        employee.screenshot(path=str(output / "employee-view.png"), full_page=True)

        access = save_preset(owner, "edit")
        assert set(access["effectiveAccess"]["capabilities"]) == {"read", "propose", "export"}
        visit(employee)
        open_project(employee, editable=True)
        button(employee, "Manuscript").click()
        expect(button(employee, "Add page")).to_be_enabled()
        button(employee, "Add page").click()
        orientation = employee.get_by_role("dialog", name="Choose manuscript orientation", exact=True)
        expect(orientation).to_be_visible()
        orientation.get_by_role("button", name="Landscape 1600 x 900", exact=True).click()
        expect(employee.locator(".canvas-page")).to_have_count(1)
        with employee.expect_response(lambda r: "/manuscripts" in r.url and r.request.method in ["POST", "PUT"]) as saved:
            button(employee, "Save").click()
        assert saved.value.status in [200, 201]
        assert len(api(employee, f"/projects/{project_id}/manuscripts")["items"][0]["pages"]) == 1
        visit(employee)
        open_project(employee, editable=True)
        button(employee, "Manuscript").click()
        expect(employee.locator(".canvas-page")).to_have_count(1)
        employee.screenshot(path=str(output / "employee-edit.png"), full_page=True)
        access = save_preset(owner, "approve")
        assert set(access["effectiveAccess"]["capabilities"]) == {"read", "propose", "approve", "export"}
        visit(employee)
        open_project(employee, editable=True)
        assert "approve" in api(employee, "/projects/" + project_id)["project"]["capabilities"]
        print("PASS: real view/edit/approve grants; readonly canvas rejects changes; edited draft persists after refresh.", flush=True)

        button(owner, "Members").click()
        row = owner.get_by_role("row").filter(has=owner.get_by_role("cell", name="employee_qa", exact=True))
        row.get_by_role("button", name="Remove member", exact=True).click()
        row.get_by_role("button", name="Confirm removal", exact=True).click()
        expect(row).to_have_count(0)
        # Exercise the ordinary app request handler, not just a page reload.
        button(employee, "File menu").click()
        button(employee, "Projects").click()
        button(employee, "Open").click()
        expect(button(employee, "Open")).to_have_count(0)
        assert employee.request.get(origin + "/api/v1/projects/" + project_id).status == 404
        visit(employee)
        assert api(employee, "/labs")["items"] == []
        button(owner, "Invitations").click()
        rejoin_code = issue(owner)
        button(employee, "Use invitation").click()
        preview(employee, rejoin_code)
        expect(button(employee, "Accept invitation")).to_be_visible()
        expect(employee.get_by_label("Username", exact=True)).to_have_count(0)
        expect(employee.locator('input[type="password"]')).to_have_count(0)
        button(employee, "Accept invitation").click()
        expect(employee.get_by_text("Waiting for your lab owner to assign project access.", exact=True)).to_be_visible()
        visit(employee)
        assert len(api(employee, "/labs")["items"]) == 1
        assert api(employee, "/projects?labId=" + lab_id)["items"] == []
        employee.screenshot(path=str(output / "employee-rejoined-without-old-grants.png"), full_page=True)
        for page in [platform, owner, employee]:
            persisted = page.evaluate("JSON.stringify({...localStorage,...sessionStorage})")
            assert password not in persisted and all(code not in persisted for code in codes)
        assert not errors, errors
        print("PASS: next-request membership revocation, existing-account redemption, no restored grants, no browser-persisted secrets or JavaScript errors.", flush=True)
    finally:
        browser.close()
