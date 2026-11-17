# Actual authored game meshes; offline CPU inspection, not a gameplay screenshot.
import bpy
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath='/tmp/scrap-starter-machines.glb')
bpy.ops.mesh.primitive_plane_add(size=200)
ground = bpy.context.object
mat = bpy.data.materials.new('warm-ground')
mat.diffuse_color = (.55, .43, .28, 1)
ground.data.materials.append(mat)
ground.location.z = -.01
bpy.ops.object.camera_add(location=(9, -13, 11))
cam = bpy.context.object
cam.rotation_euler = (Vector((0, -1.4, .6)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
cam.data.type = 'ORTHO'
cam.data.ortho_scale = 13
bpy.context.scene.camera = cam
bpy.ops.object.light_add(type='AREA', location=(-4, -3, 9))
light = bpy.context.object
light.data.energy = 1800
light.data.shape = 'DISK'
light.data.size = 7
s = bpy.context.scene
s.render.engine = 'CYCLES'
s.cycles.samples = 24
s.cycles.use_denoising = False
s.world.use_nodes = True
s.world.node_tree.nodes['Background'].inputs[1].default_value = .65
s.render.resolution_x = 1500
s.render.resolution_y = 900
s.render.resolution_percentage = 100
s.render.image_settings.file_format = 'PNG'
s.render.filepath = 'docs/carry/evidence/starter-machines-offline.png'
bpy.ops.render.render(write_still=True)
