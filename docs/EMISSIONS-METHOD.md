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
- **Hueneme berths** include the Naval Base Ventura County wharves on the
  basin's west side, which the port's inventory excludes. They must be split
  by wharf before the validation run. There is no anchorage polygon yet.

## Geofences

Hueneme's harbor polygon is traced from the OpenStreetMap coastline (ways
763471833 and 934892361, ODbL), from the west jetty tip around the basin to
the east jetty tip, closed across the entrance and simplified to 6 m. The berth
zone is the basin north of the entrance channel (latitude 34.1466 and up). The
entrance point is the midpoint of the two jetty tips. These replace the first
hand-drawn shapes, which were about twice the real harbor area and put the
entrance 400 m too far east.

## Live map layer

`src/layers/portEmissions/` adds a **Port Emissions** layer (layer panel,
Ports group). It outlines the harbor, berths and the 25 nm inventory area,
and every 30 seconds reads the Live Vessels layer's records into
`src/emissions/portActivity.js`, which:

- credits the time between two fixes to the mode of the earlier fix (Table
  3.11), without filling gaps over 6 hours;
- for ships at berth, takes Appendix E hotel loads and Tables 3.5 to 3.9
  factors on 0.1% sulfur distillate (ECA and CARB at-berth rule).

AIS gives only a two-digit ship type, so a "cargo" code could be a car
carrier, a reefer or a container ship, and the engine tier is unknown. Unless
the vessel table (`src/emissions/vesselRegistry.js`, keyed by IMO or MMSI,
every row with a source) has the ship, the layer shows a **range** over the
candidates. For Hueneme those candidates are narrowed to the port's own trades.
The at-berth auxiliary load is also the shore-power grid demand if every ship
plugged in. Propulsion is left out, with a warning, until the table supplies
installed power. The Live Vessels layer loads ships in view, so the layer
counts ships while the port is on screen.

`/ports/<state>/<name>` (for example `/ports/california/port-of-hueneme`)
opens the app over that port with Port Emissions and Live Vessels on
(`src/share/portRoute.js`). It is a long-form share under the hood, so
reloads and later URL updates behave like any shared view.

## Validation

The method is checked against the port's own published inventory. The 2019
targets are stored in the port profile, as reported in Starcrest's _Port of
Hueneme Inventory of Air Emissions, CY 2020 and 2019_, Table 5, cited in the
California Energy Commission's SPARC Blueprint for the port (ARV-21-024). For
2019, ocean-going vessels at Hueneme were reported at 121 tons NOx, 1.67 tons
DPM and 9,334 tonnes CO2e. Our estimate and the gap will be published side by
side, whatever the gap is.
