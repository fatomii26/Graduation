# MDX Graduation Portal

A single-page prototype for the Middlesex University Dubai graduation ticketing portal.

- **Student view**: MISIS lookup → email OTP verification → eligibility check → ticket selection → mock CCAvenue payment flow.
- **Admin view**: dashboard, ceremony allocation, finance entry (counter + bulk CCAvenue upload), financial hold overrides, ticket collection, waiting list, data upload, master list, reconciliation, and audit log.

## Status

This is a **front-end prototype**: all data lives in an in-memory JavaScript object (`db` in `index.html`) and resets on page refresh. There is no backend or persistent database yet.

## Running locally

Just open `index.html` in a browser, or serve the folder with any static file server:

```bash
npx serve .
```

## Demo student IDs

See the "Demo IDs" note on the student ticket entry screen for sample MISIS numbers covering different states (eligible, maxed out, financial hold, finalist, etc.).
