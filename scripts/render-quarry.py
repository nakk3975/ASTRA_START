# Actual game scenery and catalog assets, rendered offline on CPU. Not a live WebGL capture.
import bpy, math, json, os
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath='/tmp/scrap-quarry-environment.glb')
manifest=json.load(open('apps/web/public/assets/visuals/1.1.0/manifest.json'))
def asset(aid,x,z):
 a=next(a for a in manifest['assets'] if a['id']==aid);before=set(bpy.data.objects)
 bpy.ops.import_scene.gltf(filepath=os.path.abspath('apps/web/public'+a['lods'][0]['url']))
 objs=set(bpy.data.objects)-before
 for o in objs:
  if o.animation_data:o.animation_data.action=None
  if o.type=='ARMATURE':o.data.pose_position='REST'
 bpy.context.view_layer.update();meshes=[o for o in objs if o.type=='MESH']
 bounds=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
 lo=Vector([min(p[k] for p in bounds) for k in range(3)]);hi=Vector([max(p[k] for p in bounds) for k in range(3)])
 size=hi-lo;b=a['boundsMax'];scale=min(b['x']/size.x,b['y']/size.z,b['z']/size.y)
 root=bpy.data.objects.new(aid,None);bpy.context.collection.objects.link(root)
 for o in objs:
  if o.parent not in objs:o.parent=root
 root.scale=(scale,scale,scale);root.location=(x-(lo.x+hi.x)*scale/2,-z-(lo.y+hi.y)*scale/2,-lo.z*scale)
for aid,z in [('source_metal',-7),('source_cable',-2),('source_plastic',3),('source_energy',8)]:asset(aid,-19,z)
asset('worker',-14,-5)
# This is the empty-start terrain: purchased machines are intentionally not preinstalled.
bpy.ops.object.camera_add(location=(27,-36,38));cam=bpy.context.object;target=Vector((-4,0,0));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=55;bpy.context.scene.camera=cam
bpy.ops.object.light_add(type='SUN',location=(-12,-9,26));sun=bpy.context.object;sun.data.energy=2;sun.data.angle=.15;sun.rotation_euler=(Vector((0,0,0))-sun.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=24;s.cycles.use_denoising=False;s.world.use_nodes=True;s.world.node_tree.nodes['Background'].inputs[0].default_value=(.75,.8,.72,1);s.world.node_tree.nodes['Background'].inputs[1].default_value=.6
s.render.resolution_x=1600;s.render.resolution_y=1000;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG'
s.render.filepath=os.path.abspath('docs/carry/evidence/quarry-offline-render.png');bpy.ops.render.render(write_still=True)
