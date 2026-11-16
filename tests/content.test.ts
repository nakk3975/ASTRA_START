import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateContent,goals,B} from '../packages/content/src/index.ts';
import {createWorld} from '../packages/game-core/src/world.ts';
test('P0 content contracts and milestone rounding',()=>{assert.equal(validateContent().schemaVersion,1);assert.equal(goals(6)[0].wire,11);assert.equal(goals(6)[1].wire,32);assert.equal(goals(6)[5].wire,52);assert.equal(B.recipes.smelt_ingot.duration_ticks,120);});
test('P0 new world has no example factory or free inventory',()=>{const w=createWorld('test','test','TEST',1,'test');assert.equal(Object.keys(w.machines).length,0);assert.equal(Object.keys(w.links).length,0);assert.equal(w.tick,'0');assert.equal(w.stage,0);});
