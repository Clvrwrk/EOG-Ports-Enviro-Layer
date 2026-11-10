#!/usr/bin/env python3
"""Cut one NOAA MarineCadastre daily AIS file down to a lon/lat box.

Usage: unzip -p AIS_2023_06_12.zip | python3 extract_marinecadastre.py \
         --bbox -119.33,34.05,-119.15,34.20 > hueneme_2023_06_12.csv

Reads CSV on stdin, writes the header plus rows inside the box to stdout.
Public data: https://coast.noaa.gov/htdata/CMSP/AISDataHandler/
"""
import argparse
import csv
import sys


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--bbox', required=True, help='minLon,minLat,maxLon,maxLat')
    args = ap.parse_args()
    min_lon, min_lat, max_lon, max_lat = (float(v) for v in args.bbox.split(','))
    reader = csv.reader(sys.stdin)
    writer = csv.writer(sys.stdout, lineterminator='\n')
    header = next(reader)
    writer.writerow(header)
    i_lat, i_lon = header.index('LAT'), header.index('LON')
    for row in reader:
        try:
            lat, lon = float(row[i_lat]), float(row[i_lon])
        except (ValueError, IndexError):
            continue
        if min_lon <= lon <= max_lon and min_lat <= lat <= max_lat:
            writer.writerow(row)


if __name__ == '__main__':
    main()
