// Shared data: 2hire support's own suggested test-trip payload (attached to
// their reply on the multi-leg-trip webhook-delivery investigation, see
// project_2hire_test_migration_roadmap in memory) — copied verbatim from
// their email, not retyped (then programmatically diffed against the source
// to rule out a transcription error — one single-digit slip was caught and
// fixed this way). Confirmed live (2026-07-31, CS30731) to be the first
// payload in this whole investigation to actually deliver `distance_covered`
// and `autonomy_percentage` via webhook, alongside `position` — every
// earlier attempt (a 2-waypoint near-zero-distance push, a 5-city
// hundreds-of-km tour, and even an 11-step ~33m-spaced synthetic approach
// trip) delivered neither, or in the 11-step case, nothing at all. 2hire's
// own explanation: their simulator enforces production-like constraints on
// trip duration (leg count) and inter-coordinate distance (filtered to the
// 5th decimal place) that a malformed array silently fails on rather than
// erroring — exactly which constraint the shorter synthetic trip violated
// isn't confirmed, so rather than keep guessing at leg count/spacing/
// straight-line-vs-curved-path in isolation, `vehicleTelemetrySync.ts`'s
// `buildApproachTrip` now reuses this exact proven-working shape (leg count,
// per-leg distances, and curvature all preserved), translated so its final
// waypoint lands on whatever real target position is needed — see that
// file for how.
import type { SimulatedTripPosition } from "./twoHireClient.js";

export const TWOHIRE_REFERENCE_TRIP: SimulatedTripPosition[] = [
  { longitude: 16.40800095, latitude: 41.28157043 },
  { longitude: 16.40800095, latitude: 41.28157043 },
  { longitude: 16.40813446, latitude: 41.28155899 },
  { longitude: 16.40843773, latitude: 41.28147888 },
  { longitude: 16.4091568, latitude: 41.28125763 },
  { longitude: 16.40961075, latitude: 41.28110886 },
  { longitude: 16.41008949, latitude: 41.28097534 },
  { longitude: 16.41054916, latitude: 41.28082657 },
  { longitude: 16.41089821, latitude: 41.28064728 },
  { longitude: 16.41128922, latitude: 41.28036499 },
  { longitude: 16.4118576, latitude: 41.2800293 },
  { longitude: 16.41235352, latitude: 41.27972412 },
  { longitude: 16.41286659, latitude: 41.27938843 },
  { longitude: 16.41321754, latitude: 41.27915192 },
  { longitude: 16.41345406, latitude: 41.2789917 },
  { longitude: 16.41383743, latitude: 41.2787323 },
  { longitude: 16.41433334, latitude: 41.27839661 },
  { longitude: 16.41477585, latitude: 41.27812958 },
  { longitude: 16.41526031, latitude: 41.27780151 },
  { longitude: 16.41585922, latitude: 41.27742004 },
  { longitude: 16.41646194, latitude: 41.27703857 },
  { longitude: 16.41694069, latitude: 41.27672958 },
  { longitude: 16.41749763, latitude: 41.276371 },
  { longitude: 16.41789246, latitude: 41.27613831 },
  { longitude: 16.41820335, latitude: 41.27596283 },
  { longitude: 16.41846848, latitude: 41.27581024 },
  { longitude: 16.41872215, latitude: 41.27563477 },
  { longitude: 16.4189415, latitude: 41.27550125 },
  { longitude: 16.41929054, latitude: 41.27529144 },
  { longitude: 16.41947174, latitude: 41.27515793 },
  { longitude: 16.41983795, latitude: 41.27492142 },
  { longitude: 16.42040253, latitude: 41.27457428 },
  { longitude: 16.42101288, latitude: 41.27421188 },
  { longitude: 16.42132759, latitude: 41.27401733 },
  { longitude: 16.42181778, latitude: 41.27371979 },
  { longitude: 16.42241669, latitude: 41.27332687 },
  { longitude: 16.42264748, latitude: 41.27323914 },
  { longitude: 16.42299271, latitude: 41.27352142 },
  { longitude: 16.42321968, latitude: 41.27366638 },
  { longitude: 16.42396164, latitude: 41.27424622 },
  { longitude: 16.42435837, latitude: 41.27394867 },
  { longitude: 16.4245739, latitude: 41.27359772 },
  { longitude: 16.42477036, latitude: 41.27324677 },
  { longitude: 16.42494583, latitude: 41.27299881 },
  { longitude: 16.42508888, latitude: 41.27288055 },
  { longitude: 16.42525673, latitude: 41.27267456 },
  { longitude: 16.42546844, latitude: 41.27230453 },
  { longitude: 16.42587662, latitude: 41.27187347 },
  { longitude: 16.42615128, latitude: 41.27142334 },
  { longitude: 16.42647362, latitude: 41.27097321 },
  { longitude: 16.42659569, latitude: 41.27058411 },
  { longitude: 16.42635727, latitude: 41.27032471 },
  { longitude: 16.42692947, latitude: 41.26990891 },
  { longitude: 16.42767715, latitude: 41.26952744 },
  { longitude: 16.42837524, latitude: 41.26921082 },
  { longitude: 16.42904663, latitude: 41.26884842 },
  { longitude: 16.42972565, latitude: 41.26853561 },
  { longitude: 16.43040085, latitude: 41.26819229 },
  { longitude: 16.4309864, latitude: 41.26787186 },
  { longitude: 16.43162155, latitude: 41.26758575 },
  { longitude: 16.43228722, latitude: 41.26726151 },
  { longitude: 16.43294144, latitude: 41.26692581 },
  { longitude: 16.43363762, latitude: 41.26661301 },
  { longitude: 16.43431664, latitude: 41.26628113 },
  { longitude: 16.43498039, latitude: 41.26593781 },
  { longitude: 16.4356308, latitude: 41.26561737 },
  { longitude: 16.43624878, latitude: 41.26527786 },
  { longitude: 16.43689537, latitude: 41.26499557 },
  { longitude: 16.43754196, latitude: 41.26469803 },
  { longitude: 16.43815804, latitude: 41.26438904 },
  { longitude: 16.4387722, latitude: 41.26408768 },
];
