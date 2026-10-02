"""Exercise real file replacement and rejection paths on Linux."""
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("docling_env", Path(__file__).with_name("docling-env.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class EnvironmentTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.env = self.root / "backend.env"
        self.key = self.root / "docling.key"
        self.original = "DATABASE_URL=unchanged\nDEEPSEEK_API_KEY=unchanged\n# original comment\n"
        self.env.write_text(self.original)
        self.env.chmod(0o640)
        self.key.write_text("synthetic-parser-key-1234567890")

    def test_atomic_update_and_idempotence_preserve_metadata_and_provider_values(self):
        before = self.env.stat()
        module.apply(self.env, self.key)
        first = self.env.read_text()
        module.apply(self.env, self.key)
        self.assertEqual(first, self.env.read_text())
        self.assertTrue(first.startswith(self.original))
        self.assertIn("LABRAT_DOCLING_ENDPOINT=http://127.0.0.1:5059\n", first)
        self.assertEqual(first.count("LABRAT_DOCLING_API_KEY="), 1)
        after = self.env.stat()
        self.assertEqual((before.st_uid, before.st_gid, before.st_mode),
                         (after.st_uid, after.st_gid, after.st_mode))

    def test_duplicate_settings_leave_original_untouched(self):
        content = self.original + "LABRAT_DOCLING_API_KEY=old\nexport LABRAT_DOCLING_API_KEY=second\n"
        self.env.write_text(content)
        with self.assertRaises(ValueError):
            module.apply(self.env, self.key)
        self.assertEqual(self.env.read_text(), content)

    def test_invalid_key_leaves_original_untouched(self):
        self.key.write_text("invalid secret\n")
        with self.assertRaises(ValueError):
            module.apply(self.env, self.key)
        self.assertEqual(self.env.read_text(), self.original)

    def test_symlink_is_rejected(self):
        link = self.root / "linked.env"
        os.symlink(self.env, link)
        with self.assertRaises(ValueError):
            module.apply(link, self.key)
        self.assertEqual(self.env.read_text(), self.original)


if __name__ == "__main__":
    unittest.main()
