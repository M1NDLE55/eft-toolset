# SPDX-License-Identifier: GPL-3.0-or-later
# Part of EFT Toolset. Small helpers for building low-poly parts in Blender with bmesh.
#
# Every part is built in centimetres in its own frame: +X runs toward the muzzle, +Z is up, and
# -Y is the gun's right side (glTF export turns this into +X forward, +Y up, +Z right).

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# Material slots every part shares. The app colours them: "body" takes the part's colour,
# "accent" a darker shade, and "lens" a glass tint.
MATERIALS = ("body", "accent", "lens")


class Part:
    """A part under construction: one bmesh, plus the point where it attaches to its parent."""

    def __init__(self, name, mount=(0.0, 0.0, 0.0)):
        self.name = name
        self.bm = bmesh.new()
        self.mount = Vector(mount)

    # -- primitives -------------------------------------------------------------------------

    def box(self, center, size, mat="body", bevel=0.0):
        """An axis-aligned box, optionally with bevelled edges."""
        result = bmesh.ops.create_cube(self.bm, size=1.0)
        verts = result["verts"]
        bmesh.ops.scale(self.bm, vec=Vector(size), verts=verts)
        bmesh.ops.translate(self.bm, vec=Vector(center), verts=verts)
        return self._finish(verts, mat, bevel)

    def lathe(self, profile, mat="body", segments=20, center=(0.0, 0.0, 0.0), cap=True, bevel=0.0):
        """Spins a profile of (x, radius) points round an axis along X through `center`."""
        cx, cy, cz = center
        rings = []
        for x, radius in profile:
            if radius <= 1e-6:
                # A point on the axis: one vertex, so the faces meeting it are triangles, not slivers.
                rings.append([self.bm.verts.new((cx + x, cy, cz))] * segments)
                continue
            ring = []
            for index in range(segments):
                angle = 2 * math.pi * index / segments
                ring.append(
                    self.bm.verts.new((cx + x, cy + radius * math.cos(angle), cz + radius * math.sin(angle)))
                )
            rings.append(ring)
        faces = []
        for a, b in zip(rings, rings[1:]):
            for index in range(segments):
                nxt = (index + 1) % segments
                corners = []
                for vert in (a[index], a[nxt], b[nxt], b[index]):
                    if vert not in corners:
                        corners.append(vert)
                if len(corners) >= 3:
                    faces.append(self.bm.faces.new(corners))
        if cap:
            if profile[0][1] > 1e-6:
                faces.append(self.bm.faces.new(list(reversed(rings[0]))))
            if profile[-1][1] > 1e-6:
                faces.append(self.bm.faces.new(rings[-1]))
        verts = list(dict.fromkeys(vert for ring in rings for vert in ring))
        return self._finish(verts, mat, bevel)

    def extrude(self, outline, y0, y1, mat="body", bevel=0.0):
        """A side profile of (x, z) points, extruded across from y0 to y1."""
        front = [self.bm.verts.new((x, y0, z)) for x, z in outline]
        back = [self.bm.verts.new((x, y1, z)) for x, z in outline]
        count = len(outline)
        self.bm.faces.new(front)
        self.bm.faces.new(list(reversed(back)))
        for index in range(count):
            nxt = (index + 1) % count
            self.bm.faces.new((front[index], back[index], back[nxt], front[nxt]))
        return self._finish(front + back, mat, bevel)

    def cylinder(self, start, end, radius, mat="body", segments=16, bevel=0.0):
        """A cylinder between two points, built along X then turned into place."""
        a, b = Vector(start), Vector(end)
        axis = b - a
        verts = self.lathe([(0.0, radius), (axis.length, radius)], mat, segments, cap=True)
        rotation = Vector((1.0, 0.0, 0.0)).rotation_difference(axis.normalized()).to_matrix().to_4x4()
        bmesh.ops.transform(self.bm, matrix=Matrix.Translation(a) @ rotation, verts=verts)
        if bevel:
            self._bevel(verts, bevel)
        return verts

    def rail(self, x0, x1, z, width=2.2, base=0.55, teeth_height=0.32, mat="accent", y=0.0):
        """A picatinny-style rail: a base strip with cross teeth on a 1 cm pitch."""
        length = x1 - x0
        self.box(((x0 + x1) / 2, y, z + base / 2), (length, width, base), mat, bevel=0.06)
        count = max(1, int(length // 1.0))
        pitch = length / count
        for index in range(count):
            x = x0 + pitch * (index + 0.5)
            self.box((x, y, z + base + teeth_height / 2), (pitch * 0.52, width * 1.08, teeth_height), mat)

    # -- helpers ----------------------------------------------------------------------------

    def _finish(self, verts, mat, bevel):
        faces = {face for vert in verts for face in vert.link_faces}
        index = MATERIALS.index(mat)
        for face in faces:
            face.material_index = index
        if bevel > 0:
            self._bevel(verts, bevel, index)
        return verts

    def _bevel(self, verts, offset, index=None):
        edges = list({edge for vert in verts for edge in vert.link_edges})
        result = bmesh.ops.bevel(
            self.bm,
            geom=edges,
            offset=offset,
            offset_type="OFFSET",
            segments=1,
            profile=0.5,
            affect="EDGES",
            clamp_overlap=True,
        )
        if index is not None:
            for face in result.get("faces", []):
                face.material_index = index

    def build(self, collection, materials):
        """Turns the bmesh into a mesh object, with a mount empty beside it (not parented)."""
        bmesh.ops.recalc_face_normals(self.bm, faces=self.bm.faces)
        # Triangulate here, by ear clipping, so concave outlines split the same way every run and
        # rebuilding gives a byte-identical file.
        bmesh.ops.triangulate(self.bm, faces=self.bm.faces[:], quad_method="FIXED", ngon_method="EAR_CLIP")
        # Some bmesh operators create elements in an order that varies between runs; sort them.
        # bmesh sorts by a number, so rank the elements first.
        def rank(elements, key):
            order = {element: index for index, element in enumerate(sorted(elements, key=key))}
            return lambda element: order[element]

        def vert_key(vert):
            return (round(vert.co.x, 4), round(vert.co.y, 4), round(vert.co.z, 4))

        def face_key(face):
            center = face.calc_center_median()
            corners = sorted(vert_key(vert) for vert in face.verts)
            return (face.material_index, round(center.x, 4), round(center.y, 4), round(center.z, 4), corners)

        self.bm.verts.sort(key=rank(self.bm.verts, vert_key))
        self.bm.faces.sort(key=rank(self.bm.faces, face_key))
        mesh = bpy.data.meshes.new(self.name)
        self.bm.to_mesh(mesh)
        self.bm.free()
        for material in materials:
            mesh.materials.append(material)
        mesh.shade_smooth()
        mesh.set_sharp_from_angle(angle=math.radians(32))
        obj = bpy.data.objects.new(self.name, mesh)
        collection.objects.link(obj)
        # Not a child of the mesh: the GLB is quantized afterwards, which rescales mesh nodes.
        # Names avoid "." because three.js strips it from node names.
        empty = bpy.data.objects.new(f"{self.name}__mount", None)
        empty.empty_display_type = "PLAIN_AXES"
        empty.empty_display_size = 1.0
        empty.location = self.mount
        collection.objects.link(empty)
        return obj, empty


def arc(cx, cz, radius, start_deg, end_deg, steps):
    """Points along a circular arc in the XZ plane, for profiles."""
    points = []
    for index in range(steps + 1):
        angle = math.radians(start_deg + (end_deg - start_deg) * index / steps)
        points.append((cx + radius * math.cos(angle), cz + radius * math.sin(angle)))
    return points


def make_materials():
    colours = {"body": (0.45, 0.44, 0.41, 1.0), "accent": (0.12, 0.12, 0.12, 1.0), "lens": (0.1, 0.22, 0.3, 1.0)}
    materials = []
    for name in MATERIALS:
        material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
        material.diffuse_color = colours[name]
        material.use_nodes = True
        bsdf = material.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = colours[name]
            bsdf.inputs["Roughness"].default_value = 0.6
            bsdf.inputs["Metallic"].default_value = 0.3 if name != "lens" else 0.0
        materials.append(material)
    return materials
