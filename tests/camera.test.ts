import test from 'node:test';
import assert from 'node:assert/strict';
import {FixedCamera,screenMovement,drawingSize,spanHeight} from '../apps/web/src/visuals/camera.ts';
test('screen direction is orthonormal and diagonal normalized',()=>{
 const right=screenMovement(1,0),up=screenMovement(0,-1),diag=screenMovement(1,-1);
 assert.ok(right.x>0&&right.z<0&&up.x<0&&up.z<0);
 assert.ok(Math.abs(right.x*up.x+right.z*up.z)<1e-12);
 assert.ok(Math.abs(Math.hypot(diag.x,diag.z)-1)<1e-12);
});
test('camera rests inside central deadzone, F preserves preference, manual pan stays detached',()=>{
 const c=new FixedCamera();c.recenter({x:20,z:20});c.advance({x:20.5,z:20},.2,40,22);assert.equal(c.x,20);assert.equal(c.z,20);
 c.follow=false;c.recenter({x:8,z:12});assert.equal(c.follow,false);
 c.follow=true;c.pan(3,0);const before=[c.x,c.z];c.advance({x:40,z:30},.2,40,22);assert.deepEqual([c.x,c.z],before);
});
test('camera full visible dt, capped speed and acceleration, held/long frame reset',()=>{
 const c=new FixedCamera();c.recenter({x:2,z:2});c.advance({x:40,z:28},.2,30,22);
 assert.ok(Math.hypot(c.vx,c.vz)<=2.4+1e-10);assert.ok(Math.hypot(c.x-2,c.z-2)<=5.5*.2);
 const d=new FixedCamera();d.recenter({x:2,z:2});for(let i=0;i<4;i++)d.advance({x:40,z:28},.05,30,22);
 assert.ok(Math.hypot(c.x-d.x,c.z-d.z)<1e-10);
 const before=[c.x,c.z];c.advance({x:40,z:28},.4,30,22);assert.deepEqual([c.x,c.z],before);assert.equal(c.vx,0);
 c.held=true;c.advance({x:40,z:28},.1,30,22);assert.deepEqual([c.x,c.z],before);
});
test('frustum uses CSS height and quality pixel caps are enforced at 4K',()=>{
 assert.equal(spanHeight(768,false,1),22);assert.equal(spanHeight(2160,false,1),22);assert.equal(spanHeight(360,false,1),12);
 for(const [w,h]of [[1366,768],[3840,2160],[800,360]])for(const low of [true,false]){
  const d=drawingSize(w,h,2,low);assert.ok(d.width*d.height<=(low?1048576:3686400));
 }
});
