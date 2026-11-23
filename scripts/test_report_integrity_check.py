import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

from report_integrity_check import cvss_base_score


SCRIPT = Path(__file__).with_name("report_integrity_check.py")
FINDING = "## KDT-01 — Access policy\n"
VECTOR = "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:N/A:N"
ROW = {"id": "KDT-01", "cvss": 7.5, "vector": VECTOR}


class ReportIntegrityTests(unittest.TestCase):
    def setUp(self):
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.report = Path(folder.name) / "report.md"
        self.appendix = Path(folder.name) / "appendix.json"

    def check(self, markdown, *options, appendix=None, error=None):
        self.report.write_text(markdown, encoding="utf-8")
        if appendix is not None:
            raw = appendix if isinstance(appendix, str) else json.dumps(appendix)
            self.appendix.write_text(raw, encoding="utf-8")
            options += ("--appendix", str(self.appendix))
        result = subprocess.run(
            [sys.executable, str(SCRIPT), str(self.report), *options],
            capture_output=True, text=True, check=False,
        )
        self.assertEqual(result.returncode, int(error is not None), result.stdout + result.stderr)
        self.assertEqual(result.stderr, "")
        self.assertEqual(result.stdout.splitlines()[-1], "FAIL" if error else "PASS")
        if error:
            self.assertIn(error, result.stdout)
        return result.stdout

    def test_english_and_indonesian_totals(self):
        claims = (
            "**Total findings: 1**", "**Confirmed findings**: 1.",
            "Confirmed findings: **1**", "**1 unique finding**",
            "**Jumlah temuan:** **1**", "**1 temuan unik**", "Total Temuan: **1**",
            "| **Total findings** | 1 |",
        )
        for claim in claims:
            with self.subTest(claim=claim):
                self.check(f"{claim}\n\n{FINDING}\nSee `kdt-01` again.")

    def test_every_recognized_total_must_agree(self):
        self.check("**1 finding** and **2 temuan**\n" + FINDING, error="finding total 2")
        self.check("**Total findings: 2**\n**Jumlah temuan:** **1**\n" + FINDING,
                   error="finding total 2")
        self.check("**Total findings: pending**\n" + FINDING, error="invalid finding total")
        self.check("Total temuan: **1.5**\n" + FINDING, error="invalid finding total")
        self.check("**2.5 findings**\n" + FINDING, error="invalid finding total")
        self.check("**Total findings:**\n" + FINDING, error="invalid finding total")
        self.check("| **Total findings** | |\n" + FINDING, error="invalid finding total")

    def test_zero_requires_an_explicit_total(self):
        for markdown in ("", "# Draft\nText only", "`**0 findings**`", "<!-- **0 findings** -->",
                         "    **0 findings**", "\t**0 findings**"):
            with self.subTest(markdown=markdown):
                self.check(markdown, error="no active finding IDs or explicit zero finding total")
        self.check("# Report\n\n**0 findings**", appendix=[])
        self.check("**0 temuan**\n" + FINDING, error="finding total 0")

    def test_headings_for_each_active_id(self):
        self.check(FINDING + "\nSee also KDT-02.", error="KDT-02 needs exactly one heading, found 0")
        self.check(FINDING + FINDING, error="KDT-01 needs exactly one heading, found 2")
        self.check("## KDT-01 and KDT-02", error="distinct headings required")
        self.check("KDT-01 — Access policy\n=======================\n")
        self.check("See KDT-01.\n\n    KDT-01 — Example\n---", error="found 0")
        self.check("See KDT-01.\n\n```markdown\n" + FINDING + "```", error="found 0")

    def test_examples_and_comments_do_not_count_as_findings(self):
        self.check(
            "**1 finding**\n"
            "<!--\n## KDT-02\n**4 findings**\n-->\n"
            "````markdown <!--\n## KDT-03\n```\n## KDT-04\n````\n"
            + FINDING
        )

    def test_custom_prefix_and_explicit_merged_ids(self):
        markdown = "**1 finding**\n## LAB-01 — Access policy\nFormerly LAB-02 and LAB-03."
        self.check(markdown, "--prefix", "lab", "--merged", "lab-02", "LAB-03")
        self.check(markdown, "--prefix", "LAB", "--merged", "LAB-02", "--merged", "LAB-03")
        self.check(markdown, "--prefix", "LAB", error="LAB-02 needs exactly one heading")
        self.check(markdown, "--prefix", "LAB", "--merged", "KDT-01", error="must contain finding IDs")

    def test_stale_phrases_are_literal_and_case_insensitive(self):
        markdown = FINDING + "\nKnown OLD [draft] text."
        self.check(markdown, "--stale", "some other phrase", "old [Draft]",
                   error="stale phrase present")
        self.check(markdown, "--stale", "some other phrase", "--stale", "old [Draft]",
                   error="stale phrase present")
        self.check(markdown, "--stale", "old (draft)")
        self.check(markdown, "--stale", "", error="nonempty phrase")

    def test_duplicate_title_is_a_warning(self):
        result = self.check(FINDING + "## KDT-02: access  POLICY")
        self.assertIn("WARN: possible duplicate coverage", result)

    def test_valid_appendix_fields_and_case_insensitive_id(self):
        self.check(FINDING, appendix=[ROW])
        self.check(FINDING, appendix=[dict(ROW, id="kdt-01", cvss="7.5")])
        self.check(FINDING + "\nFormerly KDT-02.", "--merged", "KDT-02", appendix=[ROW])

    def test_appendix_requires_exact_coverage(self):
        self.check(FINDING, appendix=[], error="missing appendix row for KDT-01")
        self.check(FINDING, appendix=[ROW, dict(ROW, id="kdt-01")],
                   error="duplicate appendix row for KDT-01")
        self.check(FINDING, appendix=[ROW, dict(ROW, id="KDT-02")],
                   error="unexpected appendix row for KDT-02")
        self.check(FINDING, appendix=[dict(ROW, id=1)], error="valid finding ID")

    def test_appendix_rejects_missing_and_malformed_scores_and_vectors(self):
        self.check(FINDING, appendix=[{"id": "KDT-01", "vector": VECTOR}], error="CVSS base score")
        self.check(FINDING, appendix=[{"id": "KDT-01", "cvss": 7.5}], error="CVSS vector")
        for score in (None, True, "pending", "NaN", "inf", -1, 10.1):
            with self.subTest(score=score):
                self.check(FINDING, appendix=[dict(ROW, cvss=score)], error="must be a finite decimal")
        for vector in (None, 7.5, "", "CVSS:4.0", VECTOR + "/PR:L", VECTOR.replace("/S:U", "/S:UC"),
                       VECTOR.replace("/S:U", ""), VECTOR + "/UNKNOWN:X"):
            with self.subTest(vector=vector):
                self.check(FINDING, appendix=[dict(ROW, vector=vector)], error="CVSS")
        self.check(FINDING, appendix=[dict(ROW, cvss=7.4)], error="does not match vector base score 7.5")
        self.check(FINDING, appendix=[dict(ROW, cvss=7.500000000000001)],
                   error="does not match vector base score 7.5")

    def test_appendix_requires_base_score_even_with_optional_metrics(self):
        vector = VECTOR + "/MC:N/E:U/RL:O/RC:U"
        self.check(FINDING, appendix=[dict(ROW, vector=vector)])
        self.check(FINDING, appendix=[dict(ROW, vector=vector, cvss=0)],
                   error="does not match vector base score 7.5")
        self.check(FINDING, appendix=[dict(ROW, vector=VECTOR + "/MC:Z")],
                   error="invalid CVSS metric 'MC:Z'")

    def test_malformed_appendix_and_input_files(self):
        self.check(FINDING, appendix="{", error="could not read appendix")
        self.check(FINDING, appendix={}, error="must be a JSON list")
        self.check(FINDING, appendix=[None], error="must be a JSON object")
        self.check(FINDING, appendix='[{"id":"KDT-01","id":"KDT-02"}]', error="duplicate JSON field")
        self.check(FINDING, appendix=[dict(ROW, cvss=float("nan"))], error="NaN is not a JSON number")
        self.check(FINDING, "--appendix", str(self.appendix.with_name("missing.json")),
                   error="could not read appendix")


class CVSSScoreTests(unittest.TestCase):
    def test_published_base_scores(self):
        # FIRST v3.1 User Guide §3.1 and v3.1 Examples §3 and §5.
        examples = (
            (VECTOR, 7.5),
            ("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:L/I:L/A:N", 6.4),
            ("CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:C/C:H/I:H/A:H", 9.9),
            ("CVSS:3.0/AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:H/A:H", 7.8),
        )
        for vector, score in examples:
            with self.subTest(vector=vector):
                self.assertEqual(cvss_base_score(vector), score)

    def test_vector_accepts_any_order_and_not_defined_metrics(self):
        vector = "CVSS:3.1/C:H/S:U/PR:N/AV:N/I:N/A:N/UI:N/AC:L/E:X/CR:X"
        self.assertEqual(cvss_base_score(vector), 7.5)
        self.assertEqual(cvss_base_score(vector.replace("/C:H", "/C:N")), 0.0)


if __name__ == "__main__":
    unittest.main()
