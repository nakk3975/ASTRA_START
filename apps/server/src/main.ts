import express from 'express';
const app=express();app.get('/health/live',(_req,res)=>res.json({ok:true,phase:'P0'}));app.listen(2567);
