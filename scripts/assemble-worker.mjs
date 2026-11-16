import {NodeIO}from'@gltf-transform/core';
import {prune,dedup}from'@gltf-transform/functions';
import fs from'node:fs/promises';
const io=new NodeIO(),d=await io.read('assets/source/worker/rig/rigged_character.glb');
for(const a of d.getRoot().listAnimations())a.dispose();
const nodes=new Map(d.getRoot().listNodes().map(n=>[n.getName(),n]));
const meta=JSON.parse(await fs.readFile('/tmp/sto-worker-actions.json'));
const files=meta.result.downloads.files.filter(f=>f.path.endsWith('.glb'));
console.log(files.map(f=>({key:f.key,path:f.path})));
const actions={0:'idle',128:'work_loop',551:'carry_locomotion',59:'celebrate'};
const sources=[['locomotion','assets/source/worker/rig/walking_glb.glb']];
for(const[id,name]of Object.entries(actions)){
 const f=files.find(f=>f.key.includes(id)&&!f.key.includes('armature'));
 if(!f)throw Error(`No animation ${id}; inspect download keys`);sources.push([name,f.path]);
}
for(const[name,path]of sources){
 const src=await io.read(path),anim=src.getRoot().listAnimations()[0];if(!anim)throw Error('No animation '+path);
 const out=d.createAnimation(name);
 for(const ch of anim.listChannels()){
  const target=nodes.get(ch.getTargetNode()?.getName());if(!target)continue;
  const s=ch.getSampler(),input=s.getInput(),output=s.getOutput();
  const vals=output.getArray().slice();
  if(ch.getTargetPath()==='translation'&&['Hips','Armature'].includes(target.getName()))for(let i=0;i<vals.length;i+=3){vals[i]=vals[0];vals[i+2]=vals[2];}
  const a=d.createAccessor().setType(input.getType()).setArray(input.getArray().slice()).setBuffer(d.getRoot().listBuffers()[0]);
  const b=d.createAccessor().setType(output.getType()).setArray(vals).setBuffer(d.getRoot().listBuffers()[0]);
  out.addChannel(d.createAnimationChannel().setTargetNode(target).setTargetPath(ch.getTargetPath()).setSampler(d.createAnimationSampler().setInput(a).setOutput(b).setInterpolation(s.getInterpolation())));
 }
}
const alias={Armature:'root',Hips:'hips',LeftHand:'hand_left',RightHand:'hand_right'};
for(const[from,to]of Object.entries(alias))nodes.get(from)?.setName(to);
await d.transform(dedup(),prune());await io.write('assets/source/worker/animated.glb',d);
console.log('Clips',d.getRoot().listAnimations().map(a=>a.getName()));
