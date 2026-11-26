# Blender (headless) script: build one MakeHuman character with MPFB from a JSON recipe and
# export it as a rigged .glb.
#   Blender -b --factory-startup? no: needs the MPFB extension enabled, so run with user prefs:
#   Blender -b --python build_human.py -- recipe.json out.glb [preview.png]
import bpy, sys, json, os, math

argv = sys.argv[sys.argv.index("--") + 1:]
recipe_path, out_path = argv[0], argv[1]
preview = argv[2] if len(argv) > 2 else None
recipe = json.load(open(recipe_path))

from bl_ext.blender_org.mpfb.services.humanservice import HumanService
from bl_ext.blender_org.mpfb.services.assetservice import AssetService
from bl_ext.blender_org.mpfb.services.targetservice import TargetService

AssetService.update_all_asset_lists()

# Empty scene
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

# Asset names: "folder/file.mhclo", or just the folder name (the first .mhclo/.mhmat inside is used)
from bl_ext.blender_org.mpfb.services.locationservice import LocationService
DATA = LocationService.get_user_data()
def asset(subdir, name, ext=".mhclo"):
    if not name or "/" in name:
        return name
    folder = os.path.join(DATA, subdir, name)
    if os.path.isdir(folder):
        for f in sorted(os.listdir(folder)):
            if f.endswith(ext):
                return name + "/" + f
    print("ASSET NOT FOUND:", subdir, name)
    return name
for key, sub in [("eyebrows", "eyebrows"), ("eyelashes", "eyelashes"), ("hair", "hair")]:
    if recipe.get(key):
        recipe[key] = asset(sub, recipe[key])
if recipe.get("skin"):
    recipe["skin"] = asset("skins", recipe["skin"], ".mhmat")
recipe["clothes"] = [asset("clothes", c) for c in recipe.get("clothes", [])]

info = {
    "name": recipe.get("name", "human"),
    "phenotype": {**TargetService.get_default_macro_info_dict(), **recipe.get("phenotype", {})},
    "rig": recipe.get("rig", "game_engine"),
    "eyes": recipe.get("eyes", "low-poly/low-poly.mhclo"),
    "eyebrows": recipe.get("eyebrows", ""),
    "eyelashes": recipe.get("eyelashes", ""),
    "tongue": "", "teeth": "",
    "hair": recipe.get("hair", ""),
    "proxy": recipe.get("proxy", ""),
    "targets": recipe.get("targets", []),
    "clothes": recipe.get("clothes", []),
    "skin_mhmat": recipe.get("skin", ""),
    "skin_material_type": "GAMEENGINE",
    "clothes_material_type": "GAMEENGINE",
    "eyes_material_type": "PROCEDURAL_EYES" if recipe.get("procedural_eyes") else "MAKESKIN",
    "skin_material_settings": {}, "eyes_material_settings": {},
    "expressions": [],
    "color_adjustments": {},
}
settings = HumanService.get_default_deserialization_settings()
settings["subdiv_levels"] = 0
settings["scale"] = 0.1
basemesh = HumanService.deserialize_from_dict(info, settings)
# Fit clothes, hair etc. (and the rig) to the final body shape
bpy.context.view_layer.update()
HumanService.refit(basemesh)

# Face units (ARKit-style expression shape keys), loaded while the body still has all its vertices,
# then carried over to eyebrows, eyelashes etc. through the MHCLO correspondence
FACE = None
if recipe.get("faceunits"):
    from bl_ext.blender_org.mpfb.services.faceservice import FaceService, ARKIT_FACEUNITS
    FaceService.load_targets(basemesh, load_microsoft_visemes=False, load_meta_visemes=False, load_arkit_faceunits=True)
    FaceService.interpolate_targets(basemesh)
    FACE = [t.split("/")[-1].lower() for t in ARKIT_FACEUNITS]

# The face shapes the game drives (src/characters/realBody.js _applyFace); the rest are dropped
USED_FACE = {k.lower() for k in recipe.get("keep_faceunits", [
    "eyeBlinkLeft", "eyeBlinkRight", "eyeWideLeft", "eyeWideRight",
    "browInnerUp", "browOuterUpLeft", "browOuterUpRight", "browDownLeft", "browDownRight",
    "mouthSmileLeft", "mouthSmileRight", "mouthFrownLeft", "mouthFrownRight", "mouthPucker",
    "mouthStretchLeft", "mouthStretchRight", "jawOpen",
    "eyeLookInLeft", "eyeLookInRight", "eyeLookOutLeft", "eyeLookOutRight",
    "eyeLookUpLeft", "eyeLookUpRight", "eyeLookDownLeft", "eyeLookDownRight"])}

def is_face_key(name):
    n = name.lower()
    return FACE is not None and any(f in n for f in FACE)

import bmesh
def bake(o, extra_delete=None):
    """Body targets -> basis (keep face-unit keys as deltas on the new basis); apply masks by
    deleting vertices (works with shape keys); apply other non-armature modifiers if no keys."""
    me = o.data
    keys = me.shape_keys
    if keys:
        n = len(me.vertices)
        basis = keys.key_blocks[0]
        orig = [v.co.copy() for v in basis.data]
        face_keys = [k for k in keys.key_blocks[1:] if is_face_key(k.name)]
        body_keys = [k for k in keys.key_blocks[1:] if not is_face_key(k.name)]
        mixed = [c.copy() for c in orig]
        for k in body_keys:
            if k.value == 0 or k.mute:
                continue
            for i in range(n):
                mixed[i] += (k.data[i].co - orig[i]) * k.value
        deltas = {k.name: [k.data[i].co - orig[i] for i in range(n)] for k in face_keys}
        for i in range(n):
            basis.data[i].co = mixed[i]
            me.vertices[i].co = mixed[i]
        for k in face_keys:
            for i in range(n):
                k.data[i].co = mixed[i] + deltas[k.name][i]
            k.value = 0
        drop = [k.name for k in body_keys]
        drop += [k.name for k in face_keys if not any(u == k.name.lower() or k.name.lower().endswith(u) for u in USED_FACE)]
        for name in drop:
            kb = me.shape_keys.key_blocks.get(name)
            if kb is not None:
                o.shape_key_remove(kb)
        if len(keys.key_blocks) == 1:
            o.shape_key_clear()
    # Masks: delete the vertices they hide (plus any skin under clothes, for the body)
    delete = set(extra_delete(o) if extra_delete else [])
    for m in list(o.modifiers):
        if m.type == "MASK" and m.name.startswith("Delete.") and recipe.get("clothes_masks") is False:
            o.modifiers.remove(m); continue  # (a garment's mask: only skin that's really covered goes; see covered_by_clothes)
        if m.type == "MASK" and m.vertex_group and m.show_viewport:
            g = o.vertex_groups.get(m.vertex_group)
            if g is None:
                o.modifiers.remove(m); continue
            inside = {v.index for v in me.vertices if any(gr.group == g.index and gr.weight > m.threshold for gr in v.groups)}
            if any(k in m.name.lower() for k in SKIRTS):
                inside = {i for i in inside if not leg_vertex(o, me.vertices[i])}
            if m.invert_vertex_group:
                delete |= inside
            else:
                delete |= {v.index for v in me.vertices} - inside
            o.modifiers.remove(m)
    if delete:
        bm = bmesh.new(); bm.from_mesh(me)
        bm.verts.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[bm.verts[i] for i in delete], context="VERTS")
        bm.to_mesh(me); bm.free(); me.update()
    for m in list(o.modifiers):
        if m.type in ("ARMATURE",):
            continue
        if me.shape_keys:
            print("leaving modifier (shape keys present):", o.name, m.type); o.modifiers.remove(m); continue
        bpy.ops.object.select_all(action="DESELECT")
        bpy.context.view_layer.objects.active = o; o.select_set(True)
        try:
            bpy.ops.object.modifier_apply(modifier=m.name)
        except Exception as e:
            print("could not apply", o.name, m.name, e)

from mathutils.bvhtree import BVHTree
CLOTHES_SKIP = ("eyebrow", "eyelash", "low-poly", "high-poly", "hair", "glasses")
SKIRTS = ("skirt", "dress")
def leg_vertex(o, v):
    """Is this vertex mostly moved by a thigh/calf bone?"""
    best, bw = None, 0
    for g in v.groups:
        if g.weight > bw:
            best, bw = o.vertex_groups[g.group].name.lower(), g.weight
    return best is not None and any(k in best for k in ("thigh", "calf", "upleg", "leg"))

def covered_by_clothes(body):
    """Body vertices with a piece of clothing just outside them (they'd poke through)."""
    trees = []
    for c in bpy.data.objects:
        if c.type != "MESH" or c is body or any(k in c.name for k in CLOTHES_SKIP):
            continue
        mw = c.matrix_world
        verts = [mw @ v.co for v in c.data.vertices]
        polys = [tuple(p.vertices) for p in c.data.polygons]
        trees.append((BVHTree.FromPolygons(verts, polys), any(k in c.name.lower() for k in SKIRTS)))
    if not trees:
        return []
    mw = body.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    body.data.update()
    out = []
    reach = recipe.get("cover_reach", 0.05)
    poke = float(recipe.get("poke_reach", 0))  # metres: clothing this far under the skin = skin poking through
    # Legs under a skirt are kept (seated, it rides up), but only up to skirt_leg_keep of the way from its hem
    # to the top of the thighs: higher up (the seat, the backs of full thighs) they'd poke through it
    keep_share = float(recipe.get("skirt_leg_keep", 1.0))
    keep_below = None
    if keep_share < 1:
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        thigh_top = (arm.matrix_world @ arm.data.bones["thigh_l"].head_local).z
        hems = [min((c.matrix_world @ v.co).z for v in c.data.vertices) for c in bpy.data.objects
                if c.type == "MESH" and any(k in c.name.lower() for k in SKIRTS)]
        if hems:
            keep_below = min(hems) + (thigh_top - min(hems)) * keep_share
    for v in body.data.vertices:
        p = mw @ v.co
        n = (nmat @ v.normal).normalized()
        for t, is_skirt in trees:
            if is_skirt and leg_vertex(body, v) and (keep_below is None or p.z < keep_below):
                continue  # keep legs under skirts: seated, the skirt rides up
            hit = t.ray_cast(p - n * 0.002, n, reach)
            # ...or just inside it: the skin pokes through the clothes there (full thighs under a dress)
            if hit[0] is None and poke:
                hit = t.ray_cast(p + n * 0.002, -n, poke)
            if hit[0] is not None:
                out.append(v.index)
                break
    # cover_erode: keep this many rings of skin round the edge of each removed patch, so its sawtooth edge
    # sits well under the clothes instead of showing at a neckline or armhole
    erode = int(recipe.get("cover_erode", 0))
    if erode:
        nbrs = [set() for _ in body.data.vertices]
        for e in body.data.edges:
            a, b = e.vertices
            nbrs[a].add(b); nbrs[b].add(a)
        keep = set(out)
        for _ in range(erode):
            keep = {i for i in keep if nbrs[i] <= keep}
        out = list(keep)
    print("COVERED", body.name, len(out), "of", len(body.data.vertices))
    return out

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
body = next((o for o in meshes if o.name.endswith(".body")), None)
for o in meshes:
    if o is not body:
        bake(o)
if body:
    bake(body, extra_delete=covered_by_clothes)

# Skirts and dresses: weighted to each thigh separately they split apart when seated, so each
# vertex follows both thighs (and both calves) equally, like a tube
for o in bpy.data.objects:
    tube = any(k in o.name.lower() for k in SKIRTS) or any(t in o.name for t in recipe.get("tube_clothes", []))
    if o.type != "MESH" or not tube:
        continue
    for a, b in (("thigh_l", "thigh_r"), ("calf_l", "calf_r")):
        ga, gb = o.vertex_groups.get(a), o.vertex_groups.get(b)
        if ga is None or gb is None:
            continue
        for v in o.data.vertices:
            wa = next((g.weight for g in v.groups if g.group == ga.index), 0.0)
            wb = next((g.weight for g in v.groups if g.group == gb.index), 0.0)
            if wa + wb > 0:
                # tube_amount: 1 = both thighs equally (a tube); less keeps some of each side's own leg,
                # so a walking leg doesn't swing out through the fabric
                k = float(recipe.get("tube_amount", 1.0))
                half = (wa + wb) / 2
                ga.add([v.index], wa + (half - wa) * k, "REPLACE")
                gb.add([v.index], wb + (half - wb) * k, "REPLACE")
    print("TUBE SKIRT", o.name)

# A moustache (recipe "moustache"; MakeHuman has none): the skin between the nose and the upper lip, copied a
# few millimetres out, thickened, coloured, and bound to the head bone
MOUSTACHE = recipe.get("moustache")
if MOUSTACHE and body:
    from mathutils import Vector
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    head_z = (arm.matrix_world @ arm.data.bones["head"].head_local).z
    mw = body.matrix_world
    me = body.data
    face_pts = [(mw @ v.co) for v in me.vertices]
    nose = min((p for p in face_pts if abs(p.x) < 0.012 and head_z < p.z < head_z + 0.14), key=lambda p: p.y)
    top, bottom = nose.z - MOUSTACHE.get("top", 0.012), nose.z - MOUSTACHE.get("bottom", 0.034)
    half = MOUSTACHE.get("width", 0.032)
    nmat = mw.to_3x3().inverted().transposed()
    polys = []
    for poly in me.polygons:
        c = mw @ poly.center
        if not (bottom <= c.z <= top) or abs(c.x) > half * (1 - 0.35 * (top - c.z) / (top - bottom)):
            continue
        if (nmat @ poly.normal).normalized().y > -0.35 or c.y > nose.y + 0.035:
            continue  # front-facing skin just under the nose only
        polys.append(poly)
    if polys:
        import bmesh
        bm = bmesh.new()
        vmap = {}
        out_by = MOUSTACHE.get("offset", 0.0025)
        for poly in polys:
            vs = []
            for i in poly.vertices:
                if i not in vmap:
                    v = me.vertices[i]
                    vmap[i] = bm.verts.new(mw @ v.co + (nmat @ v.normal).normalized() * out_by)
                vs.append(vmap[i])
            try:
                bm.faces.new(vs)
            except ValueError:
                pass
        # Thickness: a second layer further out, joined round the edge
        thick = MOUSTACHE.get("thickness", 0.004)
        bmesh.ops.solidify(bm, geom=bm.faces[:], thickness=-thick)
        mesh = bpy.data.meshes.new(recipe.get("name", "human") + ".moustache")
        bm.to_mesh(mesh); bm.free()
        ob = bpy.data.objects.new(mesh.name, mesh)
        bpy.context.scene.collection.objects.link(ob)
        mat = bpy.data.materials.new("moustache")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        col = MOUSTACHE.get("color", [0.6, 0.58, 0.55])
        if bsdf:
            bsdf.inputs["Base Color"].default_value = (*col, 1)
            bsdf.inputs["Roughness"].default_value = 0.95
        mesh.materials.append(mat)
        ob.parent = arm
        ob.matrix_parent_inverse = arm.matrix_world.inverted()
        g = ob.vertex_groups.new(name="head")
        g.add(list(range(len(mesh.vertices))), 1.0, "REPLACE")
        mod = ob.modifiers.new("Armature", "ARMATURE")
        mod.object = arm
        print("MOUSTACHE", len(polys), "faces under the nose at", round(nose.z, 3))

# Wobble bones (recipe "jiggle"): a bone for each soft part (belly, each breast, the double chin),
# placed at that part's centre (found from the dressed shape), with the skin and clothes round it
# blended onto it. The game moves these bones on a spring (src/characters/realBody.js).
JIGGLE = recipe.get("jiggle") or {}
if JIGGLE:
    from mathutils import Vector
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    hair_asset = (recipe.get("hair") or "").split("/")[0] or "\0"
    soft = [o for o in bpy.data.objects if o.type == "MESH" and not any(k in o.name for k in ("eyebrow", "eyelash", "low-poly", "high-poly", "glasses", "hair", hair_asset))]
    pts = [o.matrix_world @ v.co for o in soft for v in o.data.vertices]
    bone_at = lambda n: arm.matrix_world @ arm.data.bones[n].head_local
    pelvis, sp2, sp3, neck, head = (bone_at(n) for n in ("pelvis", "spine_02", "spine_03", "neck_01", "head"))
    clav = bone_at("clavicle_l")
    def front(cond):  # the frontmost point (MakeHuman's front is -y) among the points that pass cond
        c = [p for p in pts if cond(p)]
        return min(c, key=lambda p: p.y) if c else None
    parts = {}
    if "belly" in JIGGLE:
        f = front(lambda p: abs(p.x) < 0.1 and pelvis.z <= p.z <= sp2.z + 0.06)
        if f: parts["jiggle_belly"] = ("spine_01", JIGGLE["belly"], Vector((0, f.y, f.z)))
    if "breasts" in JIGGLE:
        for side, sx in (("l", 1), ("r", -1)):
            f = front(lambda p: 0.05 < p.x * sx < 0.25 and sp3.z + 0.02 <= p.z <= clav.z - 0.04)  # (above the belly)
            if f: parts["jiggle_breast_" + side] = ("spine_03", JIGGLE["breasts"], f.copy())
    if "jiggle_breast_l" in parts and "jiggle_breast_r" in parts:  # (mirrored: one frontmost point is noisy)
        a, b = parts["jiggle_breast_l"][2], parts["jiggle_breast_r"][2]
        x, y, z = (abs(a.x) + abs(b.x)) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2
        parts["jiggle_breast_l"] = (*parts["jiggle_breast_l"][:2], Vector((x, y, z)))
        parts["jiggle_breast_r"] = (*parts["jiggle_breast_r"][:2], Vector((-x, y, z)))
    if "chin" in JIGGLE:
        f = front(lambda p: abs(p.x) < 0.05 and neck.z <= p.z <= head.z - 0.03)  # (under the jaw, not the mouth)
        if f: parts["jiggle_chin"] = ("head", JIGGLE["chin"], Vector((0, f.y, f.z)))
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode="EDIT")
    inv = arm.matrix_world.inverted()
    for name, (parent, J, surf) in parts.items():
        r = Vector(J.get("radius", (0.15, 0.15, 0.15)))  # x (across), y (depth), z (up), metres
        c = surf + Vector((0, r.y * J.get("inset", 0.6), 0))  # the centre: in from the surface
        parts[name] = (parent, J, c)
        b = arm.data.edit_bones.new(name)
        b.head = inv @ c
        b.tail = inv @ (c + Vector((0, 0, 0.06)))
        b.parent = arm.data.edit_bones[parent]
        b.use_connect = False
        b.use_deform = True
        print("JIGGLE BONE", name, "at", tuple(round(v, 3) for v in c), "parent", parent)
    bpy.ops.object.mode_set(mode="OBJECT")
    # Weights: a smooth falloff inside an ellipsoid round each centre, taken from the bones already there
    for o in soft:
        mw = o.matrix_world
        groups = {g.index: g for g in o.vertex_groups}
        for name, (parent, J, c) in parts.items():
            r = Vector(J.get("radius", (0.15, 0.15, 0.15)))
            peak = J.get("weight", 0.85)
            g = o.vertex_groups.get(name) or o.vertex_groups.new(name=name)
            n = 0
            for v in o.data.vertices:
                d = mw @ v.co - c
                e = (d.x / r.x) ** 2 + (d.y / r.y) ** 2 + (d.z / r.z) ** 2
                if e >= 1:
                    continue
                t = 1 - e ** 0.5
                w = peak * t * t * (3 - 2 * t)  # smoothstep
                # Front only: fading out behind the centre, so the back and the seat stay put
                # (else the dress's back moves away from the skin under it and the skin shows through)
                if d.y > 0:
                    w *= max(0.0, 1 - d.y / (0.25 * r.y))
                if w < 0.01:
                    continue
                for vg in v.groups:
                    if vg.group != g.index:
                        vg.weight *= (1 - w)
                g.add([v.index], w, "REPLACE")
                n += 1
            if n:
                print("JIGGLE WEIGHTS", o.name, name, n)

# Material names carry the role (the game makes hair, brows and lashes cut-outs, glasses see-through)
hair_name = (recipe.get("hair") or "").split("/")[0]
for o in bpy.data.objects:
    if o.type != "MESH" or not o.data.materials:
        continue
    role = "hair" if hair_name and hair_name in o.name else ""
    for m in o.data.materials:
        if m and role and not m.name.startswith(role):
            m.name = role + "." + m.name

# Report what we got
for o in bpy.data.objects:
    print("OBJ", o.type, o.name, len(o.data.vertices) if o.type == "MESH" else "", [m.type for m in o.modifiers] if o.type == "MESH" else "")

if preview:
    scene = bpy.context.scene
    cam_data = bpy.data.cameras.new("cam")
    cam = bpy.data.objects.new("cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (0, -4.2, 1.0)
    cam.rotation_euler = (math.radians(88), 0, 0)
    cam_data.lens = 50
    scene.camera = cam
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.rotation_euler = (math.radians(50), 0, math.radians(20))
    scene.collection.objects.link(sun)
    scene.world = scene.world or bpy.data.worlds.new("w")
    scene.world.color = (0.5, 0.5, 0.5)
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x, scene.render.resolution_y = 600, 800
    scene.render.filepath = preview
    bpy.ops.render.render(write_still=True)

# Export: the armature and every mesh parented to it, modifiers applied (masks under clothes etc.)
bpy.ops.object.select_all(action="DESELECT")
for o in bpy.data.objects:
    if o.type in ("ARMATURE", "MESH"):
        o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=out_path, export_format="GLB", use_selection=True, export_apply=False,
    export_animations=False, export_morph=True, export_morph_normal=False, export_skins=True,
    export_image_format="AUTO",
)
print("EXPORTED", out_path)
