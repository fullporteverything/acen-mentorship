"""s7_build.py -- build the whole Suite 7 blackjack scene and export the glb.

    blender --background --python s7_build.py

Produces out/table-assets.glb containing:
    objects   Table . Shoe . DiscardTray . ChipTray . Card7S . Chip7
    clips     CardDeal . CardFlip . CardDiscard . ChipToss

and then re-imports it into a fresh scene to prove every name survived.
"""

import os
import sys
import math

import bpy

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import s7_common as C
import s7_table as T
import s7_props as P
import s7_clips as K
import s7_table5 as T5
import s7_dealer as DL

OBJECTS = ("Table", "Shoe", "DiscardTray", "ChipTray", "Card7S", "Chip7",
           "Table5", "Dealer")
CLIPS = ("CardDeal", "CardFlip", "CardDiscard", "ChipToss",
         "ChipPayout", "ChipSweep", "ShoeRefill", "TableIntro",
         "DealerIdle", "DealerDeal", "DealerFlip", "DealerSweep")

# clips the site must loop rather than play once
LOOPING = ("DealerIdle",)
GLB = "table-assets.glb"

TRI_BUDGET = 140000   # raised by WORKORDER-2


def build_all():
    C.clear_scene()
    T.build_table()
    T5.build_table5()
    P.build_props()
    K.build_clips()
    DL.build_all()
    bpy.data.objects["Card7S"].location = (0.0, 0.0, K.CARD_REST_Z)
    bpy.data.objects["Chip7"].location = (T.BET_CIRCLE[0], T.BET_CIRCLE[1],
                                          K.CHIP_REST_Z)
    return {n: bpy.data.objects[n] for n in OBJECTS}


def export_glb(path=None):
    """glTF binary, animations on, NLA strips named after the actions, +Y up.

    export_animation_mode='NLA_TRACKS' takes each glTF animation name from
    its NLA TRACK, which is why s7_clips names track, strip and action
    identically -- the clip name then survives regardless of which naming
    rule the exporter applies.
    """
    path = path or C.outpath(GLB)
    kw = dict(
        filepath=path,
        export_format="GLB",
        export_yup=True,
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_frame_range=False,
        export_bake_animation=False,
        export_optimize_animation_size=False,
        export_apply=True,
        export_materials="EXPORT",
        use_selection=False,
    )
    # the exporter's keyword set drifts between Blender releases; drop the
    # optional ones rather than dying on a single stale kwarg
    try:
        bpy.ops.export_scene.gltf(**kw)
    except TypeError as exc:
        print("WARN: exporter rejected a kwarg (%s); retrying reduced" % exc)
        for k in ("export_optimize_animation_size", "export_bake_animation",
                  "export_frame_range"):
            kw.pop(k, None)
        bpy.ops.export_scene.gltf(**kw)
    return path


def verify_glb(path=None):
    """Import the glb into a FRESH scene and assert the contract held."""
    path = path or C.outpath(GLB)
    C.clear_scene()
    bpy.ops.import_scene.gltf(filepath=path)

    names = {o.name for o in bpy.data.objects}
    acts = {a.name for a in bpy.data.actions}
    # the importer may suffix a clip when it collides with an existing name
    def present(want, pool):
        return want in pool or any(n.split(".")[0] == want for n in pool)

    missing_obj = [n for n in OBJECTS if not present(n, names)]
    missing_clip = [n for n in CLIPS if not present(n, acts)]
    return {
        "objects_found": sorted(names),
        "clips_found": sorted(acts),
        "missing_objects": missing_obj,
        "missing_clips": missing_clip,
        "ok": not missing_obj and not missing_clip,
    }


def _main():
    build_all()
    tris = C.tri_count()
    print("tris:", tris, "budget", TRI_BUDGET,
          "OK" if tris <= TRI_BUDGET else "OVER BUDGET")
    bpy.ops.wm.save_as_mainfile(filepath=C.outpath("s7_scene.blend"))
    p = export_glb()
    print("exported:", p, os.path.getsize(p), "bytes")
    r = verify_glb(p)
    print("verify:", "PASS" if r["ok"] else "FAIL")
    print("  objects:", r["objects_found"])
    print("  clips:  ", r["clips_found"])
    if not r["ok"]:
        print("  MISSING objects:", r["missing_objects"])
        print("  MISSING clips:  ", r["missing_clips"])
        raise SystemExit(1)


if __name__ == "__main__":
    sys.exit(C.run(_main, "s7_build"))
