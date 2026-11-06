# Port emissions method

This fork adds an open, auditable estimate of port-related emissions and
electricity use. It is built so that anyone can check every number: each
factor is transcribed from a public source with its table number, and each
result carries the inputs that produced it.

The first port is the **Port of Hueneme**, published at
`ports.zea.green/ports/california/port-of-hueneme`. Ports follow the pattern
`ports.zea.green/<category>/<state>/<name>` (`src/emissions/ports.js`,
`portPath` / `portForPath`).

## What is modeled, and what is measured

| Source                      | How it is estimated                                      | Measured or modeled                  |
| --------------------------- | -------------------------------------------------------- | ------------------------------------ |
| Ships (ocean-going vessels) | Real AIS positions, EPA activity x factor method         | Activity measured, emissions modeled |
| Shore power load            | Auxiliary engine load while hotelling, moved to the grid | Modeled                              |
| Trucks (planned)            | Gate volumes spread over the road network                | Modeled                              |
| Rail (planned)              | Rail volumes spread over the rail network                | Modeled                              |

Ships broadcast their position publicly (AIS). Trucks and trains do not, so
land-side flows are modeled and labeled as modeled in the interface.

## Ship method (implemented)

Code: `src/emissions/ogvFactors.js` (factors), `src/emissions/ogvMethod.js`
(equations), `src/emissions/aisCalls.js` (AIS to port calls).

Source: U.S. EPA, _Port Emissions Inventory Guidance_, EPA-420-B-22-011
(April 2022), Section 3 and Appendices E and F.

1. **Port calls.** AIS records are split per vessel into runs inside the
   inventory domain. A run that enters a berth geofence is a port call; other
   runs are innocent passage (Section 3.8.2). Gaps over 6 hours are not
   filled (Section 3.8.3).
2. **Operating mode** per record from zone, speed and propulsion load
   (Table 3.11): transit, maneuvering, hotelling, anchorage.
3. **Propulsion power** by the admiralty formula when draft is known, else the
   propeller law, with a 1.10 coastal sea margin (Equations 3.6 to 3.8).
   Speeds above 1.5 x maximum use the maximum.
4. **Emission factors** by engine group, fuel, engine type and keel-laid
   year (Tables 3.5 to 3.9; PM, CO2 and SO2 from Equations 3.3 to 3.5).
   Tier III propulsion under 25% load uses Tier II NOx.
5. **Low-load adjustment** below 20% propulsion load (Table 3.10).
6. **Auxiliary and boiler loads** from Appendix E defaults by ship type,
   subtype and mode, unless port-specific values are supplied.
7. **Shore power.** While hotelling on shore power, the auxiliary load is
   counted as grid electricity (kWh) instead of engine emissions. Boilers
   keep burning fuel. Grid kWh excludes conversion losses.
8. **CO2e** uses a GWP set the caller names (IPCC AR4 or AR5, 100-year); the
   set is reported with every CO2e total.

### Known gaps

- **Vessel characteristics.** Installed power, maximum speed, engine type and
  keel-laid year are not in AIS. Without them propulsion emissions are left
  out and a warning is returned; hotelling and shore-power load still work
  from ship type and size alone. Next step: a public vessel table keyed by
  IMO number, with the source of each value.
- **SO2 low-load factors** for sulfur other than 0.1% need Appendix F, which
  is not transcribed yet; the result is flagged.
- **Hueneme geofences** are drawn by hand and marked `approximate`. They must
  be checked against the NOAA chart or OpenStreetMap before results are
  published.

## Validation

The method is checked against the port's own published inventory. The 2019
targets are stored in the port profile, as reported in Starcrest's _Port of
Hueneme Inventory of Air Emissions, CY 2020 and 2019_, Table 5, cited in the
California Energy Commission's SPARC Blueprint for the port (ARV-21-024). For
2019, ocean-going vessels at Hueneme were reported at 121 tons NOx, 1.67 tons
DPM and 9,334 tonnes CO2e. Our estimate and the gap will be published side by
side, whatever the gap is.
