#!/usr/bin/env python3
"""
Convert the MHL billing worksheet (e.g. "MHL CY2027 Billing.xlsx") into:
  1. a JSON price list   (shared by unit tests and the pilot)
  2. a T-SQL seed script (db/110_seed_price_list_<name>.sql)
  3. a findings report   (problems a billing administrator should review)

Usage:
  python convert_price_list.py "MHL CY2027 Billing.xlsx" --name CY2027 \
      --effective-from 2027-01-01 --out-json ../../src/SeedData/price-list-CY2027.json \
      --out-sql ../../db/110_seed_price_list_CY2027.sql --out-report ../../docs/price-list-review-CY2027.md

Requires: openpyxl  (pip install openpyxl)

The worksheet layout this expects (as of the CY2027 file):
  column A = charge code or section name, B = description, G = unit price.
  Section header rows have a section name in column A (NECRO, BLOOD, TRIM/EMBED, MICROTOMY,
  STAIN, IMAGE, PATH). Subtotal rows have no code in column A.
"""
import argparse, json, re, sys, datetime
from collections import OrderedDict

try:
    import openpyxl
except ImportError:
    sys.exit("openpyxl is required: pip install openpyxl")

CODE_RE = re.compile(r"^[A-Z]{2}\d{6}$")
SECTIONS = OrderedDict([
    # worksheet label : (section code, display name, default tracking area)
    ("NECRO",      ("NECRO",      "Necropsy",             "NECRO")),
    ("BLOOD",      ("BLOOD",      "Blood / clinical path", "BLOOD")),
    ("TRIM/EMBED", ("TRIM_EMBED", "Trim / embed",          "EMBED")),
    ("MICROTOMY",  ("MICROTOMY",  "Microtomy",             "MICRO")),
    ("STAIN",      ("STAIN",      "Staining / molecular",  "STAIN")),
    ("IMAGE",      ("IMAGE",      "Imaging",               "IMAGE")),
    ("PATH",       ("PATH",       "Pathology",             "PATHO")),
])

UNIT_PATTERNS = [
    (r"per\s*1/4\s*hr|per\s*qtr\s*hr", "quarter hour"),
    (r"per two \(2\) slides|\(2 slides\)", "pair of slides"),
    (r"per glass slide|per slide|per cryostat slide|from slide|first slide|coverslip slide", "slide"),
    (r"per initial section", "initial section"),
    (r"per addn section", "additional section"),
    (r"per animal", "animal"),
    (r"per tube", "tube"),
    (r"per block|re-embed", "block"),
    (r"per sample", "sample"),
    (r"per pellet", "pellet"),
    (r"x units", "dollar unit"),
]

def unit_of(desc: str) -> str:
    d = desc.lower()
    for pat, unit in UNIT_PATTERNS:
        if re.search(pat, d):
            return unit
    if d.startswith("necropsy") or "embryo collect" in d or "terminal bleed" in d:
        return "animal"
    return "each"

def requires_description(desc: str) -> bool:
    d = desc.lower()
    return "(define)" in d or "x units" in d

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("xlsx")
    ap.add_argument("--name", required=True, help="Price list name, e.g. CY2027")
    ap.add_argument("--effective-from", required=True, help="YYYY-MM-DD (confirm contract-year start)")
    ap.add_argument("--out-json"); ap.add_argument("--out-sql"); ap.add_argument("--out-report")
    a = ap.parse_args()

    wb = openpyxl.load_workbook(a.xlsx, data_only=False)
    ws = wb.worksheets[0]
    section = None
    rows, notes, findings, price_headers = [], [], [], {}
    for r in range(1, ws.max_row + 1):
        av = ws.cell(r, 1).value
        a_txt = str(av).strip() if av is not None else ""
        b_txt = str(ws.cell(r, 2).value or "").strip()
        g = ws.cell(r, 7).value
        if a_txt.upper() in SECTIONS:
            section = a_txt.upper()
            if isinstance(g, str) and "price" in g.lower():
                price_headers[section] = g
            continue
        if CODE_RE.match(a_txt) and section:
            price = None
            if isinstance(g, (int, float)):
                price = round(float(g), 2)
            elif isinstance(g, str) and g.strip():
                try: price = round(float(g.replace("$", "").replace(",", "")), 2)
                except ValueError: findings.append(f"Row {r}: price '{g}' for {a_txt} is not a number")
            rows.append({"row": r, "code": a_txt, "description": b_txt, "price": price, "section": section})
            continue
        if b_txt.lower().startswith("note"):
            notes.append(b_txt)
        if isinstance(g, str) and "price" in g.lower() and section:
            price_headers[section] = g

    # Build unique charge codes; a code may appear in several sections
    codes = OrderedDict()
    for x in rows:
        c = codes.get(x["code"])
        if c is None:
            codes[x["code"]] = c = {
                "code": x["code"], "lab": x["code"][:2], "description": x["description"],
                "unit": unit_of(x["description"]), "requiresDescription": requires_description(x["description"]),
                "price": x["price"], "sections": [], "worksheetRows": [],
            }
        else:
            if x["price"] != c["price"]:
                findings.append(f"{x['code']} has different prices on rows {c['worksheetRows']} and {x['row']} "
                                f"({c['price']} vs {x['price']}); the first is used")
            if x["description"].split(",")[0].lower() != c["description"].split(",")[0].lower():
                c.setdefault("altDescriptions", []).append(x["description"])
        c["sections"].append(SECTIONS[x["section"]][0])
        c["worksheetRows"].append(x["row"])

    # A code shared by several sections may carry a section prefix ("NECRO Labor", "BLOOD Labor").
    # Use the common part of the descriptions so the code reads correctly in every section.
    for c in codes.values():
        alts = c.get("altDescriptions")
        if alts:
            descs = [c["description"]] + alts
            rev = [d_[::-1].lower() for d_ in descs]
            n = 0
            while all(len(r_) > n and r_[n] == rev[0][n] for r_ in rev):
                n += 1
            common = c["description"][len(c["description"]) - n:].strip(" ,")
            if len(common) >= 8:
                c["worksheetDescriptions"] = descs
                c["description"] = common[0].upper() + common[1:]
                c.pop("altDescriptions")

    for c in codes.values():
        if c["unit"] == "each":
            findings.append(f"{c['code']} ({c['description']}): the unit of charge is not stated in the description; confirm it")
    for c in codes.values():
        if c["price"] is None:
            findings.append(f"{c['code']} ({c['description']}) has no price on row(s) {c['worksheetRows']}")
    distinct_headers = sorted(set(price_headers.values()))
    if len(distinct_headers) > 1 or any(a.name not in h for h in distinct_headers):
        findings.append(f"Price column headers disagree with the list name {a.name}: " +
                        "; ".join(f"{k}: '{v}'" for k, v in price_headers.items()))

    if not any(c["code"].endswith("009050") for c in codes.values()):
        findings.append("No STAT surcharge code (legacy PHL used <lab>009050, e.g. HP009050) appears in this list. "
                        "Confirm whether STAT surcharges are still charged; the LIMS rule is disabled until confirmed")
    if not any(("xenium" in c["description"].lower()) or ("spatial" in c["description"].lower()) for c in codes.values()):
        findings.append("No charge code mentions 10x Xenium or spatial work, although the lab offers it. "
                        "Confirm how Xenium runs are billed (a code to add, or billed outside this list)")
    if any("wsi analysis" in n.lower() for n in notes):
        findings.append("The worksheet note on WSI analysis (4 labor units per 6 slide images; each multiplex target counts as an image) "
                        "does not say which labor code applies (HP009002 or PA001004) or how partial groups of 6 are rounded")

    out = {
        "name": a.name, "effectiveFrom": a.effective_from, "status": "DRAFT",
        "source": a.xlsx.split("/")[-1].split("\\")[-1],
        "generatedAt": datetime.date.today().isoformat(),
        "sections": [{"code": v[0], "name": v[1], "defaultArea": v[2], "worksheetLabel": k} for k, v in SECTIONS.items()],
        "items": list(codes.values()), "notes": notes, "findings": findings,
    }
    if a.out_json:
        with open(a.out_json, "w", encoding="utf-8") as f: json.dump(out, f, indent=2)
    if a.out_sql:
        write_sql(out, a.out_sql)
    if a.out_report:
        write_report(out, rows, price_headers, a.out_report)
    print(f"{len(rows)} worksheet lines, {len(codes)} unique charge codes, {len(findings)} findings")

def q(s):  # T-SQL string literal
    return "N'" + str(s).replace("'", "''") + "'"

def write_sql(pl, path):
    L = []
    L.append(f"-- Generated by tools/price-list-import/convert_price_list.py from {pl['source']} on {pl['generatedAt']}.")
    L.append("-- Do not edit by hand; re-run the converter. Loads the price list as DRAFT; a billing")
    L.append("-- administrator approves it in the application (or by setting Status = 'APPROVED').")
    L.append("SET NOCOUNT ON;\nSET XACT_ABORT ON;\nBEGIN TRANSACTION;\n")
    L.append("-- 1. Charge codes (insert new ones; update description/unit of existing ones)")
    for c in pl["items"]:
        L.append("MERGE billing.ChargeCode AS t USING (SELECT {code} AS ChargeCode, {lab} AS LabCode, {d} AS Description, {u} AS UnitOfMeasure, {rd} AS RequiresDescription) AS s "
                 "ON t.ChargeCode = s.ChargeCode "
                 "WHEN MATCHED THEN UPDATE SET Description = s.Description, UnitOfMeasure = s.UnitOfMeasure, RequiresDescription = s.RequiresDescription, IsActive = 1 "
                 "WHEN NOT MATCHED THEN INSERT (ChargeCode, LabCode, Description, UnitOfMeasure, RequiresDescription, IsActive) VALUES (s.ChargeCode, s.LabCode, s.Description, s.UnitOfMeasure, s.RequiresDescription, 1);"
                 .format(code=q(c["code"]), lab=q(c["lab"]), d=q(c["description"]), u=q(c["unit"]), rd=1 if c["requiresDescription"] else 0))
    L.append("\n-- 2. Section membership (a code can belong to several sections)")
    L.append("DELETE FROM billing.ChargeCodeSection WHERE ChargeCode IN (" + ", ".join(q(c["code"]) for c in pl["items"]) + ");")
    for c in pl["items"]:
        for i, s in enumerate(c["sections"]):
            L.append(f"INSERT INTO billing.ChargeCodeSection (ChargeCode, SectionCode, SortOrder) VALUES ({q(c['code'])}, {q(s)}, {c['worksheetRows'][i]});")
    L.append(f"\n-- 3. Price list header (DRAFT until approved). Confirm the effective date: {pl['effectiveFrom']}")
    L.append(f"DECLARE @PriceListId int = (SELECT PriceListId FROM billing.PriceList WHERE Name = {q(pl['name'])});")
    L.append("IF @PriceListId IS NULL BEGIN")
    L.append(f"    INSERT INTO billing.PriceList (Name, EffectiveFrom, Status, SourceFile) VALUES ({q(pl['name'])}, '{pl['effectiveFrom']}', N'DRAFT', {q(pl['source'])});")
    L.append("    SET @PriceListId = SCOPE_IDENTITY();")
    L.append("END")
    L.append("ELSE IF EXISTS (SELECT 1 FROM billing.PriceList WHERE PriceListId = @PriceListId AND Status <> N'DRAFT')")
    L.append(f"    THROW 50001, N'Price list {pl['name']} is no longer DRAFT; create a new price list instead of reloading.', 1;")
    L.append("\n-- 4. Prices (NULL = not priced; the application refuses to charge an unpriced code)")
    L.append("DELETE FROM billing.PriceListItem WHERE PriceListId = @PriceListId;")
    for c in pl["items"]:
        p = "NULL" if c["price"] is None else f"{c['price']:.2f}"
        L.append(f"INSERT INTO billing.PriceListItem (PriceListId, ChargeCode, UnitPrice) VALUES (@PriceListId, {q(c['code'])}, {p});")
    L.append("\nCOMMIT TRANSACTION;")
    L.append(f"PRINT N'Loaded {len(pl['items'])} charge codes into price list {pl['name']} (DRAFT).';")
    L.append("GO")
    with open(path, "w", encoding="utf-8") as f: f.write("\n".join(L) + "\n")

def write_report(pl, rows, headers, path):
    L = [f"# Price list review: {pl['name']}", "",
         f"Source: `{pl['source']}` (converted {pl['generatedAt']}). Loaded as **DRAFT**; a billing administrator should resolve the items below and approve it.", "",
         f"The worksheet has {len(rows)} priced lines in {len(pl['sections'])} sections, which reduce to {len(pl['items'])} unique charge codes "
         "(the labor, reagent and OCT block codes appear in more than one section).", "", "## Findings to resolve", ""]
    for i, f in enumerate(pl["findings"], 1):
        L.append(f"{i}. {f}")
    L += ["", "## Notes carried over from the worksheet", ""] + [f"- {n}" for n in pl["notes"]]
    L += ["", "## Charge codes", "", "| Code | Description | Unit | Price | Sections | Needs description |", "|---|---|---|---:|---|---|"]
    for c in pl["items"]:
        price = "**not set**" if c["price"] is None else f"${c['price']:,.2f}"
        L.append(f"| {c['code']} | {c['description']} | {c['unit']} | {price} | {', '.join(c['sections'])} | {'yes' if c['requiresDescription'] else ''} |")
    with open(path, "w", encoding="utf-8") as f: f.write("\n".join(L) + "\n")

if __name__ == "__main__":
    main()
