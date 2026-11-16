"""Writes the sample files for the pilot's Outside sources page (pilot/samples/outside-sources).

They have the layout of the real downloads but MADE-UP VALUES: a few real gene symbols, Ensembl IDs and UniProt
accessions so the links work, with invented reliability, tissue levels and RRIDs (AB_999xxxx, beyond any real RRID).
Do not use them as reference data. Run: python tools/outside-samples/make_outside_samples.py
"""
import csv
import io
import os
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', '..', 'pilot', 'samples', 'outside-sources')

# The real proteinatlas.tsv has about a hundred columns; these are the ones the LIMS reads plus a few it ignores.
SUMMARY_HEADER = ['Gene', 'Gene synonym', 'Ensembl', 'Gene description', 'Uniprot', 'Chromosome', 'Position', 'Protein class',
                  'Evidence', 'HPA evidence', 'RNA tissue specificity', 'RNA tissue distribution', 'RNA tissue specificity score',
                  'RNA tissue specific nTPM', 'Antibody', 'Reliability (IH)', 'Reliability (Mouse Brain)', 'Reliability (IF)',
                  'Subcellular location', 'Antibody RRID']
GENES = [
    # symbol, synonyms, Ensembl, description, UniProt, IH reliability, IF reliability, RNA specificity, nTPM, antibodies
    ('MKI67', 'KIA, MIB-, MIB-1, PPP1R105, Ki-67', 'ENSG00000148773', 'Marker of proliferation Ki-67', 'P46013', 'Enhanced', 'Enhanced',
     'Tissue enhanced', 'lymphoid tissue: 40.0', ['HPA999001', 'CAB999002']),
    ('PTPRC', 'B220, CD45, CD45R, L-CA, LCA, T200', 'ENSG00000081237', 'Protein tyrosine phosphatase receptor type C', 'P08575', 'Enhanced', '',
     'Tissue enhanced', 'bone marrow: 300.0;lymphoid tissue: 500.0', ['HPA999003']),
    ('CD8A', 'CD8, Leu2', 'ENSG00000153563', 'CD8 subunit alpha', 'P01732', 'Enhanced', '', 'Tissue enriched', 'lymphoid tissue: 90.0', ['HPA999004', 'CAB999005']),
    ('CD3E', 'T3E, TCRE', 'ENSG00000198851', 'CD3 epsilon subunit of T-cell receptor complex', 'P07766', 'Supported', '', 'Tissue enriched',
     'lymphoid tissue: 120.0', ['CAB999006']),
    ('ADGRE1', 'EMR1, TM7LN3, F4/80', 'ENSG00000174837', 'Adhesion G protein-coupled receptor E1', 'Q14246', 'Approved', '', 'Tissue enhanced',
     'bone marrow: 20.0', ['HPA999007']),
    ('CDH1', 'Arc-1, CD324, CDHE, UVO, E-cadherin', 'ENSG00000039068', 'Cadherin 1', 'P12830', 'Enhanced', 'Supported', 'Low tissue specificity', '',
     ['HPA999008', 'CAB999009']),
    ('ACTA2', 'AAT6, ACTSA', 'ENSG00000107796', 'Actin alpha 2, smooth muscle', 'P62736', 'Enhanced', '', 'Tissue enhanced', 'smooth muscle: 3000.0', ['HPA999010']),
    ('PECAM1', 'CD31', 'ENSG00000261371', 'Platelet and endothelial cell adhesion molecule 1', 'P16284', 'Enhanced', '', 'Low tissue specificity', '', ['HPA999012']),
    ('AIF1', 'AIF-1, IBA1, IRT-1', 'ENSG00000204472', 'Allograft inflammatory factor 1', 'P55008', 'Supported', '', 'Tissue enhanced', 'lymphoid tissue: 300.0', ['HPA999013']),
    # The catalog's ALDOB protocol uses this HPA antibody, so the sample shows an RRID suggested from the HPA.
    ('ALDOB', 'ALDB', 'ENSG00000136872', 'Aldolase, fructose-bisphosphate B', 'P05062', 'Enhanced', '', 'Group enriched', 'intestine: 900.0;kidney: 1500.0;liver: 6000.0',
     ['HPA002198']),
    # Not in the catalog: the import leaves these out.
    ('TTN', 'CMH9, CMPD4, TMD, connectin', 'ENSG00000155657', 'Titin', 'Q8WZ42', 'Supported', '', 'Group enriched', 'heart muscle: 80.0;skeletal muscle: 120.0', ['HPA999014']),
    ('MIB1', 'DIP-1, MIB, ZZANK2', 'ENSG00000101752', 'MIB E3 ubiquitin protein ligase 1', 'Q86YT6', 'Approved', '', 'Low tissue specificity', '', ['HPA999015']),
]

# Gene (Ensembl), Gene name, Tissue, Cell type, Level, Reliability: the layout of normal_tissue.tsv.
TISSUE = [
    ('MKI67', [('lymph node', 'germinal center cells', 'High'), ('tonsil', 'germinal center cells', 'High'), ('colon', 'glandular cells', 'Medium'),
               ('skin', 'basal layer keratinocytes', 'Low'), ('liver', 'hepatocytes', 'Not detected')], 'Enhanced'),
    ('PTPRC', [('spleen', 'cells in red pulp', 'High'), ('spleen', 'cells in white pulp', 'High'), ('lymph node', 'non-germinal center cells', 'High'),
               ('lung', 'macrophages', 'Medium'), ('liver', 'hepatocytes', 'Not detected')], 'Enhanced'),
    ('CD8A', [('lymph node', 'non-germinal center cells', 'High'), ('spleen', 'cells in white pulp', 'Medium'), ('tonsil', 'non-germinal center cells', 'High')], 'Enhanced'),
    ('ADGRE1', [('bone marrow', 'hematopoietic cells', 'Medium'), ('lung', 'macrophages', 'Low')], 'Approved'),
    ('CDH1', [('colon', 'glandular cells', 'High'), ('breast', 'glandular cells', 'High'), ('skin', 'squamous epithelial cells', 'Medium'), ('heart muscle', 'cardiomyocytes', 'Not detected')], 'Enhanced'),
    ('ALDOB', [('liver', 'hepatocytes', 'High'), ('kidney', 'cells in tubules', 'High'), ('small intestine', 'glandular cells', 'Medium')], 'Enhanced'),
    ('TTN', [('heart muscle', 'cardiomyocytes', 'High'), ('skeletal muscle', 'myocytes', 'High')], 'Supported'),
]

# The registry download, with the headers the LIMS looks for. RRIDs AB_999xxxx are made up.
REGISTRY_HEADER = ['ab_id', 'proper_citation', 'ab_name', 'ab_target', 'clone_id', 'vendor', 'catalog_num']
REGISTRY = [
    ('9990101', '(Abcam Cat# ab101500, RRID:AB_9990101)', 'Anti-CD8 antibody (sample record)', 'CD8', 'SAMPLE-1', 'Abcam', 'ab101500'),
    ('9990102', '(Cell Signaling Technology Cat# 9027S, RRID:AB_9990102)', 'Ki-67 rabbit mAb (sample record)', 'Ki-67', 'SAMPLE-2', 'Cell Signaling Technology', '9027S'),
    ('9990103', '(Thermo Fisher Scientific Cat# 14-0195-82, RRID:AB_9990103)', 'CD8a monoclonal antibody (sample record)', 'CD8a', 'SAMPLE-3', 'Thermo Fisher Scientific', '14-0195-82'),
    ('9990104', '(BD Biosciences Cat# 553086, RRID:AB_9990104)', 'Biotin rat anti-mouse CD45R/B220 (sample record)', 'CD45R', 'SAMPLE-4', 'BD Biosciences', '553086'),
    ('9990105', '(Abcam Cat# ab28364, RRID:AB_9990105)', 'Anti-CD31 antibody (sample record)', 'CD31', '', 'Abcam', 'ab28364'),
    # A bare number shared with another vendor's catalog: not matched to the CST Ki67 protocol.
    ('9990106', '(Other Vendor Cat# 9027, RRID:AB_9990106)', 'Unrelated antibody with the same number', 'XYZ', '', 'Other Vendor Inc', '9027'),
    # Commas, doubled quotes and a line break inside quoted fields.
    ('', '(Abcam Cat# ab5694, RRID:AB_9990107)', 'Anti-alpha smooth muscle Actin antibody, "sample",\nsecond line', 'ACTA2', '', 'Abcam', 'ab5694'),
]
for i in range(40):   # rows the import leaves out
    REGISTRY.append((str(9990200 + i), f'(Sample Co Cat# SMP-{1000 + i}, RRID:AB_{9990200 + i})', f'Unrelated sample antibody {i}', 'TARGET', '', 'Sample Co', f'SMP-{1000 + i}'))


def tsv(rows):
    return ''.join('\t'.join(r) + '\n' for r in rows)


def main():
    os.makedirs(OUT, exist_ok=True)
    summary = [SUMMARY_HEADER]
    n = 0
    for sym, syn, ensg, desc, up, ih, iff, spec, ntpm, abs_ in GENES:
        pairs = []
        for ab in abs_:
            n += 1
            pairs.append(f'{ab}: AB_{9990000 + n}')
        rrids = ', '.join(pairs)
        summary.append([sym, syn, ensg, desc, up, '1', '1000-2000', 'Sample class', 'Evidence at protein level', 'Evidence at protein level',
                        spec, 'Detected in many', '1.0', ntpm, ', '.join(abs_), ih, '', iff, 'Nucleoplasm', rrids])
    text = tsv(summary)
    with open(os.path.join(OUT, 'proteinatlas-sample.tsv'), 'w', encoding='utf-8', newline='') as f:
        f.write(text)
    with zipfile.ZipFile(os.path.join(OUT, 'proteinatlas-sample.tsv.zip'), 'w', compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr('proteinatlas.tsv', text)

    ensg = {g[0]: g[2] for g in GENES}
    tissue = [['Gene', 'Gene name', 'Tissue', 'Cell type', 'Level', 'Reliability']]
    for sym, rows, rel in TISSUE:
        for t, c, lv in rows:
            tissue.append([ensg[sym], sym, t, c, lv, rel])
    with open(os.path.join(OUT, 'normal_tissue-sample.tsv'), 'w', encoding='utf-8', newline='') as f:
        f.write(tsv(tissue))

    buf = io.StringIO()
    w = csv.writer(buf, lineterminator='\r\n')
    w.writerow(REGISTRY_HEADER)
    w.writerows(REGISTRY)
    with open(os.path.join(OUT, 'antibody-registry-sample.csv'), 'w', encoding='utf-8', newline='') as f:
        f.write(buf.getvalue())
    print('Wrote', os.path.normpath(OUT))


if __name__ == '__main__':
    main()
