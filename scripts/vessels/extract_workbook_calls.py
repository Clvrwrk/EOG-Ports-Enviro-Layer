"""Summarize ship calls from the POH utilization workbook, per vessel.

Usage: python3 scripts/vessels/extract_workbook_calls.py WORKBOOK.xlsx OUT.json

Reads the POH_Vessel_Schedule sheet and writes one row per MMSI with the
vessel name, the port's generic type and flag, and call counts by berth and
year. Agents, stevedores, trip ids, ports of call and dates are NOT written.

The output is still the port's own schedule data: keep it out of the
repository (write it under public/private/ or a scratch folder).
Needs openpyxl.
"""

import json
import sys
from collections import Counter

import openpyxl


def main(workbook, out):
    wb = openpyxl.load_workbook(workbook, read_only=True, data_only=True)
    rows = wb["POH_Vessel_Schedule"].iter_rows(values_only=True)
    header = None
    vessels = {}
    for row in rows:
        if header is None:
            if row and "MMSI" in row:
                header = {name: i for i, name in enumerate(row) if name}
            continue
        name = row[header["VESSEL"]]
        mmsi = row[header["MMSI"]]
        if not name or not mmsi:
            continue
        v = vessels.setdefault(
            str(mmsi),
            {
                "mmsi": str(mmsi),
                "name": str(name).strip().upper(),
                "workbookType": row[header["Vessel Type - Generic"]],
                "workbookFlag": row[header["REGISTERY"]],
                "count": 0,
                "hoursAtBerth": 0.0,
                "berths": Counter(),
                "years": Counter(),
            },
        )
        v["count"] += 1
        v["hoursAtBerth"] += float(row[header["Time at Berth in Hours"]] or 0)
        berth = row[header["Berth"]]
        if berth is not None:
            v["berths"][f"berth-{int(berth)}"] += 1
        year = row[header["Year"]]
        if year is not None:
            v["years"][str(int(year))] += 1
    result = []
    for v in sorted(vessels.values(), key=lambda v: -v["count"]):
        v["hoursAtBerth"] = round(v["hoursAtBerth"], 1)
        v["berths"] = dict(v["berths"])
        v["years"] = dict(v["years"])
        result.append(v)
    with open(out, "w") as f:
        json.dump(result, f, indent=1)
    print(f"{sum(v['count'] for v in result)} calls, {len(result)} vessels")


if __name__ == "__main__":
    main(*sys.argv[1:3])
