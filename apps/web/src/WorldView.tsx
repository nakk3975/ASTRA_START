import React, { useEffect, useRef } from 'react';
import * as T from 'three';
import {B,M,UNIT} from '../../../packages/content/src/index.ts';
import { fixedGeometry,geometry,placement,machineGeometry,blocked,solids,type World,type Geometry,type Point } from '../../../packages/game-core/src/index.ts';
import catalog from '../../../design/asset_catalog_v1_1.json';
import {assetInstance,preloadAssets,manifest,playClip,type Visual} from './visuals/assets';
import {FixedCamera,viewControl,drawingSize,spanHeight,Q,S,C} from './visuals/camera';
export const colors=['#ed8050','#50a6c0','#9d82c6','#82ab64','#d0a048','#e27898'];
export type Ghost={type:string;x:number;z:number;rotation:number;moveId?:string};
type Props={world:World|null;member:string;selected:string|null;ghost:Ghost|null;low:boolean;overview:boolean;onSelect:(id:string)=>void;onGround:(p:Point)=>void;onError:(s:string)=>void;pilot?:boolean};
type Entity={node:T.Group;visual:Visual|null;key:string;dispose:()=>void};
export function WorldView(props:Props){
 const host=useRef<HTMLDivElement>(null),latest=useRef(props);latest.current=props;
 useEffect(()=>{
  const element=host.current!;
  let renderer:T.WebGLRenderer;
  try{renderer=new T.WebGLRenderer({antialias:false,alpha:false,powerPreference:'high-performance'});}catch(e){
   element.textContent='WebGL 2를 시작할 수 없습니다. 하드웨어 가속이 가능한 브라우저에서 다시 열어 주세요. 3D 검수는 완료되지 않았습니다.';
   latest.current.onError('WebGL 2 시작 실패');return;
  }
  renderer.setClearColor('#dce4da');renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.domElement.setAttribute('aria-label','고철로 우주까지 3D 작업장');element.append(renderer.domElement);
  const scene=new T.Scene(),camera=new T.OrthographicCamera(-22,22,11,-11,.1,200),controller=new FixedCamera();
  const sun=new T.DirectionalLight('#fff3d6',2.5);sun.position.set(-20,40,15);scene.add(sun,new T.HemisphereLight('#efffff','#84977a',2.1));
  const clickables:T.Object3D[]=[],entities=new Map<string,Entity>(),players=new Map<string,Entity>(),cargo=new Map<string,Entity>(),links=new Map<string,T.Line>();
  const ownGeo=new Set<T.BufferGeometry>(),ownMat=new Set<T.Material>(),ownTex=new Set<T.Texture>();
  function mat(color:string){const m=new T.MeshStandardMaterial({color,roughness:.85});ownMat.add(m);return m;}
  function box(parent:T.Object3D,x:number,y:number,z:number,w:number,h:number,d:number,color:string){const g=new T.BoxGeometry(w,h,d);ownGeo.add(g);const n=new T.Mesh(g,mat(color));n.position.set(x,y,z);parent.add(n);return n;}
  function label(parent:T.Object3D,text:string,y:number,color='#365651',width=2.2){
   const c=document.createElement('canvas');c.width=384;c.height=64;const ctx=c.getContext('2d')!;
   ctx.fillStyle='#f9f7e9e8';ctx.beginPath();ctx.roundRect(0,0,384,64,14);ctx.fill();ctx.fillStyle=color;ctx.font='600 27px sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(text,192,33,368);
   const tex=new T.CanvasTexture(c);ownTex.add(tex);const m=new T.SpriteMaterial({map:tex,depthTest:false});ownMat.add(m);const n=new T.Sprite(m);n.position.y=y;n.scale.set(width,width/6,1);parent.add(n);return n;
  }
  function ring(parent:T.Object3D,x:number,z:number,r:number,color:string){const g=new T.RingGeometry(r,r+.045,24);ownGeo.add(g);const m=new T.MeshBasicMaterial({color,side:T.DoubleSide,depthWrite:false});ownMat.add(m);const n=new T.Mesh(g,m);n.rotation.x=-Math.PI/2;n.position.set(x,.035,z);parent.add(n);return n;}
  function entity(id:string,asset:string,x:number,z:number,rotation=0,y=0):Entity{
   const node=new T.Group();node.name=id;node.userData.id=id;node.position.set(x,y,z);
   const visual=assetInstance(asset,latest.current.low);
   if(visual){visual.root.rotation.y+=-rotation*Math.PI/2;node.add(visual.root);}
   else {const marker=box(node,0,.07,0,.8,.14,.8,'#aab8b0');marker.userData.unavailable=asset;label(node,'제작 대기',.35,'#64756e',1.2);}
   scene.add(node);clickables.push(node);
   return {node,visual,key:asset+':'+rotation+':'+latest.current.low,dispose(){visual?.release();node.removeFromParent();const i=clickables.indexOf(node);if(i>=0)clickables.splice(i,1);}};
  }
  function facility(id:string,g:Geometry,asset:string){
   const cx=g.top_left.x+g.footprint.width/2,cz=g.top_left.z+g.footprint.depth/2;
   const e=entity(id,asset,cx,cz,g.rotation_degrees/90);
   for(const s of g.service_points)ring(e.node,s.interaction_anchor.x-cx,s.interaction_anchor.z-cz,.32,'#e0a758');
   return e;
  }
  box(scene,24,-.2,16,64,.4,48,'#99aa90');box(scene,24,-.02,16,48,.06,32,'#c9cbb4');
  for(const road of M.protected_walkways)box(scene,(road.x_min+road.x_max+1)/2,.021,(road.z_min+road.z_max+1)/2,road.x_max-road.x_min+1,.01,road.z_max-road.z_min+1,'#e1deca');
  for(const r of M.factory_regions)box(scene,(r.x_min+r.x_max+1)/2,.021,(r.z_min+r.z_max+1)/2,r.x_max-r.x_min+1,.01,r.z_max-r.z_min+1,'#b2bfb1');
  const grid=new T.GridHelper(48,48,'#b0b99f','#c1c8b3');grid.position.set(24,.03,16);grid.scale.z=32/48;scene.add(grid);ownGeo.add(grid.geometry);(Array.isArray(grid.material)?grid.material:[grid.material]).forEach(m=>ownMat.add(m));
  const rocketProxy=box(scene,24.5,.015,26,4.6,.03,5.6,'#b8baa4');rocketProxy.userData.id='rocket';clickables.push(rocketProxy);
  const rocketGround=new T.Group(),rocketFlight=new T.Group();rocketGround.position.set(24.5,0,26);rocketFlight.position.set(24.5,0,26);scene.add(rocketGround,rocketFlight);
  const rocketVisuals:Visual[]=[];let rocketKey='',launchedAt=0;
  function rocketPart(id:string,parent:T.Group,y:number,x=0,z=0,rotation=0){const v=assetInstance(id,latest.current.low);if(!v)return;v.root.position.set(x,y,z);v.root.rotation.y=rotation;v.root.userData.id='rocket';parent.add(v.root);rocketVisuals.push(v);clickables.push(v.root);}
  const selection=ring(scene,0,0,.9,'#e39b47');selection.visible=false;
  let loaded=false,disposed=false,frame=0,previous=performance.now(),lastRender=0,oldQuality=props.low,oldOverview=false,overviewSave:{x:number;z:number;step:number;detached:boolean}|null=null,oldPanel=false,heldAfterPanel=false,oldRecenter=0;
  let cssW=1,cssH=1,span=22,drag:{x:number;y:number;pan:boolean}|null=null,lastWheel=0,ghost:Entity|null=null,ghostKey='',initialized=false;
  const status=document.createElement('div');status.className='world-status';status.textContent='3D 모델을 불러오는 중';element.append(status);
  const offscreen=document.createElement('button');offscreen.className='player-offscreen';offscreen.textContent='내 작업자 찾기 · F';offscreen.onclick=()=>viewControl.recenter++;offscreen.hidden=true;element.append(offscreen);
  function resize(){cssW=Math.max(1,element.clientWidth);cssH=Math.max(1,element.clientHeight);const r=drawingSize(cssW,cssH,devicePixelRatio,latest.current.low);renderer.setPixelRatio(1);renderer.setSize(r.width,r.height,false);renderer.domElement.style.width='100%';renderer.domElement.style.height='100%';}
  const observer=new ResizeObserver(resize);observer.observe(element);resize();
  const ray=new T.Raycaster(),pointer=new T.Vector2();
  function pointerdown(e:PointerEvent){drag={x:e.clientX,y:e.clientY,pan:e.button===1};if(drag.pan){e.preventDefault();renderer.domElement.setPointerCapture(e.pointerId);}}
  function pointermove(e:PointerEvent){if(drag?.pan){controller.pan(-(e.clientX-drag.x)*span/cssH,(e.clientY-drag.y)*span/cssH);drag.x=e.clientX;drag.y=e.clientY;}}
  function pointerup(e:PointerEvent){if(!drag)return;const was=drag;drag=null;if(was.pan||Math.hypot(e.clientX-was.x,e.clientY-was.y)>8||latest.current.overview)return;
   const rect=renderer.domElement.getBoundingClientRect();pointer.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(pointer,camera);
   if(latest.current.ghost){const p=new T.Vector3();if(ray.ray.intersectPlane(new T.Plane(new T.Vector3(0,1,0),0),p))latest.current.onGround({x:Math.floor(p.x),z:Math.floor(p.z)});return;}
   const hit=ray.intersectObjects(clickables,true)[0];if(hit){let n:T.Object3D|null=hit.object;while(n&&!n.userData.id)n=n.parent;if(n)latest.current.onSelect(n.userData.id);}
  }
  function wheel(e:WheelEvent){if(e.ctrlKey||latest.current.overview)return;e.preventDefault();if(e.timeStamp-lastWheel<150)return;lastWheel=e.timeStamp;controller.step=Math.max(0,Math.min(2,controller.step+Math.sign(e.deltaY)));}
  function hidden(){controller.vx=controller.vz=0;viewControl.input={x:0,z:0};viewControl.resync=true;previous=performance.now();}
  renderer.domElement.addEventListener('pointerdown',pointerdown);renderer.domElement.addEventListener('pointermove',pointermove);renderer.domElement.addEventListener('pointerup',pointerup);renderer.domElement.addEventListener('wheel',wheel,{passive:false});document.addEventListener('visibilitychange',hidden);
  preloadAssets().then(()=>{if(!disposed){loaded=true;status.textContent='';}}).catch(e=>{status.textContent=e.message;latest.current.onError(e.message)});
  const fadeState=new Map<T.Material,{hit:number;clear:number;opacity:number}>();
  function animate(now:number){if(disposed)return;frame=requestAnimationFrame(animate);const rawdt=(now-previous)/1000;previous=now;const dt=rawdt>.25?0:rawdt;
   const p=latest.current,w=p.world,me=w?.members[p.member];
   if(rawdt>.25&&initialized){viewControl.resync=true;viewControl.input={x:0,z:0};controller.vx=controller.vz=0;}
   if(p.low!==oldQuality){oldQuality=p.low;resize();for(const e of entities.values())e.dispose();entities.clear();for(const e of players.values())e.dispose();players.clear();rocketKey='';}
   if(loaded){
    if(p.pilot){
     for(const [id,x,z] of [['processor',23,16],['rocket_lower_hull',27,16],['worker',24,19]] as const){if(!entities.has('pilot:'+id))entities.set('pilot:'+id,entity('pilot:'+id,id,x,z));}
    }else {
     for(const g of fixedGeometry.filter(g=>g.id!=='rocket')){
      const id=(catalog.machine_bindings as Record<string,string>)[g.id]??(catalog.machine_bindings as Record<string,string>)[g.kind]??g.id;
      if(!entities.has(g.id)){const e=facility(g.id,g,id);entities.set(g.id,e);}
     }
     for(const src of M.source_zones){
      const binding=(catalog.source_bindings as Record<string,string>)[src.id]??(catalog.source_bindings as Record<string,string>)[src.item_id];
      for(const [i,s] of src.manual_service_points.entries()){const id=src.id+':'+i;if(!entities.has(id)){const e=entity(src.id,binding,s.interaction_anchor.x,s.interaction_anchor.z,0,-.12);ring(e.node,0,0,.4,'#dbb76a');entities.set(id,e);}}
     }
    }
    if(w){
     for(const m of Object.values(w.machines).filter(m=>m.type!=='channel')){
      const key=JSON.stringify([m.geometry,p.low]),old=entities.get(m.id);
      if(old?.key!==key){old?.dispose();const e=facility(m.id,m.geometry,(catalog.machine_bindings as Record<string,string>)[m.type]??m.type);e.key=key;entities.set(m.id,e);}
     }
     for(const [id,e]of entities)if(!fixedGeometry.some(g=>g.id===id)&&!id.startsWith('source_')&&!id.startsWith('pilot:')&&!w.machines[id]&&!w.crates[id]){e.dispose();entities.delete(id);}
     for(const [id,pos]of Object.entries(w.crates))if(!entities.has(id))entities.set(id,entity(id,'recovery_crate',pos.x+.5,pos.z+.5));
     for(const [index,m]of Object.values(w.members).entries()){
      let e=players.get(m.id);if(!m.connected){if(e)e.node.visible=false;continue;}
      if(!e){e=entity('bag:'+m.id,'worker',m.position.x/UNIT,m.position.z/UNIT);ring(e.node,0,0,.38,colors[index%6]);label(e.node,`${index+1} ${m.name}`,2.15,colors[index%6]);players.set(m.id,e);}
      e.node.visible=true;const dest=new T.Vector3(m.position.x/UNIT,0,m.position.z/UNIT),old=e.node.position.clone();
      if(m.id===p.member&&!viewControl.panel&&!p.overview&&!viewControl.resync&&performance.now()-viewControl.inputAt<150){
       const input=viewControl.input,proposed={x:Math.round((e.node.position.x+input.x*(m.upgrades.includes("move_tier_1")?B.upgrades.move_tier_1.result_move_tiles_per_second:B.player.base_move_tiles_per_second)*dt)*UNIT),z:Math.round((e.node.position.z+input.z*(m.upgrades.includes("move_tier_1")?B.upgrades.move_tier_1.result_move_tiles_per_second:B.player.base_move_tiles_per_second)*dt)*UNIT)};
       if(!blocked(proposed,solids(w)))e.node.position.set(proposed.x/UNIT,0,proposed.z/UNIT);
       const delta=e.node.position.distanceTo(dest);if(delta>1.5)e.node.position.copy(dest);else e.node.position.lerp(dest,Math.min(1,dt*5));
      }else e.node.position.lerp(dest,Math.min(1,dt*14));
      e.node.position.y=0;const dx=e.node.position.x-old.x,dz=e.node.position.z-old.z,moving=Math.hypot(dx,dz)>.001;
      if(moving)e.node.rotation.y=Math.atan2(-dx,-dz);
      if(e.visual){const bag=w.inventories['bag:'+m.id],carrying=bag?.kind==='PLAYER'&&bag.slots.some(Boolean);playClip(e.visual,w.phase==='LAUNCHED'?'celebrate':m.work?'work_loop':moving?(carrying?'carry_locomotion':'locomotion'):'idle');e.visual.mixer?.update(dt);}
     }
     for(const l of Object.values(w.links))if(!links.has(l.id)){const a=geometry(w,l.from).delivery_distance_anchor,b=geometry(w,l.to).delivery_distance_anchor;const g=new T.BufferGeometry().setFromPoints([new T.Vector3(a.x,.12,a.z),new T.Vector3(b.x,.12,b.z)]),m=new T.LineBasicMaterial({color:'#519b97',transparent:true,opacity:.65});ownGeo.add(g);ownMat.add(m);const line=new T.Line(g,m);scene.add(line);links.set(l.id,line);}
     for(const[id,l]of links)if(!w.links[id]){l.removeFromParent();links.delete(id);}
     for(const c of Object.values(w.cargo)){let e=cargo.get(c.id);if(!e){e=entity('cargo:'+c.id,'cargo_pod',0,0);e.node.scale.setScalar(.3);cargo.set(c.id,e);}const a=geometry(w,c.from).delivery_distance_anchor,b=geometry(w,c.to).delivery_distance_anchor,t=Math.min(1,Math.max(0,(Number(w.tick)-Number(c.departed))/(Number(c.arrival)-Number(c.departed))));e.node.position.set(a.x+(b.x-a.x)*t,.18,a.z+(b.z-a.z)*t);}
     for(const[id,e]of cargo)if(!w.cargo[id]){e.dispose();cargo.delete(id);}
     const stage=w.stages[w.stage],ratio=stage?Object.values(stage.delivered).reduce((a,b)=>a+b,0)/Math.max(1,Object.values(stage.required).reduce((a,b)=>a+b,0)):1;
     const key=[w.stage,Math.floor(ratio*4),p.low].join(':');
     if(key!==rocketKey){rocketKey=key;for(const v of rocketVisuals){const i=clickables.indexOf(v.root);if(i>=0)clickables.splice(i,1);v.release();}rocketVisuals.length=0;
      const completed=w.stage; if(completed>=1)rocketPart('rocket_pad',rocketGround,0);if(completed>=2)rocketPart('rocket_gantry',rocketGround,.25);
      if(completed>=3){rocketPart('rocket_lower_hull',rocketFlight,1.2);rocketPart('rocket_upper_hull',rocketFlight,4.2);}
      if(completed>=4){rocketPart('rocket_engine',rocketFlight,.25);for(let i=0;i<4;i++){const a=i*Math.PI/2;rocketPart('rocket_fin',rocketFlight,1.2,Math.cos(a)*1.1,Math.sin(a)*1.1,-a);}}
      if(completed>=5){rocketPart('rocket_nose',rocketFlight,6.2);for(let i=0;i<(completed>=6?8:1);i++){const a=i*Math.PI/4;rocketPart('rocket_panel',rocketFlight,3,Math.cos(a)*1.01,Math.sin(a)*1.01,-a);}}
     }
     if(w.phase==='LAUNCHED'){if(!launchedAt)launchedAt=now;rocketFlight.position.y=viewControl.reduced?0:Math.min(45,(now-launchedAt)/1000*3);}else{rocketFlight.position.y=0;launchedAt=0;}
    }
   }
   const player=players.get(p.member)?.node,anchor=player?{x:player.position.x,z:player.position.z}:p.pilot?{x:24,z:18}:{x:24,z:16};
   if(!initialized&&loaded){controller.recenter(anchor);initialized=true;}
   if(viewControl.recenter!==oldRecenter){oldRecenter=viewControl.recenter;controller.recenter(anchor);heldAfterPanel=false;viewControl.resync=false;}
   if(viewControl.zoom){controller.step=Math.max(0,Math.min(2,controller.step+viewControl.zoom));viewControl.zoom=0;}
   if(viewControl.panel&&!oldPanel){heldAfterPanel=true;controller.vx=controller.vz=0;}oldPanel=viewControl.panel;
   if(!viewControl.panel&&(viewControl.input.x||viewControl.input.z))heldAfterPanel=false;
   controller.follow=viewControl.follow;controller.held=viewControl.panel||heldAfterPanel||viewControl.resync;
   if(p.overview&&!oldOverview){overviewSave={x:controller.x,z:controller.z,step:controller.step,detached:controller.detached};}
   if(!p.overview&&oldOverview&&overviewSave)Object.assign(controller,overviewSave);oldOverview=p.overview;
   span=spanHeight(cssH,matchMedia('(pointer:coarse)').matches,controller.step);
   let tx=controller.x,tz=controller.z,ty=0;
   if(p.overview&&!p.pilot){tx=24;tz=16;span=Math.max((48+32)*S*Q+8*C,(48+32)*Q/(cssW/cssH))*1.12;}
   else if(viewControl.launchView){tx=24.5;tz=26;ty=4;span=16;}
   else{controller.advance(anchor,dt,span*cssW/cssH,span);tx=controller.x;tz=controller.z;}
   camera.left=-span*cssW/cssH/2;camera.right=-camera.left;camera.top=span/2;camera.bottom=-span/2;camera.zoom=1;camera.updateProjectionMatrix();camera.position.set(tx+C*Q*80,ty+S*80,tz+C*Q*80);camera.lookAt(tx,ty,tz);camera.updateMatrixWorld();
   if(player&&!p.overview){const ndc=player.position.clone().project(camera);offscreen.hidden=Math.abs(ndc.x)<.92&&Math.abs(ndc.y)<.85;}
   else offscreen.hidden=true;
   // Fade only this instance's materials. The server footprint and ray target are untouched.
   const hitMats=new Set<T.Material>();if(player){const origin=camera.position.clone(),end=player.position.clone().add(new T.Vector3(0,1,0));ray.set(origin,end.clone().sub(origin).normalize());ray.far=origin.distanceTo(end)-.25;
    for(const h of ray.intersectObjects([...entities.values()].map(e=>e.node).concat(rocketGround,rocketFlight),true))if(h.object instanceof T.Mesh){for(const m of Array.isArray(h.object.material)?h.object.material:[h.object.material])hitMats.add(m);}
    ray.far=Infinity;
   }
   for(const m of hitMats)if(!fadeState.has(m))fadeState.set(m,{hit:now,clear:0,opacity:1});
   for(const[m,f]of fadeState){const hit=hitMats.has(m);if(hit)f.clear=0;else if(!f.clear)f.clear=now;const target=hit&&now-f.hit>=100?.22:!hit&&now-f.clear>=300?1:f.opacity;f.opacity+=Math.sign(target-f.opacity)*Math.min(Math.abs(target-f.opacity),viewControl.reduced?1:dt/.15*.78);m.transparent=f.opacity<1;m.opacity=f.opacity;m.depthWrite=f.opacity>=1;if(!hit&&f.opacity===1)fadeState.delete(m);}
   const gh=p.ghost,key=JSON.stringify([gh,p.low]);if(key!==ghostKey){ghostKey=key;ghost?.dispose();ghost=null;if(gh){const g=machineGeometry('ghost',gh.type,gh.x,gh.z,gh.rotation);ghost=facility('ghost',g,(catalog.machine_bindings as Record<string,string>)[gh.type]??gh.type);const valid=w&&!placement(w,g,gh.moveId);ghost.node.traverse(o=>{if(o instanceof T.Mesh){for(const m of Array.isArray(o.material)?o.material:[o.material]){m.transparent=true;m.opacity=.5;if(m instanceof T.MeshStandardMaterial)m.color.set(valid?'#72bb91':'#df6868');}}});}}
   selection.visible=false;if(p.selected&&w){try{const g=geometry(w,p.selected);selection.position.set(g.delivery_distance_anchor.x,.08,g.delivery_distance_anchor.z);selection.visible=true;}catch{}}
   if(loaded)status.textContent=viewControl.resync?'화면을 동기화했습니다. 이동하거나 F를 눌러 계속하세요.':p.overview?'둘러보기 · 작업은 계속됩니다 · F로 돌아가기':'';
   if(!p.low||now-lastRender>=1000/30){renderer.render(scene,camera);lastRender=now;}
   const metrics={webgl:true,loaded,assets:manifest?.assets.map(a=>a.id),css:[cssW,cssH],drawing:[renderer.domElement.width,renderer.domElement.height],triangles:renderer.info.render.triangles,drawCalls:renderer.info.render.calls,camera:{elevation:55,azimuth:45,span,target:[tx,ty,tz]},pilot:p.pilot??false};
   element.dataset.metrics=JSON.stringify(metrics);
  }
  frame=requestAnimationFrame(animate);
  return()=>{disposed=true;cancelAnimationFrame(frame);observer.disconnect();document.removeEventListener('visibilitychange',hidden);for(const e of [...entities.values(),...players.values(),...cargo.values()])e.dispose();for(const v of rocketVisuals)v.release();ghost?.dispose();ownGeo.forEach(g=>g.dispose());ownMat.forEach(m=>m.dispose());ownTex.forEach(t=>t.dispose());renderer.dispose();element.replaceChildren();};
 },[]);
 return <div ref={host} className="world-canvas" />;
}
