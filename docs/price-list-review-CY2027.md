# Price list review: CY2027

Source: `MHL CY2027 Billing.xlsx` (converted 2026-11-03). Loaded as **DRAFT**; a billing administrator should resolve the items below and approve it.

The worksheet has 65 priced lines in 7 sections, which reduce to 55 unique charge codes (the labor, reagent and OCT block codes appear in more than one section).

## Findings to resolve

1. HP006005 (IHC, Labor Only, Requestor's reagents)): the unit of charge is not stated in the description; confirm it
2. HP002017 (Tissue Collect-Media Requestor's, per tube) has no price on row(s) [13]
3. HP002018 (Tissue Touch Prep, per slide) has no price on row(s) [14]
4. HP003007 (GMA Plastic Block Only, per block) has no price on row(s) [34]
5. Price column headers disagree with the list name CY2027: NECRO: 'CY2026 Price'; STAIN: 'CY2024 Price'
6. No STAT surcharge code (legacy PHL used <lab>009050, e.g. HP009050) appears in this list. Confirm whether STAT surcharges are still charged; the LIMS rule is disabled until confirmed
7. No charge code mentions 10x Xenium or spatial work, although the lab offers it. Confirm how Xenium runs are billed (a code to add, or billed outside this list)
8. The worksheet note on WSI analysis (4 labor units per 6 slide images; each multiplex target counts as an image) does not say which labor code applies (HP009002 or PA001004) or how partial groups of 6 are rounded

## Notes carried over from the worksheet

- Note: WSI analysis is charged at 4 units labor per 6 slide images. For FL mutiplex images, each target is considred a separate image.

## Charge codes

| Code | Description | Unit | Price | Sections | Needs description |
|---|---|---|---:|---|---|
| HP002001 | Necropsy | animal | $41.06 | NECRO |  |
| HP002022 | Necropsy Partial, <5 organs w/discard | animal | $27.78 | NECRO |  |
| HP002003 | Embryo Collect & Diagram, w/oNecropsy | animal | $52.51 | NECRO |  |
| HP002005 | Terminal Bleed (heart stick) | animal | $17.82 | NECRO |  |
| HP002006 | Biohaz Disposal, per animal | animal | $19.58 | NECRO |  |
| HP002007 | Whole Animal Perfusion, per animal | animal | $50.31 | NECRO |  |
| HP002008 | Lung Perfusion, per animal | animal | $28.38 | NECRO |  |
| HP002009 | Liver Perfusion, per animal | animal | $28.38 | NECRO |  |
| HP002010 | Bone Marrow Smear, per animal | animal | $19.12 | NECRO |  |
| HP002016 | Tissue Snap Freeze, per tube | tube | $3.83 | NECRO |  |
| HP002017 | Tissue Collect-Media Requestor's, per tube | tube | **not set** | NECRO |  |
| HP002018 | Tissue Touch Prep, per slide | slide | **not set** | NECRO |  |
| HP002019 | Blood Smear, per two (2) slides | pair of slides | $4.33 | NECRO |  |
| HP002021 | Blood Collection, per animal | animal | $5.59 | NECRO |  |
| HP003005 | OCT Block, per block | block | $12.08 | NECRO, TRIM_EMBED |  |
| HP009002 | Labor, per 1/4 Hr, (DEFINE) | quarter hour | $24.95 | NECRO, BLOOD, TRIM_EMBED, MICROTOMY, STAIN, IMAGE | yes |
| HP009003 | Reagent & Kit x units, (DEFINE) | dollar unit | $1.00 | NECRO, BLOOD, TRIM_EMBED, MICROTOMY, STAIN | yes |
| HP002101 | Hematology Screen (CBC), per sample | sample | $23.47 | BLOOD |  |
| HP002204 | Clin Chemistry, VetScan Panel, per sample | sample | $69.06 | BLOOD |  |
| HP002205 | Clin Chemistry, Piccolo Panel, per sample | sample | $47.43 | BLOOD |  |
| HP005008 | Stain-Differential Slide, Kwik-Diff  (2 slides) | pair of slides | $9.53 | BLOOD |  |
| HP003003 | Paraffin Block, per block | block | $15.47 | TRIM_EMBED |  |
| HP003004 | Re-embed paraffin block | block | $7.72 | TRIM_EMBED |  |
| HP003006 | Agar Block Only (Vibratome block), per block | block | $9.79 | TRIM_EMBED |  |
| HP003007 | GMA Plastic Block Only, per block | block | **not set** | TRIM_EMBED |  |
| HP003009 | Thrombin/Fibrinogen Cell Pellet, per pellet | pellet | $37.80 | TRIM_EMBED |  |
| HP004001 | Unstained Section, first slide | slide | $13.55 | MICROTOMY |  |
| HP004002 | Subsequent Unstained Section, per slide | slide | $6.83 | MICROTOMY |  |
| HP004003 | CryoJane Surcharge, per cryostat slide | slide | $4.60 | MICROTOMY |  |
| HP004007 | Vibratome Section, per initial section | initial section | $28.30 | MICROTOMY |  |
| HP004008 | Vibratome Section, per addn section | additional section | $4.53 | MICROTOMY |  |
| HP005003 | H&E from slide | slide | $3.15 | STAIN |  |
| HP005017 | Special Stain from slide | slide | $8.35 | STAIN |  |
| HP005018 | Complex Special Stain from slide | slide | $19.91 | STAIN |  |
| HP005007 | Custom Stain x units | dollar unit | $1.00 | STAIN | yes |
| HP005015 | Coverslip Slide | slide | $1.48 | STAIN |  |
| HP005016 | CytoSpin, per sample | sample | $29.56 | STAIN |  |
| HP006001 | B-gal Stain, per slide | slide | $41.36 | STAIN |  |
| HP006004 | IHC, Est. Assay, per slide | slide | $55.79 | STAIN |  |
| HP006005 | IHC, Labor Only, Requestor's reagents) | each | $40.45 | STAIN |  |
| HP006008 | TUNEL Assay (TdT), per slide | slide | $90.27 | STAIN |  |
| HP006009 | IHC1-Opal, per slide | slide | $81.17 | STAIN |  |
| HP006010 | IHC2-Opal, per slide | slide | $111.16 | STAIN |  |
| HP006011 | IHC3-Opal, per slide | slide | $141.00 | STAIN |  |
| HP006012 | IHC4-Opal, per slide | slide | $190.77 | STAIN |  |
| HP006013 | IHC5-Opal, per slide | slide | $220.73 | STAIN |  |
| HP006014 | IHC6-Opal, per slide | slide | $262.94 | STAIN |  |
| HP006017 | ISH1-3, RNAScope, per slide | slide | $179.25 | STAIN |  |
| HP006220 | Spectrophotometer, per sample | sample | $5.41 | STAIN |  |
| HP006221 | Agilent 2100 Assay, per sample | sample | $12.72 | STAIN |  |
| HP001006 | Aperio Slide Scan @ 20x, per slide | slide | $12.45 | IMAGE |  |
| HP001007 | Aperio Slide Scan @ 40X, per slide | slide | $14.95 | IMAGE |  |
| HP001009 | Akoya HT FL Slide Scan @20x, per slide | slide | $34.59 | IMAGE |  |
| PA001002 | Pathology/Target Organ, per glass slide | slide | $23.84 | PATH |  |
| PA001004 | Pathology Labor, per qtr hr | quarter hour | $51.10 | PATH |  |
