- Show the port's electricity meters in the Hueneme twin. Each utility
  service point is a column sized by its yearly kWh and coloured by end use
  (shore power, reefer plugs, crane power, equipment charging, buildings,
  lighting, pumps), with a card for its rate schedule, billed history, peak
  and service size. Scenario loads now land on the meter that would carry
  them, are billed on that meter's rate, and turn the column red when they
  exceed the service. A usage graph follows the twin's clock with the day's
  load by end use; it is modeled from monthly bills and the scenario until
  15-minute meter data is loaded. The real registry is loaded at run time
  from `public/private/meters/` and stays out of the repository; without it
  the layer shows labelled sample numbers (Claude, #9).
- Move the Hueneme twin into the left menu as "POH Twin". Opening it starts
  the twin, and its usage graph shows only while the twin is on. The panel
  has its own layer list (ships, cranes and trucks; structures; roads and
  rail; utility lines and power flow; meters; reefer plugs; usage graph)
  and a switch that turns the map image off so the motion reads on a plain
  ground. Structures, roads and rail come from OpenStreetMap (Claude, #9).
- Simulate power flowing through the port in the twin: a utility feed, a
  feeder backbone, a service drop to each meter and branches to the shore
  power vaults, crane outlets, charge ports and reefer racks, with dots that
  run faster and larger with more kW and a red line where a service is
  over its rating. Routes are approximate until an as-built conduit drawing
  is loaded. Each reefer plug is drawn and has its own card (state, cargo,
  set point, air temperatures, kW, kWh today); the readings are simulated
  and always add up to the reefer meter (Claude, #9).
- Pick the rate sheet a twin scenario is billed on (TOU-8 Option D,
  TOU-EV-9, TOU-EV-9 with demand charges, workbook averages) and see what
  sets the demand charge: the peak 15-minute interval, what was drawing
  power then, what each kW of it costs, a button that jumps the twin to
  that moment and a red line on the usage graph (Claude, #9).
- All four Hueneme harbor cranes are plug-in from 2023: port staff say
  they work off shore power at the berth, so the 2023 fleet plan no longer
  has a diesel crane (Claude, #9).
