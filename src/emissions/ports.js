// Port profiles and their public URLs.
//
// Each port lives at ports.zea.green/<category>/<state>/<slug>, for example
// ports.zea.green/ports/california/port-of-hueneme. A profile holds only
// public facts, each with its source, plus the geofences the emissions method
// uses to assign operating modes (EPA-420-B-22-011, Table 3.11).

const SPARC_BLUEPRINT = Object.freeze({
  title:
    'The SPARC Blueprint Project, Port of Hueneme (CEC agreement ARV-21-024)',
  publisher: 'California Energy Commission',
  url: 'https://www.energy.ca.gov/sites/default/files/2025-04/Final_Blueprint_ARV-21-024_Port%20of%20Hueneme_ADA.pdf',
});

/**
 * Geofence status: 'approximate' means the polygon was drawn by hand from the
 * harbor layout and must be checked against the NOAA chart or OpenStreetMap
 * before results are published. Every polygon is [lon, lat] pairs, closed.
 */
export const PORT_OF_HUENEME = Object.freeze({
  id: 'port-of-hueneme',
  name: 'Port of Hueneme',
  category: 'ports',
  state: 'california',
  slug: 'port-of-hueneme',
  operator: 'Oxnard Harbor District',
  center: { lon: -119.2085, lat: 34.1495 },
  camera: { lon: -119.2085, lat: 34.1495, heightM: 6000 },
  electricUtility: {
    name: 'Southern California Edison',
    source: SPARC_BLUEPRINT,
  },
  cargo: [
    'autos and rolling stock',
    'refrigerated produce',
    'containers',
    'break bulk and high-and-heavy',
  ],
  emissionControlArea: true,
  geofences: {
    status: 'approximate',
    // Inside the jetties: the entrance channel and the harbor basin.
    harbor: [
      [-119.2155, 34.1425],
      [-119.2045, 34.1425],
      [-119.1975, 34.1505],
      [-119.1975, 34.1595],
      [-119.2125, 34.1595],
      [-119.2185, 34.1505],
      [-119.2155, 34.1425],
    ],
    // Wharf faces where ships tie up. Records here at <= 1 kn are hotelling.
    berths: [
      [
        [-119.2135, 34.1475],
        [-119.2035, 34.1475],
        [-119.2005, 34.1545],
        [-119.2005, 34.1585],
        [-119.2105, 34.1585],
        [-119.2155, 34.1515],
        [-119.2135, 34.1475],
      ],
    ],
    anchorages: [],
    // Outer boundary of the inventory domain, as a radius from the entrance.
    approachRadiusNm: 25,
    entrance: { lon: -119.2095, lat: 34.1428 },
  },
  // Published totals to validate against, in short tons (criteria pollutants)
  // and metric tonnes (CO2e), exactly as reported.
  validation: [
    {
      year: 2019,
      source: {
        title:
          'Port of Hueneme Inventory of Air Emissions, CY 2020 and 2019 (Starcrest Consulting Group)',
        citedIn: SPARC_BLUEPRINT,
        table: 'Table 5: Summary of 2020 and 2019 Port-Related Emissions',
      },
      categories: {
        oceanGoingVessels: {
          noxTons: 121,
          dpmTons: 1.67,
          soxTons: 6.17,
          pm25Tons: 2.29,
          co2eTonnes: 9334,
        },
        harborCraft: { noxTons: 32, dpmTons: 0.64, co2eTonnes: 3200 },
        cargoHandlingEquipment: {
          noxTons: 13,
          dpmTons: 0.26,
          co2eTonnes: 2222,
        },
        locomotives: { noxTons: 4, dpmTons: 0.12, co2eTonnes: 165 },
        wheeledVehicles: { noxTons: 4, dpmTons: 0.03, co2eTonnes: 2983 },
        total: { noxTons: 174, dpmTons: 2.72, co2eTonnes: 17905 },
      },
    },
  ],
  electrificationStudy: {
    source: SPARC_BLUEPRINT,
    notes: [
      'Peak load if fully electrified: up to 4 MW for cargo-handling equipment and 2 MW for shore power.',
      'The Blueprint reports that electrical capacity at the port is severely limited.',
    ],
  },
});

export const PORT_PROFILES = Object.freeze([PORT_OF_HUENEME]);

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Public path for a profile: /<category>/<state>/<slug>. */
export function portPath(profile) {
  for (const part of [profile.category, profile.state, profile.slug]) {
    if (!SEGMENT.test(part))
      throw new TypeError(`Invalid port path segment: ${part}`);
  }
  return `/${profile.category}/${profile.state}/${profile.slug}`;
}

/** Find the profile for a URL path such as /ports/california/port-of-hueneme. */
export function portForPath(pathname, profiles = PORT_PROFILES) {
  const parts = String(pathname ?? '')
    .split('/')
    .filter(Boolean)
    .map((p) => p.toLowerCase());
  if (parts.length !== 3) return null;
  const [category, state, slug] = parts;
  return (
    profiles.find(
      (p) => p.category === category && p.state === state && p.slug === slug,
    ) ?? null
  );
}

/** Ray-casting point-in-polygon for [lon, lat] rings. */
export function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (
      yi > lat !== yj > lat &&
      lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi
    )
      inside = !inside;
  }
  return inside;
}

const NM_PER_DEG_LAT = 60;

/** Great-circle-free small-distance approximation, good to well under 1% at port scale. */
export function distanceNm(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * NM_PER_DEG_LAT;
  const dLon =
    (lon2 - lon1) *
    NM_PER_DEG_LAT *
    Math.cos((((lat1 + lat2) / 2) * Math.PI) / 180);
  return Math.hypot(dLat, dLon);
}

/** Zone for one position: 'berth', 'anchorage', 'harbor', 'approach' or null (outside). */
export function zoneFor(profile, lon, lat) {
  const g = profile.geofences;
  if (g.berths.some((ring) => pointInRing(lon, lat, ring))) return 'berth';
  if (g.anchorages.some((ring) => pointInRing(lon, lat, ring)))
    return 'anchorage';
  if (pointInRing(lon, lat, g.harbor)) return 'harbor';
  if (
    distanceNm(lon, lat, g.entrance.lon, g.entrance.lat) <= g.approachRadiusNm
  )
    return 'approach';
  return null;
}
