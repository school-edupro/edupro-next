# Transport: a guide for the transport office and the fee department

## Who does what

| Person              | Does                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Transport in-charge | Masters (routes, stoppages with their slab, vehicles, drivers, vendors), first approval of a family's request, applies for a student |
| Fee department      | Last approval of every transport request; the approval updates the transport fee of exactly the months asked                         |
| School admin        | Transport settings: the charge rule, who approves and in which order, message templates                                              |
| Families            | Apply, change or withdraw from the parent portal; see the route, stoppage, charge, history and the live bus                          |

## Set-up, once

1. **Transport → Transport setup** is the one place for the masters, in the order you fill them. Each
   tab has search, pages, add / edit, bulk update, **Excel and PDF download at once**, and an Excel
   upload whose template has **drop-downs** for every choice (slab, route, vehicle, crew, yes / no).
   Every field is checked: 10-digit mobile, email, GSTIN, vehicle number like MH12AB1234, licence
   number, links, dates, distances.
   1. _Routes_ first: the code and the name of each route (everything else hangs on a route).
      **Stops and students** opens the route's own page. Then _Vehicle types_ and _Vendors_.
   2. _Vehicles_: number, name, make and model, type, category, vendor, seats, the in-charge
      employee, registration date, insurance / fitness / permit / PUC valid till, RC book, AIS device,
      GPS device, camera and tracking links. **Daily log** opens the vehicle's own page.
   3. _Crew_: drivers, conductors and attendants (support staff) in one list, with the role, mobile,
      vendor or employee, licence (drivers), badge and police verification.
   4. _Transport slabs_ (the same list the fee office sees).
   5. _Stoppages_: each stoppage once, with its area, slab, radial and route distance, and its place
      on the map (search a location, click the map or drag the pin).
   6. _Route stops_: the stoppages a route calls at, in order, with pick and drop time.
   7. _Route and vehicle mapping_: which vehicle runs the route (pick, drop or both) with its
      driver, conductor and attendant, from and to date. The bus list, GPS and the dashboard follow it.
2. **Transport → Transport settings**:
   - _Charge rule._ Pick and drop from one stoppage = the full slab of that stoppage. Pick only or
     drop only = the percentage you set of the slab. Pick and drop from two different stoppages = the
     higher slab, the pick stoppage's slab, or the one-way share of each added (you choose).
   - _Approval levels._ One chain for a request from a family (default: Transport in-charge → Fee
     department) and one for a request made by the transport office (default: Fee department). A level
     is a role, a designation or one employee; a level nobody holds is skipped.
   - Whether families may apply from the portal, and whether approvers and families get an email.
3. Give the roles **Transport In-charge** and **Accountant** under Access.

## Daily routine

1. A parent opens **Transport → Apply for transport**: the child, then **Pick and drop / Pick only /
   Drop only**, the route, the stoppage (the slab and the monthly charge show at once), and the
   months (from – to). The request gets a number (TR-2610-0001).
2. **Transport → To approve** (also the approvals icon in the header): the transport in-charge
   approves or rejects with a note; then the fee department. Each sees only what waits at their level.
3. On the last approval the system writes the **transport period**, raises or changes the transport
   fee of those months, and maps the pupil to the bus from the first month. The family is told.
4. At the transport office: **Transport → Apply for a student** (search by name or admission number),
   the same form; it goes to the fee department only.
5. **Withdrawal**: the family (or the office) chooses _Stop the transport_ and the first month without
   the bus. Until the end of the month before, the route, the stoppage and the live bus position stay
   in the portal and the fee is charged; from that month there is no fee and no mapping.

## Reports

- **Transport dashboard**: riding now (pick and drop, pick only, drop only), waiting for approval by
  level and how long, seats used, billed this month, the last six months (new, changes, withdrawals,
  riders, amount), requests day by day, how full each route is, busiest stoppages, riders by slab and
  class, and the vehicle and driver papers running out in 30 days.
- **Requests**: tabs by status, filters (type, family or office, route, dates, search), Excel.
- **Student history**: every period a pupil rode: months, service, pick and drop stoppage, vehicle,
  slab, monthly charge, the request that approved it and the one that ended it. By month, route,
  service or one pupil; Excel.

## Common questions

1. _A month was already paid and the stoppage changed._ The paid month keeps what was paid; the request
   says which months, and the fee desk adjusts or refunds the difference.
2. _The pupil changes the stoppage in the middle of the session._ A **Change** from a month closes the
   running period at the month before and opens a new one; both stay in the history.
3. _Pick from one route, drop on another._ Choose Pick and drop and tick _The drop is at a different
   stoppage or route_; the charge follows the rule in the settings.
4. _Who approves when the transport in-charge is on leave?_ Add a second person to the level (a role
   or a designation holds several people; any one of them can approve).
5. _A pupil was put on a route directly on the route page._ The history picks it up from this month
   at the stoppage's slab; no approval is recorded for it. Use a request when the fee must follow.
