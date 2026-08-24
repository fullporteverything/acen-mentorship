# WORK ORDER · SPRINT 3 — fix the dealer's silhouette

The dealer is IN the live game and the rig, skinning and clips all work —
`DealerIdle` loops, the one-shots fire with the card actions, and the site
lights him properly. This is purely about **how he reads on screen**.

Blunt owner feedback on the shipped model: *"he looks like a lampshade /
a robot, not a guy in a suit."* Sprint 2's notes said the lampshade was
solved, but at the site's actual camera (base `(0, 7.25, 11.63)`, target
`(0, -0.20, -0.75)`, fov 36, looking slightly down at the table from the
player's seat) it still reads as a blocky torso with a cone on top. Fix
the silhouette; keep the rig, bone names, clip names and anchor.

## What's actually wrong, in priority order

1. **THE CONE AT THE NECK IS THE WHOLE PROBLEM.** The torso currently
   tapers up into a large cone/dome where the collar should be. That
   single shape is what makes him read as a lampshade or a faceless
   android. Replace it with real shirt anatomy:
   - a **flat, closed collar band** — a short cylinder/ring of shirt fabric
     with a visible fold, capped flat and DARK so it reads as shadow inside
     the collar, not as a head;
   - the collar **points** turning down over the jacket lapels;
   - a **black bow tie** sitting on the band. The bow tie is the single
     highest-value detail on this model — a bow tie at a collar reads
     instantly as "dealer" even in silhouette. It is currently missing or
     invisible at camera distance. Make it clearly readable at the framing
     above (roughly 21% of frame width for the whole figure).
   The whole neck assembly should be NARROW — a neck is ~⅓ the width of
   the shoulders. Right now the top is nearly as wide as the chest.

2. **Shoulders.** Currently square pads with a hard corner. Round them:
   a real shoulder is a sphere-ish deltoid rolling into the sleeve. Slope
   them down and outward slightly rather than sitting flat and horizontal.

3. **Arms.** They read as segmented tubes with visible gaps at the joints.
   Give the elbow a continuous transition (a joint sphere or a lofted
   sleeve), and taper the forearm toward the wrist. The cuff should be a
   distinct band with a little overhang, not a stripe.

4. **Shading.** The whole figure appears faceted/flat-shaded. Set smooth
   shading on the curved surfaces (torso, arms, collar) with sensible
   auto-smooth angle so hard edges (lapel, cuff, bow tie) stay crisp.
   Export normals. *(The site can force-smooth as a stopgap, but authored
   normals are correct.)*

5. **Jacket.** The open front with lapels and the gold V is working — keep
   it. Just make sure the lapel has real thickness at its edge and that
   the shirt V beneath is a lighter value than the jacket so it separates
   at distance.

## Constraints (unchanged)

- Object name stays `Dealer`; rig stays `DealerRig`; clip names stay
  `DealerIdle` `DealerDeal` `DealerFlip` `DealerSweep`; `DealerIdle` keeps
  looping seamlessly.
- Keep his anchor: standing centred in the dealer notch, neck ~2.5 above
  the felt at the site's scale, hands near the felt edge.
- Principled/PBR only, ≤35k tris (he's 3,292 now — there is a LOT of
  headroom; spend it on the collar, shoulders and hands).
- Re-verify by re-import AND by reading the .glb JSON (sprint 2's lesson:
  this Blender adds a phantom `Icosphere` on import).
- **Render a test image from the SITE'S camera angle** before calling it
  done — a turntable or a front orthographic view will hide exactly the
  problem being fixed. If he doesn't read as a person in a suit at that
  framing and that size, iterate before shipping.

## Also still open from sprint 2

- `Martini` as a mesh (PRIORITY 3.5 in WORKORDER-2) — the site is running
  a procedural three.js glass and would rather have the authored one.
  It now also needs the liquid as its own node, since the site tilts the
  glass while keeping the liquid surface level.
