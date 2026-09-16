"""Guest HTTP/browser acceptance using synthetic identities and a disposable database."""
import argparse
import json
import os
from urllib.parse import urlparse
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

parser = argparse.ArgumentParser()
parser.add_argument("--base-url", required=True)
parser.add_argument("--chromium", required=True)
parser.add_argument("--output", required=True)
parser.add_argument("--inspect", action="store_true")
args = parser.parse_args()
output = Path(args.output)
output.mkdir(parents=True, exist_ok=True)
origin = "{uri.scheme}://{uri.netloc}".format(uri=urlparse(args.base_url))


def inspect(page, stage):
    if args.inspect:
        print(json.dumps({"stage": stage, "body": page.locator("body").inner_text(),
                          "buttons": page.locator("button").evaluate_all(
                              "els => els.map(e => ({text:e.innerText, disabled:e.matches(':disabled')}))")},
                         ensure_ascii=True))

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True, executable_path=args.chromium)
    try:
        page = browser.new_page(viewport={"width": 1440, "height": 1000})
        responses = []
        errors = []
        page.on("response", lambda r: responses.append({"method": r.request.method,
                "path": urlparse(r.url).path, "status": r.status}) if "/api/" in r.url else None)
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(args.base_url)
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(output / "initial.png"), full_page=True)
        page.get_by_role("button", name="Log in", exact=True).click()
        page.wait_for_load_state("networkidle")
        page.get_by_label("Username", exact=True).fill("guest_qa")
        page.get_by_label("Password", exact=True).fill("GuestBrowserOnly123!")
        with page.expect_response(lambda r: r.url.endswith("/auth/login")) as login:
            page.get_by_role("button", name="Sign in", exact=True).click()
        assert login.value.status == 200
        expect(page.get_by_role("button", name="Logout", exact=True)).to_be_visible()
        page.wait_for_load_state("networkidle")
        labs = page.request.get(origin + "/api/v1/labs").json()["items"]
        assert len(labs) == 1 and labs[0]["name"] == "LabRat Public Demo"
        assert labs[0]["role"] == "lab_member"
        expect(page.get_by_text("Guest Workspace", exact=True).first).to_be_visible(timeout=15000)
        page.screenshot(path=str(output / "projects.png"), full_page=True)
        inspect(page, "projects")
        for new_project in page.get_by_role("button", name="New project", exact=True).all():
            expect(new_project).to_be_disabled()
        expect(page.get_by_role("button", name="Delete project", exact=True)).to_be_disabled()
        page.get_by_role("button", name="Open", exact=True).click()
        expect(page.get_by_role("button", name="Manuscript", exact=True)).to_be_visible()
        page.wait_for_load_state("networkidle")
        page.screenshot(path=str(output / "workspace.png"), full_page=True)
        inspect(page, "workspace")
        expect(page.get_by_text("Read-only access", exact=False)).to_be_visible()
        for label in ["Ask", "Open Ask LabRat", "Edit profile", "Upload workbooks"]:
            for control in page.get_by_role("button", name=label, exact=True).all():
                expect(control).to_be_disabled()
        page.get_by_role("button", name="Manuscript", exact=True).click()
        page.wait_for_load_state("networkidle")
        page.get_by_role("button", name="File menu", exact=True).click()
        inspect(page, "manuscript_file_menu")
        for label in ["Save", "Add page", "Import workbook", "New project", "Profile"]:
            expect(page.get_by_role("button", name=label, exact=True)).to_be_disabled()
        page.get_by_role("button", name="File menu", exact=True).click()
        page.screenshot(path=str(output / "manuscript.png"), full_page=True)
        assert page.locator('.canvas[aria-readonly="true"][inert]').count() == 1
        assert "GuestBrowserOnly123!" not in page.evaluate("JSON.stringify(localStorage)")

        project_id = os.environ["LABRAT_QA_GUEST_PROJECT"]
        projects = page.request.get(origin + "/api/v1/projects").json()["items"]
        assert [project["id"] for project in projects] == [project_id]
        project = page.request.get(origin + "/api/v1/projects/" + project_id).json()["project"]
        assert sorted(project["capabilities"]) == ["export", "read"]
        for path in ["/projects", "/auth/invitations/redeem",
                     f"/projects/{project_id}/files", f"/projects/{project_id}/agent/runs"]:
            denied = page.request.post(origin + "/api/v1" + path, data={})
            assert denied.status == 403 and denied.json()["error"]["code"] == "public_guest_read_only"
        assert page.request.get(origin + "/api/v1/admin/users").status == 403

        page.reload()
        page.wait_for_load_state("networkidle")
        expect(page.get_by_text("Guest Workspace", exact=True).first).to_be_visible(timeout=15000)
        expect(page.get_by_role("button", name="Logout", exact=True)).to_be_visible()
        refreshed = page.request.get(origin + "/api/v1/auth/me").json()
        assert refreshed["user"]["isSuperAdmin"] is False
        assert len(refreshed["memberships"]) == 1
        with page.expect_response(lambda r: r.url.endswith("/auth/logout")) as logout:
            page.get_by_role("button", name="Logout", exact=True).click()
        assert logout.value.status == 200
        expect(page.get_by_role("button", name="Log in", exact=True)).to_be_visible()
        assert page.request.get(origin + "/api/v1/auth/me").status == 401
        assert not errors, errors
        assert all(r["path"].startswith("/api/v1/") for r in responses)
        assert not [r for r in responses if r["status"] >= 400
                    and not (r["path"] == "/api/v1/auth/me" and r["status"] == 401)], responses
        assert not [r for r in responses if r["method"] not in ["GET", "HEAD"]
                    and r["path"] not in ["/api/v1/auth/login", "/api/v1/auth/logout"]], responses
        print("PASS: Guest login, fixed scope, readonly overview/canvas, denied writes/AI/invitations, refresh and logout; no UI writes, old API calls or runtime errors.")
    finally:
        browser.close()
