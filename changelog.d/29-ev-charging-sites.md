- Fix where EV Planning puts drayage charging. Trucks never charge at the
  Port of Hueneme: they charge behind the meter at the carrier's home yard,
  at a third-party station such as WattEV, or through a Charging-as-a-Service
  provider at the home yard. The planner now asks where the trucks charge
  and at what electricity price, and reports the charging energy and
  chargers at that site instead of "depot energy at POH" (Claude, #29).
