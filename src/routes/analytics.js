import { Router } from 'express';
import { can } from '../middleware/auth.js';
import { analyticsSnapshot, anomalyList } from '../services/analyticsService.js';
import { Employees, EmployeeDocuments, EmployeeContracts, Branches, Positions, DocumentTypes } from '../models/raw.js';
import { enrichEmployees } from '../services/employeeService.js';
const router=Router();
router.get('/',can('report.view'),async(req,res)=>res.json(await analyticsSnapshot()));
router.get('/anomalies',can('report.view'),async(req,res)=>res.json({items:await anomalyList()}));
router.get('/reports',can('report.view'),async(req,res)=>{
  const [rawEmployees,documents,contracts,branches,positions,documentTypes]=await Promise.all([
    Employees.find({deleted_at:null}).lean(),EmployeeDocuments.find({}).lean(),EmployeeContracts.find({}).lean(),Branches.find({status:'active'}).lean(),Positions.find({status:'active'}).lean(),DocumentTypes.find({status:'active'}).lean()
  ]);
  const employees=await enrichEmployees(rawEmployees);
  const byBranch=branches.map(b=>({branch:b.branch_name,count:employees.filter(e=>Number(e.branch_id)===Number(b.id)).length,probation:employees.filter(e=>Number(e.branch_id)===Number(b.id)&&e.employment_status==='probation').length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count);
  const byPosition=positions.map(p=>({position:p.position_name,count:employees.filter(e=>Number(e.position_id)===Number(p.id)).length})).filter(x=>x.count>0).sort((a,b)=>b.count-a.count).slice(0,10);
  const required=documentTypes.filter(x=>Boolean(Number(x.is_required))||x.is_required===true);
  const docByEmployee=new Map();
  for(const d of documents){const k=Number(d.employee_id);if(!docByEmployee.has(k))docByEmployee.set(k,new Map());docByEmployee.get(k).set(Number(d.document_type_id),d)}
  const missing=employees.map(e=>{
    const rows=docByEmployee.get(Number(e.id))||new Map();
    const absent=required.filter(t=>{const d=rows.get(Number(t.id));return !d||['missing','expired'].includes(String(d.document_status||'missing'))});
    return {id:e.id,employee_code:e.employee_code,full_name:e.full_name,missing_count:absent.length,total_required:required.length,missing_names:absent.map(x=>x.document_name)};
  }).filter(x=>x.missing_count>0).sort((a,b)=>b.missing_count-a.missing_count||String(a.full_name).localeCompare(String(b.full_name),'vi'));
  res.json({summary:{employees:employees.length,documents:documents.length,contracts:contracts.length,branches:branches.length},byBranch,byPosition,missing});
});
export default router;
