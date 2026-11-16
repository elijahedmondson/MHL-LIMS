# Sample outside-source files

For trying Molecular > Outside sources in the pilot. They have the layout of the real downloads but **made-up values**: do not use them as reference data.

- `proteinatlas-sample.tsv` and `proteinatlas-sample.tsv.zip`: the Human Protein Atlas gene summary (`proteinatlas.tsv`), cut to the columns the LIMS reads plus a few it ignores, for 12 genes. Gene symbols, Ensembl IDs and UniProt accessions are real so the links work; the reliability values, RNA figures, HPA antibody IDs (HPA999xxx, CAB999xxx) and RRIDs are invented. ALDOB lists HPA002198, the HPA antibody in MHL's ALDOB protocol, so the pilot can show an RRID taken from the HPA. TTN and MIB1 are there to show that genes the catalog does not need are left out.
- `normal_tissue-sample.tsv`: the layout of the HPA's `normal_tissue.tsv` (IHC staining level by tissue and cell type), for 7 genes, with invented levels.
- `antibody-registry-sample.csv`: Antibody Registry rows with the headers the LIMS looks for. RRIDs AB_999xxxx are beyond any real RRID. Six rows match catalog numbers in MHL's catalog (one as a size, one with a letter suffix, one with commas, quotes and a line break inside quoted fields); one shares a bare number with another vendor's catalog, so it is read but never suggested; 40 match nothing.

Made by `tools/outside-samples/make_outside_samples.py`. The real files: proteinatlas.org/about/download (free) and antibodyregistry.org (free account).
