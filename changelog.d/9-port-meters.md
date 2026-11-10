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
