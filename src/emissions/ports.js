// Port profiles and their public URLs.
//
// Each port lives at ports.zea.green/<category>/<state>/<slug>, for example
// ports.zea.green/ports/california/port-of-hueneme. A profile holds only
// public facts, each with its source, plus the geofences the emissions method
// uses to assign operating modes (EPA-420-B-22-011, Table 3.11).

const SPARC_BLUEPRINT = Object.freeze({
  title:
    // i18n-ignore: source citation, kept as published
    'The SPARC Blueprint Project, Port of Hueneme (CEC agreement ARV-21-024)',
  publisher: 'California Energy Commission',
  url: 'https://www.energy.ca.gov/sites/default/files/2025-04/Final_Blueprint_ARV-21-024_Port%20of%20Hueneme_ADA.pdf',
});

const OSM_HUENEME_SOURCE = Object.freeze({
  // i18n-ignore: source citation, kept as published
  title: 'OpenStreetMap coastline ways 763471833 and 934892361 (Port Hueneme)',
  publisher: 'OpenStreetMap contributors',
  license: 'ODbL 1.0',
  url: 'https://www.openstreetmap.org/way/763471833',
  retrieved: '2026-11-06',
});

/**
 * Geofence status: 'osm-derived' means the polygon was traced from
 * OpenStreetMap features named in `source`; 'approximate' means it was drawn
 * by hand and must be checked before results are published. Every polygon is
 * [lon, lat] pairs, closed.
 */
export const PORT_OF_HUENEME = Object.freeze({
  id: 'port-of-hueneme',
  name: 'Port of Hueneme',
  category: 'ports',
  state: 'california',
  slug: 'port-of-hueneme',
  operator: 'Oxnard Harbor District',
  center: { lon: -119.2085, lat: 34.1495 },
  // Opening view for the port page: 6 km up, south of the basin, looking
  // north at 50 degrees down so the harbor sits mid-screen.
  camera: {
    lon: -119.2085,
    lat: 34.1045,
    heightM: 6000,
    headingDeg: 0,
    pitchDeg: -50,
  },
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
  // EPA ship types for the trades above, used to narrow an unidentified AIS
  // cargo vessel (code 70-79) to a range instead of every cargo type.
  epaShipTypes: {
    types: ['Vehicle Carrier', 'Reefer', 'Container Ship', 'General Cargo'],
    basis: 'Cargo list above, mapped to EPA-420-B-22-011 Table 3.4 types',
  },
  emissionControlArea: true,
  geofences: {
    status: 'osm-derived',
    source: OSM_HUENEME_SOURCE,
    // Harbor water inside the jetties: the OpenStreetMap coastline from the
    // west jetty tip around the basin to the east jetty tip, closed across the
    // entrance and simplified to 6 m.
    harbor: [
      [-119.2162, 34.14381],
      [-119.21612, 34.14502],
      [-119.21578, 34.14527],
      [-119.21548, 34.14576],
      [-119.21508, 34.14592],
      [-119.21441, 34.14595],
      [-119.21327, 34.14581],
      [-119.21315, 34.14571],
      [-119.21288, 34.14574],
      [-119.21239, 34.14627],
      [-119.21215, 34.14636],
      [-119.21168, 34.14679],
      [-119.21216, 34.14637],
      [-119.2124, 34.14636],
      [-119.21269, 34.14657],
      [-119.21204, 34.14716],
      [-119.21147, 34.14707],
      [-119.21023, 34.14846],
      [-119.21021, 34.14905],
      [-119.21004, 34.14906],
      [-119.21004, 34.15267],
      [-119.21058, 34.15334],
      [-119.21096, 34.15339],
      [-119.21114, 34.15365],
      [-119.21057, 34.15394],
      [-119.21043, 34.15388],
      [-119.21027, 34.15393],
      [-119.20975, 34.15304],
      [-119.20964, 34.15305],
      [-119.20965, 34.15345],
      [-119.20957, 34.15345],
      [-119.20956, 34.15306],
      [-119.20945, 34.15304],
      [-119.20945, 34.15369],
      [-119.20815, 34.15372],
      [-119.20816, 34.15158],
      [-119.20619, 34.15158],
      [-119.2062, 34.14875],
      [-119.20145, 34.14877],
      [-119.20139, 34.14847],
      [-119.20148, 34.14831],
      [-119.20267, 34.14752],
      [-119.20285, 34.14752],
      [-119.20286, 34.14768],
      [-119.20881, 34.14768],
      [-119.20958, 34.14685],
      [-119.20953, 34.14679],
      [-119.21002, 34.14626],
      [-119.2108, 34.14514],
      [-119.2109, 34.14511],
      [-119.21084, 34.1449],
      [-119.21041, 34.14479],
      [-119.21029, 34.14467],
      [-119.21018, 34.1439],
      [-119.21198, 34.14315],
      [-119.21212, 34.14304],
      [-119.21205, 34.14295],
      [-119.2162, 34.14381],
    ],
    // The basin north of the entrance channel (lat >= 34.1466), where ships
    // tie up. Records here at <= 1 kn are hotelling. It includes the Naval Base
    // Ventura County wharves on the basin's west side, which the port's own
    // inventory excludes; they must be split out before validation.
    berths: [
      [
        [-119.21188, 34.1466],
        [-119.21168, 34.14679],
        [-119.21189, 34.1466],
        [-119.21265, 34.1466],
        [-119.21204, 34.14716],
        [-119.21147, 34.14707],
        [-119.21023, 34.14846],
        [-119.21021, 34.14905],
        [-119.21004, 34.14906],
        [-119.21004, 34.15267],
        [-119.21058, 34.15334],
        [-119.21096, 34.15339],
        [-119.21114, 34.15365],
        [-119.21057, 34.15394],
        [-119.21043, 34.15388],
        [-119.21027, 34.15393],
        [-119.20975, 34.15304],
        [-119.20964, 34.15305],
        [-119.20965, 34.15345],
        [-119.20957, 34.15345],
        [-119.20956, 34.15306],
        [-119.20945, 34.15304],
        [-119.20945, 34.15369],
        [-119.20815, 34.15372],
        [-119.20816, 34.15158],
        [-119.20619, 34.15158],
        [-119.2062, 34.14875],
        [-119.20145, 34.14877],
        [-119.20139, 34.14847],
        [-119.20148, 34.14831],
        [-119.20267, 34.14752],
        [-119.20285, 34.14752],
        [-119.20286, 34.14768],
        [-119.20881, 34.14768],
        [-119.20958, 34.14685],
        [-119.20953, 34.14679],
        [-119.2097, 34.1466],
        [-119.21188, 34.1466],
      ],
    ],
    anchorages: [],
    // Outer boundary of the inventory domain, as a radius from the entrance.
    approachRadiusNm: 25,
    // Midpoint of the two jetty tips in the OpenStreetMap coastline.
    entrance: { lon: -119.2141, lat: 34.1434 },
    notes: [
      'Berths still include Navy wharves; split by wharf before validation.',
      'No anchorage polygon yet; ships waiting offshore count as approach.',
    ],
  },
  // Published totals to validate against, in short tons (criteria pollutants)
  // and metric tonnes (CO2e), exactly as reported.
  validation: [
    {
      year: 2019,
      source: {
        title:
          // i18n-ignore: source citation, kept as published
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
