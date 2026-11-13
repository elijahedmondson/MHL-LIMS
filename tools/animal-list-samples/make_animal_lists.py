"""Writes the sample animal lists in pilot/samples/animal-lists (fictional animals).

A customer's own workbook laid out the way investigators send them (a title row, their own headings, an extra column
MHL does not read, real Excel dates), and a CSV with mistakes for trying the checks. Needs openpyxl, so that the
.xlsx is written by a different program than the pilot's own template writer.

    python make_animal_lists.py
"""
import csv
import datetime as dt
import pathlib
import openpyxl
from openpyxl.styles import Font

out = pathlib.Path(__file__).resolve().parents[2] / 'pilot' / 'samples' / 'animal-lists'
out.mkdir(parents=True, exist_ok=True)

wb = openpyxl.Workbook()
ws = wb.active
ws.title = 'Necropsy submission'
ws['A1'] = 'Abernathy lab: neuroblastoma PDX efficacy study, necropsy submission'
ws['A1'].font = Font(bold=True, size=13)
ws['A2'] = 'NAS 26-0471. Tumor, liver, spleen and lungs from each mouse; weigh the tumor and spleen.'
headers = ['Mouse #', 'Group', 'Treatment', 'Gender', 'Strain', 'DOB', 'Cage #', 'Weight (g)', 'Comments']
ws.append([])
ws.append(headers)
for c in ws[4]:
    c.font = Font(bold=True)
treatments = {'G1': 'Vehicle, daily IP', 'G2': 'Compound X 10 mg/kg, daily IP', 'G3': 'Compound X 30 mg/kg, daily IP', 'G4': 'Compound X 30 mg/kg + irradiation'}
comments = {4103: 'Tumor ulcerated on day 18', 4110: 'Found moribund; euthanized early', 4114: 'Lost ear tag, ID from cage card'}
for i in range(16):
    tag = 4101 + i
    group = f'G{i // 4 + 1}'
    dob = dt.date(2026, 7, 6) + dt.timedelta(days=(i % 3))
    ws.append([tag, group, treatments[group], 'Female', 'NSG', dob, f'C-{210 + i // 4}', round(21.0 + (i * 7 % 11) / 4, 1), comments.get(tag, '')])
    ws.cell(row=ws.max_row, column=6).number_format = 'm/d/yyyy'
for col, w in zip('ABCDEFGHI', [9, 7, 32, 8, 7, 11, 8, 10, 34]):
    ws.column_dimensions[col].width = w
notes = wb.create_sheet('Dosing log')
notes.append(['Date', 'Note'])
notes.append([dt.date(2026, 10, 12), 'Dosing started'])
wb.save(out / 'Abernathy-animal-list.xlsx')

rows = [
    ['Animal ID', 'Group', 'Sex', 'Date of birth', 'Notes'],
    ['A-01', 'Ctrl', 'M', '2026-06-01', ''],
    ['A-02', 'Ctrl', 'M', '06/01/2026', ''],
    ['A-02', 'Low', 'M', '2026-06-01', 'Same ID as the line above'],
    ['A-04', 'Low', 'X', '2026-06-01', 'Sex is not F, M or U'],
    ['', 'High', 'F', '2026-06-01', 'No animal ID'],
    ['A-06', 'High', 'F', '2030-01-01', 'Born in the future'],
    ['A-07', 'High', 'F', '13/45/2026', 'Not a date'],
]
with open(out / 'animal-list-with-problems.csv', 'w', newline='', encoding='utf-8') as f:
    csv.writer(f).writerows(rows)
print('Wrote', sorted(p.name for p in out.iterdir()))
