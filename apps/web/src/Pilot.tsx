import React,{useState}from 'react';
import {WorldView}from './WorldView';
import {viewControl}from './visuals/camera';
import './style.css';
export default function Pilot(){
 const[size,setSize]=useState([1366,768]),[low,setLow]=useState(false),[error,setError]=useState('');
 return <main className="pilot-page"><header><h1>첫 3개 모델 · 게임 렌더러 검수</h1><p>작업자 / 가공기 / 로켓 하부 선체 — 고도 55°, 방위 45°, 정사영. 검수 결과는 자동으로 통과 처리되지 않습니다.</p><nav>{[[1366,768],[3840,2160],[800,360]].map(s=><button key={s.join()}onClick={()=>setSize(s)}>{s.join(' × ')}</button>)}<button onClick={()=>setLow(!low)}>{low?'저사양':'표준'} 품질</button><button onClick={()=>viewControl.zoom--}>확대</button><button onClick={()=>viewControl.zoom++}>축소</button><a href="/">게임으로</a></nav><p role="status">{error||'같은 WorldView, 동일 GLB·카메라·품질 설정을 사용합니다. 실제 기기 FPS와 조작감은 별도 확인하세요.'}</p></header><section style={{width:size[0],height:size[1],position:'relative'}}><WorldView world={null}member=""selected={null}ghost={null}low={low}overview={false}pilot onSelect={()=>{}}onGround={()=>{}}onError={setError}/></section></main>;
}
