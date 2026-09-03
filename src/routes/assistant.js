import { Router } from 'express';import { assistantQuery } from '../services/assistantService.js';import { hasPermission } from '../services/permissionService.js';
const router=Router();
router.post('/query',async(req,res)=>{const r=await assistantQuery(req.body.query||'');if(r.type==='employees'&&!hasPermission(req.auth,'employee.sensitive.view'))r.data=r.data.map(({identity_number,date_of_birth,permanent_address,current_address,social_insurance_number,social_insurance_raw,...safe})=>safe);res.json(r)});
export default router;
