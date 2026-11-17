# Deterministic offline asset inspection; this does NOT replace in-game WebGL QA.
import bpy, math, json, os
from mathutils import Vector
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
manifest=json.load(open('apps/web/public/assets/visuals/1.1.0/manifest.json'))
for i,aid in enumerate(['worker','processor','rocket_lower_hull']):
 a=next(a for a in manifest['assets'] if a['id']==aid)
 before=set(bpy.data.objects)
 bpy.ops.import_scene.gltf(filepath=os.path.abspath('apps/web/public'+a['lods'][0]['url']))
 objs=set(bpy.data.objects)-before
 for o in objs:
  if o.animation_data: o.animation_data.action=None
  if o.type=='ARMATURE':o.data.pose_position='REST'
 bpy.context.view_layer.update()
 meshes=[o for o in objs if o.type=='MESH' and (aid!='worker' or o.name.startswith('char1'))]
 bounds=[o.matrix_world@Vector(v) for o in meshes for v in o.bound_box]
 lo=Vector([min(p[k] for p in bounds) for k in range(3)]);hi=Vector([max(p[k] for p in bounds) for k in range(3)])
 size=hi-lo;print('ASSET_BOUNDS',aid,list(lo),list(hi),list(size));b=a['boundsMax'];scale=1.8/size.z if aid=='worker' else min(b['x']/size.x,b['y']/size.z,b['z']/size.y)
 root=bpy.data.objects.new(aid,None);bpy.context.collection.objects.link(root)
 for o in objs:
  if o.parent not in objs:o.parent=root
 root.scale=(scale,scale,scale);root.location=(i*3-(lo.x+hi.x)*scale/2,-(lo.y+hi.y)*scale/2,-lo.z*scale)
# ground
bpy.ops.mesh.primitive_plane_add(size=200);ground=bpy.context.object;ground.location.z=-.02
m=bpy.data.materials.new('Ground');m.diffuse_color=(.68,.74,.65,1);ground.data.materials.append(m)
bpy.ops.object.camera_add(location=(12,-15,20));cam=bpy.context.object;target=Vector((3,0,1));cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler();cam.data.type='ORTHO';cam.data.ortho_scale=11;bpy.context.scene.camera=cam
for loc,power,size in [((0,-5,10),1800,8),((7,4,8),1300,6)]:
 bpy.ops.object.light_add(type='AREA',location=loc);l=bpy.context.object;l.data.energy=power;l.data.shape='DISK';l.data.size=size;l.rotation_euler=(Vector((3,0,0))-l.location).to_track_quat('-Z','Y').to_euler()
s=bpy.context.scene;s.render.engine='CYCLES';s.cycles.samples=16;s.cycles.use_denoising=False;s.world.color=(.5,.5,.5);s.render.resolution_x=1366;s.render.resolution_y=768;s.render.resolution_percentage=100;s.render.image_settings.file_format='PNG';s.render.filepath=os.path.abspath('docs/qa/evidence/pilot-offline-render.png');bpy.ops.wm.save_as_mainfile(filepath='/tmp/sto-pilots.blend');bpy.ops.render.render(write_still=True)
