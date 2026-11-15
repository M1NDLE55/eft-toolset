# SPDX-License-Identifier: GPL-3.0-or-later
# Part of EFT Toolset. Builds the generic low-poly gun parts the gun builder's 3D view draws.
#
# Every shape here is original and built from code: boxes, spun profiles and extruded side
# outlines with dimensions from general real-world knowledge. Nothing is taken from Escape from
# Tarkov or any other game, traced from meshes or photos, or copied from a maker's design, and
# nothing carries a logo or brand name.
#
# Run it through Blender, not plain Python (see scripts/models/README.md):
#   blender -b --factory-startup --python scripts/models/gun_parts.py -- --out <file.glb> [--preview <directory>]
#
# Each part sits in its own frame, in centimetres, sized like the box the 3D view would otherwise
# draw for it (see src/app/lib/builds/build-scene.ts). Beside each part is an empty named
# "<part>__mount" at the point where it attaches to its parent: the bottom of parts that sit on top
# of something, the top of parts that hang below, the rear of parts that run forward, the front of
# parts that run back, and the middle of bodies and receivers.

import math
import os
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from meshkit import Part, arc, make_materials  # noqa: E402

PARTS = []


def part(fn):
    PARTS.append(fn)
    return fn


# -- bodies and receivers (stretched to fit; mounted at their middle) -------------------------


@part
def body_rifle():
    # A lower receiver: grip at 28% of its length, magazine well at 62%, trigger guard between.
    p = Part("body_rifle", (0, 0, -1.65))
    p.extrude(
        [(-13, 1.6), (13, 1.6), (13, -1.0), (11.5, -3.3), (5.6, -3.3), (5.6, -4.9), (0.6, -4.9),
         (0.6, -3.3), (-7.4, -3.3), (-10.5, -2.4), (-13, -1.2)],
        -1.65, 1.65, bevel=0.18,
    )
    # Magazine well flare and trigger guard.
    p.box((3.1, 0, -4.6), (5.6, 3.6, 0.6), "accent", bevel=0.1)
    p.extrude([(-4.4, -3.3), (0.6, -3.3), (0.6, -4.9), (-4.4, -4.9), (-4.4, -4.5), (0.2, -4.5), (0.2, -3.7), (-4.4, -3.7)],
              -0.5, 0.5, "accent")
    # Pins, the bolt catch and the magazine release.
    for x, z in ((-8.5, -0.8), (-3.6, -1.6), (-1.6, -1.6), (9.5, 0.4)):
        p.cylinder((x, -1.75, z), (x, 1.75, z), 0.28, "accent", segments=10)
    p.box((5.0, -1.72, -1.2), (1.2, 0.2, 1.0), "accent")
    p.box((7.6, 1.72, -0.6), (1.6, 0.2, 0.7), "accent")
    return p


@part
def body_bullpup():
    # A bullpup body: magazine well at 30%, grip at 60%, a rounded butt at the rear.
    p = Part("body_bullpup", (0, 0, -1.9))
    p.extrude(
        [(-21, 1.6), (22, 1.6), (22, -1.4), (20, -3.6), (6.4, -3.6), (6.4, -5.4), (2.0, -5.4), (2.0, -3.6),
         (-6.0, -3.6), (-6.0, -5.4), (-11.6, -5.4), (-11.6, -3.6), (-19.5, -3.6), (-22, -2.6), (-22, 0.4)],
        -2.2, 2.2, bevel=0.3,
    )
    p.box((-8.8, 0, -5.0), (6.4, 4.4, 0.8), "accent", bevel=0.12)
    p.extrude([(1.0, -3.6), (8.0, -3.6), (8.0, -5.4), (1.0, -5.4), (1.0, -5.0), (7.6, -5.0), (7.6, -4.0), (1.0, -4.0)],
              -0.6, 0.6, "accent")
    # Cheek rest and ejection port cover.
    p.box((-14, 0, 1.75), (10, 3.6, 0.3), "accent", bevel=0.1)
    p.box((-9, -2.25, -0.4), (5, 0.2, 1.6), "accent")
    return p


@part
def body_pistol():
    # A pistol frame: an accessory rail under the dust cover and a trigger guard.
    p = Part("body_pistol", (0, 0, -2.9))
    p.extrude([(-9, -1.3), (9, -1.3), (9, -3.0), (2.8, -3.0), (2.8, -4.5), (-3.2, -4.5), (-6.0, -3.0), (-9, -3.0)],
              -1.4, 1.4, bevel=0.15)
    p.box((6.2, 0, -3.25), (5.2, 2.2, 0.5), "accent")
    p.extrude([(-3.0, -3.0), (2.8, -3.0), (2.8, -4.5), (-3.0, -4.5), (-3.0, -4.15), (2.4, -4.15), (2.4, -3.3), (-3.0, -3.3)],
              -0.45, 0.45, "accent")
    return p


@part
def body_plain():
    # A receiver without a magazine well, for shotguns and bolt-actions.
    p = Part("body_plain", (0, 0, -1.4))
    p.extrude([(-13, 1.6), (13, 1.6), (13, -2.2), (10, -4.4), (-8, -4.4), (-13, -2.0)], -1.9, 1.9, bevel=0.25)
    p.box((1.0, -1.95, -0.2), (7, 0.2, 2.0), "accent")
    p.extrude([(-4.4, -4.4), (0.8, -4.4), (0.8, -5.6), (-4.4, -5.6), (-4.4, -5.2), (0.4, -5.2), (0.4, -4.7), (-4.4, -4.7)],
              -0.45, 0.45, "accent")
    return p


@part
def receiver_upper():
    # An upper receiver with a full-length top rail, ejection port and forward assist.
    p = Part("receiver_upper", (0, 0, 1.2))
    p.extrude([(-12.5, 0), (12.5, 0), (12.5, 1.5), (-12.5, 1.5)], -1.7, 1.7, bevel=0.15)
    p.rail(-12.3, 12.3, 1.5, width=2.2, base=0.55, teeth_height=0.3)
    p.box((1.5, -1.75, 0.7), (5.5, 0.2, 1.0), "accent")
    p.cylinder((-6.5, -1.4, 1.0), (-6.5, -2.5, 0.4), 0.45, "accent", segments=10)
    return p


@part
def dust_cover():
    # A ribbed, round-topped cover, as on Kalashnikov-pattern rifles.
    p = Part("dust_cover", (0, 0, 1.2))
    p.extrude([(-12.5, 0), (12.5, 0), (12.5, 1.2), (11.5, 2.2), (-12.5, 2.2)], -1.7, 1.7, bevel=0.3)
    for x in (-9, -6, -3, 0):
        p.box((x, 0, 2.2), (0.6, 2.6, 0.18), "accent")
    p.box((10.4, 0, 2.0), (1.4, 1.0, 0.6), "accent", bevel=0.1)
    return p


@part
def slide():
    # A pistol slide with rear serrations, an ejection port and a step at the muzzle end.
    p = Part("slide", (0, 0, 1.4))
    p.extrude([(-9.5, 0), (9.5, 0), (9.5, 2.4), (8.5, 2.8), (-9.5, 2.8)], -1.33, 1.33, bevel=0.2)
    for index in range(6):
        x = -8.8 + index * 0.6
        p.box((x, 0, 1.4), (0.25, 2.76, 2.0), "accent")
    p.box((0.5, -0.4, 2.8), (3.6, 1.2, 0.12), "accent")
    return p


# -- along the bore (stretched; mounted at the rear) --------------------------------------------


@part
def barrel():
    p = Part("barrel")
    p.lathe([(0, 0.8), (7, 0.8), (8.5, 0.62), (19.5, 0.62), (19.8, 0.7), (22.4, 0.7), (22.7, 0.6),
             (36.4, 0.6), (37, 0.48)], segments=18)
    return p


@part
def muzzle_flash_hider():
    p = Part("muzzle_flash_hider")
    p.lathe([(0, 0.85), (0.9, 1.0), (1.4, 1.2), (5, 1.2), (5, 0.9)], segments=16)
    for index in range(5):
        angle = 2 * math.pi * index / 5
        p.box((3.4, 1.15 * math.cos(angle), 1.15 * math.sin(angle)), (2.8, 0.32, 0.32), "accent")
    return p


@part
def muzzle_brake():
    p = Part("muzzle_brake")
    p.lathe([(0, 0.85), (0.6, 1.1), (5, 1.2), (5, 0.8)], segments=8)
    for x in (1.6, 2.8, 4.0):
        p.box((x, 0, 0.2), (0.55, 2.5, 1.2), "accent")
    return p


@part
def suppressor():
    p = Part("suppressor")
    p.lathe([(0, 1.0), (0.8, 1.45), (1.6, 1.8), (15, 1.8), (15.6, 1.6), (16, 1.0)], segments=24)
    p.lathe([(1.2, 1.86), (2.6, 1.86)], "accent", segments=24, cap=False)
    p.lathe([(15.2, 1.7), (15.95, 1.1)], "accent", segments=24, cap=False)
    return p


@part
def muzzle_adapter():
    p = Part("muzzle_adapter")
    p.lathe([(0, 0.8), (1.5, 0.8), (1.7, 1.2), (3.6, 1.2), (3.8, 1.0), (5, 1.0)], segments=12)
    p.lathe([(1.8, 1.24), (2.6, 1.24)], "accent", segments=12, cap=False)
    return p


@part
def gas_block():
    # Mounted at its middle; it sits over the barrel.
    p = Part("gas_block")
    p.lathe([(-1.5, 1.0), (1.5, 1.0)], segments=14, center=(0, 0, -0.4))
    p.box((0, 0, 0.6), (3, 1.9, 1.6), bevel=0.2)
    for x in (-0.8, 0.8):
        p.cylinder((x, 0, 1.3), (x, 0, 1.45), 0.25, "accent", segments=8)
    return p


@part
def gas_tube():
    p = Part("gas_tube")
    p.lathe([(0, 0.8), (18, 0.8)], segments=14)
    p.box((17.2, 0, -0.4), (1.6, 1.6, 2.4), "accent", bevel=0.15)
    return p


@part
def handguard_rail():
    # A four-sided rail handguard.
    p = Part("handguard_rail")
    p.extrude([(0, -1.9), (20, -1.9), (20, 1.9), (0, 1.9)], -1.75, 1.75, bevel=0.35)
    p.rail(0.3, 19.7, 1.75, width=2.1, base=0.15, teeth_height=0.4)
    p.box((10, 0, -2.1), (19.4, 2.1, 0.4), "accent")
    for side in (-1, 1):
        p.box((10, side * 1.95, 0), (19.4, 0.3, 2.1), "accent")
        for index in range(19):
            p.box((0.8 + index, side * 2.05, 0), (0.5, 0.3, 2.2), "accent")
    return p


@part
def handguard_mlok():
    # A slim free-float tube with slot panels and a top rail.
    p = Part("handguard_mlok")
    p.lathe([(0, 2.0), (0.6, 2.0), (0.6, 1.9), (20, 1.9)], segments=8)
    p.rail(0.4, 19.6, 1.75, width=2.0, base=0.2, teeth_height=0.33)
    for index in range(5):
        x = 2.2 + index * 3.6
        for angle in (-90, -45, -135, 45, 135):
            rad = math.radians(angle)
            p.box((x, 1.86 * math.cos(rad), 1.86 * math.sin(rad)), (2.4, 0.5 if abs(math.cos(rad)) > 0.5 else 0.3,
                                                                       0.3 if abs(math.cos(rad)) > 0.5 else 0.5), "accent")
    p.lathe([(0, 2.06), (0.6, 2.06)], "accent", segments=8, cap=False)
    return p


@part
def handguard_classic():
    # A round, ribbed handguard, the shape of carbine and wooden furniture.
    p = Part("handguard_classic")
    p.lathe([(0, 2.25), (1.0, 2.3), (1.2, 2.05), (18.6, 1.85), (18.8, 2.1), (20, 2.1)], segments=16)
    for index in range(9):
        x = 2.4 + index * 1.8
        p.lathe([(x, 2.06 - 0.02 * index), (x + 0.5, 2.06 - 0.02 * index)], "accent", segments=16, cap=False)
    return p


# -- running back (stretched; mounted at the front) ---------------------------------------------


@part
def buffer_tube():
    p = Part("buffer_tube")
    p.lathe([(-16, 1.25), (-15.6, 1.4), (-1.6, 1.4), (-1.6, 1.75), (0, 1.75)], segments=16)
    for index in range(6):
        p.box((-15 + index * 2.2, 0, -1.4), (0.9, 0.9, 0.3), "accent")
    return p


@part
def stock_adjustable():
    # A collapsible stock with a tube channel, sling slot and rubber pad.
    p = Part("stock_adjustable")
    p.extrude([(0, 3.2), (-4, 3.4), (-20.5, 3.8), (-21.2, 4.0), (-21.2, -4.0), (-17, -4.0), (-8, -0.6), (-3, 1.0), (0, 1.2)],
              -1.7, 1.7, bevel=0.3)
    p.box((-21.6, 0, 0), (0.8, 3.5, 8.0), "accent", bevel=0.2)
    p.box((-10, 0, -1.6), (3.2, 3.5, 0.9), "accent")
    p.box((-2.5, 0, 0.9), (4, 3.0, 0.6), "accent", bevel=0.1)
    return p


@part
def stock_fixed():
    # A fixed rifle stock: a slim wrist behind the receiver, a raised comb and a curved underline.
    p = Part("stock_fixed")
    under = [(x, z) for x, z in arc(-12.5, 6.5, 11.2, -48, -118, 7)]
    p.extrude([(0, 1.6), (-5, 1.9), (-9, 3.3), (-20.6, 4.0), (-21.2, 4.0), (-21.2, -4.0),
               *reversed(under), (-3, -1.6), (0, -2.0)],
              -1.6, 1.6, bevel=0.35)
    p.box((-21.6, 0, 0), (0.8, 3.3, 8.0), "accent", bevel=0.2)
    p.cylinder((-15, 0, -3.1), (-15, 0, -3.9), 0.35, "accent", segments=8)
    return p


@part
def stock_skeleton():
    # A folding or skeleton stock: an open frame with a butt plate.
    p = Part("stock_skeleton")
    p.extrude([(0, 2.2), (-19.5, 3.4), (-19.5, 2.4), (0, 1.2)], -1.1, 1.1, bevel=0.15)
    p.extrude([(0, -0.8), (-19.5, -3.0), (-19.5, -4.0), (0, -2.0)], -1.1, 1.1, bevel=0.15)
    p.box((-20.2, 0, -0.3), (1.4, 3.2, 8.0), bevel=0.25)
    p.box((-0.6, 0, 0.2), (1.2, 2.6, 4.6), "accent", bevel=0.15)
    return p


@part
def stock_shell():
    # A bullpup's stock: the shell round the action, mounted at its middle.
    p = Part("stock_shell")
    p.extrude([(-15.4, 4.1), (13.0, 4.1), (15.4, 2.0), (15.4, -4.1), (-15.4, -4.1)], -2.6, 2.6, bevel=0.45)
    p.box((-6, 0, 4.15), (14, 3.8, 0.25), "accent", bevel=0.1)
    p.box((4, -2.65, -0.5), (6, 0.2, 3.4), "accent")
    return p


@part
def buttpad():
    p = Part("buttpad")
    p.extrude([(0, 3.8), (-2.0, 3.8), (-2.5, 3.2), (-2.5, -3.2), (-2.0, -3.8), (0, -3.8)], -2.2, 2.2, "accent", bevel=0.2)
    return p


# -- hanging below (mounted at their top) --------------------------------------------------------


@part
def grip():
    # A pistol grip with finger grooves and a beavertail, upright; the scene rakes it back.
    p = Part("grip")
    front = [(1.2, -1.0), (1.45, -2.6), (1.05, -3.4), (1.45, -4.3), (1.05, -5.2), (1.45, -6.1), (1.25, -8.3), (1.0, -9.0)]
    p.extrude([(1.6, 0), *front, (-1.4, -9.0), (-1.6, -8.4), (-1.3, -2.0), (-1.6, 0)], -1.4, 1.4, bevel=0.3)
    p.box((-0.2, 0, -8.85), (2.9, 2.9, 0.3), "accent", bevel=0.1)
    return p


@part
def foregrip_vertical():
    p = Part("foregrip_vertical")
    p.box((0, 0, -0.6), (3, 2.6, 1.2), "accent", bevel=0.15)
    p.cylinder((0, 0, -1.2), (0, 0, -8), 1.2, segments=12, bevel=0.1)
    for z in (-3.0, -4.6, -6.2):
        p.cylinder((0, 0, z), (0, 0, z - 0.4), 1.28, "accent", segments=12)
    return p


@part
def foregrip_angled():
    p = Part("foregrip_angled")
    p.extrude([(-1.5, 0), (1.5, 0), (1.5, -1.2), (0.4, -4.0), (-1.5, -2.0)], -1.3, 1.3, bevel=0.3)
    p.box((0, 0, -0.35), (3, 2.7, 0.7), "accent", bevel=0.1)
    return p


@part
def mag_curved():
    # A curved rifle magazine with side ribs and a base plate; it curves forward toward the bottom.
    p = Part("mag_curved")
    steps = 8
    sweep = 2.2

    def edge(x, t):
        return (x + sweep * t * t, -13.4 * t)

    back = [edge(-2.0, index / steps) for index in range(steps + 1)]
    front = [edge(2.0, index / steps) for index in range(steps, -1, -1)]
    p.extrude(back + front, -1.3, 1.3, bevel=0.15)
    p.box((sweep, 0, -13.7), (4.6, 2.8, 0.6), "accent", bevel=0.1)
    for index in range(3):
        t = (index + 1) / 4
        x, z = edge(0.0, t)
        for side in (-1, 1):
            p.box((x, side * 1.32, z), (2.8, 0.1, 0.45), "accent")
    return p


@part
def mag_straight():
    p = Part("mag_straight")
    p.extrude([(-1.5, 0), (1.5, 0), (1.5, -10.4), (-1.5, -10.4)], -1.1, 1.1, bevel=0.15)
    p.box((0, 0, -10.7), (3.4, 2.4, 0.6), "accent", bevel=0.12)
    return p


@part
def mag_drum():
    p = Part("mag_drum")
    p.box((0, 0, -2.5), (3.6, 2.6, 5), bevel=0.2)
    for side in (-1, 1):
        p.cylinder((0.6, side * 0.6, -8.6), (0.6, side * 3.5, -8.6), 4.2, segments=20, bevel=0.2)
        p.cylinder((0.6, side * 3.4, -8.6), (0.6, side * 3.55, -8.6), 1.2, "accent", segments=12)
    return p


@part
def mag_tube():
    # A shotgun's tube magazine; it runs forward from its rear.
    p = Part("mag_tube")
    p.lathe([(0, 1.2), (34, 1.2), (34.4, 1.05), (36, 1.05)], segments=14)
    p.lathe([(34.4, 1.12), (36, 1.12)], "accent", segments=14, cap=False)
    return p


@part
def mag_top():
    # A magazine that lies along the top of the gun; it sits on its base.
    p = Part("mag_top")
    p.box((0, 0, 1.5), (21.6, 4.0, 3.0), "lens", bevel=0.3)
    p.box((-10.6, 0, 1.5), (1.2, 4.2, 3.0), "accent", bevel=0.15)
    p.box((10.4, 0, 1.2), (1.6, 4.2, 2.4), "accent", bevel=0.15)
    return p


# -- sitting on top (mounted at their base) ------------------------------------------------------


@part
def optic_scope():
    # A magnified scope: tube, wide objective, eyepiece, turrets, rings on a base.
    p = Part("optic_scope", (0, 0, 0))
    z = 3.0
    p.lathe([(-7, 1.5), (-5.6, 1.5), (-4.8, 1.05), (3.2, 1.05), (5.0, 1.75), (7, 1.75)], segments=20, center=(0, 0, z))
    p.lathe([(-7.05, 1.3), (-7.05, 0.0)], "lens", segments=20, center=(0, 0, z), cap=False)
    p.lathe([(7.05, 0.0), (7.05, 1.55)], "lens", segments=20, center=(0, 0, z), cap=False)
    p.cylinder((0, 0, z + 1.0), (0, 0, z + 2.0), 0.7, "accent", segments=12)
    p.cylinder((0, -1.0, z), (0, -2.0, z), 0.7, "accent", segments=12)
    for x in (-3.0, 2.0):
        p.box((x, 0, 1.2), (1.4, 2.4, 2.4), "accent", bevel=0.1)
    p.box((-0.5, 0, 0.3), (8.6, 2.2, 0.6), "accent", bevel=0.1)
    return p


@part
def optic_reddot():
    # A small tube sight on a riser.
    p = Part("optic_reddot")
    p.box((0, 0, 0.6), (4.8, 2.6, 1.2), "accent", bevel=0.12)
    p.lathe([(-2.4, 1.3), (2.4, 1.3)], segments=16, center=(0, 0, 2.9))
    p.lathe([(-2.45, 1.1), (-2.45, 0.0)], "lens", segments=16, center=(0, 0, 2.9), cap=False)
    p.lathe([(2.45, 0.0), (2.45, 1.1)], "lens", segments=16, center=(0, 0, 2.9), cap=False)
    p.cylinder((0.6, 0, 4.0), (0.6, 0, 4.6), 0.45, "accent", segments=10)
    return p


@part
def optic_holo():
    # A box sight with an open window under a hood.
    p = Part("optic_holo")
    p.box((-0.8, 0, 0.9), (4.0, 3.0, 1.8), bevel=0.2)
    p.extrude([(-0.6, 1.8), (2.8, 1.8), (2.8, 4.6), (-0.6, 4.6), (-0.6, 4.2), (2.4, 4.2), (2.4, 2.2), (-0.6, 2.2)],
              -1.5, 1.5, bevel=0.1)
    p.box((1.0, 0, 3.2), (0.15, 2.6, 2.0), "lens")
    p.box((-0.2, 0, 0.15), (5.2, 2.4, 0.3), "accent")
    return p


@part
def rail():
    p = Part("rail")
    p.rail(-3.5, 3.5, 0, width=2.4, base=0.9, teeth_height=0.4, mat="body")
    return p


@part
def sight_rear():
    # A folding aperture sight.
    p = Part("sight_rear")
    p.box((0, 0, 0.35), (2.0, 1.6, 0.7), "accent", bevel=0.08)
    for side in (-1, 1):
        p.box((0, side * 0.6, 1.5), (0.6, 0.35, 1.8), bevel=0.06)
    p.box((0, 0, 2.15), (0.6, 1.5, 0.5), bevel=0.06)
    return p


@part
def sight_front():
    # A post between two protective ears.
    p = Part("sight_front")
    p.box((0, 0, 0.35), (2.0, 1.6, 0.7), "accent", bevel=0.08)
    for side in (-1, 1):
        p.extrude([(-0.5, 0.7), (0.5, 0.7), (0.3, 2.4), (-0.3, 2.4)], side * 0.45, side * 0.8)
    p.box((0, 0, 1.6), (0.25, 0.25, 1.6), "accent")
    return p


@part
def tactical_light():
    # A weapon light on a rail clamp; it sits on whichever side its rail faces.
    p = Part("tactical_light")
    p.box((-0.5, 0, 0.4), (3.0, 2.4, 0.8), "accent", bevel=0.1)
    p.lathe([(-3.0, 1.0), (1.8, 1.0), (2.2, 1.3), (3.0, 1.3)], segments=14, center=(0, 0, 1.6))
    p.lathe([(3.02, 0.0), (3.02, 1.15)], "lens", segments=14, center=(0, 0, 1.6), cap=False)
    return p


@part
def tactical_laser():
    # A boxy laser or illuminator unit with two emitters.
    p = Part("tactical_laser")
    p.box((0, 0, 0.35), (4.0, 2.4, 0.7), "accent", bevel=0.1)
    p.box((0, 0, 1.75), (6.0, 2.6, 2.1), bevel=0.25)
    for z in (1.25, 2.25):
        p.cylinder((3.0, 0, z), (3.05, 0, z), 0.4, "lens", segments=10)
    return p


@part
def charge():
    # A T-shaped charging handle.
    p = Part("charge")
    p.box((0, 0, 0.3), (4.0, 0.9, 0.6), bevel=0.08)
    p.extrude([(-2.0, 0), (-1.0, 0), (-1.0, 1.4), (-2.0, 1.4)], -0.9, 0.9, bevel=0.1)
    return p


@part
def bipod():
    # Two splayed legs from a clamp; mounted at the top.
    p = Part("bipod")
    p.box((0, 0, -0.7), (2.5, 3.0, 1.4), "accent", bevel=0.15)
    for side in (-1, 1):
        p.cylinder((0, side * 1.0, -1.2), (0, side * 2.8, -9.8), 0.38, segments=10)
        p.box((0, side * 2.85, -9.8), (1.2, 1.0, 0.4), "accent")
    return p


@part
def launcher():
    # An underbarrel launcher tube with its trigger unit; mounted at the top.
    p = Part("launcher")
    p.box((0, 0, -0.5), (16, 2.6, 1.0), "accent", bevel=0.15)
    p.lathe([(-12, 2.3), (11, 2.3), (12, 2.0)], segments=18, center=(0, 0, -2.6))
    p.lathe([(12.02, 0.0), (12.02, 1.6)], "accent", segments=18, center=(0, 0, -2.6), cap=False)
    p.box((-9.5, 0, -5.4), (2.6, 2.0, 1.8), bevel=0.2)
    return p


@part
def generic():
    p = Part("generic")
    p.box((0, 0, 1.0), (3, 2, 2), bevel=0.25)
    return p


# -- export and preview -------------------------------------------------------------------------


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_all():
    materials = make_materials()
    collection = bpy.data.collections.new("gun_parts")
    bpy.context.scene.collection.children.link(collection)
    built = []
    for fn in PARTS:
        obj, empty = fn().build(collection, materials)
        built.append((obj, empty))
    return built


def export_glb(path, built):
    bpy.ops.object.select_all(action="DESELECT")
    for obj, empty in built:
        obj.select_set(True)
        empty.select_set(True)
    bpy.context.view_layer.objects.active = built[0][0]
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_yup=True,
        export_apply=True,
        export_normals=True,
        export_texcoords=False,
        export_materials="EXPORT",
        export_cameras=False,
        export_lights=False,
        export_animations=False,
        export_extras=False,
    )


def render_preview(directory, built):
    """Renders each part on its own, framed to fit, so each can be checked by eye."""
    import mathutils

    os.makedirs(directory, exist_ok=True)
    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("preview")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("preview", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    for rotation, energy in (((50, 10, -30), 3.2), ((-60, 0, 150), 1.0)):
        light_data = bpy.data.lights.new("sun", "SUN")
        light_data.energy = energy
        light = bpy.data.objects.new("sun", light_data)
        light.rotation_euler = tuple(math.radians(value) for value in rotation)
        scene.collection.objects.link(light)
    world = bpy.data.worlds.new("preview")
    world.color = (0.05, 0.05, 0.05)
    scene.world = world
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 480
    scene.render.resolution_y = 320
    scene.render.film_transparent = False
    # Muzzle to the right, seen a little from the front, right and above, as in the app.
    direction = mathutils.Vector((0.3, -1.0, 0.35)).normalized()
    for obj, _ in built:
        obj.hide_render = True
    for obj, _ in built:
        obj.hide_render = False
        corners = [obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box]
        low = mathutils.Vector([min(c[i] for c in corners) for i in range(3)])
        high = mathutils.Vector([max(c[i] for c in corners) for i in range(3)])
        center = (low + high) / 2
        span = max((high - low).length, 1.0)
        # The tile is 3:2 and the ortho scale sets its width, so tall parts need more room.
        camera_data.ortho_scale = span * 1.5
        camera.location = center + direction * span * 4
        camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
        camera_data.clip_end = span * 10
        scene.render.filepath = os.path.join(directory, f"{obj.name}.png")
        bpy.ops.render.render(write_still=True)
        obj.hide_render = True


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    out = argv[argv.index("--out") + 1] if "--out" in argv else None
    preview = argv[argv.index("--preview") + 1] if "--preview" in argv else None
    reset_scene()
    built = build_all()
    if out:
        export_glb(os.path.abspath(out), built)
        print(f"Exported {len(built)} parts to {out}")
    if preview:
        render_preview(os.path.abspath(preview), built)
        print(f"Rendered previews to {preview}")


if __name__ == "__main__":
    main()
