import * as T from 'three';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
export type AssetRecord = {id:string;boundsMax:{x:number;y:number;z:number};clips:string[];lods:{level:number;url:string;sha256:string;bytes:number;triangles:number;materials:number}[]};
export type Manifest={version:string;status:string;assets:AssetRecord[]};
let promise:Promise<Manifest>|null=null;
const cache=new Map<string,GLTF>();
export let manifest:Manifest|null=null;
export let assetError='';
export async function preloadAssets() {
  if(promise)return promise;
  promise=(async()=>{
    const response=await fetch('/assets/visuals/1.1.0/manifest.json',{cache:'no-cache'});
    if(!response.ok)throw Error('3D 모델 목록을 불러올 수 없습니다');
    const m:Manifest=await response.json(); const loader=new GLTFLoader();
    if(!m.assets.length)throw Error('3D 모델이 준비되지 않았습니다');
    // Decode and verify the actual bytes before obtaining a short-lived join ticket.
    for(const a of m.assets)for(const lod of a.lods){
      const r=await fetch(lod.url);if(!r.ok)throw Error(`모델 로드 실패: ${a.id}`);
      const data=await r.arrayBuffer();
      const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data))).map(n=>n.toString(16).padStart(2,'0')).join('');
      if(hash!==lod.sha256)throw Error(`모델 무결성 오류: ${a.id}`);
      cache.set(`${a.id}:${lod.level}`,await loader.parseAsync(data,''));
    }
    manifest=m;return m;
  })().catch(e=>{assetError=String(e.message);promise=null;throw e});return promise;
}
export type Visual={root:T.Group;mixer:T.AnimationMixer|null;clips:T.AnimationClip[];release:()=>void};
export function assetInstance(id:string,low=false):Visual|null {
  const a=manifest?.assets.find(a=>a.id===id),src=cache.get(`${id}:${low?1:0}`);
  if(!a||!src)return null;
  const root=new T.Group();root.name=`EntityVisual:${id}`;
  const model=clone(src.scene);model.name='visual_root';root.add(model);
  // Keep the gameplay entity ground origin independent of animated bones.
  model.updateMatrixWorld(true);
  const box=new T.Box3().setFromObject(model),size=box.getSize(new T.Vector3()),center=box.getCenter(new T.Vector3());
  const scale=id==='worker'?1.8/size.y:Math.min(a.boundsMax.x/size.x,a.boundsMax.y/size.y,a.boundsMax.z/size.z);
  model.scale.multiplyScalar(scale);
  model.position.add(new T.Vector3(-center.x*scale,-box.min.y*scale,-center.z*scale));
  if(id.startsWith('rocket_')&&id!=='rocket_fin'&&id!=='rocket_panel'){
    // Modules use their specified attachment height; hull diameter remains bounded.
    model.scale.y*=a.boundsMax.y/(size.y*scale);
    model.position.y=-box.min.y*model.scale.y;
  }
  // Meshy rigs face +Z. Rotate the complete skin/skeleton hierarchy together once.
  if(id==='worker')root.rotation.y=Math.PI;
  const own:T.Material[]=[];
  model.traverse(o=>{if(o instanceof T.Mesh){
    o.material=Array.isArray(o.material)?o.material.map(m=>m.clone()):o.material.clone();
    own.push(...(Array.isArray(o.material)?o.material:[o.material]));
    o.castShadow=false;o.receiveShadow=true;o.frustumCulled=id!=='worker';
    o.userData.assetId=id;
  }});
  const mixer=src.animations.length?new T.AnimationMixer(model):null;
  return {root,mixer,clips:src.animations,release(){mixer?.stopAllAction();mixer?.uncacheRoot(model);own.forEach(m=>m.dispose());root.removeFromParent();}};
}
export function playClip(v:Visual,name:string) {
  if(!v.mixer||v.root.userData.clip===name)return;
  const clip=v.clips.find(c=>c.name===name);if(!clip)return;
  v.mixer.stopAllAction();v.mixer.clipAction(clip).play();v.root.userData.clip=name;
}
