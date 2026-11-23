#!/usr/bin/env python3
"""Check Markdown finding IDs, bold totals, and an optional JSON CVSS appendix.

Use a separate Markdown heading for each finding (for example, ## KDT-01).
Totals can use English or Indonesian labels such as "Total findings",
"Confirmed findings", "Total temuan", or "Jumlah temuan", or bold counts
such as **2 findings** or **2 temuan**. A report without IDs needs a zero total.
Only IDs passed to --merged are excluded. Matching heading titles produce
a warning so a reviewer can check for duplicate coverage.
"""

import argparse
from collections import defaultdict
from decimal import Decimal, InvalidOperation
import json
import math
from pathlib import Path
import re


FLAGS = re.IGNORECASE
TOTAL_LABEL = r"(?:(?:total|confirmed)\s+findings?|(?:total|jumlah)\s+temuan)"
FINDING_NOUN = r"(?:(?:(?:total|unique|confirmed)\s+)?findings?|temuan(?:\s+unik)?)"
TOTAL_PATTERNS = (
    re.compile(rf"\*\*\s*{TOTAL_LABEL}\s*[:=]\s*([^*]+?)\s*\*\*", FLAGS),
    re.compile(rf"\*\*\s*{TOTAL_LABEL}\s*:?\s*\*\*\s*(?:[:=|]\s*)?"
               r"(?:\*\*\s*([^*]+?)\s*\*\*|([^\s|*]+))", FLAGS),
    re.compile(rf"(?<![\w*]){TOTAL_LABEL}\s*[:=|]\s*\*\*\s*([^*]+?)\s*\*\*", FLAGS),
    re.compile(rf"\*\*\s*([+-]?[.,]?[0-9][^\s*]*)\s+{FINDING_NOUN}\s*\*\*", FLAGS),
)
EMPTY_TOTAL = re.compile(
    rf"\*\*\s*{TOTAL_LABEL}\s*(?:[:=]\s*\*\*|\*\*\s*[:=])\s*$"
    rf"|(?:^|\|)\s*\*\*\s*{TOTAL_LABEL}\s*:?\s*\*\*\s*\|\s*(?:\||$)",
    FLAGS,
)
TOTAL_VALUE = re.compile(rf"([0-9]+)(?:\s+{FINDING_NOUN})?\.?$", FLAGS)
DECIMAL_SCORE = re.compile(r"[+-]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?")
FENCE = re.compile(r"^ {0,3}(`{3,}|~{3,})(.*)$")
INDENTED_CODE = re.compile(r"^(?: {4}| {0,3}\t)")
INLINE_CODE = re.compile(r"(?<!`)(`+)(?!`).*?(?<!`)\1(?!`)")
ATX_HEADING = re.compile(r"^ {0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?[ \t]*$")
SETEXT_UNDERLINE = re.compile(r"^ {0,3}(?:=+|-+)[ \t]*$")

# Base equations and vector syntax from FIRST's specifications.
# https://www.first.org/cvss/v3.1/specification-document
# https://www.first.org/cvss/v3.0/specification-document
IMPACT = {"H": 0.56, "L": 0.22, "N": 0}
BASE = {
    "AV": {"N": 0.85, "A": 0.62, "L": 0.55, "P": 0.20},
    "AC": {"L": 0.77, "H": 0.44},
    "PR": {"N": 0.85, "L": 0.62, "H": 0.27},
    "UI": {"N": 0.85, "R": 0.62},
    "S": ("U", "C"),
    "C": IMPACT,
    "I": IMPACT,
    "A": IMPACT,
}
CHANGED_SCOPE_PRIVILEGES = {"N": 0.85, "L": 0.68, "H": 0.50}
OPTIONAL_METRICS = {
    "E": tuple("XHFPU"),
    "RL": tuple("XUWTO"),
    "RC": tuple("XCRU"),
    "CR": tuple("XHML"),
    "IR": tuple("XHML"),
    "AR": tuple("XHML"),
    **{f"M{metric}": [*values, "X"] for metric, values in BASE.items()},
}
METRIC_VALUES = {**BASE, **OPTIONAL_METRICS}


def roundup(score, version):
    if version == "CVSS:3.0":
        return math.ceil(score * 10) / 10
    # v3.1 Appendix A defines the intermediate rounding to five decimal places.
    return ((math.floor(score * 100000 + 0.5) + 9999) // 10000) / 10


def cvss_base_score(vector):
    if not isinstance(vector, str):
        raise ValueError("CVSS vector must be a string")
    version, *parts = vector.split("/")
    if version not in {"CVSS:3.0", "CVSS:3.1"}:
        raise ValueError("CVSS vector must specify version 3.0 or 3.1")
    metrics = {}
    for part in parts:
        key, _, value = part.partition(":")
        if key in metrics:
            raise ValueError(f"duplicate CVSS metric {key}")
        if key not in METRIC_VALUES or not value or value not in METRIC_VALUES[key]:
            raise ValueError(f"invalid CVSS metric {part!r}")
        metrics[key] = value
    missing = BASE.keys() - metrics.keys()
    if missing:
        raise ValueError(f"missing CVSS base metrics {', '.join(sorted(missing))}")

    changed_scope = metrics["S"] == "C"
    impact_basis = 1 - math.prod(1 - IMPACT[metrics[key]] for key in ("C", "I", "A"))
    impact = 6.42 * impact_basis
    if changed_scope:
        impact = 7.52 * (impact_basis - 0.029) - 3.25 * (impact_basis - 0.02) ** 15
    if impact <= 0:
        return 0.0

    privileges = CHANGED_SCOPE_PRIVILEGES if changed_scope else BASE["PR"]
    exploitability = (8.22 * BASE["AV"][metrics["AV"]] * BASE["AC"][metrics["AC"]]
                      * privileges[metrics["PR"]] * BASE["UI"][metrics["UI"]])
    scope_multiplier = 1.08 if changed_scope else 1
    return roundup(min(scope_multiplier * (impact + exploitability), 10), version)


def markdown_lines(markdown):
    """Yield lines outside code blocks and HTML comments."""
    fence = ""
    comment = False
    for line in markdown.splitlines():
        if fence:
            closing = FENCE.match(line)
            if closing and closing[1].startswith(fence) and not closing[2].strip():
                fence = ""
            yield ""
            continue

        if not comment and INDENTED_CODE.match(line):
            yield ""
            continue
        opening = FENCE.match(line) if not comment else None
        if opening and (opening[1][0] == "~" or "`" not in opening[2]):
            fence = opening[1]
            yield ""
            continue

        visible = []
        while line:
            marker = "-->" if comment else "<!--"
            before, found, line = line.partition(marker)
            if not comment:
                visible.append(before)
            if found:
                comment = not comment

        yield "".join(visible)


def validate_report(markdown, finding_id, merged, stale):
    errors = []
    warnings = []
    ids = set()
    headings = defaultdict(list)
    totals = set()
    previous_line = ""
    for line in markdown_lines(markdown):
        ids.update(match[0].upper() for match in finding_id.finditer(line))
        prose = INLINE_CODE.sub("", line)
        for pattern in TOTAL_PATTERNS:
            totals.update(next(group for group in match.groups() if group is not None).strip()
                          for match in pattern.finditer(prose))
        if EMPTY_TOTAL.search(prose):
            totals.add("")

        atx = ATX_HEADING.match(line)
        title = atx[1] if atx else ""
        if SETEXT_UNDERLINE.fullmatch(line) and not ATX_HEADING.match(previous_line):
            title = previous_line
        previous_line = line
        heading_ids = {match[0].upper() for match in finding_id.finditer(title)} - merged
        if len(heading_ids) == 1:
            headings[heading_ids.pop()].append(title)
        elif heading_ids:
            errors.append(f"distinct headings required for {', '.join(sorted(heading_ids))}")

    active = ids - merged
    expected_total = str(len(active))
    has_zero_total = False
    for total in sorted(totals):
        number = TOTAL_VALUE.fullmatch(total)
        if number is None:
            errors.append(f"invalid finding total {total!r}")
            continue
        claimed = number[1].lstrip("0") or "0"
        has_zero_total |= claimed == "0"
        if claimed != expected_total:
            errors.append(f"claimed finding total {claimed} does not match {expected_total} active IDs")

    if not active and not has_zero_total:
        errors.append("no active finding IDs or explicit zero finding total")

    titles = defaultdict(list)
    for identifier in sorted(active):
        entries = headings[identifier]
        if len(entries) != 1:
            errors.append(f"{identifier} needs exactly one heading, found {len(entries)}")
            continue
        title = finding_id.sub("", entries[0]).strip(" \t*`_[]:–—-")
        normalized_title = " ".join(title.casefold().split())
        if normalized_title:
            titles[normalized_title].append(identifier)
    for identifiers in titles.values():
        if len(identifiers) > 1:
            warnings.append(f"possible duplicate coverage (matching headings): {', '.join(identifiers)}")

    folded = markdown.casefold()
    for phrase in stale:
        if phrase.casefold() in folded:
            errors.append(f"stale phrase present: {phrase!r}")
    return active, errors, warnings


def unique_json_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise ValueError(f"duplicate JSON field {key!r}")
        obj[key] = value
    return obj


def reject_json_constant(value):
    raise ValueError(f"{value} is not a JSON number")


def appendix_base_score(value):
    if isinstance(value, str) and DECIMAL_SCORE.fullmatch(value.strip()):
        try:
            value = Decimal(value.strip())
        except InvalidOperation:
            return None
    if type(value) is int and 0 <= value <= 10:
        return value
    if isinstance(value, Decimal) and value.is_finite() and 0 <= value <= 10:
        return value
    return None


def appendix_errors(path, finding_id, active):
    try:
        rows = json.loads(path.read_text(encoding="utf-8-sig"), parse_float=Decimal,
                          parse_constant=reject_json_constant, object_pairs_hook=unique_json_object)
    except (OSError, ValueError, InvalidOperation, RecursionError) as error:
        return [f"could not read appendix: {error}"]
    if not isinstance(rows, list):
        return ["appendix must be a JSON list"]

    errors = []
    seen = set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            errors.append(f"appendix row {index} must be a JSON object")
            continue
        identifier = row.get("id")
        if not isinstance(identifier, str) or not finding_id.fullmatch(identifier):
            errors.append(f"appendix row {index} needs a valid finding ID")
            continue
        identifier = identifier.upper()
        if identifier in seen:
            errors.append(f"duplicate appendix row for {identifier}")
        seen.add(identifier)

        score = appendix_base_score(row.get("cvss"))
        if score is None:
            errors.append(f"{identifier}: CVSS base score (cvss) must be a finite decimal from 0 to 10")
        try:
            expected = cvss_base_score(row.get("vector"))
        except ValueError as error:
            errors.append(f"{identifier}: {error}")
            continue
        if score is not None and score != Decimal(str(expected)):
            errors.append(f"{identifier}: CVSS base score {score} does not match vector base score {expected}")

    for identifier in sorted(active - seen):
        errors.append(f"missing appendix row for {identifier}")
    for identifier in sorted(seen - active):
        errors.append(f"unexpected appendix row for {identifier}")
    return errors


def main():
    summary, usage = __doc__.split("\n\n", 1)
    parser = argparse.ArgumentParser(description=summary, epilog=usage)
    parser.add_argument("report", type=Path, help="Markdown report to check")
    parser.add_argument("--prefix", default="KDT", help="finding ID prefix (default: KDT)")
    parser.add_argument("--stale", nargs="+", action="extend", default=[],
                        help="case-insensitive phrases to reject")
    parser.add_argument("--merged", nargs="+", action="extend", default=[],
                        help="retired finding IDs to exclude")
    parser.add_argument("--appendix", type=Path,
                        help="JSON list with id, cvss (base score), and vector (CVSS v3.0 or v3.1)")
    args = parser.parse_args()

    errors = []
    warnings = []
    prefix = args.prefix.strip().rstrip("-")
    finding_id = re.compile(rf"(?<![\w-])(?ai:{re.escape(prefix)})-[0-9]+(?![\w-])")
    merged = {identifier.strip() for identifier in args.merged}
    if not re.fullmatch(r"[a-zA-Z0-9]+(?:-[a-zA-Z0-9]+)*", prefix):
        errors.append("--prefix must contain letters or digits separated by hyphens")
    if any(not finding_id.fullmatch(identifier) for identifier in merged):
        errors.append("--merged must contain finding IDs matching --prefix")
    if any(not phrase.strip() for phrase in args.stale):
        errors.append("--stale requires a nonempty phrase")

    if not errors:
        try:
            markdown = args.report.read_text(encoding="utf-8-sig")
        except (OSError, ValueError) as error:
            errors.append(f"could not read report: {error}")
        else:
            active, errors, warnings = validate_report(
                markdown, finding_id, {identifier.upper() for identifier in merged}, args.stale,
            )
            if args.appendix:
                errors.extend(appendix_errors(args.appendix, finding_id, active))

    for warning in warnings:
        print(f"WARN: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    print("FAIL" if errors else "PASS")
    return int(bool(errors))


if __name__ == "__main__":
    raise SystemExit(main())
