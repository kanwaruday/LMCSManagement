#!/usr/bin/env python3
"""Build the real proofreading workbook from local exports (never commit the output -- it holds real salaries).

  python3 tools/payroll-proofread/build.py OUT.xlsx YYYY-MM [--sm Salary_Master.csv] [--ledger ledger.csv] [--loans loans.csv]

Any tab not given is left empty for you to paste. PayRoll Constants / Rates default to the values the portal was
validated with (EPF ceiling 15,000 etc.) -- VERIFY them against the live tabs.
"""
import argparse, csv, datetime as dt, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import build_workbook as B

def val(x):
    x = x.strip()
    if x == '':
        return None
    if len(x) >= 10 and x[4] == '-' and x[7] == '-' and x[:4].isdigit():
        try: return dt.date.fromisoformat(x[:10])
        except ValueError: pass
    try:
        f = float(x.replace(',', ''))
        return int(f) if f == int(f) and '.' not in x else f
    except ValueError:
        return x

def load(path, skip_header=True):
    rows = list(csv.reader(open(path, encoding='utf-8-sig')))
    return [[val(c) for c in r] for r in (rows[1:] if skip_header else rows)]

ap = argparse.ArgumentParser()
ap.add_argument('out'); ap.add_argument('month')
ap.add_argument('--sm'); ap.add_argument('--ledger'); ap.add_argument('--loans')
a = ap.parse_args()
Y, M = int(a.month[:4]), int(a.month[5:])
data = {t: [] for t in B.HEADERS}
data['PayRoll Constants'] = [['RRF Y1 %', 12], ['RRF Y2 %', 9], ['RRF Y3 %', 6], ['EPF Cap Salary', 15000], ['EPF Rate %', 8.33], ['PF Rate %', 3.67],
    ['ESI Threshold', 21000], ['ESI Employer %', 3.25], ['ESI Employee %', 0.75], ['RRF Target Months', 3], ['RRF Stop At Target (1=Yes)', 1],
    ['Gratuity Provision %', 5], ['CL Encashment Divisor', 30], ['EPF Mandatory Below Gross', 25000]]
data['PayRoll Rates'] = [['HES', 5, 35, 'Y', 'Y'], ['LMS 1', 5, 35, 'Y', 'Y'], ['LMS 2', 5, 35, 'Y', 'Y'], ['LMS 3', 5, 25, 'Y', 'Y'],
    ['LMS 4', 5, 35, 'Y', 'Y'], ['LMS 5', 5, 35, 'Y', 'Y'], ['LMS 6', 5, 35, 'N', 'N']]
if a.sm: data['Salary Master'] = load(a.sm)
if a.ledger: data['Ledger'] = load(a.ledger, skip_header=False)
if a.loans: data['Loans'] = load(a.loans, skip_header=False)
banner = ('DATA STATUS: Salary Master / Ledger / Loans / Rates / Constants were loaded from the 1-Oct-2026 import files (September baseline). Monthly Inputs, '
          'Adjustments and Payroll Register are EMPTY -- paste your live tabs over every input tab before trusting a number (see Read Me).')
meta = B.build(a.out, data, dt.date(Y, M, 1), banner)
print('built', a.out, 'rows', meta['first'], '-', meta['last'])
