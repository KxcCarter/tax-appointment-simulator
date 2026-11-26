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
    if o is body and recipe.get("coat"):
        make_coat(o)  # (from the body's final shape, before the skin under clothes goes)
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
    if delete and o is body and recipe.get("arm_skin", True):
        keep_arm_skin(o, delete)
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

def dominant(o, v):
    """The name of the vertex group (bone) that moves this vertex most ('' if none)."""
    global BONES
    if BONES is None:
        BONES = {b.name for b in next(a for a in bpy.data.objects if a.type == "ARMATURE").data.bones}
    best, bw = "", 0
    for g in v.groups:
        name = o.vertex_groups[g.group].name
        if g.weight > bw and name in BONES:  # (bones only: not the clothes' mask groups)
            best, bw = name, g.weight
    return best
BONES = None

def bone_head(name):
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    return arm.matrix_world @ arm.data.bones[name].head_local

def keep_arm_skin(body, delete):
    """The arm skin under sleeves (about to be deleted) kept as its own mesh, '<name>.armskin': the game hides it
    and shows an arm's share when that sleeve is ripped off (src/characters/realDamage.js). One ring of the skin
    round it is included too, so it overlaps the body's skin instead of leaving a gap."""
    me = body.data
    arm_ids = {i for i in delete if any(k in dominant(body, me.vertices[i]) for k in ("upperarm", "lowerarm"))}
    if not arm_ids:
        return
    nbrs = {}
    for e in me.edges:
        a, b = e.vertices
        nbrs.setdefault(a, set()).add(b); nbrs.setdefault(b, set()).add(a)
    keep = set(arm_ids)
    for i in arm_ids:
        keep |= {j for j in nbrs.get(i, ()) if any(k in dominant(body, me.vertices[j]) for k in ("upperarm", "lowerarm", "clavicle", "hand"))}
    ob = body.copy()
    ob.data = me.copy()
    ob.name = ob.data.name = recipe.get("name", "human") + ".armskin"
    body.users_collection[0].objects.link(ob)
    if ob.data.shape_keys:
        ob.shape_key_clear()
    for m in list(ob.modifiers):
        if m.type != "ARMATURE":
            ob.modifiers.remove(m)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.index not in keep], context="VERTS")
    bm.to_mesh(ob.data); bm.free()
    print("ARM SKIN", len(ob.data.vertices), "vertices kept under the sleeves")

def cut_garment(o):
    """Recipe "cut": {"part of a garment's name": metres}: the garment's vertices lower than that far above
    (or, negative, below) the knees are deleted, e.g. long trousers into knee-length shorts."""
    from mathutils import Vector
    for k, dz in (recipe.get("cut") or {}).items():
        if k in o.name:
            knee = bone_head("calf_l").z + dz
            # sliced along the plane (a clean hem), then everything below it dropped
            inv = o.matrix_world.inverted()
            bm = bmesh.new(); bm.from_mesh(o.data)
            n = (o.matrix_world.to_3x3().transposed() @ Vector((0, 0, 1))).normalized()
            bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=inv @ Vector((0, 0, knee)), plane_no=n, clear_inner=True)
            bm.to_mesh(o.data); bm.free(); o.data.update()
            print("CUT", o.name, "at", round(knee, 3))
    return []

def make_coat(body):
    """Recipe "coat" (MakeHuman's free clothes have no coats): a long coat made from the body's own shape.
    Shoulders, chest, back and sleeves: the skin, pushed out past whatever's worn on it (`margin` metres beyond
    the outermost clothing), open in a V at the front (the shirt and tie show), cuffs `cuff` metres short of
    the wrist. Below the waist: a skirt hanging round both legs down to `hem` metres above the knee (it flares
    a little, `flare`), weighted like a skirt (both thighs). A belt round the waist. Material 'coat' has a pale
    fabric texture to tint (theme.look.realistic.tint); the belt is 'coat_belt'."""
    from mathutils import Vector
    C = recipe["coat"]
    margin, cuff = C.get("margin", 0.012), C.get("cuff", 0.06)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    waist_z, thigh_z, knee_z = bone_head("spine_01").z, bone_head("thigh_l").z, bone_head("calf_l").z
    chest_z, neck_z = bone_head("spine_03").z, bone_head("neck_01").z
    hands = {"l": bone_head("hand_l"), "r": bone_head("hand_r")}
    hem_z = knee_z + C.get("hem", 0.02)
    clothes = [c for c in bpy.data.objects if c.type == "MESH" and c is not body and not any(k in c.name for k in CLOTHES_SKIP)]
    trees = []
    for c in clothes:
        mw = c.matrix_world
        trees.append(BVHTree.FromPolygons([mw @ v.co for v in c.data.vertices], [tuple(p.vertices) for p in c.data.polygons]))
    me, mw = body.data, body.matrix_world
    nmat = mw.to_3x3().inverted().transposed()
    # --- the top: shoulders, chest, back, sleeves ---
    v_bottom = chest_z - C.get("v_depth", 0.06)
    v_half = C.get("v_width", 0.085)
    sel = {}
    for v in me.vertices:
        b, p = dominant(body, v), mw @ v.co
        ok = b.startswith("spine") or "clavicle" in b or "upperarm" in b or "lowerarm" in b or (b == "pelvis" and p.z > waist_z - 0.03)
        if not ok:
            continue
        if "lowerarm" in b and (p - hands[b[-1]]).length < cuff:
            continue
        n = (nmat @ v.normal).normalized()
        d = 0.0
        for t in trees:  # the outermost clothing along the normal
            dd = 0.0
            for _ in range(3):
                hit = t.ray_cast(p + n * (dd + 0.001), n, 0.1)
                if hit[0] is None:
                    break
                dd += 0.001 + hit[3]
            d = max(d, dd)
        sel[v.index] = [p, n, d]
    # smooth the push-out so the coat doesn't follow every fold of what's under it (never less than needed)
    nbrs = {}
    for e in me.edges:
        a, b = e.vertices
        if a in sel and b in sel:
            nbrs.setdefault(a, []).append(b); nbrs.setdefault(b, []).append(a)
    need = {i: s[2] for i, s in sel.items()}
    for _ in range(6):
        cur = {i: s[2] for i, s in sel.items()}
        for i, s in sel.items():
            nb = nbrs.get(i)
            if nb:
                s[2] = max(need[i], 0.5 * cur[i] + 0.5 * sum(cur[j] for j in nb) / len(nb))
    bm = bmesh.new()
    deform = bm.verts.layers.deform.verify()  # (before any vertices: adding a layer later invalidates them)
    gi = {g.name: g.index for g in body.vertex_groups}  # (the coat gets the body's groups, same order)
    vmap = {}
    for i, s in sel.items():
        bv = vmap[i] = bm.verts.new(s[0] + s[1] * (s[2] + margin))
        for g in me.vertices[i].groups:
            if g.weight > 0.001:
                bv[deform][g.group] = g.weight
    for poly in me.polygons:
        if all(i in vmap for i in poly.vertices):
            try:
                bm.faces.new([vmap[i] for i in poly.vertices])
            except ValueError:
                pass
    # The V at the front (MakeHuman's front is -y), cut with two straight slices, so the shirt and tie show
    front = lambda f: f.calc_center_median().y < 0 and f.calc_center_median().z > v_bottom - 0.03
    for sx in (1, -1):
        a, b = Vector((0, 0, v_bottom)), Vector((sx * v_half, 0, neck_z))
        n = (b - a).cross(Vector((0, 1, 0))).normalized()
        faces = [f for f in bm.faces if front(f)]
        geom = list({v for f in faces for v in f.verts}) + list({e for f in faces for e in f.edges}) + faces
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=a, plane_no=n)
    inside = lambda c: c.y < 0 and c.z > v_bottom and abs(c.x) < v_half * (c.z - v_bottom) / max(0.01, neck_z - v_bottom)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if inside(f.calc_center_median())], context="FACES")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
    # --- the skirt: rings round the hips and legs (arms and hands left out), waist to hem ---
    pts = []
    for c in [body] + clothes:
        cw = c.matrix_world
        for v in c.data.vertices:
            b = dominant(c, v)
            if any(k in b for k in ("arm", "hand", "thumb", "index", "middle", "ring", "pinky", "clavicle")):
                continue
            p = cw @ v.co
            if hem_z - 0.04 < p.z < waist_z + 0.06:
                pts.append(p)
    top_z = waist_z + 0.02
    rows, segs = C.get("rows", 10), C.get("segments", 40)
    ring_pts = [p for p in pts if abs(p.z - top_z) < 0.03] or pts
    cx = (min(p.x for p in ring_pts) + max(p.x for p in ring_pts)) / 2
    cy = (min(p.y for p in ring_pts) + max(p.y for p in ring_pts)) / 2
    flare = C.get("flare", 0.08)
    prev, ring_verts, top_ring = None, [], []
    for k in range(rows + 1):
        z = top_z + (hem_z - top_z) * k / rows
        slab = [p for p in pts if abs(p.z - z) < 0.035]
        r = [0.0] * segs
        for p in slab:
            a = math.atan2(p.y - cy, p.x - cx)
            s = int(((a + math.pi) / (2 * math.pi)) * segs) % segs
            r[s] = max(r[s], math.hypot(p.x - cx, p.y - cy))
        for _ in range(3):  # fill empty sectors and round the shape off
            r = [max(r[s], 0.5 * r[s] + 0.25 * (r[s - 1] + r[(s + 1) % segs])) for s in range(segs)]
        r = [x + margin + 0.006 for x in r]
        if prev:  # it hangs: never narrower than the ring above, and flares out a little
            r = [max(r[s], prev[s] + flare / rows) for s in range(segs)]
        prev = r
        ring = []
        for s in range(segs):
            a = -math.pi + (s + 0.5) * 2 * math.pi / segs
            bv = bm.verts.new(Vector((cx + r[s] * math.cos(a), cy + r[s] * math.sin(a), z)))
            if k == 0:
                top_ring.append(bv.co.copy())
            # weights: the pelvis above the hips; below, both thighs (more of the near one), like a skirt
            t = max(0.0, min(1.0, (thigh_z - z) / max(0.01, thigh_z - hem_z)))
            side = max(-1.0, min(1.0, (r[s] * math.cos(a)) / 0.15))
            for g, x in (("pelvis", 1 - t), ("thigh_l", t * (0.5 + 0.3 * side)), ("thigh_r", t * (0.5 - 0.3 * side))):
                if x > 0.001:
                    bv[deform][gi[g]] = x
            ring.append(bv)
        ring_verts.append(ring)
    for k in range(rows):
        a_, b_ = ring_verts[k], ring_verts[k + 1]
        for s in range(segs):
            bm.faces.new([a_[s], a_[(s + 1) % segs], b_[(s + 1) % segs], b_[s]])
    bm.normal_update()
    mesh = bpy.data.meshes.new(recipe.get("name", "human") + ".coat")
    bm.to_mesh(mesh); bm.free()
    ob = bpy.data.objects.new(mesh.name, mesh)
    body.users_collection[0].objects.link(ob)
    for g in body.vertex_groups:
        ob.vertex_groups.new(name=g.name)
    # UVs, and a pale fabric texture (fine noise and a twill) for the game to tint and paint damage on
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = ob; ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)
    bpy.ops.object.mode_set(mode="OBJECT")
    import random
    rnd = random.Random(7)
    N = 256
    img = bpy.data.images.new("coat_fabric", N, N)
    px = []
    for y in range(N):
        for x in range(N):
            g = 0.86 + rnd.uniform(-0.035, 0.035) - (0.03 if (x + y) % 4 < 2 else 0)
            px += [g, g, g, 1.0]
    img.pixels = px
    img.pack()
    def material(name, colour=None, image=None):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        m.use_backface_culling = False
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Roughness"].default_value = 0.9
        if image:
            tex = m.node_tree.nodes.new("ShaderNodeTexImage"); tex.image = image
            m.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            bsdf.inputs["Base Color"].default_value = (*colour, 1)
        return m
    mesh.materials.append(material("coat", image=img))
    ob.parent = arm
    ob.matrix_parent_inverse = arm.matrix_world.inverted()
    ob.modifiers.new("Armature", "ARMATURE").object = arm
    # The belt: a band round the waist, over the top of the skirt (hides where it meets the top)
    bw = C.get("belt", 0.045)
    bm = bmesh.new()
    me2 = bpy.data.meshes.new(recipe.get("name", "human") + ".coat_belt")
    coat_top = top_ring  # (the skirt's top ring)
    rings = []
    for dz in (bw / 2, -bw / 2):
        ring = []
        for p in coat_top:
            d = Vector((p.x - cx, p.y - cy, 0))
            q = Vector((cx, cy, p.z + dz)) + d * ((d.length + 0.006) / max(1e-6, d.length))
            ring.append(bm.verts.new(q))
        rings.append(ring)
    for s in range(segs):
        bm.faces.new([rings[0][s], rings[0][(s + 1) % segs], rings[1][(s + 1) % segs], rings[1][s]])
    bm.normal_update()
    bm.to_mesh(me2); bm.free()
    ob2 = bpy.data.objects.new(me2.name, me2)
    body.users_collection[0].objects.link(ob2)
    g = ob2.vertex_groups.new(name="pelvis")
    g.add(list(range(len(me2.vertices))), 1.0, "REPLACE")
    me2.materials.append(material("coat_belt", colour=C.get("belt_color", [0.45, 0.38, 0.26])))
    ob2.parent = arm
    ob2.matrix_parent_inverse = arm.matrix_world.inverted()
    ob2.modifiers.new("Armature", "ARMATURE").object = arm
    print("COAT", len(vmap), "top vertices,", rows + 1, "skirt rings, hem at", round(hem_z, 3))

meshes = [o for o in bpy.data.objects if o.type == "MESH"]
body = next((o for o in meshes if o.name.endswith(".body")), None)
for o in meshes:
    if o is not body:
        bake(o, extra_delete=cut_garment)
if body:
    bake(body, extra_delete=covered_by_clothes)

# Recipe "reverse": ["part of a garment's name"]: worn backwards (a cap with the peak at the back), turned half
# round about the middle of the top of the head
for k in recipe.get("reverse", []):
    top = [body.matrix_world @ v.co for v in body.data.vertices if (body.matrix_world @ v.co).z > bone_head("head").z + 0.08] if body else []
    for o in bpy.data.objects:
        if o.type != "MESH" or k not in o.name or not top:
            continue
        cx = (min(p.x for p in top) + max(p.x for p in top)) / 2
        cy = (min(p.y for p in top) + max(p.y for p in top)) / 2
        inv = o.matrix_world.inverted()
        for v in o.data.vertices:
            p = o.matrix_world @ v.co
            v.co = inv @ type(p)((2 * cx - p.x, 2 * cy - p.y, p.z))
        # (mirroring both x and y is a half turn: faces keep their winding)
        o.data.update()
        print("REVERSED", o.name)

# Recipe "plain": {"part of a garment's name": {"color": [r, g, b], "name": "material name"}}: its texture
# dropped (e.g. printing on it), one plain colour instead
for k, P in (recipe.get("plain") or {}).items():
    for o in bpy.data.objects:
        if o.type != "MESH" or k not in o.name:
            continue
        m = bpy.data.materials.new(P.get("name", k))
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (*P.get("color", [0.8, 0.8, 0.8]), 1)
        bsdf.inputs["Roughness"].default_value = 0.9
        o.data.materials.clear()
        o.data.materials.append(m)
        print("PLAIN", o.name, "->", m.name)

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
